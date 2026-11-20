"""Offline source and publisher-artifact integrity gates for Vizualyse frontends.

Current native providers are read from both feeds and their actual working
paths. Historical comparisons read only selected immutable Git blobs at 6650;
they do not restore the removed upstream tree or substitute for missing current
inputs. Three original publisher frontend archives were passively inspected on
2026-11-20. Their portable exact-byte receipts bind current release references
to every archived source/resource file. No download, extraction, SDK donor,
application script, or vehicle operation runs in this suite.
"""

import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
HISTORICAL_COMMIT = "6650ed577b48b80caeb7b708f60ca615f5a8aaa7"
ORIGINAL = "apps/_sources/vizualyse-idrive-apps"
PUBLISHED = "apps/_published"
MAX_HISTORICAL_BYTES = 20 * 1024 * 1024
NAMES = (
    "vizualyse_cast",
    "vizualyse_chromium",
    "vizualyse_cluster",
    "vizualyse_moonlight",
    "vizualyse_steam",
)
PUBLIC_PINS = {
    "app/touch_mode": (
        "1.1.0", "touch_mode.js",
        "b1af9bf9057a0ba9ad47de33211e3ad67240bc40a47ff52e66328da9bdb7ae35",
        "SPDX-License-Identifier: GPL-3.0-or-later",
    ),
    "app/vehicle_speed": (
        "1.0.0", "vehicle_speed.js",
        "68cf60c2738ba30630e2ff5b914bdc5432310ae9c428e175443c0e8a4d4e1036",
        "SPDX-License-Identifier: GPL-3.0-or-later",
    ),
    "app/qr_png": (
        "1.0.0", "qr_png.js",
        "a81a9e138bf526b1095e37d37d1cd537b3026d6a7c34e56769d47e05ea57661a",
        "SPDX-License-Identifier: GPL-3.0-or-later",
    ),
    "common/qrcode": (
        "1.0.0", "qrcode.js",
        "18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780",
        "Licensed under the MIT license",
    ),
}


def json_from(path):
    return json.loads(path.read_text(encoding="utf-8"))


def public_source_digest(payload):
    """Normalize only Git CRLF conversion for the four pinned public JS files."""
    return hashlib.sha256(payload.replace(b"\r\n", b"\n")).hexdigest()


def tree_members(folder):
    if not folder.is_dir():
        raise AssertionError("Current native source folder is missing: " + str(folder))
    result = {}
    for path in folder.rglob("*"):
        if path.is_symlink():
            raise AssertionError("Native snapshot contains a symlink: " + str(path))
        if path.is_file():
            result[path.relative_to(folder).as_posix()] = path.read_bytes()
    return result


def git_bytes(*arguments, payload=None):
    environment = dict(os.environ)
    environment["GIT_NO_LAZY_FETCH"] = "1"
    environment["GIT_TERMINAL_PROMPT"] = "0"
    return subprocess.check_output(
        ["git", "--no-optional-locks", "-C", str(ROOT), "-c",
         "protocol.allow=never", *arguments],
        input=payload, env=environment,
    )


class HistoricalInputs:
    """Bounded raw blob reads, not a checkout/archive extraction or source run."""

    def __init__(self):
        prefixes = ["mgu-repo.json"]
        prefixes += [ORIGINAL + "/apps/" + app for app in NAMES]
        prefixes += [PUBLISHED + "/" + app for app in NAMES]
        prefixes += [
            ORIGINAL + "/platform/" + module + "/" + version + "/" + filename
            for module, (version, filename, _, _) in PUBLIC_PINS.items()
        ]
        listing = git_bytes("ls-tree", "-r", "-l", "-z", HISTORICAL_COMMIT, "--", *prefixes)
        records = []
        total = 0
        for row in listing.split(b"\0"):
            if not row:
                continue
            header, relative = row.split(b"\t", 1)
            mode, kind, oid, size = header.decode("ascii").split()
            if kind != "blob" or mode not in {"100644", "100755"}:
                raise AssertionError("Nonregular historical source input")
            total += int(size)
            if total > MAX_HISTORICAL_BYTES:
                raise AssertionError("Historical source comparison exceeded 20 MiB")
            records.append((relative.decode("utf-8"), mode, oid, int(size)))
        if not records:
            raise AssertionError("Pinned historical source objects are missing")
        request = "".join(oid + "\n" for _, _, oid, _ in records).encode("ascii")
        stream = io.BytesIO(git_bytes("cat-file", "--batch", payload=request))
        self.files, self.modes = {}, {}
        for path, mode, oid, size in records:
            header = stream.readline().decode("ascii").strip().split()
            if header != [oid, "blob", str(size)]:
                raise AssertionError("Historical Git object header differs: " + path)
            raw = stream.read(size)
            if len(raw) != size or stream.read(1) != b"\n":
                raise AssertionError("Truncated historical Git object: " + path)
            git_blob = b"blob " + str(size).encode("ascii") + b"\0" + raw
            if hashlib.sha1(git_blob).hexdigest() != oid:
                raise AssertionError("Historical Git blob hash differs: " + path)
            self.files[path] = raw
            self.modes[path] = mode
        if stream.read():
            raise AssertionError("Unexpected extra historical blob output")

    def read(self, path):
        if path not in self.files:
            raise AssertionError("Missing pinned historical input: " + path)
        return self.files[path]

    def members(self, folder):
        prefix = folder.rstrip("/") + "/"
        return {path[len(prefix):]: raw for path, raw in self.files.items()
                if path.startswith(prefix)}


class PublishedVizualyseSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json_from(ROOT / "mgu-repo.json")
        release = json_from(ROOT / "release/catalog.json")
        cls.providers = {}
        for channel, document in (("source", cls.catalog), ("release", release)):
            for component in document["components"]:
                if component["id"] in cls.providers:
                    raise AssertionError("Ambiguous provider: " + component["id"])
                cls.providers[component["id"]] = (channel, component)
        cls.history = HistoricalInputs()
        receipts = json_from(ROOT / "data/vizualyse-frontend-inspection-20261120.json")
        if receipts["historical_reference_commit"] != HISTORICAL_COMMIT:
            raise AssertionError("Frontend receipts refer to a different historical source")
        cls.receipts = {record["id"]: record for record in receipts["artifacts"]}
        if len(cls.receipts) != len(receipts["artifacts"]):
            raise AssertionError("Duplicate publisher artifact receipt")
        cls.samples = {}
        for app in NAMES:
            channel, entry = cls.providers[app]
            if channel == "source":
                cls.samples[app] = tree_members(ROOT / entry["path"])
            else:
                # These are explicitly historical comparison bytes. Exact
                # current artifact/member hashes are verified separately below.
                cls.samples[app] = cls.history.members(PUBLISHED + "/" + app)

    def assert_release_receipt(self, app):
        channel, entry = self.providers[app]
        self.assertEqual(channel, "release")
        receipt = self.receipts[app]
        artifact = entry["artifact"]
        self.assertEqual((entry["id"], entry["kind"], entry["version"]),
                         (receipt["id"], "app", receipt["version"]))
        self.assertEqual(entry.get("build"), "unit",
                         "Published mgu-app.json archives require the source-package build route")
        self.assertEqual(artifact["name"], app + "@" + receipt["version"] + ".tgz")
        self.assertEqual(artifact["url"], receipt["url"])
        self.assertEqual(artifact["size"], receipt["size"])
        self.assertEqual(artifact["sha256"], receipt["sha256"])
        self.assertEqual(receipt["received_bytes"], receipt["size"])
        self.assertEqual(receipt["status"], "PASS")
        self.assertEqual(receipt["archive_execution"], "NOT_EXECUTED")
        self.assertEqual(receipt["runtime"], "NOT_OBSERVED")
        self.assertEqual(receipt["ui_hmi"], ["ID7"])
        self.assertEqual(entry["mguHmi"], receipt["ui_hmi"])

        observed = {record["path"]: record for record in receipt["files"]}
        self.assertEqual(len(observed), len(receipt["files"]))
        historical = self.samples[app]
        manifest = json.loads(historical["mgu-app.json"])
        # The publisher archive retains its license under the staged package
        # tree. The old AQ snapshot also had an extra root copy of that license.
        self.assertIn(manifest["tree"] + "/LICENSE", observed)
        self.assertEqual(set(observed), set(historical) - {"LICENSE"})
        self.assertEqual(sum(record["bytes"] for record in observed.values()),
                         receipt["expanded_bytes"])
        for path, record in observed.items():
            with self.subTest(app=app, artifact_member=path):
                raw = historical[path]
                self.assertEqual(len(raw), record["bytes"])
                self.assertEqual(hashlib.sha256(raw).hexdigest(), record["sha256"])
        for record in receipt["manifests"]:
            raw = historical[record["path"]]
            self.assertEqual(hashlib.sha256(raw).hexdigest(), record["sha256"])
            document = json.loads(raw)
            for key, value in record["metadata"].items():
                self.assertEqual(document.get(key), value)
        self.assertEqual(manifest["id"], app)
        self.assertEqual(manifest["version"], entry["version"])
        self.assertEqual(manifest["schema"], 1)
        self.assertTrue(set(manifest["modules"]).issubset(observed))

    def test_all_five_catalog_routes_and_component_manifests(self):
        for app in NAMES:
            with self.subTest(app=app):
                channel, item = self.providers[app]
                sample = self.samples[app]
                manifest = json.loads(sample["mgu-app.json"])
                original = ORIGINAL + "/apps/" + app
                upstream_manifest = json.loads(self.history.read(original + "/mgu-app.json"))
                package = json.loads(sample[manifest["tree"] + "/package.json"])
                self.assertEqual(item["kind"], "app")
                self.assertEqual(item.get("build"), "unit")
                self.assertEqual(item["mguHmi"], ["ID7"])
                self.assertEqual(manifest, upstream_manifest)
                self.assertEqual(manifest["schema"], 1)
                self.assertEqual(manifest["id"], app)
                self.assertEqual(manifest["version"], item["version"])
                self.assertEqual((package["name"], package["version"]), (app, item["version"]))
                self.assertEqual(len(manifest["modules"]), len(set(manifest["modules"])))
                self.assertEqual(len(manifest["modules"]), 5 if app == "vizualyse_cluster" else 6)
                self.assertIn("LICENSE", sample)
                self.assertNotIn("release.json", sample,
                                 "Unit inputs must not be mutable upstream platform components")
                if channel == "release":
                    self.assert_release_receipt(app)
                else:
                    self.assertTrue((ROOT / item["path"] / "mgu-app.json").is_file())

    def test_all_declared_modules_of_every_unit_app_resolve(self):
        """Every current unit input must exist; historical routes are explicit."""
        expected_modules = {
            "carplay_map_toggle": 2, "jap_waze_cluster": 5, "robertn_store": 27,
            "robertn_waze_cluster": 8, "vizualyse_cast": 6, "vizualyse_chromium": 6,
            "vizualyse_cluster": 5, "vizualyse_moonlight": 6, "vizualyse_steam": 6,
            "vlad_carplay_mirror": 2, "dk_backgammon": 4, "dk_tetris": 4,
            "iabadia_m_arcade": 42,
        }
        module_counts = {}
        for entry in self.catalog["components"]:
            if entry.get("build") != "unit":
                continue
            base = ROOT / entry["path"]
            manifest = json_from(base / "mgu-app.json")
            self.assertEqual((entry["id"], entry["version"]),
                             (manifest["id"], manifest["version"]))
            module_counts[entry["id"]] = len(manifest["modules"])
            self.assertEqual(len(manifest["modules"]), len(set(manifest["modules"])))
            for module in manifest["modules"]:
                with self.subTest(app=entry["id"], module=module):
                    parts = PurePosixPath(module).parts
                    self.assertTrue(parts and parts[0] not in ("", ".", ".."))
                    self.assertNotIn("..", parts)
                    self.assertNotIn("\\", module)
                    self.assertFalse(PurePosixPath(module).is_absolute())
                    self.assertTrue(module.endswith(".js"))
                    self.assertFalse((base / module).is_symlink())
                    self.assertTrue((base / module).is_file(),
                                    f"missing current Store-source module: {entry['path']}/{module}")
        self.assertTrue(set(expected_modules).issubset(self.providers))
        for app, expected in expected_modules.items():
            with self.subTest(app=app):
                channel, _ = self.providers[app]
                if channel == "release":
                    # Former unit apps still require all original modules:
                    # the exact publisher archive receipt supplies that route.
                    self.assertIn(app, self.receipts)
                    self.assert_release_receipt(app)
                    module_counts[app] = len(json.loads(self.samples[app]["mgu-app.json"])["modules"])
                self.assertEqual(module_counts[app], expected)

    def test_every_pinned_public_module_is_byte_identical_and_licensed(self):
        matched = 0
        for app in NAMES:
            with self.subTest(app=app):
                original = ORIGINAL + "/apps/" + app
                release = json.loads(self.history.read(original + "/release.json"))
                manifest = json.loads(self.samples[app]["mgu-app.json"])
                self.assertEqual(release["mguHmi"], ["ID7"])
                self.assertEqual(release["requires"], self.providers[app][1]["requires"])
                for module, pin in release["platform"].items():
                    with self.subTest(app=app, pin=module):
                        self.assertIn(module, PUBLIC_PINS)
                        version, basename, expected_sha, license_marker = PUBLIC_PINS[module]
                        self.assertEqual(pin["version"], version)
                        self.assertEqual(len(pin["files"]), 1)
                        for destination, source_name in pin["files"].items():
                            self.assertEqual(source_name, basename)
                            self.assertIn(destination, manifest["modules"])
                            path = ORIGINAL + "/platform/" + module + "/" + version + "/" + source_name
                            payload = self.history.read(path)
                            self.assertEqual(public_source_digest(payload), expected_sha)
                            self.assertEqual(self.samples[app][destination], payload)
                            self.assertIn(license_marker, payload[:1024].decode("utf-8", "replace"))
                            if self.providers[app][0] == "release":
                                observed = {record["path"]: record for record in self.receipts[app]["files"]}
                                self.assertEqual(hashlib.sha256(payload).hexdigest(),
                                                 observed[destination]["sha256"])
                                self.assertEqual(len(payload), observed[destination]["bytes"])
                            matched += 1
        self.assertEqual(matched, 18)

    def test_public_text_pins_allow_crlf_but_reject_changed_content(self):
        for module, (version, filename, digest, _) in PUBLIC_PINS.items():
            with self.subTest(module=module):
                payload = self.history.read(ORIGINAL + "/platform/" + module + "/" + version + "/" + filename)
                lf = payload.replace(b"\r\n", b"\n")
                self.assertEqual(public_source_digest(lf), digest)
                self.assertEqual(public_source_digest(lf.replace(b"\n", b"\r\n")), digest)
                self.assertNotEqual(public_source_digest(lf + b"// changed\n"), digest)

    def test_app_specific_modules_staged_resources_and_licenses_are_unchanged(self):
        for app in NAMES:
            with self.subTest(app=app):
                original = ORIGINAL + "/apps/" + app
                sample = self.samples[app]
                manifest = json.loads(sample["mgu-app.json"])
                release = json.loads(self.history.read(original + "/release.json"))
                pinned = {destination for pin in release["platform"].values() for destination in pin["files"]}
                for name in manifest["modules"]:
                    if name not in pinned:
                        self.assertEqual(sample[name], self.history.read(original + "/" + name), name)
                for name in ("LICENSE", "mgu-app.json"):
                    self.assertEqual(sample[name], self.history.read(original + "/" + name), name)
                original_tree = self.history.members(original + "/" + manifest["tree"])
                prefix = manifest["tree"] + "/"
                published_tree = {name[len(prefix):]: raw for name, raw in sample.items()
                                  if name.startswith(prefix)}
                self.assertEqual(len(original_tree), 12)
                self.assertEqual(published_tree, original_tree)
                expected = {"LICENSE", "mgu-app.json", *manifest["modules"]}
                expected.update(prefix + name for name in original_tree)
                self.assertEqual(set(sample), expected)

    def test_snapshots_are_publishable_and_contain_no_oem_sdk(self):
        for app in NAMES:
            with self.subTest(app=app):
                channel, entry = self.providers[app]
                sample = self.samples[app]
                manifest = json.loads(sample["mgu-app.json"])
                for relative in sample:
                    self.assertNotIn("oap-sdk/", relative.lower())
                    self.assertNotIn("node_modules/", relative.lower())
                    self.assertNotIn("javascript/app.js", relative.lower())
                    self.assertFalse(relative.lower().endswith((".mgu", ".tgz", ".exe", ".dll", ".so", ".bin")))
                for relative in manifest["modules"]:
                    if channel == "source":
                        folder = ROOT / entry["path"]
                        self.assertFalse((folder / relative).is_symlink())
                        code = subprocess.run(
                            ["git", "--no-optional-locks", "-C", str(ROOT), "check-ignore", "-q",
                             entry["path"] + "/" + relative], capture_output=True,
                        ).returncode
                        self.assertEqual(code, 1, f"Current Store source ignored: {app}/{relative}")
                    else:
                        # Historical snapshots were actual committed regular
                        # files; current release members are receipt-bound.
                        historical = PUBLISHED + "/" + app + "/" + relative
                        self.assertIn(self.history.modes[historical], {"100644", "100755"})
                        observed = {record["path"]: record for record in self.receipts[app]["files"]}
                        self.assertIn(relative, observed)


if __name__ == "__main__":
    unittest.main()
