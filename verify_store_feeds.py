#!/usr/bin/env python3
"""Offline, read-only validation of AQ_MGU's two Store feeds.

Uses git ls-tree (never checkout/fetch) to inspect paths in a sparse checkout.
It does not download binaries, execute app/build scripts or prove HU behavior.
"""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
SEMVER = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_MANAGER_PACKAGE = 200 * 1024 * 1024
MANIFESTS = ("mgu-repo.json", "release/catalog.json",
             "data/components.json", "data/catalog-provenance.json")
STORE_SOURCES = "data/store-sources.json"
PUBLIC_REPO = "tiraUnderCode23/AQ_MGU"
PUBLIC_RELEASE_INDEX = (
    "https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/"
    "main/release/catalog.json"
)


def git(*args):
    proc = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True,
                          text=True, encoding="utf-8", errors="replace",
                          check=False)
    if proc.returncode:
        raise RuntimeError("git " + " ".join(args) + ": " + proc.stderr.strip())
    return proc.stdout


def paths_at(ref):
    return set(git("ls-tree", "-r", "--name-only", ref).splitlines())


def load_json(path, ref, head_only):
    target = ROOT / path
    if target.is_file() and not head_only:
        raw = target.read_text(encoding="utf-8")
    else:
        raw = git("show", ref + ":" + path)
    try:
        return json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise ValueError(path + ": invalid JSON: " + str(exc)) from exc


def safe_path(path):
    return (isinstance(path, str) and bool(path) and
            not path.startswith("/") and "\\" not in path and
            ":" not in path and
            all(part not in ("", ".", "..") for part in path.split("/")))


def exists_in_tree(path, files):
    return path in files or any(item.startswith(path.rstrip("/") + "/")
                                for item in files)


def version_tuple(value):
    if not isinstance(value, str) or not SEMVER.fullmatch(value):
        return None
    return tuple(map(int, value.split(".")))


def check_store_sources(audit, doc):
    """Check source types supported by the *original Store add-source UI*.

    It cannot add the same GitHub repository twice, even with two channels.
    An ordinary HTTPS source, on the other hand, reads the schema-2 catalog
    with the Store's native size and SHA-256 checks. No authentication tokens
    or private repository permissions are bypassed.
    """
    where = STORE_SOURCES
    if not isinstance(doc, dict) or doc.get("schema") != 1:
        audit.fail(where, "expected schema 1")
        return
    sources = doc.get("sources")
    if not isinstance(sources, list) or len(sources) != 2:
        audit.fail(where, "expected one GitHub branch and one HTTPS catalog")
        return
    ids = [item.get("id") for item in sources if isinstance(item, dict)]
    if len(ids) != 2 or len(set(ids)) != 2:
        audit.fail(where, "source ids must be distinct")
        return
    branch = [s for s in sources if isinstance(s, dict) and s.get("type") == "github"]
    catalog = [s for s in sources if isinstance(s, dict) and s.get("type") == "https"]
    if len(branch) != 1 or len(catalog) != 1:
        audit.fail(where, "original Store rejects two GitHub sources for the same repo")
        return
    if branch[0].get("repo") != PUBLIC_REPO or branch[0].get("channel") != "branch:main":
        audit.fail(where, "GitHub source must explicitly select the public main branch")
    url = catalog[0].get("url")
    if not isinstance(url, str) or url != PUBLIC_RELEASE_INDEX:
        audit.fail(where, "HTTPS catalog must point to the public main release/catalog.json")
    audit.counts["store_sources"] = 2


class Audit:
    def __init__(self):
        self.errors = []
        self.warnings = []
        self.counts = {}

    def fail(self, where, detail):
        self.errors.append(where + ": " + detail)

    def warn(self, where, detail):
        self.warnings.append(where + ": " + detail)

    def require(self, valid, where, detail):
        if not valid:
            self.fail(where, detail)
        return bool(valid)


def check_requirements(audit, component, source):
    where = source + "/" + component.get("id", "<unknown>")
    req = component.get("requires")
    if req is None:
        return {}
    if not isinstance(req, dict):
        audit.fail(where, "requires must be an object")
        return {}
    for rid, minimum in req.items():
        if not IDENTIFIER.fullmatch(rid) or version_tuple(minimum) is None:
            audit.fail(where, "invalid requirement " + repr(rid))
        if rid == component.get("id"):
            audit.fail(where, "self-dependency")
    return req


def check_hmi(audit, component, source):
    hmi = component.get("mguHmi")
    if hmi is not None and (not isinstance(hmi, list) or not hmi or
                            len(set(str(x) for x in hmi)) != len(hmi) or
                            any(x not in ("ID7", "ID8") for x in hmi)):
        audit.fail(source + "/" + str(component.get("id")), "invalid mguHmi")


def check_shared(audit, cid, build, files):
    sdk = build.get("sdk")
    for path in build.get("shared", []):
        if not safe_path(path):
            audit.fail("source/" + cid, "unsafe build.shared path " + repr(path))
        elif not exists_in_tree(path, files):
            suffix = " (donor SDK; remove from shared, retain build.sdk)" if (
                path.endswith("/oap-sdk") or path == "oap-sdk") else ""
            audit.fail("source/" + cid, "missing build.shared " + path + suffix)


def check_source_inputs(audit, components, files, read_manifest):
    """Check the files the original Store will actually give to a build.

    A shared folder existing in Git is not enough: a partial source download
    includes only the component path, build.shared and the build script.
    No app script or proprietary SDK is executed by this validation.
    """
    unit_modules = 0
    shared_modules = 0
    manifests = 0
    for cid, entry in components.items():
        if entry.get("kind") != "app" or not safe_path(entry.get("path")):
            continue
        where = "source/" + cid
        folder = entry["path"]
        build = entry.get("build")
        if build == "unit":
            names = ["mgu-app.json"]
        elif isinstance(build, dict):
            declared = entry.get("manifest")
            names = [declared] if declared is not None else ["app.json", "package.json"]
        else:
            continue
        candidates = [folder + "/" + name for name in names if safe_path(name)]
        selected = next((name for name in candidates if name in files), None)
        if selected is None:
            continue  # check_source already reports a missing manifest.
        try:
            manifest = read_manifest(selected)
        except (ValueError, RuntimeError, OSError) as exc:
            audit.fail(where, "cannot read source manifest: " + str(exc))
            continue
        if not isinstance(manifest, dict):
            audit.fail(where, "source manifest must be an object")
            continue
        manifests += 1
        declared_id = manifest.get("id", manifest.get("name"))
        if declared_id is not None and declared_id != cid:
            audit.fail(where, "source manifest identity does not match catalog")
        if manifest.get("version") != entry.get("version"):
            audit.fail(where, "source manifest version does not match catalog")

        if build == "unit":
            audit.require(manifest.get("schema") == 1, where, "unit source schema is not 1")
            modules = manifest.get("modules")
            if not isinstance(modules, list) or not modules:
                audit.fail(where, "unit source modules must be a nonempty list")
                continue
            for module in modules:
                unit_modules += 1
                if not safe_path(module) or not module.endswith(".js"):
                    audit.fail(where, "invalid unit source module " + repr(module))
                elif folder + "/" + module not in files:
                    audit.fail(where, "missing unit source module " + module)
            tree = manifest.get("tree")
            if not safe_path(tree) or folder + "/" + tree + "/package.json" not in files:
                audit.fail(where, "unit source tree has no package.json")
            else:
                try:
                    package = read_manifest(folder + "/" + tree + "/package.json")
                    if (not isinstance(package, dict) or package.get("name") != cid or
                            package.get("version") != entry.get("version")):
                        audit.fail(where, "unit package identity/version does not match catalog")
                except (ValueError, RuntimeError, OSError) as exc:
                    audit.fail(where, "cannot read unit package manifest: " + str(exc))
            sdk = manifest.get("sdk")
            if not isinstance(sdk, list) or not sdk or any(not isinstance(name, str) or not name for name in sdk):
                audit.fail(where, "unit source must declare its donor SDK require names")
            continue

        script = build.get("python", "")
        if not isinstance(script, str) or not script.endswith("/kit/tools/build.py"):
            continue
        shared = manifest.get("shared", [])
        if not isinstance(shared, list):
            audit.fail(where, "app.json shared must be a list")
            continue
        selected_shared = build.get("shared", [])
        if not isinstance(selected_shared, list) or any(not safe_path(p) for p in selected_shared):
            continue  # Invalid build.shared is reported by check_source.
        family = script[:-len("/kit/tools/build.py")]
        roots = [folder, script] + selected_shared
        for module in shared:
            shared_modules += 1
            if not safe_path(module) or "/" in module or not module.endswith(".js"):
                audit.fail(where, "invalid app.json shared module " + repr(module))
                continue
            original = family + "/shared/" + module
            if original not in files:
                audit.fail(where, "missing original shared module " + original)
            elif selected_shared and not any(
                    original == root or original.startswith(root.rstrip("/") + "/")
                    for root in roots):
                audit.fail(where, "build.shared omits required module " + original)
    audit.counts["app_manifests"] = manifests
    audit.counts["unit_modules"] = unit_modules
    audit.counts["shared_modules"] = shared_modules


def check_source(audit, manifest, files):
    if not isinstance(manifest, dict) or manifest.get("schema") != 1:
        audit.fail("mgu-repo.json", "expected schema 1")
        return {}
    entries = manifest.get("components")
    if not isinstance(entries, list):
        audit.fail("mgu-repo.json", "components must be a list")
        return {}
    result = {}
    for index, entry in enumerate(entries):
        where = "source/entry[" + str(index) + "]"
        if not isinstance(entry, dict):
            audit.fail(where, "not an object")
            continue
        cid, kind, version, folder = (entry.get("id"), entry.get("kind"),
                                      entry.get("version"), entry.get("path"))
        if not isinstance(cid, str) or not IDENTIFIER.fullmatch(cid):
            audit.fail(where, "invalid id")
            continue
        where = "source/" + cid
        if cid in result:
            audit.fail(where, "duplicate id")
            continue
        result[cid] = entry
        audit.require(kind in ("app", "tool"), where, "invalid kind")
        audit.require(version_tuple(version) is not None, where, "invalid version")
        if not audit.require(safe_path(folder), where, "unsafe or missing path"):
            continue
        audit.require(exists_in_tree(folder, files), where, "source folder absent from HEAD")
        build = entry.get("build")
        if isinstance(build, dict):
            if kind != "app":
                audit.fail(where, "tool cannot declare an app build script")
            scripts = [build.get("python"), build.get("node")]
            scripts = [s for s in scripts if s is not None]
            if len(scripts) != 1 or not safe_path(scripts[0]):
                audit.fail(where, "build must name exactly one safe python or node script")
                continue
            script = scripts[0]
            audit.require(script in files, where, "missing build script " + script)
            args = build.get("args", [])
            if not isinstance(args, list) or any(not isinstance(a, str) for a in args):
                audit.fail(where, "invalid build.args")
            if build.get("shared") is not None and (
                    not isinstance(build["shared"], list) or
                    any(not isinstance(x, str) for x in build["shared"])):
                audit.fail(where, "invalid build.shared")
            else:
                check_shared(audit, cid, build, files)
            sdk = build.get("sdk")
            if "/kit/tools/build.py" in script:
                family = script.split("/kit/tools/build.py", 1)[0]
                expected_sdk = family + "/oap-sdk"
                if sdk != expected_sdk:
                    audit.fail(where, "build.sdk " + repr(sdk) +
                               " does not match builder's " + expected_sdk)
            elif sdk is not None and not safe_path(sdk):
                audit.fail(where, "unsafe build.sdk")
            output = build.get("output")
            if output is not None:
                if not isinstance(output, str):
                    audit.fail(where, "build.output must be a string")
                else:
                    expanded = (output.replace("{id}", cid)
                                       .replace("{version}", str(version))
                                       .replace("{dir}", folder))
                    if "{" in expanded or "}" in expanded or not safe_path(expanded):
                        audit.fail(where, "invalid build.output template " + output)
            candidates = [folder + "/" + entry["manifest"]] if (
                isinstance(entry.get("manifest"), str) and
                safe_path(entry["manifest"])) else [folder + "/app.json",
                                                    folder + "/package.json"]
            audit.require(any(p in files for p in candidates), where,
                          "missing app.json/package.json for scripted build")
        elif build == "unit":
            audit.require(kind == "app", where, "build=unit is for apps only")
            audit.require(folder + "/mgu-app.json" in files, where,
                          "build=unit requires mgu-app.json")
        elif build is None:
            audit.require(kind == "tool", where, "app needs build script or build=unit")
            audit.require(folder + "/component.json" in files or
                          "service" in entry or "preload" in entry, where,
                          "tool has no component.json/service/preload")
        else:
            audit.fail(where, "invalid build declaration")
        check_requirements(audit, entry, "source")
        check_hmi(audit, entry, "source")
    audit.counts["source"] = len(result)
    return result


def check_release(audit, catalog):
    if not isinstance(catalog, dict) or catalog.get("schema") != 2:
        audit.fail("release/catalog.json", "expected schema 2")
        return {}
    entries = catalog.get("components")
    if not isinstance(entries, list):
        audit.fail("release/catalog.json", "components must be a list")
        return {}
    result = {}
    for index, item in enumerate(entries):
        where = "release/entry[" + str(index) + "]"
        if not isinstance(item, dict):
            audit.fail(where, "not an object")
            continue
        cid, version, kind = item.get("id"), item.get("version"), item.get("kind")
        if not isinstance(cid, str) or not IDENTIFIER.fullmatch(cid):
            audit.fail(where, "invalid id")
            continue
        where = "release/" + cid
        if cid in result:
            audit.fail(where, "duplicate id")
            continue
        result[cid] = item
        audit.require(kind in ("app", "tool"), where, "invalid kind")
        audit.require(version_tuple(version) is not None, where, "invalid version")
        artifact = item.get("artifact")
        if not isinstance(artifact, dict):
            audit.fail(where, "missing artifact object")
            continue
        if isinstance(version, str):
            audit.require(artifact.get("name") == cid + "@" + version + ".tgz",
                          where, "artifact name does not match Store catalog .tgz contract")
        size, digest, url = (artifact.get("size"), artifact.get("sha256"),
                             artifact.get("url"))
        audit.require(type(size) is int and size > 0, where, "artifact size not positive integer")
        audit.require(isinstance(digest, str) and bool(SHA256.fullmatch(digest)),
                      where, "artifact sha256 must be lowercase hex")
        audit.require(isinstance(url, str) and urlsplit(url).scheme == "https" and
                      bool(urlsplit(url).netloc) and not urlsplit(url).username,
                      where, "artifact URL is not HTTPS")
        if type(size) is int and size > MAX_MANAGER_PACKAGE:
            audit.warn(where, str(size) + " bytes exceeds Flutter manager's 200 MiB limit")
        check_requirements(audit, item, "release")
        check_hmi(audit, item, "release")
        if item.get("build") is not None and (item["build"] != "unit" or kind != "app"):
            audit.fail(where, "invalid release build=unit field")
    audit.counts["release"] = len(result)
    return result


def check_index(audit, sources, releases, components, provenance):
    known = {**sources, **releases}
    if set(sources) & set(releases):
        audit.fail("feeds", "component id duplicated across branch and release")
    if not isinstance(components, dict) or not isinstance(components.get("components"), list):
        audit.fail("data/components.json", "missing components array")
    else:
        meta = {}
        for item in components["components"]:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                audit.fail("data/components.json", "invalid component")
                continue
            if item["id"] in meta:
                audit.fail("data/components.json", "duplicate " + item["id"])
            meta[item["id"]] = item
        for cid in sorted(set(meta) ^ set(known)):
            audit.fail("data/components.json", "missing/mislisted " + cid)
        for cid in sorted(set(meta) & set(known)):
            if meta[cid].get("version") != known[cid].get("version"):
                audit.fail("data/components.json", cid + " version mismatch")
            if (meta[cid].get("requires") or {}) != (known[cid].get("requires") or {}):
                audit.fail("data/components.json", cid + " requirements mismatch")
            expected = meta[cid].get("supported_hmi")
            actual = known[cid].get("mguHmi")
            if expected is not None and actual is not None and expected != actual:
                audit.fail("data/components.json", cid + " mguHmi mismatch")
        audit.counts["metadata"] = len(meta)
    if not isinstance(provenance, list):
        audit.fail("data/catalog-provenance.json", "expected array")
        return
    records = {}
    for item in provenance:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            audit.fail("data/catalog-provenance.json", "invalid record")
            continue
        if item["id"] in records:
            audit.fail("data/catalog-provenance.json", "duplicate " + item["id"])
        records[item["id"]] = item
    for cid in sorted(set(records) ^ set(releases)):
        audit.fail("data/catalog-provenance.json", "missing/mislisted " + cid)
    for cid in sorted(set(records) & set(releases)):
        artifact = releases[cid].get("artifact", {})
        record = records[cid]
        for provenance_key, catalog_key in (("artifact_name", "name"),
                                            ("size", "size"), ("sha256", "sha256"),
                                            ("rehosted_url", "url")):
            if record.get(provenance_key) != artifact.get(catalog_key):
                audit.fail("data/catalog-provenance.json",
                           cid + " " + provenance_key + " mismatch")
        if (record.get("upstream_artifact_url") and
                record["upstream_artifact_url"] == record.get("rehosted_url")):
            audit.warn("data/catalog-provenance.json",
                       cid + " upstream URL repeats rehost URL; verify original publisher")
    audit.counts["provenance"] = len(records)
    for cid, item in known.items():
        for dep, minimum in (item.get("requires") or {}).items():
            provider = known.get(dep)
            if provider is None:
                audit.fail("requires/" + cid, dep + " is not in either feed")
            elif (version_tuple(provider.get("version")) is not None and
                  version_tuple(minimum) is not None and
                  version_tuple(provider["version"]) < version_tuple(minimum)):
                audit.fail("requires/" + cid, dep + " below " + minimum)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="HEAD", help="Existing local Git ref (never fetched)")
    parser.add_argument("--head-manifests", action="store_true",
                        help="Read JSON from the Git ref rather than any working-tree copies")
    parser.add_argument("--json", action="store_true", help="Machine-readable summary")
    args = parser.parse_args(argv)
    audit = Audit()
    try:
        files = paths_at(args.ref)
        source, catalog, components, provenance = [
            load_json(path, args.ref, args.head_manifests) for path in MANIFESTS
        ]
        store_sources = load_json(STORE_SOURCES, args.ref, args.head_manifests)
        check_store_sources(audit, store_sources)
        branch = check_source(audit, source, files)
        check_source_inputs(
            audit, branch, files,
            lambda path: load_json(path, args.ref, args.head_manifests),
        )
        release = check_release(audit, catalog)
        check_index(audit, branch, release, components, provenance)
    except (OSError, ValueError, RuntimeError) as exc:
        audit.fail("validator", str(exc))
    summary = {"status": "FAIL" if audit.errors else "PASS",
               "ref": args.ref, "headManifests": args.head_manifests,
               "counts": audit.counts, "errors": audit.errors, "warnings": audit.warnings}
    if args.json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
    else:
        print(summary["status"] + " Store feeds " +
              ", ".join(k + "=" + str(v) for k, v in audit.counts.items()))
        for error in audit.errors:
            print("ERROR " + error)
        for warning in audit.warnings:
            print("WARN  " + warning)
    return 1 if audit.errors else 0


if __name__ == "__main__":
    sys.exit(main())
