"""Offline source-port contracts; no real SDK, head unit, installer or socket.

The temporary SDK-shaped file throws if executed. Package assembly exercises
the actual builder, while Node tests use inert transport and telemetry fakes.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "apps/_sources/pinguinooo-idrive7-apps"
PORT = ROOT / "apps/_ports/pinguinooo-idrive8"
APP = "adam_shiftlights"


def builder(folder, name):
    for key in ("pack_data", "localize"):
        sys.modules.pop(key, None)
    source = importlib.util.spec_from_file_location(name, folder / "kit/tools/build.py")
    module = importlib.util.module_from_spec(source)
    source.loader.exec_module(module)
    return module


class ShiftlightsId8PortTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = builder(ORIGINAL, "shift_before")
        cls.after = builder(PORT, "shift_after")
        cls.old_spec = json.loads((ORIGINAL / "apps" / APP / "app.json").read_text())
        cls.spec = json.loads((PORT / "apps" / APP / "app.json").read_text())

    def run_contract(self, group):
        result = subprocess.run(["node", str(ROOT / "tests/shiftlights_id8_contract.js"), str(PORT), str(ORIGINAL), group],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS Shiftlights ID8 " + group, result.stdout)

    def test_original_geometry_shaders_guards_and_client_are_preserved(self):
        for name in ("geom.js", "shader.js", "logic.js", "safety.js", "rpmpoll.js", "config.js", "crstatus.js", "hudart.js", "cluster_render_client.js", "NOTICE", "icon.png"):
            with self.subTest(file=name):
                self.assertEqual((ORIGINAL / "apps" / APP / name).read_bytes(), (PORT / "apps" / APP / name).read_bytes())
        self.assertEqual(self.old_spec["version"], "0.4.5")
        self.assertEqual(self.spec["version"], "0.4.6")
        self.assertEqual(self.spec["aqOriginalVersion"], "0.4.5")
        self.assertEqual(self.spec["signals"], self.old_spec["signals"])
        self.assertEqual(self.spec["mguAppStartType"], "autostart")
        self.assertFalse((PORT / "apps/adam_mtrack").exists())

    def test_published_provenance_matches_sources_and_component_versions(self):
        meta = json.loads((PORT / "AQ_PORT.json").read_text())
        components = {item["id"]: item for item in meta["components"]}
        self.assertEqual((components[APP]["version"], components[APP]["originalVersion"], components[APP]["recipe_revision"]),
                         ("0.4.6", "0.4.5", 2))
        self.assertEqual((components["adam_vitals"]["version"], components["adam_vitals"]["recipe_revision"]), ("0.2.0", 1))
        self.assertEqual(meta["validation"]["physical_cluster_hud_visibility"], "NOT_OBSERVED")
        for row in meta["changed_original_files"] + meta["unchanged_app_files"] + meta["unchanged_shiftlights_files"]:
            with self.subTest(path=row["path"]):
                self.assertEqual(hashlib.sha256((PORT / row["path"]).read_bytes()).hexdigest(), row["derived_sha256"])
                self.assertEqual(hashlib.sha256((ORIGINAL / row["path"]).read_bytes()).hexdigest(), row["original_sha256"])
        for row in meta["new_runtime_file_hashes"]:
            with self.subTest(new_path=row["path"]):
                self.assertEqual(hashlib.sha256((PORT / row["path"]).read_bytes()).hexdigest(), row["sha256"])

    def test_id7_ui_is_original_for_the_new_patch_version(self):
        # Only the version and ID8-only metadata differ in app.json. ID7's UI
        # uses the exact original generator, settings labels and interaction.
        for language in ("en", "zh-CN"):
            with self.subTest(language=language):
                self.assertEqual(self.before.build_ui(self.spec, language), self.after.build_ui(self.spec, language, "ID7"))

    def test_id8_settings_and_state_identity_are_real(self):
        x7, u7, x8, u8, strings, states = self.after.ui_resources(self.spec)
        self.assertEqual(self.after.build_ui(self.spec, hmi="ID8")[3], states)
        self.assertEqual(self.after.build_ui(self.spec, hmi="ID7")[3], states)
        xml = ET.fromstring(x8)
        self.assertTrue(all(c.get("widget") == "LT_State_Wide_List" for c in xml.findall("container")))
        components = {c["name"]: c for state in u8["containers"].values() for c in state["components"].values()}
        self.assertEqual(components["KIT_HMI_ID8"]["properties"]["Visible"]["value"], 0)
        readonly = components["SET_AUTOSTART"]
        self.assertEqual(readonly["type"], "label")
        self.assertIn("Text", readonly["rows"][0])
        self.assertNotIn("PrimaryText", readonly["rows"][0])
        self.assertTrue(any("open Shift Lights after each" in str(value) for value in strings.values()))
        for item in self.spec["settings"]:
            if item["key"] == "autoStart":
                continue
            component = components["SET_" + item["key"].upper()]
            self.assertEqual(component["type"], "button")
            self.assertIn("PrimaryText", component["rows"][0])
        self.assertLessEqual(len(strings), 1024)

    def test_vehicle_manifest_only_uses_original_reads(self):
        old = self.before.manifest_for(json.loads(json.dumps(self.old_spec)))
        new = self.after.manifest_for(json.loads(json.dumps(self.spec)))
        self.assertEqual(old["services"], new["services"])
        for iface, definition in old["proxies"].items():
            self.assertEqual(definition, new["proxies"][iface], iface)
        extra = set(new["proxies"]) - set(old["proxies"])
        self.assertEqual(extra, set(self.after.PLATFORM_PROXIES) - set(self.before.PLATFORM_PROXIES))
        self.assertTrue(all("hmi." in name or name.endswith("PrivateEntryPoint2") for name in extra))

    def test_complete_package_with_inert_synthetic_sdk(self):
        with tempfile.TemporaryDirectory(prefix="aq-shiftlights-id8-fixture-") as directory:
            root = Path(directory) / "source"
            shutil.copytree(PORT, root, ignore=shutil.ignore_patterns("__pycache__", "dist"))
            sdk = root / "oap-sdk"
            sdk.mkdir()
            (sdk / "index.js").write_text("throw new Error('Inert synthetic packaging fixture, not a BMW SDK');\n")
            (sdk / "package.json").write_text(json.dumps({"name": "oap-sdk", "version": "50.0.0-synthetic", "synthetic": True}))
            result = subprocess.run([sys.executable, "-B", str(root / "kit/tools/build.py"), APP], cwd=root,
                                    text=True, capture_output=True, timeout=30,
                                    env={"PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1",
                                         "MGU_SOMEIP_CATALOG": str(root / "no-target-catalog.json")})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            with tarfile.open(root / "dist/adam_shiftlights@0.4.6.tgz") as archive:
                def read(relative):
                    return archive.extractfile("package/" + relative).read()
                package = json.loads(read("package.json"))
                self.assertEqual((package["name"], package["version"]), (APP, "0.4.6"))
                self.assertEqual(package["mguHmi"], ["ID7", "ID8"])
                self.assertEqual(package["aqSourcePort"], {"id": "pinguinooo-idrive8", "revision": "2",
                                 "originalVersion": "0.4.5", "upstreamCommit": "82bea95add762c03d97070d2bd462bfd5fac429c"})
                self.assertEqual(package["mguAppStartType"], "autostart")  # ID7 preserved; ID8 waits for open in runtime
                desc = json.loads(read("rhmiData/application.json"))["application"]
                self.assertEqual([row["hmi"] for row in desc["uiDescriptions"]], [["ID7"], ["ID8"]])
                for hmi in ("ID7", "ID8"):
                    ET.fromstring(read("rhmiData/uiDescriptions/" + hmi + "/application.xml"))
                    json.loads(read("rhmiData/uiDescriptions/" + hmi + "/uiDescription.json"))
                for source in (PORT / "apps" / APP).glob("*.js"):
                    installed = "app.js" if source.name == "main.js" else source.name
                    self.assertEqual(read("javascript/" + installed), source.read_bytes())
                self.assertEqual(read("javascript/NOTICE"), (ORIGINAL / "apps" / APP / "NOTICE").read_bytes())
                for name in ("Pinguino-LICENSE.txt", "Kit-LICENSE.txt", "Kit-NOTICE.txt", "AQ-ID8-adaptation.txt", "Cluster-Render-Client-MPL-2.0.txt"):
                    self.assertTrue(read("javascript/kit/licenses/" + name))
                self.assertTrue(json.loads(read("node_modules/oap-sdk/package.json"))["synthetic"])

    def test_dynamic_target_geometry_and_unchanged_shader_coordinates(self):
        self.run_contract("geometry")

    def test_original_client_reconnect_does_not_replay_id8_layers(self):
        self.run_contract("output")

    def test_signals_invalid_stale_provider_loss_timeouts_and_shutdown(self):
        self.run_contract("signals")

    def test_real_main_requires_id8_open_preserves_id7_autostart_and_guards(self):
        self.run_contract("main")

    def test_real_sdk_lifecycle_background_and_readonly_startup_setting(self):
        self.run_contract("startup")


if __name__ == "__main__":
    unittest.main()
