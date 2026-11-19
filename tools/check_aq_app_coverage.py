#!/usr/bin/env python3
"""Reconcile recorded AQ application inventories against local Store feeds.

This checks accounting, not build or installation readiness. It cannot discover
apps added to a disconnected AQ workspace. No networking or installer is used.
"""

import argparse
import hashlib
import json
from pathlib import Path


def observation_hash(row):
    payload = json.dumps(row.get("observations"), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def audit(coverage, source, release, external, display, exceptions):
    errors, drift = [], []

    def index(rows, label):
        result = {}
        if not isinstance(rows, list):
            errors.append(f"{label}: expected a list")
            return result
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"]:
                errors.append(f"{label}: row has no valid id")
                continue
            if row["id"] in result:
                errors.append(f"{label}: duplicate id {row['id']}")
            result[row["id"]] = row
        return result

    aq = index(coverage.get("applications"), "AQ snapshot")
    evidence = coverage.get("evidence", {})
    sources = index(source.get("components"), "source feed")
    packages = index(release.get("components"), "release feed")
    companions = index(external.get("components"), "external observations")
    inventory = index(display.get("components"), "display inventory")
    excluded = index(exceptions.get("applications"), "reviewed exceptions")
    for left, right, label in ((sources, packages, "source/release"), (sources, companions, "source/external"), (packages, companions, "release/external")):
        for cid in sorted(left.keys() & right.keys()):
            errors.append(f"{label}: overlapping delivery identity {cid}")
    offered = {**sources, **packages}
    all_rows = {**offered, **companions}
    if inventory.keys() != all_rows.keys():
        errors.append("display inventory IDs differ from source + release + external observations")
    for cid in sorted(inventory.keys() & all_rows.keys()):
        shown, actual = inventory[cid], all_rows[cid]
        if shown.get("version") != actual.get("version"):
            errors.append(f"{cid}: display version differs from delivery feed")
        if sorted(shown.get("supported_hmi") or []) != sorted(actual.get("mguHmi") or []):
            errors.append(f"{cid}: display HMI differs from delivery feed")
        if shown.get("requires", {}) != actual.get("requires", {}):
            errors.append(f"{cid}: display dependencies differ from delivery feed")

    present, blocked, unknown = [], [], []
    for cid, row in sorted(aq.items()):
        observations = row.get("observations")
        if not isinstance(observations, list) or not observations:
            errors.append(f"{cid}: no source observations")
            observations = []
        for observation in observations:
            if not isinstance(observation, dict) or observation.get("evidence") not in evidence:
                errors.append(f"{cid}: observation lacks a known evidence reference")
        if cid in offered:
            present.append(cid)
            if offered[cid].get("kind") != "app":
                errors.append(f"{cid}: observed application maps to a non-app feed row")
            if cid in excluded:
                errors.append(f"{cid}: now offered but still listed as an exception")
            expected_publisher = row.get("upstream_repository")
            actual_publisher = inventory.get(cid, {}).get("source_repository")
            if expected_publisher and expected_publisher != actual_publisher:
                errors.append(f"{cid}: publisher identity differs from saved AQ observation")
            old = row.get("integration_after_audit", {})
            actual = inventory.get(cid, {})
            for key in ("version", "supported_hmi", "delivery"):
                if old.get(key) != actual.get(key):
                    drift.append({"id": cid, "field": key, "saved": old.get(key), "current": actual.get(key)})
        elif cid in excluded:
            exception = excluded[cid]
            if not exception.get("reason") or not exception.get("classification"):
                errors.append(f"{cid}: exception needs an explicit classification and reason")
            if not exception.get("evidence_keys") or any(key not in evidence for key in exception.get("evidence_keys", [])):
                errors.append(f"{cid}: exception lacks resolvable source evidence")
            if exception.get("observations_sha256") != observation_hash(row):
                errors.append(f"{cid}: observations changed; previous exception needs review")
            blocked.append(cid)
        else:
            unknown.append(cid)
            errors.append(f"{cid}: observed AQ app is neither offered nor explicitly accounted for")
    for cid in sorted(excluded.keys() - aq.keys()):
        errors.append(f"{cid}: obsolete exception is absent from the saved inventory")
    return {
        "accounting_status": "FAIL" if errors else ("PASS_WITH_BLOCKED_APPS" if blocked else "PASS"),
        "all_observed_aq_apps_offered": bool(aq) and len(present) == len(aq) and not errors,
        "current_remote_workspace_inventory_verified": False,
        "live_installation_verified_by_this_check": False,
        "counts": {"observed_unique_app_ids": len(aq), "offered_aq_apps": len(present), "blocked_aq_apps": len(blocked), "unaccounted_aq_apps": len(unknown), "source_feed_rows": len(sources), "release_feed_rows": len(packages), "external_reference_rows": len(companions)},
        "offered_aq_app_ids": present,
        "blocked_aq_app_ids": blocked,
        "unaccounted_aq_app_ids": unknown,
        "historical_current_mirror_drift": drift,
        "errors": errors,
        "limits": ["Saved snapshot only; source export freshness and completeness require independent evidence.", "External reference rows do not count as AQ feed delivery.", "A passing accounting result permits documented omissions; inspect all_observed_aq_apps_offered.", "Original observations remain historical; refresh only fields presented as current."],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--exceptions", type=Path, default=Path(__file__).resolve().parents[1] / "data/aq-app-coverage-exceptions.json")
    parser.add_argument("--strict-current-mirror", action="store_true", help="Fail when integration_after_audit current fields are stale.")
    args = parser.parse_args()
    paths = ["data/aq-app-coverage.json", "mgu-repo.json", "release/catalog.json", "data/external-store-components.json", "data/components.json"]
    try:
        documents = [json.loads((args.repo / path).read_text(encoding="utf-8")) for path in paths]
        documents.append(json.loads(args.exceptions.read_text(encoding="utf-8")))
        if not all(isinstance(value, dict) for value in documents):
            raise ValueError("all input documents must be JSON objects")
        result = audit(*documents)
    except (OSError, ValueError, TypeError) as error:
        print(json.dumps({"accounting_status": "FAIL", "errors": [str(error)]}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return int(bool(result["errors"]) or (args.strict_current_mirror and bool(result["historical_current_mirror_drift"])))


if __name__ == "__main__":
    raise SystemExit(main())
