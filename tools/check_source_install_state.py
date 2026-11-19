#!/usr/bin/env python3
"""Classify one original mgu-updater status JSON snapshot without contacting a unit.

This is an offline integration component, not a transport-recovery client. It
never connects, installs, checks a catalog, restarts anything or authorizes
replay. The caller remains responsible for snapshot freshness, retained unit /
owner identity, source-configuration identity and obtaining a new readback.

Example (the revision is the exact short revision from the intended source row):
  python tools/check_source_install_state.py --id adam_shiftlights \
      --version 0.4.5 --source aq_mgu --revision abc1234 --snapshot status.json

Use --revision none only for a target whose native revision really is null.
That cannot establish that a newly changed source port with the same version
was applied. Full source commits, package hashes, live launch and a durable
request receipt are not supplied by this native status protocol. In particular,
rid is response correlation, not an installation idempotency key.

Output status: installed | running | pending | failed | unknown.
Exit codes: 0 installed-in-snapshot; 1 explicit failure; 2 running/pending;
3 unknown/invalid input. Every result keeps replay_allowed=false. The module
uses the 0.8.48 publisher artifact's state shape, byte-matched to the pinned
original source in data/install-observations-20261119.json.
"""

import argparse
import json
from pathlib import Path
import re
import sys


MAX_SNAPSHOT_BYTES = 1024 * 1024
MAX_COMPONENTS = 4096
ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")
ROW_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}(?:@[a-z0-9][a-z0-9_-]{0,63})?\Z")
VERSION = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\Z")
STATES = {"installed", "update", "available", "newer"}
OPERATIONS = {"install", "uninstall", "rollback", "adopt", "restore", "relay", "setup"}
EXIT_CODES = {"installed": 0, "failed": 1, "running": 2, "pending": 2, "unknown": 3}


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _text(value, maximum=4096):
    return isinstance(value, str) and len(value) <= maximum and not any(ord(c) < 32 for c in value)


def _result(status, reason, observed=None, failure_fields=None):
    result = {
        "schema": "aq-mgu.install-state/1",
        "scope": "offline_snapshot",
        "status": status,
        "reason": reason,
        "replay_allowed": False,
    }
    if observed is not None:
        result["observed"] = observed
    if failure_fields:
        # Do not copy arbitrary updater text, auth metadata, tokens or Wi-Fi
        # state into the classification output. The input retains diagnostics.
        result["failure_fields"] = failure_fields
    return result


def classify(snapshot, expected):
    """Return a snapshot classification. Neither argument is modified.

    expected requires id, version, source and revision (string or explicit
    None). kind defaults to app; installAs defaults to id; listedId defaults
    to None. Pass both aliases explicitly when expecting a native id@source
    row. The source ID, revision and aliases must match before any conclusion.
    """
    if not isinstance(expected, dict):
        return _result("unknown", "expected_target_invalid")
    wanted = dict(expected)
    wanted.setdefault("kind", "app")
    wanted.setdefault("installAs", wanted.get("id"))
    wanted.setdefault("listedId", None)
    if (not _matches(ROW_ID, wanted.get("id")) or
            not _matches(VERSION, wanted.get("version")) or
            not _matches(ID, wanted.get("source")) or
            not _matches(ID, wanted.get("installAs")) or
            wanted["listedId"] is not None and not _matches(ID, wanted["listedId"]) or
            wanted["kind"] not in ("app", "tool") or
            "revision" not in wanted or
            wanted["revision"] is not None and (not _text(wanted["revision"], 128) or not wanted["revision"])):
        return _result("unknown", "expected_target_invalid")

    if not isinstance(snapshot, dict) or snapshot.get("type") != "state":
        return _result("unknown", "snapshot_shape_invalid")
    rows = snapshot.get("components")
    if not isinstance(rows, list) or len(rows) > MAX_COMPONENTS:
        return _result("unknown", "components_shape_invalid")
    matches = [row for row in rows if isinstance(row, dict) and row.get("id") == wanted["id"]]
    if len(matches) != 1:
        return _result("unknown", "target_missing" if not matches else "target_ambiguous")
    row = matches[0]
    required = {"id", "kind", "version", "installed", "source", "revision", "installAs", "listedId",
                "status", "queued", "pendingReboot", "nextStart", "error", "problem", "blocked"}
    if (not required <= row.keys() or
            row.get("kind") not in ("app", "tool") or
            not _matches(VERSION, row.get("version")) or
            row.get("installed") is not None and not _matches(VERSION, row["installed"]) or
            not _matches(ID, row.get("source")) or
            not _matches(ID, row.get("installAs")) or
            row.get("listedId") is not None and not _matches(ID, row["listedId"]) or
            row.get("revision") is not None and not _text(row["revision"], 128) or
            not isinstance(row.get("status"), str) or row["status"] not in STATES or
            type(row.get("queued")) is not bool or type(row.get("pendingReboot")) is not bool or
            row.get("nextStart") not in (None, "install", "remove")):
        return _result("unknown", "target_shape_invalid")
    error_fields = ("error", "problem", "blocked", "repair", "needsSetup", "applyFailed")
    for field in error_fields:
        value = row.get(field)
        if value is not None and not _text(value):
            return _result("unknown", "target_shape_invalid")

    observed = {field: row[field] for field in (
        "id", "kind", "version", "installed", "source", "revision", "installAs", "listedId",
        "status", "queued", "pendingReboot", "nextStart")}
    for field, reason in (("kind", "kind_changed"), ("source", "source_changed"),
                          ("version", "target_version_changed"), ("revision", "revision_changed"),
                          ("installAs", "install_alias_changed"), ("listedId", "listed_alias_changed")):
        if row[field] != wanted[field]:
            return _result("unknown", reason, observed)

    if "busy" not in snapshot or type(snapshot.get("rebooting")) is not bool:
        return _result("unknown", "snapshot_shape_invalid", observed)
    busy = snapshot["busy"]
    if busy is not None:
        if (not isinstance(busy, dict) or not _matches(ROW_ID, busy.get("id")) or
                not isinstance(busy.get("op", "install"), str) or busy.get("op", "install") not in OPERATIONS):
            return _result("unknown", "busy_shape_invalid", observed)
        observed["busy_id"] = busy["id"]
        observed["busy_operation"] = busy.get("op", "install")

    failures = [field for field in error_fields if row.get(field)]
    if failures:
        return _result("failed", "target_reports_failure", observed, failures)

    if busy is not None:
        # A competing source alias may be modifying the same installed app.
        busy_rows = [other for other in rows if isinstance(other, dict) and other.get("id") == busy["id"]]
        related = (busy["id"] in (wanted["id"], wanted["installAs"]) or
                   any(other.get("installAs") == wanted["installAs"] for other in busy_rows))
        if related:
            if busy["id"] == wanted["id"] and busy.get("op", "install") == "install":
                return _result("running", "target_install_running", observed)
            return _result("unknown", "conflicting_operation", observed)
    if row["queued"]:
        return _result("running", "target_queued", observed)
    if row["nextStart"] == "remove":
        return _result("pending", "target_removal_pending", observed)
    if row["pendingReboot"] or row["nextStart"] == "install":
        return _result("pending", "target_registration_pending", observed)
    if snapshot["rebooting"]:
        return _result("pending", "unit_rebooting", observed)

    catalog = snapshot.get("catalog")
    if (not isinstance(catalog, dict) or type(catalog.get("checking")) is not bool or
            "error" not in catalog or catalog["error"] is not None and not _text(catalog["error"])):
        return _result("unknown", "catalog_shape_invalid", observed)
    if catalog["checking"] or catalog["error"]:
        return _result("unknown", "catalog_not_ready", observed)
    if row["status"] == "installed" and row["installed"] == wanted["version"]:
        return _result("installed", "exact_target_installed_in_snapshot", observed)
    if row["status"] == "update" and row["installed"] == wanted["version"]:
        return _result("unknown", "source_content_not_confirmed", observed)
    return _result("unknown", "target_install_not_confirmed", observed)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def decode_snapshot(data):
    """Decode bounded UTF-8 JSON; reject trailers, duplicate keys and NaN."""
    if not isinstance(data, bytes) or len(data) > MAX_SNAPSHOT_BYTES:
        raise ValueError("Snapshot exceeds the byte limit or is not bytes")
    def invalid_constant(_value):
        raise ValueError("Non-JSON numeric constant")
    return json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=invalid_constant)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--revision", required=True, help="Exact native revision, or 'none' for an explicitly null revision")
    parser.add_argument("--kind", choices=("app", "tool"), default="app")
    parser.add_argument("--install-as")
    parser.add_argument("--listed-id")
    parser.add_argument("--snapshot", default="-", help="Local JSON file; '-' reads standard input")
    args = parser.parse_args(argv)
    expected = {"id": args.id, "version": args.version, "source": args.source,
                "revision": None if args.revision == "none" else args.revision, "kind": args.kind,
                "installAs": args.install_as or args.id, "listedId": args.listed_id}
    try:
        if args.snapshot == "-":
            data = sys.stdin.buffer.read(MAX_SNAPSHOT_BYTES + 1)
        else:
            with Path(args.snapshot).open("rb") as stream:
                data = stream.read(MAX_SNAPSHOT_BYTES + 1)
        snapshot = decode_snapshot(data)
        result = classify(snapshot, expected)
    except OSError:
        result = _result("unknown", "snapshot_unreadable")
    except (ValueError, UnicodeError, RecursionError):
        result = _result("unknown", "snapshot_json_invalid")
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return EXIT_CODES[result["status"]]


if __name__ == "__main__":
    raise SystemExit(main())
