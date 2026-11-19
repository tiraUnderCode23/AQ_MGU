'use strict';
// Inert tests: no SDK, native binding, socket, installer or vehicle service is loaded.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = process.argv[2], scenario = process.argv[3];
const port = path.join(root, 'apps/_ports/arefahmad-idrive8');
const flush = async () => { for (let i = 0; i < 35; i++) await new Promise(setImmediate); };
function clock() {
    let next = 1;
    const c = { now: 1700000000000, timers: new Map(), intervals: new Map() };
    c.Date = class extends Date { static now() { return c.now; } };
    c.setTimeout = (fn, ms) => { const id = next++; c.timers.set(id, { fn, ms }); return id; };
    c.clearTimeout = (id) => c.timers.delete(id);
    c.setInterval = (fn, ms) => { const id = next++; c.intervals.set(id, { fn, ms }); return id; };
    c.clearInterval = (id) => c.intervals.delete(id);
    c.poll = () => Array.from(c.intervals.values()).forEach((v) => v.fn());
    return c;
}
function load(file, dependencies, c) {
    const module = { exports: {} };
    const context = {
        module, exports: module.exports, __dirname: path.dirname(file), Buffer, Set, Map, Promise,
        Date: c.Date, setImmediate, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout,
        setInterval: c.setInterval, clearInterval: c.clearInterval,
        require(name) {
            if (!Object.prototype.hasOwnProperty.call(dependencies, name)) throw new Error('Forbidden import: ' + name);
            const value = dependencies[name];
            if (value instanceof Error) throw value;
            return value;
        },
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return module.exports;
}
const log = { info() {}, warn() {}, error(message) { throw new Error('App error: ' + message); } };

async function adapter() {
    const c = clock(), traces = [], availability = {}, events = {}, values = {}, fail = {}, stopped = [];
    const sdk = { someipBuilders: { async buildAndInitTypedProxy(iface, instance) {
        traces.push(['typed', iface, instance]);
        return {
            status: {
                subscribe(fn) { events[instance] = fn; },
                getValue() { if (fail[instance]) return Promise.reject(new Error('fixture read failure')); return Promise.resolve(values[instance]); },
                setValue() { throw new Error('Forbidden write'); },
            },
            isAvailable() { return true; },
            subscribeToAvailability(fn) { availability[instance] = fn; },
            shutdown() { stopped.push(instance); },
        };
    } } };
    const dependencies = {
        fs: { readFileSync() { return JSON.stringify({ interfaces: {
            Parent: { fields: { parent: {} } }, Example: { extends: 'Parent', fields: { status: {} } },
        }, instanceIDs: { Example: { one: 1, two: 2 } } }); } },
        './signals': { loadConfig() { throw new Error('no raw config'); } },
        someip: new Error('no native binding'), 'oap-sdk': sdk,
    };
    const module = load(path.join(port, 'kit/runtime/readonly_signals.js'), dependencies, c);
    assert.throws(() => module.forHmi('ID7'), /loaded ID8/);
    const reader = module.forHmi('ID8');
    assert.deepStrictEqual(Object.keys(reader).sort(), ['loadConfig', 'readOnly', 'watch']);
    assert.deepStrictEqual(Object.keys(reader.loadConfig('Example').fields).sort(), ['parent', 'status']);
    let last;
    values.one = { value: 10 };
    const one = await reader.watch('Example', 'one', { status(v) { last = v.value; } }, log, { pollMs: 30000 });
    assert.strictEqual(one.available, false, 'proxy construction alone cannot mark data fresh');
    await flush();
    assert.strictEqual(last, 10); assert.strictEqual(one.available, true);
    assert.strictEqual(one.backend, 'typed'); assert.strictEqual(one.proxy, undefined);
    fail.one = true; c.poll(); await flush();
    assert.strictEqual(one.available, false); assert.match(one.error, /fixture read failure/);
    fail.one = false; values.one = { value: 11 }; c.poll(); await flush();
    assert.strictEqual(one.available, true); assert.strictEqual(last, 11);
    c.now += 90001; assert.strictEqual(one.fresh('status'), false);
    events.one({ value: 12 }); assert.strictEqual(one.fresh('status'), true);
    c.now -= 1; assert.strictEqual(one.fresh('status'), false, 'clock rollback cannot qualify cached data');
    c.now += 1; assert.strictEqual(one.fresh('status'), true);
    availability.one(false); assert.strictEqual(one.available, false);
    events.one({ value: 999 }); assert.strictEqual(last, 12, 'ignore values while provider says unavailable');
    fail.one = true; availability.one(true); await flush(); assert.strictEqual(one.available, false);
    fail.one = false; c.poll(); await flush(); assert.strictEqual(one.available, true);
    values.two = { value: 21 };
    const two = await reader.watch('Example', 'two', { status() {} }, log, { pollMs: 30000 });
    await flush(); availability.one(false);
    assert.strictEqual(two.available, true, 'availability is per interface instance');
    await one.shutdown(); const afterStop = last; events.one({ value: 222 });
    assert.strictEqual(last, afterStop); assert.strictEqual(one.available, false);
    await two.shutdown(); assert.strictEqual(c.intervals.size, 0);
    assert.deepStrictEqual(stopped, ['one', 'two']);

    // A generated raw definition and native binding remain preferred. Only read operations exist.
    const rawTrace = [], raw = {
        init() { rawTrace.push('init'); return Promise.resolve(); },
        isAvailable() { return true; }, subscribeToAvailability() {},
        subscribe(o) { rawTrace.push('subscribe:' + o.name); },
        getValue(field) { rawTrace.push('get:' + field); return Promise.resolve({ value: 33 }); },
        shutdown() { rawTrace.push('shutdown'); },
        callMethod() { throw new Error('Forbidden call'); }, setValue() { throw new Error('Forbidden write'); },
    };
    const rawReader = load(path.join(port, 'kit/runtime/readonly_signals.js'), Object.assign({}, dependencies, {
        './signals': { loadConfig() { return { fields: { status: { getter: {} } } }; } },
        someip: { buildProxy() { rawTrace.push('build'); return Promise.resolve(raw); } },
        'oap-sdk': new Error('Raw path must not request SDK'),
    }), c).forHmi('ID8');
    const rawSub = await rawReader.watch('Example', 'one', { status(v) { assert.strictEqual(v.value, 33); } }, log, { pollMs: 30000 });
    await flush(); assert.strictEqual(rawSub.available, true); assert.strictEqual(rawSub.backend, 'raw');
    await rawSub.shutdown(); assert.deepStrictEqual(rawTrace, ['build', 'init', 'subscribe:status', 'get:status', 'shutdown']);

    const noSdk = load(path.join(port, 'kit/runtime/readonly_signals.js'), Object.assign({}, dependencies, {
        'oap-sdk': {},
    }), c).forHmi('ID8');
    const absent = await noSdk.watch('Example', 'one', { status() {} }, log, { pollMs: 30000 });
    assert.strictEqual(absent.available, false); assert.match(absent.error, /SDK typed reader/);
    const missing = await reader.watch('Example', 'three', { absent() { throw new Error('No invented samples'); } }, log, { pollMs: 30000 });
    await flush(); assert.strictEqual(missing.available, false); assert.match(missing.error, /neither subscription nor getter/);
    await missing.shutdown();

    // An initialization timeout must also dispose a proxy which arrives later.
    let finishOpen, lateStopped = 0;
    const slow = load(path.join(port, 'kit/runtime/readonly_signals.js'), Object.assign({}, dependencies, {
        'oap-sdk': { someipBuilders: { buildAndInitTypedProxy() { return new Promise((resolve) => { finishOpen = resolve; }); } } },
    }), c).forHmi('ID8');
    const opening = slow.watch('Example', 'slow', { status() {} }, log, { pollMs: 30000 });
    await flush(); Array.from(c.timers.values()).filter((timer) => timer.ms === 15000).forEach((timer) => timer.fn());
    const timedOut = await opening; assert.strictEqual(timedOut.available, false); assert.match(timedOut.error, /timed out/);
    finishOpen({ shutdown() { lateStopped++; } }); await flush(); assert.strictEqual(lateStopped, 1);
}

async function carcare() {
    async function setup(id8) {
        const c = clock(), file = { recs: {}, odo: 100000 }, handlers = [], clicks = {}, visibility = { MAIN: true, SETTINGS: false };
        const visibilityFns = [], appEvents = {}, frames = [], warnings = [], settings = { units: 'metric' };
        const subscriptions = []; let entry, draw, writes = 0, widgets = 0, legacyCalls = 0, typedCalls = 0;
        const newReader = { watch(iface, instance, callback, logger, opts) {
            assert.strictEqual(iface, 'de.bmw.infotainment.KombiIF'); assert.strictEqual(instance, '1');
            assert.deepStrictEqual(Object.keys(callback), ['statusRangeTankStatus']); assert.strictEqual(opts.pollMs, 30000);
            const sub = { live: false, stopped: false, fresh() { return this.live && !this.stopped; }, shutdown() { this.stopped = true; return Promise.resolve(); } };
            handlers.push(callback); subscriptions.push(sub); return Promise.resolve(sub);
        } };
        const canvas = {
            clear() { frames.push([]); return this; },
            text(text) { frames[frames.length - 1].push(String(text)); return this; },
            textWidth(text, size) { return String(text).length * size * 0.5; },
            roundRect() { return this; },
        };
        const ctx = {
            dataDir: '/fixture', app: { on(event, fn) { appEvents[event] = fn; } },
            ui: { id8, onClick(id, fn) { clicks[id] = fn; }, text() {}, visible() {},
                isVisible(name) { return visibility[name]; }, onVisible(fn) { visibilityFns.push(fn); }, async image() {} },
            settings: { get(key) { return settings[key]; } }, log: { info() {}, warn(m) { warnings.push(m); }, error(m) { throw new Error(m); } },
            signals: { watch() { legacyCalls++; return newReader.watch.apply(newReader, arguments); } },
            theme() { return {}; }, canvas() { return canvas; }, display: null,
            onLayout() {}, loop(name, fps, fn) { draw = fn; }, spec: { startWidget: id8 ? null : {} },
        };
        load(path.join(port, 'apps/aref_carcare/main.js'), {
            fs: { readFileSync() { return JSON.stringify(file); }, writeFileSync(name, value) { Object.assign(file, JSON.parse(value)); writes++; } },
            path, './kit/mgu': { run(value) { entry = value; } },
            './items': require(path.join(port, 'apps/aref_carcare/care/items.js')),
            './kit/homewidget': { start() { widgets++; } },
            './kit/readonly_signals': { forHmi(hmi) { assert.strictEqual(hmi, 'ID8'); typedCalls++; return newReader; } },
        }, c);
        await entry.start(ctx); await flush();
        return { c, file, clicks, visibility, visibilityFns, appEvents, settings, subscriptions, handlers,
            draw: async () => { await draw(); return frames[frames.length - 1].join('\n'); },
            counts: () => ({ writes, widgets, legacyCalls, typedCalls }),
            receive(value) { const i = handlers.length - 1; subscriptions[i].live = true; handlers[i].statusRangeTankStatus(value); },
            async visible(on) { visibility.MAIN = on; visibilityFns.forEach((fn) => fn('MAIN', on)); await flush(); },
        };
    }
    const app = await setup(true);
    assert.deepStrictEqual(app.counts(), { writes: 0, widgets: 0, legacyCalls: 0, typedCalls: 1 });
    assert.match(await app.draw(), /last seen/);
    app.clicks.BTN_DONE(); app.clicks.BTN_DONE(); assert.strictEqual(app.file.recs.oil, undefined);
    app.receive({ mileageKilometre: 123456 });
    app.clicks.BTN_DONE(); assert.strictEqual(app.file.recs.oil, undefined, 'first tap only arms confirmation');
    app.clicks.BTN_DONE(); assert.strictEqual(app.file.recs.oil.km, 123456);
    const first = JSON.stringify(app.file.recs.oil);
    app.c.now += 90001; app.clicks.BTN_DONE(); app.clicks.BTN_DONE();
    assert.strictEqual(JSON.stringify(app.file.recs.oil), first); assert.match(await app.draw(), /last seen/);
    app.receive({ mileageKilometre: 124000 }); app.clicks.BTN_EARLIER(); app.clicks.BTN_KM_UP();
    app.subscriptions[0].live = false; app.clicks.BTN_SAVE(); assert.strictEqual(JSON.stringify(app.file.recs.oil), first);
    app.receive({ mileageKilometre: 124000 }); app.clicks.BTN_SAVE(); assert.strictEqual(app.file.recs.oil.km, 123000);
    app.settings.units = 'us'; app.clicks.BTN_EARLIER(); app.clicks.BTN_KM_UP2(); app.clicks.BTN_SAVE();
    assert.strictEqual(app.file.recs.oil.km, Math.round(124000 - 100 * 1.609344));
    const saved = JSON.stringify(app.file.recs.oil);
    app.clicks.BTN_EARLIER(); app.clicks.BTN_MO_UP(); app.clicks.BTN_CANCEL(); app.clicks.BTN_SAVE();
    assert.strictEqual(JSON.stringify(app.file.recs.oil), saved, 'cancel must not save');
    app.receive({ mileageKilometre: 16777215 }); app.clicks.BTN_DONE(); app.clicks.BTN_DONE();
    assert.strictEqual(JSON.stringify(app.file.recs.oil), saved, 'invalid signal cannot qualify cached mileage');
    await app.visible(false); assert.strictEqual(app.subscriptions[0].stopped, true);
    await app.visible(true); assert.strictEqual(app.subscriptions.length, 2);
    app.handlers[0].statusRangeTankStatus({ mileageKilometre: 1 }); assert.strictEqual(app.file.odo, 124000, 'late stopped callback ignored');
    app.receive({ mileageKilometre: 125000 }); assert.strictEqual(app.file.odo, 125000);
    app.visibilityFns.forEach((fn) => fn('MAIN', true));
    app.appEvents.shutdown(); await flush(); assert.strictEqual(app.subscriptions[1].stopped, true);
    assert.strictEqual(app.subscriptions.length, 2, 'queued visibility cannot reopen after shutdown');
    const id7 = await setup(false);
    assert.strictEqual(id7.counts().legacyCalls, 1); assert.strictEqual(id7.counts().typedCalls, 0); assert.strictEqual(id7.counts().widgets, 1);
    id7.receive({ mileageKilometre: 100001 }); id7.clicks.BTN_DONE(); id7.clicks.BTN_DONE();
    assert.strictEqual(id7.file.recs.oil.km, 100001);
}

async function nowplaying() {
    const c = clock(), iface = 'de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer';
    const fields = ['currentItemMetadata', 'currentItemTime', 'playerState', 'playbackSpeed'];
    const event = {}, provider = {}, state = {}, fail = {}, shutdowns = [], calls = [];
    ['CarPlayMedia', 'Bluetooth'].forEach((instance) => {
        event[instance] = {};
        state[instance] = {
            currentItemMetadata: [{ key: 'TITLE', value: { stringValue: instance + ' song' } }, { key: 'ARTIST', value: { stringValue: 'Fixture artist' } }],
            currentItemTime: { elapsed: 10000, total: 180000 },
            playerState: instance === 'CarPlayMedia' ? 'PLAYER_STATE_PLAY' : 'PLAYER_STATE_PAUSE', playbackSpeed: 1,
        };
    });
    const fileSystem = { readFileSync() { return JSON.stringify({ interfaces: {
        [iface]: { fields: fields.reduce((o, key) => { o[key] = {}; return o; }, {}) },
    }, instanceIDs: { [iface]: { CarPlayMedia: 1, Bluetooth: 2 } } }); } };
    const readers = load(path.join(port, 'kit/runtime/readonly_signals.js'), {
        fs: fileSystem, './signals': { loadConfig() { throw new Error('No generated raw definitions'); } },
        someip: new Error('No native binding'),
        'oap-sdk': { someipBuilders: { async buildAndInitTypedProxy(name, instance) {
            assert.strictEqual(name, iface); calls.push(instance);
            const px = { isAvailable() { return true; }, subscribeToAvailability(fn) { provider[instance] = fn; },
                shutdown() { shutdowns.push(instance); } };
            fields.forEach((field) => { px[field] = {
                subscribe(fn) { event[instance][field] = fn; },
                getValue() { return fail[instance] ? Promise.reject(new Error('fixture provider failure')) : Promise.resolve(state[instance][field]); },
                setValue() { throw new Error('Forbidden write'); },
            }; });
            return px;
        } } },
    }, c).forHmi('ID8');
    const { NowPlaying } = load(path.join(port, 'apps/aref_carlyrics/car/nowplaying.js'), { fs: fileSystem }, c);
    const np = new NowPlaying(readers, log, [{ iface, instances: [] }]);
    let notifications = 0; np.onChange(() => { notifications++; });
    await np.start(); await flush();
    assert.deepStrictEqual(calls, ['CarPlayMedia', 'Bluetooth']);
    assert.strictEqual(np.track().title, 'CarPlayMedia song'); assert.strictEqual(np.track().position, 10000);
    assert.strictEqual(np.track().playing, true);
    state.CarPlayMedia.playerState = 'PLAYER_STATE_PAUSE'; event.CarPlayMedia.playerState(state.CarPlayMedia.playerState);
    assert.strictEqual(np.track().playing, false);
    state.Bluetooth.playerState = 'PLAYER_STATE_PLAY'; event.Bluetooth.playerState(state.Bluetooth.playerState);
    assert.strictEqual(np.track().title, 'Bluetooth song');
    provider.Bluetooth(false);
    assert.strictEqual(np.track().title, 'CarPlayMedia song', 'an unavailable source must not displace a fresh source');
    provider.CarPlayMedia(false); assert.strictEqual(np.track(), null);
    assert(np.values().every((row) => row.available === false));
    fail.CarPlayMedia = true; provider.CarPlayMedia(true); await flush();
    assert.strictEqual(np.track(), null); assert(np.status().some((row) => /fixture provider failure/.test(row.error)));
    fail.CarPlayMedia = false; c.poll(); await flush();
    assert.strictEqual(np.track().title, 'CarPlayMedia song');
    c.now += 90001; assert.strictEqual(np.track(), null, 'cached metadata expires after the existing read cadence is missed');
    c.poll(); await flush(); assert.strictEqual(np.track().title, 'CarPlayMedia song');
    assert(notifications > 0);
    np.stop(); await flush(); assert.strictEqual(np.track(), null); assert.strictEqual(c.intervals.size, 0);
    assert.deepStrictEqual(shutdowns.sort(), ['Bluetooth', 'CarPlayMedia']);
    event.CarPlayMedia.currentItemMetadata([{ key: 'TITLE', value: 'late' }]); assert.strictEqual(np.values().length, 0);
    state.Bluetooth.playerState = 'PLAYER_STATE_PAUSE';
    await np.start(); await flush(); assert.strictEqual(np.track().title, 'CarPlayMedia song');
    np.stop(); await flush();

    // A stop racing an unfinished SDK open cannot revive a subscription.
    let finish, lateShutdown = 0;
    const slowReader = { readOnly: true, loadConfig() { return { fields: { currentItemMetadata: {} }, instances: ['one'] }; },
        watch() { return new Promise((resolve) => { finish = resolve; }); } };
    const slow = new NowPlaying(slowReader, log, [{ iface, instances: [] }]);
    const starting = slow.start(); await flush(); slow.stop();
    finish({ available: false, fresh() { return false; }, shutdown() { lateShutdown++; } });
    await starting; assert.strictEqual(lateShutdown, 1); assert.strictEqual(slow.subs.length, 0);
}

async function fullscreen() {
    const c = clock(), helper = load(path.join(port, 'kit/runtime/fullscreen.js'), {}, c);
    const old = load(path.join(root, 'apps/_sources/arefahmad-idrive7-apps/kit/runtime/fullscreen.js'), {}, c);
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const id7 = { own: true, place: { x: 0, y: 0, w: 1920, h: 720, scale: 1.16, ox: 70, oy: 40 }, extra: 34 };
    assert.deepStrictEqual(clone(helper.area(id7)), clone(old.area(id7)));
    assert.deepStrictEqual(clone(helper.area({ own: false })), clone(old.area({ own: false })));
    for (const area of [{ x: 0, y: 76, w: 2880, h: 764 }, { x: 160, y: 90, w: 2500, h: 700 }]) {
        const scale = Math.floor(Math.min(area.w / 1576, (area.h - 80) / 482) * 1000) / 1000;
        const cv = { own: true, extra: 0, place: { hmi: 'ID8', headerHeight: 80, x: area.x, y: area.y,
            w: area.w, h: area.h, scale, ox: Math.round((area.w - 1576 * scale) / 2 - 12 * scale),
            oy: Math.round(80 + ((area.h - 80) - 482 * scale) / 2 - 38 * scale) } };
        const rect = helper.area(cv, 0), targets = [];
        cv.target = (x, y, w, h, run, key) => { targets.push({ x, y, w, h, run, key }); return cv; };
        helper.button(cv, 'bounded', rect.x - 30, rect.y - 30, rect.w + 60, rect.h + 60, () => {}, { slop: 20 });
        assert.strictEqual(targets.length, 1);
        const a = helper.toScreen(cv, targets[0].x, targets[0].y);
        const b = helper.toScreen(cv, targets[0].x + targets[0].w, targets[0].y + targets[0].h);
        assert(a.x >= 0 && a.y >= 80 && b.x <= area.w && b.y <= area.h, 'ID8 hit rectangle stays within local appArea');
        const before = targets.length;
        helper.button(cv, 'outside', -10000, -10000, 20, 20, () => {});
        assert.strictEqual(targets.length, before, 'fully clipped target is not registered');
        const shifted = Object.assign({}, cv, { place: Object.assign({}, cv.place, { x: 500, y: 200 }) });
        assert.deepStrictEqual(clone(helper.area(shifted)), clone(helper.area(cv)), 'absolute screen origin must not alter local touch geometry');
    }
}

async function carlyrics() {
    const c = clock(), clicks = {}, appEvents = {}, visible = { MAIN: true, SETTINGS: false }, visibleFns = [];
    const text = [], reports = [], limits = [], widgets = [], targets = [];
    let entry, draw, np, current = null, starts = 0, stops = 0, readerSelections = 0;
    const spec = JSON.parse(fs.readFileSync(path.join(port, 'apps/aref_carlyrics/app.json'), 'utf8'));
    const FS = load(path.join(port, 'kit/runtime/fullscreen.js'), { './app-spec.json': spec }, c);
    const cvBase = { own: true, extra: 0, chrome: null, place: { hmi: 'ID8', headerHeight: 80, x: 100, y: 76, w: 2700, h: 764, scale: 1.4, ox: 230, oy: 22 },
        text(value) { text.push(String(value)); return cv; }, textWidth(value, size) { return String(value).length * size * 0.45; },
        target(x, y, w, h, run, key) { targets.push({ x, y, w, h, run, key }); return cv; } };
    const cv = new Proxy(cvBase, { get(obj, key) { return key in obj ? obj[key] : () => cv; } });
    const readers = { readOnly: true };
    class NowPlaying {
        constructor(selected, logger, ifaces) {
            assert.strictEqual(selected, readers); assert.strictEqual(ifaces.length, 4); np = this; this.changed = () => {};
        }
        onChange(fn) { this.changed = fn; }
        track() { return current; }
        status() { return [{ iface: 'fixture.MediaPlayer', instance: 'CarPlayMedia', available: !!current, fields: 4, error: current ? '' : 'provider unavailable' }]; }
        values() { return current ? [{ key: 'MediaPlayer/CarPlayMedia.currentItemMetadata', text: current.title, at: c.now, changes: 1, available: true }] : []; }
        start() { starts++; return Promise.resolve(); }
        stop() { stops++; current = null; this.changed('stopped'); }
    }
    const ctx = {
        dataDir: '/fixture', signals: { watch() { throw new Error('ID8 must select the read-only reader'); } },
        app: { on(name, fn) { appEvents[name] = fn; } },
        ui: { id8: true, onClick(name, fn) { clicks[name] = fn; }, visible() {}, text() {}, async image() {},
            isVisible(name) { return visible[name]; }, onVisible(fn) { visibleFns.push(fn); } },
        settings: { get(name) { return name === 'offset' ? 0 : 'm_tricolour'; } },
        log: { info(m) { limits.push(m); }, warn() {}, error(m) { throw new Error(m); } },
        canvas() { return cv; }, theme() { return {}; }, hideButton() {}, onTab() {}, onLayout() {},
        loop(name, fps, fn) { draw = fn; },
    };
    load(path.join(port, 'apps/aref_carlyrics/main.js'), {
        fs: { existsSync() { return false; }, writeFileSync(file, content) { reports.push({ file, content }); } }, path,
        './kit/mgu': { run(value) { entry = value; } }, './kit/gauges': { frame() {}, withAlpha(colour) { return colour; } },
        './kit/fullscreen': FS, './kit/record': { setImage() { throw new Error('No artwork fixture'); } },
        './kit/fonts': { register() { return false; } }, './kit/pack': { open() { throw new Error('Synthetic fontless runtime'); } },
        './nowplaying': { NowPlaying, scanCatalog() { return { error: '', hits: [], total: 1 }; } },
        './lyrics': { fold(value) { return String(value); }, Lyrics: class { get() { return { state: 'plain', text: ['Synthetic fixture lyric'] }; } } },
        './artwork': { Artwork: class { get() { return { state: 'loading' }; } } },
        './http': { client() { return { request() { throw new Error('Network forbidden'); }, online() { return false; } }; } },
        './kit/homewidget': { start() { widgets.push(true); } },
        './kit/readonly_signals': { forHmi(hmi) { assert.strictEqual(hmi, 'ID8'); readerSelections++; return readers; } },
    }, c);
    await entry.start(ctx); await flush();
    assert.strictEqual(readerSelections, 1); assert.strictEqual(starts, 1); assert.strictEqual(widgets.length, 0);
    assert(limits.some((m) => /widget unavailable/.test(m)));
    const frame = async () => { text.length = 0; targets.length = 0; await draw(); return text.join('\n'); };
    const setTrack = (values) => { current = values; np.changed('metadata'); };
    setTrack({ title: 'Fixture song', artist: 'Fixture artist', album: 'Fixture album', duration: 180000, position: 10000, positionAt: c.now, direct: true, playing: true, from: 'fixture' });
    assert.match(await frame(), /Fixture song/); assert.match(text.join('\n'), /Synthetic fixture lyric/);
    c.now += 1500; assert.match(await frame(), /0:11/);
    setTrack(Object.assign({}, current, { position: 12000, positionAt: c.now, playing: false }));
    c.now += 6000; assert.match(await frame(), /Paused/); assert.match(text.join('\n'), /0:12/);
    setTrack(Object.assign({}, current, { position: 13000, positionAt: c.now, playing: true }));
    c.now += 6000; assert.match(await frame(), /0:17/, 'clock holds at the original four-second extrapolation limit');
    setTrack({ title: 'New source', artist: 'Another artist', duration: null, position: null, playing: true, from: 'Bluetooth' });
    assert.match(await frame(), /New source/); assert(targets.some((t) => t.key === 'sync'));
    c.now += 5000; clicks.BTN_SYNC(); assert.match(await frame(), /0:00/);
    clicks.BTN_PROBE(); assert.match(await frame(), /Values the car sends/);
    clicks.BTN_PAGE(); assert.match(await frame(), /Media interfaces in the catalog/);
    clicks.BTN_PAGE(); assert.match(await frame(), /Subscriptions/);
    clicks.BTN_SAVE(); assert(reports.some((r) => r.file.endsWith('carlyrics-probe.txt') && /New source/.test(r.content)));
    clicks.BTN_PROBE(); setTrack(null);
    const lost = await frame(); assert(!lost.includes('New source')); assert(!lost.includes('Synthetic fixture lyric'));
    assert.match(lost, /Current media data unavailable/);
    visible.MAIN = false; visibleFns.forEach((fn) => fn('MAIN', false)); await flush(); assert.strictEqual(stops, 1);
    visible.MAIN = true; visibleFns.forEach((fn) => fn('MAIN', true)); await flush(); assert.strictEqual(starts, 2);
    visibleFns.forEach((fn) => fn('MAIN', true));
    appEvents.shutdown(); await flush(); assert.strictEqual(stops, 2); assert.strictEqual(c.intervals.size, 0);
    assert.strictEqual(starts, 2, 'queued visibility cannot reopen after shutdown');
}

({ adapter, carcare, nowplaying, carlyrics, fullscreen }[scenario] || (() => { throw new Error('Unknown scenario ' + scenario); }))()
    .then(() => { process.stdout.write('PASS ' + scenario + '\n'); })
    .catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
