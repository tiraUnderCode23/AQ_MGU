"""Exercise new source recipes, their real builders and notice-preserving wrapper."""

import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

from tools.build_extra_source_app import retained_package


ROOT = Path(__file__).resolve().parents[1]


class ExtraSourceAppsTests(unittest.TestCase):
    def test_imported_sources_match_reviewed_original_bytes(self):
        inventory = json.loads((ROOT / 'data/expansion-source-imports-20261119.json').read_text())
        for source in inventory['sources']:
            base = ROOT / source['path']
            expected = {row['path'] for row in source['files']}
            actual = {p.relative_to(base).as_posix() for p in base.rglob('*') if p.is_file()}
            self.assertEqual(actual, expected)
            for row in source['files']:
                with self.subTest(source=source['repository'], path=row['path']):
                    data = (base / row['path']).read_bytes()
                    self.assertEqual(len(data), row['bytes'])
                    self.assertEqual(hashlib.sha256(data).hexdigest(), row['sha256'])
                    self.assertEqual(hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest(), row['git_blob'])

    def test_complete_source_packages_include_game_modules_notices_and_correct_hmi(self):
        config = json.loads((ROOT / 'data/extra-source-builds.json').read_text())
        # Ask the pinned original Store for the real partial-download paths.
        # A build from the complete checkout can hide a missing shared input.
        parser = subprocess.run(['node', '-e', r'''
const fs = require('fs');
const sources = require('./tools/_sources/mgu-store/native/mgu-updater/js/sources.js');
const read = p => fs.promises.readFile(p).catch(e => { if (e.code === 'ENOENT') e.missing = true; throw e; });
sources.repoCatalog(read).then(c => {
  if (c.skipped.length) throw new Error(c.skipped.join('\n'));
  console.log(JSON.stringify(Object.fromEntries(c.components.map(e => [e.id, sources.partPaths(e)]))));
}).catch(e => { console.error(e.stack); process.exitCode = 1; });
'''], cwd=ROOT, text=True, capture_output=True, timeout=30)
        self.assertEqual(parser.returncode, 0, parser.stderr)
        selections = json.loads(parser.stdout)
        with tempfile.TemporaryDirectory(prefix='aq-extra-apps-') as directory:
            for recipe in config['recipes']:
                root = Path(directory) / recipe['id']
                root.mkdir()
                self.assertIsNotNone(selections[recipe['id']], 'unexpected whole-repository fallback')
                for selected in selections[recipe['id']]:
                    origin, destination = ROOT / selected, root / selected
                    if origin.is_dir():
                        shutil.copytree(origin, destination, dirs_exist_ok=True)
                    else:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(origin, destination)
                source = root / recipe['source_root']
                if recipe.get('requires_sdk', True):
                    sdk = source / recipe.get('sdk_path', 'oap-sdk')
                    sdk.mkdir(parents=True)
                    (sdk / 'index.js').write_text("throw new Error('Synthetic inert SDK-shaped packaging fixture');\n")
                    (sdk / 'package.json').write_text(json.dumps({'name': 'oap-sdk', 'version': '24.0.0-synthetic', 'synthetic': True}))
                with self.subTest(app=recipe['id']):
                    result = subprocess.run([sys.executable, '-B', str(root / 'tools/build_extra_source_app.py'), recipe['id']],
                        cwd=root, text=True, capture_output=True, timeout=45,
                        env={'PATH': os.environ.get('PATH', ''), 'PYTHONDONTWRITEBYTECODE': '1',
                             'MGU_SOMEIP_CATALOG': str(root / 'NO_TARGET_CATALOG.json')})
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    archive_path = source / recipe.get('output', 'dist/{id}@{version}.tgz').format(**recipe)
                    with tarfile.open(archive_path) as archive:
                        def read(name):
                            return archive.extractfile('package/' + name).read()
                        package = json.loads(read('package.json'))
                        self.assertEqual((package['name'], package['version']), (recipe['id'], recipe['version']))
                        self.assertEqual(package['mguHmi'], recipe['mguHmi'])
                        self.assertEqual(package['requires'], recipe['requires'])
                        if 'mguNeeds' in recipe:
                            self.assertEqual(package['mguNeeds'], recipe['mguNeeds'])
                        if recipe.get('mguInternet'):
                            self.assertTrue(package['mguInternet'])
                        self.assertEqual(package['aqSourcePackaging']['commit'], recipe['commit'])
                        self.assertFalse(package['aqSourcePackaging']['originalSourceModified'])
                        self.assertEqual(read('javascript/app.js'), (source / recipe['app_path'] / 'main.js').read_bytes())
                        for notice in recipe['notices']:
                            self.assertEqual(read('aq-notices/' + notice), (source / notice).read_bytes())
                        if recipe['id'] == 'parked_games':
                            games = {p.parent.name for p in (source / recipe['app_path'] / 'games').glob('*/index.js')}
                            self.assertEqual(len(games), 8)
                            for game in games:
                                self.assertEqual(read('javascript/games/' + game + '/index.js'),
                                    (source / recipe['app_path'] / 'games' / game / 'index.js').read_bytes())
                        if recipe.get('requires_sdk', True):
                            self.assertTrue(json.loads(read('node_modules/oap-sdk/package.json'))['synthetic'])
                        else:
                            self.assertFalse(any('oap-sdk' in Path(n).parts for n in archive.getnames()))
                            self.assertFalse((source / 'oap-sdk').exists())

    def test_wrapper_rejects_wrong_package_identity_and_hmi(self):
        with tempfile.TemporaryDirectory(prefix='aq-package-rejection-') as directory:
            root = Path(directory)
            (root / 'LICENSE').write_text('test notice')
            recipe = {'id': 'sample', 'version': '1.0.0', 'notices': ['LICENSE'],
                      'repository': 'test/original', 'commit': 'a' * 40, 'source_license': 'MIT',
                      'mguHmi': ['ID7'], 'requires': {}}
            for name, hmi in [('different', 'ID7'), ('sample', 'ID8')]:
                archive = root / 'sample.tgz'
                with tarfile.open(archive, 'w:gz') as tar:
                    for path, content in {
                        'package/package.json': {'name': name, 'version': '1.0.0'},
                        'package/rhmiData/application.json': {'application': {'uiDescriptions': [{'hmi': [hmi]}]}}
                    }.items():
                        data = json.dumps(content).encode()
                        info = tarfile.TarInfo(path)
                        info.size = len(data)
                        tar.addfile(info, io.BytesIO(data))
                before = archive.read_bytes()
                with self.subTest(name=name, hmi=hmi), self.assertRaises(ValueError):
                    retained_package(archive, recipe, root)
                self.assertEqual(archive.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
