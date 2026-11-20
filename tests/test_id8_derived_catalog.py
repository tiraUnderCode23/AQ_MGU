"""Catalog integration and the maintained Hexlay port's focused test suite."""
import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {
    'adam_vitals': ('pinguinooo-idrive8', '0.2.0'),
    'aref_explorer': ('arefahmad-idrive8', '0.2.3'),
    'm_copilot': ('hexlay-idrive8', '1.0.31'),
    'spotify': ('hexlay-idrive8', '1.0.30'),
    'sys_monitor': ('hexlay-idrive8', '1.0.4'),
    'adam_shiftlights': ('pinguinooo-idrive8', '0.4.6'),
    'aref_carcare': ('arefahmad-idrive8', '0.2.4'),
    'aref_carlyrics': ('arefahmad-idrive8', '0.3.10'),
    'parked_games': ('maxxxfoka-idrive8', '0.2.3'),
    'e85': ('dante-idrive8', '1.2.2'),
    'dimon_track_mode': ('dimonprograms-idrive8', '1.0.1'),
    'ab_storage': ('bmwenthusiast-idrive8', '1.2.4'),
    'bimmer_blocks': ('appstudio-idrive8', '1.1.1'),
    'vehicle_pass': ('appstudio-idrive8', '1.1.1'),
}
MIGRATED_FRONTENDS = {
    'vizualyse_cast': '0.4.1',
    'vizualyse_chromium': '0.3.1',
    'vizualyse_steam': '0.2.1',
}


class DerivedId8CatalogTests(unittest.TestCase):
    def test_derived_source_identity_dependencies_and_no_binary_substitution(self):
        rows = {r['id']: r for r in json.loads((ROOT / 'mgu-repo.json').read_text())['components']}
        metadata = {r['id']: r for r in json.loads((ROOT / 'data/components.json').read_text())['components']}
        release = {r['id'] for r in json.loads((ROOT / 'release/catalog.json').read_text())['components']}
        for cid, (family, version) in EXPECTED.items():
            with self.subTest(app=cid):
                row, meta = rows[cid], metadata[cid]
                prefix = 'apps/_ports/' + family
                self.assertEqual(row['version'], version)
                self.assertEqual(row['path'], prefix + '/apps/' + cid)
                self.assertEqual(row['mguHmi'], ['ID7', 'ID8'])
                self.assertEqual(row['requires']['mgu-render'], '0.6.24')
                self.assertIn('renderer', row['mguNeeds'])
                self.assertEqual(row['build']['python'], prefix + '/kit/tools/build.py')
                self.assertEqual(row['build']['sdk'], prefix + '/oap-sdk')
                self.assertEqual(row['build']['output'], prefix + '/dist/{id}@{version}.tgz')
                self.assertEqual(meta['source_port']['path'], prefix)
                self.assertTrue(meta['source_origin_path'].startswith('apps/_sources/'))
                self.assertEqual(meta['source_path'], row['path'])
                self.assertEqual(meta['requires'], row['requires'])
                self.assertNotIn(cid, release)
                self.assertFalse((ROOT / prefix / 'oap-sdk').exists())
                self.assertFalse((ROOT / prefix / 'dist').exists())

    def test_cluster_apps_and_tire_control_are_not_relabelled(self):
        rows = {r['id']: r for r in json.loads((ROOT / 'mgu-repo.json').read_text())['components']}
        for cid in ('adam_mtrack', 'aref_tires', 'aref_eta'):
            self.assertEqual(rows[cid]['mguHmi'], ['ID7'])
            self.assertTrue(rows[cid]['path'].startswith('apps/_sources/'))

    def test_every_published_port_file_matches_its_separate_provenance(self):
        evidence = json.loads((ROOT / 'data/id8-ports.json').read_text())
        self.assertEqual(evidence['summary']['derived_applications'], len(EXPECTED))
        for family in evidence['families']:
            actual = {p.relative_to(ROOT).as_posix() for p in (ROOT / family['path']).rglob('*')
                      if p.is_file() and '__pycache__' not in p.parts}
            self.assertEqual(actual, {row['path'] for row in family['files']})
            for row in family['files']:
                with self.subTest(path=row['path']):
                    data = (ROOT / row['path']).read_bytes()
                    self.assertEqual(hashlib.sha256(data).hexdigest(), row['sha256'])
                    self.assertEqual(len(data), row['bytes'])
                    if row['upstream_path']:
                        original = (ROOT / row['upstream_path']).read_bytes()
                        self.assertEqual(hashlib.sha256(original).hexdigest(), row['upstream_sha256'])
                        self.assertEqual(data == original, row['unchanged_upstream'])

    def test_remaining_source_blockers_and_readiness_cover_actual_hmi(self):
        feed = json.loads((ROOT / 'mgu-repo.json').read_text())['components']
        release = json.loads((ROOT / 'release/catalog.json').read_text())['components']
        blockers = json.loads((ROOT / 'data/id8-source-blockers-20261119.json').read_text())['components']
        expected = {r['id'] for r in feed if r['kind'] == 'app' and 'ID8' not in (r.get('mguHmi') or [])}
        # The historical blockers retain the three published source frontends.
        # Their current delivery channel changed; their ID7 platform did not.
        self.assertEqual({r['id'] for r in blockers}, expected | set(MIGRATED_FRONTENDS))
        providers = {r['id']: r for r in feed + release}
        self.assertEqual(len(providers), len(feed) + len(release))
        self.assertFalse(set(MIGRATED_FRONTENDS) & {r['id'] for r in feed})
        for blocker in blockers:
            with self.subTest(blocker=blocker['id']):
                current = providers[blocker['id']]
                self.assertEqual(current['kind'], 'app')
                self.assertNotIn('ID8', current.get('mguHmi') or [])
        self.assertTrue(all(row['blocker'] and row['evidence'] for row in blockers))
        self.assertFalse(set(EXPECTED) & {row['id'] for row in blockers})
        readiness = json.loads((ROOT / 'data/install-readiness-20261119.json').read_text())
        ready = {r['id']: r for r in readiness['components']}
        baseline = 'c70001e921b30c8b6c6db6acb45ac2d906c0d750'
        self.assertEqual(readiness['baseline_commit'], baseline)
        baseline_bytes = subprocess.check_output(
            ['git', 'show', baseline + ':mgu-repo.json'], cwd=ROOT)
        self.assertEqual(hashlib.sha256(baseline_bytes).hexdigest(),
                         'a6b12b4f4bca0d0717a1286f9f43bac9b90af57fbd9a0e8d510cd5a98f2d9473')
        historical = {r['id']: r for r in json.loads(baseline_bytes)['components']}
        for channel, rows in (('source', feed), ('release', release)):
            for row in rows:
                with self.subTest(channel=channel, app=row['id']):
                    observation = ready[row['id']]
                    if row['id'] == 'mgu-fscpatch':
                        # Preserve the actual historical root-feed omission.
                        # The canonical declaration is now sourced from the
                        # original component; an unknown observation stays null.
                        old = historical[row['id']]
                        self.assertEqual(channel, 'source')
                        for field in ('id', 'version', 'requires'):
                            self.assertEqual(observation[field], old[field])
                            self.assertEqual(row[field], old[field])
                        self.assertEqual(observation['source_path'], old['path'])
                        self.assertEqual(row['path'], old['path'])
                        self.assertIsNone(old.get('mguHmi'))
                        self.assertIsNone(observation['mguHmi'])
                        component = json.loads((ROOT / row['path'] / 'component.json').read_text())
                        self.assertEqual(component['id'], row['id'])
                        self.assertEqual(component['version'], row['version'])
                        self.assertEqual(component['mguHmi'], ['ID7'])
                        self.assertEqual(row['mguHmi'], component['mguHmi'])
                    else:
                        self.assertEqual(observation['mguHmi'], row.get('mguHmi'))
        self.assertEqual(ready['adam_mtrack']['live_install_result'], 'USER_REPORTED_INSTALLED')
        # A prior version's transport incident cannot become a live result for
        # the newly derived version, even though the component ID is the same.
        shift = ready['adam_shiftlights']
        self.assertEqual(shift['version'], '0.4.6')
        self.assertEqual(shift['live_install_result'], 'NOT OBSERVED')
        self.assertEqual(shift['prior_install_observation']['version'], '0.4.5')
        self.assertEqual(shift['prior_install_observation']['live_install_result'],
                         'UNCONFIRMED_TRANSPORT_RESET')
        self.assertFalse(shift['prior_install_observation']['current_version_observed'])

    def test_migrated_frontends_keep_exact_release_platform_evidence(self):
        release = {r['id']: r for r in json.loads((ROOT / 'release/catalog.json').read_text())['components']}
        blockers = {r['id']: r for r in json.loads((ROOT / 'data/id8-source-blockers-20261119.json').read_text())['components']}
        receipt = json.loads((ROOT / 'data/vizualyse-frontend-inspection-20261120.json').read_text())
        inspected = {r['id']: r for r in receipt['artifacts']}
        self.assertEqual(set(inspected), set(MIGRATED_FRONTENDS))
        self.assertEqual(len(inspected), len(receipt['artifacts']))
        self.assertEqual(receipt['archive_execution'], 'NOT_EXECUTED')
        self.assertEqual(receipt['runtime'], 'NOT_OBSERVED')
        for cid, version in MIGRATED_FRONTENDS.items():
            with self.subTest(app=cid):
                row, proof = release[cid], inspected[cid]
                self.assertEqual(row['version'], version)
                self.assertEqual(blockers[cid]['version'], version)
                self.assertEqual(blockers[cid]['declared_hmi'], ['ID7'])
                self.assertEqual(row['kind'], 'app')
                self.assertEqual(row['build'], 'unit')
                self.assertEqual(row['mguHmi'], ['ID7'])
                self.assertEqual(proof['version'], version)
                self.assertEqual(proof['status'], 'PASS')
                for field in ('url', 'size', 'sha256'):
                    self.assertEqual(proof[field], row['artifact'][field])
                self.assertRegex(proof['sha256'], r'^[0-9a-f]{64}$')
                self.assertEqual(proof['received_bytes'], proof['size'])
                self.assertEqual(proof['ui_hmi'], ['ID7'])
                self.assertEqual(proof['archive_execution'], 'NOT_EXECUTED')
                self.assertEqual(proof['runtime'], 'NOT_OBSERVED')
                manifests = [m for m in proof['manifests'] if m['path'] == 'mgu-app.json']
                self.assertEqual(len(manifests), 1)
                app = manifests[0]['metadata']
                self.assertEqual(app['id'], cid)
                self.assertEqual(app['version'], version)
                files = {entry['path']: entry for entry in proof['files']}
                self.assertEqual(manifests[0]['sha256'], files['mgu-app.json']['sha256'])
                ui = app['tree'] + '/rhmiData/uiDescriptions/'
                self.assertIn(ui + 'ID7/application.xml', files)
                self.assertIn(ui + 'ID7/uiDescription.json', files)
                self.assertFalse(any(path.startswith(ui + 'ID8/') for path in files))


def load_tests(loader, standard_tests, pattern):
    spec = importlib.util.spec_from_file_location('aq_hexlay_port_checks',
        ROOT / 'apps/_ports/hexlay-idrive8/tests/test_port.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    standard_tests.addTests(loader.loadTestsFromModule(module))
    return standard_tests
