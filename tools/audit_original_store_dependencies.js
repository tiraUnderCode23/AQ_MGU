'use strict';
/*
 * Read-only canonical-main dependency audit using the original Store parsers
 * and pure Updater prototype methods. No Updater constructor, installer,
 * builder, network, child process, Git operation or filesystem write is used.
 * External complete manifests are explicit pinned metadata fixtures only.
 *
 * Usage:
 * node audit_canonical_original_store_dependencies_20261120.js
 *   --source-commit FULL_SHA [--repository PATH] [--evidence FILE]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const DEFAULT_REPOSITORY = path.resolve(__dirname, '..');
const MAX_METADATA = 64 * 1024 * 1024;
const AQ_SOURCE = 'aq-mgu-apps';
const AQ_RELEASE = 'aq-mgu-catalog';
const SOURCE_FILES = {
    sources: 'tools/_sources/mgu-store/native/mgu-updater/js/sources.js',
    catalog: 'tools/_sources/mgu-store/native/mgu-updater/js/catalog.js',
    updater: 'tools/_sources/mgu-store/native/mgu-updater/js/updater.js',
    linker: 'tools/_sources/mgu-store/tools/oap_link.js'
};
const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const equal = (a, b) => assert.deepStrictEqual(a, b);
const check = (value, message) => { if (!value) throw new Error(message); };
const sorted = (values) => values.slice().sort();
const cleanError = (error) => String(error && error.message || error).slice(0, 1800);

// Match the planner's UTF-8 json.dumps(sort_keys=True, indent=2) encoding.
// Plan/evidence numbers are integers; refuse unsupported numeric round-trips.
function jsonBytes(value) {
    function render(item, depth) {
        const pad = '  '.repeat(depth);
        const inner = '  '.repeat(depth + 1);
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
        if (typeof item === 'number') {
            check(Number.isSafeInteger(item), 'Non-integer or unsafe JSON number in proof');
            return JSON.stringify(item);
        }
        if (Array.isArray(item)) {
            return item.length ? '[\n' + item.map((v) => inner + render(v, depth + 1)).join(',\n') + '\n' + pad + ']' : '[]';
        }
        check(item && typeof item === 'object', 'Invalid JSON proof value');
        const keys = Object.keys(item).sort();
        return keys.length ? '{\n' + keys.map((key) =>
            inner + JSON.stringify(key) + ': ' + render(item[key], depth + 1)).join(',\n') + '\n' + pad + '}' : '{}';
    }
    return Buffer.from(render(value, 0) + '\n', 'utf8');
}

function reader(directory) {
    const root = fs.realpathSync(directory);
    const reads = new Set();
    function resolve(relative) {
        check(typeof relative === 'string' && relative && !/[\\:\0]/.test(relative) &&
            relative.split('/').every((p) => p && p !== '.' && p !== '..'),
        'Unsafe export-relative path: ' + relative);
        const target = path.join(root, ...relative.split('/'));
        const real = fs.realpathSync(target);
        const under = path.relative(root, real);
        check(under !== '..' && !under.startsWith('..' + path.sep) && !path.isAbsolute(under),
            'Export path escapes its root: ' + relative);
        check(!fs.lstatSync(target).isSymbolicLink(), 'Symlink input: ' + relative);
        return target;
    }
    function file(relative, maximum) {
        const target = resolve(relative);
        const stat = fs.statSync(target);
        check(stat.isFile(), 'Input is not a regular file: ' + relative);
        check(stat.size <= (maximum || MAX_METADATA), 'Metadata exceeds read bound: ' + relative);
        reads.add(relative);
        return fs.readFileSync(target);
    }
    return {
        root, reads, resolve, file,
        json(relative) { return JSON.parse(file(relative).toString('utf8')); },
        regular(relative) { check(fs.statSync(resolve(relative)).isFile(), 'Missing regular input: ' + relative); },
        exists(relative) { resolve(relative); },
        async readFile(relative, maximum) {
            try { return file(relative, maximum); }
            catch (error) { if (error.code === 'ENOENT') error.missing = true; throw error; }
        }
    };
}

function unique(rows, label) {
    check(Array.isArray(rows), label + ' must be a component array');
    const out = new Map();
    rows.forEach((row) => {
        check(row && typeof row.id === 'string' && !out.has(row.id), label + ': duplicate/missing ID');
        out.set(row.id, row);
    });
    return out;
}

function identity(actual, expected, label) {
    for (const field of ['id', 'version', 'kind']) {
        check(actual[field] === expected[field], label + ': ' + field + ' differs from selected evidence');
    }
}

function strongest(catalog, maps) {
    const result = {};
    maps.filter(Boolean).forEach((values) => Object.entries(values).forEach(([id, minimum]) => {
        check(catalog.SEMVER.test(minimum), 'Invalid minimum for ' + id);
        if (!result[id] || catalog.compareVersions(minimum, result[id]) > 0) result[id] = minimum;
    }));
    return result;
}

function makePlanner(Updater, hmi, rows) {
    const planner = Object.create(Updater.prototype);
    const sourceIds = Array.from(new Set(Array.from(rows.values()).map((r) => r.source)));
    planner.unit = { hmi };
    planner.src = new Map(sourceIds.map((id) => [id, {}]));
    planner.resolved = () => rows;
    planner.defs = () => sourceIds.map((id) => ({ id }));
    planner.installedOf = () => null;
    planner.providerIds = () => [];
    return planner;
}


function storeConstants(text) {
    const values = {};
    for (const name of ['PYTHON_TOOL', 'PYTHON_MIN', 'DEPLOY_SDK_MIN', 'DEPLOY_PROVIDES_MIN']) {
        const match = new RegExp("const " + name + " = '([^']+)';").exec(text);
        check(match, 'Cannot identify pinned Store constant: ' + name);
        values[name] = match[1];
    }
    return values;
}

function implicitRequirements(entry, declared, manifest, constants) {
    const needs = {};
    if (entry.script && entry.script.python) needs[constants.PYTHON_TOOL] = constants.PYTHON_MIN;
    if (entry.mguProvides) needs['mgu-deploy'] = constants.DEPLOY_PROVIDES_MIN;
    else if (entry.script && entry.script.sdk) needs['mgu-deploy'] = constants.DEPLOY_SDK_MIN;
    else if (entry.kind === 'tool' && (declared.preload !== undefined ||
        (!declared.service && !declared.preload && manifest.dropins !== undefined))) {
        needs['mgu-deploy'] = constants.DEPLOY_SDK_MIN;
    }
    return needs;
}

async function main() {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) {
        const flag = process.argv[i];
        check(['--repository', '--source-commit', '--evidence'].includes(flag) &&
            process.argv[i + 1] && !args[flag],
        'Usage: node audit.js --source-commit FULL_SHA [--repository PATH] [--evidence FILE]');
        args[flag] = process.argv[i + 1];
    }
    const canonical = args['--source-commit'];
    check(/^[0-9a-f]{40}$/.test(canonical || ''), 'An explicit full canonical source commit is required');
    const repository = fs.realpathSync(args['--repository'] || DEFAULT_REPOSITORY);
    const input = reader(repository);
    const evidenceBytes = args['--evidence'] ?
        fs.readFileSync(args['--evidence']) : input.file('data/id8-eligibility-20261120.json');
    const evidence = JSON.parse(evidenceBytes.toString('utf8'));
    check(evidence.source_commit === canonical, 'Evidence source commit differs from the requested pin');
    const records = Object.assign({}, evidence.variants || {}, evidence.external_variants || {});
    const keys = Object.keys(records);
    check(keys.length === 294, 'Canonical inventory must retain all 294 current variants');
    const fingerprints = {};
    Object.entries(SOURCE_FILES).forEach(([name, relative]) => {
        fingerprints[name] = { path: relative, sha256: hash(input.file(relative)) };
    });
    const sourceCode = input.file(SOURCE_FILES.sources).toString('utf8');
    const constants = storeConstants(sourceCode);
    const sources = require(path.join(repository, SOURCE_FILES.sources));
    const catalog = require(path.join(repository, SOURCE_FILES.catalog));
    const { Updater } = require(path.join(repository, SOURCE_FILES.updater));
    const linker = require(path.join(repository, SOURCE_FILES.linker));
    const problems = [];
    const unsupportedExternal = [];
    const problem = (where, error) => problems.push({ where, message: cleanError(error) });
    const expected = { source: [], release: [], external: [] };
    const selected = new Map();
    keys.forEach((key) => {
        const record = records[key];
        check(record && record.source_commit === canonical && expected[record.channel], 'Unpinned/unknown variant: ' + key);
        check(!selected.has(record.id), 'Conflicting canonical effective variants for ' + record.id);
        selected.set(record.id, { key, record });
        expected[record.channel].push(record);
    });
    equal([expected.source.length, expected.release.length, expected.external.length], [198, 90, 6]);
    const sourceDoc = input.json('mgu-repo.json');
    const releaseDoc = input.json('release/catalog.json');
    const externalDoc = input.json('data/external-store-components.json');
    const descriptions = unique(input.json('data/components.json').components, 'canonical descriptive index');
    const sourceDeclared = unique(sourceDoc.components, 'source feed');
    const releaseDeclared = unique(releaseDoc.components, 'release feed');
    const externalDeclared = unique(externalDoc.components, 'external observations');
    const source = await sources.repoCatalog(input.readFile, canonical, canonical);
    const releases = catalog.parse(JSON.stringify(releaseDoc));
    check(source.skipped.length === 0, 'Original Store skipped source rows: ' + source.skipped.join('; '));
    const parsedSource = unique(source.components, 'parsed source');
    const parsedRelease = unique(releases.components, 'parsed release');
    for (const [channel, declared, parsed] of [
        ['source', sourceDeclared, parsedSource], ['release', releaseDeclared, parsedRelease]
    ]) {
        equal(sorted(Array.from(declared.keys())), sorted(expected[channel].map((row) => row.id)));
        equal(sorted(Array.from(parsed.keys())), sorted(Array.from(declared.keys())));
    }
    equal(sorted(Array.from(externalDeclared.keys())), sorted(expected.external.map((row) => row.id)));
    equal(sorted(Array.from(descriptions.keys())), sorted(Array.from(selected.keys())));

    const configured = unique(input.json('data/store-sources.json').sources, 'configured Store sources');
    const aq = configured.get(AQ_SOURCE), aqRelease = configured.get(AQ_RELEASE);
    check(aq && aq.type === 'github' && aq.repo === 'tiraUnderCode23/AQ_MGU' && aq.channel === 'branch:main',
        'Canonical native AQ source must point to branch:main');
    check(aqRelease && aqRelease.type === 'https' &&
        aqRelease.url === 'https://raw.githubusercontent.com/' + aq.repo + '/main/release/catalog.json',
    'Canonical AQ artifact catalog must match the main native source');
    const externalConfig = configured.get(externalDoc.source_id);
    check(externalDoc.reference_only === true && externalDoc.schema === 1 && externalConfig &&
        externalConfig.type === 'github' && externalConfig.repo === externalDoc.repository &&
        externalConfig.channel === externalDoc.channel, 'Original external source is not explicitly configured');

    const catalogHashes = {};
    for (const relative of ['mgu-repo.json', 'release/catalog.json', 'data/external-store-components.json']) {
        catalogHashes[relative] = hash(input.file(relative));
    }
    const virtual = new Map();
    const externalManifests = new Map();
    const externalReadPaths = new Set();
    expected.external.forEach((record) => {
        const observed = externalDeclared.get(record.id);
        identity(observed, record, 'external observation/' + record.id);
        check(record.repository === externalDoc.repository && record.upstream_channel === externalDoc.channel &&
            record.upstream_commit === externalDoc.source_commit && observed.source_commit === externalDoc.source_commit &&
            record.source_path === observed.path, 'External observation pin/path differs: ' + record.id);
        equal(record.requires || {}, observed.requires || {});
        equal(sorted(record.hmi), sorted(observed.mguHmi));
        const pin = record.external_manifest_proof;
        let manifest;
        if (pin && pin.status === 'PASS' && pin.payload_fetched === false &&
            pin.upstream_commit === record.upstream_commit && pin.url === observed.source_manifest_url && pin.manifest) {
            manifest = pin.manifest;
            identity(manifest, observed, 'pinned external manifest/' + record.id);
            equal(manifest.requires || {}, observed.requires || {});
            equal(sorted(manifest.mguHmi || []), sorted(observed.mguHmi || []));
        } else {
            // Preserve only actually observed fields; unavailable provider/capability
            // details fail the audit rather than being silently invented.
            manifest = {
                id: observed.id, kind: observed.kind, version: observed.version,
                requires: observed.requires, mguHmi: observed.mguHmi
            };
            unsupportedExternal.push({ id: record.id, reason: 'Exact pinned manifest/provider details unavailable; only registry fields can be modeled.' });
            problem('external-proof/' + record.id, new Error('Complete pinned manifest metadata is required for an exact provider contract'));
        }
        externalManifests.set(record.id, manifest);
        virtual.set(observed.path + '/component.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
    });
    virtual.set('mgu-repo.json', Buffer.from(JSON.stringify({
        schema: 1, tools: expected.external.map((record) => ({ id: record.id, path: record.source_path }))
    }), 'utf8'));
    const external = await sources.repoCatalog((relative) => {
        externalReadPaths.add(relative);
        if (virtual.has(relative)) return Promise.resolve(virtual.get(relative));
        return Promise.reject(Object.assign(new Error('Unobserved external metadata: ' + relative), { missing: true }));
    }, externalDoc.source_commit);
    check(external.skipped.length === 0, 'Original parser skipped external metadata: ' + external.skipped.join('; '));
    equal(sorted(external.components.map((row) => row.id)), sorted(expected.external.map((row) => row.id)));

    const rows = new Map();
    function add(entry, sourceId) {
        check(!rows.has(entry.id), 'Source/release/external identity collision: ' + entry.id);
        rows.set(entry.id, { entry, source: sourceId });
    }
    source.components.forEach((entry) => add(entry, AQ_SOURCE));
    releases.components.forEach((entry) => add(entry, AQ_RELEASE));
    external.components.forEach((entry) => add(entry, externalDoc.source_id));
    equal(sorted(Array.from(rows.keys())), sorted(Array.from(selected.keys())));

    const routes = {
        source_unit_apps: 0, source_scripted_apps: 0, source_tools: 0,
        release_unit_apps: 0, release_packaged_apps: 0, release_tools: 0, external_reference_tools: 0
    };
    let dependencyEdges = 0, pythonRecipes = 0, targetSdkRecipes = 0, providerContracts = 0;
    const routeRows = [];
    for (const { entry } of rows.values()) {
        const chosen = selected.get(entry.id), record = chosen.record, channel = record.channel;
        try {
            identity(entry, record, 'parsed/' + entry.id);
            check(Array.isArray(entry.mguHmi) && entry.mguHmi.length, 'No explicit HMI declaration; unknown is not compatibility');
            equal(sorted(entry.mguHmi), sorted(record.hmi));
            const anchor = channel === 'source' ? 'mgu-repo.json' :
                channel === 'release' ? 'release/catalog.json' : 'data/external-store-components.json';
            check((record.evidence || []).some((cite) =>
                cite.path === anchor && cite.commit === canonical && cite.sha256 === catalogHashes[anchor]),
            'Current feed bytes are not bound by the selected evidence');
            let declared, manifest, implicit = {};
            if (channel === 'source') {
                declared = sourceDeclared.get(entry.id);
                identity(declared, record, 'declared source/' + entry.id);
                check(entry.path === declared.path && record.source_path === declared.path, 'Source route path differs');
                if (entry.kind === 'app') {
                    check(entry.build === 'unit', 'Source app is not prepared through the original unit build contract');
                    check(Boolean(entry.script) === (declared.build !== undefined && declared.build !== 'unit'), 'Source recipe classification differs');
                    if (entry.script) {
                        routes.source_scripted_apps += 1;
                        manifest = input.json(entry.manifest);
                        if (entry.script.python) pythonRecipes += 1;
                        if (entry.script.sdk) targetSdkRecipes += 1;
                    } else {
                        routes.source_unit_apps += 1;
                        manifest = linker.readManifest(input.resolve(entry.path));
                        check(manifest.id === entry.id && manifest.version === entry.version, 'Native unit source identity differs');
                    }
                } else {
                    routes.source_tools += 1;
                    manifest = declared.service || declared.preload ? declared : input.json(entry.path + '/component.json');
                }
                implicit = implicitRequirements(entry, declared, manifest, constants);
                const picked = declared.requires !== undefined ? declared.requires : manifest.requires;
                equal(entry.requires, Object.assign({}, implicit, picked || {}));
                equal(record.requires || {}, picked || {});
            } else if (channel === 'release') {
                declared = releaseDeclared.get(entry.id);
                identity(declared, record, 'declared release/' + entry.id);
                equal(entry.build, declared.build || null);
                equal(entry.artifact, declared.artifact);
                equal(entry.requires, declared.requires || {});
                equal(record.requires || {}, declared.requires || {});
                if (entry.kind === 'tool') routes.release_tools += 1;
                else if (entry.build === 'unit') routes.release_unit_apps += 1;
                else routes.release_packaged_apps += 1;
            } else {
                routes.external_reference_tools += 1;
                declared = externalDeclared.get(entry.id);
                manifest = externalManifests.get(entry.id);
                check(entry.kind === 'tool' && entry.commit === record.upstream_commit, 'External route identity/commit differs');
                implicit = implicitRequirements(entry, {}, manifest, constants);
                equal(entry.requires, Object.assign({}, implicit, manifest.requires || {}));
            }
            const required = strongest(catalog, [implicit, record.requires, record.build_requires, record.effective_requires]);
            Object.entries(required).forEach(([id, minimum]) => {
                check(entry.requires[id] && catalog.compareVersions(entry.requires[id], minimum) >= 0,
                    'Parsed minimum is lower/missing: ' + id + ' >= ' + minimum);
            });
            Object.entries(entry.requires).forEach(([id, minimum]) => {
                const dependency = rows.get(id);
                check(dependency && catalog.compareVersions(dependency.entry.version, minimum) >= 0,
                    'Dependency unavailable: ' + id + ' >= ' + minimum);
                const bound = record.dependencies && record.dependencies[id];
                check(bound && selected.get(id) && bound === selected.get(id).key,
                    'Dependency is not bound to the exact current provider: ' + id);
                dependencyEdges += 1;
            });
            if (entry.mguProvides) providerContracts += 1;
            routeRows.push({
                key: chosen.key, id: entry.id, version: entry.version, kind: entry.kind,
                channel, path: entry.path || null, build: entry.build,
                scripted: Boolean(entry.script), requires: entry.requires, hmi: entry.mguHmi
            });
        } catch (error) { problem('variant/' + chosen.key, error); }
    }

    let plansChecked = 0, incompatibleRejected = 0, capabilityChecks = 0;
    const hmiPlans = { ID7: 0, ID8: 0 };
    const bcsPlans = {};
    for (const row of rows.values()) {
        const entry = row.entry;
        for (const hmi of ['ID7', 'ID8']) {
            try {
                const planner = makePlanner(Updater, hmi, rows);
                check(Array.isArray(entry.mguHmi) && entry.mguHmi.length, 'Target HMI cannot be inferred');
                if (!entry.mguHmi.includes(hmi)) {
                    check(Boolean(planner.incompatible(entry)), 'Original planner did not reject an explicitly incompatible HMI');
                    incompatibleRejected += 1;
                    continue;
                }
                check(!planner.incompatible(entry), 'Original planner rejected an offered HMI');
                const steps = planner.installPlan(row, []);
                const positions = new Map(steps.map((step, i) => [step.id, i]));
                check(steps.length === positions.size && steps[steps.length - 1].id === entry.id, 'Dependency order/uniqueness differs');
                steps.forEach((step) => {
                    const planned = rows.get(step.id);
                    check(planned && planned.source === step.source, 'Original planner chose an unexpected provider/source');
                    const actual = planned.entry;
                    check(Array.isArray(actual.mguHmi) && actual.mguHmi.includes(hmi), 'Dependency HMI incompatible/unknown: ' + step.id);
                    Object.entries(actual.requires).forEach(([id, minimum]) => {
                        check(positions.has(id) && positions.get(id) < positions.get(actual.id), 'Dependency is not ordered first: ' + id);
                        check(catalog.compareVersions(rows.get(id).entry.version, minimum) >= 0, 'Minimum dependency version missing: ' + id);
                    });
                    (actual.mguNeeds || []).forEach((capability) => {
                        check(Array.from(rows.values()).some(({ entry: provider }) =>
                            provider.kind === 'tool' && provider.mguProvides === capability &&
                            Array.isArray(provider.mguHmi) && provider.mguHmi.includes(hmi)),
                        'No offered compatible capability provider: ' + capability);
                        capabilityChecks += 1;
                    });
                });
                plansChecked += 1;
                hmiPlans[hmi] += 1;
                if (entry.id === 'bcs_store') bcsPlans[hmi] = steps.map((step) => ({
                    id: step.id, version: rows.get(step.id).entry.version, source: step.source
                }));
            } catch (error) { problem('original-plan/' + entry.id + '/' + hmi, error); }
        }
    }

    let bcsReport = { status: 'FAIL' };
    try {
        const chosen = selected.get('bcs_store');
        const entry = rows.get('bcs_store').entry;
        const declared = releaseDeclared.get('bcs_store');
        check(chosen.record.channel === 'release' && entry.kind === 'app' && entry.build === 'unit',
            'BCS Store must retain its original release-source/unit preparation route');
        equal(entry.artifact, declared.artifact);
        const description = descriptions.get('bcs_store');
        identity(description, entry, 'BCS descriptive identity');
        equal(description.artifact, entry.artifact);
        equal(description.requires, declared.requires);
        check(description.source_repository === 'bcs-asia/app-store' && description.source_path === null,
            'BCS original publisher/source route changed');
        const observation = chosen.record.artifact_inspection;
        check(observation && observation.status === 'PASS' &&
            observation.id === entry.id && observation.version === entry.version &&
            observation.url === entry.artifact.url && observation.expected_bytes === entry.artifact.size &&
            observation.received_bytes === entry.artifact.size && observation.expected_sha256 === entry.artifact.sha256 &&
            observation.sha256 === entry.artifact.sha256,
        'BCS archive observation does not bind the exact current artifact');
        const sourceManifest = observation.manifests.find((m) => m.path === 'mgu-app.json');
        check(sourceManifest && sourceManifest.metadata.id === entry.id &&
            sourceManifest.metadata.version === entry.version &&
            Array.isArray(sourceManifest.metadata.sdk) && sourceManifest.metadata.sdk.length,
        'BCS observed source manifest/target SDK contract is absent');
        check(entry.mguHmi.every((hmi) => observation.ui_hmi.includes(hmi) && bcsPlans[hmi]),
            'BCS declared HMI lacks recorded UI or a complete dependency plan');
        bcsReport = {
            status: 'PASS', id: entry.id, version: entry.version,
            route: 'original publisher source archive; unit preparation and target SDK remain required',
            build: entry.build, publisher: description.source_repository,
            artifact: entry.artifact, observed_archive_receipt_bound: true,
            payload_read_by_this_audit: false, transport_performed_by_this_audit: false,
            hmi: entry.mguHmi,
            direct_requirements: Object.entries(entry.requires).map(([id, minimum]) => ({
                id, minimum, offered: rows.get(id).entry.version, hmi: rows.get(id).entry.mguHmi
            })),
            original_plans: bcsPlans,
            prepared: 'NOT_OBSERVED', installed: 'NOT_OBSERVED', runtime: 'NOT_OBSERVED'
        };
    } catch (error) { problem('bcs_store', error); bcsReport.reason = cleanError(error); }

    const summary = {
        status: problems.length ? 'FAIL' : 'PASS',
        canonical_commit: canonical,
        scope: 'Canonical feed and pinned metadata/dependency contract only; no payload transport, builds, installation or runtime observation.',
        counts: {
            variants: rows.size, source: parsedSource.size, release: parsedRelease.size,
            external_metadata: external.components.length,
            apps: Array.from(rows.values()).filter((row) => row.entry.kind === 'app').length,
            tools: Array.from(rows.values()).filter((row) => row.entry.kind === 'tool').length,
            validated_variant_contracts: routeRows.length, routes,
            minimum_dependency_edges: dependencyEdges, python_recipes: pythonRecipes,
            target_sdk_recipes: targetSdkRecipes, explicit_provider_contracts: providerContracts,
            original_plans: plansChecked, hmi_plans: hmiPlans,
            incompatible_hmi_rejections: incompatibleRejected, capability_availability_checks: capabilityChecks
        },
        pinned_store_implicit_minimums: constants,
        original_store_module_sha256: fingerprints,
        evidence_sha256: hash(evidenceBytes),
        canonical_feed_sha256: catalogHashes,
        validated_route_contracts_sha256: hash(Buffer.from(JSON.stringify(routeRows), 'utf8')),
        source_code_scope: 'Original Store modules loaded from the specified workspace; fingerprints and feed anchors bind the reviewed files.',
        external: {
            verification: 'exact selected pinned manifest metadata only; payload bytes and native provider operation are not verified',
            repository: externalDoc.repository, source_commit: externalDoc.source_commit,
            configured_channel: externalDoc.channel, metadata_paths_read: externalReadPaths.size,
            providers: external.components.map((entry) => ({
                id: entry.id, version: entry.version, provides: entry.mguProvides,
                needs: entry.mguNeeds, requires: entry.requires, hmi: entry.mguHmi,
                payload_verified: false, native_operation: 'NOT_OBSERVED'
            })),
            unsupported_details: unsupportedExternal
        },
        bcs_store: bcsReport,
        warnings: [
            'The installed fixture is empty. Capability checks establish that a compatible catalog provider is offered, not installed or automatically selected.',
            'Recorded artifact observations are reused only after exact identity, URL, size and SHA binding; this audit performs no new transport.',
            'Scripted recipes are parsed only; no source, SDK donor, app or installer is executed.'
        ],
        problem_count: problems.length, problems: problems.slice(0, 120),
        no_transport_build_install_or_runtime: true, export_or_repository_mutated: false
    };
    process.stdout.write(JSON.stringify(summary) + '\n');
    if (summary.status !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({
        status: 'FAIL', problems: [{ where: 'setup', message: cleanError(error) }],
        no_transport_build_install_or_runtime: true, export_or_repository_mutated: false
    }) + '\n');
    process.exitCode = 1;
});
