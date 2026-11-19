"""A timeout must report an error without starting overlapping SDK requests."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReadonlyRequestLifecycleTests(unittest.TestCase):
    def test_each_integrated_reader_bounds_pending_requests_and_discards_late_results(self):
        for family in ('arefahmad-idrive8', 'maxxxfoka-idrive8', 'dante-idrive8'):
            with self.subTest(family=family):
                result = subprocess.run([
                    'node', str(ROOT / 'tests/fixtures/tests_id8_readonly_adapter.js'),
                    str(ROOT), 'adapter', 'apps/_ports/' + family,
                ], cwd=ROOT, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
