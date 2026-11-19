"""Dimon Track ID8 source/package/runtime checks; no target or native transport."""
from contextlib import redirect_stdout
from copy import deepcopy
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import warnings
from test_id8_aref_port import ROOT, load_builder
PORT=ROOT/'apps/_ports/dimonprograms-idrive8'
ORIGINAL=ROOT/'apps/_sources/dimonprograms-apps'
APP='dimon_track_mode'

class DimonTrackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder=load_builder(PORT);cls.original=load_builder(ORIGINAL)
        cls.spec=json.loads((PORT/'apps'/APP/'app.json').read_text())
        cls.upstream=json.loads((ORIGINAL/'apps'/APP/'app.json').read_text())

    def test_id7_ui_and_original_timer_demo_are_unchanged(self):
        for lang in ('en','zh-CN','ru','ko'):
            spec=deepcopy(self.spec);spec['version']=self.upstream['version']
            self.assertEqual(self.builder.build_ui(spec,lang,'ID7'),self.original.build_ui(deepcopy(self.upstream),lang))
        self.assertEqual(self.spec['version'],'1.0.1');self.assertEqual(self.spec['originalVersion'],'1.0.0')
        for name in ('lap.js','demo.js','icon.png'):
            self.assertEqual((PORT/'apps'/APP/name).read_bytes(),(ORIGINAL/'apps'/APP/name).read_bytes())
        self.assertFalse((PORT/'apps/dimon_battery').exists())

    def test_real_both_target_packages_dependency_and_source_contracts(self):
        for hmi in ('ID7','ID8'):
            with self.subTest(hmi=hmi),tempfile.TemporaryDirectory(prefix='aq-track-') as d:
                tmp=Path(d);sdk=tmp/'SYNTHETIC-TEST-SDK';sdk.mkdir();dist=tmp/'out'
                (sdk/'index.js').write_text('// SYNTHETIC TEST ONLY, NEVER INSTALL\n')
                (sdk/'package.json').write_text('{"name":"synthetic-sdk","version":"50.0.0"}')
                with patch.object(self.builder,'SDK',str(sdk)),patch.object(self.builder,'DIST',str(dist)), \
                     patch('urllib.request.urlopen',side_effect=AssertionError('No network')),warnings.catch_warnings(),redirect_stdout(io.StringIO()):
                    warnings.simplefilter('ignore',ResourceWarning);self.builder.build(APP,target_hmi=hmi)
                with tarfile.open(dist/'dimon_track_mode@1.0.1.tgz') as ar:
                    def read(n):
                        with ar.extractfile('package/'+n) as f:return f.read()
                    pkg=json.loads(read('package.json'));self.assertEqual(pkg['mguHmi'],[hmi]);self.assertEqual(pkg['requires'],{'mgu-render':'0.6.24'})
                    self.assertEqual(pkg['aqSourcePort']['originalVersion'],'1.0.0')
                    self.assertEqual(pkg['mguNeeds'],['renderer'])
                    manifest=json.loads(read('manifest.json'))
                    self.assertIn('de.bmw.infotainment.vehicle.Vehicle2',manifest['proxies'])
                    self.assertEqual('de.bmw.infotainment.vehicle.CDS2' in manifest['proxies'],hmi=='ID7')
                    r=json.loads(read('rhmiData/application.json'))['application']
                    self.assertEqual([x['hmi'] for x in r['uiDescriptions']],[[hmi]])
                    self.assertEqual([x['hmi'] for x in r['variantGroups']],[[hmi]])
                    spec=json.loads(read('javascript/kit/app-spec.json'))
                    if hmi=='ID8':
                        demo=next(s for s in spec['settings'] if s['key']=='demo')
                        self.assertEqual(demo['default'],'off');self.assertNotIn('auto',[x[0] for x in demo['options']])
                    self.assertEqual(read('javascript/speed_id8.js'),(PORT/'apps'/APP/'speed_id8.js').read_bytes())
                    self.assertEqual(read('javascript/kit/AQ-LICENSE'),(PORT/'LICENSE').read_bytes())
                with tarfile.open(dist/'dimon_track_mode@1.0.1.mgu') as ar:self.assertEqual(json.load(ar.extractfile('meta.json'))['mguHmi'],[hmi])

    def test_ambiguous_or_unknown_target_fails_before_archive(self):
        for dirs in ([],['oap-mainapp','oap-mainapp21']):
            with tempfile.TemporaryDirectory(prefix='aq-track-hmi-') as d:
                p=Path(d)
                for name in dirs:(p/name).mkdir()
                with patch.object(self.builder,'MAINAPP_ROOT',str(p)),patch.object(self.builder,'DIST',str(p/'out')), \
                     self.assertRaisesRegex(ValueError,'unknown or ambiguous'):
                    self.builder.build(APP,preview_only=True)
                self.assertFalse(list(p.rglob('*.tgz')))

    def fixture(self,scenario):
        r=subprocess.run(['node',str(ROOT/'tests/fixtures/tests_id8_dimon_track.js'),str(ROOT),scenario],capture_output=True,text=True,timeout=25)
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)

    def test_actual_main_manual_input_freshness_autostart_and_saved_statistics(self):self.fixture('main')
    def test_original_timer_laps_sectors_samples_and_manual_without_speed(self):self.fixture('timer')

    def test_actual_bounded_readonly_adapter(self):
        r=subprocess.run(['node',str(ROOT/'tests/fixtures/tests_id8_readonly_adapter.js'),str(ROOT),'adapter','apps/_ports/dimonprograms-idrive8'],capture_output=True,text=True,timeout=25)
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)

    def test_actual_platform_cells_lifecycle_and_native_geometry(self):
        spec=json.loads((ROOT/'apps/_sources/arefahmad-idrive7-apps/apps/aref_explorer/app.json').read_text())
        payload={'spec':spec,'ui':{h:self.builder.build_ui(deepcopy(spec),'en',h)[1] for h in ('ID7','ID8')}}
        for scenario in ('ui','image','foreground','background','id7','visibility','display'):
            r=subprocess.run(['node',str(ROOT/'tests/fixtures/tests_id8_extra_platform.js'),str(ROOT),scenario,
                'apps/_ports/dimonprograms-idrive8','apps/_sources/dimonprograms-apps'],input=json.dumps(payload),capture_output=True,text=True,timeout=25)
            self.assertEqual(r.returncode,0,scenario+'\n'+r.stdout+r.stderr)

if __name__=='__main__':unittest.main()
