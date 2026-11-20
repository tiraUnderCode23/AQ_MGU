"""Offline contract checks against the pinned original Store implementation.

These tests parse metadata and plan dependency order in memory. One reviewed
packaging-only builder runs on a temporary copy to verify its selected inputs.
They never construct a running updater, execute an app or installer, contact
a head unit, download a package, or treat a plan as proof of installation.
Six external tool observations are synthetic metadata fixtures for planning;
their payloads are neither copied into AQ nor fetched or installed by a test.
"""

import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "tools/_sources/mgu-store"


def read_json(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def inside_file(folder, relative):
    """A payload reference must resolve to a regular file in its component."""
    if not isinstance(relative, str) or not relative or "\\" in relative:
        return False
    parts = relative.split("/")
    if any(part in ("", ".", "..") for part in parts) or ":" in relative:
        return False
    target = folder.joinpath(*parts)
    try:
        target.resolve().relative_to(folder.resolve())
    except ValueError:
        return False
    return target.is_file() and not target.is_symlink()


# Only the Store's parser and pure planning methods run. A prototype object
# avoids Updater's constructor and all daemon, state, install and I/O methods.
PARSE_AND_PLAN = r"""
const fs = require('fs');
const path = require('path');
const base = './tools/_sources/mgu-store/';
const sources = require(base + 'native/mgu-updater/js/sources.js');
const catalog = require(base + 'native/mgu-updater/js/catalog.js');
const { Updater } = require(base + 'native/mgu-updater/js/updater.js');
const linker = require(base + 'tools/oap_link.js');
const readFile = (p) => fs.promises.readFile(p).catch((error) => {
    if (error.code === 'ENOENT') error.missing = true;
    throw error;
});

sources.repoCatalog(readFile).then(async (source) => {
    const releases = catalog.parse(fs.readFileSync('release/catalog.json', 'utf8'));
    const externalDoc = JSON.parse(fs.readFileSync('data/external-store-components.json', 'utf8'));
    const configured = JSON.parse(fs.readFileSync('data/store-sources.json', 'utf8')).sources;
    const externalEnabled = configured.some((s) => s.id === externalDoc.source_id &&
        s.type === 'github' && s.repo === externalDoc.repository && s.channel === externalDoc.channel);
    // This in-memory repo is a factual snapshot of original manifest fields,
    // not an AQ feed or a pretend download of the original tool payloads.
    const observations = new Map([['mgu-repo.json', { schema: 1,
        tools: externalDoc.components.map((e) => ({ id: e.id, path: e.path })) }]]);
    externalDoc.components.forEach((entry) => observations.set(`${entry.path}/component.json`, {
        id: entry.id, kind: entry.kind, version: entry.version,
        requires: entry.requires, mguHmi: entry.mguHmi
    }));
    const externalReadPaths = [];
    const readObservation = (p) => {
        externalReadPaths.push(p);
        return observations.has(p) ? Promise.resolve(Buffer.from(JSON.stringify(observations.get(p)))) :
            Promise.reject(Object.assign(new Error(`unobserved metadata ${p}`), { missing: true }));
    };
    const external = await sources.repoCatalog(readObservation, externalDoc.source_commit);
    const rows = new Map();
    source.components.forEach((entry) => rows.set(entry.id, { entry, source: 'branch' }));
    releases.components.forEach((entry) => rows.set(entry.id, { entry, source: 'release' }));
    if (externalEnabled) external.components.forEach((entry) =>
        rows.set(entry.id, { entry, source: externalDoc.source_id }));
    const makePlanner = (hmi, installed, observedRows = rows) => {
        const planner = Object.create(Updater.prototype);
        planner.unit = { hmi };
        const ids = Array.from(new Set(Array.from(observedRows.values()).map((r) => r.source)));
        planner.src = new Map(ids.map((id) => [id, {}]));
        planner.resolved = () => observedRows;
        planner.defs = () => ids.map((id) => ({ id }));
        planner.installedOf = (id, kind) => installed.find((i) =>
            i.id === id && (!kind || i.kind === kind)) || null;
        planner.providerIds = (capability) => installed.filter((i) =>
            i.kind === 'tool' && i.mguProvides === capability).map((i) => i.id);
        return planner;
    };
    const plans = [];
    for (const hmi of ['ID7', 'ID8']) {
        const planner = makePlanner(hmi, []);
        for (const row of rows.values()) {
            const incompatible = planner.incompatible(row.entry);
            if (incompatible) {
                plans.push({ id: row.entry.id, hmi, incompatible });
                continue;
            }
            try {
                plans.push({ id: row.entry.id, hmi,
                    steps: planner.installPlan(row, []).map((step) => step.id) });
            } catch (error) {
                plans.push({ id: row.entry.id, hmi, error: error.message });
            }
        }
    }
    const unitSources = [];
    for (const entry of source.components.filter((e) => e.kind === 'app' && !e.script)) {
        try {
            const manifest = linker.readManifest(entry.path);
            unitSources.push({ id: entry.id, manifest });
        } catch (error) {
            unitSources.push({ id: entry.id, error: error.message });
        }
    }
    // This exercises the original resolver's provider substitution. The
    // selected renderer is an installed component, not merely a catalog row.
    const renderer = rows.get('mgu-render');
    const rendererChoice = renderer ? makePlanner('ID7', [renderer.entry]) : null;
    const substitution = rendererChoice && rows.has('ambient_config') ?
        rendererChoice.installPlan(rows.get('ambient_config'), []).map((step) => step.id) : null;
    const inputPaths = source.components.map((entry) => ({
        id: entry.id, paths: sources.partPaths(entry)
    }));
    const withoutExternal = new Map(Array.from(rows.entries()).filter(([, r]) =>
        r.source !== externalDoc.source_id));
    const externalIds = new Set(external.components.map((e) => e.id));
    const missingExternalPlans = [];
    for (const entry of releases.components.filter((e) =>
        Object.keys(e.requires || {}).some((id) => externalIds.has(id)))) {
        for (const hmi of entry.mguHmi || ['ID7', 'ID8']) {
            try {
                const planner = makePlanner(hmi, [], withoutExternal);
                missingExternalPlans.push({ id: entry.id, hmi,
                    steps: planner.installPlan(withoutExternal.get(entry.id), []).map((s) => s.id) });
            } catch (error) {
                missingExternalPlans.push({ id: entry.id, hmi, error: error.message });
            }
        }
    }
    // An installed older Python must not bypass the native Python recipe floor.
    // These are pure resolver calls; no constructor, install or transport runs.
    const aqFlap = rows.get('aq_flap');
    const aqFlapPythonChecks = aqFlap ? ['1.0.0', '1.0.1', '1.0.2'].map((version) => {
        const planner = makePlanner('ID7', [{ id: 'mgu-python', kind: 'tool', version }]);
        const minimum = aqFlap.entry.requires['mgu-python'];
        return { installed: version, minimum,
            met: planner.requirementMet('mgu-python', minimum),
            steps: planner.installPlan(aqFlap, []).map((step) => step.id) };
    }) : [];
    console.log(JSON.stringify({ source, releases, plans, unitSources, substitution, inputPaths,
        external, externalEnabled, externalReadPaths, missingExternalPlans, aqFlapPythonChecks,
        externalVerification: 'metadata-observations-only' }));
}).catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
});
"""


class OriginalStoreContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node = shutil.which("node")
        if node is None:
            raise unittest.SkipTest("Node.js is required for original Store contract checks")
        result = subprocess.run(
            [node, "-e", PARSE_AND_PLAN], cwd=ROOT, text=True,
            capture_output=True, timeout=30, check=False,
        )
        if result.returncode:
            raise AssertionError("Original Store parser failed:\n" + result.stderr)
        cls.actual = json.loads(result.stdout)
        cls.declared = read_json("mgu-repo.json")["components"]
        cls.by_id = {entry["id"]: entry for entry in cls.declared}
        cls.source = {entry["id"]: entry for entry in cls.actual["source"]["components"]}
        cls.releases = {
            entry["id"]: entry for entry in cls.actual["releases"]["components"]
        }
        cls.external = {
            entry["id"]: entry for entry in cls.actual["external"]["components"]
        }
        cls.all_entries = {**cls.source, **cls.releases, **cls.external}

    def test_original_companion_observations_match_pinned_manifest_evidence(self):
        registry = read_json("data/external-store-components.json")
        coverage = read_json("data/awesome-bmw-mgu-coverage.json")
        upstream = next(project for project in coverage["projects"]
                        if project["repository"] == "IterioDev/car-apps")
        observed = {row["id"]: row for row in upstream["discovered_manifest_components"]
                    if row["kind"] == "tool" and row["offered_in_explicit_root_feed"]}
        self.assertTrue(self.actual["externalEnabled"], "Native Iterio source must be explicitly configured")
        self.assertTrue(registry["reference_only"])
        self.assertEqual(self.actual["externalVerification"], "metadata-observations-only")
        self.assertEqual(self.actual["external"]["skipped"], [])
        self.assertEqual(registry["source_commit"], upstream["upstream"]["head_commit"])
        self.assertEqual(set(self.external), set(observed))
        self.assertEqual(len(observed), 6)
        self.assertFalse(set(self.external) & (set(self.source) | set(self.releases)))
        expected_reads = {"mgu-repo.json"}
        for entry in registry["components"]:
            cid = entry["id"]
            expected_reads.add(entry["path"] + "/component.json")
            with self.subTest(component=cid):
                for field in ("id", "kind", "version", "mguHmi", "requires"):
                    self.assertEqual(entry[field], observed[cid][field])
                    self.assertEqual(self.external[cid][field], observed[cid][field])
                self.assertEqual(entry["path"] + "/component.json", observed[cid]["manifest_path"])
                self.assertEqual(entry["source_manifest_url"], observed[cid]["manifest_url"])
                self.assertEqual(entry["source_commit"], registry["source_commit"])
                self.assertEqual(self.external[cid]["commit"], registry["source_commit"])
                self.assertNotIn("artifact", entry)
                self.assertNotIn("build", entry)
        self.assertEqual(set(self.actual["externalReadPaths"]), expected_reads)

    def test_original_planner_fails_when_companion_source_is_absent(self):
        self.assertTrue(self.actual["missingExternalPlans"])
        for plan in self.actual["missingExternalPlans"]:
            with self.subTest(component=plan["id"], hmi=plan["hmi"]):
                self.assertIn("error", plan)
                self.assertNotIn("steps", plan)

    def test_original_parser_keeps_every_declared_component(self):
        self.assertEqual(self.actual["source"]["skipped"], [])
        self.assertEqual(set(self.source), set(self.by_id))
        self.assertEqual(len(self.source), len(self.declared))
        self.assertFalse(set(self.source) & set(self.releases))
        for cid, declared in self.by_id.items():
            with self.subTest(component=cid):
                self.assertEqual(self.source[cid]["version"], declared["version"])
                self.assertEqual(self.source[cid]["kind"], declared["kind"])

    def test_original_parser_includes_build_runtime_dependencies(self):
        for cid, declared in self.by_id.items():
            build = declared.get("build")
            if not isinstance(build, dict):
                continue
            actual = self.source[cid]["requires"]
            with self.subTest(component=cid):
                if build.get("python"):
                    self.assertIn("mgu-python", actual)
                    self.assertIn("mgu-python", self.all_entries)
                if build.get("sdk"):
                    self.assertIn("mgu-deploy", actual)
                    self.assertIn("mgu-deploy", self.all_entries)

    def test_aq_flap_python_floor_rejects_older_installed_tools(self):
        self.assertEqual(self.source["aq_flap"]["requires"]["mgu-python"], "1.0.2")
        checks = {row["installed"]: row for row in self.actual["aqFlapPythonChecks"]}
        self.assertEqual(set(checks), {"1.0.0", "1.0.1", "1.0.2"})
        for version in ("1.0.0", "1.0.1"):
            with self.subTest(installed=version):
                check = checks[version]
                self.assertEqual(check["minimum"], "1.0.2")
                self.assertFalse(check["met"])
                self.assertIn("mgu-python", check["steps"])
                self.assertLess(check["steps"].index("mgu-python"), check["steps"].index("aq_flap"))
        self.assertTrue(checks["1.0.2"]["met"])
        self.assertNotIn("mgu-python", checks["1.0.2"]["steps"])
        self.assertEqual(checks["1.0.2"]["steps"][-1], "aq_flap")

    def test_dependency_plan_is_resolvable_for_each_offered_hmi(self):
        for plan in self.actual["plans"]:
            entry = self.all_entries[plan["id"]]
            with self.subTest(component=entry["id"], hmi=plan["hmi"]):
                if entry.get("mguHmi") and plan["hmi"] not in entry["mguHmi"]:
                    self.assertIn("incompatible", plan)
                    self.assertNotIn("steps", plan)
                    continue
                self.assertNotIn("error", plan, plan.get("error"))
                self.assertEqual(plan["steps"][-1], entry["id"])
                self.assertEqual(len(plan["steps"]), len(set(plan["steps"])))
                position = {cid: i for i, cid in enumerate(plan["steps"])}
                for cid in plan["steps"]:
                    for dependency in self.all_entries[cid]["requires"]:
                        self.assertIn(dependency, position)
                        self.assertLess(position[dependency], position[cid])

    def test_capabilities_have_a_provider_for_each_offered_hmi(self):
        # mguNeeds is a prerequisite satisfied by an already installed tool.
        # This proves a compatible provider is offered; it does not imply
        # that Store automatically installs a capability-only dependency.
        for entry in self.all_entries.values():
            for capability in entry.get("mguNeeds") or []:
                for hmi in entry.get("mguHmi") or ("ID7", "ID8"):
                    with self.subTest(component=entry["id"], capability=capability, hmi=hmi):
                        providers = [
                            provider for provider in self.all_entries.values()
                            if provider["kind"] == "tool"
                            and provider.get("mguProvides") == capability
                            and (not provider.get("mguHmi") or hmi in provider["mguHmi"])
                        ]
                        self.assertTrue(providers, "No compatible provider in either feed")

    def test_installed_renderer_choice_is_preserved_by_original_planner(self):
        self.assertIsNotNone(self.actual["substitution"])
        self.assertIn("ambient_config", self.actual["substitution"])
        self.assertNotIn("idrive7-renderd", self.actual["substitution"])
        self.assertIn("mgu-python", self.actual["substitution"])

    def test_source_tools_include_all_declared_payloads(self):
        for entry in self.declared:
            if entry["kind"] != "tool":
                continue
            folder = ROOT / entry["path"]
            with self.subTest(component=entry["id"]):
                if entry.get("service"):
                    self.assertTrue(inside_file(folder, entry["service"]["exec"]))
                    continue
                if entry.get("preload"):
                    self.assertTrue(inside_file(folder, entry["preload"]["library"]))
                    continue
                manifest = read_json(entry["path"] + "/component.json")
                self.assertEqual(manifest["id"], entry["id"])
                self.assertEqual(manifest["version"], entry["version"])
                self.assertEqual(manifest["kind"], "tool")
                self.assertFalse(manifest.get("build"), "Repo-tree tools must already be built")
                for field, fallback in (("files", "path"), ("units", "name"), ("dropins", "name")):
                    for payload in manifest.get(field, []):
                        relative = payload.get("from") or payload.get(fallback)
                        self.assertTrue(
                            inside_file(folder, relative),
                            f"{entry['id']}: missing or unsafe {field} payload {relative}",
                        )

    def test_original_linker_can_read_every_unit_source_manifest(self):
        expected = {entry["id"] for entry in self.declared if entry.get("build") == "unit"}
        self.assertEqual({row["id"] for row in self.actual["unitSources"]}, expected)
        for row in self.actual["unitSources"]:
            with self.subTest(component=row["id"]):
                self.assertNotIn("error", row, row.get("error"))

    def test_feed_hmi_does_not_exceed_declared_source_and_rhmi_support(self):
        for entry in self.declared:
            folder = ROOT / entry["path"]
            manifest_name = "component.json" if entry["kind"] == "tool" else (
                "mgu-app.json" if entry.get("build") == "unit" else entry.get("manifest", "app.json")
            )
            file = folder / manifest_name
            if not file.is_file():
                continue  # service/preload entries are checked above
            manifest = json.loads(file.read_text(encoding="utf-8"))
            offered = set(entry.get("mguHmi") or [])
            with self.subTest(component=entry["id"]):
                if manifest.get("mguHmi"):
                    self.assertTrue(offered <= set(manifest["mguHmi"]))
                if entry.get("build") != "unit":
                    continue
                tree = folder / manifest["tree"]
                package = json.loads((tree / "package.json").read_text(encoding="utf-8"))
                if package.get("mguHmi"):
                    self.assertTrue(offered <= set(package["mguHmi"]))
                application = json.loads(
                    (tree / "rhmiData/application.json").read_text(encoding="utf-8")
                )["application"]
                ui_hmi = {
                    hmi for ui in application.get("uiDescriptions", [])
                    for hmi in ui.get("hmi", [])
                }
                self.assertTrue(offered, "Source apps need explicit HMI eligibility")
                self.assertTrue(offered <= ui_hmi, "Feed offers an HMI without a staged UI")
                for ui in application.get("uiDescriptions", []):
                    for field in ("applicationFilePath", "uiDescriptionFilePath"):
                        relative = ui.get(field, "").removeprefix("./")
                        self.assertTrue(inside_file(tree / "rhmiData", relative))

    def test_frozen_ethanol_package_builds_from_only_original_store_selected_inputs(self):
        # This reviewed builder only verifies and archives existing bytes. It
        # neither executes app javascript nor accesses a donor or the network.
        entry = self.by_id["ethanol_mix"]
        paths = next(row["paths"] for row in self.actual["inputPaths"] if row["id"] == entry["id"])
        self.assertIsNotNone(paths, "Frozen package must not download the whole aggregate repo")
        selected = set()
        for relative in paths:
            source = ROOT / relative
            self.assertTrue(source.exists(), relative)
            if source.is_file():
                selected.add(source)
            else:
                selected.update(file for file in source.rglob("*") if file.is_file())
        family = "apps/_sources/turnkey-ethanol-blend/"
        hash_path = family + "store-v015/original_file_sha256.json"
        expected = read_json(hash_path)["file_sha256"]
        self.assertIn(ROOT / hash_path, selected)
        for relative in expected:
            self.assertIn(ROOT / (family + "store-v015/package/" + relative), selected)
        # The original public-source reader allows 400 files, and the build
        # defaults to 200 MiB. Check the actual selected files, not a new cap.
        self.assertLessEqual(len(selected), 400)
        self.assertLessEqual(sum(file.stat().st_size for file in selected), 200 * 1024 * 1024)
        with tempfile.TemporaryDirectory(prefix="aq-mgu-frozen-package-") as temp:
            stage = Path(temp) / "source"
            out = Path(temp) / "out"
            stage.mkdir()
            out.mkdir()
            for file in selected:
                dest = stage / file.relative_to(ROOT)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, dest)
            command = [sys.executable, "-B", str(stage / entry["build"]["python"]), entry["id"]]
            env = dict(os.environ, MGU_OUT=str(out))
            run = subprocess.run(command, cwd=stage, env=env, text=True,
                                 capture_output=True, timeout=30, check=False)
            self.assertEqual(run.returncode, 0, run.stderr)
            archive = out / f"{entry['id']}@{entry['version']}.tgz"
            self.assertEqual(list(out.iterdir()), [archive])
            self.assertNotIn("output", entry["build"], "Builder writes MGU_OUT, not a nested dist folder")
            with tarfile.open(archive, "r:gz") as package:
                actual = {}
                for member in package.getmembers():
                    self.assertTrue(member.isfile())
                    self.assertTrue(member.name.startswith("package/"))
                    name = member.name[len("package/"):]
                    self.assertNotIn("node_modules/oap-sdk/", name)
                    actual[name] = hashlib.sha256(package.extractfile(member).read()).hexdigest()
            self.assertEqual(actual, expected)
            # Removing a selected required input must fail, not create a
            # seemingly successful archive from an incomplete source subset.
            archive.unlink()
            (stage / hash_path).unlink()
            missing = subprocess.run(command, cwd=stage, env=env, text=True,
                                     capture_output=True, timeout=30, check=False)
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("original_file_sha256.json", missing.stderr)
            self.assertFalse(archive.exists())


if __name__ == "__main__":
    unittest.main()
