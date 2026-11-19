"""Catalog integration and the maintained Hexlay port's focused test suite."""
import importlib.util
import hashlib
import json
from pathlib import Path
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
        blockers = json.loads((ROOT / 'data/id8-source-blockers-20261119.json').read_text())['components']
        expected = {r['id'] for r in feed if r['kind'] == 'app' and 'ID8' not in (r.get('mguHmi') or [])}
        self.assertEqual({r['id'] for r in blockers}, expected)
        self.assertTrue(all(row['blocker'] and row['evidence'] for row in blockers))
        self.assertFalse(set(EXPECTED) & {row['id'] for row in blockers})
        ready = {r['id']: r for r in json.loads((ROOT / 'data/install-readiness-20261119.json').read_text())['components']}
        for row in feed:
            self.assertEqual(ready[row['id']]['mguHmi'], row.get('mguHmi'))
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


def load_tests(loader, standard_tests, pattern):
    spec = importlib.util.spec_from_file_location('aq_hexlay_port_checks',
        ROOT / 'apps/_ports/hexlay-idrive8/tests/test_port.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    standard_tests.addTests(loader.loadTestsFromModule(module))
    return standard_tests
