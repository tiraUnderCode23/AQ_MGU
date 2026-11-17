"""Offline Store-source integrity gates for the five published Vizualyse apps.

The original updater packages build='unit' component directories as-is:
all modules in mgu-app.json must therefore be in the published source path.
The original upstream platform tree and its ignored generated copies remain
untouched. No SDK donor, HU commands, or application scripts are executed.

Run: python -B -m unittest discover -s tests -p test_vizualyse_source_module_copies.py
"""

import hashlib
import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "apps" / "_sources" / "vizualyse-idrive-apps"
PUBLISHED = ROOT / "apps" / "_published"
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
        "ed6a91e5e97d2946cbedbec278e450e1266a582dabb954e47309cc5009822ccd",
        "SPDX-License-Identifier: GPL-3.0-or-later",
    ),
    "app/vehicle_speed": (
        "1.0.0", "vehicle_speed.js",
        "93421ce758b5b350e0e8ad3b741b7968b652eae141bb3bbf100a402b8ec59a8c",
        "SPDX-License-Identifier: GPL-3.0-or-later",
    ),
    "app/qr_png": (
        "1.0.0", "qr_png.js",
        "39450500a8f9b9f48e6487dea90cbc7838b839e409fa37d90e3851486bca71c8",
        "SPDX-License-Identifier: GPL-3.0-or-later",
    ),
    "common/qrcode": (
        "1.0.0", "qrcode.js",
        "4b6133cbb5a13ecdc26cfa897d0daf7bb9b08232032cdd381e82f2baf3653b5f",
        "Licensed under the MIT license",
    ),
}


def json_from(path):
    return json.loads(path.read_text(encoding="utf-8"))


def tree_members(folder):
    return {
        path.relative_to(folder).as_posix(): path.read_bytes()
        for path in folder.rglob("*")
        if path.is_file()
    }


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args]).decode("utf-8")


class PublishedVizualyseSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json_from(ROOT / "mgu-repo.json")
        cls.entries = {c["id"]: c for c in cls.catalog["components"]}

    def test_all_five_catalog_routes_and_component_manifests(self):
        for app in NAMES:
            with self.subTest(app=app):
                original = ORIGINAL / "apps" / app
                folder = PUBLISHED / app
                item = self.entries[app]
                manifest = json_from(folder / "mgu-app.json")
                upstream_manifest = json_from(original / "mgu-app.json")
                package = json_from(folder / manifest["tree"] / "package.json")

                self.assertEqual(item["kind"], "app")
                self.assertEqual(item["build"], "unit")
                self.assertEqual(item["path"], f"apps/_published/{app}")
                self.assertEqual(item["mguHmi"], ["ID7"])
                self.assertEqual(manifest, upstream_manifest)
                self.assertEqual(manifest["schema"], 1)
                self.assertEqual(manifest["id"], app)
                self.assertEqual(manifest["version"], item["version"])
                self.assertEqual((package["name"], package["version"]),
                                 (app, item["version"]))
                self.assertEqual(len(manifest["modules"]), len(set(manifest["modules"])))
                self.assertEqual(len(manifest["modules"]), 5 if app == "vizualyse_cluster" else 6)
                self.assertTrue((folder / "LICENSE").is_file())
                self.assertFalse((folder / "release.json").exists(),
                                 "Snapshot must not be mistaken for a mutable upstream platform component")

    def test_all_73_modules_of_all_ten_unit_apps_resolve(self):
        """Includes Git-only robertn_store, omitted by this sparse checkout."""
        tracked = set(git("ls-tree", "-r", "--name-only", "HEAD").splitlines())
        refs = 0
        units = 0
        for entry in self.catalog["components"]:
            if entry.get("build") != "unit":
                continue
            units += 1
            rel = entry["path"]
            base = ROOT / rel
            manifest_path = base / "mgu-app.json"
            if manifest_path.is_file():
                manifest = json_from(manifest_path)
            else:
                self.assertIn(f"{rel}/mgu-app.json", tracked)
                manifest = json.loads(git("show", f"HEAD:{rel}/mgu-app.json"))
            self.assertEqual((entry["id"], entry["version"]),
                             (manifest["id"], manifest["version"]))
            for module in manifest["modules"]:
                with self.subTest(app=entry["id"], module=module):
                    # Other original source-only apps legitimately place
                    # selected modules under lib/ rather than src/.
                    parts = Path(module).parts
                    self.assertTrue(parts and parts[0] not in ("", ".", ".."))
                    self.assertNotIn("..", parts)
                    self.assertTrue(module.endswith(".js"))
                    present = (base / module).is_file() or f"{rel}/{module}" in tracked
                    self.assertTrue(present, f"missing Store-source module: {rel}/{module}")
                refs += 1
        self.assertEqual(units, 10)
        self.assertEqual(refs, 73)

    def test_every_pinned_public_module_is_byte_identical_and_licensed(self):
        matched = 0
        for app in NAMES:
            with self.subTest(app=app):
                original = ORIGINAL / "apps" / app
                folder = PUBLISHED / app
                release = json_from(original / "release.json")
                manifest = json_from(folder / "mgu-app.json")
                self.assertEqual(release["mguHmi"], ["ID7"])
                self.assertEqual(release["requires"], self.entries[app]["requires"])
                for module, pin in release["platform"].items():
                    with self.subTest(app=app, pin=module):
                        self.assertIn(module, PUBLIC_PINS)
                        version, basename, expected_sha, license_marker = PUBLIC_PINS[module]
                        self.assertEqual(pin["version"], version)
                        self.assertEqual(len(pin["files"]), 1)
                        for destination, source_name in pin["files"].items():
                            self.assertEqual(source_name, basename)
                            self.assertIn(destination, manifest["modules"])
                            upstream = ORIGINAL / "platform" / module / version / source_name
                            copy = folder / destination
                            self.assertTrue(upstream.is_file(), upstream)
                            self.assertTrue(copy.is_file(), copy)
                            payload = upstream.read_bytes()
                            self.assertEqual(hashlib.sha256(payload).hexdigest(), expected_sha)
                            self.assertEqual(copy.read_bytes(), payload)
                            self.assertIn(license_marker,
                                          payload[:1024].decode("utf-8", "replace"))
                            matched += 1
        self.assertEqual(matched, 18)

    def test_app_specific_modules_staged_resources_and_licenses_are_unchanged(self):
        for app in NAMES:
            with self.subTest(app=app):
                original = ORIGINAL / "apps" / app
                folder = PUBLISHED / app
                manifest = json_from(folder / "mgu-app.json")
                pinned = {
                    dest
                    for p in json_from(original / "release.json")["platform"].values()
                    for dest in p["files"]
                }
                for name in manifest["modules"]:
                    if name not in pinned:
                        self.assertEqual((folder / name).read_bytes(),
                                         (original / name).read_bytes(), name)
                for name in ("LICENSE", "mgu-app.json"):
                    self.assertEqual((folder / name).read_bytes(),
                                     (original / name).read_bytes(), name)
                original_tree = tree_members(original / manifest["tree"])
                published_tree = tree_members(folder / manifest["tree"])
                self.assertEqual(len(original_tree), 12)
                self.assertEqual(published_tree, original_tree)
                expected = {"LICENSE", "mgu-app.json"}
                expected.update(manifest["modules"])
                expected.update(f"{manifest['tree']}/{n}" for n in original_tree)
                self.assertEqual(set(tree_members(folder)), expected)

    def test_snapshots_are_publishable_and_contain_no_oem_sdk(self):
        for app in NAMES:
            with self.subTest(app=app):
                folder = PUBLISHED / app
                manifest = json_from(folder / "mgu-app.json")
                for rel in tree_members(folder):
                    self.assertNotIn("oap-sdk/", rel.lower())
                    self.assertNotIn("node_modules/", rel.lower())
                    self.assertNotIn("javascript/app.js", rel.lower())
                    self.assertFalse(rel.lower().endswith(
                        (".mgu", ".tgz", ".exe", ".dll", ".so", ".bin")))
                for rel in manifest["modules"]:
                    self.assertFalse((folder / rel).is_symlink())
                    # Public Store files must NOT be covered by upstream
                    # generated-copy .gitignore; git will include them
                    # normally when the publisher reviews/adds this tree.
                    code = subprocess.run(
                        ["git", "-C", str(ROOT), "check-ignore", "-q",
                         f"apps/_published/{app}/{rel}"],
                        capture_output=True,
                    ).returncode
                    self.assertEqual(code, 1, f"Store snapshot file ignored: {app}/{rel}")


if __name__ == "__main__":
    unittest.main()
