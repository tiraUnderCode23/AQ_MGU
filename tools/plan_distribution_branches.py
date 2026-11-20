"""Plan a pinned distribution; optionally materialize it in a NEW directory.

This tool reads Git objects only. It does not change refs or the working tree,
download artifacts, execute builders, install software, or publish anything.

Evidence schema 1:
  source_commit: full commit SHA
  variants: {source:ID@VERSION | release:ID@VERSION: {
    id, kind, version, channel, source_commit, hmi, status,
    evidence: [{path, sha256, commit, kind, detail}],
    requires: original manifest minimums,
    dependencies: {dependency_id: exact_variant_key},
    build_requires: {dependency_id: additional_minimum},
    extra_paths: [additional committed input paths],
    target_inputs: [{path, kind: "sdk", detail}]
  }}
  external_variants: {external:REPOSITORY:ID@VERSION: {
    ...same identity/evidence fields..., repository, upstream_commit,
    upstream_channel, requires, dependencies
  }}
  distributions: {NAME: {
    target_hmi: "ID8" | "ID7" | null,
    seeds: [exact variant keys],
    preserve_from: full historical commit SHA (required for games),
    historical_migrations: {historical_variant_key: {
      to: selected_variant_key, reason: nonempty reviewed migration explanation
    }},
    eligibility_policy: "strict" | "preservation",
    export_budget_bytes: reviewed integer byte budget (default 200 MiB; max 512 MiB)
  }}

"eligible_static" is a reviewed evidence classification, never a live test.
A target-specific distribution always requires eligible_static records.
Preservation mode requires no target HMI and retains unqualified records with
their original status; it cannot promote missing HMI into ID8 support.
Plan JSON is printed by default. To export, pass --materialize NEW_DIRECTORY
and --approved-plan-sha256 with the SHA shown in a previously reviewed plan.
Only the standard library is used.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from html import escape
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
from typing import Any
from urllib.parse import quote, urlsplit

MAX_FILES = 20_000
MAX_TOTAL_BYTES = 200 * 1024 * 1024
MAX_EXPORT_BYTES = 512 * 1024 * 1024
SIZE_ACCOUNTING_PASSES = 16
MAX_JSON_BYTES = 8 * 1024 * 1024
COMMIT_RE = re.compile(r"[0-9a-f]{40}")
SHA_RE = re.compile(r"[0-9a-f]{64}")
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")
VERSION_RE = re.compile(
    r"(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*)){0,3}"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?"
)
AQ_REPOSITORY = "tiraUnderCode23/AQ_MGU"
AQ_SOURCE_ID = "aq-mgu-apps"
AQ_CATALOG_ID = "aq-mgu-catalog"
RESERVED_OUTPUTS = {
    "mgu-repo.json", "release/catalog.json", "README.md",
    "data/app-images.json", "data/store-sources.json",
}


class PlanningError(ValueError):
    """The selected evidence or inputs cannot form a verified plan."""


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def checked_export_budget(value: Any) -> int:
    if type(value) is not int or not 0 < value <= MAX_EXPORT_BYTES:
        raise PlanningError(
            f"export_budget_bytes must be an integer from 1 to {MAX_EXPORT_BYTES} (512 MiB)"
        )
    return value


def readme_text(value: Any) -> str:
    """Render catalog prose as text, without accepting Markdown or HTML links."""
    text = escape(" ".join(str(value).split()), quote=False)
    for character, entity in (("\\", "&#92;"), ("|", "&#124;"), ("`", "&#96;"),
                              ("[", "&#91;"), ("]", "&#93;"), ("*", "&#42;"),
                              ("_", "&#95;"), ("#", "&#35;")):
        text = text.replace(character, entity)
    return text


def component_anchor(identifier: str) -> str:
    # Hex keeps anchors unique even for IDs differing only in case/punctuation.
    return "component-" + identifier.encode("utf-8").hex()


def checked_commit(value: Any, label: str = "commit") -> str:
    if not isinstance(value, str) or not COMMIT_RE.fullmatch(value):
        raise PlanningError(f"{label} must be a full lowercase 40-character commit SHA")
    return value


def checked_path(value: Any) -> str:
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise PlanningError(f"Not a repository-relative path: {value!r}")
    if value.startswith("/") or any(ord(char) < 32 for char in value):
        raise PlanningError(f"Unsafe input path: {value!r}")
    parts = value.rstrip("/").split("/")
    if any(part in ("", ".", "..") or part.lower() == ".git" for part in parts):
        raise PlanningError(f"Unsafe input path: {value!r}")
    if any(part.endswith((" ", ".")) for part in parts):
        raise PlanningError(f"Non-portable input path: {value!r}")
    for part in parts:
        stem = part.split(".", 1)[0].upper()
        if stem in {"CON", "PRN", "AUX", "NUL"} or re.fullmatch(r"(COM|LPT)[1-9]", stem):
            raise PlanningError(f"Non-portable input path: {value!r}")
    return "/".join(parts)


def checked_version(value: Any) -> str:
    if not isinstance(value, str) or not VERSION_RE.fullmatch(value):
        raise PlanningError(f"Unsupported version syntax: {value!r}")
    return value


def version_at_least(actual: str, minimum: str) -> bool:
    """Compare numeric dotted versions and SemVer-style prerelease suffixes."""
    def parts(value: str):
        base = checked_version(value).split("+", 1)[0]
        numeric, _, prerelease = base.partition("-")
        numbers = tuple(int(part) for part in numeric.split("."))
        return numbers + (0,) * (4 - len(numbers)), prerelease

    actual_numbers, actual_pre = parts(actual)
    minimum_numbers, minimum_pre = parts(minimum)
    if actual_numbers != minimum_numbers:
        return actual_numbers > minimum_numbers
    if not actual_pre or not minimum_pre:
        return not actual_pre or bool(minimum_pre)
    left, right = actual_pre.split("."), minimum_pre.split(".")
    for a, b in zip(left, right):
        if a == b:
            continue
        if a.isdecimal() and b.isdecimal():
            return int(a) > int(b)
        if a.isdecimal() != b.isdecimal():
            return not a.isdecimal()
        return a > b
    return len(left) >= len(right)


def requirement_map(value: Any, label: str) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise PlanningError(f"{label} must be a dependency-to-minimum mapping")
    result = {}
    for identifier, minimum in value.items():
        if not isinstance(identifier, str) or not ID_RE.fullmatch(identifier):
            raise PlanningError(f"Invalid dependency ID in {label}")
        result[identifier] = checked_version(minimum)
    return result


def parse_json(raw: bytes, label: str) -> Any:
    if len(raw) > MAX_JSON_BYTES:
        raise PlanningError(f"{label} exceeds the JSON input limit")
    def no_duplicates(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise PlanningError(f"Duplicate JSON key {key!r} in {label}")
            value[key] = item
        return value
    try:
        return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=no_duplicates)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise PlanningError(f"Invalid JSON in {label}: {error}") from error


@dataclass(frozen=True)
class Blob:
    path: str
    oid: str
    mode: str
    size: int


class GitSnapshot:
    """Immutable object reads. Even a partial clone is not allowed to fetch."""

    def __init__(self, repository: Path, commit: str):
        self.repository = repository.resolve(strict=True)
        self.commit = checked_commit(commit)
        root = self._git("rev-parse", "--show-toplevel").decode("utf-8").strip()
        self.repository = Path(root).resolve(strict=True)
        resolved = self._git("rev-parse", "--verify", self.commit + "^{commit}").decode("ascii").strip()
        if resolved != self.commit:
            raise PlanningError("Pinned commit did not resolve exactly")
        raw_tree = self._git("ls-tree", "-r", "-l", "-z", self.commit)
        self.files: dict[str, Blob] = {}
        folded = {}
        for row in raw_tree.split(b"\0"):
            if not row:
                continue
            header, raw_path = row.split(b"\t", 1)
            mode, kind, oid, size = header.decode("ascii").split()
            path = raw_path.decode("utf-8")
            # Unselected links/submodules are inventory, never materialized.
            blob_size = int(size) if size != "-" else 0
            self.files[path] = Blob(path, oid, mode, blob_size)
            if path.casefold() in folded and folded[path.casefold()] != path:
                # Reject only if both are selected, in PlanBuilder.add_path.
                continue
            folded[path.casefold()] = path

    def _git(self, *arguments: str) -> bytes:
        environment = dict(os.environ)
        environment["GIT_OPTIONAL_LOCKS"] = "0"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["GIT_NO_LAZY_FETCH"] = "1"
        command = [
            "git", "--no-optional-locks", "-C", str(self.repository),
            "-c", "protocol.allow=never", *arguments,
        ]
        completed = subprocess.run(
            command, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=environment,
        )
        if completed.returncode:
            reason = completed.stderr.decode("utf-8", errors="replace").strip()
            raise PlanningError(f"Read-only Git operation failed: {reason}")
        return completed.stdout

    def read(self, path: str) -> bytes:
        checked_path(path)
        blob = self.files.get(path)
        if blob is None or blob.mode not in {"100644", "100755"}:
            raise PlanningError(f"Missing/non-regular committed input: {path}")
        if blob.size > MAX_EXPORT_BYTES:
            raise PlanningError(f"Committed input exceeds the byte limit: {path}")
        data = self._git("cat-file", "blob", blob.oid)
        if len(data) != blob.size:
            raise PlanningError(f"Committed input length changed: {path}")
        return data

    def at(self, commit: str):
        return GitSnapshot(self.repository, commit)


def manifest_variants(snapshot):
    variants, manifests = {}, {}
    for channel, path in (("source", "mgu-repo.json"), ("release", "release/catalog.json")):
        raw = snapshot.read(path)
        manifest = parse_json(raw, path)
        if not isinstance(manifest, dict) or not isinstance(manifest.get("components"), list):
            raise PlanningError(f"{path} must contain a components list")
        manifests[channel] = (path, raw, manifest)
        ids = set()
        for component in manifest["components"]:
            if not isinstance(component, dict):
                raise PlanningError(f"Invalid component in {path}")
            identifier, kind = component.get("id"), component.get("kind")
            version = checked_version(component.get("version"))
            if not isinstance(identifier, str) or not ID_RE.fullmatch(identifier) or kind not in {"app", "tool"}:
                raise PlanningError(f"Invalid component identity in {path}")
            if identifier in ids:
                raise PlanningError(f"Conflicting same-ID {channel} variant: {identifier}")
            ids.add(identifier)
            key = f"{channel}:{identifier}@{version}"
            variants[key] = (channel, component)
    return variants, manifests


class PlanBuilder:
    def __init__(self, snapshot, evidence: dict, distribution: str):
        self.snapshot = snapshot
        self.evidence = evidence
        self.name = distribution
        if evidence.get("schema") != 1 or evidence.get("source_commit") != snapshot.commit:
            raise PlanningError("Evidence must name the exact pinned canonical commit")
        distributions = evidence.get("distributions")
        if not isinstance(distributions, dict) or not isinstance(distributions.get(distribution), dict):
            raise PlanningError(f"Missing distribution evidence: {distribution}")
        self.configuration = distributions[distribution]
        self.export_budget_bytes = checked_export_budget(
            self.configuration.get("export_budget_bytes", MAX_TOTAL_BYTES)
        )
        self.target_hmi = self.configuration.get("target_hmi")
        if self.target_hmi not in (None, "ID7", "ID8"):
            raise PlanningError("target_hmi must be ID7, ID8, or null")
        if distribution.lower() == "id8" and self.target_hmi != "ID8":
            raise PlanningError("The id8 distribution must explicitly target ID8")
        self.policy = self.configuration.get("eligibility_policy", "strict")
        if self.policy not in {"strict", "preservation"}:
            raise PlanningError("Unknown eligibility policy")
        if self.target_hmi is not None and self.policy != "strict":
            raise PlanningError("A target-specific distribution cannot use preservation eligibility")
        self.variants, self.manifests = manifest_variants(snapshot)
        self.records = evidence.get("variants", {})
        self.externals = evidence.get("external_variants", {})
        if not isinstance(self.records, dict) or not isinstance(self.externals, dict):
            raise PlanningError("Evidence variants must be mappings")
        self.files: dict[str, dict] = {}
        self.case_paths = {}
        self.checked_records = {}
        self.order: list[str] = []
        self.visiting = set()
        self.done = set()
        self.target_inputs = []
        self.external_media = []
        self.warnings = []

    def add_path(self, relative: str, owner: str, reason: str):
        relative = checked_path(relative)
        paths = [path for path in self.snapshot.files if path == relative or path.startswith(relative + "/")]
        if not paths:
            raise PlanningError(f"Missing committed input for {owner}: {relative}")
        for path in sorted(paths):
            checked_path(path)
            if path.startswith(".distribution/"):
                raise PlanningError("Source inputs cannot occupy the receipt namespace")
            blob = self.snapshot.files[path]
            if blob.mode not in {"100644", "100755"}:
                raise PlanningError(f"Links/submodules are not exportable inputs: {path}")
            destination = ".distribution/original/" + path if path in RESERVED_OUTPUTS else path
            folded = destination.casefold()
            previous = self.case_paths.get(folded)
            if previous is not None and previous != destination:
                raise PlanningError(f"Case-colliding output paths: {previous}, {destination}")
            self.case_paths[folded] = destination
            record = self.files.setdefault(destination, {
                "path": destination, "source_path": path, "oid": blob.oid,
                "mode": blob.mode, "size": blob.size, "owners": [], "reasons": [],
            })
            if owner not in record["owners"]:
                record["owners"].append(owner)
            if reason not in record["reasons"]:
                record["reasons"].append(reason)
        if len(self.files) > MAX_FILES:
            raise PlanningError("Selected inputs exceed the file-count budget")
        if sum(item["size"] for item in self.files.values()) > self.export_budget_bytes:
            raise PlanningError(
                f"Selected inputs exceed the reviewed export byte budget ({self.export_budget_bytes} bytes)"
            )

    def citations(self, key: str, record: dict):
        citations = record.get("evidence")
        if not isinstance(citations, list) or not citations:
            raise PlanningError(f"Missing pinned eligibility evidence for {key}")
        substantive = False
        for citation in citations:
            if not isinstance(citation, dict) or citation.get("commit") != self.snapshot.commit:
                raise PlanningError(f"Evidence citation has a different commit for {key}")
            path = checked_path(citation.get("path"))
            expected = citation.get("sha256")
            if not isinstance(expected, str) or not SHA_RE.fullmatch(expected):
                raise PlanningError(f"Missing exact evidence SHA-256 for {key}")
            if sha256(self.snapshot.read(path)) != expected:
                raise PlanningError(f"Evidence SHA-256 mismatch for {key}: {path}")
            kind = citation.get("kind", "")
            if not isinstance(kind, str) or not kind or not isinstance(citation.get("detail"), str):
                raise PlanningError(f"Evidence kind/detail is required for {key}")
            if kind.lower() not in {"declaration", "declared_hmi", "catalog", "metadata", "mgu_hmi"}:
                substantive = True
            self.add_path(path, key, "pinned eligibility evidence")
        if self.policy == "strict" and not substantive:
            raise PlanningError(f"Declaration-only evidence cannot establish eligibility for {key}")

    def record(self, key: str):
        if key in self.checked_records:
            return self.checked_records[key]
        if key in self.variants:
            channel, component = self.variants[key]
            record = self.records.get(key)
        else:
            component = None
            channel = "external"
            record = self.externals.get(key, self.records.get(key) if key.startswith("external:") else None)
        if not isinstance(record, dict):
            raise PlanningError(f"Missing explicit variant evidence: {key}")
        identifier, kind, version = record.get("id"), record.get("kind"), record.get("version")
        if not isinstance(identifier, str) or not ID_RE.fullmatch(identifier) or kind not in {"app", "tool"}:
            raise PlanningError(f"Invalid evidence identity for {key}")
        checked_version(version)
        if record.get("source_commit") != self.snapshot.commit:
            raise PlanningError(f"Stale variant evidence for {key}")
        if channel != "external":
            if (identifier, kind, version, record.get("channel")) != (
                component["id"], component["kind"], component["version"], channel
            ):
                raise PlanningError(f"Evidence identity/channel mismatch for {key}")
            if requirement_map(record.get("requires"), key) != requirement_map(component.get("requires"), key):
                raise PlanningError(f"Evidence drops or changes declared requirements for {key}")
            if self.target_hmi is not None and self.target_hmi not in (component.get("mguHmi") or []):
                raise PlanningError(f"Canonical manifest does not permit {self.target_hmi} for {key}")
        else:
            if record.get("channel") != "external" or not key.endswith(f":{identifier}@{version}"):
                raise PlanningError(f"External variant key/channel mismatch for {key}")
            repository = record.get("repository")
            if not isinstance(repository, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
                raise PlanningError(f"Missing external repository for {key}")
            checked_commit(record.get("upstream_commit"), "external upstream_commit")
            if not isinstance(record.get("upstream_channel"), str) or not record["upstream_channel"]:
                raise PlanningError(f"Missing external upstream_channel for {key}")
        status = record.get("status")
        if self.policy == "strict" and status != "eligible_static":
            raise PlanningError(f"Variant is not statically eligible: {key} ({status})")
        if self.policy == "preservation" and status not in {
            "eligible_static", "declared_only", "unknown", "incompatible", "dependency_blocked",
        }:
            raise PlanningError(f"Conflicting/unclassified preservation variant: {key}")
        hmi = record.get("hmi")
        if not isinstance(hmi, list) or any(value not in {"ID7", "ID8"} for value in hmi):
            raise PlanningError(f"Invalid HMI evidence for {key}")
        if self.target_hmi is not None and self.target_hmi not in hmi:
            raise PlanningError(f"{key} lacks compatible {self.target_hmi} evidence")
        if self.policy == "preservation" and status != "eligible_static":
            self.warnings.append(f"{key}: preserved as {status}; HMI/runtime qualification is not implied")
        self.citations(key, record)
        self.checked_records[key] = (channel, component, record)
        return self.checked_records[key]

    def visit(self, key: str):
        if key in self.done:
            return
        if key in self.visiting:
            raise PlanningError(f"Dependency cycle at {key}")
        self.visiting.add(key)
        channel, component, record = self.record(key)
        requirements = requirement_map(record.get("requires"), key)
        build_requirements = requirement_map(record.get("build_requires"), key + " build_requires")
        for identifier, minimum in build_requirements.items():
            if identifier not in requirements or version_at_least(minimum, requirements[identifier]):
                requirements[identifier] = minimum
        if channel == "source" and isinstance(component.get("build"), dict) and component["build"].get("python"):
            if "mgu-python" not in build_requirements:
                raise PlanningError(f"Python builder requires an explicit mgu-python build prerequisite: {key}")
            if not version_at_least(build_requirements["mgu-python"], "1.0.2"):
                raise PlanningError(f"Python builder requires mgu-python >=1.0.2: {key}")
        if channel == "source" and isinstance(component.get("build"), dict) and component["build"].get("sdk"):
            if "mgu-deploy" not in requirements:
                raise PlanningError(f"SDK builder requires an explicit mgu-deploy prerequisite: {key}")
        bindings = record.get("dependencies", {})
        if not isinstance(bindings, dict):
            raise PlanningError(f"Dependency bindings must be a mapping for {key}")
        for identifier, minimum in requirements.items():
            dependency_key = bindings.get(identifier)
            if not isinstance(dependency_key, str):
                raise PlanningError(f"Unresolved dependency {identifier}>={minimum} for {key}")
            _, _, dependency = self.record(dependency_key)
            if dependency["id"] != identifier or dependency["kind"] != "tool":
                raise PlanningError(f"Wrong dependency identity for {key}: {identifier}")
            if not version_at_least(dependency["version"], minimum):
                raise PlanningError(f"Dependency {identifier} does not satisfy {minimum} for {key}")
            if self.policy == "strict":
                demanded_hmi = {self.target_hmi} if self.target_hmi else set(record["hmi"])
                if not demanded_hmi or not demanded_hmi.issubset(set(dependency["hmi"])):
                    raise PlanningError(f"Dependency HMI evidence is incomplete for {key}: {identifier}")
            self.visit(dependency_key)
        for identifier, dependency_key in bindings.items():
            if identifier in requirements:
                continue
            _, _, dependency = self.record(dependency_key)
            if dependency["id"] != identifier or dependency["kind"] != "tool":
                raise PlanningError(f"Wrong explicitly retained helper for {key}: {identifier}")
            self.visit(dependency_key)
        self.visiting.remove(key)
        self.done.add(key)
        self.order.append(key)

    def notice_inputs(self, roots: list[str], key: str):
        directories = {""}
        for root in roots:
            root_path = PurePosixPath(root)
            start = root_path.parent if root in self.snapshot.files else root_path
            directories.add(str(start) if str(start) != "." else "")
            for parent in start.parents:
                directories.add(str(parent) if str(parent) != "." else "")
        for directory in directories:
            prefix = directory + "/" if directory else ""
            for path in self.snapshot.files:
                if not path.startswith(prefix):
                    continue
                name = path[len(prefix):]
                if "/" in name:
                    continue
                upper = name.upper()
                if re.match(r"^(LICENSE|LICENCE|COPYING|NOTICE|THIRD[-_]PARTY|README)([._-]|$)", upper):
                    self.add_path(path, key, "ancestor documentation/license")
        if any(path.startswith("LICENSES/") for path in self.snapshot.files):
            self.add_path("LICENSES", key, "repository license notices")

    def source_inputs(self, key: str, component: dict, record: dict):
        path = checked_path(component.get("path"))
        roots = [path]
        build = component.get("build")
        if build not in (None, "unit") and not isinstance(build, dict):
            raise PlanningError(f"Unsupported source build description for {key}")
        if isinstance(build, dict):
            scripts = [build.get(name) for name in ("python", "node") if build.get(name)]
            if len(scripts) != 1:
                raise PlanningError(f"A scripted source needs exactly one declared builder: {key}")
            if not isinstance(build.get("shared"), list):
                raise PlanningError(f"Missing explicit build.shared; whole-repository fallback refused: {key}")
            roots.extend(checked_path(item) for item in scripts + build["shared"])
            sdk = build.get("sdk")
            if sdk:
                sdk = checked_path(sdk)
                if any(item == sdk or item.startswith(sdk + "/") for item in self.snapshot.files):
                    roots.append(sdk)
                else:
                    targets = record.get("target_inputs", [])
                    matching = [
                        item for item in targets if isinstance(item, dict)
                        and item.get("path") == sdk and item.get("kind") == "sdk"
                        and isinstance(item.get("detail"), str) and item["detail"].strip()
                    ]
                    if len(matching) != 1:
                        raise PlanningError(f"SDK input is neither committed nor explicitly target-supplied: {key}")
                    self.target_inputs.append({"variant": key, **matching[0]})
            script = scripts[0]
            if script.endswith("/kit/tools/build.py"):
                manifest_path = path + "/" + component.get("manifest", "app.json")
                manifest = parse_json(self.snapshot.read(checked_path(manifest_path)), manifest_path)
                family = script[:-len("/kit/tools/build.py")]
                for module in manifest.get("shared", []):
                    module_path = checked_path(family + "/shared/" + checked_path(module))
                    if not any(module_path == root or module_path.startswith(root.rstrip("/") + "/") for root in roots):
                        raise PlanningError(f"Declared shared module is omitted by build.shared: {module_path}")
                    self.add_path(module_path, key, "declared app shared module")
        extras = record.get("extra_paths", [])
        if not isinstance(extras, list):
            raise PlanningError(f"extra_paths must be a list for {key}")
        roots.extend(checked_path(item) for item in extras)
        for root in roots:
            self.add_path(root, key, "declared component/build input")
        self.notice_inputs(roots, key)

    def release_inputs(self, key: str, component: dict, record: dict):
        artifact = component.get("artifact")
        if not isinstance(artifact, dict):
            raise PlanningError(f"Missing released artifact identity for {key}")
        size = artifact.get("size")
        if type(size) is not int or size <= 0 or not SHA_RE.fullmatch(str(artifact.get("sha256", ""))):
            raise PlanningError(f"Released artifact lacks exact size/SHA-256: {key}")
        address = urlsplit(str(artifact.get("url", "")))
        if address.scheme != "https" or not address.hostname or address.username or address.password or address.fragment:
            raise PlanningError(f"Invalid released artifact URL for {key}")
        for path in record.get("extra_paths", []):
            self.add_path(path, key, "declared release documentation/license")
        self.notice_inputs(record.get("extra_paths", []), key)

    def documentation_metadata(self):
        path = "data/components.json"
        if path not in self.snapshot.files:
            return {}
        document = parse_json(self.snapshot.read(path), path)
        if not isinstance(document, dict) or not isinstance(document.get("components"), list):
            raise PlanningError("Documentation component metadata must contain a components list")
        selected = {}
        for key in self.order:
            channel, component, record = self.checked_records[key]
            candidates = [row for row in document["components"] if isinstance(row, dict)
                          and (row.get("id"), row.get("kind"), row.get("version"))
                          == (record["id"], record["kind"], record["version"])]
            if channel == "source":
                candidates = [row for row in candidates if row.get("source_path") == component["path"]]
            elif channel == "release":
                candidates = [row for row in candidates if isinstance(row.get("artifact"), dict)
                              and row["artifact"].get("sha256") == component["artifact"]["sha256"]]
            else:
                candidates = [row for row in candidates if row.get("source_repository") == record["repository"]]
            if len(candidates) > 1:
                raise PlanningError(f"Ambiguous documentation metadata for {key}")
            if candidates:
                selected[key] = candidates[0]
        if selected:
            self.add_path(path, "distribution", "pinned original documentation index")
        return selected

    def reference_url(self, value: str, owner: str, *, document: bool = False, component_path: str | None = None):
        if not isinstance(value, str) or not value or "\\" in value or any(ord(char) < 32 for char in value):
            raise PlanningError(f"Invalid documentation/media reference for {owner}")
        try:
            address = urlsplit(value)
            if address.scheme or address.netloc:
                if address.scheme != "https" or not address.hostname or address.username or address.password:
                    raise PlanningError(f"Unsupported documentation/media URL for {owner}")
                address.port  # Reject malformed ports before emitting a clickable URL.
                return quote(value, safe=":/?&=#%._~+-")
        except ValueError as error:
            raise PlanningError(f"Invalid documentation/media URL for {owner}") from error
        fragment = ""
        path = value
        if document and value not in self.snapshot.files:
            if address.query:
                raise PlanningError(f"Local documentation cannot contain a query for {owner}")
            path = address.path
            fragment = "#" + quote(address.fragment, safe="-._~") if address.fragment else ""
        if component_path and path not in self.snapshot.files:
            path = component_path.rstrip("/") + "/" + path
        path = checked_path(path)
        if path not in self.snapshot.files:
            raise PlanningError(f"Missing committed documentation/media file for {owner}: {path}")
        self.add_path(path, owner, "original README/install documentation" if document else "all declared local media")
        if document:
            self.notice_inputs([path], owner)
        destination = ".distribution/original/" + path if path in RESERVED_OUTPUTS else path
        return quote(destination, safe="/") + fragment

    def store_source_configuration(self, external_records: dict):
        """Retarget the two explicit AQ feeds while retaining original companions."""
        path = "data/store-sources.json"
        if path not in self.snapshot.files:
            return None, None
        raw = self.snapshot.read(path)
        document = parse_json(raw, path)
        if (not isinstance(document, dict) or type(document.get("schema")) is not int
                or document["schema"] != 1 or not isinstance(document.get("sources"), list)):
            raise PlanningError("Store source configuration must use schema 1 and a sources list")
        sources = document["sources"]
        if any(not isinstance(row, dict) or not isinstance(row.get("id"), str)
               or not ID_RE.fullmatch(row["id"]) for row in sources):
            raise PlanningError("Every configured Store source needs a valid explicit ID")
        by_id = {row["id"]: row for row in sources}
        if len(by_id) != len(sources):
            raise PlanningError("Duplicate configured Store source IDs")
        source, catalog = by_id.get(AQ_SOURCE_ID), by_id.get(AQ_CATALOG_ID)
        if source is None or catalog is None:
            raise PlanningError("Both explicit AQ source and release catalog entries are required")
        if source.get("type") != "github" or source.get("repo") != AQ_REPOSITORY:
            raise PlanningError("Configured AQ source repository identity does not match the pinned AQ repository")
        channel = source.get("channel")
        if not isinstance(channel, str) or not channel.startswith("branch:"):
            raise PlanningError("The AQ source must name its explicit GitHub branch")
        old_branch = channel[len("branch:"):]
        for branch in (old_branch, self.name):
            if (not ID_RE.fullmatch(branch) or ".." in branch or branch.endswith((".", ".lock"))
                    or branch == "HEAD"):
                raise PlanningError("Store source retargeting requires an unambiguous branch name")
        expected_url = f"https://raw.githubusercontent.com/{AQ_REPOSITORY}/{old_branch}/release/catalog.json"
        if catalog.get("type") != "https" or catalog.get("url") != expected_url:
            raise PlanningError("AQ release catalog URL must match the AQ repository and original source branch")
        for row in sources:
            if row["id"] == AQ_SOURCE_ID or row["id"] == AQ_CATALOG_ID:
                continue
            if row.get("type") == "github" and str(row.get("repo", "")).casefold() == AQ_REPOSITORY.casefold():
                raise PlanningError("Ambiguous additional AQ GitHub source in Store configuration")
            value = row.get("url")
            if isinstance(value, str):
                try:
                    address = urlsplit(value)
                except ValueError as error:
                    raise PlanningError("Invalid configured Store source URL") from error
                parts = address.path.strip("/").split("/")
                if (address.hostname == "raw.githubusercontent.com" and len(parts) >= 2
                        and "/".join(parts[:2]).casefold() == AQ_REPOSITORY.casefold()
                        and parts[-2:] == ["release", "catalog.json"]):
                    raise PlanningError("Ambiguous additional AQ release catalog in Store configuration")
        for record in external_records.values():
            matches = [row for row in sources if row.get("type") == "github"
                       and row.get("repo") == record["repository"]
                       and row.get("channel") == record["upstream_channel"]]
            if len(matches) != 1:
                raise PlanningError(f"Missing or ambiguous configured external source for {record['repository']} ({record['upstream_channel']})")
        generated = dict(document)
        generated["sources"] = [dict(row) for row in sources]
        for row in generated["sources"]:
            if row["id"] == AQ_SOURCE_ID:
                row["channel"] = "branch:" + self.name
            elif row["id"] == AQ_CATALOG_ID:
                row["url"] = f"https://raw.githubusercontent.com/{AQ_REPOSITORY}/{self.name}/release/catalog.json"
        self.add_path(path, "distribution", "original Store source configuration")
        proof = {
            "path": path, "original_path": ".distribution/original/" + path,
            "source_commit": self.snapshot.commit, "repository": AQ_REPOSITORY,
            "original_channel": channel, "distribution_channel": "branch:" + self.name,
            "original_sha256": sha256(raw), "generated_sha256": sha256(json_bytes(generated)),
            "external_sources_preserved": True,
        }
        return generated, proof

    def render_readme(self, images: dict, metadata: dict, external_records: dict, store_config: dict | None):
        ordered = sorted(self.order, key=lambda key: self.checked_records[key][2]["id"])
        readmes = {}
        for key in ordered:
            _, component, _ = self.checked_records[key]
            reference = (component or {}).get("upstream_readme") or metadata.get(key, {}).get("upstream_readme")
            if reference:
                readmes[key] = self.reference_url(reference, key, document=True)
            else:
                candidates = [item for item in self.files.values() if key in item["owners"]
                              and PurePosixPath(item["source_path"]).name.lower().startswith("readme")]
                if candidates:
                    parents = ([component["path"], *map(str, PurePosixPath(component["path"]).parents)]
                               if component is not None and component.get("path") else ["."])
                    def readme_rank(item):
                        parent = str(PurePosixPath(item["source_path"]).parent)
                        return (parents.index(parent) if parent in parents else len(parents), item["source_path"])
                    item = sorted(candidates, key=readme_rank)[0]
                    readmes[key] = quote(item["path"], safe="/")
        original_readme = None
        if "README.md" in self.snapshot.files:
            original_readme = self.reference_url("README.md", "distribution", document=True)
        lines = [
            f"# {readme_text(self.name)} distribution", "",
            f"Canonical source commit: `{self.snapshot.commit}`",
            f"Target HMI: {self.target_hmi or 'mixed / preservation; see each record'}",
            f"Eligibility policy: {self.policy}", "",
            "The file export copies selected committed files and validates their static",
            "identities, dependencies, and file checksums. It does not build packages,",
            "execute target code, download artifacts, or install software.", "",
            "Runtime / physical installation: **NOT OBSERVED**. HMI labels and screenshots",
            "describe the reviewed source metadata; they are not proof of an installed result.", "",
            "[Applications](#applications) · [Helper tools](#helper-tools) · [Sources and installation](#sources-and-installation)", "",
            "## Sources and installation", "",
            "| Channel | Applications | Helper tools | Delivery |",
            "|---|---:|---:|---|",
        ]
        deliveries = {
            "source": "[Source recipes](mgu-repo.json); selected source files are included.",
            "release": "[Publisher artifact references](release/catalog.json); artifact payloads are not downloaded by this export.",
            "external": "[Pinned original sources](.distribution/external-dependencies.json); retain their configured origin and channel.",
        }
        for channel in ("source", "release", "external"):
            records = [self.checked_records[key][2] for key in ordered if self.checked_records[key][0] == channel]
            lines.append(f"| {channel} | {sum(row['kind'] == 'app' for row in records)} | {sum(row['kind'] == 'tool' for row in records)} | {deliveries[channel]} |")
        if store_config is not None:
            lines.extend([
                "", "### Add this distribution to MGU Store", "",
                "Configure **both AQ entries** below: the GitHub branch supplies source recipes,",
                "and the HTTPS catalog supplies the selected released apps and helpers.",
                "Keep the companion-source entries so their original external tools remain available.", "",
                "[Exact Store source configuration](data/store-sources.json)", "",
                "```json", json_bytes(store_config).decode("utf-8").rstrip("\n"), "```",
            ])
        else:
            lines.extend([
                "", "### Store configuration required", "",
                "Store source configuration was not provided in the pinned snapshot; no repository URL was inferred.",
                "Before use, configure both the published GitHub branch source and its HTTPS",
                "`release/catalog.json` feed, plus every original external source listed below.",
                "The source branch alone does not provide the released helpers.",
            ])
        lines.extend(["", "Use each entry's original README for its installation procedure and prerequisites."])
        if original_readme:
            lines.append(f"[Preserved original repository README]({original_readme})")
        if external_records:
            lines.extend(["", "External dependencies retain their original repository, channel, and commit below.",
                          "Their payloads are not bundled or automatically downloaded."])
        if self.target_inputs:
            lines.extend(["", "Target-derived SDK inputs remain external build requirements;",
                          "they were not read, extracted, or included here."])
        if self.external_media:
            lines.extend(["", "HTTPS media are external references and were not downloaded or verified by this export."])

        def dependency_links(requirements, record):
            rendered = []
            for identifier, minimum in sorted(requirements.items()):
                dependency_key = record["dependencies"][identifier]
                dependency = self.checked_records[dependency_key][2]
                label = f"{identifier} >={minimum} (selected {dependency['version']}; {self.checked_records[dependency_key][0]})"
                rendered.append(f"[{readme_text(label)}](#{component_anchor(identifier)})")
            return "; ".join(rendered) or "None declared."

        for kind, heading in (("app", "Applications"), ("tool", "Helper tools")):
            keys = [key for key in ordered if self.checked_records[key][2]["kind"] == kind]
            lines.extend(["", f"## {heading}", "", f"{len(keys)} selected {kind} entries."])
            for key in keys:
                channel, component, record = self.checked_records[key]
                row = component or record
                details = metadata.get(key, {})
                title = row.get("title") or details.get("title") or record["id"]
                description = row.get("description") or details.get("description")
                lines.extend(["", f'<a id="{component_anchor(record["id"])}"></a>', "",
                              f"### {readme_text(title)}", "",
                              f"`{record['id']}@{record['version']}` · **{channel}** · {kind}", ""])
                info = images.get(record["id"], {})
                icon = info.get("icon")
                if icon:
                    url = self.reference_url(icon, record["id"])
                    lines.extend([f'<img src="{escape(url, quote=True)}" width="64" height="64" alt="{escape(str(title), quote=True)} icon" />', ""])
                if description:
                    lines.extend([readme_text(description), ""])
                lines.extend([
                    f"Declared evidence HMI: {', '.join(record['hmi']) or 'unknown'} · Review: `{record['status']}`.", "",
                    "Runtime dependencies: " + dependency_links(requirement_map(record.get("requires"), key), record),
                ])
                build_requires = requirement_map(record.get("build_requires"), key + " build_requires")
                if build_requires:
                    lines.append("Build prerequisites: " + dependency_links(build_requires, record))
                consumers = [self.checked_records[consumer][2]["id"] for consumer in ordered
                             if key in self.checked_records[consumer][2].get("dependencies", {}).values()]
                if consumers:
                    lines.append("Required or retained by: " + "; ".join(
                        f"[{readme_text(identifier)}](#{component_anchor(identifier)})" for identifier in consumers))
                elif kind == "tool":
                    lines.append("Retained as an explicitly selected helper.")
                links = []
                if key in readmes:
                    links.append(f"[Original README / installation]({readmes[key]})")
                if channel == "source":
                    links.append(f"[Source directory]({quote(component['path'], safe='/')})")
                elif channel == "release":
                    url = self.reference_url(component["artifact"]["url"], key)
                    links.append(f"[Original publisher artifact]({url})")
                    lines.extend(["", f"Publisher artifact: {component['artifact']['size']:,} bytes; SHA-256 `{component['artifact']['sha256']}`."])
                else:
                    url = "https://github.com/" + record["repository"] + "/tree/" + record["upstream_commit"]
                    links.append(f"[Original repository]({self.reference_url(url, key)})")
                    lines.extend(["", f"Original source: {readme_text(record['repository'])} · {readme_text(record['upstream_channel'])} · `{record['upstream_commit']}`."])
                if links:
                    lines.extend(["", " · ".join(links)])
                screenshots = info.get("images", [])
                if screenshots:
                    lines.extend(["", "#### Declared screenshots", "", "<p>"])
                    for index, screenshot in enumerate(screenshots, 1):
                        url = escape(self.reference_url(screenshot, record["id"]), quote=True)
                        alt = escape(f"{title} screenshot {index}", quote=True)
                        lines.append(f'<a href="{url}"><img src="{url}" height="180" alt="{alt}" /></a>')
                    lines.append("</p>")
        return "\n".join(lines) + "\n"

    @staticmethod
    def variant_identity(snapshot, key: str, channel: str, component: dict | None, record: dict | None = None):
        """Bind a catalog identity to its declared bytes without running a recipe."""
        row = component if component is not None else record
        identity = {
            "key": key, "channel": channel, "id": row["id"],
            "kind": row["kind"], "version": row["version"],
            "source_commit": snapshot.commit,
        }
        if component is None:
            identity["external_origin"] = {
                field: record[field] for field in ("repository", "upstream_commit", "upstream_channel")
            }
            return identity
        identity["component"] = component
        identity["component_sha256"] = sha256(json_bytes(component))
        if channel == "source":
            roots = [checked_path(component.get("path"))]
            build = component.get("build")
            if isinstance(build, dict):
                scripts = [build[name] for name in ("python", "node") if build.get(name)]
                roots.extend(checked_path(path) for path in scripts)
                shared = build.get("shared")
                if isinstance(shared, list):
                    roots.extend(checked_path(path) for path in shared)
                elif scripts:
                    # An old recipe without an explicit subset consumed the repository.
                    roots = [""]
            inputs = [
                {"path": path, "oid": blob.oid, "mode": blob.mode, "size": blob.size}
                for path, blob in sorted(snapshot.files.items())
                if any(not root or path == root or path.startswith(root + "/") for root in roots)
            ]
            identity["declared_inputs_sha256"] = sha256(json_bytes(inputs))
            identity["declared_input_count"] = len(inputs)
        return identity

    def preserve_historical_inventory(self, selected_by_id: dict[str, str]):
        baseline = self.configuration.get("preserve_from")
        if self.name == "games" and not baseline:
            raise PlanningError("Games requires preserve_from: an explicit pinned historical inventory")
        if not baseline:
            return None
        checked_commit(baseline, "preserve_from")
        old_snapshot = self.snapshot.at(baseline)
        old_variants, old_manifests = manifest_variants(old_snapshot)
        old_ids = {component["id"] for _, component in old_variants.values()}
        selected_ids = set(selected_by_id)
        missing = sorted(old_ids - selected_ids)
        if missing:
            raise PlanningError("Historical applications/helpers would be dropped: " + ", ".join(missing))
        migrations = self.configuration.get("historical_migrations", {})
        if not isinstance(migrations, dict) or any(key not in old_variants for key in migrations):
            raise PlanningError("Historical migrations must name exact historical variant keys")
        retained = {}
        for old_key, (old_channel, old_component) in sorted(old_variants.items()):
            selected_key = selected_by_id[old_component["id"]]
            channel, component, record = self.checked_records[selected_key]
            if old_component["kind"] != record["kind"]:
                raise PlanningError(f"Historical kind changed for {old_key}: {record['kind']}")
            historical = self.variant_identity(old_snapshot, old_key, old_channel, old_component)
            selected = self.variant_identity(self.snapshot, selected_key, channel, component, record)
            historical_content = {key: value for key, value in historical.items() if key != "source_commit"}
            selected_content = {key: value for key, value in selected.items() if key != "source_commit"}
            changed = historical_content != selected_content
            migration = migrations.get(old_key)
            if old_key in migrations:
                if (not isinstance(migration, dict) or migration.get("to") != selected_key
                        or not isinstance(migration.get("reason"), str) or not migration["reason"].strip()):
                    raise PlanningError(f"Historical migration needs its exact selected variant and reason: {old_key}")
            elif changed:
                raise PlanningError(f"Historical variant changed; explicit migration required: {old_key} -> {selected_key}")
            retained[old_key] = {
                "historical": historical, "selected": selected,
                "state": "reviewed_migration" if changed else "same_manifest_and_declared_inputs",
                "reason": migration["reason"].strip() if migration is not None else None,
            }
        return {
            "commit": baseline, "retained_ids": sorted(old_ids), "variants": retained,
            "source_manifest_sha256": {
                channel: sha256(raw) for channel, (_, raw, _) in old_manifests.items()
            },
        }

    def build(self):
        seeds = self.configuration.get("seeds")
        if not isinstance(seeds, list) or not seeds or any(not isinstance(key, str) for key in seeds):
            raise PlanningError("Explicit nonempty variant seeds are required")
        if len(seeds) != len(set(seeds)):
            raise PlanningError("Duplicate selected variant seeds")
        for key in seeds:
            self.visit(key)
        selected_by_id = {}
        for key in self.order:
            record = self.checked_records[key][2]
            old_key = selected_by_id.setdefault(record["id"], key)
            if old_key != key:
                if self.checked_records[old_key][2]["kind"] != record["kind"]:
                    raise PlanningError(f"Conflicting kinds for selected ID {record['id']}")
                raise PlanningError(f"Conflicting effective variants for selected ID {record['id']}: {old_key}, {key}")
        historical = self.preserve_historical_inventory(selected_by_id)
        for channel, (path, _, _) in self.manifests.items():
            self.add_path(path, "distribution", f"original {channel} manifest")
        selected_source, selected_release, external_records = [], [], {}
        for key in self.order:
            channel, component, record = self.checked_records[key]
            if channel == "source":
                selected_source.append(component)
                self.source_inputs(key, component, record)
            elif channel == "release":
                selected_release.append(component)
                self.release_inputs(key, component, record)
            else:
                external_records[key] = record
        metadata = self.documentation_metadata()
        images = {}
        source_images = {}
        if "data/app-images.json" in self.snapshot.files:
            source_images = parse_json(self.snapshot.read("data/app-images.json"), "data/app-images.json")
            if not isinstance(source_images, dict):
                raise PlanningError("app-images metadata must be a mapping")
            self.add_path("data/app-images.json", "distribution", "original media metadata")
        for key in sorted(self.order, key=lambda value: self.checked_records[value][2]["id"]):
            channel, component, record = self.checked_records[key]
            identifier = record["id"]
            info = source_images.get(identifier, {})
            if not isinstance(info, dict) or not isinstance(info.get("images", []), list):
                raise PlanningError(f"Invalid media metadata for {identifier}")
            info = dict(info)
            screenshots = list(info.get("images", []))
            for row, component_relative in ((metadata.get(key, {}), False), (component or {}, channel == "source")):
                def media_path(value):
                    if not isinstance(value, str):
                        raise PlanningError(f"Invalid media input for {identifier}")
                    try:
                        address = urlsplit(value)
                    except ValueError as error:
                        raise PlanningError(f"Invalid media input for {identifier}") from error
                    if component_relative and not address.scheme and not address.netloc:
                        candidate = component["path"].rstrip("/") + "/" + value
                        return candidate if candidate in self.snapshot.files else value
                    return value
                if not info.get("icon") and row.get("icon"):
                    info["icon"] = media_path(row["icon"])
                for field in ("images", "screenshots"):
                    values = row.get(field, [])
                    if not isinstance(values, list):
                        raise PlanningError(f"Invalid {field} metadata for {identifier}")
                    screenshots.extend(media_path(value) for value in values)
            if any(not isinstance(value, str) or not value for value in screenshots):
                raise PlanningError(f"Invalid media input for {identifier}")
            info["images"] = list(dict.fromkeys(screenshots))
            info["image_count"] = len(info["images"])
            if info.get("icon") not in (None, "") and not isinstance(info["icon"], str):
                raise PlanningError(f"Invalid icon metadata for {identifier}")
            if not info.get("icon") and not info["images"]:
                continue
            images[identifier] = info
            for value in dict.fromkeys([info.get("icon"), *info["images"]]):
                if not value:
                    continue
                self.reference_url(value, identifier)
                if urlsplit(value).scheme:
                    self.external_media.append({"id": identifier, "url": value, "downloaded": False})
        generated = {}
        for channel, selected, path in (
            ("source", selected_source, "mgu-repo.json"),
            ("release", selected_release, "release/catalog.json"),
        ):
            document = dict(self.manifests[channel][2])
            document["components"] = sorted(selected, key=lambda item: item["id"])
            generated[path] = json_bytes(document).decode("utf-8")
        if images:
            generated["data/app-images.json"] = json_bytes(images).decode("utf-8")
        generated[".distribution/external-dependencies.json"] = json_bytes(external_records).decode("utf-8")
        generated[".distribution/eligibility-evidence.json"] = json_bytes(self.evidence).decode("utf-8")
        store_config, store_config_proof = self.store_source_configuration(external_records)
        if store_config is not None:
            generated["data/store-sources.json"] = json_bytes(store_config).decode("utf-8")
        generated["README.md"] = self.render_readme(images, metadata, external_records, store_config)
        files = []
        for path in sorted(self.files):
            item = self.files[path]
            raw = self.snapshot.read(item["source_path"])
            if len(raw) != item["size"]:
                raise PlanningError(f"Input length changed while planning: {item['source_path']}")
            item["sha256"] = sha256(raw)
            item["owners"].sort()
            item["reasons"].sort()
            files.append(item)
        if len(files) + len(generated) + 2 > MAX_FILES:
            raise PlanningError("Inputs plus generated receipts exceed the file-count budget")
        for path in generated:
            checked_path(path)
            if path.casefold() in self.case_paths:
                raise PlanningError(f"Generated file collides with a preserved input: {path}")
        plan = {
            "schema": 1, "distribution": self.name, "source_commit": self.snapshot.commit,
            "evidence_sha256": sha256(json_bytes(self.evidence)),
            "target_hmi": self.target_hmi, "eligibility_policy": self.policy,
            "runtime": "NOT_OBSERVED", "selected_variants": self.order,
            "seeds": seeds, "historical_preservation": historical,
            "source_manifest_sha256": {
                channel: sha256(raw) for channel, (_, raw, _) in self.manifests.items()
            },
            "files": files, "generated_files": generated,
            "external_dependencies": sorted(external_records),
            "store_source_configuration": store_config_proof,
            "external_media": self.external_media, "target_inputs": self.target_inputs,
            "warnings": sorted(set(self.warnings)),
            "limits": {
                "files": MAX_FILES, "bytes": self.export_budget_bytes,
                "hard_bytes": MAX_EXPORT_BYTES,
            },
        }
        return finalize_export_accounting(plan)


def plan_distribution(snapshot, evidence: dict, distribution: str) -> dict:
    if not isinstance(evidence, dict):
        raise PlanningError("Evidence must be a JSON object")
    return PlanBuilder(snapshot, evidence, distribution).build()


def completion_artifacts(plan: dict) -> tuple[bytes, bytes]:
    """Render both completion files from verified descriptors, without I/O.

    The receipt lists every other file; its own bytes are included in totals,
    without making a self-referential checksum claim.
    """
    raw_plan = json_bytes(plan)
    written = [
        {field: item[field] for field in ("path", "size", "sha256", "mode")}
        for item in plan["files"]
    ]
    for path, text in sorted(plan["generated_files"].items()):
        raw = text.encode("utf-8")
        written.append({"path": path, "size": len(raw), "sha256": sha256(raw), "mode": "100644"})
    written.append({
        "path": ".distribution/plan.json", "size": len(raw_plan),
        "sha256": sha256(raw_plan), "mode": "100644",
    })
    receipt = {
        "schema": 1, "state": "complete", "source_commit": plan["source_commit"],
        "plan_sha256": plan["plan_sha256"], "evidence_sha256": plan["evidence_sha256"],
        "source_manifest_sha256": plan["source_manifest_sha256"],
        "historical_preservation": plan["historical_preservation"],
        "store_source_configuration": plan["store_source_configuration"],
        "totals": plan["totals"], "limits": plan["limits"],
        "files": written, "runtime": "NOT_OBSERVED",
        "external_payloads_downloaded": False,
    }
    return raw_plan, json_bytes(receipt)


def export_content_totals(plan: dict) -> dict[str, int]:
    sizes = [item["size"] for item in plan["files"]]
    if any(type(size) is not int or size < 0 for size in sizes):
        raise PlanningError("Export input sizes must be nonnegative integers")
    return {
        "files": len(plan["files"]) + len(plan["generated_files"]) + 2,
        "bytes": sum(sizes) + sum(len(text.encode("utf-8")) for text in plan["generated_files"].values()),
    }


def enforce_export_limits(totals: dict[str, int], limits: dict) -> None:
    budget = checked_export_budget(limits.get("bytes"))
    if (type(limits.get("files")) is not int or limits["files"] != MAX_FILES
            or type(limits.get("hard_bytes")) is not int or limits["hard_bytes"] != MAX_EXPORT_BYTES):
        raise PlanningError("Export limits must retain the fixed file-count and hard byte ceilings")
    if totals["files"] > MAX_FILES:
        raise PlanningError("Inputs plus completion files exceed the file-count budget")
    if totals["bytes"] > budget:
        raise PlanningError(
            f"Export including plan and receipt exceeds the reviewed export byte budget "
            f"({totals['bytes']} > {budget} bytes)"
        )


def finalize_export_accounting(plan: dict) -> dict:
    """Count exact UTF-8 output bytes, including both completion files.

    Only decimal counter widths can change the serialized lengths; SHA-256
    values always have 64 characters. Under the hard ceiling the counters have
    at most nine digits. A fixed sixteen-pass bound prevents an unbounded
    fixed-point loop, and failure never permits materialization.
    """
    content = export_content_totals(plan)
    enforce_export_limits(content, plan["limits"])
    plan["totals"] = dict(content)
    for _ in range(SIZE_ACCOUNTING_PASSES):
        unsigned = {key: value for key, value in plan.items() if key != "plan_sha256"}
        plan["plan_sha256"] = sha256(json_bytes(unsigned))
        raw_plan, raw_receipt = completion_artifacts(plan)
        actual = {
            "files": content["files"],
            "bytes": content["bytes"] + len(raw_plan) + len(raw_receipt),
        }
        enforce_export_limits(actual, plan["limits"])
        if actual == plan["totals"]:
            return plan
        plan["totals"] = actual
    raise PlanningError("Completion-file byte accounting did not converge within its fixed bound")


def checked_completion_artifacts(plan: dict) -> tuple[bytes, bytes]:
    """Recheck approved accounting and its evidence budget before any write."""
    content = export_content_totals(plan)
    enforce_export_limits(content, plan["limits"])
    evidence = parse_json(
        plan["generated_files"][".distribution/eligibility-evidence.json"].encode("utf-8"),
        "export eligibility evidence",
    )
    if (not isinstance(evidence, dict) or evidence.get("source_commit") != plan["source_commit"]
            or sha256(json_bytes(evidence)) != plan["evidence_sha256"]):
        raise PlanningError("Export budget evidence differs from the approved plan")
    distributions = evidence.get("distributions", {})
    configuration = distributions.get(plan["distribution"]) if isinstance(distributions, dict) else None
    if not isinstance(configuration, dict):
        raise PlanningError("Export budget lacks its distribution evidence")
    budget = checked_export_budget(configuration.get("export_budget_bytes", MAX_TOTAL_BYTES))
    if plan["limits"]["bytes"] != budget:
        raise PlanningError("Export byte budget differs from its distribution evidence")
    raw_plan, raw_receipt = completion_artifacts(plan)
    actual = {
        "files": content["files"],
        "bytes": content["bytes"] + len(raw_plan) + len(raw_receipt),
    }
    enforce_export_limits(actual, plan["limits"])
    totals = plan.get("totals")
    if (not isinstance(totals, dict) or any(type(totals.get(field)) is not int for field in actual)
            or totals != actual):
        raise PlanningError("Approved export totals must include the exact plan and receipt bytes and files")
    return raw_plan, raw_receipt


def materialize_distribution(snapshot, plan: dict, output: Path, approved_plan_sha256: str) -> Path:
    """Only write a new output. Failures leave an incomplete directory for review."""
    if not isinstance(plan, dict):
        raise PlanningError("A verified plan object is required")
    unsigned = {key: value for key, value in plan.items() if key != "plan_sha256"}
    digest = sha256(json_bytes(unsigned))
    if approved_plan_sha256 != digest or plan.get("plan_sha256") != digest:
        raise PlanningError("Approved plan SHA-256 does not match; review a fresh plan")
    if plan.get("source_commit") != snapshot.commit:
        raise PlanningError("Snapshot commit differs from the approved plan")
    raw_plan, raw_receipt = checked_completion_artifacts(plan)
    output = output.absolute()
    if output.exists() or output.is_symlink():
        raise PlanningError("Export target already exists; it will never be cleared or reused")
    parent = output.parent.resolve(strict=True)
    output = parent / output.name
    repository = getattr(snapshot, "repository", None)
    if repository is not None:
        repository = Path(repository).resolve(strict=True)
        if output == repository or repository in output.parents:
            raise PlanningError("Export must be outside the source working tree")
    destinations = set()
    for item in plan["files"]:
        path = checked_path(item["path"])
        folded = path.casefold()
        if folded in destinations:
            raise PlanningError(f"Output collision in approved plan: {path}")
        destinations.add(folded)
        blob = snapshot.files.get(item["source_path"])
        if (blob is None or blob.mode not in {"100644", "100755"} or blob.mode != item["mode"]
                or blob.oid != item["oid"] or blob.size != item["size"]):
            raise PlanningError(f"Source object differs from approved plan: {item['source_path']}")
        data = snapshot.read(item["source_path"])
        if len(data) != item["size"] or sha256(data) != item["sha256"]:
            raise PlanningError(f"Source SHA-256 differs from approved plan: {item['source_path']}")
    for path in plan["generated_files"]:
        checked_path(path)
        if path.casefold() in destinations:
            raise PlanningError(f"Generated output collision: {path}")
        destinations.add(path.casefold())
    receipt_paths = {".distribution/plan.json", ".distribution/receipt.json"}
    if destinations.intersection(receipt_paths):
        raise PlanningError("Source input collides with a completion receipt")
    try:
        output.mkdir(mode=0o700, exist_ok=False)
    except FileExistsError as error:
        raise PlanningError("Export target appeared during planning; nothing was overwritten") from error

    def write_new(relative: str, raw: bytes, executable: bool = False):
        destination = output.joinpath(*PurePosixPath(checked_path(relative)).parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        cursor = destination.parent
        while cursor != output.parent:
            if cursor.is_symlink():
                raise PlanningError(f"Symlink appeared inside export: {cursor}")
            cursor = cursor.parent
        with destination.open("xb") as stream:
            stream.write(raw)
        if executable:
            destination.chmod(destination.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    for item in plan["files"]:
        data = snapshot.read(item["source_path"])
        if len(data) != item["size"] or sha256(data) != item["sha256"]:
            raise PlanningError("Input changed during export; incomplete output retained for review")
        write_new(item["path"], data, item["mode"] == "100755")
    for path, text in sorted(plan["generated_files"].items()):
        raw = text.encode("utf-8")
        write_new(path, raw)
    write_new(".distribution/plan.json", raw_plan)
    write_new(".distribution/receipt.json", raw_receipt)
    return output


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument("--commit", required=True, help="Full pinned canonical commit SHA")
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--distribution", required=True)
    parser.add_argument("--materialize", type=Path, help="NEW exclusive directory outside the repository")
    parser.add_argument("--approved-plan-sha256", help="SHA from the reviewed plan, required for materialization")
    arguments = parser.parse_args(argv)
    try:
        if arguments.materialize and not arguments.approved_plan_sha256:
            raise PlanningError("Materialization requires a previously reviewed plan SHA-256")
        if arguments.approved_plan_sha256 and not arguments.materialize:
            raise PlanningError("An approved plan SHA is only used with explicit materialization")
        if arguments.evidence.stat().st_size > MAX_JSON_BYTES:
            raise PlanningError("Evidence exceeds the JSON input limit")
        evidence = parse_json(arguments.evidence.read_bytes(), "eligibility evidence")
        snapshot = GitSnapshot(arguments.repository, arguments.commit)
        plan = plan_distribution(snapshot, evidence, arguments.distribution)
        if arguments.materialize:
            output = materialize_distribution(snapshot, plan, arguments.materialize, arguments.approved_plan_sha256)
            print(json.dumps({"output": str(output), "plan_sha256": plan["plan_sha256"], "state": "complete"}))
        else:
            print(json_bytes(plan).decode("utf-8"), end="")
        return 0
    except (PlanningError, OSError) as error:
        print(f"Distribution planning stopped: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
