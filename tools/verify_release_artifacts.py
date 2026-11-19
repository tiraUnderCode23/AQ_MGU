#!/usr/bin/env python3
"""Verify original release bytes and package metadata without installing anything.

This opt-in network check never runs a build, a package hook, SSH or a vehicle
operation. Archives are read in place, never extracted. The offline feed checks
remain in verify_store_feeds.py. JSON evidence records download and packaging
results separately from live installation, which is always NOT OBSERVED here.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class ArtifactError(ValueError):
    pass


def validate_artifact(artifact):
    if not isinstance(artifact, dict):
        raise ArtifactError("artifact must be an object")
    if type(artifact.get("size")) is not int or artifact["size"] <= 0:
        raise ArtifactError("expected a positive compressed byte count")
    if not isinstance(artifact.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", artifact["sha256"]):
        raise ArtifactError("expected a SHA-256")
    if not isinstance(artifact.get("url"), str):
        raise ArtifactError("expected a public HTTPS artifact URL without credentials")
    url = urlsplit(artifact["url"])
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise ArtifactError("expected a public HTTPS artifact URL without credentials")


def copy_verified(stream, destination, expected_size, expected_sha256):
    """Use the actual compressed bytes, including the first byte beyond the limit."""
    digest = hashlib.sha256()
    received = 0
    with destination.open("wb") as handle:
        while True:
            chunk = stream.read(min(1024 * 1024, expected_size - received + 1))
            if not chunk:
                break
            received += len(chunk)
            if received > expected_size:
                raise ArtifactError(
                    f"more than expected bytes: expected {expected_size}, received at least {received}")
            digest.update(chunk)
            handle.write(chunk)
    if received != expected_size:
        raise ArtifactError(f"incomplete download: expected {expected_size}, received {received}")
    actual = digest.hexdigest()
    if actual != expected_sha256:
        raise ArtifactError(f"SHA-256 mismatch: expected {expected_sha256}, received {actual}")
    return {"received_bytes": received, "sha256": actual}


def download(artifact, cache):
    validate_artifact(artifact)
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / (artifact["sha256"] + ".tgz")
    if target.is_file() and target.stat().st_size == artifact["size"]:
        digest = hashlib.sha256()
        with target.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() == artifact["sha256"]:
            return target
    # A failed response never replaces a verified artifact.
    with tempfile.NamedTemporaryFile(dir=cache, suffix=".part", delete=False) as handle:
        partial = Path(handle.name)
    try:
        # AQ is an HTTPS catalog source. The original Store's HTTPS reader
        # sends its User-Agent without the GitHub API octet-stream header.
        # Adding that header here could validate an API metadata URL that
        # returns JSON instead of the archive when the Store downloads it.
        request = Request(artifact["url"], headers={
            "User-Agent": "AQ-MGU-artifact-verifier/1",
        })
        with urlopen(request, timeout=45) as stream:
            if urlsplit(stream.geturl()).scheme != "https":
                raise ArtifactError("download redirected away from HTTPS")
            copy_verified(stream, partial, artifact["size"], artifact["sha256"])
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)
    return target


def safe_member(name):
    if not isinstance(name, str):
        raise ArtifactError("archive member path must be a string")
    while name.startswith("./"):
        name = name[2:]
    if not name or name == ".":
        return ""
    parts = PurePosixPath(name).parts
    if name.startswith("/") or "\\" in name or ".." in parts:
        raise ArtifactError("unsafe archive member: " + name)
    return name.rstrip("/")


def relative_path(value, where, allow_root=False):
    if not isinstance(value, str) or not value:
        raise ArtifactError(where + " must be a nonempty relative path")
    name = safe_member(value)
    if not name and not allow_root:
        raise ArtifactError(where + " must be a nonempty relative path")
    return name


def hmi_list(document, where):
    """Match the Store's hmiList: absent is unknown; an explicit list is strict."""
    if "mguHmi" not in document:
        return None
    value = document["mguHmi"]
    if (not isinstance(value, list) or not value
            or any(h not in ("ID7", "ID8") for h in value)
            or len(set(value)) != len(value)):
        raise ArtifactError(where + ': mguHmi must list "ID7" and/or "ID8"')
    return sorted(value)


def inspect_archive(path, component):
    with tarfile.open(path, "r:gz") as archive:
        members = {}
        for member in archive:
            name = safe_member(member.name)
            if not name:
                continue
            if name in members:
                raise ArtifactError("duplicate archive member: " + name)
            if member.isdev() or member.isfifo():
                raise ArtifactError("special device in archive: " + name)
            members[name] = member
            if len(members) > 100000:
                raise ArtifactError("archive has more than 100000 members")

        def read_json(name):
            member = members.get(name)
            if not member or not member.isfile() or member.size > 4 * 1024 * 1024:
                raise ArtifactError("missing or oversized JSON: " + name)
            with archive.extractfile(member) as handle:
                value = json.load(handle)
            if not isinstance(value, dict):
                raise ArtifactError("JSON must be an object: " + name)
            return value

        def entries(document, key, required=False):
            value = document.get(key, [] if not required else None)
            if value is None and key == "units":
                value = []  # the original validator uses (c.units || [])
            if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
                raise ArtifactError("invalid tool " + key + " declaration")
            return value

        def rhmi_hmis(rhmi_root):
            # deploy/unit/mgu-deploy.js rhmiHmis reads the native nested
            # application.uiDescriptions[].hmi arrays, then folder names.
            # Root-level uiDescriptions and scalar hmi are not its contract.
            ui = set()
            ui_name = rhmi_root + "application.json"
            if ui_name in members:
                application = read_json(ui_name).get("application")
                descriptions = application.get("uiDescriptions") if isinstance(application, dict) else None
                if isinstance(descriptions, list):
                    for entry in descriptions:
                        values = entry.get("hmi") if isinstance(entry, dict) else None
                        if isinstance(values, list):
                            ui.update(h for h in values if h in ("ID7", "ID8"))
            if not ui:
                for h in ("ID7", "ID8"):
                    directory = rhmi_root + "uiDescriptions/" + h
                    if any(name.startswith(directory + "/") or
                           (name == directory and member.isdir()) for name, member in members.items()):
                        ui.add(h)
            return sorted(ui)

        kind = component["kind"]
        candidates = ["component.json"] if kind == "tool" else [
            "mgu-app.json", "package/mgu-app.json", "package.json",
            "package/package.json", "source/package.json"]
        manifest_name = next((name for name in candidates if name in members), None)
        if not manifest_name:
            raise ArtifactError("no supported package manifest at archive root")
        manifest = read_json(manifest_name)
        source_build = manifest_name.endswith("mgu-app.json")
        identity = manifest.get("id") if source_build or kind == "tool" else manifest.get("name")
        if (identity, manifest.get("version")) != (component["id"], component["version"]):
            raise ArtifactError("package id/version differs from catalog")
        root = manifest_name.rsplit("/", 1)[0] + "/" if "/" in manifest_name else ""
        if source_build:
            if component.get("build") != "unit":
                raise ArtifactError("source package needs catalog build=unit")
            # The original oap_link.js readManifest requires these inputs;
            # sdk names are references, never a request to bundle donor code.
            if manifest.get("schema") != 1 or isinstance(manifest.get("schema"), bool):
                raise ArtifactError("source manifest schema is not 1")
            modules = manifest.get("modules")
            if not isinstance(modules, list) or not modules:
                raise ArtifactError("source modules must name the app's .js files, the entry first")
            for module in modules:
                name = root + relative_path(module, "source module")
                if not name.endswith(".js"):
                    raise ArtifactError("source modules must name the app's .js files, the entry first")
                if name not in members or not members[name].isfile():
                    raise ArtifactError("missing source module: " + name)
            sdk = manifest.get("sdk")
            if not isinstance(sdk, list) or not sdk or any(not isinstance(name, str) or not name for name in sdk):
                raise ArtifactError("source sdk must list the require names the donor resolves")
            tree = relative_path(manifest.get("tree"), "source tree", allow_root=True)
            package_root = root + (tree + "/" if tree else "")
            package = read_json(package_root + "package.json")
            if (package.get("name"), package.get("version")) != (identity, manifest.get("version")):
                raise ArtifactError("source tree package identity differs from source manifest")
        else:
            package_root, package = root, manifest
        if manifest_name == "source/package.json":
            meta = read_json("meta.json")
            if (meta.get("id"), meta.get("version")) != (identity, manifest.get("version")):
                raise ArtifactError("meta.json identity differs from source/package.json")
        if kind == "tool":
            # Released tool kits differ from source component.json: the
            # original Store packs files/ + units/ + dropins/ and replaces
            # each source 'from' field with the immutable payload SHA-256.
            if manifest.get("kind") != "tool":
                raise ArtifactError('component.json kind is not "tool"')
            for item in entries(manifest, "files", required=True):
                name = root + "files/" + relative_path(item.get("path"), "tool files path")
                member = members.get(name)
                if not member or not member.isfile():
                    raise ArtifactError("missing tool payload: " + name)
                digest = hashlib.sha256()
                with archive.extractfile(member) as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
                if digest.hexdigest() != item.get("sha256"):
                    raise ArtifactError("tool payload SHA-256 mismatch: " + name)
            for item in entries(manifest, "units"):
                name = root + "units/" + relative_path(item.get("name"), "tool unit name")
                if name not in members:
                    raise ArtifactError("missing tool unit: " + name)
            for item in entries(manifest, "dropins"):
                name = (root + "dropins/" + relative_path(item.get("unit"), "tool drop-in unit")
                        + ".d/" + relative_path(item.get("name"), "tool drop-in name"))
                if name not in members:
                    raise ArtifactError("missing tool drop-in: " + name)
        hmi = hmi_list(manifest if "mguHmi" in manifest else package, manifest_name)
        ui = []
        if kind == "app":
            ui = rhmi_hmis(package_root + "rhmiData/")
            if not ui and package_root and not source_build:
                ui = rhmi_hmis("rhmiData/")
        declared = hmi_list(component, "catalog")
        if declared and hmi and not set(declared).issubset(hmi):
            raise ArtifactError("catalog HMI exceeds the package's declared support")
        # A package's explicit mguHmi takes precedence, exactly as appHmi
        # does in the original Store. Absent HMI evidence stays unknown.
        if declared and not hmi and ui and not set(declared).issubset(ui):
            raise ArtifactError("catalog HMI has no corresponding package UI")
        return {
            "manifest": manifest_name, "package_id": identity,
            "package_version": manifest.get("version"), "source_build": source_build,
            "package_hmi": hmi, "ui_hmi": ui,
            "effective_hmi": hmi or ui or None,
            "hmi_source": "declared" if hmi else "rhmiData" if ui else "unknown",
            "package_requires": manifest.get("requires") or package.get("mguRequires") or {},
            "package_needs": manifest.get("needs") or package.get("mguNeeds") or [],
            "package_provides": manifest.get("mguProvides"),
            "contains_donor_sdk": any("node_modules/oap-sdk/" in name for name in members),
            "members": len(members),
        }


def verify(component, cache):
    result = {"id": None, "version": None, "live_hu_install": "NOT OBSERVED"}
    try:
        if not isinstance(component, dict):
            raise ArtifactError("catalog component must be an object")
        result.update({"id": component.get("id"), "version": component.get("version")})
        if not isinstance(component.get("id"), str) or not component["id"]:
            raise ArtifactError("catalog component needs an id")
        if not isinstance(component.get("version"), str) or not component["version"]:
            raise ArtifactError("catalog component needs a version")
        if component.get("kind") not in ("app", "tool"):
            raise ArtifactError("catalog component kind must be app or tool")
        artifact = component.get("artifact")
        if isinstance(artifact, dict):
            result.update({"artifact_url": artifact.get("url"), "expected_bytes": artifact.get("size"),
                           "expected_sha256": artifact.get("sha256")})
        validate_artifact(artifact)
        path = download(artifact, cache)
        result.update({"download": "PASS", "received_bytes": path.stat().st_size,
                       "sha256": component["artifact"]["sha256"]})
        result.update(inspect_archive(path, component))
        result["archive"] = "PASS"
    except (OSError, ValueError, TypeError, KeyError, AttributeError, EOFError, tarfile.TarError) as error:
        result["error"] = str(error)
        result.setdefault("download", "FAIL")
        result["archive"] = "FAIL"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path("release/catalog.json"))
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jobs", type=int, choices=range(1, 9), default=4)
    args = parser.parse_args()
    rows = json.loads(args.catalog.read_text(encoding="utf-8"))["components"]
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda row: verify(row, args.cache_dir), rows))
    doc = {"schema": 1, "live_hu_install": "NOT OBSERVED", "artifacts": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for result in results:
        print(result["id"], result["download"], result["archive"], result.get("error", ""))
    return 1 if any(row.get("error") for row in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
