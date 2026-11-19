"""Use the original Store packer on new unit sources and notice-complete tools.

No application, service, installer or vehicle operation is executed. Tool
payloads remain bytes in a temporary archive; unit apps remain unlinked source.
"""

import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

from tools.verify_release_artifacts import inspect_archive


ROOT = Path(__file__).resolve().parents[1]
UNIT_APPS = ('ida_vitals', 'ida_lightlog', 'ida_seatlights', 'esagono_settings')
TOOLS = ('ida-vitals-cluster', 'esagono-cluster', 'mgu-inputgate')
INPUTGATE_SHA256 = '56cd02ab5bd6e827ff151f2d24669e089dffad03ab663585c9da59d6d9c750eb'


class ExpansionNativePackageTests(unittest.TestCase):
    def test_original_packer_emits_complete_app_sources_and_licensed_tool_payloads(self):
        script = r'''
const fs = require('fs');
const path = require('path');
const sources = require('./tools/_sources/mgu-store/native/mgu-updater/js/sources.js');
const ids = JSON.parse(process.argv[1]);
const output = process.argv[2];
const read = p => fs.promises.readFile(p).catch(e => { if (e.code === 'ENOENT') e.missing = true; throw e; });
function walk(base, dir, files) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(base, p, files);
    else if (e.isFile()) files.push({name: path.relative(base, p).split(path.sep).join('/'),
        data: fs.readFileSync(p), mode: fs.statSync(p).mode});
    else throw new Error('unexpected non-file in source package');
  });
}
sources.repoCatalog(read).then(c => {
  if (c.skipped.length) throw new Error(c.skipped.join('\n'));
  const entries = ids.map(id => {
    const entry = c.components.find(e => e.id === id);
    if (!entry || entry.script) throw new Error('not a native source component: ' + id);
    const files = []; walk(entry.path, entry.path, files);
    fs.writeFileSync(path.join(output, id + '.tgz'), sources.packComponent(entry, files));
    return entry;
  });
  console.log(JSON.stringify(entries));
}).catch(e => { console.error(e.stack); process.exitCode = 1; });
'''
        with tempfile.TemporaryDirectory(prefix='aq-native-expansion-') as directory:
            result = subprocess.run(['node', '-e', script, json.dumps(UNIT_APPS + TOOLS), directory],
                                    cwd=ROOT, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            for entry in json.loads(result.stdout):
                with self.subTest(component=entry['id']):
                    archive = Path(directory) / (entry['id'] + '.tgz')
                    checked = inspect_archive(archive, entry)
                    self.assertFalse(checked['contains_donor_sdk'])
                    if entry['kind'] == 'app':
                        self.assertTrue(checked['source_build'])
                        self.assertEqual(checked['ui_hmi'], ['ID8'])
                        with tarfile.open(archive) as package:
                            self.assertIn('package/LICENSE', package.getnames())
                    else:
                        self.assertEqual(checked['package_requires'], entry['requires'])
                        with tarfile.open(archive) as package:
                            names = package.getnames()
                            self.assertIn('files/licenses/LICENSE', names)
                            self.assertIn('files/licenses/AQ-PACKAGING.json', names)
                            if entry['id'] == 'ida-vitals-cluster':
                                self.assertIn('files/licenses/OFL-Barlow.txt', names)
                            if entry['id'] == 'esagono-cluster':
                                self.assertEqual(checked['package_requires']['iteriodev-overlays'], '0.5.0')
                            if entry['id'] == 'mgu-inputgate':
                                self.assertEqual(checked['package_hmi'], ['ID7', 'ID8'])
                                self.assertEqual(checked['package_requires'], {'mgu-deploy': '0.3.2'})
                                original = ROOT / 'tools/_sources/cauli-inputgate-1.2.1/kit/renderd/inputgate/tool'
                                source = ROOT / 'tools/_packages/mgu-inputgate'
                                manifest = json.loads(package.extractfile('component.json').read())
                                self.assertEqual(manifest['version'], '1.2.2')
                                self.assertNotIn('build', manifest)
                                for field in ('enable', 'recmgr', 'restart'):
                                    self.assertEqual(manifest[field], [])
                                self.assertEqual({d['unit'] for d in manifest['dropins']},
                                                 {'hmi.service', 'hmi8.service'})
                                for record in manifest['files']:
                                    data = package.extractfile('files/' + record['path']).read()
                                    self.assertEqual(hashlib.sha256(data).hexdigest(), record['sha256'])
                                for record in json.loads((source / 'component.json').read_text())['files']:
                                    data = package.extractfile('files/' + record['path']).read()
                                    self.assertEqual(data, (source / (record.get('from') or record['path'])).read_bytes())
                                for name in ('mgu-inputgate-guard.service', 'mgu-inputgate-check.service'):
                                    self.assertEqual(package.extractfile('units/' + name).read(),
                                                     (original / name).read_bytes())
                                for unit in ('hmi.service', 'hmi8.service'):
                                    self.assertEqual(package.extractfile('dropins/' + unit + '.d/zz-mgu-inputgate.conf').read(),
                                                     (original / 'zz-mgu-inputgate.conf').read_bytes())
                                library = package.extractfile('files/mgu-inputgate.so').read()
                                self.assertEqual(len(library), 18848)
                                self.assertEqual(hashlib.sha256(library).hexdigest(), INPUTGATE_SHA256)

    def test_helper_runtime_and_service_bytes_remain_original(self):
        document = json.loads((ROOT / 'data/extra-tool-packaging.json').read_text())
        self.assertEqual({c['id'] for c in document['components']}, set(TOOLS))
        for component in document['components']:
            original = ROOT / component['original_path']
            packaged = ROOT / component['path']
            old = json.loads((original / 'component.json').read_text())
            for category, fallback in [('files', 'path'), ('units', 'name'), ('dropins', 'name')]:
                for record in old.get(category, []):
                    relative = record.get('from') or record[fallback]
                    self.assertEqual((original / relative).read_bytes(), (packaged / relative).read_bytes())
            for record in component['files']:
                data = (ROOT / record['path']).read_bytes()
                self.assertEqual(len(data), record['bytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(), record['sha256'])

    def test_inputgate_snapshot_matches_all_33_original_git_blobs(self):
        source = ROOT / 'tools/_sources/cauli-inputgate-1.2.1'
        proof = json.loads((ROOT / 'tools/_packages/mgu-inputgate/SOURCE-PROVENANCE.json').read_text())
        self.assertEqual(proof['commit'], '5555ef3bd2195aae15a8cec6803beeb40ca16456')
        self.assertEqual(proof['source_file_count'], 33)
        self.assertEqual(proof['source_bytes'], 188617)
        self.assertEqual({p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()},
                         {record['path'] for record in proof['files']})
        for record in proof['files']:
            with self.subTest(path=record['path']):
                data = (source / record['path']).read_bytes()
                self.assertEqual(len(data), record['bytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(), record['sha256'])
                git_blob = b'blob ' + str(len(data)).encode() + b'\0' + data
                self.assertEqual(hashlib.sha1(git_blob).hexdigest(), record['git_blob_sha'])
                self.assertEqual(record['url'], 'https://raw.githubusercontent.com/'
                                 + proof['repository'] + '/' + proof['commit'] + '/' + record['path'])
        library = source / 'kit/renderd/inputgate/tool/mgu-inputgate.so'
        self.assertEqual(hashlib.sha256(library.read_bytes()).hexdigest(), INPUTGATE_SHA256)

    def test_inputgate_only_changes_packaging_and_declares_original_dropin_requirement(self):
        frozen = ROOT / 'tools/_sources/cauli-inputgate-1.2.1'
        source = ROOT / 'tools/_packages/mgu-inputgate'
        old = json.loads((frozen / 'kit/renderd/inputgate/tool/component.json').read_text())
        new = json.loads((source / 'component.json').read_text())
        self.assertEqual(old['version'], '1.2.1')
        self.assertEqual(new['version'], '1.2.2')
        self.assertEqual(new['files'][:len(old['files'])], old['files'])
        self.assertNotIn('requires', old)
        self.assertEqual(new['requires'], {'mgu-deploy': '0.3.2'})
        self.assertEqual({k: v for k, v in new.items() if k not in ('version', 'files', 'requires')},
                         {k: v for k, v in old.items() if k not in ('version', 'files')})
        declared = set()
        for category, key in [('files', 'path'), ('units', 'name'), ('dropins', 'name')]:
            declared.update(r.get('from') or r[key] for r in new.get(category, []))
        # Every notice/provenance file must reach the actual native Store payload.
        self.assertEqual(declared, {p.relative_to(source).as_posix() for p in source.rglob('*')
                                    if p.is_file() and p.name != 'component.json'})
        for packaged, original in [('LICENSE', 'LICENSE'), ('LICENSE.renderd', 'kit/renderd/LICENSE'),
                                   ('LICENSE.mgu-renderd', 'kit/renderd/LICENSE.mgu-renderd'),
                                   ('UPSTREAM-RENDERD-README.md', 'kit/renderd/README.md')]:
            self.assertEqual((source / 'licenses' / packaged).read_bytes(), (frozen / original).read_bytes())
        readme = (frozen / 'kit/renderd/README.md').read_text()
        self.assertIn("The controller gate (`inputgate/`) is this repository's, MIT", readme)
        self.assertIn('(its vsomeip headers MPL-2.0)', readme)
        notices = (source / 'licenses/VSOMEIP-NOTICES.txt').read_text()
        headers = sorted((frozen / 'kit/renderd/inputgate/vsomeip-include').rglob('*.hpp'))
        self.assertEqual(len(headers), 20)
        for header in headers:
            self.assertIn(header.relative_to(frozen).as_posix(), notices)
            comment_lines = []
            for line in header.read_text().splitlines():
                if not line.startswith('//'):
                    break
                comment_lines.append(line)
            first_comment = '\n'.join(comment_lines)
            self.assertIn(first_comment, notices)
        proof = json.loads((source / 'SOURCE-PROVENANCE.json').read_text())
        license_data = (source / 'licenses/MPL-2.0.txt').read_bytes()
        self.assertEqual(len(license_data), proof['supplemental_license']['bytes'])
        self.assertEqual(hashlib.sha256(license_data).hexdigest(), proof['supplemental_license']['sha256'])
        self.assertIn(b'Exhibit B - "Incompatible With Secondary Licenses" Notice', license_data)
        packaging = json.loads((source / 'AQ-PACKAGING.json').read_text())
        self.assertEqual(packaging['licenseScope']['controller_gate'], 'MIT')
        self.assertEqual(packaging['licenseScope']['vsomeip_interface_headers'], 'MPL-2.0')
        self.assertFalse(packaging['hostBuildDistributed'])
        self.assertEqual(packaging['actualTargetExecution'], 'NOT OBSERVED')

    def test_catalog_hmi_uses_archive_ui_when_publisher_claim_conflicts(self):
        feed = {c['id']: c for c in json.loads((ROOT / 'release/catalog.json').read_text())['components']}
        evidence = {c['id']: c for c in json.loads((ROOT / 'data/artifact-verification-20261119.json').read_text())['artifacts']}
        self.assertEqual(feed['sideways']['mguHmi'], ['ID7'])
        self.assertEqual(evidence['sideways']['package_hmi'], ['ID7', 'ID8'])
        self.assertEqual(evidence['sideways']['ui_hmi'], ['ID7'])
        self.assertEqual(feed['turnkey_e_blend_id8']['mguHmi'], ['ID8'])
        self.assertEqual(evidence['turnkey_e_blend_id8']['ui_hmi'], ['ID8'])
        for component in feed.values():
            if component['kind'] == 'app' and 'ID8' in component.get('mguHmi', []):
                self.assertIn('ID8', evidence[component['id']]['ui_hmi'])


if __name__ == '__main__':
    unittest.main()
