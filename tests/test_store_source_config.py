"""Offline regression checks for original MGU Store source compatibility."""

import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify_store_feeds import Audit, STORE_SOURCES, check_store_sources  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]


class StoreSourceConfigTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / STORE_SOURCES).read_text(encoding="utf-8"))

    def check(self, config):
        audit = Audit()
        check_store_sources(audit, config)
        return audit

    def test_one_branch_and_one_https_catalog_pass(self):
        audit = self.check(self.config)
        self.assertEqual(audit.errors, [])
        self.assertEqual(audit.counts.get("store_sources"), 2)

    def test_two_channels_of_same_github_repo_are_rejected(self):
        invalid = copy.deepcopy(self.config)
        invalid["sources"][1] = {
            "id": "aq-mgu-catalog",
            "type": "github",
            "repo": "tiraUnderCode23/AQ_MGU",
            "channel": "releases",
        }
        self.assertTrue(self.check(invalid).errors)

    def test_untrusted_or_malformed_release_url_is_rejected(self):
        invalid = copy.deepcopy(self.config)
        invalid["sources"][1]["url"] = "https://example.invalid/catalog.json"
        self.assertTrue(self.check(invalid).errors)

    def test_missing_explicit_branch_is_rejected(self):
        invalid = copy.deepcopy(self.config)
        invalid["sources"][0]["channel"] = "branch"
        self.assertTrue(self.check(invalid).errors)


if __name__ == "__main__":
    unittest.main()
