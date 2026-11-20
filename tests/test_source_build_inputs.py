"""Offline source-input and dependency regression tests for Store packages."""

import importlib.util
import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("store_feed_input_checks", ROOT / "verify_store_feeds.py")
validator = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(validator)


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def read_json(relative):
    path = ROOT / relative
    raw = path.read_bytes() if path.is_file() else git("show", "HEAD:" + relative)
    return json.loads(raw.decode("utf-8"))


def covered(path, roots):
    return any(path == root or path.startswith(root.rstrip("/") + "/") for root in roots)


class SourceBuildInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = read_json("mgu-repo.json")["components"]
        cls.entries = {entry["id"]: entry for entry in cls.catalog}
        cls.files = validator.paths_at("HEAD")

    def test_every_app_shared_module_is_in_the_store_build_input(self):
        inspected_apps = 0
        inspected_modules = 0
        for entry in self.catalog:
            build = entry.get("build")
            if not isinstance(build, dict):
                continue
            script = build.get("python", "")
            if not script.endswith("/kit/tools/build.py"):
                continue
            manifest = read_json(entry["path"] + "/" + entry.get("manifest", "app.json"))
            shared = manifest.get("shared", [])
            if not shared:
                continue
            inspected_apps += 1
            family = script[:-len("/kit/tools/build.py")]
            roots = [entry["path"], script] + build.get("shared", [])
            for module in shared:
                inspected_modules += 1
                with self.subTest(app=entry["id"], module=module):
                    if module.endswith("/"):
                        original = family + "/shared/" + module.rstrip("/")
                        self.assertTrue(validator.exists_in_tree(original, self.files))
                    else:
                        original = family + "/shared/" + module
                        self.assertIn(original, self.files)
                    self.assertTrue(
                        not build.get("shared") or covered(original, roots),
                        "Store's partial source selection omits " + original,
                    )
        self.assertGreaterEqual(inspected_apps, 2)
        self.assertGreaterEqual(inspected_modules, 56)

    def test_cluster_themes_declares_its_required_renderer(self):
        releases = read_json("release/catalog.json")["components"] + self.catalog
        provider = next(item for item in releases if item["id"] == "cluster-render")
        metadata = {row["id"]: row for row in read_json("data/components.json")["components"]}
        for identifier in ("cluster_themes", "idrive_hud_widgets"):
            with self.subTest(app=identifier):
                entry = self.entries[identifier]
                dependency = entry.get("requires", {}).get("cluster-render")
                self.assertIsNotNone(dependency, "Original app README requires cluster-render")
                self.assertEqual(dependency, "0.5.1")
                self.assertEqual(metadata[identifier]["requires"], entry["requires"])
                self.assertGreaterEqual(
                    tuple(map(int, provider["version"].split("."))),
                    tuple(map(int, dependency.split("."))),
                )

    def test_browser_cast_frontends_keep_exact_original_module_manifests(self):
        for identifier in ("vizualyse_cast", "vizualyse_chromium"):
            with self.subTest(app=identifier):
                entry = self.entries[identifier]
                actual = read_json(entry["path"] + "/mgu-app.json")
                original = read_json("apps/_sources/vizualyse-idrive-apps/apps/" + identifier + "/mgu-app.json")
                self.assertEqual(actual, original)
                self.assertEqual(actual["modules"][0], "src/" + identifier + ".js")
                for module in actual["modules"]:
                    self.assertIn(entry["path"] + "/" + module, self.files)
                release = read_json("apps/_sources/vizualyse-idrive-apps/apps/" + identifier + "/release.json")
                self.assertEqual(entry["requires"], release["requires"])


class SourceInputValidatorTests(unittest.TestCase):
    def scripted(self):
        entry = {
            "id": "demo", "version": "1.0.0", "kind": "app", "path": "family/apps/demo",
            "build": {"python": "family/kit/tools/build.py", "shared": ["family/kit"]},
        }
        manifests = {"family/apps/demo/app.json": {
            "id": "demo", "version": "1.0.0", "shared": ["drawing.js"],
        }}
        files = set(manifests) | {"family/kit/tools/build.py", "family/shared/drawing.js"}
        return entry, manifests, files

    def unit(self):
        entry = {"id": "demo", "version": "1.0.0", "kind": "app", "path": "apps/demo", "build": "unit"}
        manifests = {
            "apps/demo/mgu-app.json": {
                "schema": 1, "id": "demo", "version": "1.0.0", "tree": "demo@1.0.0",
                "modules": ["src/demo.js", "src/shared.js"], "sdk": ["oap-sdk/core"],
            },
            "apps/demo/demo@1.0.0/package.json": {"name": "demo", "version": "1.0.0"},
        }
        files = set(manifests) | {"apps/demo/src/demo.js", "apps/demo/src/shared.js"}
        return entry, manifests, files

    def check(self, fixture):
        entry, manifests, files = fixture
        audit = validator.Audit()
        validator.check_source_inputs(audit, {entry["id"]: entry}, files, manifests.__getitem__)
        return audit

    def test_partial_inputs_reject_omitted_shared_folder_then_accept_included_folder(self):
        fixture = self.scripted()
        self.assertTrue(any("build.shared omits" in error for error in self.check(fixture).errors))
        fixture[0]["build"]["shared"].append("family/shared")
        self.assertEqual(self.check(fixture).errors, [])

    def test_full_repository_mode_does_not_require_partial_input_list(self):
        fixture = self.scripted()
        fixture[0]["build"].pop("shared")
        self.assertEqual(self.check(fixture).errors, [])

    def test_missing_original_shared_file_is_rejected_even_with_inclusion(self):
        fixture = self.scripted()
        fixture[0]["build"]["shared"].append("family/shared")
        fixture[2].remove("family/shared/drawing.js")
        self.assertTrue(any("missing original shared module" in error for error in self.check(fixture).errors))

    def test_unit_module_gap_is_rejected_before_a_package_is_published(self):
        fixture = self.unit()
        self.assertEqual(self.check(fixture).errors, [])
        fixture[2].remove("apps/demo/src/shared.js")
        self.assertTrue(any("missing unit source module src/shared.js" in error for error in self.check(fixture).errors))

    def test_unit_module_path_traversal_is_rejected(self):
        for invalid in ("../outside.js", "/outside.js", "C:/outside.js", "src\\outside.js", 7):
            fixture = self.unit()
            fixture[1]["apps/demo/mgu-app.json"]["modules"] = [invalid]
            with self.subTest(module=invalid):
                self.assertTrue(any("invalid unit source module" in error for error in self.check(fixture).errors))

    def test_changed_unit_package_identity_is_rejected(self):
        for changed in ({"name": "other"}, {"version": "2.0.0"}):
            fixture = self.unit()
            fixture[1]["apps/demo/demo@1.0.0/package.json"].update(changed)
            self.assertTrue(any("unit package identity/version" in error for error in self.check(fixture).errors))

    def test_changed_source_identity_or_version_is_rejected(self):
        for key, value in (("id", "other"), ("version", "9.0.0")):
            fixture = self.unit()
            fixture[1]["apps/demo/mgu-app.json"][key] = value
            self.assertTrue(any("source manifest" in error for error in self.check(fixture).errors))


if __name__ == "__main__":
    unittest.main()
