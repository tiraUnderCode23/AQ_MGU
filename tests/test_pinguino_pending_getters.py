"""Regress the observed duplicate pending typed reads without SDK or transport."""
from pathlib import Path
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]
class PinguinoPendingGetterTests(unittest.TestCase):
    def test_actual_typed_watch_limits_pending_work_and_invalidates_late_results(self):
        result=subprocess.run(['node',str(ROOT/'tests/fixtures/tests_pinguino_pending_getters.js'),
                               str(ROOT/'apps/_ports/pinguinooo-idrive8')],capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('PASS typed pending getters',result.stdout)
if __name__=='__main__':unittest.main()
