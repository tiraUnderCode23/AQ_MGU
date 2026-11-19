'use strict';
/* Offline contracts only. Actual source modules run with local, inert SDK,
 * SOME/IP, filesystem and transport doubles. There is no real socket or car. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');
const PORT = path.resolve(process.argv[2]);
const ORIGINAL = path.resolve(process.argv[3]);
const GROUP = process.argv[4];
const APP = path.join(PORT, 'apps/adam_shiftlights');
const OLDAPP = path.join(ORIGINAL, 'apps/adam_shiftlights');
const plain = (value) => JSON.parse(JSON.stringify(value));
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
let assertions = 0;
function check(value, message) { assertions++; assert.ok(value, message); }
function equal(actual, expected, message) { assertions++; assert.deepStrictEqual(plain(actual), plain(expected), message); }
async function settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function clock() {
    let time = 1000, next = 1;
    const tasks = new Map();
    const add = (fn, ms, repeat) => { const id = next++; tasks.set(id, { fn, at: time + Math.max(0, ms || 0), repeat }); return id; };
    const api = {
        setTimeout: (fn, ms) => add(fn, ms, 0), clearTimeout: (id) => tasks.delete(id),
        setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms)), clearInterval: (id) => tasks.delete(id),
        setImmediate: (fn) => add(fn, 0, 0), now: () => time,
        async advance(ms) {
            const end = time + ms; let iterations = 0;
            await settle();
            while (true) {
                let chosen = null;
                for (const entry of tasks) if (entry[1].at <= end && (!chosen || entry[1].at < chosen[1].at)) chosen = entry;
                if (!chosen) break;
                if (++iterations > 20000) throw new Error('unbounded timer loop');
                const [id, task] = chosen; time = task.at; tasks.delete(id);
                if (task.repeat) tasks.set(id, Object.assign({}, task, { at: time + task.repeat }));
                task.fn(); await settle();
            }
            time = end; await settle();
        },
        count: () => tasks.size,
    };
    return api;
}
function load(file, dependencies, globals) {
    const box = Object.assign({ module: { exports: {} }, Buffer, Promise, console, Uint8Array,
        process: { env: {}, cwd: () => '/fake/data', on() {}, hrtime: () => [0, 0], memoryUsage: () => ({ rss: 0 }), exit() { throw new Error('unexpected exit'); } },
        setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, __dirname: path.dirname(file),
        require(name) { if (!(name in dependencies)) throw new Error('unapproved module: ' + name); return dependencies[name]; }
    }, globals || {});
    box.global = box;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), box, { filename: file, timeout: 3000 });
    return box.module.exports;
}
function timed(timer) { return Object.assign({}, timer, { Date: { now: timer.now } }); }
function fixture() {
    const L = require(path.join(APP, 'logic'));
    const cfg = L.validateConfig(require(path.join(APP, 'config'))).cfg;
    const spec = JSON.parse(fs.readFileSync(path.join(APP, 'app.json')));
    const values = Object.fromEntries(spec.settings.map((setting) => [setting.key, setting.default]));
    const get = (key) => values[key];
    return { L, cfg, spec, values, get, sel: () => ({ cluster: L.readStyle(cfg, get, 'cluster'), hud: L.readStyle(cfg, get, 'hud') }) };
}
function request(f, display) {
    return { active: true, display: display || 'both', sel: f.sel(), states: { cluster: { lit: 4, flashing: false }, hud: { lit: 4, flashing: false } },
        rpm: 4000, th: f.L.thresholds(f.cfg, f.L.modeThresholds(f.cfg, f.get, 'sport'), 100), gear: '3', flashMode: 'app' };
}

async function geometry() {
    const ID8 = require(path.join(APP, 'id8_geometry')), original = require(path.join(OLDAPP, 'geom'));
    const shader = require(path.join(APP, 'shader')), f = fixture();
    for (const description of ['map:874x749,hud:353x203,guide:702x213,widget:2240x896,popup:2240x896', 'map:1200x700,hud:640x256']) {
        const hello = ID8.profile('id8', description);
        check(hello.valid, 'real hello shape accepted');
        for (const cluster of ['large', 'classic', 'row', 'stock']) for (const hud of ['large', 'classic', 'bar', 'bracket']) {
            f.values.clusterStyle = cluster; f.values.hudStyle = hud;
            for (const display of ['cluster', 'hud', 'both']) {
                const sel = f.sel(), plan = ID8.layersFor(f.cfg, display, sel, hello);
                const before = original.layersFor(f.cfg, display === 'cluster' ? 'both' : display, sel).filter((p) => display !== 'cluster' || p.which === 'cluster');
                check(plan.length > 0);
                for (const p of plan) {
                    const r = p.outputRect, target = hello.targets[r.target];
                    check(r.target !== 'panel', 'ID8 must never request whole panel');
                    check([r.x, r.y, r.w, r.h].every(Number.isInteger));
                    check(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= target[0] && r.y + r.h <= target[1]);
                    const orig = before.find((row) => row.key === p.key);
                    equal(p.rect, orig.rect, 'source artwork is still virtual');
                    if (p.role === 'slats') equal(shader.slatUniforms(p, f.cfg.colors, 1), shader.slatUniforms(orig, f.cfg.colors, 1));
                    if (p.role === 'bracketFill') equal(shader.bracketUniforms(p, f.cfg.colors, 1, {}, f.cfg.hudStyles.cells), shader.bracketUniforms(orig, f.cfg.colors, 1, {}, f.cfg.hudStyles.cells));
                }
            }
        }
    }
    equal(ID8.contain({ target: 'map', x: 0, y: 0, w: 1088, h: 480 }, [1088, 480], [874, 749]), { target: 'map', x: 0, y: 182, w: 874, h: 385 });
    for (const [backend, targets] of [['id7', 'map:874x749,hud:353x203'], ['id8', 'panel:1920x720'], ['id8', 'map:0x749'], ['id8', 'map:999999x99999'], ['id8', 'map:874x749,map:1x1'], ['id8', null]]) check(!ID8.profile(backend, targets).valid);
    const onlyMap = ID8.profile('id8', 'map:900x600,hud:bad');
    check(onlyMap.valid && onlyMap.problems.hud);
    equal(ID8.layersFor(f.cfg, 'hud', f.sel(), onlyMap), []);
    check(ID8.contain({ target: 'hud', x: -1, y: 0, w: 10, h: 10 }, [800, 480], [353, 203]) === null);
}

function outputHarness(id8, original) {
    const folder = original ? OLDAPP : APP, timer = clock(), sockets = [], instances = [], events = [];
    class Socket extends EventEmitter {
        constructor() { super(); this.messages = []; }
        write(buffer) { this.messages.push(Buffer.from(buffer)); return true; }
        destroy() { this.emit('close'); }
    }
    const Client = load(path.join(folder, 'cluster_render_client.js'), { events: EventEmitter, net: { connect() { const socket = new Socket(); sockets.push(socket); return socket; } } }, timed(timer)).ClusterRender;
    class WireClient extends Client { constructor(...args) { super(...args); instances.push(this); } }
    const Canvas = load(path.join(PORT, 'kit/runtime/canvas.js'), { zlib: require('zlib'), './fonts': { get() { throw new Error('unexpected font load'); } }, './i18n': { t: (s) => s } }).Canvas;
    const dependencies = Object.fromEntries(['shader', 'geom', 'hudart', 'logic', 'crstatus', 'hudcheck'].map((name) => ['./' + name, require(path.join(folder, name))]));
    if (!original) dependencies['./id8_geometry'] = require(path.join(APP, 'id8_geometry'));
    const create = load(path.join(folder, 'output.js'), dependencies, timed(timer)).createOutput;
    const f = fixture(); let current = request(f);
    const output = create({ ClusterRender: WireClient, id8, cfg: f.cfg, log: quiet, guard: (name, fn) => fn,
        makeCanvas: (w, h) => new Canvas(w, h), timers: timer, checkTimers: timer,
        onChange() { events.push('change'); }, onRebuildDue() { output.apply(current); } });
    const messages = (index) => sockets[index].messages.filter((buffer) => buffer[4] === 0x4a).map((buffer) => JSON.parse(buffer.subarray(5).toString('utf8')));
    return { output, timer, sockets, instances, f, events, messages, setCurrent(value) { current = value; }, apply() { output.apply(current); } };
}

async function output() {
    const h = outputHarness(true, false);
    h.apply(); equal(h.instances[0].layers.size, 0, 'no cached layer before hello');
    h.sockets[0].emit('connect'); equal(h.messages(0).map((m) => m.op), ['hello']);
    h.instances[0]._event({ ev: 'hello', backend: 'id8', targets: 'map:874x749,hud:353x203' });
    const made = h.messages(0).filter((message) => message.op === 'layer');
    equal(made.length, 4); check(made.every((message) => message.target === 'map' || message.target === 'hud'));
    const image = made.find((message) => message.kind === 'image');
    check(image.iw > image.w && image.ih > image.h, 'image retains its original pixel resolution');
    equal(image.sampling, 'bilinear');
    h.setCurrent(Object.assign(request(h.f), { gear: '4' })); h.apply();
    check(h.sockets[0].messages.some((buffer) => buffer[4] === 0x46), 'actual original pixel uploader exercised');
    const HC = require(path.join(APP, 'hudcheck'));
    const verdict = HC.verdict({ which: 'hud', on: true, shown: true, proof: h.output.status().proof, level: 1 });
    check(verdict.code !== 'ok', 'a hello/layer upload is not proof of HUD display');
    h.sockets[0].emit('close');
    equal(h.instances[0].layers.size, 0, 'cache is empty before reconnect replay');
    equal(h.output.status().proof.layers, []);
    await h.timer.advance(250); h.sockets[1].emit('connect');
    equal(h.messages(1).map((m) => m.op), ['hello']);
    h.setCurrent(Object.assign(request(h.f), { active: false }));
    h.instances[0]._event({ ev: 'hello', backend: 'id8', targets: 'map:1200x700,hud:640x256' });
    equal(h.messages(1).filter((m) => m.op === 'layer'), [], 'reconnect reevaluates fresh active decision');
    h.setCurrent(request(h.f)); h.apply(); h.sockets[2].emit('connect');
    h.instances[1]._event({ ev: 'hello', backend: 'id8', targets: 'map:1200x700,hud:640x256' });
    const resized = h.messages(2).filter((m) => m.op === 'layer');
    check(resized.some((m) => m.target === 'map' && m.w !== made.find((x) => x.target === 'map').w));
    h.output.apply({ active: false, display: 'off' });
    equal(h.instances[1].layers.size, 0, 'kill/off drops every cached layer');
    const bad = outputHarness(true, false); bad.apply(); bad.sockets[0].emit('connect');
    bad.instances[0]._event({ ev: 'hello', backend: 'id7', targets: 'panel:1920x720,map:1088x480,hud:800x480' });
    equal(bad.messages(0).filter((m) => m.op === 'layer'), []);
    check(/ID8/.test(bad.output.status().proof.profileError));
    const missing = outputHarness(true, false); missing.apply(); missing.sockets[0].emit('connect');
    missing.instances[0]._event({ ev: 'hello', backend: 'id8', targets: 'map:874x749' });
    equal(HC.verdict({ which: 'hud', on: true, shown: true, proof: missing.output.status().proof }).code, 'unavailable');
    const old = outputHarness(false, true), port = outputHarness(false, false);
    for (const item of [old, port]) { item.apply(); item.sockets[0].emit('connect'); item.instances[0]._event({ ev: 'hello', backend: 'id7', targets: 'panel:1920x720,map:1088x480,hud:800x480' }); }
    equal(port.messages(0), old.messages(0), 'ID7 layer/uniform wire messages unchanged');
}

async function signalGate() {
    const api = require(path.join(APP, 'id8_signals')), f = fixture(), timer = clock();
    let provider = true, enabled = true, pending = false, failures = [], changes = 0;
    const got = [], calls = [], waiting = [], values = { [api.RPM]: { actualValueRPMEngineCrankshaft: 24000 }, [api.OIL]: { temperatureEngineOilDrive: 148 } };
    const signals = { readFailures: () => failures };
    const gate = api.createSignalGate({ signals, rpm: f.cfg.rpm, now: timer.now, timers: timer, log: quiet,
        enabled: () => enabled, fast: () => false, onChange: () => changes++ });
    const handlers = gate.wrap({ [api.RPM]: (v) => got.push([api.RPM, plain(v)]), [api.OIL]: (v) => got.push([api.OIL, plain(v)]) });
    const sub = { available: true, availabilityGeneration: 1, proxy: { isAvailable: () => provider },
        readField(field, timeout, accept) {
            calls.push([field, timeout]);
            return new Promise((resolve) => {
                const respond = () => { if (accept()) handlers[field](values[field]); resolve(values[field]); };
                if (pending) waiting.push(respond); else respond();
            });
        } };
    gate.attach(sub); gate.start(); await timer.advance(0); equal(gate.reason(), '');
    handlers[api.RPM]({ actualValueRPMEngineCrankshaft: 65535 });
    check(/invalid/.test(gate.reason()));
    handlers[api.OIL]({ temperatureEngineOilDrive: 149 }); check(/RPM/.test(gate.reason()), 'oil cannot clear RPM failure');
    handlers[api.RPM](values[api.RPM]); equal(gate.reason(), '');
    handlers[api.OIL]({ temperatureEngineOilDrive: 255 }); check(/oil/.test(gate.reason()));
    handlers[api.RPM](values[api.RPM]); check(/oil/.test(gate.reason()));
    handlers[api.OIL](values[api.OIL]); equal(gate.reason(), '');
    enabled = false; await timer.advance(1600); check(/expired/.test(gate.reason()));
    handlers[api.RPM](values[api.RPM]); equal(gate.reason(), '');
    await timer.advance(1500); handlers[api.RPM](values[api.RPM]); check(/oil.*expired/.test(gate.reason()));
    handlers[api.OIL](values[api.OIL]); equal(gate.reason(), '');
    provider = false; sub.available = false; sub.availabilityGeneration++;
    await timer.advance(100); check(/provider unavailable/.test(gate.reason()));
    provider = true; sub.available = true; sub.availabilityGeneration++; enabled = true;
    await timer.advance(1000); equal(gate.reason(), '');
    failures = [{ iface: api.CDS, field: api.OIL, reason: 'fixture read failed' }]; check(/fixture/.test(gate.reason()));
    failures = [{ iface: 'optional.FES', field: 'optional', reason: 'missing' }]; equal(gate.reason(), '');
    failures = [];
    pending = true; await timer.advance(1100); const requests = calls.length;
    check(waiting.length === 2, 'at most one unresolved read for each of two fields');
    await timer.advance(5000); equal(calls.length, requests, 'timeouts cannot accumulate unresolved getters');
    check(/timed out/.test(gate.reason()));
    const before = got.length; waiting.splice(0).forEach((done) => done()); await settle();
    equal(got.length, before, 'responses after local deadline are discarded');
    pending = false; await timer.advance(2000); equal(gate.reason(), '');
    pending = true; await timer.advance(1100); const stopped = got.length;
    gate.stop(); waiting.splice(0).forEach((done) => done()); await settle();
    equal(got.length, stopped); equal(timer.count(), 0); check(changes > 0);
}

async function watchedGetterBridge() {
    const immediate = () => new Promise((resolve) => setImmediate(resolve));
    const receives = [], requests = [];
    let availability;
    const proxy = { init: async () => proxy, subscribe: async () => {}, isAvailable: () => true,
        subscribeToAvailability(fn) { availability = fn; },
        getValue(field, timeout) { return new Promise((resolve) => requests.push({ field, timeout, resolve })); } };
    const api = load(path.join(PORT, 'kit/runtime/signals.js'), {
        fs: { readFileSync: () => JSON.stringify({ fields: { rpm: { getter: true }, eventOnly: {} } }) }, path,
        someip: { buildProxy: async () => proxy },
    });
    const result = await api.watch('fixture.ReadOnly', '1', { rpm: (v) => receives.push(v), eventOnly() {} }, quiet, { dropStaleReads: true, initialRead: false });
    await immediate(); equal(requests.length, 0, 'the bounded caller owns all getter requests');
    const before = receives.length;
    const read = result.readField('rpm', 200, () => true); await immediate();
    availability(false); requests.splice(0).forEach((r) => r.resolve({ value: 2 })); await read;
    equal(receives.length, before, 'previous provider response does not feed handlers');
    await assert.rejects(result.readField('eventOnly', 200), /no watched getter/);
    await assert.rejects(result.readField('unlisted', 200), /no watched getter/); assertions += 2;
    const discarded = result.readField('rpm', 200, () => false); await immediate();
    requests.splice(0).forEach((r) => r.resolve({ value: 3 })); await discarded; equal(receives.length, before);
    availability(true); await immediate(); equal(requests.length, 0, 'provider recovery cannot create overlapping generic reads');
}

async function typedWatchedGetterBridge() {
    const immediate = () => new Promise((resolve) => setImmediate(resolve));
    const receives = [], requests = [];
    let availability, available = true;
    const member = (field) => ({ subscribe: async () => {}, getValue: () => new Promise((resolve, reject) => requests.push({ field, resolve, reject })) });
    const px = { rpm: member('rpm'), oil: member('oil'), eventOnly: { subscribe: async () => {} },
        subscribeToAvailability(fn) { availability = fn; fn(available); }, isAvailable: () => available };
    const api = load(path.join(PORT, 'kit/runtime/signals.js'), {
        fs: { readFileSync() { throw new Error('no raw config in typed fixture'); } }, path,
        'oap-sdk': { someipBuilders: { buildAndInitTypedProxy: async () => px } },
    });
    api.allowTyped(true, quiet);
    const result = await api.watch('fixture.TypedReadOnly', '1', { rpm: (v) => receives.push(['rpm', v]), oil: (v) => receives.push(['oil', v]), eventOnly() {} }, quiet,
        { dropStaleReads: true, initialRead: false });
    await immediate(); equal(requests.length, 0, 'typed initial and availability reads belong to the bounded caller');
    const perform = async (field, failure, accept) => {
        const read = result.readField(field, 200, accept || (() => true));
        await immediate();
        const request = requests.shift(); check(request && request.field === field);
        if (failure) { request.reject(new Error(failure)); await assert.rejects(read, new RegExp(failure)); assertions++; }
        else { request.resolve({ value: 1 }); await read; }
    };
    await perform('rpm'); check(result.available);
    await perform('oil', 'oil read failed'); check(!result.available);
    await perform('rpm'); check(api.readFailures().some((row) => row.field === 'oil'), 'another typed field cannot clear an oil failure');
    await perform('oil', null, () => false); check(api.readFailures().some((row) => row.field === 'oil'), 'discarded typed reading cannot clear health');
    await perform('oil'); equal(api.readFailures(), []); check(result.available);
    const before = receives.length, old = result.readField('rpm', 200, () => true);
    await immediate(); available = false; availability(false);
    requests.shift().resolve({ value: 9 }); await old;
    equal(receives.length, before, 'typed response from the prior provider generation is ignored');
    check(api.readFailures().some((row) => row.reason === 'provider unavailable'));
    available = true; availability(true); await immediate(); equal(requests.length, 0);
    await assert.rejects(result.readField('eventOnly', 200), /no watched getter/); assertions++;
}

async function mainFlow() {
    async function run(id8, original) {
        const folder = original ? OLDAPP : APP, timer = clock(), f = fixture(), sent = [], logs = [], visibleHandlers = [], watches = {};
        Object.assign(f.values, { hudOn: true, clusterOn: true, bothMode: 'map', autoStart: true, demo: 'off', rpmPoll: false, _settingsV: f.L.SETTINGS_V });
        let visible = false, killed = false, impl, provider = true;
        const settings = { schema: f.spec.settings, get: f.get, set(k, v) { f.values[k] = v; }, cycle() {}, onChange() {} };
        const app = new EventEmitter();
        const ui = { id8, isVisible: () => visible, onVisible(fn) { visibleHandlers.push(fn); }, onClick() {}, onFocus() {}, image() {}, open() {} };
        const values = { statusEngineSpeed2: { actualValueRPMEngineCrankshaft: 24000 }, statusEngineTemperature: { temperatureEngineOilDrive: 148, temperatureEngineDrive: 140 } };
        const signals = { readFailures: () => [], watch(iface, instance, handlers) {
            const sub = { available: true, availabilityGeneration: 1, proxy: { isAvailable: () => provider, getValue: async (field) => values[field] },
                readField(field, timeout, accept) { return Promise.resolve().then(() => { if (accept()) handlers[field](values[field]); return values[field]; }); } };
            watches[iface] = { handlers, sub }; return Promise.resolve(sub);
        } };
        const Car = load(path.join(PORT, 'kit/runtime/car.js'), { './sim': class { sample() { return {}; } step() {} } }, timed(timer));
        const dependencies = {
            fs: { existsSync: () => killed }, './kit/mgu': { run(value) { impl = value; } }, './kit/car': Car,
            './logic': require(path.join(folder, 'logic')), './config': require(path.join(folder, 'config')),
            './safety': require(path.join(folder, 'safety')),
            './output': { createOutput() { return { apply: (a) => sent.push(plain(a)), status: () => ({ proof: { link: 'none', layers: [], targets: {}, status: null } }), rebuild() {}, requestStatus() {} }; } },
            './rpmpoll': load(path.join(folder, 'rpmpoll.js'), {}, timed(timer)),
            './cluster_render_client': { ClusterRender: class { constructor() { throw new Error('unexpected native client'); } } },
            './kit/canvas': { Canvas: class {} }, './ui': { createUi: () => ({ page: () => 0, draw() {}, tab() {} }) },
            './hudcheck': require(path.join(folder, 'hudcheck')), './pages': require(path.join(folder, 'pages')),
        };
        if (!original) dependencies['./id8_signals'] = load(path.join(APP, 'id8_signals.js'), {}, timed(timer));
        load(path.join(folder, 'main.js'), dependencies, timed(timer));
        await impl.start({ ui, settings, signals, app, spec: f.spec, dataDir: '/fake', theme: () => ({}), canvas: () => ({ clear() { return this; } }),
            log: { info: (line) => logs.push(line), warn: (line) => logs.push(line), error: (line) => logs.push(line) } });
        await timer.advance(0);
        const CDS = 'de.bmw.infotainment.vehicle.CDS';
        watches[CDS].handlers.statusEngineTemperature(values.statusEngineTemperature);
        watches[CDS].handlers.statusEngineSpeed2(values.statusEngineSpeed2);
        await timer.advance(0);
        return { timer, sent, logs, watches, CDS, values, app, settings,
            async open() { visible = true; visibleHandlers.forEach((fn) => fn('MAIN', true)); await timer.advance(0); },
            async lose() { provider = false; watches[CDS].sub.available = false; watches[CDS].sub.availabilityGeneration++; await timer.advance(100); },
            async kill() { killed = true; await timer.advance(1100); } };
    }
    const id8 = await run(true, false);
    check(!id8.sent.some((a) => a.active), 'real main blocks ID8 output before first open despite saved autostart=true');
    await id8.open(); check(id8.sent.some((a) => a.active), 'real main enables after open and fresh readings: ' + JSON.stringify({ logs: id8.logs, last: id8.sent.slice(-2) }));
    id8.watches[id8.CDS].handlers.statusEngineSpeed2({ actualValueRPMEngineCrankshaft: 65535 });
    await id8.timer.advance(0); check(!id8.sent[id8.sent.length - 1].active, 'invalid raw RPM cannot reuse Car cached RPM');
    id8.watches[id8.CDS].handlers.statusEngineSpeed2(id8.values.statusEngineSpeed2); await id8.timer.advance(0);
    check(id8.sent[id8.sent.length - 1].active);
    id8.watches[id8.CDS].handlers.statusEngineTemperature({ temperatureEngineOilDrive: 255 }); await id8.timer.advance(0);
    check(!id8.sent[id8.sent.length - 1].active, 'invalid oil cannot reuse the warm-oil limit');
    id8.watches[id8.CDS].handlers.statusEngineTemperature(id8.values.statusEngineTemperature); await id8.timer.advance(0);
    check(id8.sent[id8.sent.length - 1].active);
    await id8.lose(); check(!id8.sent[id8.sent.length - 1].active, 'provider loss stops without a new Car sample');
    id8.app.emit('shutdown'); check(!id8.sent[id8.sent.length - 1].active);
    const killed = await run(true, false); await killed.open(); await killed.kill(); check(!killed.sent[killed.sent.length - 1].active);
    const old = await run(false, true), id7 = await run(false, false);
    check(old.sent.some((a) => a.active) && id7.sent.some((a) => a.active), 'ID7 autostart still works before opening');
    equal(id7.sent, old.sent, 'real ID7 main produces the original output decisions');
    check(!id8.logs.some((line) => /^start:/.test(line)), 'real main must not silently fail its start');
    const pages = require(path.join(APP, 'pages')), f = fixture();
    const model = { get: f.get, schema: f.spec.settings, cfg: f.cfg, id8: true };
    const view = pages.view(pages.IDS.indexOf('behavior'), model), row = view.rows.find((r) => r.id === 'autoStart');
    equal(row.kind, 'info'); equal(row.controls, []); check(/Open Shift Lights/.test(row.desc));
}

async function settingsAndBackground() {
    const spec = fixture().spec;
    const lifecycle = require(path.join(PORT, 'kit/runtime/id8_lifecycle'));
    async function start(id8, noRhmi) {
        const events = [], writes = [], cells = [], components = {}, descriptor = { application: { entryPoints: [{ uuid: 'fixture-entry', textId: 'fixture-title' }] } };
        for (const name of ['MAIN', 'MAIN_GFX', 'SETTINGS'].concat(spec.settings.map((s) => 'SET_' + s.key.toUpperCase()))) {
            const c = components[name] = new EventEmitter();
            c._uiDescription = { type: name === 'SET_AUTOSTART' && id8 ? 'label' : 'button', rows: [] };
            c.getId = () => name === 'MAIN' ? 1 : 9;
            c.setValue = async (...args) => cells.push([name, ...args]); c.updateResources = async () => {}; c.setRowSelected = async () => {};
        }
        if (id8) components.KIT_HMI_ID8 = {};
        const rhmi = new EventEmitter(); Object.assign(rhmi, { getByName: (name) => components[name], mapEntryState: async () => {}, openEntryState: async () => {}, openState: async () => {}, closeState: async () => {} });
        class OnlineApp extends EventEmitter {
            constructor() { super(); this.rhmiApplication = noRhmi ? null : rhmi; this.startReason = noRhmi ? 'BACKGROUND' : 'ENTRY_POINT'; this.appDescription = descriptor; }
            async start() { this.emit('appStatusProxyReady'); } async registerActive() {} async initialized() { events.push('initialized'); }
            getVisibilityData() { return { reason: this.startReason }; } getEntryPoints() { return []; }
            getLastExecutedEntryPointUuid() { return 'fixture-entry'; } async registerHmiVisible() {} async unregisterHmiVisible() {}
        }
        const fsDouble = { existsSync: () => false, readdirSync: () => [], appendFileSync() {}, writeFileSync(file, content) { writes.push([file, content]); },
            readFileSync(file) { if (file.endsWith('app-spec.json')) return JSON.stringify(Object.assign({}, spec, { stateIds: { MAIN: 1, SETTINGS: 9 } }));
                if (file.endsWith('application.json')) return JSON.stringify(descriptor); if (file.endsWith('settings.json')) return '{"autoStart":true}'; throw new Error('fixture absent'); } };
        const logger = { info: (text) => events.push(text), warn() {}, error() {}, debug() {} };
        const api = load(path.join(PORT, 'kit/runtime/mgu.js'), { fs: fsDouble, path,
            'oap-sdk': { OnlineApp, logging: { getSDKLogger: () => logger } }, 'oap-sdk/package.json': { version: id8 ? '50.0.0' : '27.0.0' },
            './themes': { theme: () => ({}) }, './display': { Display: class { constructor() { this.sheet = null; } onTick() {} openSheet() { return false; } label() {} } },
            './hmi-text': { HmiText: class { set(c, name, row, cell, value) { cells.push([name, cell, value]); return Promise.resolve(); } } },
            './sheet': { listSheet: () => ({}) }, './signals': { allowTyped() {}, readFailures: () => [] }, './id8_lifecycle': lifecycle });
        const ctx = await api.run({ start: async () => events.push('impl-start') }); await settle();
        return { api, ctx, events, writes, components, cells };
    }
    const background = await start(true, true);
    check(!background.events.includes('impl-start')); check(background.events.some((text) => /open the app after each/.test(text)));
    const foreground = await start(true, false); check(foreground.events.includes('impl-start'));
    equal(foreground.ctx.settings.get('autoStart'), false);
    const before = foreground.writes.length;
    foreground.ctx.settings.set('autoStart', true); foreground.ctx.settings.cycle('autoStart');
    foreground.components.SET_AUTOSTART.emit('action', {}); await settle();
    equal(foreground.ctx.settings.get('autoStart'), false); equal(foreground.writes.length, before);
    check(foreground.cells.some((row) => row[0] === 'SET_AUTOSTART' && row[1] === 'Text' && /after each/.test(row[2])));
    const id7 = await start(false, false); equal(id7.ctx.settings.get('autoStart'), true);
    id7.ctx.settings.cycle('autoStart'); equal(id7.ctx.settings.get('autoStart'), false);
}

const groups = { geometry, output, signals: async () => { await signalGate(); await watchedGetterBridge(); await typedWatchedGetterBridge(); }, main: mainFlow, startup: settingsAndBackground };
(async () => {
    assert.ok(groups[GROUP], 'select a known offline group');
    await groups[GROUP]();
    console.log('PASS Shiftlights ID8 ' + GROUP + ': ' + assertions + ' assertions; no target/SDK/socket execution');
})().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
