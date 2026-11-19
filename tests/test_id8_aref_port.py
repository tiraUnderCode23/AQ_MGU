"""Offline regressions for AQ's Car Explorer ID8 port.

The real UI generator, package assembler, runtime and display are exercised.
SDK lifecycle objects and renderer I/O are inert test doubles; the package
fixture contains a conspicuous synthetic SDK stub. Explorer's read-only entry
uses an in-memory filesystem. No vehicle operation, real SDK, socket or
installer is executed by this suite.
"""

from contextlib import redirect_stdout
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import warnings


ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "apps/_sources/arefahmad-idrive7-apps"
PORT = ROOT / "apps/_ports/arefahmad-idrive8"
APP = "aref_explorer"
FIXTURE = ROOT / "tests/fixtures/tests_id8_aref.js"
ID8_PROXIES = {
    "de.bmw.infotainment.hmi.entrypoint2.EntryPoint2",
    "de.bmw.infotainment.hmi.entrypoint2.EntryPointManager2",
    "de.bmw.infotainment.hmi.remote2.RemoteHmi2",
    "de.bmw.infotainment.hmi.remote2.RemoteHmiApplication2",
    "de.bmw.infotainment.hmi.resourcemanagement2.ResourceManager2",
    "de.bmw.infotainment.hmi.resourcemanagement2.ResourceBundle2",
    "de.bmw.infotainment.hmi.resourcemanagement2.StringBundle2",
    "de.bmw.infotainment.hmi.usecasemanagement.UseCaseContext",
    "de.bmw.infotainment.telematic.oap.PrivateEntryPoint2",
}


def load_builder(source):
    previous_path = sys.path[:]
    names = ("pack_data", "localize")
    previous_modules = {name: sys.modules.pop(name, None) for name in names}
    try:
        spec = importlib.util.spec_from_file_location(
            "aq_aref_" + source.name.replace("-", "_"), source / "kit/tools/build.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path[:] = previous_path
        for name, old in previous_modules.items():
            sys.modules.pop(name, None)
            if old is not None:
                sys.modules[name] = old


def components(ui):
    return [component for container in ui["containers"].values()
            for component in container["components"].values()]


class ArefId8PortTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder = load_builder(PORT)
        cls.original_builder = load_builder(ORIGINAL)
        cls.spec = json.loads((PORT / "apps" / APP / "app.json").read_text())
        cls.original_spec = json.loads((ORIGINAL / "apps" / APP / "app.json").read_text())
        cls.ui = {hmi: cls.builder.build_ui(deepcopy(cls.spec), "en", hmi)
                  for hmi in ("ID7", "ID8")}

    def node_scenario(self, scenario):
        payload = {"spec": self.spec, "ui": {hmi: value[1] for hmi, value in self.ui.items()}}
        result = subprocess.run(
            ["node", str(FIXTURE), str(ROOT), scenario], input=json.dumps(payload),
            capture_output=True, text=True, timeout=20, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS " + scenario, result.stdout)

    def test_id7_generator_outputs_remain_identical_to_original_aref(self):
        old = self.original_builder.build_ui(deepcopy(self.original_spec), "en")
        self.assertEqual(self.ui["ID7"], old)
        self.assertEqual(self.spec["id"], self.original_spec["id"])
        self.assertEqual(self.spec["version"], self.original_spec["version"])

    def test_id8_generator_emits_native_resources_and_keeps_state_and_action_ids(self):
        xml7, ui7, strings7, states7 = self.ui["ID7"]
        xml8, ui8, strings8, states8 = self.ui["ID8"]
        self.assertEqual(states7, states8)
        old = {component["name"]: component for component in components(ui7)}
        new = {component["name"]: component for component in components(ui8)}
        ids = lambda ui: {component["name"]: cid for container in ui["containers"].values()
                          for cid, component in container["components"].items()}
        old_ids, new_ids = ids(ui7), ids(ui8)
        self.assertEqual(set(new), set(old) | {self.builder.HMI8_MARK})
        self.assertNotIn('<property id="9"', xml8)
        widgets = set(re.findall(r'widget="([^"]+)"', xml8))
        self.assertIn("LT_State_Wide_List", widgets)
        self.assertTrue(widgets <= {"LT_State_Wide_List", "LT_Button_MediaEntry_1Row", "LT_ScrollLabel"})
        self.assertNotEqual(xml7, xml8)
        self.assertEqual(new[self.builder.HMI8_MARK]["properties"]["Visible"]["value"], 0)
        self.assertEqual(new["MAIN_GFX"]["type"], "label")
        self.assertIn('<component id="' + new_ids["MAIN_GFX"] + '" type="label" widget="LT_ScrollLabel">', xml8)
        self.assertNotIn("Graphic", new["MAIN_GFX"]["rows"][0])
        for name in old:
            with self.subTest(component=name):
                # The hidden ID8 marker consumes an allocation before the
                # title, whose numeric ID is not part of the runtime contract.
                # Actual state and actionable component IDs stay stable.
                if old[name]["type"] != "title":
                    self.assertEqual(new_ids[name], old_ids[name])
                if new[name]["type"] == "button":
                    self.assertTrue({"PrimaryText", "FrequencyText", "FrequencyVisible"} <= new[name]["rows"][0].keys())
                    self.assertFalse({"Text", "Text1stRow", "Text2ndRow"} & new[name]["rows"][0].keys())
        merged = {**strings7, **strings8}
        self.assertLessEqual(len(merged), 1024)
        def check_strings(value):
            if isinstance(value, dict):
                if value.get("type") == "StringId":
                    self.assertIn(value["value"], merged)
                for child in value.values():
                    check_strings(child)
            elif isinstance(value, list):
                for child in value:
                    check_strings(child)
        check_strings(ui7)
        check_strings(ui8)

    def test_manifest_includes_dual_platform_contract_and_original_read_only_scope(self):
        manifest = self.builder.manifest_for(deepcopy(self.spec))
        original = self.original_builder.manifest_for(deepcopy(self.original_spec))
        self.assertTrue(ID8_PROXIES <= manifest["proxies"].keys())
        self.assertTrue(original["proxies"].keys() <= manifest["proxies"].keys())
        self.assertEqual(manifest["services"], original["services"])
        self.assertFalse(self.spec.get("signals"))
        self.assertEqual(self.spec["mguHmi"], ["ID7", "ID8"])
        minimum = self.spec["requires"]["mgu-render"]
        version = lambda text: tuple(map(int, text.split(".")))
        self.assertGreaterEqual(version(minimum), (0, 6, 24))
        render = next(row for row in json.loads((ROOT / "release/catalog.json").read_text())["components"]
                      if row["id"] == "mgu-render")
        self.assertGreaterEqual(version(render["version"]), version(minimum))
        self.assertTrue({"ID7", "ID8"} <= set(render["mguHmi"]))
        permissions = json.loads((PORT / "kit/platform/permissions.json").read_text())
        grants = {entry["domain"]: entry for entry in permissions["masterAccessTable"]}
        for domain in ("entrypoint", "rhmi", "resourcemanager", "usecasecontext", "provisioning"):
            grant = grants["com.bmwgroup.appgateway." + domain]
            self.assertEqual(grant["uid"], "${APPNAME}")
            self.assertEqual(grant["defaultConsumerPermission"], "YES")

    def test_original_vehicle_backends_and_guards_are_unmodified(self):
        for relative in ("kit/runtime/signals.js", "kit/runtime/parked.js", "kit/runtime/diag.js"):
            with self.subTest(file=relative):
                self.assertEqual((PORT / relative).read_bytes(), (ORIGINAL / relative).read_bytes())
        self.assertEqual({p.parent.name for p in (PORT / "apps").glob("*/app.json")},
                         {APP, "aref_carcare", "aref_carlyrics"})

    def test_runtime_uses_dynamic_hmi_marker_cells_and_settings(self):
        self.node_scenario("ui")

    def test_id8_image_fallback_is_native_text_without_sdk_resources(self):
        self.node_scenario("image")

    def test_actual_run_lifecycle_initializes_id8_entry_before_active(self):
        self.node_scenario("foreground")

    def test_actual_run_lifecycle_keeps_background_start_without_screen(self):
        self.node_scenario("background")

    def test_actual_run_lifecycle_keeps_id7_registration_and_entry_behavior(self):
        self.node_scenario("id7")

    def test_id8_visibility_respects_application_and_popup_events(self):
        self.node_scenario("visibility")

    def test_display_uses_app_area_touch_settings_and_no_missing_controller_gate(self):
        self.node_scenario("display")

    def test_platform_paths_never_guess_between_id7_and_mainapp21(self):
        self.node_scenario("paths")

    def test_explorer_entry_reads_only_the_selected_mainapp_family(self):
        self.node_scenario("explorerpaths")

    def test_actual_package_assembler_includes_both_hmis_with_inert_synthetic_sdk(self):
        self.assertFalse(self.spec.get("assets"), "This smoke test must remain offline")
        marker = b"// SYNTHETIC TEST FIXTURE, NOT BMW SDK, DO NOT INSTALL\n"
        with tempfile.TemporaryDirectory(prefix="aq-aref-id8-") as directory:
            tmp = Path(directory)
            sdk, dist = tmp / "synthetic-sdk", tmp / "output"
            sdk.mkdir()
            (sdk / "index.js").write_bytes(marker)
            (sdk / "package.json").write_text(json.dumps({
                "name": "aq-synthetic-sdk-fixture", "version": "0.0.0", "private": True}))
            with warnings.catch_warnings(record=True) as observed, \
                 patch.object(self.builder, "SDK", str(sdk)), \
                 patch.object(self.builder, "DIST", str(dist)), \
                 patch.object(self.builder, "UNIT_CATALOG", str(tmp / "absent-catalog.json")), \
                 patch("urllib.request.urlopen", side_effect=AssertionError("Unexpected network request")), \
                 redirect_stdout(io.StringIO()):
                warnings.simplefilter("always", ResourceWarning)
                self.builder.build(APP)
            for warning in observed:
                self.assertTrue(issubclass(warning.category, ResourceWarning), str(warning.message))
                self.assertTrue(warning.filename.endswith("kit/tools/build.py"), warning.filename)
            with tarfile.open(dist / (APP + "@" + self.spec["version"] + ".tgz"), "r:gz") as archive:
                def read(relative):
                    with archive.extractfile("package/" + relative) as stream:
                        return stream.read()
                package = json.loads(read("package.json"))
                self.assertEqual(package["name"], APP)
                self.assertEqual(package["mguHmi"], ["ID7", "ID8"])
                self.assertEqual(read("node_modules/oap-sdk/index.js"), marker)
                application = json.loads(read("rhmiData/application.json"))["application"]
                self.assertEqual([item["hmi"] for item in application["uiDescriptions"]], [["ID7"], ["ID8"]])
                for item in application["uiDescriptions"]:
                    hmi = item["hmi"][0]
                    self.assertEqual(read("rhmiData/" + item["applicationFilePath"].removeprefix("./")).decode(), self.ui[hmi][0])
                    self.assertTrue(json.loads(read("rhmiData/" + item["uiDescriptionFilePath"].removeprefix("./")))["containers"])
                self.assertTrue(ID8_PROXIES <= json.loads(read("manifest.json"))["proxies"].keys())
                self.assertEqual(read("permissions.json"), (PORT / "kit/platform/permissions.json").read_bytes())
                settings = json.loads(read("config/base.json"))["settings"][APP]
                self.assertTrue(settings["rhmiLoadingEnabled"])
                self.assertTrue(settings["entryPointLoadingEnabled"])
                for module in ("id8_lifecycle.js", "platform_paths.js", "signals.js"):
                    self.assertEqual(read("javascript/kit/" + module), (PORT / "kit/runtime" / module).read_bytes())
                self.assertEqual(read("javascript/kit/LICENSE.aref"), (PORT / "LICENSE").read_bytes())
                for license_file in (PORT / "kit").iterdir():
                    if license_file.is_file() and license_file.name.startswith(("LICENSE", "NOTICE")):
                        self.assertEqual(read("javascript/kit/" + license_file.name), license_file.read_bytes())

    def test_missing_sdk_cannot_yield_a_completed_archive(self):
        with tempfile.TemporaryDirectory(prefix="aq-aref-no-sdk-") as directory:
            tmp = Path(directory)
            with warnings.catch_warnings(record=True), \
                 patch.object(self.builder, "SDK", str(tmp / "absent")), \
                 patch.object(self.builder, "DIST", str(tmp / "output")), \
                 patch.object(self.builder, "UNIT_CATALOG", str(tmp / "absent-catalog.json")), \
                 patch("urllib.request.urlopen", side_effect=AssertionError("Unexpected network request")), \
                 redirect_stdout(io.StringIO()), self.assertRaises((FileNotFoundError, SystemExit)):
                self.builder.build(APP)
            self.assertFalse(list(tmp.rglob("*.tgz")))
            self.assertFalse(list(tmp.rglob("*.mgu")))


if __name__ == "__main__":
    unittest.main()
