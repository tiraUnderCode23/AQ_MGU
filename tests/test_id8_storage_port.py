"""Storage ID8 port: real packages/lifecycle, mocked df only; no filesystem probing."""
from contextlib import redirect_stdout
from copy import deepcopy
import io,json,subprocess,tarfile,tempfile,unittest,warnings
from pathlib import Path
from unittest.mock import patch
from test_id8_aref_port import ROOT,load_builder
PORT=ROOT/'apps/_ports/bmwenthusiast-idrive8';ORIGINAL=ROOT/'apps/_sources/bmwenthusiast-storage-monitor'
APP='ab_storage'
class StorageId8Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder=load_builder(PORT);cls.original=load_builder(ORIGINAL)
        cls.spec=json.loads((PORT/'apps'/APP/'app.json').read_text());cls.upstream=json.loads((ORIGINAL/'apps'/APP/'app.json').read_text())

    def test_original_id7_ui_identity_manual_start_and_no_vehicle_backend(self):
        for language in ('en','zh-CN','ru'):
            spec=deepcopy(self.spec);spec['version']=self.upstream['version']
            self.assertEqual(self.builder.build_ui(spec,language,'ID7'),self.original.build_ui(deepcopy(self.upstream),language))
        self.assertEqual(self.spec['version'],'1.2.4');self.assertEqual(self.spec['originalVersion'],'1.2.3')
        self.assertEqual(self.spec['startType'],'manually');self.assertFalse(self.spec.get('signals'))
        self.assertFalse(self.spec.get('startWidget'))

    def test_real_target_packages_matching_resources_dependencies_and_manual_start(self):
        for hmi in ('ID7','ID8'):
            with self.subTest(hmi=hmi),tempfile.TemporaryDirectory(prefix='aq-storage-') as d:
                tmp=Path(d);sdk=tmp/'SYNTHETIC-NOT-BMW';sdk.mkdir();dist=tmp/'out'
                (sdk/'index.js').write_text('// SYNTHETIC TEST ONLY, DO NOT INSTALL\n');(sdk/'package.json').write_text('{"name":"synthetic-sdk","version":"50.0.0"}')
                with patch.object(self.builder,'SDK',str(sdk)),patch.object(self.builder,'DIST',str(dist)), \
                     patch('urllib.request.urlopen',side_effect=AssertionError('No network')),warnings.catch_warnings(),redirect_stdout(io.StringIO()):
                    warnings.simplefilter('ignore',ResourceWarning);self.builder.build(APP,target_hmi=hmi)
                with tarfile.open(dist/'ab_storage@1.2.4.tgz') as ar:
                    def read(n):
                        with ar.extractfile('package/'+n) as f:return f.read()
                    pkg=json.loads(read('package.json'));self.assertEqual(pkg['mguHmi'],[hmi]);self.assertEqual(pkg['mguAppStartType'],'manually')
                    self.assertEqual(pkg['requires'],{'mgu-render':'0.6.24'});self.assertEqual(pkg['license'],'MIT')
                    self.assertEqual(pkg['aqSourcePort']['originalVersion'],'1.2.3')
                    self.assertEqual(pkg['mguNeeds'],['renderer'])
                    rhmi=json.loads(read('rhmiData/application.json'))['application']
                    self.assertEqual([x['hmi'] for x in rhmi['uiDescriptions']],[[hmi]])
                    self.assertEqual([x['hmi'] for x in rhmi['variantGroups']],[[hmi]])
                    self.assertEqual(read('LICENSE'),(ORIGINAL/'LICENSE').read_bytes())
                    self.assertEqual(read('THIRD_PARTY_LICENSES'),(ORIGINAL/'THIRD_PARTY_LICENSES').read_bytes())
                    self.assertEqual(read('LICENSE.kit'),(ORIGINAL/'kit/LICENSE').read_bytes())
                    self.assertEqual(read('javascript/kit/LICENSE.alexpereap'),(PORT/'kit/LICENSE.alexpereap').read_bytes())
                    self.assertEqual(read('javascript/app.js'),(PORT/'apps'/APP/'main.js').read_bytes())
                    self.assertFalse(any('rhmiDataStartWidget' in n for n in ar.getnames()))
                with tarfile.open(dist/'ab_storage@1.2.4.mgu') as ar:self.assertEqual(json.load(ar.extractfile('meta.json'))['mguHmi'],[hmi])

    def test_unknown_or_ambiguous_hmi_rejected(self):
        for dirs in ([],['oap-mainapp','oap-mainapp21']):
            with tempfile.TemporaryDirectory(prefix='aq-storage-hmi-') as d:
                tmp=Path(d)
                for name in dirs:(tmp/name).mkdir()
                with patch.object(self.builder,'MAINAPP_ROOT',str(tmp)),patch.object(self.builder,'DIST',str(tmp/'out')), \
                     self.assertRaisesRegex(ValueError,'unknown or ambiguous'):
                    self.builder.build(APP)
                self.assertFalse(list(tmp.rglob('*.tgz')))

    def fixture(self,scenario):
        r=subprocess.run(['node',str(ROOT/'tests/fixtures/tests_id8_storage.js'),str(ROOT),scenario],capture_output=True,text=True,timeout=25)
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
    def test_actual_df_parser_bad_values_unavailable_and_duplicate_mounts(self):self.fixture('parser')
    def test_actual_main_visible_only_async_polling_and_shutdown(self):self.fixture('lifecycle')
    def test_actual_main_already_visible_start_renders(self):self.fixture('initial')

    def test_actual_id8_platform_lifecycle_fallback_cells_and_application_area(self):
        spec=json.loads((ROOT/'apps/_sources/arefahmad-idrive7-apps/apps/aref_explorer/app.json').read_text())
        payload={'spec':spec,'ui':{h:self.builder.build_ui(deepcopy(spec),'en',h)[1] for h in ('ID7','ID8')}}
        for scenario in ('ui','image','foreground','background','id7','visibility','display','inactive'):
            r=subprocess.run(['node',str(ROOT/'tests/fixtures/tests_id8_storage_platform.js'),str(ROOT),scenario,
                'apps/_ports/bmwenthusiast-idrive8','apps/_sources/bmwenthusiast-storage-monitor'],input=json.dumps(payload),capture_output=True,text=True,timeout=25)
            self.assertEqual(r.returncode,0,scenario+'\n'+r.stdout+r.stderr)
if __name__=='__main__':unittest.main()
