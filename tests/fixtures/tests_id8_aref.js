'use strict';
/* Inert offline fixtures for the actual AQ Car Explorer port modules.
 * Explorer's read-only main receives an in-memory filesystem. No real SDK,
 * socket, renderer process or vehicle-action app is loaded.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const root = process.argv[2], scenario = process.argv[3];
const port = path.join(root, 'apps/_ports/arefahmad-idrive8');
const original = path.join(root, 'apps/_sources/arefahmad-idrive7-apps');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function clock() {
    let id = 0;
    const pending = new Map();
    return {
        pending,
        setTimeout(fn, ms) { const token = ++id; pending.set(token, { fn, ms, repeat: false }); return token; },
        clearTimeout(token) { pending.delete(token); },
        setInterval(fn, ms) { const token = ++id; pending.set(token, { fn, ms, repeat: true }); return token; },
        clearInterval(token) { pending.delete(token); },
    };
}

function load(file, dependencies, extra) {
    const timers = extra && extra.clock || clock();
    const module = { exports: {} };
    const context = Object.assign({
        module, exports: module.exports, Buffer, console, Promise, setImmediate,
        setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
        setInterval: timers.setInterval, clearInterval: timers.clearInterval,
        __dirname: path.dirname(file), __filename: file,
        process: { env: { NG_REMOTELOG: '0' }, cwd: () => '/synthetic-test-data', on() {},
            exit() { throw new Error('Unexpected process exit'); }, memoryUsage: () => ({ rss: 0 }) },
        require(name) {
            if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
            throw new Error('Unexpected module access: ' + name);
        },
    }, extra || {});
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file, timeout: 3000 });
    return module.exports;
}

function rhmiFor(hmi, trace) {
    const rhmi = new EventEmitter(), named = new Map();
    function component(desc, id) {
        const value = new EventEmitter();
        value._uiDescription = desc;
        value.getId = () => Number(id);
        value.setValue = (...args) => { trace.push(['value', desc.name, ...args]); return Promise.resolve(); };
        value.setProperty = (...args) => { trace.push(['property', desc.name, ...args]); return Promise.resolve(); };
        value.setRowCount = (n) => { trace.push(['rows', desc.name, n]); return Promise.resolve(); };
        value.updateResources = () => { trace.push(['resources', desc.name]); return Promise.resolve(); };
        named.set(desc.name, value);
        return value;
    }
    Object.entries(input.ui[hmi].containers).forEach(([id, container]) => {
        component(container, id);
        Object.entries(container.components).forEach(([cid, desc]) => component(desc, cid));
    });
    component({ name: 'TEST_LABEL', type: 'label', rows: [{ Text: {} }] }, 9998);
    component({ name: 'TEST_EMPTY_LABEL', type: 'label', rows: [] }, 9999);
    rhmi.getByName = (name) => named.get(name) || null;
    rhmi.mapEntryState = (uuid, state) => { trace.push(['map', uuid, state._uiDescription.name]); return Promise.resolve(); };
    rhmi.openEntryState = (uuid) => { trace.push(['openEntry', uuid]); return Promise.resolve(); };
    rhmi.openState = (name) => { trace.push(['openState', name]); return Promise.resolve(); };
    rhmi.closeState = (name) => { trace.push(['closeState', name]); return Promise.resolve(); };
    rhmi.getResourceBundle = () => { throw new Error('SDK image resource API must not be used'); };
    return rhmi;
}

async function startRuntime(hmi, options) {
    options = options || {};
    const trace = [], timers = clock();
    const rhmi = rhmiFor(hmi, trace);
    let app;
    const description = { uuid: 'synthetic-entry', textId: 'synthetic-title', icon: 'synthetic-icon' };
    class OnlineApp extends EventEmitter {
        constructor() {
            super(); app = this;
            this.rhmiApplication = options.background ? null : rhmi;
            this.startReason = options.background ? 'SYSTEM' : 'ENTRY_POINT';
            this.appDescription = { application: { entryPoints: [description] } };
        }
        start() { trace.push(['start']); this.emit('appStatusProxyReady'); return Promise.resolve(); }
        registerActive() { trace.push(['active']); return Promise.resolve(); }
        initialized() { trace.push(['initialized']); return Promise.resolve(); }
        registerHmiVisible() { trace.push(['visible']); return Promise.resolve(); }
        unregisterHmiVisible() { trace.push(['hidden']); return Promise.resolve(); }
        getVisibilityData() { return { reason: this.startReason }; }
        getLastExecutedEntryPointUuid() { return options.background ? null : description.uuid; }
        getEntryPoints() {
            return [{
                getDescription: () => description,
                init: () => { trace.push(['entryInit']); return Promise.resolve(); },
                entryPoint: {
                    setText: (id) => { trace.push(['entryText', id]); return Promise.resolve(); },
                    setIcon: (icon) => { trace.push(['entryIcon', icon]); return Promise.resolve(); },
                },
                setAvailability: (value) => { trace.push(['entryAvailability', value]); return Promise.resolve(); },
            }];
        }
    }
    const logger = { info() {}, debug() {}, warn() {}, error() {} };
    const syntheticFs = {
        readFileSync(file) {
            if (file.endsWith('app-spec.json')) return JSON.stringify(input.spec);
            if (file.endsWith('rhmiData/application.json')) return JSON.stringify({ application: { entryPoints: [description] } });
            throw Object.assign(new Error('No synthetic file'), { code: 'ENOENT' });
        },
        existsSync: () => false, readdirSync: () => [], appendFileSync() {},
        writeFileSync(file, value) { trace.push(['file', path.basename(file), value]); },
        statSync() { throw new Error('No synthetic file'); },
    };
    class Display {
        constructor(ui) { this.ui = ui; this.sheet = null; }
        label() {}
        active() { return false; }
        openSheet() { return false; }
        closeSheet() { this.sheet = null; }
    }
    class HmiText {
        set(component, name, row, cell, value) {
            trace.push(['text', name, row, cell, value]);
            return Promise.resolve();
        }
    }
    const life = load(path.join(port, 'kit/runtime/id8_lifecycle.js'), {}, { clock: timers });
    const runtime = load(path.join(port, 'kit/runtime/mgu.js'), {
        fs: syntheticFs, path,
        'oap-sdk': { OnlineApp, logging: { getSDKLogger: () => logger } },
        'oap-sdk/package.json': { version: hmi === 'ID8' ? '50.0.0-SYNTHETIC' : '20.0.0-SYNTHETIC' },
        './themes': { theme: () => ({}) }, './display': { Display }, './hmi-text': { HmiText },
        './sheet': { listSheet: () => ({}) }, './id8_lifecycle': life,
        './signals': Object.freeze({}),
    }, { clock: timers });
    const ctx = await runtime.run({ start() { trace.push(['implementationStart']); } });
    await flush();
    return { ctx, app, rhmi, trace, timers };
}

async function uiScenario() {
    for (const hmi of ['ID7', 'ID8']) {
        const value = await startRuntime(hmi), { ctx, rhmi, trace } = value;
        assert.strictEqual(ctx.ui.id8, hmi === 'ID8');
        await ctx.ui.text('BTN_SETTINGS', 'A label');
        await ctx.ui.text('TEST_LABEL', 'Text cell');
        await ctx.ui.text('TEST_EMPTY_LABEL', 'Empty label');
        await ctx.ui.cells('BTN_SETTINGS', 0, { Text1stRow: 'First', Text2ndRow: 'Second' });
        assert(trace.some((x) => x[0] === 'text' && x[1] === 'BTN_SETTINGS' && x[3] === (hmi === 'ID8' ? 'PrimaryText' : 'Text')));
        assert(trace.some((x) => x[0] === 'text' && x[1] === 'TEST_LABEL' && x[3] === 'Text'));
        assert(trace.some((x) => x[0] === 'text' && x[1] === 'TEST_EMPTY_LABEL' && x[3] === 'Text'));
        assert(trace.some((x) => x[0] === 'text' && x[1] === 'BTN_SETTINGS' && x[3] === (hmi === 'ID8' ? 'FrequencyText' : 'Text2ndRow')));
        if (hmi === 'ID8') {
            assert(trace.some((x) => x[0] === 'text' && x[1] === 'SET_THEME' && x[3] === 'FrequencyText'));
        } else {
            assert(trace.some((x) => x[0] === 'value' && x[1] === 'SET_THEME' && x[2] === 'SelectedItem'));
        }
        rhmi.getByName('SET_THEME').emit('action', { row: hmi === 'ID8' ? 0 : 2 });
        await flush();
        assert.strictEqual(ctx.settings.get('theme'), 'ice');
        ctx.app.rhmiApplication = rhmiFor(hmi === 'ID8' ? 'ID7' : 'ID8', trace);
        assert.strictEqual(ctx.ui.id8, hmi !== 'ID8', 'marker must follow replaced RHMI application');
        assert.strictEqual(value.timers.pending.size, 0);
    }
}

async function imageScenario() {
    const { ctx, trace } = await startRuntime('ID8');
    const image = new Proxy({}, { get() { throw new Error('ID8 fallback must not read image bytes or encode PNG'); } });
    await ctx.ui._image('MAIN_GFX', image);
    const notices = () => trace.filter((item) => item[0] === 'text' && item[1] === 'MAIN_GFX');
    assert.strictEqual(notices().length, 1);
    assert.strictEqual(notices()[0][3], 'Text');
    assert(/renderer/i.test(notices()[0][4]));
    await ctx.ui._image('MAIN_GFX', image);
    assert.strictEqual(notices().length, 1, 'same notice should not flood RHMI');
    ctx.display.active = () => true;
    await ctx.ui._image('MAIN_GFX', image);
    assert.strictEqual(notices().length, 2);
    assert.strictEqual(notices()[1][4], '');
    assert(!trace.some((item) => item[0] === 'file' && /^dyn_/.test(item[1])));
}

async function foregroundScenario() {
    const { ctx, trace, timers } = await startRuntime('ID8');
    const at = (name) => trace.findIndex((item) => item[0] === name);
    assert(ctx && ctx.ui.id8);
    assert(at('resources') < at('entryInit'));
    assert(at('entryInit') < at('map'));
    assert(at('map') < at('entryAvailability'));
    assert(at('entryAvailability') < at('implementationStart'));
    assert(at('implementationStart') < at('active'));
    assert(at('active') < at('initialized'));
    assert(at('initialized') < at('openEntry'));
    assert(trace.some((item) => item[0] === 'entryAvailability' && item[1] === 'ENABLED'));
    assert.strictEqual(trace.filter((item) => item[0] === 'active').length, 1);
    assert.strictEqual(timers.pending.size, 0);
}

async function backgroundScenario() {
    const { ctx, trace, timers } = await startRuntime('ID8', { background: true });
    assert.strictEqual(ctx, undefined);
    assert.strictEqual(trace.filter((x) => x[0] === 'initialized').length, 1);
    for (const forbidden of ['active', 'map', 'openEntry', 'entryInit', 'implementationStart']) {
        assert(!trace.some((x) => x[0] === forbidden), forbidden);
    }
    assert.strictEqual(timers.pending.size, 0);
}

async function id7Scenario() {
    const { ctx, rhmi, trace, timers } = await startRuntime('ID7');
    assert.strictEqual(ctx.ui.id8, false);
    assert(trace.findIndex((x) => x[0] === 'active') < trace.findIndex((x) => x[0] === 'initialized'));
    assert(trace.some((x) => x[0] === 'openEntry'));
    assert(!trace.some((x) => x[0] === 'entryInit'));
    const id = rhmi.getByName('MAIN').getId();
    rhmi.emit('applicationStackChanged', { ROOT_APP: [id] });
    await flush();
    assert.strictEqual(ctx.ui.isVisible('MAIN'), true);
    assert(trace.some((x) => x[0] === 'visible'));
    rhmi.emit('applicationStackChanged', {});
    await flush();
    assert.strictEqual(ctx.ui.isVisible('MAIN'), false);
    assert(trace.some((x) => x[0] === 'hidden'));
    assert.strictEqual(timers.pending.size, 0);
}

async function visibilityScenario() {
    const { ctx, app, rhmi } = await startRuntime('ID8');
    assert.strictEqual(ctx.ui.isVisible('MAIN'), true);
    rhmi.emit('applicationStackChanged', {});
    assert.strictEqual(ctx.ui.isVisible('MAIN'), true, 'empty SDK50 notification is not a hide event');
    rhmi.getByName('MAIN').emit('visible', { visible: false });
    assert.strictEqual(ctx.ui.isVisible('MAIN'), true, 'ID8 per-state false alone is not an application hide');
    rhmi.getByName('MAIN').emit('focus', { focus: 'false' });
    assert.strictEqual(ctx.ui.hasFocus('MAIN'), false);
    rhmi.emit('applicationStackChanged', { ROOT_APP: [] });
    assert.strictEqual(ctx.ui.hasFocus('MAIN'), true);
    app.emit('changeVisibility', { visible: '0' });
    assert.strictEqual(ctx.ui.isVisible('MAIN'), false);
    rhmi.getByName('MAIN').emit('visible', { visible: 'true' });
    assert.strictEqual(ctx.ui.isVisible('MAIN'), true);
    rhmi.emit('applicationStackChanged', { OTHER_APP: [] });
    assert.strictEqual(ctx.ui.isVisible('MAIN'), false);
}

function makeDisplay(source, id8, screen, area) {
    const timers = clock(), trace = [], rhmi = rhmiFor(id8 ? 'ID8' : 'ID7', trace);
    const shown = { MAIN: true, SETTINGS: false }, focused = { MAIN: true };
    const visibleHandlers = [], focusHandlers = [];
    const ui = { id8, rhmi, onVisible: (fn) => visibleHandlers.push(fn), onFocus: (fn) => focusHandlers.push(fn),
        isVisible: (name) => !!shown[name], hasFocus: (name) => focused[name] !== false,
        visible: (name, on) => { trace.push(['hmiVisible', name, on]); return Promise.resolve(); } };
    class Recorder {
        constructor(w, h) { this.w = w; this.h = h; this.atlases = new Set(); this.ramps = new Set(); }
        textWidth(text, size) { return text.length * size * 0.5; }
        words() { return new Uint32Array(); }
        xf() { return { noclip() {} }; }
    }
    class RenderClient { constructor() { throw new Error('A renderer connection must never be created'); } }
    const { Display } = load(path.join(source, 'kit/runtime/display.js'), {
        './record': { Recorder, play() {} },
        './canvas': { Canvas: class { constructor() { throw new Error('ID8 fallback must not allocate a software Canvas'); } } },
        './renderd': { RenderClient },
        './gauges': { onConfirm() {}, onLayerDrop() {} }, './credits': { drawCredit() {} },
    }, { clock: timers, process: { env: { MGU_RENDERER: 'software' } } });
    const settings = { get: (key) => key === 'layout' ? 'full' : null, onChange() {} };
    const logger = { info() {}, warn() {}, error() {} };
    const display = new Display(ui, logger, input.spec, settings, () => ({}));
    display.gpu = { ready: true, native: true, touch: true, info: { controller: false },
        screen, area, visible: false,
        place(value) { trace.push(['place', clone(value)]); },
        grab(value) { trace.push(['grab', value]); },
        show(value) { this.visible = value; trace.push(['show', value]); },
    };
    return { display, trace, shown, focused, visibleHandlers, focusHandlers, timers, rhmi, Recorder };
}

async function displayScenario() {
    const screen = { w: 2880, h: 960 }, area = { x: 100, y: 90, w: 2700, h: 700 };
    const f = makeDisplay(port, true, screen, area), d = f.display;
    d._place(); d._syncVisible();
    assert.deepStrictEqual([d.place.x, d.place.y, d.place.w, d.place.h], [100, 90, 2700, 700]);
    assert(d.place.full && d.place.scale > 0);
    assert.strictEqual(d.ctl(), false);
    assert.strictEqual(d.hasSettings(), true);
    assert.strictEqual(d.canSheet(), true);
    d.grab(true);
    assert(!f.trace.some((x) => x[0] === 'grab' && x[1] === true));
    let settingsClicks = 0;
    f.rhmi.getByName('BTN_SETTINGS').on('action', () => settingsClicks++);
    const tab = d._tabList().settings;
    assert(tab >= 0);
    d.tabs = [{ x: 10, y: -40, w: 100, h: 20, i: tab }];
    d._touch(1, 20, -30); d._touch(3, 20, -30);
    assert.strictEqual(settingsClicks, 1, 'touch-only ID8 Settings must remain reachable');
    f.focused.MAIN = false; d._syncVisible();
    assert.strictEqual(d.gpu.visible, false);
    f.focused.MAIN = true; f.shown.SETTINGS = true; d._syncVisible();
    assert.strictEqual(d.gpu.visible, false);
    f.shown.SETTINGS = false; d._syncVisible();
    assert.strictEqual(d.gpu.visible, true);
    d.gpu.native = false; d._syncVisible();
    assert.strictEqual(d.active(), false, 'stale placement cannot retain an incompatible renderer');
    assert.strictEqual(d.gpu.visible, false);
    d.gpu.native = true; d.gpu.touch = false; d._syncVisible();
    assert.strictEqual(d.active(), false, 'ID8 touch capability is required after a READY change');
    assert.strictEqual(d.gpu.visible, false);
    const fallback = makeDisplay(port, true, screen, null).display;
    fallback._place();
    assert.deepStrictEqual([fallback.place.x, fallback.place.y, fallback.place.w, fallback.place.h], [0, 76, 2880, 764]);
    const bad = makeDisplay(port, true, { w: 2000, h: 800 }, { x: 0, y: 0, w: 9000, h: 9000 }).display;
    bad._place(); bad._syncVisible();
    assert.strictEqual(bad.place, null);
    assert.strictEqual(bad.gpu.visible, false, 'invalid app area must remain hidden after visibility synchronization');
    const software = makeDisplay(port, true, screen, null);
    software.display.gpu = null;
    let fallbackImage;
    await software.display.present('MAIN_GFX', new software.Recorder(1600, 520), (name, img) => {
        assert.strictEqual(name, 'MAIN_GFX'); fallbackImage = img; return Promise.resolve();
    });
    assert.strictEqual(fallbackImage, null, 'ID8 software path must use the native text notice');
    const old = makeDisplay(original, false, { w: 1920, h: 720 }, null).display;
    const current = makeDisplay(port, false, { w: 1920, h: 720 }, null).display;
    old._place(); current._place();
    assert.deepStrictEqual(clone(current.place), clone(old.place), 'ID7 placement must remain unchanged');
}

function pathsScenario() {
    const reads = [];
    const { mainAppRoot } = load(path.join(port, 'kit/runtime/platform_paths.js'), {
        path, fs: { statSync() { throw new Error('Use the explicit synthetic filesystem'); } },
    });
    const mock = (present) => ({ statSync(p) { reads.push(p); return { isDirectory: () => present.includes(p) }; } });
    const id7 = '/synthetic/usr/lib/oap-mainapp', id8 = '/synthetic/usr/lib/oap-mainapp21';
    assert.strictEqual(mainAppRoot('/synthetic', 'ID7', mock([id7, id8])), id7);
    assert.strictEqual(mainAppRoot('/synthetic', 'ID8', mock([id7, id8])), id8);
    assert.strictEqual(mainAppRoot('/synthetic', null, mock([id8])), id8);
    assert.strictEqual(mainAppRoot('/synthetic', null, mock([id7])), id7);
    assert.throws(() => mainAppRoot('/synthetic', null, mock([id7, id8])), /ambiguous/);
    assert.throws(() => mainAppRoot('/synthetic', null, mock([])), /unknown/);
    assert.throws(() => mainAppRoot('/synthetic', 'ID8', mock([id7])), /unavailable/);
    assert.throws(() => mainAppRoot('/synthetic', 'ID9', mock([id7, id8])), /Unknown HMI/);
    assert(reads.every((p) => p === id7 || p === id8));
}

async function explorerPathsScenario() {
    for (const hmi of ['ID7', 'ID8']) {
        for (const missing of [false, true]) {
            const directories = [], written = [], errors = [], warnings = [];
            const family = hmi === 'ID8' ? 'oap-mainapp21' : 'oap-mainapp';
            const selected = '/synthetic/usr/lib/' + family;
            const mockFs = {
                readFileSync(file) {
                    assert.strictEqual(file, '/synthetic/etc/oap/someip/someip-interfaces.json');
                    return JSON.stringify({ interfaces: { 'fixture.ReadOnly': { fields: { sample: {} } } } });
                },
                statSync(file) { return { isDirectory: () => !(missing && file === selected) }; },
                readdirSync(file) { directories.push(file); return ['synthetic-interface.json', 'not-a-json.txt']; },
                writeFileSync(file, data) { written.push([file, data]); },
            };
            const helper = load(path.join(port, 'kit/runtime/platform_paths.js'), { path, fs: mockFs });
            const catalog = load(path.join(port, 'apps/aref_explorer/explore/catalog.js'), {});
            let implementation;
            load(path.join(port, 'apps/aref_explorer/main.js'), {
                fs: mockFs, path, './kit/mgu': { run(value) { implementation = value; } },
                './catalog': catalog, './kit/platform_paths': helper,
            }, { process: { env: { MGU_EXPLORER_ROOT: '/synthetic' } } });
            assert(implementation && typeof implementation.start === 'function');
            await implementation.start({
                ui: { id8: hmi === 'ID8', onClick() {}, text() { return Promise.resolve(); } },
                settings: {}, dataDir: '/synthetic-data', loop() {},
                log: { info() {}, warn(value) { warnings.push(value); }, error(value) { errors.push(value); } },
            });
            assert.deepStrictEqual(errors, []);
            assert.strictEqual(written.length, 1);
            assert.strictEqual(written[0][0], '/synthetic-data/explorer-report.txt');
            if (missing) {
                assert.deepStrictEqual(directories, []);
                assert(written[0][1].includes('MainApp interface folder: unavailable'));
                assert(warnings.some((line) => line.includes('unavailable')));
            } else {
                assert.deepStrictEqual(directories, [selected + '/src-gen']);
                assert(written[0][1].includes('MainApp interface folder: ' + selected + '/src-gen'));
                assert(written[0][1].includes('synthetic-interface.json'));
                assert(!written[0][1].includes('not-a-json.txt'));
            }
        }
    }
}

const scenarios = { ui: uiScenario, image: imageScenario, foreground: foregroundScenario, background: backgroundScenario,
    id7: id7Scenario, visibility: visibilityScenario, display: displayScenario, paths: pathsScenario,
    explorerpaths: explorerPathsScenario };
Promise.resolve().then(() => {
    assert(scenarios[scenario], 'Unknown scenario');
    return scenarios[scenario]();
}).then(() => console.log('PASS ' + scenario)).catch((error) => {
    console.error(error && error.stack || error); process.exitCode = 1;
});
