"""Run repository checks offline with UTF-8 and same-volume temporary fixtures.

Some original builders use relpath for logs, so Windows fixtures must share
the repository volume. Temporary files and logs stay in the local Git directory.
The existing suite uses synthetic SDK-shaped packaging fixtures; it does not
install applications or contact a head unit.
"""
import argparse
import contextlib
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--modules", nargs="*", help="Specific test module stems; otherwise discover all")
    parser.add_argument("--report-dir", type=Path)
    args = parser.parse_args()
    os.chdir(ROOT)
    sys.dont_write_bytecode = True
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    os.environ["PYTHONUTF8"] = "1"
    sys.path[:0] = [str(ROOT), str(ROOT / "tests")]
    common = Path(subprocess.check_output(
        ["git", "-C", str(ROOT), "rev-parse", "--git-common-dir"], text=True, encoding="utf-8").strip())
    common = common if common.is_absolute() else ROOT / common
    common = common.resolve()
    if os.name == "nt" and common.drive.lower() != ROOT.drive.lower():
        raise RuntimeError("Run this suite from the canonical checkout on its Git-directory volume")
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    reports = args.report_dir or common / "aq_goal_validation" / stamp
    reports.mkdir(parents=True, exist_ok=False)
    fixture_parent = common / "aq_goal_test_temp"
    fixture_parent.mkdir(exist_ok=True)
    loader = unittest.TestLoader()
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="offline-suite-", dir=fixture_parent) as temp:
        previous = tempfile.tempdir
        tempfile.tempdir = temp
        try:
            suite = (unittest.TestSuite(loader.loadTestsFromName(name) for name in args.modules)
                     if args.modules else loader.discover(str(ROOT / "tests"), pattern="test_*.py"))
            with (reports / "tests.log").open("w", encoding="utf-8", newline="\n") as log:
                with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
                    result = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
        finally:
            tempfile.tempdir = previous
    summary = {
        "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "working_tree_validation": True,
        "modules": args.modules or ["test_*.py"],
        "tests": result.testsRun, "failures": len(result.failures),
        "errors": len(result.errors), "skipped": len(result.skipped),
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "successful": result.wasSuccessful(),
        "failure_names": [str(test) for test, _ in result.failures],
        "error_names": [str(test) for test, _ in result.errors],
        "runtime_on_hu": "NOT_OBSERVED",
        "log": str(reports / "tests.log"),
    }
    (reports / "result.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items()
                      if key not in {"failure_names", "error_names", "modules"}}, ensure_ascii=True))
    return 0 if result.wasSuccessful() else 1

if __name__ == "__main__":
    raise SystemExit(main())
