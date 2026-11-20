"""Offline checkpoint regressions; all leases live in private temporary directories."""

import contextlib
import importlib.util
import io
import json
import multiprocessing
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "aq_goal_checkpoint_under_test", ROOT / "tools/goal_checkpoint.py"
)
checkpoint = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checkpoint)


def invoke(root, arguments):
    """Use a strict legacy Windows stdout encoding, not a permissive StringIO."""
    buffer = io.BytesIO()
    stream = io.TextIOWrapper(
        buffer, encoding="cp1252", errors="strict", write_through=True
    )
    try:
        with mock.patch.object(checkpoint, "state_dir", return_value=Path(root)), \
                mock.patch.object(sys, "argv", ["goal_checkpoint.py", *arguments]), \
                contextlib.redirect_stdout(stream):
            code = checkpoint.main()
        stream.flush()
        output = buffer.getvalue()
        return code, json.loads(output.decode("ascii")), output
    finally:
        stream.detach()


def acquire_worker(root, owner, start, results):
    """Separate processes exercise the real platform lock against one state file."""
    try:
        if not start.wait(timeout=10):
            raise RuntimeError("Concurrent-acquire fixture did not start")
        code, result, _ = invoke(root, ["acquire", "--owner", owner])
        results.put(("ok", owner, code, result))
    except BaseException as error:
        results.put(("error", owner, type(error).__name__, str(error)))


class GoalCheckpointOutputTests(unittest.TestCase):
    def test_non_ascii_owner_is_saved_utf8_and_token_prints_on_cp1252(self):
        owner = "مراجع AQ 🧰"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "سجل_العمل"
            root.mkdir()
            code, result, output = invoke(root, ["acquire", "--owner", owner])
            self.assertEqual(code, 0)
            self.assertTrue(output.isascii())
            self.assertIn(b"\\u", output)
            self.assertEqual(result["state"]["lease"]["owner"], owner)
            self.assertRegex(result["state"]["lease"]["token"], r"^[0-9a-f]{32}$")
            self.assertEqual(result["state_path"], str(root / "state.json"))
            raw_state = (root / "state.json").read_bytes()
            self.assertIn(owner.encode("utf-8"), raw_state)
            self.assertEqual(
                json.loads(raw_state.decode("utf-8"))["lease"]["token"],
                result["state"]["lease"]["token"],
            )

    def test_non_ascii_heartbeat_note_and_next_step_print_after_save(self):
        note = "تمت مراجعة التطبيقات — دون تشغيل على الوحدة ✅"
        next_step = "راجع نتيجة البناء التالية"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, acquired, _ = invoke(root, ["acquire", "--owner", "عامل المراجعة"])
            token = acquired["state"]["lease"]["token"]
            code, result, output = invoke(root, [
                "heartbeat", "--token", token, "--note", note,
                "--next-step", next_step,
            ])
            self.assertEqual(code, 0)
            self.assertTrue(output.isascii())
            self.assertEqual(result["state"]["revision"], 2)
            self.assertEqual(result["state"]["note"], note)
            self.assertEqual(result["state"]["next_step"], next_step)
            self.assertEqual(result["state"]["lease"]["token"], token)
            raw_state = (root / "state.json").read_bytes()
            self.assertIn(note.encode("utf-8"), raw_state)
            self.assertIn(next_step.encode("utf-8"), raw_state)

    def test_wrong_token_heartbeat_and_release_do_not_mutate_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            invoke(root, ["acquire", "--owner", "original-owner"])
            before = (root / "state.json").read_bytes()
            for action in ("heartbeat", "release"):
                with self.subTest(action=action):
                    with self.assertRaisesRegex(RuntimeError, "token does not match"):
                        invoke(root, [
                            action, "--token", "wrong-token", "--note", "must not persist",
                            "--next-step", "must not advance", "--status", "COMPLETE",
                        ])
                    self.assertEqual((root / "state.json").read_bytes(), before)
                    self.assertEqual(list(root.glob("state-*.tmp")), [])


class GoalCheckpointRepositoryTests(unittest.TestCase):
    def test_caller_cwd_cannot_redirect_state_to_another_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            repository = base / "intended"
            tools = repository / "tools"
            tools.mkdir(parents=True)
            other = base / "unrelated"
            (other / ".git").mkdir(parents=True)
            previous = Path.cwd()
            try:
                os.chdir(other)
                with mock.patch.object(checkpoint, "__file__", str(tools / "goal_checkpoint.py")), \
                        mock.patch.object(checkpoint.subprocess, "check_output", return_value=".git\n") as git:
                    actual = checkpoint.state_dir()
            finally:
                os.chdir(previous)
            self.assertEqual(actual, repository.resolve() / ".git" / "aq_mgu_goal")
            git.assert_called_once_with(
                ["git", "-C", str(repository.resolve()), "rev-parse", "--git-common-dir"],
                text=True,
            )
            self.assertTrue(actual.is_dir())
            self.assertFalse((other / ".git" / "aq_mgu_goal").exists())

    def test_relative_worktree_common_dir_resolves_from_script_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            repository = base / "canonical" / "worktrees" / "id8"
            (repository / "tools").mkdir(parents=True)
            common = base / "canonical" / ".git"
            with mock.patch.object(checkpoint, "__file__", str(repository / "tools" / "goal_checkpoint.py")), \
                    mock.patch.object(checkpoint.subprocess, "check_output", return_value="../../.git\n"):
                actual = checkpoint.state_dir()
            self.assertEqual(actual, common.resolve() / "aq_mgu_goal")
            self.assertTrue(actual.is_dir())

    def test_absolute_common_dir_is_kept(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            repository = base / "worktree"
            (repository / "tools").mkdir(parents=True)
            common = base / "shared-git"
            with mock.patch.object(checkpoint, "__file__", str(repository / "tools" / "goal_checkpoint.py")), \
                    mock.patch.object(checkpoint.subprocess, "check_output", return_value=str(common) + "\n"):
                actual = checkpoint.state_dir()
            self.assertEqual(actual, common.resolve() / "aq_mgu_goal")


class GoalCheckpointConcurrencyTests(unittest.TestCase):
    def test_simultaneous_acquisition_has_exactly_one_owner_and_one_revision(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            start = context.Event()
            results = context.Queue()
            processes = [
                context.Process(
                    target=acquire_worker,
                    args=(str(root), owner, start, results),
                )
                for owner in ("first-worker", "second-worker")
            ]
            try:
                for process in processes:
                    process.start()
                start.set()
                replies = [results.get(timeout=20) for _ in processes]
                for process in processes:
                    process.join(timeout=10)
                    self.assertFalse(process.is_alive())
                    self.assertEqual(process.exitcode, 0)
                self.assertTrue(all(reply[0] == "ok" for reply in replies), replies)
                self.assertEqual(sorted(reply[2] for reply in replies), [0, 3])
                winner = next(reply for reply in replies if reply[2] == 0)
                loser = next(reply for reply in replies if reply[2] == 3)
                state = json.loads((root / "state.json").read_text(encoding="utf-8"))
                self.assertEqual(state["revision"], 1)
                self.assertEqual(state["status"], "IN_PROGRESS")
                self.assertEqual(state["lease"]["owner"], winner[1])
                self.assertEqual(state["lease"]["token"], winner[3]["state"]["lease"]["token"])
                self.assertEqual(loser[3]["state"]["lease"]["owner"], winner[1])
                self.assertEqual(list(root.glob("state-*.tmp")), [])
            finally:
                for process in processes:
                    if process.is_alive():
                        process.terminate()
                    process.join(timeout=5)
                results.close()
                results.join_thread()


if __name__ == "__main__":
    unittest.main()
