'use strict';
/* All SDK, file, renderer, signal and transport objects below are local fakes.
 * No application main.js, SDK, installer, vehicle method or socket is executed. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');
const PORT = path.resolve(process.argv[2]);
const ORIGINAL = path.resolve(process.argv[3]);
const trace = [];
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { await tick(); await tick(); await tick(); }
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
function load(file, dependencies, globals) {
    const box = Object.assign({ module: { exports: {} }, Buffer, console, Promise,
        process: { env: {}, cwd: () => '/fake/data', on() {}, memoryUsage: () => ({ rss: 0 }), exit() { throw new Error('unexpected process exit'); } },
        setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
        require(name) { if (!(name in dependencies)) throw new Error('unapproved module ' + name); return dependencies[name]; },
        __dirname: path.dirname(file) }, globals || {});
    box.global = box;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), box, { filename: file, timeout: 2000 });
    return box.module.exports;
}

async function displayAndRenderer() {
    const timers = [];
    const { Display } = load(path.join(PORT, 'kit/runtime/display.js'), {
        './record': { Recorder: class { textWidth(s) { return s.length * 10; } }, play() {} },
        './canvas': { Canvas: class {} }, './renderd': { RenderClient: class {} },
        './gauges': {}, './credits': { drawCredit() {} }
    }, { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} });
    function display(id8, screen, area, layout) {
        const events = [], visibility = { MAIN: true, SETTINGS: false };
        const d = Object.create(Display.prototype);
        Object.assign(d, { ui: { id8, isVisible: (name) => visibility[name], hasFocus: () => true },
            settings: { get: () => layout || 'full' }, log: quiet,
            gpu: { ready: true, native: true, touch: true, info: { controller: true }, screen, area,
                place(p) { events.push(['place', plain(p)]); }, show(v) { events.push(['show', v]); this.visible = v; },
                grab(v) { events.push(['grab', v]); }, claim(v) { events.push(['claim', plain(v)]); } },
            screen: { name: 'MAIN', buttons: [] }, blocked: false,
            recorders: new Map(), layoutHandlers: [], tickHandlers: [],
            ownHidden: new Set(), labels: {}, _lost() { events.push(['lost']); }, _grab() {}, _hmiBar() {} });
        return { d, events, visibility };
    }
    let t = display(true, { w: 2880, h: 960 }, null, 'standard');
    assert.strictEqual(t.d.layout(), 'full'); t.d._place();
    assert.deepStrictEqual(plain({ x: t.d.place.x, y: t.d.place.y, w: t.d.place.w, h: t.d.place.h }), { x: 0, y: 76, w: 2880, h: 764 });
    t = display(true, { w: 3000, h: 1100 }, { x: 100, y: 90, w: 2700, h: 820 });
    t.d._place(); assert.strictEqual(t.d.place.x, 100); assert.strictEqual(t.d.place.w, 2700);
    t.d.headEnd = 2700;
    t.d._claimTabs([], null);
    const claims = t.events.filter((x) => x[0] === 'claim').pop()[1];
    // Touch rectangles are in logical coordinates: transform them back into local pixels.
    for (const c of claims) { assert.ok(c.x * t.d.place.scale + t.d.place.ox >= -0.001); assert.ok((c.x + c.w) * t.d.place.scale + t.d.place.ox <= 2700.001); }
    t = display(true, { w: 3000, h: 1100 }, { x: -1, y: 90, w: 2700, h: 820 });
    t.d._place(); assert.strictEqual(t.d.place, null); t.d._syncVisible();
    assert.ok(!t.events.some((x) => x[0] === 'show' && x[1]));
    t = display(true, { w: 2880, h: 960 }, null); t.d.gpu.touch = false;
    t.d._place(); assert.strictEqual(t.d.place, null); t.d._syncVisible();
    assert.ok(!t.events.some((x) => x[0] === 'show' && x[1]));
    t = display(true, { w: 2880, h: 960 }, null); t.d._place(); t.d._syncVisible();
    t.visibility.MAIN = false; timers.splice(0).forEach((fn) => fn());
    assert.ok(!t.events.some((x) => x[0] === 'show' && x[1]));
    t.visibility.MAIN = true; t.visibility.SETTINGS = true;
    assert.strictEqual(t.d._shown(), false); assert.strictEqual(t.d.active(), false);
    t.visibility.SETTINGS = false; t.d.ui.hasFocus = () => false;
    assert.strictEqual(t.d._shown(), false);
    t.d.ui.hasFocus = () => true; t.d.signalBlocked = true; t.d._syncVisible(); assert.strictEqual(t.d.active(), false);
    t.d.signalBlocked = false; t.d.gpu.info.controller = false; t.d.grabbing = true;
    Display.prototype._grab.call(t.d);
    assert.deepStrictEqual(t.events[t.events.length - 1], ['grab', false]);
    t = display(false, { w: 1920, h: 720 }, null, 'standard'); t.d._place();
    assert.deepStrictEqual(plain(t.d.place), { x: 124, y: 82, w: 1600, h: 520, scale: 1, ox: 0, oy: 0, full: false });
    t = display(false, { w: 1920, h: 720 }, null, 'full'); t.d._place();
    assert.strictEqual(t.d.place.w, 1920); assert.strictEqual(t.d.place.h, 720);
    let socket;
    const { RenderClient } = load(path.join(PORT, 'kit/runtime/renderd.js'), {
        net: { createConnection() { socket = new EventEmitter(); socket.write = () => true; return socket; } },
        fs: { statSync() { return { isSocket: () => true }; } }, events: EventEmitter, './record': {}
    });
    const client = new RenderClient('fixture_app', quiet, { native: true });
    function ready(length, area) {
        const b = Buffer.alloc(8 + length); b.writeUInt32LE(0x4d520101, 0); b.writeUInt32LE(length, 4); b.writeUInt32LE(7, 16);
        if (area) [area.x, area.y, area.w, area.h].forEach((value, i) => b.writeInt32LE(value, 36 + 4 * i));
        client._data(b);
    }
    ready(44, { x: 100, y: 90, w: 2700, h: 820 });
    assert.deepStrictEqual(plain(client.area), { x: 100, y: 90, w: 2700, h: 820 });
    ready(12); assert.strictEqual(client.area, null);
    ready(44, { x: -20, y: 90, w: 2700, h: 820 }); assert.strictEqual(client.area.x, -20);
    client.connect(); socket.emit('connect'); assert.strictEqual(client.area, null);
    trace.push('geometry, foreground guards, touch claims, renderer frame and reconnect');
}

async function lifecycleAndSettings() {
    const helper = load(path.join(PORT, 'kit/runtime/id8_lifecycle.js'), {});
    const calls = [], warnings = [];
    const ep = { uuid: 'fixture-entry', textId: 'fixture-title', icon: 'fixture.png' };
    const main = { updateResources: async () => calls.push('resources') };
    const wrapper = { getDescription: () => ep, init: async () => calls.push('init'),
        entryPoint: { setText: async () => calls.push('text'), setIcon: async () => calls.push('icon') },
        setAvailability: async (v) => calls.push(v) };
    await helper.entryPoints({ appDescription: { application: { entryPoints: [ep] } }, getEntryPoints: () => [wrapper] },
        { mapEntryState: async () => calls.push('map') }, main, [], { warn: (m) => warnings.push(m) });
    assert.deepStrictEqual(calls, ['resources', 'init', 'map', 'text', 'icon', 'ENABLED']);
    calls.length = 0;
    await helper.entryPoints({ getEntryPoints: () => [{ getDescription: () => ({ uuid: 'unrelated' }) }] },
        { mapEntryState: async (id) => calls.push(id) }, main, ['fixture-entry'], quiet);
    assert.deepStrictEqual(calls, ['resources', 'fixture-entry']);
    for (const v of [false, 0, '0', 'false', undefined]) assert.strictEqual(helper.truth(v), false);
    for (const v of [true, 1, '1', 'true']) assert.strictEqual(helper.truth(v), true);
    assert.strictEqual(helper.foreground({ startReason: 'CONFIG_STATE' }), false);
    assert.strictEqual(helper.foreground({ startReason: 'LUM' }), true);

    async function runtime(id8, sdkVersion, reason, noRhmi) {
        const events = [], cells = [], actions = {}, entries = {};
        const spec = { id: 'fixture_app', version: '0.2.0', title: 'Fixture', screens: [{ name: 'MAIN', kind: 'canvas' }],
            settings: [{ key: 'flag', label: 'Flag', type: 'bool', default: false },
                { key: 'choice', label: 'Choice', type: 'choice', default: 'a', options: [['a', 'A'], ['b', 'B']] }] };
        const desc = { application: { entryPoints: [ep] } };
        const components = {};
        for (const name of ['MAIN', 'SETTINGS', 'SET_FLAG', 'SET_CHOICE', 'BTN_SETTINGS', 'LABEL', 'EMPTY_LABEL', 'MAIN_GFX']) {
            const component = components[name] = new EventEmitter();
            component._uiDescription = { type: ['LABEL', 'EMPTY_LABEL', 'MAIN_GFX'].includes(name) ? 'label' : 'button', rows: name === 'LABEL' ? [{ Text: {} }] : name === 'EMPTY_LABEL' ? [{}] : [{ PrimaryText: {}, FrequencyText: {} }] };
            component.updateResources = async () => events.push('resources:' + name);
            component.setValue = async (...args) => cells.push([name, ...args]);
            component.getId = () => name === 'MAIN' ? 1 : 11;
        }
        if (id8) components.KIT_HMI_ID8 = {};
        const rhmi = new EventEmitter();
        Object.assign(rhmi, { getByName: (name) => components[name], mapEntryState: async () => events.push('map'),
            openEntryState: async () => events.push('open'), openState: async () => {}, closeState: async () => {} });
        let app;
        class OnlineApp extends EventEmitter {
            constructor() { super(); app = this; this.rhmiApplication = noRhmi ? null : rhmi; this.startReason = reason; this.appDescription = desc; }
            async start() { this.emit('appStatusProxyReady'); events.push('start'); }
            async registerActive() { events.push('active'); }
            async initialized() { events.push('initialized'); }
            getVisibilityData() { return { reason }; }
            getLastExecutedEntryPointUuid() { return 'fixture-entry'; }
            getEntryPoints() { return [{ getDescription: () => ep, init: async () => events.push('init'),
                entryPoint: { setText: async () => {}, setIcon: async () => {} }, setAvailability: async () => events.push('available') }]; }
            async registerHmiVisible() {} async unregisterHmiVisible() {}
        }
        const fakeFs = { existsSync: () => false, readdirSync: () => [], appendFileSync() {}, writeFileSync() {},
            readFileSync(file) { if (file.endsWith('app-spec.json')) return JSON.stringify(spec); if (file.endsWith('application.json')) return JSON.stringify(desc); throw new Error('fixture absent'); } };
        const code = fs.readFileSync(path.join(PORT, 'kit/runtime/mgu.js'), 'utf8') + '\nmodule.exports.Ui = Ui; module.exports.runInner = runInner;';
        const logger = { info() {}, warn() {}, error() {}, debug() {} };
        let failures = [];
        const signals = { allowTyped(on) { events.push('typed:' + on); }, readFailures() { return failures; } };
        const dependencies = { fs: fakeFs, path, 'oap-sdk': { OnlineApp, logging: { getSDKLogger: () => logger } }, 'oap-sdk/package.json': { version: sdkVersion },
            './themes': { theme: () => ({}) }, './display': { Display: class { constructor() { this.sheet = null; } onTick() {} openSheet() { return false; } label() {} _syncVisible() { events.push('sync:' + this.signalBlocked); } _grab() {} _hmiBar() {} present() { events.push('present'); return Promise.resolve(); } } },
            './hmi-text': { HmiText: class { set(c, name, row, cell, value) { cells.push([name, cell, value]); return Promise.resolve(); } } },
            './sheet': { listSheet: () => ({}) }, './signals': signals, './id8_lifecycle': helper };
        const box = { module: { exports: {} }, Buffer, Promise, console, __dirname: '/fake/source/javascript/kit',
            require(name) { if (!(name in dependencies)) throw new Error('unapproved module ' + name); return dependencies[name]; },
            process: { env: {}, cwd: () => '/fake/data', on() {}, memoryUsage: () => ({ rss: 0 }), exit() { throw new Error('exit'); } },
            setTimeout, clearTimeout, setInterval, clearInterval, setImmediate };
        box.global = box; vm.runInNewContext(code, box, { timeout: 2000 });
        const ctx = await box.module.exports.runInner({ start: async () => events.push('app-start-fixture') });
        await settle();
        return { ctx, app, events, cells, components, rhmi, setFailures(value) { failures = value; }, exports: box.module.exports };
    }
    let r = await runtime(true, '50.0.0', 'ENTRY_POINT', false);
    assert.ok(r.events.indexOf('resources:MAIN') < r.events.indexOf('init'));
    assert.ok(r.events.indexOf('init') < r.events.indexOf('map'));
    assert.ok(r.events.indexOf('active') < r.events.indexOf('initialized'));
    assert.ok(r.events.indexOf('initialized') < r.events.indexOf('open'));
    assert.ok(r.events.includes('typed:true'));
    r.components.SET_FLAG.emit('action', {}); r.components.SET_CHOICE.emit('action', {}); await settle();
    assert.strictEqual(r.ctx.settings.get('flag'), true); assert.strictEqual(r.ctx.settings.get('choice'), 'b');
    assert.ok(r.cells.some((x) => x[0] === 'SET_FLAG' && x[1] === 'PrimaryText'));
    assert.ok(r.cells.some((x) => x[0] === 'SET_FLAG' && x[1] === 'FrequencyText'));
    await r.ctx.ui.text('LABEL', 'native label'); assert.ok(r.cells.some((x) => x[0] === 'LABEL' && x[1] === 'Text'));
    await r.ctx.ui.text('EMPTY_LABEL', 'empty native label'); assert.ok(r.cells.some((x) => x[0] === 'EMPTY_LABEL' && x[1] === 'Text'));
    await r.ctx.ui.checked('SET_FLAG', true); assert.ok(!r.cells.some((x) => x.includes('eParam_RowSelected')));
    await r.ctx.ui._image('MAIN_GFX', { unexpected: true }); // would throw if ID7 Graphic code were entered
    assert.ok(r.cells.some((x) => x[0] === 'MAIN_GFX' && x[1] === 'Text' && /renderer/.test(x[2])));
    r.setFailures([{ iface: 'fixture.Typed', field: 'sample', reason: 'unavailable' }]);
    await r.ctx.ui.image('MAIN_GFX', {});
    assert.strictEqual(r.ctx.display.signalBlocked, true); assert.ok(r.cells.some((x) => x[0] === 'MAIN_GFX' && /previous values are hidden/.test(x[2])));
    assert.ok(!r.events.includes('present'));
    r.setFailures([]); await r.ctx.ui.image('MAIN_GFX', {}); assert.strictEqual(r.ctx.display.signalBlocked, false); assert.ok(r.events.includes('present'));
    r.components.SETTINGS.emit('visible', { visible: '1' });
    r.rhmi.emit('applicationStackChanged', { ROOT_APP: [] });
    assert.strictEqual(r.ctx.ui.isVisible('SETTINGS'), true);
    r.components.MAIN.emit('focus', { focus: 'false' }); assert.strictEqual(r.ctx.ui.hasFocus('MAIN'), false);
    r.app.emit('changeVisibility', { visible: 'false' }); assert.strictEqual(r.ctx.ui.isVisible('MAIN'), false); assert.strictEqual(r.ctx.ui.isVisible('SETTINGS'), false);
    r = await runtime(true, '50.0.0', 'CONFIG_STATE', false);
    assert.ok(r.events.includes('initialized')); assert.ok(!r.events.includes('active')); assert.ok(!r.events.includes('open'));
    r = await runtime(true, '50.0.0', 'CONFIG_STATE', true);
    assert.strictEqual(r.ctx, undefined); assert.deepStrictEqual(r.events, ['start', 'initialized']);
    r = await runtime(false, '50.0.0', 'ENTRY_POINT', false);
    assert.ok(r.events.includes('active')); assert.ok(r.events.includes('typed:false'));
    r = await runtime(false, '24.0.0', 'ENTRY_POINT', false);
    assert.ok(r.events.indexOf('active') < r.events.indexOf('initialized')); assert.ok(r.events.includes('open'));
    trace.push('entry lifecycle, actual runInner, settings, marker override, no RHMI and no Graphic');
}

async function signals() {
    function signalModule(folder, native, configs, builders, options) {
        const logs = [], polls = [];
        const dependencies = { fs: { readFileSync(file) { if (!configs) throw new Error('fixture missing'); return JSON.stringify({ fields: { sample: { getter: true } } }); } }, path };
        if (native) dependencies.someip = native;
        if (builders) dependencies['oap-sdk'] = { someipBuilders: builders };
        const api = load(path.join(folder, 'kit/runtime/signals.js'), dependencies, {
            Date: options && options.now ? { now: options.now } : Date,
            setInterval(fn) { polls.push(fn); return polls.length; }, clearInterval() {},
            setTimeout(fn, ms) { return setTimeout(fn, Math.min(ms, options && options.timeout || 50)); }, clearTimeout
        });
        return { api, polls, logs, logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) } };
    }
    async function raw(folder) {
        const calls = [], values = []; let availability, notify;
        const proxy = { init: async () => calls.push('init'), getValue: async () => { calls.push('get'); return { sample: 3 }; },
            subscribeToAvailability(fn) { calls.push('availability'); availability = fn; },
            subscribe: async (o) => { calls.push('subscribe:' + o.name); notify = o.onReceive; }, isAvailable: () => true,
            callMethod: async (name, struct, timeout) => { calls.push(['method', name, plain(struct), timeout]); return { ok: true }; },
            shutdown: async () => calls.push('shutdown') };
        const s = signalModule(folder, { buildProxy: async (cfg, instance) => { calls.push(['build', instance]); return proxy; } }, true, { buildAndInitTypedProxy() { throw new Error('raw must remain preferred'); } });
        if (s.api.allowTyped) s.api.allowTyped(true, s.logger);
        const sub = await s.api.watch('fixture.Interface', 1, { sample: (v) => values.push(v) }, s.logger, { pollMs: 10 }); await settle();
        assert.strictEqual(sub.available, true); availability(false); assert.strictEqual(sub.available, false);
        notify({ sample: 7 }); availability(true); await settle(); s.polls[0](); await settle();
        await s.api.call(proxy, 'sampleMethod', { sample: 9 }, 42); await sub.shutdown();
        return { calls, values };
    }
    assert.deepStrictEqual(await raw(PORT), await raw(ORIGINAL));
    let availability, notify, notifyOther, clock = 1000, fail = false, calls = [], value = { sample: 4 }, getterHits = 0;
    const px = { sample: { subscribe(fn) { notify = fn; }, getValue() { getterHits++; return fail ? Promise.reject(new Error('fixture stale read')) : Promise.resolve(value); },
            setValue(v) { calls.push(['set', v]); } },
        other: { subscribe(fn) { notifyOther = fn; }, getValue: async () => ({ other: 2 }) },
        sampleMethod(struct) { calls.push(['method', struct]); return { accepted: struct }; },
        subscribeToAvailability(fn) { availability = fn; }, isAvailable: () => true, shutdown() { calls.push(['shutdown']); } };
    const s = signalModule(PORT, null, false, { buildAndInitTypedProxy: async (iface, instance, options) => { calls.push(['build', iface, instance, options]); return px; } }, { now: () => clock });
    s.api.allowTyped(true, s.logger);
    const got = [], sub = await s.api.watch('fixture.Typed', 2, { sample: (v) => got.push(v), other() {} }, s.logger, { pollMs: 10 }); await settle();
    assert.strictEqual(sub.available, true); assert.strictEqual(sub.error, null); assert.ok(got.length > 0);
    assert.strictEqual(s.api.backends()['fixture.Typed'], 'typed');
    assert.deepStrictEqual(plain(calls[0]), ['build', 'fixture.Typed', '2', { timeoutMs: 10000 }]);
    availability(false); assert.strictEqual(sub.available, false);
    const before = getterHits; s.polls[0](); await settle(); assert.strictEqual(getterHits, before);
    availability(true); await settle(); assert.strictEqual(sub.available, true);
    fail = true; s.polls[0](); await settle(); assert.strictEqual(sub.available, false); assert.match(sub.error, /fixture stale read/);
    assert.ok(s.logs.some((m) => /fixture stale read/.test(m)));
    notifyOther({ other: 3 }); assert.strictEqual(sub.available, false); assert.ok(s.api.readFailures().some((x) => x.field === 'sample'));
    fail = false; s.polls[0](); await settle(); assert.strictEqual(sub.available, true); assert.strictEqual(sub.error, null);
    clock += 31; assert.ok(s.api.readFailures().some((x) => /three polling/.test(x.reason))); assert.strictEqual(sub.available, false);
    notifyOther({ other: 4 }); assert.ok(s.api.readFailures().some((x) => x.field === 'sample'));
    notify({ sample: 5 }); assert.strictEqual(s.api.readFailures().length, 0);
    const struct = { request: { bytes: [7, 8] } };
    const result = await s.api.call(sub.proxy, 'sampleMethod', struct, 200);
    assert.strictEqual(calls.find((c) => c[0] === 'method')[1], struct); assert.strictEqual(result.accepted, struct);
    await s.api.set(sub.proxy, 'sample', struct); assert.strictEqual(calls.find((c) => c[0] === 'set')[1], struct);
    await assert.rejects(s.api.call(sub.proxy, 'absentMethod', {}), /no method/);
    await sub.shutdown(); assert.ok(calls.some((c) => c[0] === 'shutdown'));
    const blocked = signalModule(PORT, null, false, { buildAndInitTypedProxy() { throw new Error('ID7 cannot use typed'); } });
    assert.match((await blocked.api.watch('fixture.Blocked', 1, {}, blocked.logger)).error, /native module/);
    const missing = signalModule(PORT, null, false, {}); missing.api.allowTyped(true, missing.logger);
    const missingSub = await missing.api.watch('fixture.Missing', 1, {}, missing.logger);
    assert.strictEqual(missingSub.available, false); assert.match(missingSub.error, /buildAndInitTypedProxy/);
    assert.ok(missing.logs.some((m) => /none:/.test(m)));
    const noFields = signalModule(PORT, null, false, { buildAndInitTypedProxy: async () => ({}) }); noFields.api.allowTyped(true);
    const noFieldSub = await noFields.api.watch('fixture.NoFields', 1, { sample() {} }, noFields.logger); await settle();
    assert.strictEqual(noFieldSub.available, false); assert.match(noFieldSub.error, /no sample/);
    const slow = signalModule(PORT, null, false, { buildAndInitTypedProxy: () => new Promise(() => {}) }, { timeout: 10 }); slow.api.allowTyped(true);
    assert.match((await slow.api.watch('fixture.Slow', 1, {}, slow.logger)).error, /no answer/);
    trace.push('raw equivalence, typed API and fields, struct pass-through, unavailable/failure/recovery and bounded timeout');
}
(async () => {
    await displayAndRenderer(); await lifecycleAndSettings(); await signals();
    console.log('PASS pinguino ID8 sandbox contracts: ' + trace.join('; '));
})().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
