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

    def test_aq_pair_and_original_companion_source_pass(self):
        audit = self.check(self.config)
        self.assertEqual(audit.errors, [])
        self.assertEqual(audit.counts.get("store_sources"), len(self.config["sources"]))
        self.assertTrue({"aq-mgu-apps", "aq-mgu-catalog", "aq-mgu-iteriodev"} <= {
            source["id"] for source in self.config["sources"]
        })

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

    def test_missing_original_companion_source_is_rejected(self):
        invalid = copy.deepcopy(self.config)
        invalid["sources"] = [s for s in invalid["sources"] if s["id"] != "aq-mgu-iteriodev"]
        self.assertTrue(self.check(invalid).errors)

    def test_companion_must_use_the_declared_original_route(self):
        for changed in ({"repo": "another-user/car-apps"}, {"channel": "tags"}):
            invalid = copy.deepcopy(self.config)
            next(s for s in invalid["sources"] if s["id"] == "aq-mgu-iteriodev").update(changed)
            with self.subTest(changed=changed):
                self.assertTrue(self.check(invalid).errors)

    def test_additional_distinct_original_sources_are_allowed(self):
        config = copy.deepcopy(self.config)
        config["sources"].append({
            "id": "optional-community", "type": "github",
            "repo": "example-owner/example-apps", "channel": "releases",
        })
        self.assertEqual(self.check(config).errors, [])

    def test_repository_duplicates_are_case_insensitive(self):
        invalid = copy.deepcopy(self.config)
        invalid["sources"].append({
            "id": "duplicate-publisher", "type": "github",
            "repo": "ITERIODEV/CAR-APPS", "channel": "tags",
        })
        self.assertTrue(self.check(invalid).errors)


if __name__ == "__main__":
    unittest.main()
