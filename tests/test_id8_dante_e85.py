"""Dante E85 ID8: real local package/UI, pure accounting and inert live-read gates."""
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
from test_id8_aref_port import ROOT, load_builder

PORT = ROOT / 'apps/_ports/dante-idrive8'
ORIGINAL = ROOT / 'apps/_sources/dante-idrive-apps'
DIAG = 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu'

class DanteE85Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder = load_builder(PORT)
        cls.original = load_builder(ORIGINAL)
        cls.spec = json.loads((PORT / 'apps/e85/app.json').read_text())
        cls.upstream = json.loads((ORIGINAL / 'apps/e85/app.json').read_text())

    def test_id7_ui_identity_math_and_legacy_tank_are_preserved(self):
        for language in ('en', 'zh-CN'):
            spec = deepcopy(self.spec); spec['version'] = self.upstream['version']
            self.assertEqual(self.builder.build_ui(spec, language, 'ID7'), self.original.build_ui(deepcopy(self.upstream), language))
        self.assertEqual(self.spec['version'], '1.2.2'); self.assertEqual(self.spec['originalVersion'], '1.2.1')
        for name in ('blend.js', 'tank.js', 'icon.png'):
            self.assertEqual((PORT / 'apps/e85' / name).read_bytes(), (ORIGINAL / 'apps/e85' / name).read_bytes())

    def test_real_target_packages_resources_readonly_manifest_and_notices(self):
        for hmi in ('ID7', 'ID8'):
            with self.subTest(hmi=hmi), tempfile.TemporaryDirectory(prefix='aq-e85-') as d:
                tmp = Path(d); sdk = tmp / 'SYNTHETIC-NOT-BMW'; sdk.mkdir(); dist = tmp / 'out'
                (sdk / 'index.js').write_text('// SYNTHETIC TEST, DO NOT INSTALL\n')
                (sdk / 'package.json').write_text('{"name":"synthetic-test-sdk","version":"50.0.0"}')
                with patch.object(self.builder, 'SDK', str(sdk)), patch.object(self.builder, 'DIST', str(dist)), \
                     patch('urllib.request.urlopen', side_effect=AssertionError('No network')), \
                     redirect_stdout(io.StringIO()), warnings.catch_warnings():
                    warnings.simplefilter('ignore', ResourceWarning)
                    self.builder.build('e85', target_hmi=hmi)
                with tarfile.open(dist / 'e85@1.2.2.tgz') as ar:
                    def read(n):
                        with ar.extractfile('package/' + n) as f: return f.read()
                    pkg = json.loads(read('package.json')); self.assertEqual(pkg['mguHmi'], [hmi])
                    self.assertEqual(pkg['aqSourcePort']['originalVersion'], '1.2.1')
                    self.assertEqual(pkg['requires'], {'mgu-render':'0.6.24'})
                    self.assertEqual(pkg['mguNeeds'], ['renderer'])
                    manifest = json.loads(read('manifest.json'))
                    self.assertEqual(DIAG in manifest['proxies'], hmi == 'ID7')
                    self.assertIn('de.bmw.infotainment.KombiIF', manifest['proxies'])
                    r = json.loads(read('rhmiData/application.json'))['application']
                    self.assertEqual([a['hmi'] for a in r['uiDescriptions']], [[hmi]])
                    self.assertEqual([a['hmi'] for a in r['variantGroups']], [[hmi]])
                    spec = json.loads(read('javascript/kit/app-spec.json'))
                    keys = {a['key']: a for a in spec['settings']}
                    self.assertEqual('id8TankInput' in keys, hmi == 'ID8')
                    if hmi == 'ID8':
                        self.assertEqual(keys['demo']['default'], 'off')
                        self.assertNotIn('auto', [a[0] for a in keys['demo']['options']])
                        self.assertTrue(pkg['aqSourcePort']['unavailableFeatures'])
                    self.assertEqual(read('javascript/kit/AQ-LICENSE'), (PORT / 'LICENSE').read_bytes())
                    self.assertEqual(read('javascript/kit/LICENSE.alexpereap'), (PORT / 'kit/LICENSE.alexpereap').read_bytes())
                    self.assertEqual(read('javascript/tank_id8.js'), (PORT / 'apps/e85/tank_id8.js').read_bytes())
                with tarfile.open(dist / 'e85@1.2.2.mgu') as ar:
                    self.assertEqual(json.load(ar.extractfile('meta.json'))['mguHmi'], [hmi])

    def test_unknown_and_ambiguous_hmi_do_not_create_archives(self):
        for paths in ([], ['oap-mainapp', 'oap-mainapp21']):
            with tempfile.TemporaryDirectory(prefix='aq-e85-target-') as d:
                tmp = Path(d)
                for path in paths: (tmp / path).mkdir()
                with patch.object(self.builder, 'MAINAPP_ROOT', str(tmp)), patch.object(self.builder, 'DIST', str(tmp / 'out')), \
                     warnings.catch_warnings(), self.assertRaisesRegex(ValueError, 'unknown or ambiguous'):
                    warnings.simplefilter('ignore', ResourceWarning)
                    self.builder.build('e85')
                self.assertFalse(list(tmp.rglob('*.tgz')))

    def fixture(self, scenario):
        r = subprocess.run(['node', str(ROOT / 'tests/fixtures/tests_id8_dante_e85.js'), str(ROOT), scenario], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stdout+r.stderr); self.assertIn('PASS '+scenario, r.stdout)

    def test_kombi_provider_invalid_stale_shutdown_and_recovery(self): self.fixture('tank')
    def test_actual_main_manual_calculation_accounting_and_missing_provider(self): self.fixture('main')
    def test_original_math_volume_ethanol_cost_and_measured_fill_guards(self): self.fixture('math')

    def test_actual_readonly_adapter_failure_recovery_and_stopped_provider(self):
        r = subprocess.run(['node', str(ROOT/'tests/fixtures/tests_id8_readonly_adapter.js'), str(ROOT),
                            'adapter', 'apps/_ports/dante-idrive8'], capture_output=True, text=True, timeout=25)
        self.assertEqual(r.returncode, 0, r.stdout+r.stderr)

    def test_actual_platform_lifecycle_geometry_and_loaded_hmi_marker(self):
        payload = {'spec': self.spec, 'ui': {h: self.builder.build_ui(deepcopy(self.spec), 'en', h)[1] for h in ('ID7', 'ID8')}}
        # Generic UI assertions use the existing Explorer-like test screen.
        screen = json.loads((ROOT/'apps/_sources/arefahmad-idrive7-apps/apps/aref_explorer/app.json').read_text())
        payload = {'spec':screen, 'ui':{h:self.builder.build_ui(deepcopy(screen),'en',h)[1] for h in ('ID7','ID8')}}
        for scenario in ('ui','image','foreground','background','id7','visibility','display'):
            r = subprocess.run(['node',str(ROOT/'tests/fixtures/tests_id8_extra_platform.js'),str(ROOT),scenario,
                                'apps/_ports/dante-idrive8','apps/_sources/dante-idrive-apps'],input=json.dumps(payload),capture_output=True,text=True,timeout=25)
            self.assertEqual(r.returncode,0,scenario+'\n'+r.stdout+r.stderr)

if __name__ == '__main__': unittest.main()
