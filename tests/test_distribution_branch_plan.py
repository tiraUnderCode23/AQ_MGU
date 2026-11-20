"""Offline tests for evidence-bound distribution planning and new-directory export."""

import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "distribution_branch_plan", ROOT / "tools/plan_distribution_branches.py"
)
planner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = planner
SPEC.loader.exec_module(planner)

CANONICAL = "a" * 40
HISTORICAL = "b" * 40
UPSTREAM = "c" * 40


class MemorySnapshot:
    """Git-object-shaped bytes; no subprocess, network, builders, or devices."""

    def __init__(self, files, commit=CANONICAL, modes=None):
        self.commit = commit
        self.data = dict(files)
        self.modes = dict(modes or {})
        self.history = {}
        self.refresh()

    def refresh(self):
        self.files = {
            path: planner.Blob(
                path, hashlib.sha1(raw).hexdigest(),
                self.modes.get(path, "100644"), len(raw)
            )
            for path, raw in self.data.items()
        }

    def read(self, path):
        return self.data[path]

    def at(self, commit):
        return self.history[commit]


def source_component(identifier, kind="app", version="1.0.0", requires=None, hmi=None):
    component = {
        "id": identifier, "kind": kind, "version": version,
        "path": "family/" + ("apps/" if kind == "app" else "tools/") + identifier,
        "requires": dict(requires or {}), "mguHmi": ["ID8"] if hmi is None else hmi,
    }
    if kind == "app":
        component["build"] = "unit"
    return component


def released_component(identifier, kind="tool", version="1.0.0"):
    return {
        "id": identifier, "kind": kind, "version": version, "mguHmi": ["ID8"],
        "requires": {},
        "artifact": {
            "name": identifier + "@" + version + ".tgz",
            "url": "https://publisher.example/releases/" + identifier + ".tgz",
            "size": 123, "sha256": "d" * 64,
        },
    }


def fixture(source=None, release=None, name="id8", images=False):
    if source is None:
        source = [
            source_component("demo", requires={"helper": "1.0.0"}),
            source_component("helper", "tool", "1.2.0"),
        ]
    release = [] if release is None else release
    raw_evidence = b"Reviewed synthetic implementation contract; no target execution.\n"
    files = {
        "mgu-repo.json": planner.json_bytes({"schema": 1, "components": source}),
        "release/catalog.json": planner.json_bytes({"schema": 2, "components": release}),
        "evidence/implementation.txt": raw_evidence,
        "family/LICENSE": b"Synthetic fixture license notice.\n",
        "family/README.md": b"Original fixture documentation.\n",
        "LICENSES/fixture.txt": b"Synthetic third-party notice.\n",
        "README.md": b"Canonical inventory README.\n",
    }
    records = {}
    for channel, components in (("source", source), ("release", release)):
        for component in components:
            key = f"{channel}:{component['id']}@{component['version']}"
            records[key] = {
                "id": component["id"], "version": component["version"],
                "kind": component["kind"], "channel": channel,
                "source_commit": CANONICAL,
                "hmi": list(component.get("mguHmi", [])),
                "status": "eligible_static", "requires": component.get("requires", {}),
                "dependencies": {}, "extra_paths": [],
                "evidence": [{
                    "path": "evidence/implementation.txt",
                    "sha256": planner.sha256(raw_evidence), "commit": CANONICAL,
                    "kind": "implementation_contract",
                    "detail": "Synthetic fixture evidence for the selected identity.",
                }],
                "runtime": "NOT_OBSERVED",
            }
            if channel == "source":
                path = component["path"]
                manifest = "mgu-app.json" if component["kind"] == "app" else "component.json"
                files[path + "/" + manifest] = planner.json_bytes({
                    "id": component["id"], "version": component["version"],
                    "kind": component["kind"], "mguHmi": component.get("mguHmi", []),
                })
                files[path + "/main.js"] = b"// synthetic committed payload; never executed\n"
    for record in records.values():
        for identifier in record["requires"]:
            choices = [key for key, item in records.items() if item["id"] == identifier]
            if len(choices) == 1:
                record["dependencies"][identifier] = choices[0]
    seeds = [key for key, item in records.items() if item["kind"] == "app"]
    if not seeds:
        seeds = list(records)
    evidence = {
        "schema": 1, "source_commit": CANONICAL, "variants": records,
        "external_variants": {},
        "distributions": {
            name: {"target_hmi": "ID8", "seeds": seeds, "eligibility_policy": "strict"}
        },
    }
    if images:
        metadata = {
            "demo": {
                "icon": "media/icon.png",
                "images": ["media/one.png", "media/two.png", "media/three.png", "media/four.gif"],
            }
        }
        files["data/app-images.json"] = planner.json_bytes(metadata)
        for path in ["media/icon.png", *metadata["demo"]["images"]]:
            files[path] = b"synthetic media bytes"
    return MemorySnapshot(files), evidence


class DistributionPlanTests(unittest.TestCase):
    def test_dependency_order_receipts_and_publisher_inputs_are_preserved(self):
        snapshot, evidence = fixture(images=True)
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        self.assertEqual(
            plan["selected_variants"], ["source:helper@1.2.0", "source:demo@1.0.0"]
        )
        paths = {item["path"] for item in plan["files"]}
        self.assertIn("family/LICENSE", paths)
        self.assertIn("family/README.md", paths)
        self.assertIn("LICENSES/fixture.txt", paths)
        self.assertIn("media/four.gif", paths)
        self.assertIn(".distribution/original/mgu-repo.json", paths)
        self.assertIn(".distribution/original/release/catalog.json", paths)
        self.assertEqual(
            plan["source_manifest_sha256"]["source"],
            planner.sha256(snapshot.read("mgu-repo.json")),
        )
        self.assertEqual(plan["runtime"], "NOT_OBSERVED")
        self.assertEqual(
            plan["plan_sha256"],
            planner.sha256(planner.json_bytes({k: v for k, v in plan.items() if k != "plan_sha256"})),
        )

    def test_source_and_release_variants_are_distinct_and_bound_explicitly(self):
        source = [
            source_component("demo", requires={"helper": "2.0.0"}),
            source_component("helper", "tool", "1.0.0"),
        ]
        snapshot, evidence = fixture(source, [released_component("helper", version="2.0.0")])
        evidence["variants"]["source:demo@1.0.0"]["dependencies"] = {"helper": "release:helper@2.0.0"}
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        self.assertEqual(plan["selected_variants"], ["release:helper@2.0.0", "source:demo@1.0.0"])
        source_ids = [row["id"] for row in json.loads(plan["generated_files"]["mgu-repo.json"])["components"]]
        release_ids = [row["id"] for row in json.loads(plan["generated_files"]["release/catalog.json"])["components"]]
        self.assertEqual(source_ids, ["demo"])
        self.assertEqual(release_ids, ["helper"])

    def test_ambiguous_same_channel_ids_are_rejected_before_selection(self):
        source = [
            source_component("demo"),
            source_component("helper", "tool", "1.0.0"),
            source_component("helper", "tool", "2.0.0"),
        ]
        snapshot, evidence = fixture(source)
        with self.assertRaisesRegex(planner.PlanningError, "same-ID source variant"):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_same_id_conflicting_kinds_are_not_silently_overwritten(self):
        snapshot, evidence = fixture(
            [source_component("shared")],
            [released_component("shared", "tool")],
        )
        evidence["distributions"]["id8"]["seeds"].append("release:shared@1.0.0")
        with self.assertRaisesRegex(planner.PlanningError, "Conflicting kinds"):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_same_id_same_kind_source_and_release_offers_cannot_both_be_effective(self):
        for released_version in ("1.0.0", "2.0.0"):
            snapshot, evidence = fixture(
                [source_component("shared")],
                [released_component("shared", "app", released_version)],
            )
            with self.subTest(released_version=released_version):
                with self.assertRaisesRegex(planner.PlanningError, "Conflicting effective variants.*shared"):
                    planner.plan_distribution(snapshot, evidence, "id8")

    def test_consumers_cannot_bind_the_same_dependency_id_to_different_payloads(self):
        snapshot, evidence = fixture([
            source_component("left", requires={"helper": "1.0.0"}),
            source_component("right", requires={"helper": "1.0.0"}),
            source_component("helper", "tool"),
        ], [released_component("helper")])
        evidence["variants"]["source:left@1.0.0"]["dependencies"] = {"helper": "source:helper@1.0.0"}
        evidence["variants"]["source:right@1.0.0"]["dependencies"] = {"helper": "release:helper@1.0.0"}
        with self.assertRaisesRegex(planner.PlanningError, "Conflicting effective variants.*helper"):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_external_and_local_provider_cannot_share_an_effective_id(self):
        snapshot, evidence = fixture()
        key = "external:Publisher/tools:helper@1.2.0"
        external = copy.deepcopy(evidence["variants"]["source:helper@1.2.0"])
        external.update({
            "channel": "external", "repository": "Publisher/tools",
            "upstream_commit": UPSTREAM, "upstream_channel": "branch:main",
        })
        evidence["external_variants"][key] = external
        evidence["distributions"]["id8"]["seeds"].append(key)
        with self.assertRaisesRegex(planner.PlanningError, "Conflicting effective variants.*helper"):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_missing_dependency_and_insufficient_minimum_stop_plan(self):
        for binding, expected in (
            ({}, "Unresolved dependency"),
            ({"helper": "source:helper@1.2.0"}, "does not satisfy"),
        ):
            snapshot, evidence = fixture()
            record = evidence["variants"]["source:demo@1.0.0"]
            record["dependencies"] = binding
            if binding:
                manifest = json.loads(snapshot.read("mgu-repo.json"))
                manifest["components"][0]["requires"]["helper"] = "1.3.0"
                snapshot.data["mgu-repo.json"] = planner.json_bytes(manifest)
                snapshot.refresh()
                record["requires"] = {"helper": "1.3.0"}
            with self.subTest(binding=binding):
                with self.assertRaisesRegex(planner.PlanningError, expected):
                    planner.plan_distribution(snapshot, evidence, "id8")

    def test_declared_requirements_cannot_be_weakened_in_evidence(self):
        snapshot, evidence = fixture()
        evidence["variants"]["source:demo@1.0.0"]["requires"] = {"helper": "0.1.0"}
        with self.assertRaisesRegex(planner.PlanningError, "changes declared requirements"):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_wrong_dependency_identity_and_cycle_fail(self):
        snapshot, evidence = fixture()
        evidence["variants"]["source:demo@1.0.0"]["dependencies"]["helper"] = "source:demo@1.0.0"
        with self.assertRaisesRegex(planner.PlanningError, "Wrong dependency identity"):
            planner.plan_distribution(snapshot, evidence, "id8")
        source = [
            source_component("demo", requires={"one": "1.0.0"}),
            source_component("one", "tool", requires={"two": "1.0.0"}),
            source_component("two", "tool", requires={"one": "1.0.0"}),
        ]
        snapshot, evidence = fixture(source)
        with self.assertRaisesRegex(planner.PlanningError, "Dependency cycle"):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_id8_rejects_id7_unknown_and_declaration_only_helpers(self):
        for hmi, status, citation_kind in (
            (["ID7"], "eligible_static", "implementation_contract"),
            ([], "eligible_static", "implementation_contract"),
            (["ID8"], "declared_only", "implementation_contract"),
            (["ID8"], "eligible_static", "declared_hmi"),
        ):
            snapshot, evidence = fixture()
            record = evidence["variants"]["source:helper@1.2.0"]
            record["hmi"] = hmi
            record["status"] = status
            record["evidence"][0]["kind"] = citation_kind
            with self.subTest(hmi=hmi, status=status, kind=citation_kind):
                with self.assertRaises(planner.PlanningError):
                    planner.plan_distribution(snapshot, evidence, "id8")

    def test_evidence_cannot_relabel_id7_manifest_as_id8(self):
        snapshot, evidence = fixture([
            source_component("demo", hmi=["ID7"]),
        ])
        evidence["variants"]["source:demo@1.0.0"]["hmi"] = ["ID8"]
        with self.assertRaisesRegex(planner.PlanningError, "manifest.*ID8"):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_stale_commit_or_evidence_hash_is_rejected(self):
        for mutation in ("commit", "hash", "identity"):
            snapshot, evidence = fixture()
            record = evidence["variants"]["source:demo@1.0.0"]
            if mutation == "commit":
                record["source_commit"] = "f" * 40
            elif mutation == "hash":
                record["evidence"][0]["sha256"] = "0" * 64
            else:
                record["version"] = "9.0.0"
            with self.subTest(mutation=mutation):
                with self.assertRaises(planner.PlanningError):
                    planner.plan_distribution(snapshot, evidence, "id8")

    def test_explicit_external_dependency_requires_pin_and_compatible_evidence(self):
        snapshot, evidence = fixture([source_component("demo", requires={"external-helper": "1.1.0"})])
        key = "external:Publisher/tools:external-helper@1.2.0"
        external = copy.deepcopy(evidence["variants"]["source:demo@1.0.0"])
        external.update({
            "id": "external-helper", "kind": "tool", "version": "1.2.0", "channel": "external",
            "repository": "Publisher/tools", "upstream_commit": UPSTREAM,
            "upstream_channel": "branch:main", "requires": {}, "dependencies": {},
        })
        evidence["external_variants"][key] = external
        evidence["variants"]["source:demo@1.0.0"]["dependencies"] = {"external-helper": key}
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        self.assertEqual(plan["external_dependencies"], [key])
        self.assertNotIn("external-helper", plan["generated_files"]["release/catalog.json"])
        external["upstream_commit"] = "main"
        with self.assertRaisesRegex(planner.PlanningError, "full lowercase"):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_scripted_sources_require_shared_and_python_prerequisite(self):
        app = source_component("demo", requires={})
        app["build"] = {"python": "family/build.py"}
        python = released_component("mgu-python", version="1.0.3")
        snapshot, evidence = fixture([app], [python])
        snapshot.data["family/build.py"] = b"# builder fixture, never executed\n"
        snapshot.refresh()
        app_record = evidence["variants"]["source:demo@1.0.0"]
        with self.assertRaisesRegex(planner.PlanningError, "explicit mgu-python"):
            planner.plan_distribution(snapshot, evidence, "id8")
        app_record["build_requires"] = {"mgu-python": "1.0.2"}
        app_record["dependencies"] = {"mgu-python": "release:mgu-python@1.0.3"}
        with self.assertRaisesRegex(planner.PlanningError, "whole-repository fallback refused"):
            planner.plan_distribution(snapshot, evidence, "id8")
        manifest = json.loads(snapshot.read("mgu-repo.json"))
        manifest["components"][0]["build"]["shared"] = ["family/LICENSE"]
        snapshot.data["mgu-repo.json"] = planner.json_bytes(manifest)
        snapshot.refresh()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        self.assertIn("release:mgu-python@1.0.3", plan["selected_variants"])
        self.assertIn("family/build.py", {item["source_path"] for item in plan["files"]})

    def test_python_build_evidence_cannot_weaken_the_native_tool_floor(self):
        for minimum in ("0.0.0", "1.0.1", "1.0.2-beta.1"):
            app = source_component("demo")
            app["build"] = {"python": "family/build.py", "shared": []}
            snapshot, evidence = fixture([app], [released_component("mgu-python", version="1.0.3")])
            snapshot.data["family/build.py"] = b"# never executed\n"
            snapshot.refresh()
            record = evidence["variants"]["source:demo@1.0.0"]
            record["build_requires"] = {"mgu-python": minimum}
            record["dependencies"] = {"mgu-python": "release:mgu-python@1.0.3"}
            with self.subTest(minimum=minimum):
                with self.assertRaisesRegex(planner.PlanningError, "mgu-python >=1.0.2"):
                    planner.plan_distribution(snapshot, evidence, "id8")

    def test_absent_sdk_requires_explicit_target_supplied_record(self):
        app = source_component("demo")
        app["build"] = {"node": "family/build.js", "shared": [], "sdk": "family/target-sdk"}
        snapshot, evidence = fixture([app], [released_component("mgu-deploy", version="0.3.2")])
        snapshot.data["family/build.js"] = b"// synthetic builder\n"
        snapshot.refresh()
        evidence["variants"]["source:demo@1.0.0"]["build_requires"] = {"mgu-deploy": "0.3.2"}
        evidence["variants"]["source:demo@1.0.0"]["dependencies"] = {"mgu-deploy": "release:mgu-deploy@0.3.2"}
        with self.assertRaisesRegex(planner.PlanningError, "explicitly target-supplied"):
            planner.plan_distribution(snapshot, evidence, "id8")
        evidence["variants"]["source:demo@1.0.0"]["target_inputs"] = [{
            "path": "family/target-sdk", "kind": "sdk",
            "detail": "Original builder obtains this from its target environment; not included.",
        }]
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        self.assertEqual(plan["target_inputs"][0]["path"], "family/target-sdk")
        self.assertFalse(any(item["source_path"].startswith("family/target-sdk/") for item in plan["files"]))

    def test_omitted_sibling_shared_module_is_not_hidden_by_export(self):
        app = source_component("demo")
        app["build"] = {"python": "family/kit/tools/build.py", "shared": ["family/kit"]}
        snapshot, evidence = fixture([app], [released_component("mgu-python", version="1.0.3")])
        snapshot.data.update({
            "family/kit/tools/build.py": b"# synthetic builder\n",
            "family/apps/demo/app.json": planner.json_bytes({"shared": ["drawing.js"]}),
            "family/shared/drawing.js": b"// synthetic sibling input\n",
        })
        snapshot.refresh()
        record = evidence["variants"]["source:demo@1.0.0"]
        record["build_requires"] = {"mgu-python": "1.0.2"}
        record["dependencies"] = {"mgu-python": "release:mgu-python@1.0.3"}
        with self.assertRaisesRegex(planner.PlanningError, "omitted by build.shared"):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_missing_inputs_path_escape_case_collisions_and_symlinks_fail(self):
        for mutation in ("missing", "escape", "case", "symlink"):
            snapshot, evidence = fixture()
            record = evidence["variants"]["source:demo@1.0.0"]
            if mutation == "missing":
                record["extra_paths"] = ["missing/input.js"]
            elif mutation == "escape":
                record["extra_paths"] = ["../outside"]
            elif mutation == "case":
                snapshot.data["family/apps/demo/MAIN.js"] = b"case collision"
                snapshot.refresh()
            else:
                snapshot.modes["family/apps/demo/main.js"] = "120000"
                snapshot.refresh()
            with self.subTest(mutation=mutation):
                with self.assertRaises(planner.PlanningError):
                    planner.plan_distribution(snapshot, evidence, "id8")

    def test_release_artifact_size_hash_and_url_must_be_exact(self):
        for mutation in ("size", "hash", "url"):
            release = released_component("helper")
            release["artifact"][{"size": "size", "hash": "sha256", "url": "url"}[mutation]] = {
                "size": True, "hash": "unknown", "url": "http://publisher.example/file.tgz"
            }[mutation]
            snapshot, evidence = fixture([], [release])
            with self.subTest(mutation=mutation):
                with self.assertRaises(planner.PlanningError):
                    planner.plan_distribution(snapshot, evidence, "id8")

    def test_games_requires_historical_inventory_and_retains_streaming_helpers(self):
        source = [source_component("jap_moonride", requires={"jap-moonride": "0.3.4"})]
        release = [released_component("jap-moonride", version="0.3.4")]
        snapshot, evidence = fixture(source, release, name="games")
        with self.assertRaisesRegex(planner.PlanningError, "Games requires preserve_from"):
            planner.plan_distribution(snapshot, evidence, "games")
        old = MemorySnapshot(snapshot.data, HISTORICAL)
        snapshot.history[HISTORICAL] = old
        evidence["distributions"]["games"]["preserve_from"] = HISTORICAL
        plan = planner.plan_distribution(snapshot, evidence, "games")
        self.assertIn("jap_moonride", plan["historical_preservation"]["retained_ids"])
        self.assertIn("jap-moonride", plan["historical_preservation"]["retained_ids"])
        preserved = plan["historical_preservation"]["variants"]["source:jap_moonride@1.0.0"]
        self.assertEqual(preserved["state"], "same_manifest_and_declared_inputs")
        self.assertEqual(preserved["historical"]["source_commit"], HISTORICAL)
        self.assertEqual(preserved["historical"]["component"], source[0])
        self.assertEqual(preserved["historical"]["component_sha256"], planner.sha256(planner.json_bytes(source[0])))
        historical_manifest = json.loads(old.read("release/catalog.json"))
        historical_manifest["components"].append(released_component("optional-controller"))
        old.data["release/catalog.json"] = planner.json_bytes(historical_manifest)
        old.refresh()
        with self.assertRaisesRegex(planner.PlanningError, "optional-controller"):
            planner.plan_distribution(snapshot, evidence, "games")

    def test_historical_upgrade_requires_reviewed_mapping_and_preserves_original_identity(self):
        snapshot, evidence = fixture([source_component("demo", version="2.0.0")], name="games")
        old, _ = fixture([source_component("demo", version="1.0.0")], name="games")
        old.commit = HISTORICAL
        snapshot.history[HISTORICAL] = old
        configuration = evidence["distributions"]["games"]
        configuration["preserve_from"] = HISTORICAL
        with self.assertRaisesRegex(planner.PlanningError, "explicit migration required"):
            planner.plan_distribution(snapshot, evidence, "games")
        configuration["historical_migrations"] = {
            "source:demo@1.0.0": {
                "to": "source:demo@2.0.0", "reason": "Reviewed version upgrade retaining the application's identity.",
            },
        }
        plan = planner.plan_distribution(snapshot, evidence, "games")
        preservation = plan["historical_preservation"]["variants"]["source:demo@1.0.0"]
        self.assertEqual(preservation["state"], "reviewed_migration")
        self.assertEqual(preservation["historical"]["version"], "1.0.0")
        self.assertEqual(preservation["selected"]["version"], "2.0.0")
        self.assertTrue(preservation["reason"])
        with tempfile.TemporaryDirectory() as directory:
            output = planner.materialize_distribution(snapshot, plan, Path(directory) / "reviewed-upgrade", plan["plan_sha256"])
            receipt = json.loads((output / ".distribution/receipt.json").read_bytes())
            self.assertEqual(receipt["historical_preservation"], plan["historical_preservation"])

    def test_historical_same_version_changed_source_bytes_needs_a_migration(self):
        snapshot, evidence = fixture([source_component("demo")], name="games")
        snapshot.history[HISTORICAL] = MemorySnapshot(snapshot.data, HISTORICAL)
        configuration = evidence["distributions"]["games"]
        configuration["preserve_from"] = HISTORICAL
        snapshot.data["family/apps/demo/main.js"] = b"// changed source at the same version\n"
        snapshot.refresh()
        with self.assertRaisesRegex(planner.PlanningError, "explicit migration required"):
            planner.plan_distribution(snapshot, evidence, "games")
        configuration["historical_migrations"] = {
            "source:demo@1.0.0": {"to": "source:demo@1.0.0", "reason": "Reviewed source correction; prior bytes remain in Git."},
        }
        plan = planner.plan_distribution(snapshot, evidence, "games")
        preservation = plan["historical_preservation"]["variants"]["source:demo@1.0.0"]
        self.assertEqual(preservation["state"], "reviewed_migration")
        self.assertNotEqual(
            preservation["historical"]["declared_inputs_sha256"],
            preservation["selected"]["declared_inputs_sha256"],
        )

    def test_historical_channel_or_publisher_payload_change_is_not_silent_preservation(self):
        for mutation in ("channel", "publisher_payload"):
            snapshot, evidence = fixture([], [released_component("demo", "app")], name="games")
            old = MemorySnapshot(snapshot.data, HISTORICAL)
            if mutation == "channel":
                old, _ = fixture([source_component("demo")], name="games")
                old.commit = HISTORICAL
            else:
                manifest = json.loads(old.read("release/catalog.json"))
                manifest["components"][0]["artifact"]["sha256"] = "e" * 64
                old.data["release/catalog.json"] = planner.json_bytes(manifest)
                old.refresh()
            snapshot.history[HISTORICAL] = old
            evidence["distributions"]["games"]["preserve_from"] = HISTORICAL
            with self.subTest(mutation=mutation):
                with self.assertRaisesRegex(planner.PlanningError, "explicit migration required"):
                    planner.plan_distribution(snapshot, evidence, "games")

    def test_historical_app_cannot_be_replaced_by_a_tool_with_the_same_id(self):
        snapshot, evidence = fixture([], [released_component("demo", "tool")], name="games")
        old, _ = fixture([source_component("demo")], name="games")
        old.commit = HISTORICAL
        snapshot.history[HISTORICAL] = old
        evidence["distributions"]["games"].update({
            "preserve_from": HISTORICAL,
            "historical_migrations": {
                "source:demo@1.0.0": {"to": "release:demo@1.0.0", "reason": "A kind change cannot preserve the app."},
            },
        })
        with self.assertRaisesRegex(planner.PlanningError, "Historical kind changed"):
            planner.plan_distribution(snapshot, evidence, "games")

    def test_historical_mapping_requires_exact_keys_target_and_nonempty_reason(self):
        for migration in (
            {"source:demo@1.0.0": None},
            {"source:missing@1.0.0": {"to": "source:demo@1.0.0", "reason": "Wrong history."}},
            {"source:demo@1.0.0": {"to": "release:demo@1.0.0", "reason": "Wrong selected provider."}},
            {"source:demo@1.0.0": {"to": "source:demo@1.0.0", "reason": "  "}},
        ):
            snapshot, evidence = fixture([source_component("demo")], name="games")
            snapshot.history[HISTORICAL] = MemorySnapshot(snapshot.data, HISTORICAL)
            evidence["distributions"]["games"].update({
                "preserve_from": HISTORICAL, "historical_migrations": migration,
            })
            with self.subTest(migration=migration):
                with self.assertRaisesRegex(planner.PlanningError, "Historical migration"):
                    planner.plan_distribution(snapshot, evidence, "games")

    def test_preservation_keeps_unknown_status_without_promoting_hmi(self):
        snapshot, evidence = fixture([source_component("demo", hmi=[])], name="all")
        evidence["variants"]["source:demo@1.0.0"]["status"] = "unknown"
        evidence["distributions"]["all"].update({"target_hmi": None, "eligibility_policy": "preservation"})
        plan = planner.plan_distribution(snapshot, evidence, "all")
        self.assertEqual(plan["target_hmi"], None)
        self.assertIn("unknown", plan["generated_files"]["README.md"])
        self.assertTrue(plan["warnings"])
        evidence["distributions"]["all"]["target_hmi"] = "ID8"
        with self.assertRaisesRegex(planner.PlanningError, "cannot use preservation"):
            planner.plan_distribution(snapshot, evidence, "all")

    def test_json_duplicate_keys_and_numeric_versions(self):
        with self.assertRaisesRegex(planner.PlanningError, "Duplicate JSON key"):
            planner.parse_json(b'{"id":"one","id":"two"}', "fixture")
        self.assertTrue(planner.version_at_least("1.10.0", "1.9.0"))
        self.assertFalse(planner.version_at_least("1.0.0-beta.2", "1.0.0"))
        self.assertTrue(planner.version_at_least("1.0.0-beta.10", "1.0.0-beta.2"))
        self.assertTrue(planner.version_at_least("1.0", "1.0.0"))
        with self.assertRaises(planner.PlanningError):
            planner.version_at_least("latest", "1.0.0")

    def test_id8_name_cannot_omit_target_or_switch_to_preservation(self):
        for target, policy in ((None, "strict"), (None, "preservation"), ("ID7", "strict")):
            snapshot, evidence = fixture()
            evidence["distributions"]["id8"].update({
                "target_hmi": target, "eligibility_policy": policy,
            })
            with self.subTest(target=target, policy=policy):
                with self.assertRaisesRegex(planner.PlanningError, "must explicitly target ID8"):
                    planner.plan_distribution(snapshot, evidence, "id8")


class DistributionReadmeTests(unittest.TestCase):
    def test_gallery_keeps_every_screenshot_descriptions_versions_and_helpers(self):
        app = source_component("demo", requires={"helper": "1.0.0"})
        app.update(title="Demo & weather", description="A declared dashboard preview.")
        helper = source_component("helper", "tool", "1.2.0")
        helper.update(title="Drawing helper", description="Original drawing service.")
        snapshot, evidence = fixture([app, helper], images=True)
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        readme = plan["generated_files"]["README.md"]
        self.assertIn("### Demo &amp; weather", readme)
        self.assertIn("A declared dashboard preview.", readme)
        self.assertIn("`demo@1.0.0`", readme)
        self.assertIn('src="media/icon.png" width="64"', readme)
        self.assertEqual(readme.count('height="180"'), 4)
        for path in ("one.png", "two.png", "three.png", "four.gif"):
            self.assertIn('src="media/' + path + '"', readme)
            self.assertIn("media/" + path, {item["path"] for item in plan["files"]})
        self.assertIn("## Helper tools", readme)
        self.assertIn("Original drawing service.", readme)
        self.assertIn("helper &gt;=1.0.0 (selected 1.2.0; source)", readme)
        self.assertIn("Required or retained by: [demo]", readme)
        self.assertIn("| source | 1 | 1 |", readme)
        self.assertIn("Runtime / physical installation: **NOT OBSERVED**", readme)

    def test_original_install_document_links_are_exported_and_portably_encoded(self):
        snapshot, evidence = fixture()
        path = "docs/Install guide (EN).md"
        raw = b"# Original installation notes\n\n## Quick start\n"
        snapshot.data[path] = raw
        snapshot.data["data/components.json"] = planner.json_bytes({"components": [{
            "id": "demo", "kind": "app", "version": "1.0.0", "source_path": "family/apps/demo",
            "upstream_readme": path + "#quick-start",
        }]})
        snapshot.refresh()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        readme = plan["generated_files"]["README.md"]
        self.assertIn("[Original README / installation](docs/Install%20guide%20%28EN%29.md#quick-start)", readme)
        self.assertIn("[Preserved original repository README](.distribution/original/README.md)", readme)
        self.assertIn("[Source directory](family/apps/demo)", readme)
        inputs = {row["path"]: row for row in plan["files"]}
        self.assertEqual(inputs[path]["sha256"], planner.sha256(raw))
        self.assertIn(".distribution/original/data/components.json", inputs)
        self.assertIn("data/components.json", plan["generated_files"])

    def test_stale_version_or_other_source_metadata_cannot_supply_readme_details(self):
        for field, value in (("version", "2.0.0"), ("source_path", "foreign/apps/demo")):
            snapshot, evidence = fixture()
            row = {
                "id": "demo", "kind": "app", "version": "1.0.0", "source_path": "family/apps/demo",
                "description": "Wrong provider details", "upstream_readme": "javascript:invalid",
            }
            row[field] = value
            snapshot.data["data/components.json"] = planner.json_bytes({"components": [row]})
            snapshot.refresh()
            with self.subTest(field=field):
                plan = planner.plan_distribution(snapshot, evidence, "id8")
                readme = plan["generated_files"]["README.md"]
                self.assertNotIn("Wrong provider details", readme)
                self.assertNotIn("javascript:invalid", readme)
                active = json.loads(plan["generated_files"]["data/components.json"])
                demo = next(item for item in active["components"] if item["id"] == "demo")
                self.assertEqual(demo["version"], "1.0.0")
                self.assertEqual(demo["source_path"], "family/apps/demo")
                self.assertNotIn("description", demo)
                self.assertNotIn("upstream_readme", demo)

    def test_component_manifest_media_work_without_a_gallery_index(self):
        app = source_component("demo")
        app.update(icon="icon one.png", screenshots=["images/game#1.png", "https://cdn.example/second.png"])
        snapshot, evidence = fixture([app])
        snapshot.data[app["path"] + "/icon one.png"] = b"fixture icon"
        snapshot.data[app["path"] + "/images/game#1.png"] = b"fixture screenshot"
        snapshot.refresh()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        readme = plan["generated_files"]["README.md"]
        self.assertIn('src="family/apps/demo/icon%20one.png"', readme)
        self.assertIn('src="family/apps/demo/images/game%231.png"', readme)
        self.assertIn('src="https://cdn.example/second.png"', readme)
        self.assertEqual(plan["external_media"], [{"id": "demo", "url": "https://cdn.example/second.png", "downloaded": False}])
        self.assertIn("HTTPS media are external references", readme)
        metadata = json.loads(plan["generated_files"]["data/app-images.json"])
        self.assertEqual(metadata["demo"]["image_count"], 2)

    def test_readme_rejects_unsafe_media_and_document_targets(self):
        for value in ("javascript:alert(1)", "//cdn.example/image.png", "../outside.png", "https://[broken"):
            snapshot, evidence = fixture(images=True)
            snapshot.data["data/app-images.json"] = planner.json_bytes({"demo": {"images": [value]}})
            snapshot.refresh()
            with self.subTest(value=value):
                with self.assertRaises(planner.PlanningError):
                    planner.plan_distribution(snapshot, evidence, "id8")
        snapshot, evidence = fixture()
        snapshot.data["data/components.json"] = planner.json_bytes({"components": [{
            "id": "demo", "kind": "app", "version": "1.0.0", "source_path": "family/apps/demo",
            "upstream_readme": "https://user:secret@example.com/install",
        }]})
        snapshot.refresh()
        with self.assertRaises(planner.PlanningError):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_catalog_prose_cannot_inject_html_or_markdown_links(self):
        app = source_component("demo")
        app.update(title='<img src="x" onerror="bad">', description="[run](javascript:bad)\n# injected <script>bad</script>")
        snapshot, evidence = fixture([app])
        readme = planner.plan_distribution(snapshot, evidence, "id8")["generated_files"]["README.md"]
        self.assertNotIn('<img src="x"', readme)
        self.assertNotIn("<script>", readme)
        self.assertNotIn("[run](javascript:bad)", readme)
        self.assertIn("&lt;script&gt;bad&lt;/script&gt;", readme)
        self.assertNotIn("\n# injected", readme)

    def test_external_origins_and_build_prerequisites_remain_visible(self):
        app = source_component("demo", requires={"external-helper": "1.0.0"})
        app["build"] = {"python": "family/build.py", "shared": []}
        snapshot, evidence = fixture([app], [released_component("mgu-python", version="1.0.3")])
        snapshot.data["family/build.py"] = b"# never executed\n"
        snapshot.refresh()
        external_key = "external:Publisher/tools:external-helper@1.2.0"
        external = copy.deepcopy(evidence["variants"]["source:demo@1.0.0"])
        external.update({
            "id": "external-helper", "kind": "tool", "version": "1.2.0", "channel": "external",
            "repository": "Publisher/tools", "upstream_commit": UPSTREAM,
            "upstream_channel": "branch:main", "requires": {}, "dependencies": {},
            "title": "Original companion helper", "description": "Fetched from its original source.",
        })
        evidence["external_variants"][external_key] = external
        record = evidence["variants"]["source:demo@1.0.0"]
        record["build_requires"] = {"mgu-python": "1.0.2"}
        record["dependencies"] = {"external-helper": external_key, "mgu-python": "release:mgu-python@1.0.3"}
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        readme = plan["generated_files"]["README.md"]
        self.assertIn("| release | 0 | 1 |", readme)
        self.assertIn("| external | 0 | 1 |", readme)
        self.assertIn("Build prerequisites: [mgu-python &gt;=1.0.2", readme)
        self.assertIn("### Original companion helper", readme)
        self.assertIn("https://github.com/Publisher/tools/tree/" + UPSTREAM, readme)
        self.assertIn("branch:main", readme)
        self.assertIn("[Original publisher artifact](https://publisher.example/releases/mgu-python.tgz)", readme)
        active = {row["id"]: row for row in json.loads(plan["generated_files"]["data/components.json"])["components"]}
        self.assertEqual(set(active), {"demo", "mgu-python", "external-helper"})
        self.assertEqual(active["demo"]["build_requires"], {"mgu-python": "1.0.2"})
        self.assertEqual(active["mgu-python"]["version"], "1.0.3")

    def test_gallery_plan_and_export_receipts_are_deterministic(self):
        snapshot, evidence = fixture(images=True)
        first = planner.plan_distribution(snapshot, evidence, "id8")
        second = planner.plan_distribution(snapshot, copy.deepcopy(evidence), "id8")
        self.assertEqual(first, second)
        with tempfile.TemporaryDirectory() as directory:
            outputs = []
            for name, plan in (("first", first), ("second", second)):
                output = planner.materialize_distribution(snapshot, plan, Path(directory) / name, plan["plan_sha256"])
                outputs.append(output)
            self.assertEqual((outputs[0] / "README.md").read_bytes(), (outputs[1] / "README.md").read_bytes())
            self.assertEqual(
                (outputs[0] / ".distribution/receipt.json").read_bytes(),
                (outputs[1] / ".distribution/receipt.json").read_bytes(),
            )


class DistributionDocumentationIndexTests(unittest.TestCase):
    @staticmethod
    def mixed_fixture():
        app = source_component("demo", requires={"released-helper": "1.0.0", "external-helper": "1.0.0"})
        released = released_component("released-helper", version="2.0.0")
        snapshot, evidence = fixture([app], [released])
        external_key = "external:Publisher/tools:external-helper@1.2.0"
        external = copy.deepcopy(evidence["variants"]["source:demo@1.0.0"])
        external.update({
            "id": "external-helper", "kind": "tool", "version": "1.2.0", "channel": "external",
            "repository": "Publisher/tools", "upstream_commit": UPSTREAM,
            "upstream_channel": "branch:main", "requires": {}, "dependencies": {},
        })
        evidence["external_variants"][external_key] = external
        evidence["variants"]["source:demo@1.0.0"]["dependencies"]["external-helper"] = external_key
        return snapshot, evidence, released, external_key

    def test_active_index_contains_only_selected_apps_and_all_required_helpers(self):
        for name in ("id8", "games"):
            app = source_component("demo", requires={"helper": "1.0.0"})
            helper = source_component("helper", "tool", "1.2.0")
            excluded = source_component("unselected-id7-app", hmi=["ID7"])
            snapshot, evidence = fixture([app, helper, excluded], name=name, images=True)
            configuration = evidence["distributions"][name]
            configuration["seeds"] = ["source:demo@1.0.0"]
            if name == "games":
                historical, _ = fixture([app, helper])
                historical.commit = HISTORICAL
                snapshot.history[HISTORICAL] = historical
                configuration.update(target_hmi=None, eligibility_policy="preservation", preserve_from=HISTORICAL)
            metadata = {
                "as_of": "2026-11-20", "counts": {"apps": 294}, "total": 294,
                "components": [
                    {
                        "id": "demo", "kind": "app", "version": "1.0.0", "source_path": app["path"],
                        "description": "Exact selected documentation.", "license": "Fixture license",
                        "source_review_notes": "Preserve this selected-row limitation.",
                        "supported_hmi": ["ID7"], "mguHmi": ["ID7"],
                        "requires": {"unselected-id7-app": "99.0.0"}, "image_count": 999,
                    },
                    {"id": "helper", "kind": "tool", "version": "1.2.0", "source_path": helper["path"]},
                    {"id": excluded["id"], "kind": "app", "version": "1.0.0", "source_path": excluded["path"]},
                ],
            }
            original = planner.json_bytes(metadata)
            snapshot.data["data/components.json"] = original
            snapshot.refresh()
            with self.subTest(distribution=name):
                plan = planner.plan_distribution(snapshot, evidence, name)
                active = json.loads(plan["generated_files"]["data/components.json"])
                self.assertEqual(active["as_of"], metadata["as_of"])
                self.assertNotIn("counts", active)
                self.assertNotIn("total", active)
                rows = {row["id"]: row for row in active["components"]}
                self.assertEqual(set(rows), {"demo", "helper"})
                self.assertEqual({row["variant_key"] for row in rows.values()}, set(plan["selected_variants"]))
                self.assertEqual(rows["demo"]["supported_hmi"], ["ID8"])
                self.assertEqual(rows["demo"]["mguHmi"], ["ID8"])
                self.assertEqual(rows["demo"]["requires"], {"helper": "1.0.0"})
                self.assertEqual(rows["demo"]["image_count"], 4)
                self.assertEqual(rows["demo"]["license"], "Fixture license")
                self.assertEqual(rows["demo"]["source_review_notes"], "Preserve this selected-row limitation.")
                self.assertEqual(plan["generated_files"]["README.md"].count('height="180"'), 4)
                originals = {row["path"]: row for row in plan["files"]}
                self.assertNotIn("data/components.json", originals)
                self.assertEqual(
                    originals[".distribution/original/data/components.json"]["sha256"],
                    planner.sha256(original),
                )

    def test_selected_release_and_external_details_keep_exact_provider_identity(self):
        snapshot, evidence, released, external_key = self.mixed_fixture()
        snapshot.data["data/components.json"] = planner.json_bytes({"as_of": "2026-11-20", "components": [
            {
                "id": "released-helper", "kind": "tool", "version": "2.0.0",
                "description": "Matching release documentation.", "license": "Release notice",
                "artifact": {**released["artifact"], "name": "stale-name.tgz", "size": 1},
                "supported_hmi": ["ID7"], "requires": {"obsolete": "1.0.0"},
            },
            {
                "id": "external-helper", "kind": "tool", "version": "1.2.0",
                "source_repository": "Publisher/tools", "upstream_commit": "e" * 40,
                "upstream_channel": "branch:old", "license": "Original companion notice",
                "description": "Matching external documentation.", "source_path": "not-bundled",
            },
        ]})
        snapshot.refresh()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        rows = {row["id"]: row for row in json.loads(plan["generated_files"]["data/components.json"])["components"]}
        self.assertEqual(set(rows), {"demo", "released-helper", "external-helper"})
        self.assertEqual(rows["released-helper"]["artifact"], released["artifact"])
        self.assertEqual(rows["released-helper"]["supported_hmi"], ["ID8"])
        self.assertEqual(rows["released-helper"]["requires"], {})
        self.assertEqual(rows["released-helper"]["description"], "Matching release documentation.")
        self.assertEqual(rows["released-helper"]["delivery"], "original publisher artifact")
        external = rows["external-helper"]
        self.assertEqual(external["variant_key"], external_key)
        self.assertEqual(external["source_repository"], "Publisher/tools")
        self.assertEqual(external["upstream_commit"], UPSTREAM)
        self.assertEqual(external["upstream_channel"], "branch:main")
        self.assertEqual(external["artifact"], {})
        self.assertIsNone(external["source_path"])
        self.assertEqual(external["license"], "Original companion notice")
        self.assertEqual(external["delivery"], "external original source")

    def test_other_release_payload_and_external_publisher_cannot_supply_details(self):
        snapshot, evidence, released, _ = self.mixed_fixture()
        snapshot.data["data/components.json"] = planner.json_bytes({"components": [
            {
                "id": "released-helper", "kind": "tool", "version": "2.0.0",
                "artifact": {**released["artifact"], "sha256": "f" * 64},
                "description": "Foreign release payload details", "license": "Wrong notice",
            },
            {
                "id": "external-helper", "kind": "tool", "version": "1.2.0",
                "source_repository": "OtherPublisher/tools", "description": "Foreign origin details",
                "license": "Wrong notice",
            },
        ]})
        snapshot.refresh()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        rows = {row["id"]: row for row in json.loads(plan["generated_files"]["data/components.json"])["components"]}
        for identifier in ("released-helper", "external-helper"):
            self.assertNotIn("description", rows[identifier])
            self.assertNotIn("license", rows[identifier])
        self.assertEqual(rows["released-helper"]["artifact"], released["artifact"])
        self.assertEqual(rows["external-helper"]["source_repository"], "Publisher/tools")

    def test_missing_documentation_index_produces_minimal_exact_selected_rows(self):
        snapshot, evidence, released, _ = self.mixed_fixture()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        active = json.loads(plan["generated_files"]["data/components.json"])
        self.assertNotIn("as_of", active)
        self.assertEqual(len(active["components"]), len(plan["selected_variants"]))
        self.assertEqual({row["variant_key"] for row in active["components"]}, set(plan["selected_variants"]))
        self.assertFalse(any(row["source_path"] == "data/components.json" for row in plan["files"]))
        rows = {row["id"]: row for row in active["components"]}
        self.assertEqual(rows["demo"]["source_path"], "family/apps/demo")
        self.assertEqual(rows["demo"]["requires"], {"released-helper": "1.0.0", "external-helper": "1.0.0"})
        self.assertEqual(rows["released-helper"]["artifact"], released["artifact"])
        self.assertEqual(rows["external-helper"]["upstream_commit"], UPSTREAM)

    def test_original_full_index_and_filtered_active_index_have_separate_receipts(self):
        snapshot, evidence = fixture()
        original = planner.json_bytes({"as_of": "2026-11-20", "components": [
            {"id": "demo", "kind": "app", "version": "1.0.0", "source_path": "family/apps/demo",
             "upstream_readme": "README.md#original"},
            {"id": "unselected", "kind": "app", "version": "9.0.0", "source_path": "other/app"},
        ]})
        snapshot.data["data/components.json"] = original
        snapshot.refresh()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        with tempfile.TemporaryDirectory() as directory:
            output = planner.materialize_distribution(snapshot, plan, Path(directory) / "selected", plan["plan_sha256"])
            self.assertEqual((output / ".distribution/original/data/components.json").read_bytes(), original)
            active = (output / "data/components.json").read_bytes()
            self.assertEqual({row["id"] for row in json.loads(active)["components"]}, {"demo", "helper"})
            demo = next(row for row in json.loads(active)["components"] if row["id"] == "demo")
            self.assertEqual(demo["upstream_readme"], ".distribution/original/README.md#original")
            receipt = json.loads((output / ".distribution/receipt.json").read_bytes())
            hashes = {row["path"]: row["sha256"] for row in receipt["files"]}
            self.assertEqual(hashes[".distribution/original/data/components.json"], planner.sha256(original))
            self.assertEqual(hashes["data/components.json"], planner.sha256(active))
            self.assertNotEqual(hashes["data/components.json"], hashes[".distribution/original/data/components.json"])


class DistributionStoreConfigurationTests(unittest.TestCase):
    @staticmethod
    def original_configuration():
        return {
            "schema": 1, "note": "Preserve the configured sources and their extra fields.",
            "sources": [
                {"id": "aq-mgu-apps", "type": "github", "repo": "tiraUnderCode23/AQ_MGU", "channel": "branch:main"},
                {"id": "aq-mgu-catalog", "type": "https", "url": "https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/main/release/catalog.json"},
                {"id": "aq-mgu-iteriodev", "type": "github", "repo": "IterioDev/car-apps", "channel": "branch:main", "label": "Original companion"},
            ],
        }

    def with_configuration(self, distribution="id8", config=None):
        snapshot, evidence = fixture(name=distribution)
        document = self.original_configuration() if config is None else config
        snapshot.data["data/store-sources.json"] = planner.json_bytes(document)
        snapshot.refresh()
        if distribution == "games":
            snapshot.history[HISTORICAL] = MemorySnapshot(snapshot.data, HISTORICAL)
            evidence["distributions"][distribution].update({
                "preserve_from": HISTORICAL, "target_hmi": None, "eligibility_policy": "preservation",
            })
        return snapshot, evidence

    def test_both_aq_feeds_follow_distribution_and_external_sources_remain_exact(self):
        for distribution in ("id8", "games"):
            snapshot, evidence = self.with_configuration(distribution)
            original_bytes = snapshot.read("data/store-sources.json")
            original = json.loads(original_bytes)
            with self.subTest(distribution=distribution):
                plan = planner.plan_distribution(snapshot, evidence, distribution)
                encoded = plan["generated_files"]["data/store-sources.json"]
                generated = json.loads(encoded)
                expected = copy.deepcopy(original)
                expected["sources"][0]["channel"] = "branch:" + distribution
                expected["sources"][1]["url"] = (
                    "https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/" + distribution + "/release/catalog.json"
                )
                self.assertEqual(generated, expected)
                self.assertEqual(generated["sources"][2], original["sources"][2])
                self.assertEqual(snapshot.read("data/store-sources.json"), original_bytes)
                readme = plan["generated_files"]["README.md"]
                self.assertIn("Configure **both AQ entries**", readme)
                self.assertIn("```json\n" + encoded.rstrip("\n") + "\n```", readme)
                self.assertNotIn("publication was performed", readme)
                self.assertIn("Runtime / physical installation: **NOT OBSERVED**", readme)
                originals = {item["path"]: item for item in plan["files"]}
                self.assertEqual(
                    originals[".distribution/original/data/store-sources.json"]["sha256"],
                    planner.sha256(original_bytes),
                )
                proof = plan["store_source_configuration"]
                self.assertEqual(proof["generated_sha256"], planner.sha256(encoded.encode("utf-8")))
                self.assertEqual(proof["original_sha256"], planner.sha256(original_bytes))

    def test_config_hashes_and_original_bytes_are_in_completion_receipt(self):
        snapshot, evidence = self.with_configuration()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        self.assertEqual(plan, planner.plan_distribution(snapshot, copy.deepcopy(evidence), "id8"))
        with tempfile.TemporaryDirectory() as directory:
            output = planner.materialize_distribution(snapshot, plan, Path(directory) / "configured", plan["plan_sha256"])
            receipt = json.loads((output / ".distribution/receipt.json").read_bytes())
            self.assertEqual(receipt["store_source_configuration"], plan["store_source_configuration"])
            self.assertEqual(
                (output / ".distribution/original/data/store-sources.json").read_bytes(),
                snapshot.read("data/store-sources.json"),
            )
            checksums = {row["path"]: row["sha256"] for row in receipt["files"]}
            self.assertEqual(checksums["data/store-sources.json"], plan["store_source_configuration"]["generated_sha256"])

    def test_foreign_repository_sources_and_catalogs_are_never_rewritten(self):
        config = self.original_configuration()
        foreign = [
            {"id": "other-source", "type": "github", "repo": "Other/Applications", "channel": "branch:main"},
            {"id": "other-catalog", "type": "https", "url": "https://raw.githubusercontent.com/Other/Applications/main/release/catalog.json"},
        ]
        config["sources"].extend(foreign)
        snapshot, evidence = self.with_configuration(config=config)
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        generated = json.loads(plan["generated_files"]["data/store-sources.json"])
        self.assertEqual(generated["sources"][-2:], foreign)
        wrong = self.original_configuration()
        wrong["sources"][0]["repo"] = "Other/Applications"
        wrong["sources"][1]["url"] = foreign[1]["url"]
        snapshot, evidence = self.with_configuration(config=wrong)
        original = snapshot.read("data/store-sources.json")
        with self.assertRaisesRegex(planner.PlanningError, "repository identity"):
            planner.plan_distribution(snapshot, evidence, "id8")
        self.assertEqual(snapshot.read("data/store-sources.json"), original)

    def test_missing_config_gives_explicit_both_feed_guidance_without_inventing_urls(self):
        snapshot, evidence = fixture()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        self.assertNotIn("data/store-sources.json", plan["generated_files"])
        self.assertIsNone(plan["store_source_configuration"])
        readme = plan["generated_files"]["README.md"]
        self.assertIn("no repository URL was inferred", readme)
        self.assertIn("configure both the published GitHub branch source and its HTTPS", readme)
        self.assertIn("The source branch alone does not provide the released helpers", readme)
        self.assertNotIn("raw.githubusercontent.com/tiraUnderCode23", readme)

    def test_present_config_cannot_omit_either_aq_feed_or_duplicate_its_identity(self):
        for mutation in ("missing_source", "missing_catalog", "duplicate_id", "additional_aq_source", "additional_aq_catalog"):
            config = self.original_configuration()
            if mutation == "missing_source":
                config["sources"].pop(0)
            elif mutation == "missing_catalog":
                config["sources"].pop(1)
            else:
                duplicate = dict(config["sources"][1 if mutation == "additional_aq_catalog" else 0])
                if mutation != "duplicate_id":
                    duplicate["id"] = "another-aq-entry"
                config["sources"].append(duplicate)
            snapshot, evidence = self.with_configuration(config=config)
            with self.subTest(mutation=mutation):
                with self.assertRaises(planner.PlanningError):
                    planner.plan_distribution(snapshot, evidence, "id8")

    def test_aq_catalog_must_match_exact_repository_branch_and_public_raw_url(self):
        invalid = (
            "https://raw.githubusercontent.com/Other/Applications/main/release/catalog.json",
            "https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/foreign/release/catalog.json",
            "https://example.com/tiraUnderCode23/AQ_MGU/main/release/catalog.json",
            "https://user:secret@raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/main/release/catalog.json",
            "https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/main/release/catalog.json?download=1",
            "https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/main/release/catalog.json#other",
        )
        for address in invalid:
            config = self.original_configuration()
            config["sources"][1]["url"] = address
            snapshot, evidence = self.with_configuration(config=config)
            with self.subTest(address=address):
                with self.assertRaisesRegex(planner.PlanningError, "catalog URL must match"):
                    planner.plan_distribution(snapshot, evidence, "id8")

    def test_selected_external_helper_requires_its_unchanged_configured_origin(self):
        snapshot, evidence = fixture([source_component("demo", requires={"external-helper": "1.0.0"})])
        config = self.original_configuration()
        snapshot.data["data/store-sources.json"] = planner.json_bytes(config)
        snapshot.refresh()
        key = "external:Publisher/tools:external-helper@1.2.0"
        external = copy.deepcopy(evidence["variants"]["source:demo@1.0.0"])
        external.update({
            "id": "external-helper", "kind": "tool", "version": "1.2.0", "channel": "external",
            "repository": "Publisher/tools", "upstream_commit": UPSTREAM,
            "upstream_channel": "branch:main", "requires": {}, "dependencies": {},
        })
        evidence["external_variants"][key] = external
        evidence["variants"]["source:demo@1.0.0"]["dependencies"] = {"external-helper": key}
        with self.assertRaisesRegex(planner.PlanningError, "configured external source"):
            planner.plan_distribution(snapshot, evidence, "id8")
        companion = {"id": "publisher-original", "type": "github", "repo": "Publisher/tools", "channel": "branch:main"}
        config["sources"].append(companion)
        snapshot.data["data/store-sources.json"] = planner.json_bytes(config)
        snapshot.refresh()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        generated = json.loads(plan["generated_files"]["data/store-sources.json"])
        self.assertEqual(generated["sources"][-1], companion)
        self.assertIn("external-helper", plan["generated_files"]["README.md"])


class DistributionExportBudgetTests(unittest.TestCase):
    def test_default_remains_200_mib_and_completion_files_are_accounted_exactly(self):
        snapshot, evidence = fixture(images=True)
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        self.assertEqual(plan["limits"]["bytes"], 200 * 1024 * 1024)
        self.assertEqual(plan["limits"]["hard_bytes"], 512 * 1024 * 1024)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "distribution"
            planner.materialize_distribution(snapshot, plan, output, plan["plan_sha256"])
            actual_files = [path for path in output.rglob("*") if path.is_file()]
            self.assertEqual(plan["totals"]["files"], len(actual_files))
            self.assertEqual(plan["totals"]["bytes"], sum(path.stat().st_size for path in actual_files))
            receipt = json.loads((output / ".distribution/receipt.json").read_bytes())
            self.assertEqual(receipt["totals"], plan["totals"])
            self.assertEqual(receipt["limits"], plan["limits"])
            self.assertEqual(len(receipt["files"]) + 1, plan["totals"]["files"])
            self.assertEqual(
                (output / ".distribution/plan.json").read_bytes(), planner.json_bytes(plan)
            )

    def test_default_rejects_oversized_inputs_before_reading_their_payload(self):
        snapshot, evidence = fixture()
        path = "family/apps/demo/main.js"
        blob = snapshot.files[path]
        snapshot.files[path] = planner.Blob(path, blob.oid, blob.mode, 201 * 1024 * 1024)
        original_read = snapshot.read

        def checked_read(relative):
            if relative == path:
                self.fail("An input over the effective budget must be rejected before its payload is read")
            return original_read(relative)

        with mock.patch.object(snapshot, "read", side_effect=checked_read):
            with self.assertRaisesRegex(planner.PlanningError, "Selected inputs exceed.*209715200"):
                planner.plan_distribution(snapshot, evidence, "id8")

    def test_reviewed_256_mib_budget_accepts_201_mib_descriptors_without_large_allocations(self):
        snapshot, evidence = fixture()
        evidence["distributions"]["id8"]["export_budget_bytes"] = 256 * 1024 * 1024
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        # Exercise aggregate accounting with descriptors only. This is not an
        # export and does not pretend that synthetic large payloads were read.
        plan["files"][0]["size"] = 101 * 1024 * 1024
        plan["files"][1]["size"] = 100 * 1024 * 1024
        plan = planner.finalize_export_accounting(plan)
        self.assertGreater(plan["totals"]["bytes"], 200 * 1024 * 1024)
        self.assertLess(plan["totals"]["bytes"], 256 * 1024 * 1024)
        self.assertEqual(plan["limits"]["bytes"], 268435456)
        receipt = json.loads(planner.completion_artifacts(plan)[1])
        self.assertEqual(receipt["limits"]["bytes"], 268435456)

    def test_budget_is_an_explicit_integer_below_the_hard_ceiling(self):
        for value in (None, True, False, 0, -1, "268435456", 268435456.0, 512 * 1024 * 1024 + 1):
            snapshot, evidence = fixture()
            evidence["distributions"]["id8"]["export_budget_bytes"] = value
            with self.subTest(value=value):
                with self.assertRaisesRegex(planner.PlanningError, "export_budget_bytes must be an integer"):
                    planner.plan_distribution(snapshot, evidence, "id8")
        snapshot, evidence = fixture()
        evidence["distributions"]["id8"]["export_budget_bytes"] = 512 * 1024 * 1024
        self.assertEqual(
            planner.plan_distribution(snapshot, evidence, "id8")["limits"]["bytes"],
            512 * 1024 * 1024,
        )

    def test_explicit_budget_does_not_raise_other_distributions_default(self):
        snapshot, evidence = fixture()
        evidence["distributions"]["other"] = copy.deepcopy(evidence["distributions"]["id8"])
        evidence["distributions"]["id8"]["export_budget_bytes"] = 256 * 1024 * 1024
        self.assertEqual(planner.plan_distribution(snapshot, evidence, "id8")["limits"]["bytes"], 268435456)
        self.assertEqual(planner.plan_distribution(snapshot, evidence, "other")["limits"]["bytes"], 209715200)

    def test_completion_overhead_can_exceed_an_otherwise_sufficient_budget(self):
        snapshot, evidence = fixture()
        baseline = planner.plan_distribution(snapshot, evidence, "id8")
        content_bytes = sum(item["size"] for item in baseline["files"]) + sum(
            len(text.encode("utf-8")) for text in baseline["generated_files"].values()
        )
        raw_plan = planner.json_bytes(baseline)
        evidence["distributions"]["id8"]["export_budget_bytes"] = content_bytes + len(raw_plan) // 2
        with self.assertRaisesRegex(planner.PlanningError, "Export including plan and receipt exceeds"):
            planner.plan_distribution(snapshot, evidence, "id8")

    def test_both_completion_files_consume_the_file_budget(self):
        snapshot, evidence = fixture()
        baseline = planner.plan_distribution(snapshot, evidence, "id8")
        with mock.patch.object(planner, "MAX_FILES", baseline["totals"]["files"] - 1):
            with self.assertRaisesRegex(planner.PlanningError, "file-count budget"):
                planner.plan_distribution(snapshot, evidence, "id8")

    def test_approved_but_underreported_completion_totals_create_no_directory(self):
        for field in ("files", "bytes"):
            snapshot, evidence = fixture()
            plan = planner.plan_distribution(snapshot, evidence, "id8")
            plan["totals"][field] -= 1
            unsigned = {key: value for key, value in plan.items() if key != "plan_sha256"}
            plan["plan_sha256"] = planner.sha256(planner.json_bytes(unsigned))
            with tempfile.TemporaryDirectory() as directory, self.subTest(field=field):
                output = Path(directory) / "unwritten"
                with self.assertRaisesRegex(planner.PlanningError, "exact plan and receipt bytes and files"):
                    planner.materialize_distribution(snapshot, plan, output, plan["plan_sha256"])
                self.assertFalse(output.exists())

    def test_export_rechecks_evidence_budget_and_hard_ceiling_before_writing(self):
        for value, diagnostic in (
            (256 * 1024 * 1024, "differs from its distribution evidence"),
            (512 * 1024 * 1024 + 1, "export_budget_bytes must be an integer"),
        ):
            snapshot, evidence = fixture()
            plan = planner.plan_distribution(snapshot, evidence, "id8")
            plan["limits"]["bytes"] = value
            unsigned = {key: item for key, item in plan.items() if key != "plan_sha256"}
            plan["plan_sha256"] = planner.sha256(planner.json_bytes(unsigned))
            with tempfile.TemporaryDirectory() as directory, self.subTest(value=value):
                output = Path(directory) / "unwritten"
                with self.assertRaisesRegex(planner.PlanningError, diagnostic):
                    planner.materialize_distribution(snapshot, plan, output, plan["plan_sha256"])
                self.assertFalse(output.exists())

    def test_completion_accounting_remains_deterministic(self):
        snapshot, evidence = fixture(images=True)
        evidence["distributions"]["id8"]["export_budget_bytes"] = 256 * 1024 * 1024
        first = planner.plan_distribution(snapshot, evidence, "id8")
        second = planner.plan_distribution(snapshot, evidence, "id8")
        self.assertEqual(planner.completion_artifacts(first), planner.completion_artifacts(second))
        self.assertEqual(first["plan_sha256"], second["plan_sha256"])


class DistributionExportTests(unittest.TestCase):
    def test_plan_only_cli_does_not_create_output_or_invoke_export(self):
        snapshot, evidence = fixture()
        with tempfile.TemporaryDirectory() as directory:
            evidence_path = Path(directory) / "evidence.json"
            evidence_path.write_bytes(planner.json_bytes(evidence))
            output = io.StringIO()
            with mock.patch.object(planner, "GitSnapshot", return_value=snapshot), \
                    mock.patch.object(planner, "materialize_distribution") as export, \
                    contextlib.redirect_stdout(output):
                result = planner.main([
                    "--repository", directory, "--commit", CANONICAL,
                    "--evidence", str(evidence_path), "--distribution", "id8",
                ])
            self.assertEqual(result, 0)
            export.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())["source_commit"], CANONICAL)
            self.assertEqual(sorted(path.name for path in Path(directory).iterdir()), ["evidence.json"])

    def test_export_checks_approved_plan_then_preserves_bytes_modes_and_receipt(self):
        snapshot, evidence = fixture(images=True)
        snapshot.modes["family/tools/helper/main.js"] = "100755"
        snapshot.refresh()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "new-distribution"
            with mock.patch.object(planner.subprocess, "run", side_effect=AssertionError("No subprocess in export")):
                written = planner.materialize_distribution(snapshot, plan, output, plan["plan_sha256"])
            self.assertEqual(written, output)
            for item in plan["files"]:
                self.assertEqual(
                    (output / item["path"]).read_bytes(),
                    snapshot.read(item["source_path"]),
                )
            receipt = json.loads((output / ".distribution/receipt.json").read_text(encoding="utf-8"))
            self.assertEqual(receipt["state"], "complete")
            self.assertEqual(receipt["plan_sha256"], plan["plan_sha256"])
            self.assertFalse(receipt["external_payloads_downloaded"])
            if sys.platform != "win32":
                self.assertTrue((output / "family/tools/helper/main.js").stat().st_mode & stat.S_IXUSR)

    def test_existing_target_is_never_reused_or_cleared(self):
        snapshot, evidence = fixture()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "existing"
            output.mkdir()
            sentinel = output / "user-work.txt"
            sentinel.write_text("preserve me", encoding="utf-8")
            with self.assertRaisesRegex(planner.PlanningError, "already exists"):
                planner.materialize_distribution(snapshot, plan, output, plan["plan_sha256"])
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "preserve me")
            self.assertEqual(list(output.iterdir()), [sentinel])

    def test_wrong_approval_or_source_drift_creates_no_directory(self):
        for mutation in ("approval", "source"):
            snapshot, evidence = fixture()
            plan = planner.plan_distribution(snapshot, evidence, "id8")
            approved = plan["plan_sha256"]
            if mutation == "approval":
                approved = "0" * 64
            else:
                snapshot.data["family/apps/demo/main.js"] = b"changed"
                snapshot.refresh()
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "export"
                with self.subTest(mutation=mutation):
                    with self.assertRaises(planner.PlanningError):
                        planner.materialize_distribution(snapshot, plan, output, approved)
                    self.assertFalse(output.exists())

    def test_export_inside_source_worktree_is_rejected(self):
        snapshot, evidence = fixture()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        with tempfile.TemporaryDirectory() as directory:
            snapshot.repository = Path(directory)
            output = Path(directory) / "export"
            with self.assertRaisesRegex(planner.PlanningError, "outside the source working tree"):
                planner.materialize_distribution(snapshot, plan, output, plan["plan_sha256"])
            self.assertFalse(output.exists())

    def test_modified_generated_manifest_invalidates_reviewed_plan(self):
        snapshot, evidence = fixture()
        plan = planner.plan_distribution(snapshot, evidence, "id8")
        approved = plan["plan_sha256"]
        plan["generated_files"]["README.md"] += "unreviewed change\n"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "export"
            with self.assertRaisesRegex(planner.PlanningError, "review a fresh plan"):
                planner.materialize_distribution(snapshot, plan, output, approved)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
