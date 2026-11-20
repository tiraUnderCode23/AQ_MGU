'use strict';
/**
 * The head-unit app's link to the DME, end to end, without a car or the emulator: Boostline's Session
 * (app/boostline-core.js) -> app/tasu-link.js -> the kit's Diag (kit/runtime/diag.js) -> a stubbed
 * TASU transport -> the emulator's fake DME (build/fake-dme.js).
 *
 *   node test/run.js                     (npm test bundles first)
 *   node tools/node8.js test/run.js      the same on Node 8, as the head unit runs it (npm run test:node8)
 *
 * Node 8 syntax on purpose: no ?. / ?? / optional catch binding / fs.rmSync.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// The app's files as the kit's build lays them out (app.js beside ./kit/diag.js)
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'boostline-idrive-'));
fs.mkdirSync(path.join(stage, 'kit'));
fs.copyFileSync(path.join(ROOT, 'app', 'boostline-core.js'), path.join(stage, 'boostline-core.js'));
fs.copyFileSync(path.join(ROOT, 'app', 'tasu-link.js'), path.join(stage, 'tasu-link.js'));
fs.copyFileSync(path.join(ROOT, 'app', 'runs.js'), path.join(stage, 'runs.js'));
fs.copyFileSync(path.join(ROOT, 'app', 'picker.js'), path.join(stage, 'picker.js'));
fs.copyFileSync(path.join(ROOT, 'app', 'files.js'), path.join(stage, 'files.js'));
fs.copyFileSync(path.join(ROOT, 'app', 'bus.js'), path.join(stage, 'bus.js'));
fs.copyFileSync(path.join(ROOT, 'app', 'awake.js'), path.join(stage, 'awake.js'));
fs.copyFileSync(path.join(ROOT, 'app', 'vdyno.js'), path.join(stage, 'vdyno.js'));
// the kit's runtime: diag.js, and sheet.js and the drawing it needs for the picker
(function copyDir(from, to) {
    fs.readdirSync(from).forEach((f) => {
        const a = path.join(from, f), b = path.join(to, f);
        if (fs.statSync(a).isDirectory()) { fs.mkdirSync(b); copyDir(a, b); } else fs.copyFileSync(a, b);
    });
})(path.join(ROOT, '..', 'vendor', 'idrive7-apps', 'kit', 'runtime'), path.join(stage, 'kit'));

const core = require(path.join(stage, 'boostline-core.js'));
const { TasuLink } = require(path.join(stage, 'tasu-link.js'));
const fakeDme = require(path.join(ROOT, 'build', 'fake-dme.js'));

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const later = (ms) => new Promise((r) => setTimeout(r, ms));
const READ_ONLY = [0x10, 0x19, 0x22, 0x23, 0x2C, 0x3E];

function rmrf(p) {
    if (!fs.existsSync(p)) return;
    if (fs.lstatSync(p).isDirectory()) fs.readdirSync(p).forEach((f) => rmrf(path.join(p, f)));
    if (fs.lstatSync(p).isDirectory()) fs.rmdirSync(p); else fs.unlinkSync(p);
}
function dataDir(withPack) {
    const d = fs.mkdtempSync(path.join(stage, 'data-'));
    if (withPack) fs.writeFileSync(path.join(d, core.BMW_DATA_FILE), JSON.stringify(fakeDme.dataPack()));
    return d;
}

/**
 * ctx.signals with the TASU interface as the head unit offers it (kit/runtime/diag.js), answered by
 * `responder` (the fake DME's interface: request(target, uds, reply)). verdict: what sendTasuRequest
 * returns instead of taking the request. seen: every request that reached the transport.
 */
function tasuSignals(responder, verdict) {
    const listeners = [], seen = [];
    const signals = {
        proxy: async () => ({ iface: 'InternalTasu' }),
        on: async (p, ev, fn) => { listeners.push(fn); },
        onAvailable: async (p, fn) => fn(true),
        call: async (p, method, a) => {
            const uds = Buffer.concat([Buffer.from([a.serviceID]), Buffer.from(a.udsData)]);
            seen.push({ target: a.targetAddress, uds });
            if (verdict) return verdict;
            responder.request(a.targetAddress, uds, (ecu, bytes) => setImmediate(() => listeners.forEach((fn) =>
                fn({ errorCode: 'NO_ERROR', udsResponse: Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, ecu, 0, 0]), Buffer.from(bytes)]) }))));
            return 'NO_ERROR';
        },
    };
    return { signals, seen };
}

/** A Session on the stub, with what it reports collected. */
async function headUnit(responder, opts) {
    opts = opts || {};
    const bus = tasuSignals(responder, opts.verdict);
    const link = await new TasuLink(bus.signals, quiet).init();
    const session = core.createHeadUnitSession({ dataDir: opts.dataDir || dataDir(true), link, settings: () => opts.settings || {} });
    const got = { logs: [], batches: [], channels: [] };
    session.on('log', (m) => got.logs.push(m));
    session.on('batch', (b) => got.batches.push(b));
    session.on('channels', (c) => { got.channels = c; });
    return { session, link, bus, got };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('connects over TASU, identifies the DME and picks its data by the diagnostic index', async () => {
    const h = await headUnit(fakeDme(quiet));
    const s = await h.session.connect(core.HEAD_UNIT_CONNECTION);
    try {
        assert.strictEqual(s.state, 'live', s.error);
        assert.strictEqual(s.vin, 'WBAEMU000BL000001');
        assert.strictEqual(s.ecu.sgbdIndex, '0x0B0057');
        assert(/emu_dme/.test(s.ecu.dmeData), 'DME data: ' + s.ecu.dmeData);
        const ids = h.got.channels.map((c) => c.id);
        ['engine.rpm', 'boost.actual', 'boost.target', 'fuel.rail.actual', 'fuel.lambda.actual', 'ign.cyl6'].forEach((id) => assert(ids.indexOf(id) >= 0, id + ' missing'));
    } finally { await h.session.disconnect(); }
});

test('streams the DME channels as block reads of dynamically defined DIDs (2C 01)', async () => {
    const h = await headUnit(fakeDme(quiet));
    await h.session.connect(core.HEAD_UNIT_CONNECTION);
    try {
        await h.session.setStreamChannels(['engine.rpm', 'boost.actual', 'boost.target', 'fuel.rail.actual', 'ign.cyl1', 'temp.intake']);
        await later(1500);
        const defines = h.bus.seen.filter((r) => r.uds[0] === 0x2C && r.uds[1] === 0x01);
        const dynamicReads = h.bus.seen.filter((r) => r.uds[0] === 0x22 && r.uds[1] === 0xF3);
        assert(defines.length >= 1, 'no 2C 01 definitions');
        assert(dynamicReads.length >= 5, dynamicReads.length + ' reads of dynamic DIDs');
        const last = h.got.batches[h.got.batches.length - 1];
        assert(last, 'no samples');
        const row = last.rows[last.rows.length - 1], rpm = row[last.channelIds.indexOf('engine.rpm')];
        assert(rpm > 500 && rpm < 7500, 'rpm ' + rpm);
        const rate = h.session.status().sampleRateHz;
        assert(rate > 5, 'sample rate ' + rate);
    } finally { await h.session.disconnect(); }
    // stopping the stream clears its dynamic DIDs again (2C 03)
    assert(h.bus.seen.some((r) => r.uds[0] === 0x2C && r.uds[1] === 0x03), 'dynamic DIDs not cleared');
});

test('only read-only services reach the head unit\'s transport', async () => {
    const h = await headUnit(fakeDme(quiet));
    await h.session.connect(core.HEAD_UNIT_CONNECTION);
    try {
        await h.session.setStreamChannels(['engine.rpm', 'boost.actual', 'fuel.rail.actual']);
        await later(800);
        await h.session.startRecording();
        await later(300);
        await h.session.stopRecording();
    } finally { await h.session.disconnect(); }
    assert(h.bus.seen.length > 20);
    h.bus.seen.forEach((r) => assert(READ_ONLY.indexOf(r.uds[0]) >= 0, 'service ' + r.uds[0].toString(16) + ' sent'));
    h.bus.seen.filter((r) => r.uds[0] === 0x10).forEach((r) => assert([0x01, 0x03].indexOf(r.uds[1] & 0x7F) >= 0, 'session ' + r.uds[1]));
});

test('captures to a Boostline CSV in the app\'s Logs folder', async () => {
    const dir = dataDir(true);
    const h = await headUnit(fakeDme(quiet), { dataDir: dir });
    await h.session.connect(core.HEAD_UNIT_CONNECTION);
    let file;
    try {
        await h.session.setStreamChannels(['engine.rpm', 'boost.actual', 'boost.target']);
        const r = await h.session.startRecording();
        assert.strictEqual(path.dirname(r.file), path.join(dir, 'Logs'));
        await later(1000);
        file = await h.session.stopRecording();
    } finally { await h.session.disconnect(); }
    const text = fs.readFileSync(file, 'utf8').split('\n');
    assert(text.some((l) => l === '# vin=WBAEMU000BL000001'), 'vin line');
    assert(text.some((l) => /^# ids=.*engine\.rpm.*boost\.actual/.test(l)), 'ids line');
    const header = text.findIndex((l) => /^Time \[s\],/.test(l));
    assert(header > 0, 'header line');
    assert(text.slice(header + 1).filter((l) => /^\d/.test(l)).length > 5, 'rows');
    assert(core.folderBytes(path.join(dir, 'Logs')) > 0);
});

test('the channel picker: groups, ticks, the four the dyno needs, the limit, Defaults', async () => {
    const picker = require(path.join(stage, 'picker.js'));
    const { Recorder } = require(path.join(stage, 'kit', 'record.js'));
    const theme = require(path.join(stage, 'kit', 'themes.js')).theme('m_tricolour');
    const h = await headUnit(fakeDme(quiet));
    await h.session.connect(core.HEAD_UNIT_CONNECTION);
    const channels = new Map(h.got.channels.map((c) => [c.id, c]));
    await h.session.disconnect();
    // the pages' alternatives: the DME's value when there is one, else OBD-II's
    const entries = [['ign.avg', 'obd.timing_advance'], ['load.maf', 'obd.maf'], 'engine.rpm'];
    assert.deepStrictEqual(picker.defaultIds(entries, channels), ['ign.avg', 'load.maf', 'engine.rpm']);
    assert.deepStrictEqual(picker.defaultIds(entries, new Set(['obd.timing_advance', 'obd.maf', 'engine.rpm'])), ['obd.timing_advance', 'obd.maf', 'engine.rpm']);
    // required first, then the wanted the car offers
    assert.deepStrictEqual(picker.loggedIds(['boost.actual', 'nope'], channels, 70).slice(0, 5), ['engine.rpm', 'vehicle.speed', 'throttle.pedal', 'vehicle.gear', 'boost.actual']);

    let done = null;
    const sheetFor = (wanted, max) => picker.channelSheet({
        channels: () => channels, groups: core.GROUP_ORDER, wanted, isDefault: true, max,
        defaults: () => ['boost.actual', 'boost.target'], unit: (d) => d.unit, done: (c) => { done = c; },
    });
    const sh = sheetFor(['boost.actual'], 70);
    const r = new Recorder(1600, 520);
    assert(sh.draw(r, theme).length > 3, 'targets');
    const rows = sh.rows();
    assert(/Defaults/.test(rows[0].label));
    const knock = rows.findIndex((x) => x.label === 'Knock');
    assert(knock > 0 && rows[knock].value === '0 of 6', 'Knock group: ' + JSON.stringify(rows[knock]));
    // the DME's own values are under Advanced PIDs: opening it lists them (in parts when many), Back returns
    const adv = rows.findIndex((x) => /^Advanced PIDs \(\d+ (DDE|DME|DDE\/DME) values\)$/.test(x.label));
    assert(adv === rows.length - 1, 'Advanced PIDs last: ' + rows.map((x) => x.label).join(', '));
    assert(!rows.some((x) => /BMW data|Other DDE/.test(x.label)), 'no DDE values at the top');
    sh.focus = adv; sh.press();
    assert.strictEqual(sh.level(), 'adv');
    assert(sh.rows().length >= 1 && sh.rows().every((x) => x.kind === 'more'));
    sh.sub = 0; sh.press();
    assert(sh.open.defs && sh.open.group === 'DME', 'a part of the DDE values');
    sh.back();
    assert.strictEqual(sh.level(), 'adv', 'back to the parts');
    sh.back();
    assert.strictEqual(sh.level(), 'groups');
    // open Knock, tick cylinder 1
    sh.focus = knock; sh.press();
    assert(sh.open && sh.open.group === 'Knock');
    r.reset(); sh.draw(r, theme);
    sh.sub = 0; sh.press();
    assert(sh.rows()[0].on, 'knock cyl 1 ticked');
    assert(sh.chosen().indexOf('knock.signal.cyl1') >= 0);
    sh.press(); sh.press();
    assert(sh.chosen().indexOf('knock.signal.cyl1') >= 0, 'ticked twice more: on');
    // engine speed can't be unticked
    sh.back();
    sh.focus = sh.rows().findIndex((x) => x.label === 'Engine'); sh.press();
    sh.sub = sh.open.defs.findIndex((d) => d.id === 'engine.rpm'); sh.press();
    assert(sh.rows()[sh.sub].on && sh.rows()[sh.sub].value === 'always');
    sh.back();
    assert.strictEqual(sh.back(), 'close');
    sh.onClose();
    assert(done && !done.isDefault && done.ids.indexOf('knock.signal.cyl1') >= 0 && done.ids.indexOf('boost.actual') >= 0);
    // at the limit nothing more goes on; Defaults puts the pages' set back
    done = null;
    const full = sheetFor(['boost.actual'], 5);
    full.focus = full.rows().findIndex((x) => x.label === 'Boost'); full.press();
    full.sub = full.open.defs.findIndex((d) => d.id === 'boost.target'); full.press();
    assert(full.chosen().indexOf('boost.target') < 0, 'over the limit');
    full.back();
    full.focus = 0; full.press();
    assert.deepStrictEqual(full.chosen(), ['boost.actual', 'boost.target']);
    full.onClose();
    assert(done && done.isDefault);
    // nothing changed: nothing handed over
    done = null;
    const same = sheetFor(['boost.actual'], 70);
    same.onClose();
    assert.strictEqual(done, null);
});

test('Setup page: a page\'s tiles - take off, add, the limit, a target goes with its actual, Defaults', async () => {
    const picker = require(path.join(stage, 'picker.js'));
    const { Recorder } = require(path.join(stage, 'kit', 'record.js'));
    const theme = require(path.join(stage, 'kit', 'themes.js')).theme('m_tricolour');
    const h = await headUnit(fakeDme(quiet));
    await h.session.connect(core.HEAD_UNIT_CONNECTION);
    const channels = new Map(h.got.channels.map((c) => [c.id, c]));
    await h.session.disconnect();
    const PAIRS = { 'boost.actual': 'boost.target', 'fuel.lambda.actual': 'fuel.lambda.target' };
    const own = ['engine.rpm', 'boost.actual', 'boost.target', 'fuel.lambda.actual', 'fuel.lambda.target'];
    let done = null;
    const sheetFor = (chosen, max) => picker.tileSheet({
        page: 'Boost & fuel', channels: () => channels, groups: core.GROUP_ORDER, chosen, isDefault: chosen === own, defaults: () => own.slice(), max,
        folded: (id, ids) => Object.keys(PAIRS).some((a) => PAIRS[a] === id && ids.indexOf(a) >= 0),
        pairOf: (id) => PAIRS[id], unit: (d) => d.unit, done: (c) => { done = c; },
    });
    const sh = sheetFor(own, 3);
    const r = new Recorder(1600, 520);
    assert(sh.draw(r, theme).length > 3, 'targets');
    let rows = sh.rows();
    assert(/Defaults/.test(rows[0].label) && rows[0].value === 'in use');
    assert.strictEqual(rows[1].value, '3 of 3 tiles', 'targets share their actual\'s tile: ' + rows[1].value);
    // the page's own list: the targets aren't tiles of their own
    sh.focus = 1; sh.press();
    assert.deepStrictEqual(sh.open.defs.map((d) => d.id), ['engine.rpm', 'boost.actual', 'fuel.lambda.actual']);
    // taking lambda off takes its target with it
    sh.sub = 2; sh.press();
    assert.deepStrictEqual(sh.chosen(), ['engine.rpm', 'boost.actual', 'boost.target']);
    assert.strictEqual(sh.open.defs.length, 2, 'the list follows');
    sh.back();
    // knock cylinder 1 goes on; at 3 tiles nothing more
    sh.focus = sh.rows().findIndex((x) => x.label === 'Knock'); sh.press();
    sh.sub = 0; sh.press();
    sh.sub = 1; sh.press();
    assert.deepStrictEqual(sh.chosen(), ['engine.rpm', 'boost.actual', 'boost.target', 'knock.signal.cyl1'], 'the limit');
    sh.back();
    assert.strictEqual(sh.back(), 'close');
    sh.onClose();
    assert(done && !done.isDefault && done.ids[3] === 'knock.signal.cyl1');
    // Defaults puts the page's own back
    done = null;
    const again = sheetFor(['engine.rpm'], 8);
    again.focus = 0; again.press();
    again.onClose();
    assert(done && done.isDefault && done.ids.length === own.length);
    // the DME's own values, when there are many, come in alphabetical parts
    const many = new Map();
    for (let i = 0; i < 400; i++) many.set('dme.' + i, { id: 'dme.' + i, name: String.fromCharCode(65 + (i % 26)) + ' value ' + i, group: 'DME', unit: '' });
    const parts = picker.channelGroups(many, core.GROUP_ORDER);
    assert(parts.length >= 3 && parts.every((g) => /^Other (DDE|DME|DDE\/DME) values: [A-Z](-[A-Z])? \(\d+\)$/.test(g.label)), parts.map((g) => g.label).join(', '));
    assert.strictEqual(parts.reduce((n, g) => n + g.defs.length, 0), 400);
    // the Setup page puts them under Advanced PIDs too; the list is worked out once, not at every frame
    const big = new Map(channels);
    many.forEach((d, id) => big.set(id, d));
    let calls = 0;
    const counting = new Proxy(big, { get: (o, k) => { if (k === 'forEach') calls++; const v = o[k]; return typeof v === 'function' ? v.bind(o) : v; } });
    const sh2 = picker.tileSheet({
        page: 'Boost', channels: () => counting, groups: core.GROUP_ORDER, chosen: ['engine.rpm'], isDefault: false, defaults: () => own, max: 8,
        folded: () => false, pairOf: () => undefined, unit: () => null, done: () => {},
    });
    for (let i = 0; i < 20; i++) sh2.rows();
    assert(calls <= 1, 'grouped ' + calls + ' times');
    const top = sh2.rows();
    assert(/^Advanced PIDs \(4\d\d (DDE|DME|DDE\/DME) values\)$/.test(top[top.length - 1].label), top[top.length - 1].label);
    sh2.focus = top.length - 1; sh2.press();
    assert.strictEqual(sh2.level(), 'adv');
    assert(sh2.rows().length >= 3);
});

test('Setup page on Drag: the run to time, from the settings\' list', () => {
    const picker = require(path.join(stage, 'picker.js'));
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'app.json'), 'utf8')).settings.find((s) => s.key === 'dragMode');
    // every run in the settings is one the timer knows
    spec.options.forEach((o) => assert(core.DRAG_MODES[o[0]], 'unknown run ' + o[0]));
    ['200m', '400m', '40-100', '60-160', '70-120', '80-120', '0-200'].forEach((m) => assert(spec.options.some((o) => o[0] === m), m));
    let picked = null;
    const sh = picker.choiceSheet({ title: 'Setup page', options: spec.options, current: '0-100', done: (m) => { picked = m; } });
    assert(sh.rows()[sh.focus].on, 'the current run is where the sheet opens');
    sh.focus = spec.options.findIndex((o) => o[0] === '400m');
    assert.strictEqual(sh.press(), 'close');
    assert.strictEqual(picked, '400m');
});

test('Files: a capture summed up, a run shown again, delete one (twice), delete all but the one being written', async () => {
    const picker = require(path.join(stage, 'picker.js'));
    const files = require(path.join(stage, 'files.js'));
    const { DynoRuns } = require(path.join(stage, 'runs.js'));
    const dir = dataDir(true);
    // a real capture, as the app writes it
    const h = await headUnit(fakeDme(quiet), { dataDir: dir });
    await h.session.connect(core.HEAD_UNIT_CONNECTION);
    let csv;
    try {
        await h.session.setStreamChannels(['engine.rpm', 'vehicle.speed', 'boost.actual']);
        await h.session.startRecording();
        await later(1200);
        csv = await h.session.stopRecording();
    } finally { await h.session.disconnect(); }
    const sum = await new Promise((ok, ko) => files.csvSummary(csv, ['engine.rpm', 'vehicle.speed', 'nope'], (e, r) => (e ? ko(e) : ok(r))));
    assert(sum.rows > 5 && sum.duration > 0.5, sum.rows + ' rows, ' + sum.duration + ' s');
    ['engine.rpm', 'vehicle.speed', 'boost.actual'].forEach((id) => assert(sum.ids.indexOf(id) >= 0, id));
    assert.strictEqual(sum.ids.length, sum.names.length);
    assert.strictEqual(sum.units[sum.ids.indexOf('engine.rpm')], 'rpm');
    assert(sum.stats['engine.rpm'].max >= sum.stats['engine.rpm'].min);
    assert.strictEqual(sum.series.t.length, sum.series['engine.rpm'].length);
    assert(sum.series.nope.every((v) => !isFinite(v)), 'a channel the capture hasn\'t: no values');
    // two more captures (one "being written") and two dyno runs
    const logs = path.join(dir, 'Logs');
    const second = path.join(logs, 'second.csv'), live = path.join(logs, 'live.csv');
    fs.writeFileSync(second, fs.readFileSync(csv));
    fs.writeFileSync(live, fs.readFileSync(csv));
    fs.mkdirSync(path.join(dir, 'Dyno'), { recursive: true });
    const runA = { id: 'run-a', savedAt: 1, vin: 'X', result: { peakEngine: { kw: 150, rpm: 4000 }, peakTorque: { nm: 500, rpm: 2000 }, gear: 4 }, input: {} };
    const runB = Object.assign({}, runA, { id: 'run-b', savedAt: 2 });
    fs.writeFileSync(path.join(dir, 'Dyno', 'run-a.json'), JSON.stringify(runA));
    fs.writeFileSync(path.join(dir, 'Dyno', 'run-b.json'), JSON.stringify(runB));
    const use = files.usage(dir);
    assert.strictEqual(use.Logs.count, 3);
    assert.strictEqual(use.Dyno.count, 2);
    assert.strictEqual(use.Drag.count, 0);
    const dyno = new DynoRuns(core, path.join(dir, 'Dyno'));
    // the browser
    let viewed = null;
    const sh = picker.fileSheet({
        folders: () => files.FOLDERS.map((f) => ({ key: f.key, label: f.label, count: files.usage(dir)[f.key].count, bytes: files.usage(dir)[f.key].bytes })),
        list: (key) => files.list(dir, key),
        busy: (it) => it.file === live,
        viewLabel: (key) => (key === 'Logs' ? 'View' : 'Show'),
        view: (key, it) => { viewed = [key, it.name]; },
        remove: (key, it) => files.remove(it.file),
        removeAll: (key) => files.removeAll(dir, key, live),
        size: files.size,
    });
    assert.strictEqual(sh.rows().length, 3, 'Logs, Dyno, Drag');
    // Dyno: open the newest run, show it
    sh.focus = 1; sh.press();
    assert.strictEqual(sh.rows().length, 3, 'Delete all + two runs');
    assert.strictEqual(sh.sub, 1, 'opens on the newest file');
    sh.press();
    sh.act = 0;
    assert.strictEqual(sh.press(), 'close');
    assert.strictEqual(viewed[0], 'Dyno');
    dyno.show(dyno.store.load(path.join(dir, 'Dyno', viewed[1])));
    assert.strictEqual(dyno.current.id + '.json', viewed[1]);
    // delete it: the first press only asks
    sh.act = 1; sh.press();
    assert(fs.existsSync(path.join(dir, 'Dyno', viewed[1])), 'one press doesn\'t delete');
    sh.press();
    assert(!fs.existsSync(path.join(dir, 'Dyno', viewed[1])), 'the second does');
    assert.strictEqual(sh.level(), 1, 'back in the folder');
    assert.strictEqual(sh.rows().length, 2);
    dyno.reload();
    assert.strictEqual(dyno.runs.length, 1);
    assert.notStrictEqual(dyno.current.id + '.json', viewed[1], 'the page moved on from the deleted run');
    sh.back();
    // Logs: the one being written can't go; Delete all keeps it
    sh.focus = 0; sh.press();
    const liveRow = files.list(dir, 'Logs').findIndex((i) => i.file === live) + 1;
    sh.sub = liveRow; sh.press();
    sh.act = 1; sh.press(); sh.press();
    assert(fs.existsSync(live), 'the capture being written stays');
    sh.back();
    sh.sub = 0; sh.press(); sh.press();
    assert.deepStrictEqual(fs.readdirSync(logs).filter((n) => n.endsWith('.csv')), ['live.csv']);
    assert.strictEqual(files.usage(dir).Logs.count, 1);
    assert.strictEqual(sh.back(), null);
    assert.strictEqual(sh.back(), 'close');
});

test('Power: the car bus torque and the sport displays streamed and captured beside the DDE, power = torque x rpm', async () => {
    const { BusValues, torqueNm, percent, temp } = require(path.join(stage, 'bus.js'));
    assert.strictEqual(temp(48 + 92), 92);
    assert(isNaN(temp(255)));
    assert.strictEqual(torqueNm(2047 + 1100), 550);
    assert(isNaN(torqueNm(4095)) && isNaN(percent(255)));
    // the FES interface as the head unit gives it: the test sends the fields
    const watched = {};
    const signals = { watch: async (iface, inst, handlers) => { watched[iface] = handlers; return { iface, available: true, shutdown: async () => {} }; } };
    const bus = new BusValues(signals, quiet, () => ({ nm: 400, kw: 140 }));
    await bus.start();
    const fes = watched['de.bmw.infotainment.drivingexcitement.FES'], cds = watched['de.bmw.infotainment.vehicle.CDS'];
    const send = () => {
        cds.statusEngineTemperature({ temperatureEngineDrive: 48 + 88, temperatureEngineOilDrive: 48 + 92 });
        fes.statusActualValueTorque2({ actualValueTorqueCrankshaft: 2047 + 1100 });                  // 550 Nm
        fes.statusVehicleDynamicEngine({ displaySportEngineTorque: 125, displaySportEnginePower: 110 }); // 125 %, 110 %
    };
    send();
    const timer = setInterval(send, 200);
    const dir = dataDir(true);
    const h = await headUnit(fakeDme(quiet), { dataDir: dir });
    h.session.setExternalChannels(bus.channels());
    await h.session.connect(core.HEAD_UNIT_CONNECTION);
    let file;
    try {
        const ids = ['bus.oil', 'bus.torque', 'bus.torque_sport', 'bus.power_sport', 'power.bus', 'power.dde'];
        ids.forEach((id) => assert(h.got.channels.some((c) => c.id === id), 'listed: ' + id));
        await h.session.setStreamChannels(BusValues.withNeeds(ids));
        await later(600);
        await h.session.startRecording();
        await later(1000);
        file = await h.session.stopRecording();
    } finally { clearInterval(timer); await h.session.disconnect(); }
    // the batches: the bus values beside the DDE's, power from each
    const b = h.got.batches[h.got.batches.length - 1], row = b.rows[b.rows.length - 1], at = (id) => row[b.channelIds.indexOf(id)];
    assert(b.channelIds.indexOf('load.torque.actual') >= 0, 'the DDE torque is read for power.dde');
    assert.strictEqual(at('bus.torque'), 550);
    assert.strictEqual(at('bus.oil'), 92);
    assert.strictEqual(at('bus.torque_sport'), 500);
    assert(Math.abs(at('bus.power_sport') - 154) < 1e-9);
    const rpm = at('engine.rpm');
    assert(Math.abs(at('power.bus') - 550 * rpm / 9549) < 1e-6, 'power.bus ' + at('power.bus'));
    assert(Math.abs(at('power.dde') - Math.max(0, at('load.torque.actual') * rpm / 9549)) < 1e-6);
    // and in the capture
    const text = fs.readFileSync(file, 'utf8').split('\n');
    const header = text.find((l) => /^Time \[s\],/.test(l));
    assert(/Torque \(car bus\) \[Nm\]/.test(header) && /Power \(car bus\) \[kW\]/.test(header), header);
    // stale: nothing sent for over 2 s is no value
    // sent only when it changes: an old value is still the value
    bus.v.torque.at = Date.now() - 600000;
    assert.strictEqual(bus.read('bus.torque', () => NaN), 550);
    assert(/torque \d+ s/.test(bus.ages()), bus.ages());
});

test('Switched off: the vehicle condition stops the requests (living, switching off), ignition on starts them again', async () => {
    const { Awake, conditionOf } = require(path.join(stage, 'awake.js'));
    assert.strictEqual(conditionOf('FAHREN'), 10);
    assert.strictEqual(conditionOf(5), 5);
    assert.strictEqual(conditionOf(15), undefined);
    let h = null;
    const signals = { watch: async (iface, inst, handlers) => { assert.strictEqual(iface, 'de.bmw.infrastructure.VehicleCondition'); h = handlers; return { available: true, shutdown: async () => {} }; } };
    const a = new Awake(signals, quiet), seen = [];
    a.onChange((on) => seen.push(on));
    assert(a.on && !a.known, 'no state yet: read as before');
    await a.start();
    h.VehicleCondition({ statusConditionVehicle: 'FAHREN' });
    assert(a.on && a.known);
    h.VehicleCondition({ statusConditionVehicle: 'FAHREN' });
    h.VehicleCondition({ statusConditionVehicle: 12 });
    assert(!a.on, 'switching off: no requests');
    h.VehicleCondition({ statusConditionVehicle: 'WOHNEN' });
    h.VehicleCondition({ statusConditionVehicle: 15 });
    assert(!a.on, 'a no-value state changes nothing');
    h.VehicleCondition({ statusConditionVehicle: 'PRUEFEN_ANALYSE_DIAGNOSE' });
    assert(a.on);
    assert.deepStrictEqual(seen, [true, false, true], 'told once per change (and the first state)');
});

test('Dyno settings: Virtual Dyno\'s (weight 1950 kg, body shape, losses, graph, ECU torque) and the weather correction', () => {
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'app.json'), 'utf8')).settings;
    const get = (k) => settings.find((s) => s.key === k);
    assert.strictEqual(get('dynoMass').default, 1950);
    assert(get('dynoMass').steps.indexOf(1950) >= 0);
    assert.deepStrictEqual(get('dynoBody').options.map((o) => o[0]), ['coupe', 'wagon', 'suv']);
    assert.strictEqual(get('dynoBody').default, 'wagon');
    assert(get('dynoLoss') && !get('dynoMaxRpm') && get('dynoEcuTorque') && get('dynoCorrection'));
    assert(!get('dynoStartRpm') && !get('dynoEndRpm') && !get('dynoCdA'), 'the old pull range is gone');
});

test('a DDE that stays silent when several dynamic DIDs are read at once (a B47: three): the read is split and the stream goes on', async () => {
    const h = await headUnit(fakeDme(quiet, { silentDynamicDids: 2 }));
    await h.session.connect(core.HEAD_UNIT_CONNECTION);
    try {
        const ids = h.got.channels.map((c) => c.id).filter((id) => /^bmw\.|^boost|^load|^fuel|^temp|^engine|^vehicle|^throttle/.test(id)).slice(0, 60);
        await h.session.setStreamChannels(ids);
        await later(3500);
        const composed = h.got.logs.filter((l) => /composed into (\d+) dynamic/.test(l)).pop();
        assert(composed && Number(/into (\d+) dynamic/.exec(composed)[1]) >= 2, 'needs 2+ dynamic DIDs: ' + composed);
        assert(h.got.logs.some((l) => /didn't answer 2 dynamic DIDs in one request .* now at most 1 per request/.test(l)), h.got.logs.filter((l) => /ECU|Stream/.test(l)).join(' | '));
        assert(!h.got.logs.some((l) => /now using 1$/.test(l)), 'the other DIDs still go several at a time');
        const n = h.got.batches.length;
        await later(1200);
        assert(h.got.batches.length > n, 'samples keep coming');
        const errs = h.got.logs.filter((l) => /Stream error/.test(l)).length;
        await later(1500);
        assert.strictEqual(h.got.logs.filter((l) => /Stream error/.test(l)).length, errs, 'no more stream errors once split');
    } finally { await h.session.disconnect(); }
});

test('picked channels are streamed and captured, the rest not; Session stops at MAX_STREAMED', async () => {
    const dir = dataDir(true);
    const h = await headUnit(fakeDme(quiet), { dataDir: dir });
    await h.session.connect(core.HEAD_UNIT_CONNECTION);
    let file;
    try {
        await h.session.setStreamChannels(['knock.signal.cyl1', 'dme.6a48', 'boost.actual']);
        await h.session.startRecording();
        await later(800);
        file = await h.session.stopRecording();
        const last = h.got.batches[h.got.batches.length - 1];
        assert.deepStrictEqual(last.channelIds.slice().sort(), ['boost.actual', 'dme.6a48', 'engine.rpm', 'knock.signal.cyl1', 'throttle.pedal', 'vehicle.gear', 'vehicle.speed']);
        const row = last.rows[last.rows.length - 1], knock = row[last.channelIds.indexOf('knock.signal.cyl1')];
        assert(knock >= 0.3 && knock < 2.5, 'knock signal ' + knock);
        // everything the car offers: Session streams the first MAX_STREAMED
        const all = h.got.channels.map((c) => c.id);
        assert(all.length > core.MAX_STREAMED, all.length + ' channels offered');
        await h.session.setStreamChannels(all);
        h.got.batches = [];
        await later(800);
        const b = h.got.batches[h.got.batches.length - 1];
        assert(b, 'no samples');
        assert.strictEqual(b.channelIds.length, core.MAX_STREAMED);
    } finally { await h.session.disconnect(); }
    const ids = fs.readFileSync(file, 'utf8').split('\n').find((l) => /^# ids=/.test(l));
    assert(/knock\.signal\.cyl1/.test(ids) && /dme\.6a48/.test(ids), ids);
    assert(!/boost\.target/.test(ids), 'boost.target was not picked: ' + ids);
});

test('without BMW DME data: the standard OBD-II channels, read plainly', async () => {
    const h = await headUnit(fakeDme(quiet), { dataDir: dataDir(false) });
    const s = await h.session.connect(core.HEAD_UNIT_CONNECTION);
    try {
        assert.strictEqual(s.state, 'live', s.error);
        assert.strictEqual(s.ecu.dmeData, undefined);
        const ids = h.got.channels.map((c) => c.id);
        ['engine.rpm', 'boost.actual', 'vehicle.gear', 'fuel.lambda.actual'].forEach((id) => assert(ids.indexOf(id) >= 0, id + ' missing'));
        await h.session.setStreamChannels(['engine.rpm', 'boost.actual']);
        await later(700);
        assert(h.got.batches.length > 0, 'no samples');
        assert(h.bus.seen.some((r) => r.uds[0] === 0x22 && r.uds[1] === 0xF4 && r.uds[2] === 0x0C), 'no OBD rpm read');
    } finally { await h.session.disconnect(); }
});

test('a DME that doesn\'t answer: a clear error, nothing streamed', async () => {
    const silent = { request() {} };
    const h = await headUnit(silent);
    const s = await h.session.connect(core.HEAD_UNIT_CONNECTION);
    await h.session.disconnect();
    assert.strictEqual(s.state, 'error');
    assert(/does not respond/.test(s.error), s.error);
});

test('the transport refusing requests: the same error, and the log says why', async () => {
    const h = await headUnit(fakeDme(quiet), { verdict: 'APP_REQUEST_NOT_ACCEPTED' });
    const s = await h.session.connect(core.HEAD_UNIT_CONNECTION);
    await h.session.disconnect();
    assert.strictEqual(s.state, 'error');
    assert(/does not respond/.test(s.error), s.error);
    assert(h.got.logs.some((l) => /refused the request: transport refused: APP_REQUEST_NOT_ACCEPTED/.test(l)), h.got.logs.join('\n'));
});

/**
 * Boostline's simulated drive cycle (idle, launch to ~190 km/h, cruise, a 4th-gear pull to the limiter,
 * stop) at `hz`, faster than real time: fn(t, snapshot) per sample until it returns true or `seconds` pass.
 */
function driveCycle(hz, seconds, fn) {
    const engine = new fakeDme.SimEngine();
    for (let i = 0; i * (1 / hz) < seconds; i++) {
        engine.step(1 / hz);
        if (fn(i / hz, engine.snapshot())) return true;
    }
    return false;
}

test('the dyno, armed, records the drive cycle\'s 4th-gear pull from the car\'s signals (Virtual Dyno\'s way) and saves it', () => {
    const { DynoRuns } = require(path.join(stage, 'runs.js'));
    const dir = path.join(dataDir(false), 'Dyno');
    const dyno = new DynoRuns(core, dir);
    assert.strictEqual(dyno.state, 'idle');
    const setup = (m) => ({ massKg: m, drivetrainLossPct: 15, body: 'wagon', correction: 'none', baroHpa: 1013, ambientTempC: 20, humidityPct: 50 });
    let run = null, fast = false, sawRecording = false;
    const hist = [];
    // the car's signals at 30 a second: the DSC's (filtered) acceleration is the speed's change over 0.2 s
    driveCycle(30, 180, (t, s) => {
        const v = s['vehicle.speed'];
        hist.push({ v, t });
        if (hist.length > 7) hist.shift();
        const gLong = hist.length > 1 ? (v - hist[0].v) / 3.6 / (t - hist[0].t) / 9.80665 : 0;
        if (v > 150) fast = true;
        if (!dyno.armed && !run && fast && s['throttle.pedal'] < 10) dyno.arm(setup(1950));
        run = dyno.feed({ rpm: s['engine.rpm'], speed: v, gLong, torque: s['load.torque.actual'] }, t * 1000, { vin: 'WBAEMU000BL000001', gear: s['vehicle.gear'] });
        if (dyno.state === 'recording') sawRecording = true;
        return !!run;
    });
    assert(run, 'no pull captured');
    assert(sawRecording, 'recording while the pull ran');
    assert.strictEqual(dyno.state, 'done');
    assert(!dyno.armed, 'disarmed after the run');
    assert.strictEqual(run.result.method, 'bus');
    assert.strictEqual(run.result.gear, 4);
    // the simulator's B58: about 630 Nm, so roughly 300-360 kW at the crank
    assert(run.result.peakEngine.kw > 250 && run.result.peakEngine.kw < 450, 'peak ' + run.result.peakEngine.kw.toFixed(0) + ' kW');
    // and the torque worked out from the acceleration is close to what the engine says (plausible, not a monster)
    const ecuPeak = Math.max.apply(null, run.result.points.map((p) => p.ecuNm).filter(isFinite));
    assert(Math.abs(run.result.peakTorque.nm / ecuPeak - 1) < 0.3, run.result.peakTorque.nm.toFixed(0) + ' Nm vs ECU ' + ecuPeak.toFixed(0));
    assert(run.result.peakTorque.nm > 450 && run.result.peakTorque.nm < 800, 'torque ' + run.result.peakTorque.nm.toFixed(0) + ' Nm');
    assert(run.result.points.length > 15 && run.result.points.every((p, i, a) => !i || p.rpm - a[i - 1].rpm === 100), '100 rpm bins');
    assert(run.result.points.some((p) => isFinite(p.ecuNm)), 'the ECU torque goes along');
    assert(Math.abs(run.result.peakWheel.kw - run.result.peakEngine.kw * 0.85) < 1e-6);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, run.id + '.json'), 'utf8'));
    assert.strictEqual(saved.vin, 'WBAEMU000BL000001');
    assert(saved.input.gLong.length === saved.input.rpm.length && saved.input.t.length > 50);
    // another weight works it out again: more mass, more power; SAE correction on a hot day: more again
    const before = dyno.result.peakEngine.kw;
    dyno.setSetup(setup(2200));
    assert(dyno.result.peakEngine.kw > before * 1.05, dyno.result.peakEngine.kw + ' vs ' + before);
    const heavy = dyno.result.peakEngine.kw;
    dyno.setSetup(Object.assign(setup(2200), { correction: 'SAE', ambientTempC: 35, baroHpa: 980 }));
    assert(dyno.result.correctionFactor > 1 && dyno.result.peakEngine.kw > heavy);
    // the baseline: pinned, it's drawn behind another run
    dyno.baselineId = run.id;
    assert.strictEqual(dyno.baseline(), null, 'not behind itself');
    // a short burst: said, and the dyno stays armed
    dyno.arm(setup(1950));
    let t = 0;
    for (let i = 0; i < 20; i++) dyno.feed({ rpm: 2000 + i * 20, speed: 60 + i * 0.4, gLong: 0.3, torque: 300 }, (t += 40));
    for (let i = 0; i < 20; i++) dyno.feed({ rpm: 2400, speed: 68, gLong: 0, torque: 50 }, (t += 40));
    assert(dyno.armed && /too short/.test(dyno.note.text));
    dyno.disarm();
    // a new DynoRuns lists it
    assert.strictEqual(new DynoRuns(core, dir).runs[0].id, run.id);
});

test('the dyno pull ends at a sharp fall of the acceleration (kept up to its high point) or a gear change; ends smoothed on their slope', () => {
    const { PullDetector, smoothed } = require(path.join(stage, 'vdyno.js'));
    // 3rd gear, 1500 -> 4500 rpm over 6 s, then off the pedal: the car's acceleration falls fast
    const k = 1500 / 40, run = (after) => {
        const det = new PullDetector();
        let out = null, t = 0;
        for (; t <= 6000 && !out; t += 40) {
            const rpm = 1500 + t / 2, g = 0.4 - t / 6000 * 0.1;
            const r = det.push({ rpm, speed: rpm / k, gLong: g }, t);
            if (r && r.state !== 'pull') out = r;
        }
        for (let i = 1; i <= 15 && !out; i++, t += 40) {
            const r = det.push(after(i, t), t);
            if (r && r.state !== 'pull') out = r;
        }
        return out;
    };
    const lift = run((i, t) => ({ rpm: 4500, speed: 4500 / k, gLong: Math.max(0, 0.3 - i * 0.06) }));
    assert.strictEqual(lift.state, 'done');
    const top = Math.max.apply(null, lift.input.rpm);
    assert(top <= 4500 && top >= 4400, 'kept up to the last high point: ' + top);
    assert(lift.input.gLong.every((g) => g >= 0.29), 'no sample of the fall');
    // an upshift: the rpm / speed ratio jumps; the 3rd gear part is the run
    const shift = run((i, t) => ({ rpm: 3000 + i * 20, speed: 4500 / k + i * 0.3, gLong: 0.3 }));
    assert.strictEqual(shift.state, 'done');
    assert(Math.max.apply(null, shift.input.rpm) >= 4400 && Math.min.apply(null, shift.input.rpm) < 1600, 'the gear before the shift');
    // a straight line stays itself at the ends (a plain mean would pull them in)
    const ys = smoothed([1, 2, 3, 4, 5, 6, 7], [10, 20, 30, 40, 50, 60, 70]);
    ys.forEach((y, i) => assert(Math.abs(y - (i + 1) * 10) < 1e-9, ys.join(',')));
});

test('DPF regeneration active: asked for and the exhaust before the DPF at burning heat', () => {
    const { regenActive, REGEN_HOT_C } = require(path.join(stage, 'bus.js'));
    assert.strictEqual(regenActive(0, 600), 0);
    assert.strictEqual(regenActive(2, 300), 0, 'asked for, not burning yet');
    assert.strictEqual(regenActive(2, REGEN_HOT_C + 50), 1);
    assert.strictEqual(regenActive(2, NaN), 1, 'without the temperature: the request');
    assert(isNaN(regenActive(NaN, 600)));
});

test('the drag timer times the drive cycle\'s launch: 0-100 km/h and the 1/8 mile', () => {
    const { DragRuns } = require(path.join(stage, 'runs.js'));
    const dir = path.join(dataDir(false), 'Drag');
    ['0-100', '201m'].forEach((mode) => {
        const drag = new DragRuns(core, dir);
        drag.arm(mode, { calibration: [], environment: { altitudeM: 0, ambientTempC: 20, humidityPct: 50 } });
        let run = null;
        driveCycle(30, 120, (t, s) => { run = drag.push(t, s['vehicle.speed'], s['vehicle.gear'], s['engine.rpm']); return !!run; });
        assert(run, mode + ': no run');
        assert(run.result.finished, mode + ': ' + run.result.warnings.join('; '));
        const time = run.result.finalTime;
        if (mode === '0-100') {
            assert(time > 3 && time < 7, '0-100 in ' + time);
            assert(run.result.splits.length >= 8, 'splits');
            assert(run.result.gearChanges.some((g) => g.from === 1 && g.to === 2), 'no 1-2 shift');
        } else assert(time > 6 && time < 14, '1/8 mile in ' + time);
        assert(fs.existsSync(path.join(dir, run.id + '.json')), 'not saved');
    });
    const drag = new DragRuns(core, dir);
    assert.strictEqual(drag.runs.length, 2);
    assert(drag.best('0-100') > 3);
});

test('the drag timer: 0-400 m and a 70-120 km/h roll-on, with the run shown live', () => {
    const { DragRuns } = require(path.join(stage, 'runs.js'));
    const dir = path.join(dataDir(false), 'Drag');
    ['400m', '70-120'].forEach((mode) => {
        const drag = new DragRuns(core, dir);
        drag.arm(mode, { calibration: [] });
        let run = null, lastLive = null, liveSeen = 0;
        driveCycle(30, 180, (t, s) => {
            run = drag.push(t, s['vehicle.speed'], s['vehicle.gear'], s['engine.rpm']);
            const l = drag.live;
            if (l) {
                liveSeen++;
                if (lastLive) assert(l.distanceM >= lastLive.distanceM - 1e-6 && l.elapsed >= lastLive.elapsed - 1e-6, 'live numbers go forward');
                lastLive = l;
            }
            return !!run;
        });
        assert(run && run.result.finished, mode + ': ' + (run ? run.result.warnings.join('; ') : 'no run'));
        assert(liveSeen > 10, mode + ': live ' + liveSeen);
        assert.strictEqual(drag.live, null, 'not live after the run');
        if (mode === '400m') {
            assert(Math.abs(run.result.distanceM - 400) < 1e-6);
            assert(run.result.trapSpeedKmh > 120 && run.result.trapSpeedKmh < 260, 'exit ' + run.result.trapSpeedKmh);
            assert(lastLive.distanceM > 350 && lastLive.distanceM <= 410, 'live distance ' + lastLive.distanceM);
        } else {
            assert.strictEqual(run.result.trapSpeedKmh, 120);
            assert(run.result.finalTime > 1 && run.result.finalTime < 15, '70-120 in ' + run.result.finalTime);
        }
    });
});

test('a drag run with a speedometer correction times on the corrected speed', () => {
    const { DragRuns } = require(path.join(stage, 'runs.js'));
    const times = [0, 5].map((pct) => {
        const drag = new DragRuns(core, path.join(dataDir(false), 'Drag'));
        drag.arm('0-100', { calibration: pct ? [{ ecu: 100, gps: 100 * (1 + pct / 100) }] : [] });
        let run = null;
        driveCycle(30, 120, (t, s) => { run = drag.push(t, s['vehicle.speed']); return !!run; });
        return run.result.finalTime;
    });
    // 5 % faster than the car says: 100 km/h true comes before the car shows 100
    assert(times[1] < times[0], times.join(' vs '));
});

test('the app\'s own code compiles on this Node', () => {
    const vm = require('vm');
    fs.readdirSync(path.join(ROOT, 'app')).filter((f) => f.endsWith('.js')).forEach((f) => {
        const src = fs.readFileSync(path.join(ROOT, 'app', f), 'utf8');
        try { new vm.Script('(function (exports, require, module, __filename, __dirname) {' + src + '\n})', { filename: f }); } catch (e) { throw new Error(f + ': ' + e.message); }
    });
});

(async () => {
    let failed = 0;
    console.log('Node ' + process.version + ', Boostline ' + core.BOOSTLINE_VERSION + ' core');
    for (const t of tests) {
        try { await t.fn(); console.log('  ok   ' + t.name); } catch (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + String(e && e.stack || e).split('\n').join('\n       ')); }
    }
    rmrf(stage);
    console.log(failed ? failed + ' of ' + tests.length + ' failed' : 'all ' + tests.length + ' passed');
    process.exit(failed ? 1 : 0);
})();
