"""Offline build/runtime proof for the AQ Parked Games source port. No unit I/O."""
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

PORT = ROOT / 'apps/_ports/maxxxfoka-idrive8'
ORIGINAL = ROOT / 'apps/_sources/maxxxfoka-idrive7games'
APP = 'parked_games'
CCU = 'de.bmw.infotainment.controlelements.FrontCCU'


class ParkedGamesId8Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder = load_builder(PORT)
        cls.original = load_builder(ORIGINAL)
        cls.spec = json.loads((PORT / 'apps' / APP / 'app.json').read_text())
        cls.upstream = json.loads((ORIGINAL / 'apps' / APP / 'app.json').read_text())

    def test_original_id7_ui_and_explicit_aq_revision(self):
        for language in ('en', 'zh-CN', 'ru', 'ko'):
            with self.subTest(language=language):
                # Version changes belong to AQ; layout and identity remain original.
                spec = deepcopy(self.spec); spec['version'] = self.upstream['version']
                self.assertEqual(self.builder.build_ui(spec, language, 'ID7'),
                                 self.original.build_ui(deepcopy(self.upstream), language))
        self.assertEqual(self.spec['version'], '0.2.3')
        self.assertEqual(self.spec['originalVersion'], '0.2.2')
        self.assertEqual(self.spec['mguHmi'], ['ID7', 'ID8'])
        self.assertEqual(self.spec['requires'], {'mgu-render': '0.6.24'})
        self.assertEqual(self.spec['id'], self.upstream['id'])

    def test_actual_target_packages_keep_eight_games_and_target_specific_manifest(self):
        for hmi in ('ID7', 'ID8'):
            with self.subTest(hmi=hmi), tempfile.TemporaryDirectory(prefix='aq-games-package-') as d:
                tmp = Path(d); sdk = tmp / 'SYNTHETIC-NOT-BMW-SDK'; sdk.mkdir(); dist = tmp / 'out'
                marker = b'// SYNTHETIC TEST, DO NOT INSTALL\n'
                (sdk / 'index.js').write_bytes(marker)
                (sdk / 'package.json').write_text('{"name":"synthetic-test-sdk","version":"50.0.0"}')
                with patch.object(self.builder, 'SDK', str(sdk)), patch.object(self.builder, 'DIST', str(dist)), \
                     patch('urllib.request.urlopen', side_effect=AssertionError('Network forbidden')), \
                     warnings.catch_warnings(), redirect_stdout(io.StringIO()):
                    warnings.simplefilter('ignore', ResourceWarning)
                    self.builder.build(APP, target_hmi=hmi)
                with tarfile.open(dist / 'parked_games@0.2.3.tgz', 'r:gz') as ar:
                    def read(name):
                        with ar.extractfile('package/' + name) as f:
                            return f.read()
                    pkg = json.loads(read('package.json'))
                    self.assertEqual(pkg['mguHmi'], [hmi]); self.assertEqual(pkg['aqSourcePort']['originalVersion'], '0.2.2')
                    self.assertEqual(read('node_modules/oap-sdk/index.js'), marker)
                    manifest = json.loads(read('manifest.json'))
                    self.assertEqual(CCU in manifest['proxies'], hmi == 'ID7')
                    self.assertIn('de.bmw.infotainment.vehicle.Vehicle2', manifest['proxies'])
                    app = json.loads(read('rhmiData/application.json'))['application']
                    self.assertEqual([r['hmi'] for r in app['uiDescriptions']], [[hmi]])
                    self.assertEqual([r['hmi'] for r in app['variantGroups']], [[hmi]])
                    games = list((PORT / 'apps/parked_games/games').glob('*/index.js'))
                    self.assertEqual(len(games), 8)
                    for game in games:
                        self.assertEqual(read('javascript/games/' + game.parent.name + '/index.js'), game.read_bytes())
                    if hmi == 'ID8':
                        self.assertIn('KIT_HMI_ID8', read('rhmiData/uiDescriptions/ID8/uiDescription.json').decode())
                    self.assertEqual(read('javascript/kit/parked_id8.js'), (PORT / 'kit/runtime/parked_id8.js').read_bytes())
                    self.assertEqual(read('javascript/kit/AQ-LICENSE'), (PORT / 'LICENSE').read_bytes())
                    self.assertEqual(read('javascript/kit/LICENSE.alexpereap'), (PORT / 'kit/LICENSE.alexpereap').read_bytes())
                    settings = json.loads(read('config/base.json'))['settings'][APP]
                    self.assertTrue(settings['rhmiLoadingEnabled']); self.assertTrue(settings['entryPointLoadingEnabled'])

    def test_unknown_hmi_fails_before_installable_archive(self):
        with tempfile.TemporaryDirectory(prefix='aq-games-unknown-') as d:
            tmp = Path(d)
            with patch.object(self.builder, 'MAINAPP_ROOT', str(tmp)), patch.object(self.builder, 'DIST', str(tmp / 'out')), \
                 self.assertRaisesRegex(ValueError, 'unknown or ambiguous'):
                self.builder.build(APP, preview_only=True)
            self.assertFalse(list(tmp.rglob('*.tgz')))

    def run_fixture(self, scenario):
        result = subprocess.run(['node', str(ROOT / 'tests/fixtures/tests_id8_parked_games.js'), str(ROOT), scenario],
                                text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PASS ' + scenario, result.stdout)

    def test_guard_and_actual_game_shell_reject_unknown_stale_invalid_and_moving_speed(self):
        self.run_fixture('shell')

    def test_controller_dependent_multiplayer_is_explicitly_gated(self):
        self.run_fixture('multiplayer')

    def test_eight_publisher_pure_game_regressions(self):
        for game_test in sorted((PORT / 'apps/parked_games/games').glob('*/test.js')):
            with self.subTest(game=game_test.parent.name):
                result = subprocess.run(['node', str(game_test)], text=True, capture_output=True, timeout=40)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_actual_platform_lifecycle_cells_fallback_and_renderer_geometry(self):
        # A shared synthetic settings screen tests the generic platform modules;
        # the actual game's resources/package and entry are tested separately.
        spec = json.loads((ROOT / 'apps/_sources/arefahmad-idrive7-apps/apps/aref_explorer/app.json').read_text())
        payload = {'spec': spec, 'ui': {h: self.builder.build_ui(deepcopy(spec), 'en', h)[1] for h in ('ID7', 'ID8')}}
        for scenario in ('ui', 'image', 'foreground', 'background', 'id7', 'visibility', 'display'):
            with self.subTest(scenario=scenario):
                result = subprocess.run(['node', str(ROOT / 'tests/fixtures/tests_id8_extra_platform.js'), str(ROOT), scenario,
                                         'apps/_ports/maxxxfoka-idrive8', 'apps/_sources/maxxxfoka-idrive7games'],
                                        input=json.dumps(payload), text=True, capture_output=True, timeout=25)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
