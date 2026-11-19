"""Exercise the original cauli ID7/ID8 generator without a vehicle or OEM SDK.

The package smoke test uses an unmistakable, inert SDK-shaped fixture only to
exercise packaging. It does not validate BMW SDK execution or HU registration.
"""

from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
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
SOURCE = ROOT / "apps/_sources/idrive7-apps"
EVIDENCE = ROOT / "data/id8-native-app-evidence.json"
COMMIT = "422957a85461826c1e8654d37c8ec66a94849f9c"
APP_IDS = {
    "ambient_config", "brake_test", "car_vitals", "doom", "draggy",
    "dtc_scanner", "dyno", "edrive", "gforce", "live_adjustments",
    "live_data", "redline", "service", "warmup", "zf8hp",
}
PLATFORM_ID8 = {
    "de.bmw.infotainment.hmi.entrypoint2.EntryPoint2",
    "de.bmw.infotainment.hmi.entrypoint2.EntryPointManager2",
    "de.bmw.infotainment.hmi.remote2.RemoteHmi2",
    "de.bmw.infotainment.hmi.remote2.RemoteHmiApplication2",
    "de.bmw.infotainment.hmi.resourcemanagement2.ResourceManager2",
    "de.bmw.infotainment.hmi.resourcemanagement2.ResourceBundle2",
    "de.bmw.infotainment.hmi.resourcemanagement2.StringBundle2",
    "de.bmw.infotainment.hmi.usecasemanagement.UseCaseContext",
    "de.bmw.infotainment.telematic.oap.PrivateEntryPoint2",
    "de.bmw.infotainment.telematic.provisioning.Provisioning",
}
GATEWAY_PERMISSIONS = {
    "com.bmwgroup.appgateway.entrypoint", "com.bmwgroup.appgateway.rhmi",
    "com.bmwgroup.appgateway.resourcemanager", "com.bmwgroup.appgateway.usecasecontext",
    "com.bmwgroup.appgateway.provisioning",
}
SOURCE_FILES = (
    "kit/tools/build.py", "kit/tools/localize.py", "kit/runtime/mgu.js",
    "kit/platform/permissions.json", "kit/tools/test_id8_ui.py",
    "kit/tools/test_fit_to_unit.py", "LICENSE",
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def load_builder():
    # Keep the original builder's sibling imports isolated from other kits.
    prior_path = sys.path[:]
    prior_modules = {name: sys.modules.pop(name, None) for name in ("pack_data", "localize")}
    try:
        spec = importlib.util.spec_from_file_location("aq_cauli_native_builder", SOURCE / "kit/tools/build.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path[:] = prior_path
        for name, previous in prior_modules.items():
            sys.modules.pop(name, None)
            if previous is not None:
                sys.modules[name] = previous


def app_specs():
    result = {}
    for file in sorted((SOURCE / "apps").glob("*/app.json")):
        spec = json.loads(file.read_text(encoding="utf-8"))
        spec.setdefault("id", file.parent.name)
        result[spec["id"]] = spec
    return result


def render_both(builder, spec):
    outputs = {}
    for hmi in ("ID7", "ID8"):
        xml, ui, strings, state_ids = builder.build_ui(deepcopy(spec), "en", hmi)
        prefix = "SID_CN_STATIC8_" if hmi == "ID8" else "SID_CN_STATIC_"
        builder.unicode_resources(ui, strings, "en", prefix=prefix)
        outputs[hmi] = {"xml": xml, "ui": ui, "strings": strings, "state_ids": state_ids}
    return outputs


def resource_fingerprints(outputs):
    return {hmi: {"application_xml_sha256": sha256(value["xml"].encode()),
                  "ui_description_sha256": sha256(json_bytes(value["ui"])),
                  "strings_sha256": sha256(json_bytes(value["strings"])),
                  "states": value["state_ids"]}
            for hmi, value in outputs.items()}


class NativeId8AppsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder = load_builder()
        cls.specs = app_specs()
        cls.rendered = {cid: render_both(cls.builder, spec) for cid, spec in cls.specs.items()}
        cls.source_rows = json.loads((ROOT / "mgu-repo.json").read_text())["components"]
        cls.inventory = {row["id"]: row for row in json.loads((ROOT / "data/components.json").read_text())["components"]}
        cls.evidence = json.loads(EVIDENCE.read_text())

    def test_catalog_support_matches_each_original_app_and_keeps_identity(self):
        self.assertEqual(set(self.specs), APP_IDS)
        rows = {row["id"]: row for row in self.source_rows if row["id"] in APP_IDS}
        self.assertEqual(set(rows), APP_IDS)
        for cid, source in self.specs.items():
            with self.subTest(app=cid):
                self.assertEqual(source["mguHmi"], ["ID7", "ID8"])
                self.assertEqual(rows[cid]["mguHmi"], source["mguHmi"])
                self.assertEqual(self.inventory[cid]["supported_hmi"], source["mguHmi"])
                self.assertEqual(rows[cid]["version"], source["version"])
                self.assertEqual(self.inventory[cid]["version"], source["version"])
                self.assertEqual(rows[cid]["requires"], source.get("requires", {}))

    def test_native_layouts_keep_state_ids_and_generate_real_id8_widgets(self):
        allowed = {"LT_State_Wide_List", "LT_Button_MediaEntry_1Row", "LT_ScrollLabel"}
        for cid, outputs in self.rendered.items():
            with self.subTest(app=cid):
                old, new = outputs["ID7"], outputs["ID8"]
                self.assertEqual(old["state_ids"], new["state_ids"])
                components = lambda ui: [c for container in ui["containers"].values()
                                         for c in container["components"].values()]
                old_components, new_components = components(old["ui"]), components(new["ui"])
                self.assertEqual({c["name"] for c in new_components},
                                 {c["name"] for c in old_components} | {self.builder.HMI8_MARK})
                widgets = set(re.findall(r'widget="([^"]+)"', new["xml"]))
                self.assertTrue(widgets)
                self.assertTrue(widgets <= allowed, widgets - allowed)
                self.assertIn("LT_State_Wide_List", new["xml"])
                self.assertNotIn('<property id="9"', new["xml"])
                self.assertFalse(any("ParentState" in c.get("properties", {}) for c in new["ui"]["containers"].values()))
                marks = [c for c in new_components if c["name"] == self.builder.HMI8_MARK]
                self.assertEqual(len(marks), 1)
                self.assertEqual(marks[0]["properties"]["Visible"]["value"], 0)
                for component in new_components:
                    if component["type"] == "button":
                        self.assertTrue({"PrimaryText", "FrequencyText", "FrequencyVisible"} <= component["rows"][0].keys())
                        self.assertFalse({"Text", "Text1stRow", "Text2ndRow"} & component["rows"][0].keys())
                combined = {**old["strings"], **new["strings"]}
                self.assertLessEqual(len(combined), 1024)
                for ui in (old["ui"], new["ui"]):
                    def check_strings(value):
                        if isinstance(value, dict):
                            if value.get("type") == "StringId":
                                self.assertIn(value["value"], combined)
                            for child in value.values():
                                check_strings(child)
                        elif isinstance(value, list):
                            for child in value:
                                check_strings(child)
                    check_strings(ui)

    def test_id7_and_id8_resource_fingerprints_preserve_the_pinned_source(self):
        observed = {item["id"]: item for item in self.evidence["apps"]}
        self.assertEqual(set(observed), APP_IDS)
        for cid, outputs in self.rendered.items():
            with self.subTest(app=cid):
                self.assertEqual(resource_fingerprints(outputs), observed[cid]["generated_resources"])
                self.assertEqual(sha256((SOURCE / "apps" / cid / "app.json").read_bytes()), observed[cid]["manifest_sha256"])
                self.assertEqual(self.specs[cid]["version"], observed[cid]["version"])

    def test_id8_platform_interfaces_and_original_gateway_permissions_are_present(self):
        permissions = json.loads((SOURCE / "kit/platform/permissions.json").read_text())
        grants = {item["domain"]: item for item in permissions["masterAccessTable"]}
        for domain in GATEWAY_PERMISSIONS:
            with self.subTest(domain=domain):
                self.assertIn(domain, grants)
                self.assertEqual(grants[domain]["uid"], "${APPNAME}")
                self.assertEqual(grants[domain]["defaultConsumerPermission"], "YES")
        for cid, spec in self.specs.items():
            manifest = self.builder.manifest_for(deepcopy(spec))
            with self.subTest(app=cid):
                self.assertTrue(PLATFORM_ID8 <= manifest["proxies"].keys())
                self.assertIn("de.bmw.infotainment.hmi.remote.RemoteHmi", manifest["proxies"])
                self.assertIn("de.bmw.infotainment.hmi.entrypoint.EntryPoint", manifest["proxies"])

    def test_runtime_cells_and_settings_use_the_installed_hmi_marker(self):
        # Evaluate only the original UI class and settings function, as the
        # upstream hu-stub does. No OnlineApp, app entrypoint or socket starts.
        script = r'''
const assert = require('assert'), fs = require('fs');
const text = fs.readFileSync(process.argv[1], 'utf8');
const cells = text.match(/const CELLS8 = [^;]+;/)[0];
const klass = text.match(/class Ui \{[\s\S]*?\n\}\n/)[0];
const Ui = new Function('log', 'HmiText', cells + klass + '\nreturn Ui;')(
    { info() {}, warn() {}, error() {}, debug() {} }, class { set() { return Promise.resolve(); } });
const wire = text.match(/function wireSettings[\s\S]*?\n}\n/)[0];
const wireSettings = new Function('listSheet', 'SPEC', 'settingsRows', wire + '\nreturn wireSettings;')(
    () => { throw new Error('unexpected renderer'); }, { version: 'fixture' }, []);
(async () => {
    for (const id8 of [false, true]) {
        const ui = new Ui({ rhmiApplication: { getByName: n => n === 'KIT_HMI_ID8' && id8 ? {} : null } });
        assert.strictEqual(ui.id8, id8);
        const button = { _uiDescription: { rows: [id8 ? { PrimaryText: {}, FrequencyText: {} } : { Text: {} }] } };
        const label = { _uiDescription: { rows: [{ Text: {} }] } };
        assert.strictEqual(ui._cell(button, 'Text'), id8 ? 'PrimaryText' : 'Text');
        assert.strictEqual(ui._cell(button, 'Text2ndRow'), id8 ? 'FrequencyText' : 'Text2ndRow');
        assert.strictEqual(ui._cell(label, 'Text'), 'Text');
        const calls = [], handlers = {}, values = { mode: 'a' };
        const testUi = { id8, comp: n => n === 'SET_MODE' ? {} : null,
            selected: (n, v) => { calls.push(['selected', v]); return Promise.resolve(); },
            cells: (n, row, v) => { calls.push(['cells', v]); return Promise.resolve(); },
            onClick: (n, fn) => { handlers[n] = fn; } };
        const settings = { schema: [{ key: 'mode', label: 'Mode', type: 'choice', options: [['a', 'A'], ['b', 'B']] }],
            get: k => values[k], set: (k, v) => { values[k] = v; }, cycle: k => { values[k] = values[k] === 'a' ? 'b' : 'a'; },
            display: k => values[k], onChange() {} };
        await wireSettings({ ui: testUi, settings, display: { sheet: null } });
        assert.strictEqual(calls[0][0], id8 ? 'cells' : 'selected');
        await handlers.SET_MODE({ row: id8 ? 0 : 1 });
        assert.strictEqual(values.mode, 'b');
    }
    console.log('native UI marker, button/label cells and ID7/ID8 settings PASS');
})().catch(error => { console.error(error); process.exit(1); });
'''
        result = subprocess.run(["node", "-e", script, str(SOURCE / "kit/runtime/mgu.js")],
                                check=False, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("settings PASS", result.stdout)

    def test_declared_and_builder_dependencies_support_both_hmis(self):
        release = json.loads((ROOT / "release/catalog.json").read_text())["components"]
        external = json.loads((ROOT / "data/external-store-components.json").read_text())["components"]
        available = {row["id"]: row for row in self.source_rows + release + external}
        versions = lambda value: tuple(int(part) for part in value.split("."))
        for cid in APP_IDS:
            pending = [(key, value) for key, value in available[cid].get("requires", {}).items()]
            # Original Store Python recipes also need the supplied Python and
            # deployment helpers; their minima are covered by Store's tests.
            pending.extend([("mgu-python", "0.0.0"), ("mgu-deploy", "0.0.0")])
            checked = set()
            while pending:
                dependency, minimum = pending.pop()
                with self.subTest(app=cid, dependency=dependency):
                    self.assertIn(dependency, available)
                    row = available[dependency]
                    self.assertGreaterEqual(versions(row["version"]), versions(minimum))
                    self.assertTrue({"ID7", "ID8"} <= set(row.get("mguHmi") or []))
                    if dependency not in checked:
                        pending.extend(row.get("requires", {}).items())
                        checked.add(dependency)

    def test_original_builder_packages_both_resources_with_inert_synthetic_sdk(self):
        # This checks the actual package assembly path, not an independently
        # reimplemented package template. It is deliberately NOT SDK proof.
        spec = self.specs["brake_test"]
        self.assertFalse(spec.get("assets"), "the smoke fixture must stay offline")
        self.assertTrue((SOURCE / "apps/brake_test/icon.png").is_file())
        marker = b"// SYNTHETIC TEST FIXTURE, NOT BMW SDK, DO NOT INSTALL\n"
        with tempfile.TemporaryDirectory(prefix="aq-cauli-id8-") as directory:
            temporary = Path(directory)
            sdk = temporary / "synthetic-sdk"
            sdk.mkdir()
            (sdk / "index.js").write_bytes(marker)
            (sdk / "package.json").write_text(json.dumps({"name": "aq-synthetic-sdk-fixture", "version": "0.0.0", "private": True}))
            dist = temporary / "output"
            with warnings.catch_warnings(record=True) as observed_warnings, \
                 patch.object(self.builder, "SDK", str(sdk)), patch.object(self.builder, "DIST", str(dist)), \
                 patch.object(self.builder, "UNIT_CATALOG", str(temporary / "no-unit-catalog.json")), \
                 patch("urllib.request.urlopen", side_effect=AssertionError("unexpected network")), redirect_stdout(io.StringIO()):
                warnings.simplefilter("always", ResourceWarning)
                self.builder.build("brake_test")
            # Retain the known original builder's unclosed-handle warnings as
            # evidence; do not change upstream source or bury other warnings.
            for warning in observed_warnings:
                self.assertTrue(issubclass(warning.category, ResourceWarning), str(warning.message))
                self.assertTrue(warning.filename.endswith("kit/tools/build.py"), warning.filename)
            type(self).synthetic_packaging_resource_warnings = len(observed_warnings)
            with tarfile.open(dist / ("brake_test@" + spec["version"] + ".tgz"), "r:gz") as archive:
                def read(name):
                    with archive.extractfile("package/" + name) as member:
                        return member.read()
                application = json.loads(read("rhmiData/application.json"))["application"]
                self.assertEqual([entry["hmi"] for entry in application["uiDescriptions"]], [["ID7"], ["ID8"]])
                for entry in application["uiDescriptions"]:
                    for key in ("applicationFilePath", "uiDescriptionFilePath"):
                        self.assertTrue(read("rhmiData/" + entry[key].removeprefix("./")))
                self.assertEqual(read("permissions.json"), (SOURCE / "kit/platform/permissions.json").read_bytes())
                self.assertTrue(PLATFORM_ID8 <= json.loads(read("manifest.json"))["proxies"].keys())
                self.assertEqual(read("node_modules/oap-sdk/index.js"), marker)
                config = json.loads(read("config/base.json"))
                self.assertTrue(config["rhmiLoadingEnabled"] and config["entryPointLoadingEnabled"])

    def test_missing_real_sdk_does_not_produce_an_installable_package(self):
        with tempfile.TemporaryDirectory(prefix="aq-cauli-no-sdk-") as directory:
            output = Path(directory) / "output"
            with patch.object(self.builder, "SDK", str(Path(directory) / "absent")), \
                 patch.object(self.builder, "DIST", str(output)), self.assertRaisesRegex(SystemExit, "BMW oap-sdk is missing"):
                self.builder.build("brake_test")
            self.assertFalse(output.exists())

    def test_evidence_retains_original_source_pin_and_no_live_claim(self):
        sources = json.loads((ROOT / "data/sources.json").read_text())["sources"]
        row = next(row for row in sources if row["repository"] == "cauliflowermossgrape/idrive7-apps")
        self.assertEqual(row["commit"], COMMIT)
        self.assertEqual(self.evidence["source_commit"], COMMIT)
        self.assertEqual(self.evidence["live_hu_install"], "NOT OBSERVED")
        self.assertEqual(self.evidence["real_sdk_build"], "NOT OBSERVED")
        for relative in SOURCE_FILES:
            with self.subTest(source=relative):
                self.assertEqual(sha256((SOURCE / relative).read_bytes()), self.evidence["source_sha256"][relative])


if __name__ == "__main__":
    unittest.main()
