"""Native-status fixture tests; no updater, unit, network or installer runs."""

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("aq_install_state", ROOT / "tools/check_source_install_state.py")
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def expected():
    return {"id": "adam_shiftlights", "version": "0.4.5", "source": "aq_mgu", "revision": "abc1234"}


def native_state():
    # catalog.plan + updater.state() shape from the pinned original updater,
    # whose relevant JS also matches the original 0.8.48 release artifact.
    return {
        "type": "state", "updater": {"version": "0.8.48"}, "online": True,
        "unit": {"hmi": "ID7", "firmware": "SYNTHETIC TEST FIXTURE"},
        "catalog": {"commit": "store-commit", "checkedAt": 1, "checking": False, "error": None},
        "sources": [{"id": "aq_mgu", "type": "github", "channel": "branch:main", "status": "ok", "error": None}],
        "busy": None, "rebooting": False,
        "components": [{
            "id": "adam_shiftlights", "kind": "app", "version": "0.4.5", "installed": "0.4.5",
            "status": "installed", "source": "aq_mgu", "revision": "abc1234", "build": "unit",
            "listedId": None, "installAs": "adam_shiftlights", "blocked": None,
            "mguHmi": ["ID7"], "compat": "yes", "pendingReboot": False, "nextStart": None,
            "queued": False, "error": None, "problem": None, "repair": None, "needsSetup": None,
            "applyFailed": None,
        }],
    }


class SourceInstallStateTests(unittest.TestCase):
    def classify(self, snapshot, want=None):
        result = CHECK.classify(snapshot, expected() if want is None else want)
        self.assertIs(result["replay_allowed"], False)
        self.assertEqual(result["scope"], "offline_snapshot")
        return result

    def test_exact_native_readback_is_installed_without_modifying_inputs(self):
        state, want = native_state(), expected()
        originals = deepcopy((state, want))
        result = self.classify(state, want)
        self.assertEqual(result["status"], "installed")
        self.assertEqual(result["reason"], "exact_target_installed_in_snapshot")
        self.assertEqual((state, want), originals)

    def test_same_version_with_changed_branch_content_is_not_success(self):
        state = native_state()
        state["components"][0]["status"] = "update"
        result = self.classify(state)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["reason"], "source_content_not_confirmed")

    def test_source_revision_version_and_alias_drift_are_unknown(self):
        for field, new, reason in (
            ("source", "other", "source_changed"),
            ("revision", "def5678", "revision_changed"),
            ("version", "0.4.6", "target_version_changed"),
            ("installAs", "adam_shiftlights2", "install_alias_changed"),
            ("listedId", "another_app", "listed_alias_changed"),
            ("kind", "tool", "kind_changed"),
        ):
            with self.subTest(field=field):
                state = native_state()
                state["components"][0][field] = new
                result = self.classify(state)
                self.assertEqual((result["status"], result["reason"]), ("unknown", reason))

    def test_revision_is_required_and_never_prefix_normalized(self):
        for want in ({key: value for key, value in expected().items() if key != "revision"},
                     {**expected(), "revision": "abc1234" + "0" * 33}):
            self.assertEqual(self.classify(native_state(), want)["status"], "unknown")
        state, want = native_state(), {**expected(), "revision": None}
        state["components"][0]["revision"] = None
        self.assertEqual(self.classify(state, want)["status"], "installed")

    def test_declared_alias_is_accepted_only_with_exact_target_binding(self):
        state, want = native_state(), expected()
        row = state["components"][0]
        row["id"] = want["id"] = "adam_shiftlights@aq_mgu"
        row["listedId"] = want["listedId"] = "adam_shiftlights"
        want["installAs"] = "adam_shiftlights"
        self.assertEqual(self.classify(state, want)["status"], "installed")
        del want["installAs"]
        self.assertEqual(self.classify(state, want)["status"], "unknown")

    def test_queue_and_dependency_busy_continue_observation(self):
        state = native_state()
        state["components"][0].update(installed=None, status="available", queued=True)
        state["busy"] = {"id": "mgu_updater", "op": "install", "phase": "install"}
        result = self.classify(state)
        self.assertEqual((result["status"], result["reason"]), ("running", "target_queued"))

    def test_active_install_and_legacy_busy_shape_are_running(self):
        for op in ("install", None):
            state = native_state()
            state["busy"] = {"id": "adam_shiftlights", "phase": "build"}
            if op:
                state["busy"]["op"] = op
            result = self.classify(state)
            self.assertEqual((result["status"], result["reason"]), ("running", "target_install_running"))

    def test_conflicting_operation_and_competing_source_alias_stay_unknown(self):
        for operation in ("uninstall", "rollback", "setup", "restore"):
            state = native_state()
            state["busy"] = {"id": "adam_shiftlights", "op": operation}
            self.assertEqual(self.classify(state)["reason"], "conflicting_operation")
        state = native_state()
        other = {**deepcopy(state["components"][0]), "id": "adam_shiftlights@other", "source": "other"}
        state["components"].append(other)
        state["busy"] = {"id": other["id"], "op": "install"}
        self.assertEqual(self.classify(state)["reason"], "conflicting_operation")

    def test_unrelated_operation_does_not_erase_an_installed_target(self):
        state = native_state()
        state["busy"] = {"id": "unrelated_app", "op": "install"}
        self.assertEqual(self.classify(state)["status"], "installed")

    def test_registration_reboot_and_removal_are_pending_not_installed(self):
        for field, value, reason in (
            ("pendingReboot", True, "target_registration_pending"),
            ("nextStart", "install", "target_registration_pending"),
            ("nextStart", "remove", "target_removal_pending"),
        ):
            state = native_state()
            state["components"][0][field] = value
            self.assertEqual((self.classify(state)["status"], self.classify(state)["reason"]), ("pending", reason))
        state = native_state()
        state["rebooting"] = True
        self.assertEqual(self.classify(state)["status"], "pending")

    def test_explicit_failure_wins_over_installed_version_and_queue(self):
        for field in ("error", "problem", "blocked", "repair", "needsSetup", "applyFailed"):
            with self.subTest(field=field):
                state = native_state()
                state["components"][0][field] = "synthetic failure"
                state["components"][0]["queued"] = True
                result = self.classify(state)
                self.assertEqual(result["status"], "failed")
                self.assertIn(field, result["failure_fields"])

    def test_missing_or_duplicate_target_never_authorizes_replay(self):
        for rows, reason in (([], "target_missing"), (native_state()["components"] * 2, "target_ambiguous")):
            state = native_state()
            state["components"] = rows
            self.assertEqual(self.classify(state)["reason"], reason)

    def test_uninstalled_or_different_installed_version_is_inconclusive(self):
        for installed, status in ((None, "available"), ("0.4.4", "update"), ("0.4.6", "newer"), ("0.4.4", "installed")):
            state = native_state()
            state["components"][0].update(installed=installed, status=status)
            self.assertEqual(self.classify(state)["status"], "unknown")

    def test_catalog_in_progress_or_error_cannot_confirm_completion(self):
        for update in ({"checking": True}, {"error": "synthetic source error"}):
            state = native_state()
            state["catalog"].update(update)
            self.assertEqual(self.classify(state)["reason"], "catalog_not_ready")

    def test_malformed_structures_and_boolean_strings_are_unknown_not_exceptions(self):
        for value in (None, [], "failure", 1):
            self.assertEqual(self.classify(value)["status"], "unknown")
            self.assertEqual(CHECK.classify(native_state(), value)["status"], "unknown")
        for field, value in (("queued", "false"), ("pendingReboot", 0), ("nextStart", []),
                             ("status", []), ("kind", {}), ("installed", {}), ("revision", {}), ("error", {})):
            state = native_state()
            state["components"][0][field] = value
            self.assertEqual(self.classify(state)["status"], "unknown")
        for field, value in (("busy", "reset"), ("busy", {}), ("busy", {"id": "x", "op": []}),
                             ("rebooting", 0), ("catalog", []), ("components", {})):
            state = native_state()
            state[field] = value
            self.assertEqual(self.classify(state)["status"], "unknown")
        state = native_state()
        state["components"] *= CHECK.MAX_COMPONENTS + 1
        self.assertEqual(self.classify(state)["reason"], "components_shape_invalid")

    def test_required_row_field_absence_is_unknown(self):
        for field in ("installed", "error", "queued", "pendingReboot", "revision", "installAs", "listedId"):
            state = native_state()
            del state["components"][0][field]
            self.assertEqual(self.classify(state)["status"], "unknown")

    def test_output_omits_auth_tokens_network_state_and_raw_errors(self):
        state = native_state()
        state["tokens"] = [{"id": "DO_NOT_ECHO"}]
        state["uplink"] = {"wifi": {"ssid": "DO_NOT_ECHO"}}
        state["components"][0]["error"] = "DO_NOT_ECHO"
        output = json.dumps(self.classify(state))
        self.assertNotIn("DO_NOT_ECHO", output)

    def test_decoder_rejects_duplicates_trailers_invalid_utf8_and_oversize(self):
        for payload in (b'{"type":"error","type":"state"}', b'{}\nAQ_SOURCE_INSTALL_EXIT=1',
                        b'{"x":NaN}', b'\xff', b' ' * (CHECK.MAX_SNAPSHOT_BYTES + 1)):
            with self.subTest(payload=payload[:40]), self.assertRaises((ValueError, UnicodeError)):
                CHECK.decode_snapshot(payload)
        self.assertEqual(CHECK.decode_snapshot(json.dumps(native_state()).encode()), native_state())

    def test_cli_consumes_snapshot_only_and_preserves_exit_semantics(self):
        command = [sys.executable, "-B", str(ROOT / "tools/check_source_install_state.py"),
                   "--id", "adam_shiftlights", "--version", "0.4.5", "--source", "aq_mgu", "--revision", "abc1234"]
        failed, running, pending = native_state(), native_state(), native_state()
        failed["components"][0]["error"] = "synthetic failure"
        running["components"][0]["queued"] = True
        pending["components"][0]["nextStart"] = "install"
        for state, status, code in ((native_state(), "installed", 0), (failed, "failed", 1),
                                    (running, "running", 2), (pending, "pending", 2), ({}, "unknown", 3)):
            result = subprocess.run(command, input=json.dumps(state), capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, code, result.stderr)
            output = json.loads(result.stdout)
            self.assertEqual(output["status"], status)
            self.assertIs(output["replay_allowed"], False)
        result = subprocess.run(command, input="updater not reachable: read ECONNRESET\nAQ_SOURCE_INSTALL_EXIT=1",
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 3)
        self.assertEqual(json.loads(result.stdout)["reason"], "snapshot_json_invalid")


if __name__ == "__main__":
    unittest.main()
