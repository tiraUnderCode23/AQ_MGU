"""The locally licensed source stays distinct from AQ's derived applications."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class OriginalStudioSnapshotTests(unittest.TestCase):
    def test_exact_imported_files_and_local_source_identity(self):
        evidence = json.loads((ROOT / 'data/appstudio-source-imports-20261119.json').read_text())
        source = ROOT / evidence['snapshot_root']
        self.assertIsNone(evidence['repository'])
        self.assertIsNone(evidence['source_git_commit'])
        actual = {p.relative_to(source).as_posix() for p in source.rglob('*')
                  if p.is_file() and '__pycache__' not in p.parts}
        self.assertEqual(actual, {row['path'] for row in evidence['files']})
        total = 0
        for row in evidence['files']:
            with self.subTest(path=row['path']):
                data = (source / row['path']).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), row['sha256'])
                self.assertEqual(len(data), row['bytes'])
                total += len(data)
        self.assertEqual(len(actual), evidence['verified_file_count'])
        self.assertEqual(total, evidence['verified_byte_count'])
        self.assertFalse(any('oap-sdk' in Path(path).parts for path in actual))


if __name__ == '__main__':
    unittest.main()
