"""Checks that the documented installation matrix covers every Store entry."""

import json
from pathlib import Path
import re
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "COMPONENT_README_INSTALL_MATRIX.md"
ROW = re.compile(r"^\| `([a-z0-9_-]+)@([0-9]+\.[0-9]+\.[0-9]+)` \|")
README_LINK = re.compile(r"\]\(\.\./([A-Za-z0-9._/-]+\.md)(?:#L\d+)?\)")


class ComponentReadmeMatrixTests(unittest.TestCase):
    def test_all_61_exact_versions_and_source_document_paths(self):
        source = json.loads((ROOT / "mgu-repo.json").read_text(encoding="utf-8"))
        release = json.loads((ROOT / "release/catalog.json").read_text(encoding="utf-8"))
        known = {
            row["id"]: row["version"]
            for row in source["components"] + release["components"]
        }
        self.assertEqual(len(known), 61)
        lines = DOC.read_text(encoding="utf-8").splitlines()
        component_lines = [line for line in lines if ROW.match(line)]
        documented = [ROW.match(line).groups() for line in component_lines]
        self.assertEqual(len(documented), 61)
        self.assertEqual(len({cid for cid, _ in documented}), 61)
        self.assertEqual(dict(documented), known)

        tracked = set(
            subprocess.check_output(
                ["git", "-C", str(ROOT), "ls-tree", "-r", "--name-only", "HEAD"],
            ).decode("utf-8").splitlines()
        )
        for line in component_lines:
            link = README_LINK.search(line)
            self.assertIsNotNone(link, line)
            self.assertIn(link.group(1), tracked, line)
        self.assertIn("not a live install result", "\n".join(lines))


if __name__ == "__main__":
    unittest.main()
