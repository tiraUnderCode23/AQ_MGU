"""Package/feed contract without executing a builder, SDK, archive or component.

Evaluate only the reviewed builders' package-metadata construction statements.
This catches absent app-level defaults hidden by feed-level dependency overrides.
"""
import ast
from copy import deepcopy
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
REVIEWED_IDS={'adam_vitals','adam_shiftlights','aref_explorer','aref_carcare','aref_carlyrics','parked_games'}


def package_metadata(entry,hmi):
    source=(ROOT/entry['build']['python']).read_text()
    tree=ast.parse(source)
    build=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='build')
    selected=[];record=False
    for statement in build.body:
        if isinstance(statement,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='pkg' for t in statement.targets):
            record=True
        if record and isinstance(statement,ast.Expr) and isinstance(statement.value,ast.Call):
            call=statement.value
            if (isinstance(call.func,ast.Attribute) and call.func.attr=='dump' and call.args and
                    isinstance(call.args[0],ast.Name) and call.args[0].id=='pkg'):
                break
        if record:selected.append(statement)
    if not selected:raise AssertionError('No reviewed package-metadata block')
    # Metadata is local dict/list construction only. Import/file/process access
    # would invalidate this extraction instead of widening the test sandbox.
    for statement in selected:
        for node in ast.walk(statement):
            if isinstance(node,(ast.Import,ast.ImportFrom,ast.With,ast.FunctionDef,ast.ClassDef)):
                raise AssertionError('Unexpected operation in package metadata')
            if isinstance(node,ast.Call):
                ok=(isinstance(node.func,ast.Name) and node.func.id in {'dict','list'}) or (
                    isinstance(node.func,ast.Attribute) and isinstance(node.func.value,ast.Name)
                    and node.func.value.id=='spec' and node.func.attr=='get')
                if not ok:raise AssertionError('Unexpected call in package metadata: '+ast.dump(node.func))
    spec=json.loads((ROOT/entry['path']/entry.get('manifest','app.json')).read_text())
    dual=entry['id'] in {'adam_vitals','adam_shiftlights','aref_explorer'}
    environment={'spec':deepcopy(spec),'ver':spec['version'],'app_id':entry['id'],
                 'package_hmis':['ID7','ID8'] if dual else [hmi],'selected_hmi':None if dual else hmi}
    code=ast.fix_missing_locations(ast.Module(body=selected,type_ignores=[]))
    exec(compile(code,'<reviewed-package-metadata>','exec'),{'__builtins__':{'dict':dict,'list':list}},environment)
    return environment['pkg']


class PortPackageMetadataTests(unittest.TestCase):
    def test_reviewed_ports_metadata_matches_feed_including_manifest_defaults(self):
        entries=json.loads((ROOT/'mgu-repo.json').read_text())['components']
        actual={e['id']:e for e in entries if e.get('id') in REVIEWED_IDS}
        self.assertEqual(set(actual),REVIEWED_IDS)
        for cid,entry in actual.items():
            for hmi in entry['mguHmi']:
                with self.subTest(id=cid,hmi=hmi):
                    pkg=package_metadata(entry,hmi)
                    self.assertEqual(pkg['name'],cid);self.assertEqual(pkg['version'],entry['version'])
                    self.assertEqual(pkg.get('requires',{}),entry.get('requires',{}))
                    self.assertEqual(pkg.get('mguNeeds',[]),entry.get('mguNeeds',[]))
                    self.assertIn(hmi,pkg['mguHmi']);self.assertTrue(set(pkg['mguHmi'])<=set(entry['mguHmi']))
                    self.assertIn('aqSourcePort',pkg)

if __name__=='__main__':unittest.main()
