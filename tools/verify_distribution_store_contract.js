'use strict';
/*
 * Read-only verification of reviewed distribution exports with the pinned
 * original Store parsers and Updater's pure prototype planning methods.
 *
 * Usage:
 *   node verify_export_original_store_contract_20261120.js --configuration FILE
 * Optional: --repository PATH (default is the canonical AQ workspace).
 *
 * The configuration is the same JSON used by the branch-commit helper:
 * canonical_commit and distributions.{id8,games}.{export,approved_plan_sha256}.
 * This helper never invokes a constructor, builder, installer, transport,
 * child process, Git command, or filesystem write. Release archives and
 * external payloads are not fetched or executed. External observations are
 * explicitly metadata fixtures, not evidence that payload transport worked.
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

async function verifyDistribution(name, configuration, modules, canonical) {
    const result = {
        distribution: name, status: 'FAIL', canonical_commit: canonical,
        counts: {}, problems: [], warnings: [],
        scope: 'original-parser and metadata/dependency contract; no transport, build, install or runtime proof',
        external_verification: 'selected pinned metadata observations only; no payload proof'
    };
    const { sources, catalog, Updater, linker } = modules;
    const problems = result.problems;
    const issue = (where, error) => problems.push({ where, message: cleanError(error) });
    try {
        check(name === 'id8' || name === 'games', 'Unsupported distribution name');
        const input = reader(configuration.export);
        const plan = input.json('.distribution/plan.json');
        const receipt = input.json('.distribution/receipt.json');
        const unsigned = Object.assign({}, plan);
        delete unsigned.plan_sha256;
        check(plan.distribution === name && plan.source_commit === canonical, 'Export plan identity/pin mismatch');
        check(hash(jsonBytes(unsigned)) === plan.plan_sha256 &&
            plan.plan_sha256 === configuration.approved_plan_sha256, 'Approved plan digest mismatch');
        check(receipt.state === 'complete' && receipt.source_commit === canonical &&
            receipt.plan_sha256 === plan.plan_sha256 && receipt.runtime === 'NOT_OBSERVED', 'Incomplete/mismatched receipt');
        for (const field of ['evidence_sha256', 'source_manifest_sha256', 'historical_preservation', 'store_source_configuration']) {
            equal(receipt[field], plan[field]);
        }
        const evidence = input.json('.distribution/eligibility-evidence.json');
        check(hash(input.file('.distribution/eligibility-evidence.json')) === plan.evidence_sha256,
            'Eligibility evidence digest mismatch');
        const generated = plan.generated_files;
        for (const relative of ['mgu-repo.json', 'release/catalog.json', 'data/components.json', 'data/store-sources.json',
            '.distribution/external-dependencies.json', '.distribution/eligibility-evidence.json']) {
            check(typeof generated[relative] === 'string', 'Approved plan omits ' + relative);
            check(input.file(relative).equals(Buffer.from(generated[relative], 'utf8')), 'Generated bytes differ: ' + relative);
        }
        const records = Object.assign({}, evidence.variants || {}, evidence.external_variants || {});
        const selected = new Map();
        const expected = { source: [], release: [], external: [] };
        check(Array.isArray(plan.selected_variants), 'Selected variants missing');
        plan.selected_variants.forEach((key) => {
            const record = records[key];
            check(record && ['source', 'release', 'external'].includes(record.channel), 'Missing selected record: ' + key);
            check(record.source_commit === canonical && !selected.has(record.id), 'Unpinned/duplicate selected ID: ' + record.id);
            if (name === 'id8') {
                check(record.status === 'eligible_static' && Array.isArray(record.hmi) && record.hmi.includes('ID8'),
                    'ID8 record lacks exact static eligibility: ' + key);
            }
            selected.set(record.id, { key, record });
            expected[record.channel].push(record);
        });

        const sourceDoc = input.json('mgu-repo.json');
        const releaseDoc = input.json('release/catalog.json');
        const declaredSource = unique(sourceDoc.components, 'source feed');
        const declaredRelease = unique(releaseDoc.components, 'release feed');
        for (const [channel, actual] of [['source', declaredSource], ['release', declaredRelease]]) {
            equal(sorted(Array.from(actual.keys())), sorted(expected[channel].map((r) => r.id)));
            actual.forEach((row, id) => identity(row, selected.get(id).record, channel + '/' + id));
        }
        const activeIndex = input.json('data/components.json');
        const indexInputs = plan.files.filter((item) => item.source_path === 'data/components.json');
        check(indexInputs.length === 1 && indexInputs[0].path === '.distribution/original/data/components.json',
            'Full canonical component index must be preserved under .distribution/original');
        const originalIndexPath = indexInputs[0].path;
        const originalIndexBytes = input.file(originalIndexPath);
        const originalIndex = JSON.parse(originalIndexBytes.toString('utf8'));
        const originalIndexReceipt = receipt.files.filter((item) => item.path === originalIndexPath);
        check(originalIndexReceipt.length === 1, 'Original component index receipt missing or duplicated');
        for (const proofRow of [indexInputs[0], originalIndexReceipt[0]]) {
            check(proofRow.size === originalIndexBytes.length && proofRow.sha256 === hash(originalIndexBytes),
                'Original full component index differs from its plan/receipt');
        }
        const expectedHeaderKeys = ['components'];
        if (Object.prototype.hasOwnProperty.call(originalIndex, 'as_of')) {
            expectedHeaderKeys.push('as_of');
            equal(activeIndex.as_of, originalIndex.as_of);
        }
        equal(sorted(Object.keys(activeIndex)), sorted(expectedHeaderKeys));
        const indexRows = unique(activeIndex.components, 'active descriptive index');
        equal(sorted(Array.from(indexRows.keys())), sorted(Array.from(selected.keys())));
        equal(activeIndex.components.map((row) => row.id), sorted(Array.from(indexRows.keys())));
        indexRows.forEach((row, id) => {
            const chosen = selected.get(id), record = chosen.record;
            identity(row, record, 'active-index/' + id);
            check(row.variant_key === chosen.key && row.channel === record.channel,
                'Active index points to a different selected variant: ' + id);
            equal(row.supported_hmi, record.hmi);
            if (Object.prototype.hasOwnProperty.call(row, 'mguHmi')) equal(row.mguHmi, record.hmi);
            equal(row.requires, record.requires || {});
            equal(row.build_requires, record.build_requires || {});
            if (record.channel === 'source') {
                check(row.source_path === declaredSource.get(id).path && row.delivery === 'branch source',
                    'Active index source route differs: ' + id);
                equal(row.artifact, {});
            } else if (record.channel === 'release') {
                check(row.source_path === null && row.delivery === 'original publisher artifact',
                    'Active index release route differs: ' + id);
                equal(row.artifact, declaredRelease.get(id).artifact);
            } else {
                check(row.source_path === null && row.delivery === 'external original source',
                    'Active index external route differs: ' + id);
                equal(row.artifact, {});
                check(row.source_repository === record.repository && row.upstream_commit === record.upstream_commit &&
                    row.upstream_channel === record.upstream_channel, 'Active index external origin differs: ' + id);
            }
        });
        const source = await sources.repoCatalog(input.readFile, canonical, canonical);
        const releases = catalog.parse(JSON.stringify(releaseDoc));
        check(source.skipped.length === 0, 'Original source parser skipped: ' + source.skipped.join('; '));
        const parsedSource = unique(source.components, 'parsed source');
        const parsedRelease = unique(releases.components, 'parsed release');
        equal(sorted(Array.from(parsedSource.keys())), sorted(Array.from(declaredSource.keys())));
        equal(sorted(Array.from(parsedRelease.keys())), sorted(Array.from(declaredRelease.keys())));

        const configured = input.json('data/store-sources.json');
        const proof = plan.store_source_configuration;
        check(proof && proof.source_commit === canonical && proof.external_sources_preserved === true,
            'Missing pinned Store configuration proof');
        check(hash(input.file('data/store-sources.json')) === proof.generated_sha256, 'Store configuration digest differs');
        const originalConfig = input.json(proof.original_path);
        check(hash(input.file(proof.original_path)) === proof.original_sha256, 'Original Store configuration digest differs');
        check(configured.schema === 1 && originalConfig.schema === 1, 'Store source schema differs');
        const configMap = unique(configured.sources, 'Store sources');
        const originalMap = unique(originalConfig.sources, 'original Store sources');
        equal(sorted(Array.from(configMap.keys())), sorted(Array.from(originalMap.keys())));
        const desiredSource = Object.assign({}, originalMap.get(AQ_SOURCE), { channel: 'branch:' + name });
        const desiredRelease = Object.assign({}, originalMap.get(AQ_RELEASE), {
            url: 'https://raw.githubusercontent.com/' + proof.repository + '/' + name + '/release/catalog.json'
        });
        equal(configMap.get(AQ_SOURCE), desiredSource);
        equal(configMap.get(AQ_RELEASE), desiredRelease);
        check(desiredSource.type === 'github' && desiredSource.repo === proof.repository &&
            desiredRelease.type === 'https' && proof.distribution_channel === 'branch:' + name,
        'Both AQ Store feed identities are required');
        configMap.forEach((row, id) => {
            if (id !== AQ_SOURCE && id !== AQ_RELEASE) equal(row, originalMap.get(id));
        });

        const externalRecords = input.json('.distribution/external-dependencies.json');
        equal(sorted(Object.keys(externalRecords)), sorted(plan.external_dependencies));
        equal(sorted(Object.keys(externalRecords)), sorted(expected.external.map((r) => selected.get(r.id).key)));
        const externalRows = [];
        let externalMetadataReads = 0;
        if (expected.external.length) {
            const observation = input.json('data/external-store-components.json');
            check(observation.reference_only === true && observation.schema === 1, 'External observation must remain reference-only');
            const observed = unique(observation.components, 'external observations');
            const configuredExternal = configMap.get(observation.source_id);
            check(configuredExternal && configuredExternal.type === 'github' &&
                configuredExternal.repo === observation.repository && configuredExternal.channel === observation.channel,
            'Exact external Store source is not configured');
            const virtual = new Map();
            const toolEntries = [];
            expected.external.forEach((record) => {
                const key = selected.get(record.id).key;
                equal(externalRecords[key], record);
                const original = observed.get(record.id);
                check(original, 'Selected external identity was not observed: ' + record.id);
                identity(original, record, 'external/' + record.id);
                check(record.repository === observation.repository && record.upstream_channel === observation.channel &&
                    record.upstream_commit === observation.source_commit && original.source_commit === observation.source_commit,
                'External repository/channel/commit mismatch: ' + record.id);
                check(record.source_path === original.path, 'External path mismatch: ' + record.id);
                equal(sorted(record.hmi), sorted(original.mguHmi));
                equal(record.requires || {}, original.requires || {});
                const pin = record.external_manifest_proof;
                check(pin && pin.status === 'PASS' && pin.payload_fetched === false &&
                    pin.upstream_commit === record.upstream_commit && pin.url === original.source_manifest_url,
                'Selected external manifest proof missing/mismatched: ' + record.id);
                identity(pin.manifest, original, 'external manifest/' + record.id);
                equal(pin.manifest.requires || {}, original.requires || {});
                equal(sorted(pin.manifest.mguHmi || []), sorted(original.mguHmi || []));
                toolEntries.push({ id: original.id, path: original.path });
                virtual.set(original.path + '/component.json', Buffer.from(JSON.stringify(pin.manifest), 'utf8'));
            });
            virtual.set('mgu-repo.json', Buffer.from(JSON.stringify({ schema: 1, tools: toolEntries }), 'utf8'));
            const external = await sources.repoCatalog((relative) => {
                externalMetadataReads += 1;
                if (virtual.has(relative)) return Promise.resolve(virtual.get(relative));
                return Promise.reject(Object.assign(new Error('Unobserved external metadata: ' + relative), { missing: true }));
            }, observation.source_commit);
            check(external.skipped.length === 0, 'Original parser skipped external observations: ' + external.skipped.join('; '));
            equal(sorted(external.components.map((r) => r.id)), sorted(expected.external.map((r) => r.id)));
            external.components.forEach((entry) => externalRows.push({ entry, source: observation.source_id }));
        }
        const rows = new Map();
        function add(entry, sourceId) {
            check(!rows.has(entry.id), 'Cross-feed identity collision: ' + entry.id);
            const selectedRecord = selected.get(entry.id);
            check(selectedRecord, 'Unselected parsed identity: ' + entry.id);
            identity(entry, selectedRecord.record, 'parsed/' + entry.id);
            rows.set(entry.id, { entry, source: sourceId });
        }
        parsedSource.forEach((entry) => add(entry, AQ_SOURCE));
        parsedRelease.forEach((entry) => add(entry, AQ_RELEASE));
        externalRows.forEach((row) => add(row.entry, row.source));
        equal(sorted(Array.from(rows.keys())), sorted(Array.from(selected.keys())));

        let unitSources = 0, scriptedSources = 0, toolPayloads = 0, inputPaths = 0;
        for (const entry of parsedSource.values()) {
            try {
                const declared = declaredSource.get(entry.id);
                check(entry.path === declared.path, 'Parsed source path changed');
                if (entry.kind === 'app') {
                    check(entry.build === 'unit', 'Original Store did not classify app for unit preparation');
                    check(Boolean(entry.script) === (declared.build !== undefined && declared.build !== 'unit'),
                        'Scripted/native-source classification changed');
                    if (entry.script) scriptedSources += 1;
                    else {
                        const manifestRelative = entry.path + '/mgu-app.json';
                        const own = input.json(manifestRelative);
                        input.regular(entry.path + '/' + own.tree + '/package.json');
                        check(Array.isArray(own.modules), 'Unit source modules missing');
                        own.modules.forEach((module) => input.regular(entry.path + '/' + module));
                        const manifest = linker.readManifest(input.resolve(entry.path));
                        check(manifest.id === entry.id && manifest.version === entry.version, 'Unit manifest identity changed');
                        const rhmi = input.json(entry.path + '/' + manifest.tree + '/rhmiData/application.json').application;
                        const hmis = new Set((rhmi.uiDescriptions || []).flatMap((ui) => ui.hmi || []));
                        check(Array.isArray(entry.mguHmi) && entry.mguHmi.length &&
                            entry.mguHmi.every((hmi) => hmis.has(hmi)), 'Unit source lacks offered HMI resources');
                        (rhmi.uiDescriptions || []).forEach((ui) => {
                            for (const field of ['applicationFilePath', 'uiDescriptionFilePath']) {
                                const relative = String(ui[field] || '').replace(/^\.\//, '');
                                input.regular(entry.path + '/' + manifest.tree + '/rhmiData/' + relative);
                            }
                        });
                        unitSources += 1;
                    }
                } else if (declared.service || declared.preload) {
                    input.regular(entry.path + '/' + (declared.service ? declared.service.exec : declared.preload.library));
                    toolPayloads += 1;
                } else {
                    const manifest = input.json(entry.path + '/component.json');
                    identity(manifest, entry, 'tool source/' + entry.id);
                    check(!manifest.build, 'Repo-tree tool still requires a build');
                    for (const [field, fallback] of [['files', 'path'], ['units', 'name'], ['dropins', 'name']]) {
                        (manifest[field] || []).forEach((item) => {
                            input.regular(entry.path + '/' + (item.from || item[fallback]));
                            toolPayloads += 1;
                        });
                    }
                }
                const parts = sources.partPaths(entry);
                check(Array.isArray(parts) && parts.length, 'Source selection requires the entire-repository fallback');
                parts.forEach((relative) => { input.exists(relative); inputPaths += 1; });
            } catch (error) { issue('source-input/' + entry.id, error); }
        }
        parsedRelease.forEach((entry) => {
            const declared = declaredRelease.get(entry.id);
            try {
                equal(entry.build, declared.build || null);
                equal(entry.artifact, declared.artifact);
            } catch (error) { issue('release-contract/' + entry.id, error); }
        });

        let dependencyEdges = 0, plansChecked = 0, capabilityReferences = 0;
        const hmiChecks = { ID7: 0, ID8: 0 };
        rows.forEach(({ entry }) => {
            try {
                const record = selected.get(entry.id).record;
                const needs = strongest(catalog, [record.requires, record.build_requires, record.effective_requires]);
                Object.entries(needs).forEach(([id, minimum]) => {
                    check(entry.requires[id] && catalog.compareVersions(entry.requires[id], minimum) >= 0,
                        'Original parser minimum below pinned evidence: ' + id + ' >= ' + minimum);
                });
                Object.entries(entry.requires).forEach(([id, minimum]) => {
                    const dependency = rows.get(id);
                    check(dependency && catalog.compareVersions(dependency.entry.version, minimum) >= 0,
                        'Missing minimum dependency ' + id + ' >= ' + minimum);
                    dependencyEdges += 1;
                });
            } catch (error) { issue('dependencies/' + entry.id, error); }
        });
        for (const row of rows.values()) {
            const entry = row.entry;
            const targets = name === 'id8' ? ['ID8'] : entry.kind === 'app' ? entry.mguHmi : [];
            if (name === 'games' && entry.kind === 'app' && (!Array.isArray(targets) || !targets.length)) {
                issue('hmi/' + entry.id, new Error('Games app has no explicit HMI declaration'));
                continue;
            }
            for (const hmi of targets || []) {
                try {
                    check(['ID7', 'ID8'].includes(hmi), 'Unknown target HMI');
                    const planner = makePlanner(Updater, hmi, rows);
                    check(Array.isArray(entry.mguHmi) && entry.mguHmi.includes(hmi), 'Missing target HMI; unknown is not compatibility');
                    check(!planner.incompatible(entry), planner.incompatible(entry));
                    const steps = planner.installPlan(row, []);
                    const positions = new Map(steps.map((step, index) => [step.id, index]));
                    check(steps.length === positions.size && steps.length && steps[steps.length - 1].id === entry.id,
                        'Original plan order/uniqueness differs');
                    steps.forEach((step) => {
                        const planned = rows.get(step.id);
                        check(planned && planned.source === step.source, 'Original plan chose an unlisted source');
                        const item = planned.entry;
                        check(Array.isArray(item.mguHmi) && item.mguHmi.includes(hmi),
                            'Dependency HMI is absent/incompatible: ' + item.id + ' on ' + hmi);
                        Object.entries(item.requires).forEach(([id, minimum]) => {
                            check(positions.has(id) && positions.get(id) < positions.get(item.id),
                                'Dependency is not ordered first: ' + item.id + ' -> ' + id);
                            check(catalog.compareVersions(rows.get(id).entry.version, minimum) >= 0, 'Dependency version below minimum');
                        });
                        (item.mguNeeds || []).forEach((capability) => {
                            const providers = Array.from(rows.values()).filter(({ entry: provider }) =>
                                provider.kind === 'tool' && provider.mguProvides === capability &&
                                Array.isArray(provider.mguHmi) && provider.mguHmi.includes(hmi));
                            check(providers.length > 0, 'No offered compatible capability provider: ' + capability);
                            capabilityReferences += 1;
                        });
                    });
                    plansChecked += 1;
                    hmiChecks[hmi] += 1;
                } catch (error) { issue('original-plan/' + entry.id + '/' + hmi, error); }
            }
        }
        result.counts = {
            selected_variants: selected.size,
            active_index_rows: indexRows.size, original_index_rows: originalIndex.components.length,
            source_declared: declaredSource.size, source_parsed: parsedSource.size,
            release_declared: declaredRelease.size, release_parsed: parsedRelease.size,
            external_selected_metadata: externalRows.length, external_metadata_reads: externalMetadataReads,
            apps: Array.from(rows.values()).filter((r) => r.entry.kind === 'app').length,
            tools: Array.from(rows.values()).filter((r) => r.entry.kind === 'tool').length,
            native_unit_sources: unitSources, scripted_source_recipes_parsed: scriptedSources,
            release_unit_sources: Array.from(parsedRelease.values()).filter((r) => r.build === 'unit').length,
            tool_payload_references_present: toolPayloads, source_input_paths_present: inputPaths,
            minimum_dependency_edges: dependencyEdges, original_plans_checked: plansChecked,
            hmi_checks: hmiChecks, capability_provider_references: capabilityReferences,
            store_sources: configMap.size, export_metadata_files_read: input.reads.size
        };
        if (scriptedSources) result.warnings.push('Scripted recipes were parsed and their declared input paths checked; no builder ran.');
        if (externalRows.length) result.warnings.push('External helpers are selected pinned metadata references; their payloads were not fetched or verified.');
        if (capabilityReferences) result.warnings.push('Capability providers are offered catalog entries; this is not evidence they are installed or automatically selected.');
        result.plan_sha256 = plan.plan_sha256;
    } catch (error) { issue('export-contract', error); }
    result.problem_count = problems.length;
    if (problems.length > 100) result.problems = problems.slice(0, 100);
    result.status = problems.length ? 'FAIL' : 'PASS';
    return result;
}

async function main() {
    const argumentsByName = {};
    for (let i = 2; i < process.argv.length; i += 2) {
        const flag = process.argv[i];
        check(['--configuration', '--repository'].includes(flag) && process.argv[i + 1] && !argumentsByName[flag],
            'Usage: node helper.js --configuration FILE [--repository PATH]');
        argumentsByName[flag] = process.argv[i + 1];
    }
    check(argumentsByName['--configuration'], '--configuration is required');
    const configuration = JSON.parse(fs.readFileSync(argumentsByName['--configuration'], 'utf8'));
    check(/^[0-9a-f]{40}$/.test(configuration.canonical_commit), 'Full canonical commit is required');
    equal(sorted(Object.keys(configuration.distributions || {})), ['games', 'id8']);
    const repository = fs.realpathSync(argumentsByName['--repository'] || DEFAULT_REPOSITORY);
    const fingerprints = {};
    Object.entries(SOURCE_FILES).forEach(([name, relative]) => {
        fingerprints[name] = { path: relative, sha256: hash(fs.readFileSync(path.join(repository, relative))) };
    });
    const modules = {
        sources: require(path.join(repository, SOURCE_FILES.sources)),
        catalog: require(path.join(repository, SOURCE_FILES.catalog)),
        Updater: require(path.join(repository, SOURCE_FILES.updater)).Updater,
        linker: require(path.join(repository, SOURCE_FILES.linker))
    };
    const distributions = [];
    for (const name of ['id8', 'games']) {
        distributions.push(await verifyDistribution(name, configuration.distributions[name], modules, configuration.canonical_commit));
    }
    const output = {
        status: distributions.every((row) => row.status === 'PASS') ? 'PASS' : 'FAIL',
        canonical_commit: configuration.canonical_commit,
        original_store_module_sha256: fingerprints,
        source_code_scope: 'Original Store modules loaded from the specified canonical workspace; fingerprints reported for pin comparison.',
        no_transport_build_install_or_runtime: true,
        export_or_repository_mutated: false,
        distributions
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    if (output.status !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({ status: 'FAIL', problems: [{ where: 'setup', message: cleanError(error) }],
        no_transport_build_install_or_runtime: true, export_or_repository_mutated: false }) + '\n');
    process.exitCode = 1;
});
