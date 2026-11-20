"""Offline failures that previously let incomplete Store catalogs pass.

Only metadata is read. No original tool payload is fetched or installed.
"""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import verify_store_feeds as validator  # noqa: E402


def read_json(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class ExternalDependencyTests(unittest.TestCase):
    def setUp(self):
        self.config = read_json(validator.STORE_SOURCES)
        self.registry = read_json(validator.EXTERNAL_COMPONENTS)
        self.source = {e["id"]: e for e in read_json("mgu-repo.json")["components"]}
        self.release = read_json("release/catalog.json")
        self.metadata = read_json("data/components.json")
        self.provenance = read_json("data/catalog-provenance.json")

    def audit(self):
        result = validator.Audit()
        validator.check_store_sources(result, self.config)
        external = validator.check_external_components(result, self.registry, self.config)
        releases = validator.check_release(result, self.release)
        validator.check_index(result, self.source, releases, self.metadata, self.provenance, external)
        return result

    def test_configured_original_dependencies_resolve(self):
        result = self.audit()
        self.assertEqual(result.errors, [])
        self.assertEqual(result.counts["external"], 6)

    def test_missing_native_source_cannot_be_satisfied_by_metadata_alone(self):
        self.config["sources"] = [s for s in self.config["sources"]
                                  if s["id"] != "aq-mgu-iteriodev"]
        result = self.audit()
        self.assertEqual(result.counts["external"], 0)
        self.assertTrue(any("required original source" in error for error in result.errors))
        self.assertTrue(any("requires/iteriodev_overlays" in error for error in result.errors))

    def test_id8_app_cannot_depend_on_id7_only_tool(self):
        # Keep the display metadata consistent: closure itself must reject the
        # HMI conflict, rather than merely catching two metadata copies differ.
        next(e for e in self.registry["components"] if e["id"] == "iteriodev-overlays")["mguHmi"] = ["ID7"]
        next(e for e in self.metadata["components"] if e["id"] == "iteriodev-overlays")["supported_hmi"] = ["ID7"]
        result = self.audit()
        self.assertTrue(any("requires/iteriodev_overlays" in error and "does not support ID8" in error
                            for error in result.errors))

    def test_unknown_helper_is_not_silently_substituted(self):
        next(e for e in self.release["components"] if e["id"] == "iteriodev_overlays")["requires"]["unknown-helper"] = "1.0.0"
        next(e for e in self.metadata["components"] if e["id"] == "iteriodev_overlays")["requires"]["unknown-helper"] = "1.0.0"
        self.assertTrue(any("unknown-helper is not in" in error for error in self.audit().errors))

    def test_truncated_original_version_is_rejected(self):
        next(e for e in self.registry["components"] if e["id"] == "iteriodev-turnview")["version"] = "0.8"
        self.assertTrue(any("external/iteriodev-turnview: invalid version" == error
                            for error in self.audit().errors))

    def test_reference_registry_cannot_advertise_an_aq_payload(self):
        self.registry["components"][0]["artifact"] = {"url": "https://example.invalid/tool.tgz"}
        self.assertTrue(any("must not declare an AQ artifact" in error for error in self.audit().errors))

    def test_reference_must_name_exact_original_commit_and_manifest(self):
        self.registry["components"][0]["source_manifest_url"] = self.registry["components"][0]["source_manifest_url"].replace(
            "IterioDev/car-apps", "another-publisher/car-apps")
        self.assertTrue(any("pinned original source" in error for error in self.audit().errors))

    def test_duplicate_external_and_local_id_does_not_fall_back_to_a_publisher(self):
        duplicate = copy.deepcopy(self.registry["components"][0])
        self.source[duplicate["id"]] = duplicate
        self.assertTrue(any("duplicated between AQ feeds and original external source" in error
                            for error in self.audit().errors))

    def test_original_reference_cannot_be_changed_to_an_unrelated_publisher(self):
        record = next(e for e in self.provenance if e.get("distribution") == "original-publisher-reference")
        record["upstream_repository"] = "unrelated/publisher"
        self.assertTrue(any("outside the recorded original repository" in error for error in self.audit().errors))

    def test_original_github_asset_api_route_is_metadata_evidence_only(self):
        self.assertTrue(validator.original_repository_url(
            "https://api.github.com/repos/noth4m4d/mgu-hamadstools/releases/assets/711907509",
            "noth4m4d/mgu-hamadstools"))
        self.assertFalse(validator.original_repository_url(
            "https://release-assets.githubusercontent.com/tokenized-url?sig=secret",
            "noth4m4d/mgu-hamadstools"))

    def recorded_airplay_https_fixture(self):
        # This is the reviewed HTTPS artifact, not a claim about its current
        # feed route. airplay-rx is now distributed as a native source tool.
        proof = next(record for record in
                     read_json("data/artifact-verification-20261119.json")["artifacts"]
                     if (record["id"], record["version"]) == ("airplay-rx", "1.0.0"))
        self.assertEqual((proof["package_id"], proof["package_version"]),
                         ("airplay-rx", "1.0.0"))
        self.assertEqual(proof["download"], "PASS")
        self.assertEqual(proof["archive"], "PASS")
        self.assertEqual(proof["received_bytes"], proof["expected_bytes"])
        self.assertEqual(proof["sha256"], proof["expected_sha256"])
        self.assertEqual(proof["manifest"], "component.json")
        return {
            "id": proof["id"], "kind": "tool", "version": proof["version"],
            "mguHmi": proof["package_hmi"], "requires": proof["package_requires"],
            "artifact": {
                "name": proof["id"] + "@" + proof["version"] + ".tgz",
                "url": proof["artifact_url"], "size": proof["expected_bytes"],
                "sha256": proof["expected_sha256"],
            },
        }

    def test_https_catalog_rejects_api_asset_that_needs_accept_header(self):
        entry = self.recorded_airplay_https_fixture()
        entry["artifact"]["url"] = (
            "https://api.github.com/repos/noth4m4d/mgu-hamadstools/releases/assets/711907509")
        audit = validator.Audit()
        validator.check_release(audit, {"schema": 2, "components": [entry]})
        self.assertTrue(any("original Store HTTPS reader" in error and "browser_download_url" in error
                            for error in audit.errors))

    def test_https_catalog_accepts_original_browser_download_url(self):
        entry = self.recorded_airplay_https_fixture()
        entry["artifact"]["url"] = (
            "https://github.com/noth4m4d/mgu-hamadstools/releases/download/catalog/airplay-rx%401.0.0.tgz")
        audit = validator.Audit()
        validator.check_release(audit, {"schema": 2, "components": [entry]})
        self.assertEqual(audit.errors, [])


class CrossAppBuildInputTests(unittest.TestCase):
    def setUp(self):
        self.family = "apps/_sources/example-family"
        self.folder = self.family + "/apps/navigation"
        self.original = self.family + "/apps/media/net/http.js"
        self.entry = {
            "id": "navigation", "kind": "app", "version": "1.0.0", "path": self.folder,
            "build": {"python": self.family + "/kit/tools/build.py",
                      "shared": [self.family + "/kit"]},
        }
        self.manifest = {"id": "navigation", "version": "1.0.0", "share": ["media/net/http.js"]}
        self.files = {self.folder + "/app.json", self.entry["build"]["python"], self.original}

    def audit(self):
        result = validator.Audit()
        validator.check_source_inputs(result, {"navigation": self.entry}, self.files,
                                      lambda path: self.manifest)
        return result

    def test_existing_cross_app_file_must_be_in_partial_download_selection(self):
        self.assertTrue(any("build.shared omits required cross-app module" in error
                            for error in self.audit().errors))

    def test_selected_cross_app_directory_is_sufficient(self):
        self.entry["build"]["shared"].append(self.family + "/apps/media/net")
        result = self.audit()
        self.assertEqual(result.errors, [])
        self.assertEqual(result.counts["cross_app_modules"], 1)

    def test_selected_cross_app_file_must_exist(self):
        self.entry["build"]["shared"].append(self.original)
        self.files.remove(self.original)
        self.assertTrue(any("missing original cross-app module" in error for error in self.audit().errors))

    def test_cross_app_path_cannot_escape_apps(self):
        self.manifest["share"] = ["media/../../outside.js"]
        self.assertTrue(any("invalid app.json share module" in error for error in self.audit().errors))


class WorkingTreePathTests(unittest.TestCase):
    def test_new_files_and_real_deletions_are_used_without_breaking_sparse_paths(self):
        with tempfile.TemporaryDirectory(prefix="aq-feed-paths-") as temp:
            folder = Path(temp)

            def git(*args):
                result = subprocess.run(["git", "-C", str(folder), *args], text=True,
                                        capture_output=True, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)

            git("init", "-q")
            for name in ("kept.txt", "deleted.txt", "sparse.txt"):
                (folder / name).write_text("original\n", encoding="utf-8")
            (folder / ".gitignore").write_text("ignored.txt\n", encoding="utf-8")
            git("add", ".")
            git("-c", "user.name=Feed Tests", "-c", "user.email=feed-tests@example.invalid",
                "commit", "-qm", "fixture")
            git("update-index", "--skip-worktree", "sparse.txt")
            (folder / "sparse.txt").unlink()
            (folder / "deleted.txt").unlink()
            (folder / "new-source.js").write_text("// newly imported source\n", encoding="utf-8")
            (folder / "ignored.txt").write_text("ignored\n", encoding="utf-8")
            with mock.patch.object(validator, "ROOT", folder):
                working = validator.paths_at("HEAD")
                committed = validator.paths_at("HEAD", head_only=True)
            self.assertIn("new-source.js", working)
            self.assertNotIn("deleted.txt", working)
            self.assertIn("sparse.txt", working)
            self.assertNotIn("ignored.txt", working)
            self.assertNotIn("new-source.js", committed)
            self.assertIn("deleted.txt", committed)


if __name__ == "__main__":
    unittest.main()
