"""Meaningful failure probes for the recorded AQ inventory coverage gate."""
import copy
import unittest
from tools.check_aq_app_coverage import audit, observation_hash


class SavedInventoryGateTests(unittest.TestCase):
    def setUp(self):
        self.app = {"id": "app_a", "observations": [{"catalog": "picker", "version": "1.0.0", "evidence": "picker"}], "upstream_repository": "owner/original", "integration_after_audit": {"version": "1.0.0", "supported_hmi": ["ID7"], "delivery": "branch source"}}
        row = {"id": "app_a", "kind": "app", "version": "1.0.0", "mguHmi": ["ID7"], "requires": {}}
        shown = {"id": "app_a", "kind": "app", "version": "1.0.0", "supported_hmi": ["ID7"], "requires": {}, "delivery": "branch source", "source_repository": "owner/original"}
        self.inputs = [{"applications": [self.app], "evidence": {"picker": {"path": "picker.dart"}}}, {"components": [row]}, {"components": []}, {"components": []}, {"components": [shown]}, {"applications": []}]

    def run_audit(self):
        return audit(*self.inputs)

    def test_known_app_is_offered(self):
        result = self.run_audit()
        self.assertEqual(result["errors"], [])
        self.assertTrue(result["all_observed_aq_apps_offered"])
        self.assertFalse(result["current_remote_workspace_inventory_verified"])

    def test_future_observed_app_cannot_silently_disappear(self):
        new = copy.deepcopy(self.app)
        new["id"] = "new_app"
        self.inputs[0]["applications"].append(new)
        self.assertIn("new_app", self.run_audit()["unaccounted_aq_app_ids"])

    def test_explicit_block_does_not_claim_complete_delivery(self):
        self.inputs[1]["components"] = []
        self.inputs[4]["components"] = []
        self.inputs[5]["applications"] = [{"id": "app_a", "classification": "permission_unestablished", "reason": "saved license evidence insufficient", "evidence_keys": ["picker"], "observations_sha256": observation_hash(self.app)}]
        result = self.run_audit()
        self.assertEqual(result["accounting_status"], "PASS_WITH_BLOCKED_APPS")
        self.assertFalse(result["all_observed_aq_apps_offered"])
        self.app["observations"][0]["version"] = "2.0.0"
        self.assertTrue(self.run_audit()["errors"])

    def test_duplicate_delivery_and_observation_ids_are_rejected(self):
        self.inputs[2]["components"] = copy.deepcopy(self.inputs[1]["components"])
        self.inputs[0]["applications"].append(copy.deepcopy(self.app))
        self.assertGreaterEqual(len(self.run_audit()["errors"]), 2)

    def test_external_metadata_is_not_aq_delivery(self):
        self.inputs[3]["components"] = self.inputs[1]["components"]
        self.inputs[1]["components"] = []
        self.assertIn("app_a", self.run_audit()["unaccounted_aq_app_ids"])

    def test_historical_hmi_drift_is_reported_without_rewriting_observation(self):
        self.inputs[1]["components"][0]["mguHmi"] = ["ID7", "ID8"]
        self.inputs[4]["components"][0]["supported_hmi"] = ["ID7", "ID8"]
        result = self.run_audit()
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["historical_current_mirror_drift"][0]["field"], "supported_hmi")
        self.assertEqual(self.app["integration_after_audit"]["supported_hmi"], ["ID7"])

    def test_same_id_different_publisher_does_not_count_as_covered(self):
        self.inputs[4]["components"][0]["source_repository"] = "someone/fork"
        self.assertTrue(any("publisher" in error for error in self.run_audit()["errors"]))

    def test_missing_evidence_is_rejected(self):
        self.inputs[0]["evidence"] = {}
        self.assertTrue(self.run_audit()["errors"])


if __name__ == "__main__":
    unittest.main()
