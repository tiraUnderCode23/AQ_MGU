"""SDK-free tests of the AQ derived Engine Vitals ID8 source recipe.

These tests exercise generated resources and sandboxed adapters. They do not
build a runnable app, use a proprietary SDK, or contact a head unit.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import shutil
import tarfile
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(os.environ.get('AQ_TEST_REPO', Path(__file__).resolve().parents[1]))
ORIGINAL = ROOT / 'apps/_sources/pinguinooo-idrive7-apps'
PORT = Path(os.environ.get('AQ_PINGUINO_PORT_ROOT', ROOT / 'apps/_ports/pinguinooo-idrive8'))


def builder(folder, name):
    for module in ('pack_data', 'localize'):
        sys.modules.pop(module, None)
    spec = importlib.util.spec_from_file_location(name, folder / 'kit/tools/build.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PinguinoId8PortTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = builder(ORIGINAL, 'pinguino_before')
        cls.after = builder(PORT, 'pinguino_after')
        cls.spec = json.loads((PORT / 'apps/adam_vitals/app.json').read_text())

    def test_original_app_and_vehicle_guards_are_unchanged(self):
        files = [p for p in (ORIGINAL / 'apps/adam_vitals').rglob('*') if p.is_file()]
        self.assertEqual(len(files), 12)
        for file in files:
            with self.subTest(file=file.name):
                self.assertEqual(file.read_bytes(), (PORT / file.relative_to(ORIGINAL)).read_bytes())
        for path in ('kit/runtime/diag.js', 'kit/runtime/dids.js', 'kit/runtime/engine.js', 'kit/runtime/car.js'):
            self.assertEqual((ORIGINAL / path).read_bytes(), (PORT / path).read_bytes())
        self.assertEqual(self.spec['id'], 'adam_vitals')
        self.assertEqual(self.spec['version'], '0.2.0')
        self.assertEqual(sorted(p.name for p in (PORT / 'apps').iterdir()), ['adam_shiftlights', 'adam_vitals'])

    def test_complete_package_assembly_with_inert_synthetic_sdk(self):
        with tempfile.TemporaryDirectory(prefix='aq-vitals-package-') as directory:
            root = Path(directory) / 'source'
            shutil.copytree(PORT, root, ignore=shutil.ignore_patterns('__pycache__', 'dist'))
            sdk = root / 'oap-sdk'
            sdk.mkdir()
            (sdk / 'index.js').write_text("throw new Error('Synthetic inert packaging fixture; not a BMW SDK');\n")
            (sdk / 'package.json').write_text(json.dumps({'name': 'oap-sdk', 'version': '50.0.0-synthetic', 'synthetic': True}))
            result = subprocess.run([sys.executable, '-B', str(root / 'kit/tools/build.py'), 'adam_vitals'],
                cwd=root, text=True, capture_output=True, timeout=30,
                env={'PATH': os.environ.get('PATH', ''), 'PYTHONDONTWRITEBYTECODE': '1',
                     'MGU_SOMEIP_CATALOG': str(root / 'no-target-catalog.json')})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            with tarfile.open(root / 'dist/adam_vitals@0.2.0.tgz') as archive:
                def read(relative):
                    return archive.extractfile('package/' + relative).read()
                package = json.loads(read('package.json'))
                self.assertEqual((package['name'], package['version']), ('adam_vitals', '0.2.0'))
                self.assertEqual(package['mguHmi'], ['ID7', 'ID8'])
                self.assertEqual(package['aqSourcePort'], {'id': 'pinguinooo-idrive8', 'revision': '1',
                    'upstreamCommit': '82bea95add762c03d97070d2bd462bfd5fac429c'})
                app = json.loads(read('rhmiData/application.json'))['application']
                self.assertEqual([d['hmi'] for d in app['uiDescriptions']], [['ID7'], ['ID8']])
                for hmi in ('ID7', 'ID8'):
                    ET.fromstring(read('rhmiData/uiDescriptions/' + hmi + '/application.xml'))
                    json.loads(read('rhmiData/uiDescriptions/' + hmi + '/uiDescription.json'))
                self.assertEqual(read('javascript/app.js'), (PORT / 'apps/adam_vitals/main.js').read_bytes())
                for name in ('Pinguino-LICENSE.txt', 'Kit-LICENSE.txt', 'Kit-NOTICE.txt', 'Kit-NOTICE.zh-CN.txt', 'AQ-ID8-adaptation.txt'):
                    self.assertTrue(read('javascript/kit/licenses/' + name))
                self.assertTrue(json.loads(read('node_modules/oap-sdk/package.json'))['synthetic'])

    def test_id7_generated_resources_are_exactly_preserved(self):
        for language in ('en', 'zh-CN'):
            with self.subTest(language=language):
                self.assertEqual(self.before.build_ui(self.spec, language), self.after.build_ui(self.spec, language, 'ID7'))

    def test_id8_uses_real_widgets_cells_and_same_state_ids(self):
        xml7, ui7, xml8, ui8, strings, states = self.after.ui_resources(self.spec)
        self.assertEqual(states, {'MAIN': 1, 'SETTINGS': 11})
        self.assertEqual(self.after.build_ui(self.spec, hmi='ID8')[3], states)
        xml = ET.fromstring(xml8)
        self.assertTrue(all(x.get('widget') == 'LT_State_Wide_List' for x in xml.findall('container')))
        widgets = {x.get('widget') for x in xml.iter('component')}
        self.assertIn('LT_Button_MediaEntry_1Row', widgets)
        self.assertNotIn('LT_CheckBox_1Row', widgets)
        self.assertNotIn('LT_DropDown', widgets)
        comps = {c['name']: c for state in ui8['containers'].values() for c in state['components'].values()}
        self.assertEqual(comps['KIT_HMI_ID8']['properties']['Visible']['value'], 0)
        self.assertEqual(len(self.spec['settings']), 34)
        for setting in self.spec['settings']:
            c = comps['SET_' + setting['key'].upper()]
            self.assertEqual(c['type'], 'button')
            self.assertIn('PrimaryText', c['rows'][0])
            self.assertIn('FrequencyText', c['rows'][0])
        self.assertLessEqual(len(strings), 1024)
        self.assertTrue(any(key.startswith('SID_CN_STATIC8_') for key in strings))
        self.assertTrue(any(key.startswith('SID_CN_STATIC_') for key in strings))

    def test_real_package_resource_writer_stages_both_variants_without_sdk(self):
        x7, u7, x8, u8, strings, states = self.after.ui_resources(self.spec)
        app = {'schemaVersion': '1.3.0', 'application': {'name': self.spec['id'], 'version': self.spec['version']}}
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'rhmiData'
            self.after.write_package_rhmi(str(target), app, x7, u7, x8, u8, strings)
            desc = json.loads((target / 'application.json').read_text())['application']
            self.assertEqual([x['hmi'] for x in desc['uiDescriptions']], [['ID7'], ['ID8']])
            self.assertEqual(desc['variantGroups'][0]['hmi'], ['ID7', 'ID8'])
            for item in desc['uiDescriptions']:
                for key in ('applicationFilePath', 'uiDescriptionFilePath'):
                    self.assertTrue((target / item[key]).is_file())
            self.assertEqual(json.loads((target / 'uiDescriptions/ID8/uiDescription.json').read_text()), u8)
            self.assertEqual(json.loads((target / 'variantGroups/Common/texts/en_GB.json').read_text()), strings)
            self.assertFalse(any('oap-sdk' in str(p) for p in Path(tmp).rglob('*')))

    def test_manifest_preserves_vehicle_permissions_and_adds_only_id8_hmi_proxies(self):
        old = self.before.manifest_for(json.loads(json.dumps(self.spec)))
        new = self.after.manifest_for(json.loads(json.dumps(self.spec)))
        self.assertEqual(old['services'], new['services'])
        for name, definition in old['proxies'].items():
            self.assertEqual(definition, new['proxies'][name], name)
        extra = set(new['proxies']) - set(old['proxies'])
        self.assertEqual(extra, set(self.after.PLATFORM_PROXIES) - set(self.before.PLATFORM_PROXIES))
        self.assertEqual(len(extra), 9)
        self.assertTrue(all('hmi.' in name or name.endswith('PrivateEntryPoint2') for name in extra))

    def test_installed_package_keeps_all_source_and_donor_licenses(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.after.copy_installed_notices(tmp)
            target = Path(tmp) / 'licenses'
            self.assertEqual((target / 'Pinguino-LICENSE.txt').read_bytes(), (ORIGINAL / 'LICENSE').read_bytes())
            self.assertEqual((target / 'Kit-LICENSE.txt').read_bytes(), (ORIGINAL / 'kit/LICENSE').read_bytes())
            self.assertEqual((target / 'Kit-NOTICE.txt').read_bytes(), (ORIGINAL / 'kit/NOTICE').read_bytes())
            donor = (target / 'AQ-ID8-adaptation.txt').read_text()
            self.assertIn('Alex Perea', donor)
            self.assertIn('cauliflowermossgrape', donor)
            self.assertIn('Permission is hereby granted', donor)
            self.assertIn('5b758fad17761b8696989e2a4ffbfbfab4926b6f', donor)

    def test_sandboxed_runtime_and_signal_contracts(self):
        result = subprocess.run(['node', str(Path(__file__).with_name('pinguino_id8_contract.js')), str(PORT), str(ORIGINAL)],
                                capture_output=True, text=True, timeout=25)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PASS pinguino ID8 sandbox contracts', result.stdout)


if __name__ == '__main__':
    unittest.main()
