"""Actual source generators and inert runtime checks for additional Aref ID8 apps.

Packaging uses a conspicuous synthetic SDK and never executes it. Runtime tests
replace I/O and SDK objects; no unit, network, native binding or vehicle is used.
"""
from contextlib import redirect_stdout
from copy import deepcopy
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import warnings

from test_id8_aref_port import ROOT, ORIGINAL, PORT, load_builder, components

APPS = ("aref_carcare", "aref_carlyrics")
FIXTURE = ROOT / "tests/fixtures/tests_id8_aref_readonly_apps.js"


class ArefReadOnlyId8Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder = load_builder(PORT)
        cls.original = load_builder(ORIGINAL)

    def test_id7_ui_is_preserved_and_id8_retains_actions_with_visible_feature_limit(self):
        for app in APPS:
            with self.subTest(app=app):
                spec = json.loads((PORT / "apps" / app / "app.json").read_text())
                original = json.loads((ORIGINAL / "apps" / app / "app.json").read_text())
                # The Store orders x.y.z, so the AQ package must advance
                # beyond the installed upstream version to offer this fix.
                previous = tuple(map(int, original["version"].split(".")))
                self.assertEqual(tuple(map(int, spec["version"].split("."))),
                                 previous[:2] + (previous[2] + 1,))
                original_ui = deepcopy(original)
                original_ui["version"] = spec["version"]
                id7 = self.builder.build_ui(deepcopy(spec), "en", "ID7")
                id8 = self.builder.build_ui(deepcopy(spec), "en", "ID8")
                self.assertEqual(id7, self.original.build_ui(original_ui, "en"))
                self.assertEqual(id7[3], id8[3])
                self.assertEqual(spec["id"], original["id"])
                old_actions = {c["name"] for c in components(id7[1]) if c["type"] == "button"}
                new = {c["name"]: c for c in components(id8[1])}
                self.assertTrue(old_actions <= new.keys())
                self.assertEqual(new["AQ_ID8_FEATURE_LIMIT"]["type"], "label")
                self.assertIn("widget is unavailable", new["AQ_ID8_FEATURE_LIMIT"]["rows"][0]["Text"]["value"])
                self.assertEqual(self.builder.manifest_for(deepcopy(spec))["proxies"],
                                 self.builder.manifest_for(deepcopy(original))["proxies"])

    def test_target_selection_rejects_ambiguity_and_never_uses_sdk_version(self):
        with tempfile.TemporaryDirectory(prefix="aq-aref-target-") as d:
            lib = Path(d)
            with patch.object(self.builder, "MAINAPP_ROOT", str(lib)):
                with self.assertRaisesRegex(ValueError, "unknown or ambiguous"):
                    self.builder.resolve_target_hmi()
                (lib / "oap-mainapp").mkdir()
                self.assertEqual(self.builder.resolve_target_hmi(), "ID7")
                (lib / "oap-mainapp21").mkdir()
                with self.assertRaisesRegex(ValueError, "unknown or ambiguous"):
                    self.builder.resolve_target_hmi()
                self.assertEqual(self.builder.resolve_target_hmi("ID7"), "ID7")
                self.assertEqual(self.builder.resolve_target_hmi("ID8"), "ID8")
                (lib / "oap-mainapp").rmdir()
                self.assertEqual(self.builder.resolve_target_hmi(), "ID8")
                with self.assertRaises(ValueError):
                    self.builder.resolve_target_hmi("SDK50")

    def test_full_packages_match_the_selected_hmi_and_widget_payload_contract(self):
        marker = b"// SYNTHETIC TEST FIXTURE, NOT BMW SDK, DO NOT INSTALL\n"
        for app in APPS:
            spec = json.loads((PORT / "apps" / app / "app.json").read_text())
            for target in ("ID7", "ID8"):
                with self.subTest(app=app, target=target), tempfile.TemporaryDirectory(prefix="aq-aref-readonly-") as d:
                    tmp = Path(d)
                    sdk, dist = tmp / "synthetic-sdk50", tmp / "dist"
                    sdk.mkdir()
                    (sdk / "index.js").write_bytes(marker)
                    (sdk / "package.json").write_text(json.dumps({"name": "aq-synthetic-sdk-fixture", "version": "50.0.0", "private": True}))
                    with patch.object(self.builder, "SDK", str(sdk)), patch.object(self.builder, "DIST", str(dist)), \
                         patch.object(self.builder, "UNIT_CATALOG", str(tmp / "no-catalog.json")), \
                         patch("urllib.request.urlopen", side_effect=AssertionError("Network forbidden")), \
                         warnings.catch_warnings(), redirect_stdout(io.StringIO()):
                        warnings.simplefilter("ignore", ResourceWarning)
                        self.builder.build(app, target_hmi=target)
                    with tarfile.open(dist / (app + "@" + spec["version"] + ".tgz"), "r:gz") as archive:
                        def read(relative):
                            with archive.extractfile("package/" + relative) as stream:
                                return stream.read()
                        package = json.loads(read("package.json"))
                        self.assertEqual(package["mguHmi"], [target])
                        self.assertEqual(package["aqSourcePort"]["targetHmi"], target)
                        self.assertEqual(package["name"], app)
                        self.assertEqual(package["version"], spec["version"])
                        self.assertEqual(read("node_modules/oap-sdk/index.js"), marker)
                        rhmi = json.loads(read("rhmiData/application.json"))["application"]
                        self.assertEqual([u["hmi"] for u in rhmi["uiDescriptions"]], [[target]])
                        rt = json.loads(read("javascript/kit/app-spec.json"))
                        self.assertEqual(rt["targetHmi"], target)
                        widget_paths = [n for n in archive.getnames() if n.startswith("package/rhmiDataStartWidget")]
                        if target == "ID7":
                            self.assertTrue(widget_paths)
                            self.assertTrue(rt["startWidget"])
                            widget = json.loads(read("rhmiDataStartWidget/application.json"))["application"]
                            self.assertEqual([u["hmi"] for u in widget["uiDescriptions"]], [["ID7"]])
                            self.assertFalse(package["aqSourcePort"]["unavailableFeatures"])
                        else:
                            self.assertFalse(widget_paths)
                            self.assertIsNone(rt["startWidget"])
                            self.assertTrue(package["aqSourcePort"]["unavailableFeatures"])
                        self.assertEqual(read("javascript/kit/readonly_signals.js"), (PORT / "kit/runtime/readonly_signals.js").read_bytes())
                        self.assertEqual(read("javascript/kit/LICENSE.alexpereap"), (PORT / "kit/LICENSE.alexpereap").read_bytes())
                    with tarfile.open(dist / (app + "@" + spec["version"] + ".mgu"), "r:gz") as archive:
                        self.assertEqual(any(n.startswith("rhmiDataStartWidget/") for n in archive.getnames()), target == "ID7")
                        xml = archive.extractfile("rhmiData/uiDescription/application.xml").read().decode()
                        self.assertEqual("LT_State_Wide_List" in xml, target == "ID8")

    def test_unknown_target_cannot_yield_any_package(self):
        with tempfile.TemporaryDirectory(prefix="aq-aref-ambiguous-") as d:
            tmp = Path(d)
            with patch.object(self.builder, "MAINAPP_ROOT", str(tmp)), patch.object(self.builder, "DIST", str(tmp / "dist")), \
                 self.assertRaisesRegex(ValueError, "--target-hmi"):
                self.builder.build("aref_carcare")
            self.assertFalse(list(tmp.rglob("*.tgz")))
            self.assertFalse(list(tmp.rglob("*.mgu")))

    def run_node(self, scenario):
        result = subprocess.run(["node", str(FIXTURE), str(ROOT), scenario],
                                text=True, capture_output=True, timeout=25, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS " + scenario, result.stdout)

    def test_read_only_adapter_raw_typed_failure_recovery_freshness_and_shutdown(self):
        self.run_node("adapter")

    def test_actual_carcare_entry_confirm_units_cancel_and_stale_odometer(self):
        self.run_node("carcare")

    def test_actual_media_reader_tracks_sources_pause_freshness_and_subscription_lifecycle(self):
        self.run_node("nowplaying")

    def test_actual_carlyrics_entry_preserves_clock_controls_and_clears_unavailable_track(self):
        self.run_node("carlyrics")

    def test_fullscreen_touch_geometry_uses_local_id8_application_area_and_keeps_id7(self):
        self.run_node("fullscreen")


if __name__ == "__main__":
    unittest.main()
