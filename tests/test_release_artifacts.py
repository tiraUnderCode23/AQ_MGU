"""Offline failure cases for download byte counts and real archive identities."""

import hashlib
import importlib.util
import io
import json
from contextlib import redirect_stdout
from copy import deepcopy
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("artifact_check", ROOT / "tools/verify_release_artifacts.py")
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


class ReleaseArtifactTests(unittest.TestCase):
    def test_download_uses_the_native_https_reader_header_contract(self):
        payload = b"original release bytes"
        artifact = {"url": "https://github.com/publisher/project/releases/download/v1/app.tgz",
                    "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
        def open_original(request, timeout):
            self.assertIsNone(request.get_header("Accept"))
            self.assertIsNotNone(request.get_header("User-agent"))
            response = io.BytesIO(payload)
            response.geturl = lambda: artifact["url"]
            return response
        with tempfile.TemporaryDirectory() as folder, patch.object(CHECK, "urlopen", side_effect=open_original):
            result = CHECK.download(artifact, Path(folder))
            self.assertEqual(result.read_bytes(), payload)

    def test_github_api_metadata_is_not_validated_using_extra_headers(self):
        payload = b"original release bytes"
        metadata = b'{"id": 123}'
        artifact = {"url": "https://api.github.com/repos/publisher/project/releases/assets/123",
                    "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
        def open_api(request, timeout):
            # Model the content negotiation that previously hid a bad feed
            # URL: only the extra API Accept header serves the archive.
            body = payload if request.get_header("Accept") == "application/octet-stream" else metadata
            response = io.BytesIO(body)
            response.geturl = lambda: artifact["url"]
            return response
        with tempfile.TemporaryDirectory() as folder, patch.object(CHECK, "urlopen", side_effect=open_api):
            with self.assertRaisesRegex(CHECK.ArtifactError, "incomplete download"):
                CHECK.download(artifact, Path(folder))
            self.assertFalse(any(Path(folder).iterdir()))

    def test_exact_compressed_bytes_and_hash_are_required(self):
        body = b"an original publisher archive"
        expected = hashlib.sha256(body).hexdigest()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "asset"
            self.assertEqual(CHECK.copy_verified(io.BytesIO(body), output, len(body), expected)["received_bytes"], len(body))
            for payload, message in ((body[:-1], "incomplete download"),
                                     (body + b"x", "more than expected bytes"),
                                     (b"x" + body[1:], "SHA-256 mismatch")):
                with self.subTest(message=message), self.assertRaisesRegex(CHECK.ArtifactError, message):
                    CHECK.copy_verified(io.BytesIO(payload), output, len(body), expected)

    @staticmethod
    def write_archive(path, files):
        with tarfile.open(path, "w:gz") as archive:
            for name, value in files.items():
                payload = value if isinstance(value, bytes) else json.dumps(value).encode()
                entry = tarfile.TarInfo(name)
                entry.size = len(payload)
                archive.addfile(entry, io.BytesIO(payload))

    def inspect(self, files, component=None):
        if component is None:
            component = {"id": "demo", "version": "1.0.0", "kind": "app", "mguHmi": ["ID8"]}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "package.tgz"
            self.write_archive(path, files)
            return CHECK.inspect_archive(path, component)

    @staticmethod
    def rhmi(*hmis):
        # Native shape from the pinned original Store's
        # apps/robertn_store/package/rhmiData/application.json.
        return {"schemaVersion": "1.3.0", "application": {
            "uiDescriptions": [{"hmi": list(hmis),
                                "applicationFilePath": "./uiDescriptions/shared/application.xml",
                                "uiDescriptionFilePath": "./uiDescriptions/shared/uiDescription.json"}]}}

    def test_id8_mgu_wrapper_is_inspected_without_renaming_content(self):
        result = self.inspect({
            "meta.json": {"id": "demo", "version": "1.0.0"},
            "source/package.json": {"name": "demo", "version": "1.0.0", "mguHmi": ["ID8"]},
            "source/rhmiData/application.json": self.rhmi("ID8"),
        })
        self.assertEqual(result["manifest"], "source/package.json")
        self.assertEqual(result["ui_hmi"], ["ID8"])

    def test_wrong_identity_and_unsupported_hmi_are_rejected(self):
        cases = [({"name": "wrong", "version": "1.0.0"}, "id/version"),
                 ({"name": "demo", "version": "2.0.0"}, "id/version"),
                 ({"name": "demo", "version": "1.0.0", "mguHmi": ["ID7"]}, "HMI")]
        for package, message in cases:
            with self.subTest(package=package), self.assertRaisesRegex(CHECK.ArtifactError, message):
                self.inspect({"package/package.json": package})

    def test_id7_ui_cannot_be_claimed_as_id8(self):
        with self.assertRaisesRegex(CHECK.ArtifactError, "no corresponding package UI"):
            self.inspect({"package.json": {"name": "demo", "version": "1.0.0"},
                          "rhmiData/application.json": self.rhmi("ID7")})

    def test_native_rhmi_arrays_and_store_hmi_precedence(self):
        files = {"package.json": {"name": "demo", "version": "1.0.0"},
                 "rhmiData/application.json": self.rhmi("ID7", "ID8")}
        result = self.inspect(files)
        self.assertEqual(result["ui_hmi"], ["ID7", "ID8"])
        self.assertEqual(result["hmi_source"], "rhmiData")
        # appHmi in the Store intentionally gives an explicit declaration
        # precedence over RHMI; keep both facts in the verification evidence.
        files["package.json"]["mguHmi"] = ["ID8"]
        files["rhmiData/application.json"] = self.rhmi("ID7")
        result = self.inspect(files)
        self.assertEqual(result["ui_hmi"], ["ID7"])
        self.assertEqual(result["effective_hmi"], ["ID8"])
        self.assertEqual(result["hmi_source"], "declared")

    def test_rhmi_folders_and_mgu_root_fallback_match_store(self):
        files = {"meta.json": {"id": "demo", "version": "1.0.0"},
                 "source/package.json": {"name": "demo", "version": "1.0.0"},
                 "rhmiData/uiDescriptions/ID8/application.xml": b"fixture"}
        self.assertEqual(self.inspect(files)["ui_hmi"], ["ID8"])
        files["source/rhmiData/application.json"] = self.rhmi("ID7")
        with self.assertRaisesRegex(CHECK.ArtifactError, "no corresponding package UI"):
            self.inspect(files)

    def test_non_native_hmi_shape_does_not_invent_support(self):
        for rhmi in ({"uiDescriptions": [{"hmi": "ID8"}]},
                     {"application": {"uiDescriptions": [{"hmi": "ID8"}]}}):
            with self.subTest(rhmi=rhmi):
                result = self.inspect({"package.json": {"name": "demo", "version": "1.0.0"},
                                       "rhmiData/application.json": rhmi})
                self.assertEqual(result["ui_hmi"], [])
                self.assertIsNone(result["effective_hmi"])
                self.assertEqual(result["hmi_source"], "unknown")

    def test_explicit_hmi_declaration_has_native_list_shape(self):
        for value in (None, "ID8", [], ["ID8", "ID8"], ["ID9"], [{}]):
            with self.subTest(value=value), self.assertRaisesRegex(CHECK.ArtifactError, "mguHmi must list"):
                self.inspect({"package.json": {"name": "demo", "version": "1.0.0", "mguHmi": value}})

    def test_mgu_wrapper_requires_matching_meta_identity(self):
        files = {"source/package.json": {"name": "demo", "version": "1.0.0"}}
        with self.assertRaisesRegex(CHECK.ArtifactError, "meta.json"):
            self.inspect(files)
        for metadata in ({"id": "wrong", "version": "1.0.0"},
                         {"id": "demo", "version": "2.0.0"}, []):
            files["meta.json"] = metadata
            with self.subTest(metadata=metadata), self.assertRaisesRegex(CHECK.ArtifactError, "meta.json"):
                self.inspect(files)

    def test_npm_identity_uses_name_even_when_id_is_also_present(self):
        with self.assertRaisesRegex(CHECK.ArtifactError, "id/version"):
            self.inspect({"package.json": {"id": "demo", "name": "wrong", "version": "1.0.0"}})

    @staticmethod
    def source_files():
        return {"mgu-app.json": {"schema": 1, "id": "demo", "version": "1.0.0", "tree": "tree",
                                 "modules": ["src/main.js"], "sdk": ["oap-sdk/src/core/OnlineApp.js"]},
                "tree/package.json": {"name": "demo", "version": "1.0.0"}}

    def test_unit_source_must_ship_all_declared_modules(self):
        component = {"id": "demo", "version": "1.0.0", "kind": "app", "build": "unit"}
        files = self.source_files()
        with self.assertRaisesRegex(CHECK.ArtifactError, "missing source module"):
            self.inspect(files, component)
        files["src/main.js"] = b"// public source only\n"
        self.assertTrue(self.inspect(files, component)["source_build"])

    def test_source_recipe_requires_original_linker_inputs(self):
        component = {"id": "demo", "version": "1.0.0", "kind": "app", "build": "unit"}
        valid = self.source_files()
        valid["src/main.js"] = b"// public source only\n"
        for key, value, message in (("schema", None, "schema"), ("schema", True, "schema"),
                                    ("modules", [], "modules"), ("modules", None, "modules"),
                                    ("sdk", [], "source sdk"), ("sdk", [None], "source sdk"),
                                    ("tree", "", "source tree"), ("tree", "absent", "package.json")):
            files = deepcopy(valid)
            files["mgu-app.json"][key] = value
            with self.subTest(key=key, value=value), self.assertRaisesRegex(CHECK.ArtifactError, message):
                self.inspect(files, component)
        valid["tree/package.json"]["version"] = "2.0.0"
        with self.assertRaisesRegex(CHECK.ArtifactError, "source tree package identity"):
            self.inspect(valid, component)

    def test_source_tree_may_be_at_root_as_original_linker_allows(self):
        component = {"id": "demo", "version": "1.0.0", "kind": "app", "build": "unit"}
        files = self.source_files()
        files["mgu-app.json"]["tree"] = "."
        files["package.json"] = files.pop("tree/package.json")
        files["src/main.js"] = b"// public source only\n"
        self.assertTrue(self.inspect(files, component)["source_build"])

    def test_tool_must_ship_its_companion_payload(self):
        component = {"id": "demo", "version": "1.0.0", "kind": "tool"}
        payload = b"fixture, never executable"
        files = {"component.json": {**component, "files": [{
            "path": "bin/helper", "mode": "0755", "sha256": hashlib.sha256(payload).hexdigest()}]}}
        with self.assertRaisesRegex(CHECK.ArtifactError, "missing tool payload"):
            self.inspect(files, component)
        files["files/bin/helper"] = payload
        self.assertEqual(self.inspect(files, component)["package_id"], "demo")
        files["files/bin/helper"] = b"changed bytes"
        with self.assertRaisesRegex(CHECK.ArtifactError, "tool payload SHA-256 mismatch"):
            self.inspect(files, component)

    def test_tool_units_and_dropins_remain_required(self):
        component = {"id": "demo", "version": "1.0.0", "kind": "tool"}
        files = {"component.json": {**component, "files": [], "units": [{"name": "demo.service"}],
                                    "dropins": [{"unit": "demo.service", "name": "settings.conf"}]}}
        with self.assertRaisesRegex(CHECK.ArtifactError, "missing tool unit"):
            self.inspect(files, component)
        files["units/demo.service"] = b"fixture"
        with self.assertRaisesRegex(CHECK.ArtifactError, "missing tool drop-in"):
            self.inspect(files, component)
        files["dropins/demo.service.d/settings.conf"] = b"fixture"
        self.assertEqual(self.inspect(files, component)["package_id"], "demo")
        files["component.json"]["units"] = [None]
        with self.assertRaisesRegex(CHECK.ArtifactError, "invalid tool units"):
            self.inspect(files, component)

    def test_malformed_sibling_still_writes_complete_batch_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            rows = []
            for app_id, manifest in (("broken", []), ("good", {"name": "good", "version": "1.0.0"})):
                path = root / (app_id + ".tgz")
                self.write_archive(path, {"package.json": manifest})
                payload = path.read_bytes()
                digest = hashlib.sha256(payload).hexdigest()
                path.rename(root / (digest + ".tgz"))
                rows.append({"id": app_id, "kind": "app", "version": "1.0.0", "artifact": {
                    "url": "https://example.invalid/" + app_id + ".tgz", "size": len(payload), "sha256": digest}})
            rows.extend([{"id": "no-artifact", "version": "1.0.0", "kind": "app"}, None])
            catalog, output = root / "catalog.json", root / "evidence.json"
            catalog.write_text(json.dumps({"components": rows}), encoding="utf-8")
            argv = ["verify_release_artifacts.py", "--catalog", str(catalog), "--cache-dir", str(root),
                    "--output", str(output), "--jobs", "2"]
            with patch("sys.argv", argv), patch.object(CHECK, "urlopen", side_effect=AssertionError("unexpected network")), redirect_stdout(io.StringIO()):
                self.assertEqual(CHECK.main(), 1)
            evidence = json.loads(output.read_text(encoding="utf-8"))["artifacts"]
            self.assertEqual(len(evidence), 4)
            self.assertEqual((evidence[0]["download"], evidence[0]["archive"]), ("PASS", "FAIL"))
            self.assertIn("JSON must be an object", evidence[0]["error"])
            self.assertEqual((evidence[1]["download"], evidence[1]["archive"]), ("PASS", "PASS"))
            self.assertEqual(evidence[2]["download"], "FAIL")
            self.assertEqual(evidence[3]["archive"], "FAIL")

    def test_archive_paths_are_never_extracted(self):
        with self.assertRaisesRegex(CHECK.ArtifactError, "unsafe archive member"):
            self.inspect({"../outside": b"cannot be extracted"})


if __name__ == "__main__":
    unittest.main()
