"""Source-port checks only; SDK fixtures are synthetic and never distributed."""
from pathlib import Path
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import xml.etree.ElementTree as ET

PORT = Path(__file__).resolve().parents[1]
BASE = PORT.parents[1] / '_sources' / 'hexlay-idrive7-apps'
IDS = ('sys_monitor', 'spotify', 'm_copilot')


def builder(root, name):
    for item in ('localize', 'pack_data'):
        sys.modules.pop(item, None)
    spec = importlib.util.spec_from_file_location(name, root / 'kit/tools/build.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def components(ui):
    for container in ui['containers'].values():
        yield from container.get('components', {}).values()


class HexlayID8Port(unittest.TestCase):
    def test_id7_resources_unchanged_and_id8_templates_present(self):
        old, new = builder(BASE, 'hexlay_original_builder'), builder(PORT, 'hexlay_port_builder')
        for app_id in IDS:
            original = json.loads((BASE / 'apps' / app_id / 'app.json').read_text())
            adapted = json.loads((PORT / 'apps' / app_id / 'app.json').read_text())
            self.assertEqual(original['id'], adapted['id'])
            self.assertEqual(original['version'], adapted['version'])
            for language in ('en', 'zh-CN'):
                with self.subTest(app=app_id, language=language):
                    spec = new.localize_spec(original, language)
                    self.assertEqual(old.build_ui(spec, language), new.build_ui(spec, language))
                    xml7, ui7, strings7, states7 = new.build_ui(spec, language)
                    xml8, ui8, strings8, states8 = new.build_ui(spec, language, 'ID8')
                    ET.fromstring(xml7)
                    ET.fromstring(xml8)
                    self.assertEqual(states7, states8)
                    self.assertNotIn('ParentState', json.dumps(ui8))
                    names = {c.get('name') for c in components(ui8)}
                    self.assertIn('KIT_HMI_ID8', names)
                    widgets = {element.attrib['widget'] for element in ET.fromstring(xml8).iter() if 'widget' in element.attrib}
                    self.assertTrue(widgets <= {'LT_State_Wide_List', 'LT_Button_MediaEntry_1Row', 'LT_ScrollLabel'})
                    self.assertIn('LT_State_Wide_List', widgets)

    def test_real_builder_creates_three_dual_packages_with_synthetic_sdk(self):
        with tempfile.TemporaryDirectory(prefix='aq-hexlay-id8-test-') as name:
            root = Path(name) / 'source'
            shutil.copytree(PORT, root, ignore=shutil.ignore_patterns('tests', '__pycache__', 'dist'))
            sdk = root / 'oap-sdk'
            sdk.mkdir()
            (sdk / 'index.js').write_text("throw new Error('Synthetic test fixture, not an OEM SDK');\n")
            (sdk / 'package.json').write_text(json.dumps({'name':'oap-sdk', 'version':'50.0.0-synthetic', 'synthetic':True}))
            result = subprocess.run([sys.executable, '-B', str(root / 'kit/tools/build.py'), *IDS], cwd=root,
                env={'PATH':os.environ.get('PATH', ''), 'PYTHONDONTWRITEBYTECODE':'1', 'MGU_SOMEIP_CATALOG':str(root / 'no-unit-catalog.json')},
                text=True, capture_output=True, timeout=40)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            for app_id in IDS:
                version = json.loads((PORT / 'apps' / app_id / 'app.json').read_text())['version']
                with self.subTest(app=app_id), tarfile.open(root / 'dist' / (app_id + '@' + version + '.tgz')) as archive:
                    def read(rel):
                        return archive.extractfile('package/' + rel).read()
                    package = json.loads(read('package.json'))
                    self.assertEqual((package['name'], package['version']), (app_id, version))
                    self.assertEqual(package['mguHmi'], ['ID7', 'ID8'])
                    self.assertEqual(package['aqSourcePort']['revision'], 'aq-hexlay-id8-2')
                    self.assertEqual(package['requires'], {'mgu-render': '0.6.24'})
                    self.assertEqual(package['mguNeeds'], ['renderer'])
                    for license_name in ('LICENSE', 'LICENSE.MIT', 'LICENSE.PEREA', 'PORT.json'):
                        self.assertEqual(read(license_name), (PORT / license_name).read_bytes())
                    manifest = json.loads(read('manifest.json'))
                    self.assertIn('de.bmw.infotainment.hmi.remote2.RemoteHmiApplication2', manifest['proxies'])
                    if app_id == 'm_copilot':
                        condition = manifest['proxies']['de.bmw.infrastructure.VehicleCondition']
                        self.assertEqual(condition['attributes']['VehicleCondition'], 'rs')
                        self.assertEqual(condition.get('methods', []), [])
                    app = json.loads(read('rhmiData/application.json'))['application']
                    self.assertEqual([d['hmi'] for d in app['uiDescriptions']], [['ID7'], ['ID8']])
                    self.assertEqual(app['variantGroups'][0]['hmi'], ['ID7', 'ID8'])
                    for hmi in ('ID7', 'ID8'):
                        ET.fromstring(read('rhmiData/uiDescriptions/' + hmi + '/application.xml'))
                        json.loads(read('rhmiData/uiDescriptions/' + hmi + '/uiDescription.json'))
                    strings = json.loads(read('rhmiData/variantGroups/Common/texts/en_GB.json'))
                    self.assertLessEqual(len(strings), 1024)
                    self.assertEqual(read('javascript/app.js'), (PORT / 'apps' / app_id / 'main.js').read_bytes())
                    self.assertEqual(read('javascript/kit/id8_lifecycle.js'), (PORT / 'kit/runtime/id8_lifecycle.js').read_bytes())
                    if app_id == 'm_copilot':
                        self.assertEqual(read('javascript/id8_read_guard.js'), (PORT / 'apps/m_copilot/id8_read_guard.js').read_bytes())
                    self.assertTrue(read('rhmiData/variantGroups/Common/images/' + app_id + '_icon.png').startswith(b'\x89PNG\r\n\x1a\n'))
                    self.assertTrue(json.loads(read('node_modules/oap-sdk/package.json'))['synthetic'])

    def test_read_state_getter_permission_is_narrowed_to_target_catalog(self):
        module = builder(PORT, 'hexlay_read_guard_manifest_builder')
        spec = json.loads((PORT / 'apps/m_copilot/app.json').read_text())
        iface, field = 'de.bmw.infrastructure.VehicleCondition', 'VehicleCondition'
        self.assertEqual(spec['signals'][iface][field], 'rs')
        requested = module.manifest_for(json.loads(json.dumps(spec)))
        self.assertEqual(requested['proxies'][iface]['attributes'][field], 'rs')
        self.assertEqual(requested['proxies'][iface].get('methods', []), [])
        # Local metadata fixture only: no system catalog or vehicle is consulted.
        with tempfile.TemporaryDirectory(prefix='aq-hexlay-getter-test-') as name:
            catalog_path = Path(name) / 'catalog.json'
            for has_getter, expected in ((True, 'rs'), (False, 's')):
                with self.subTest(getter=has_getter):
                    catalog = {'interfaces': {iface: {'fields': {
                        field: {'getter': has_getter, 'notifier': True}}}},
                        'instanceIDs': {iface: {'1': 1}}}
                    catalog_path.write_text(json.dumps(catalog))
                    narrowed, missing = module.fit_to_unit(
                        json.loads(json.dumps(requested)), [iface], str(catalog_path))
                    condition = narrowed['proxies'][iface]
                    self.assertEqual(condition['attributes'][field], expected)
                    self.assertEqual(condition.get('methods', []), [])
                    if has_getter:
                        self.assertNotIn(iface + ' ' + field, missing)
                    else:
                        self.assertIn('"s" only', missing[iface + ' ' + field])

    def test_actual_runtime_contract_uses_only_inert_services(self):
        result = subprocess.run(['node', str(PORT / 'tests/runtime_contract.js'), str(PORT), str(BASE)],
            text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        result = json.loads(result.stdout)
        self.assertEqual(result['status'], 'PASS')
        self.assertGreaterEqual(result['checks'], 82)


if __name__ == '__main__':
    unittest.main()
