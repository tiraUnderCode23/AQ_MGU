"""Actual AppStudio ID8 resources and offline runtime contracts.

Only disposable SDK-shaped throwing fixtures are packaged; no SDK code, vehicle
transport, installer, head unit, or personal data is used by these tests.
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
SNAPSHOT = ROOT / 'apps/_sources/app-studio-custom'
ORIGINAL = SNAPSHOT / 'projects/apps'
PORT = ROOT / 'apps/_ports/appstudio-idrive8'
APPS = ('bimmer_blocks', 'vehicle_pass')


def builder(folder, name):
    for module in ('pack_data', 'localize'):
        sys.modules.pop(module, None)
    description = importlib.util.spec_from_file_location(name, folder / 'kit/tools/build.py')
    module = importlib.util.module_from_spec(description)
    description.loader.exec_module(module)
    return module


class AppStudioId8PortTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = builder(ORIGINAL, 'appstudio_before')
        cls.after = builder(PORT, 'appstudio_after')
        cls.specs = {app: json.loads((PORT / 'apps' / app / 'app.json').read_text()) for app in APPS}

    def node(self, file, *args):
        result = subprocess.run(['node', str(ROOT / file), *map(str, args)], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def test_source_identity_and_original_application_algorithms(self):
        self.assertEqual(sorted(p.name for p in (PORT / 'apps').iterdir()), list(APPS))
        for app in APPS:
            before = json.loads((ORIGINAL / 'apps' / app / 'app.json').read_text())
            after = self.specs[app]
            self.assertEqual((before['version'], after['version'], after['aqOriginalVersion']), ('1.1.0', '1.1.1', '1.1.0'))
            self.assertEqual(after['signals'], before['signals'])
            for path in (ORIGINAL / 'apps' / app).iterdir():
                if path.name == 'app.json' or (app == 'bimmer_blocks' and path.name == 'main.js'):
                    continue
                with self.subTest(app=app, file=path.name):
                    self.assertEqual(path.read_bytes(), (PORT / 'apps' / app / path.name).read_bytes())
        self.assertEqual(self.specs['vehicle_pass']['signals'], {})
        self.assertEqual(self.specs['bimmer_blocks']['signals'], {'de.bmw.infotainment.vehicle.Vehicle2': {'statusCarSpeed2': 'rs'}})
        self.assertEqual((PORT / 'LICENSE').read_bytes(), (SNAPSHOT / 'PROJEKT-LIZENZ.txt').read_bytes())

    def test_id7_resource_output_is_preserved_for_the_patch_versions(self):
        for app, spec in self.specs.items():
            for language in ('en', 'de', 'ru', 'zh-CN'):
                with self.subTest(app=app, language=language):
                    self.assertEqual(self.before.build_ui(spec, language), self.after.build_ui(spec, language, 'ID7'))

    def test_id8_resources_have_actual_widgets_cells_and_same_states(self):
        for app, spec in self.specs.items():
            with self.subTest(app=app):
                xml7, ui7, xml8, ui8, strings, states = self.after.ui_resources(spec)
                self.assertEqual(self.after.build_ui(spec, hmi='ID7')[3], states)
                self.assertEqual(self.after.build_ui(spec, hmi='ID8')[3], states)
                root = ET.fromstring(xml8)
                self.assertTrue(all(node.get('widget') == 'LT_State_Wide_List' for node in root.findall('container')))
                widgets = {node.get('widget') for node in root.iter('component')}
                self.assertNotIn('LT_Graphic', widgets)
                self.assertNotIn('LT_CheckBox_1Row', widgets)
                self.assertNotIn('LT_DropDown', widgets)
                components = {node['name']: node for state in ui8['containers'].values() for node in state['components'].values()}
                self.assertEqual(components['KIT_HMI_ID8']['properties']['Visible']['value'], 0)
                self.assertEqual(components['MAIN_GFX']['type'], 'label')
                for setting in spec['settings']:
                    component = components['SET_' + setting['key'].upper()]
                    self.assertEqual(component['type'], 'button')
                    self.assertIn('PrimaryText', component['rows'][0])
                self.assertLessEqual(len(strings), 1024)

    def test_vehicle_manifest_remains_read_only_and_platform_contract_is_extended(self):
        for app, spec in self.specs.items():
            old = self.before.manifest_for(json.loads(json.dumps(spec)))
            new = self.after.manifest_for(json.loads(json.dumps(spec)))
            self.assertEqual(old['services'], new['services'])
            for name, value in old['proxies'].items():
                self.assertEqual(new['proxies'][name], value)
            extra = set(new['proxies']) - set(old['proxies'])
            self.assertEqual(extra, set(self.after.PLATFORM_PROXIES) - set(self.before.PLATFORM_PROXIES))
            self.assertEqual(len(extra), 9)
            self.assertTrue(all('hmi.' in name or name.endswith('PrivateEntryPoint2') for name in extra))
        self.assertEqual((PORT / 'kit/platform/permissions.json').read_bytes(), (ORIGINAL / 'kit/platform/permissions.json').read_bytes())

    def test_original_model_game_and_migration_tests_on_derived_sources(self):
        with tempfile.TemporaryDirectory(prefix='aq-studio-original-tests-') as temporary:
            target = Path(temporary)
            shutil.copytree(PORT / 'apps', target / 'bundled-apps')
            for name, success in [('test_blocks.js', 'block-game tests passed'), ('test_vehicle_pass.js', 'vehicle-pass model tests passed'),
                                  ('test_vehicle_profile.js', 'migration/profile/tyre tests passed')]:
                shutil.copy2(SNAPSHOT / name, target / name)
                result = subprocess.run(['node', str(target / name)], capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn(success, result.stdout)

    def test_complete_english_german_packages_with_inert_sdk_and_all_notices(self):
        with tempfile.TemporaryDirectory(prefix='aq-studio-id8-package-') as temporary:
            source = Path(temporary) / 'source'
            shutil.copytree(PORT, source, ignore=shutil.ignore_patterns('__pycache__', 'dist'))
            sdk = source / 'oap-sdk'; sdk.mkdir()
            (sdk / 'index.js').write_text("throw new Error('Inert synthetic package fixture, not a BMW SDK');\n")
            (sdk / 'package.json').write_text(json.dumps({'name': 'oap-sdk', 'version': '50.0.0-synthetic', 'synthetic': True}))
            for language in ('en', 'de'):
                result = subprocess.run([sys.executable, '-B', '-W', 'always::ResourceWarning', str(source / 'kit/tools/build.py'),
                                         '--language', language, *APPS], cwd=source, capture_output=True, text=True, timeout=40,
                                        env={'PATH': os.environ.get('PATH', ''), 'PYTHONDONTWRITEBYTECODE': '1',
                                             'MGU_SOMEIP_CATALOG': str(source / 'no-target-catalog.json')})
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertNotIn('ResourceWarning', result.stderr)
                for app in APPS:
                    archives = list((source / 'dist').glob(app + '@1.1.1' + ('' if language == 'en' else '-de.*') + '.tgz'))
                    self.assertEqual(len(archives), 1)
                    with tarfile.open(archives[0]) as archive:
                        def read(relative):
                            return archive.extractfile('package/' + relative).read()
                        package = json.loads(read('package.json'))
                        self.assertEqual(package['mguHmi'], ['ID7', 'ID8'])
                        self.assertEqual(package['name'], app)
                        self.assertEqual(package['requires'], self.specs[app]['requires'])
                        self.assertEqual(package['mguNeeds'], ['renderer'])
                        self.assertEqual(package['license'], 'MIT')
                        self.assertEqual(package['aqSourcePort'], {'id': 'appstudio-idrive8', 'revision': '1',
                                         'originalVersion': '1.1.0', 'upstreamSnapshot': 'AppStudio 2.4.0', 'upstreamGitCommit': None})
                        desc = json.loads(read('rhmiData/application.json'))['application']
                        self.assertEqual([row['hmi'] for row in desc['uiDescriptions']], [['ID7'], ['ID8']])
                        for row in desc['uiDescriptions']:
                            for key in ('applicationFilePath', 'uiDescriptionFilePath'):
                                self.assertTrue(row[key].startswith('./'))
                                payload = read('rhmiData/' + row[key][2:])
                                if key == 'applicationFilePath': ET.fromstring(payload)
                                else: json.loads(payload)
                        self.assertEqual(json.loads(read('javascript/kit/locale.json'))['language'], language)
                        for file in (PORT / 'apps' / app).glob('*.js'):
                            installed = 'app.js' if file.name == 'main.js' else file.name
                            self.assertEqual(read('javascript/' + installed), file.read_bytes())
                        self.assertEqual(read('javascript/kit/licenses/AppStudio-PROJEKT-LIZENZ.txt'), (PORT / 'LICENSE').read_bytes())
                        self.assertEqual(read('javascript/kit/licenses/AppStudio-THIRD-PARTY.txt'), (PORT / 'THIRD-PARTY.txt').read_bytes())
                        self.assertTrue(read('javascript/kit/licenses/AQ-ID8-adaptation.txt'))
                        self.assertTrue(read('javascript/kit/licenses/Pinguino-LICENSE.txt'))
                        if app == 'vehicle_pass':
                            self.assertEqual(read('javascript/LICENSE'), (PORT / 'apps/vehicle_pass/LICENSE').read_bytes())
                            self.assertEqual(read('javascript/NOTICE'), (PORT / 'apps/vehicle_pass/NOTICE').read_bytes())
                        if language == 'de':
                            self.assertEqual(read('javascript/kit/fonts/latin_de.json'), (PORT / 'kit/localization/fonts/latin-de.json').read_bytes())
                            self.assertEqual(read('javascript/kit/fonts/LICENSE-DejaVu.txt'), (PORT / 'kit/localization/fonts/LICENSE-DejaVu.txt').read_bytes())
                        self.assertTrue(json.loads(read('node_modules/oap-sdk/package.json'))['synthetic'])

    def test_real_runtime_lifecycle_touch_geometry_settings_and_fallbacks(self):
        self.assertIn('PASS AppStudio ID8 runtime', self.node('tests/appstudio_id8_runtime.js', PORT, ORIGINAL))

    def test_readonly_reader_bounds_getters_and_discards_late_or_old_provider_values(self):
        self.assertIn('PASS adapter', self.node('tests/fixtures/tests_id8_readonly_adapter.js', ROOT, 'adapter', PORT.relative_to(ROOT)))

    def test_real_game_main_preserves_guards_and_stops_on_untrusted_id8_speed(self):
        self.assertIn('PASS AppStudio application blocks', self.node('tests/appstudio_id8_apps.js', PORT, ORIGINAL, 'blocks'))

    def test_real_vehicle_pass_main_only_uses_local_user_records(self):
        self.assertIn('PASS AppStudio application vehiclePass', self.node('tests/appstudio_id8_apps.js', PORT, ORIGINAL, 'vehiclePass'))

    def test_supplemental_german_font_is_independent_of_display_language(self):
        self.assertIn('PASS AppStudio application font', self.node('tests/appstudio_id8_apps.js', PORT, ORIGINAL, 'font'))

    def test_provenance_keeps_local_origin_exact_hashes_and_honest_limits(self):
        meta = json.loads((PORT / 'AQ_PORT.json').read_text())
        self.assertIsNone(meta['source_repository'])
        self.assertIsNone(meta['source_git_commit'])
        self.assertEqual(meta['upstream_snapshot'], ORIGINAL.relative_to(ROOT).as_posix())
        self.assertEqual(meta['validation']['live_installation'], 'NOT_OBSERVED')
        for component in meta['components']:
            spec = self.specs[component['id']]
            self.assertEqual(component['version'], spec['version'])
            self.assertEqual(component['requires'], spec['requires'])
            self.assertEqual(component['mguNeeds'], spec['mguNeeds'])
        for row in meta['changed_original_files'] + meta['unchanged_app_files']:
            with self.subTest(path=row['path']):
                self.assertEqual(hashlib.sha256((PORT / row['path']).read_bytes()).hexdigest(), row['derived_sha256'])
                self.assertEqual(hashlib.sha256((ROOT / row['original_path']).read_bytes()).hexdigest(), row['original_sha256'])
        for row in meta['added_files']:
            with self.subTest(added=row['path']):
                data = (PORT / row['path']).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), row['sha256'])
                self.assertEqual(len(data), row['bytes'])
        self.assertEqual(hashlib.sha256((PORT / 'kit/runtime/readonly_signals.js').read_bytes()).hexdigest(), meta['shared_aq_reader']['sha256'])


if __name__ == '__main__':
    unittest.main()
