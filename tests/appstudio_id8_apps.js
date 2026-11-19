'use strict';
// Execute only the two application sources with inert UI/vehicle dependencies.
// Persistence tests use disposable local directories. No SDK or socket is loaded.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const EventEmitter = require('events');
const PORT = path.resolve(process.argv[2]), ORIGINAL = path.resolve(process.argv[3]), GROUP = process.argv[4];
const quiet = { info() {}, warn() {}, error() {} };
const plain = (value) => JSON.parse(JSON.stringify(value));
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function clock() {
    let time = Date.UTC(2026, 10, 19, 12), next = 1;
    const jobs = new Map(), now = () => time;
    const add = (fn, ms, repeat) => { const id = next++; jobs.set(id, { fn, at: time + ms, repeat }); return id; };
    return {
        now, Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now()])); } static now() { return now(); } },
        setTimeout: (fn, ms) => add(fn, ms || 0, 0), clearTimeout: (id) => jobs.delete(id),
        setInterval: (fn, ms) => add(fn, ms, ms), clearInterval: (id) => jobs.delete(id),
        async advance(ms) {
            const end = time + ms; let count = 0;
            while (true) {
                let selected = null;
                for (const item of jobs) if (item[1].at <= end && (!selected || item[1].at < selected[1].at)) selected = item;
                if (!selected) break;
                if (++count > 1000) throw new Error('unbounded fixture timer');
                const [id, job] = selected; time = job.at; jobs.delete(id);
                if (job.repeat) jobs.set(id, Object.assign({}, job, { at: time + job.repeat }));
                job.fn(); await settle();
            }
            time = end; await settle();
        },
        count: () => jobs.size,
    };
}
function load(file, dependencies, globals) {
    const box = Object.assign({ module: { exports: {} }, Buffer, Promise, console, __dirname: path.dirname(file),
        require(name) { if (!(name in dependencies)) throw new Error('forbidden import: ' + name); return dependencies[name]; },
        setTimeout, clearTimeout, setInterval, clearInterval, setImmediate }, globals || {});
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), box, { filename: file, timeout: 3000 });
    return box.module.exports;
}
function canvas() {
    const cv = { own: true, words: [], targets: [], text(value) { this.words.push(String(value)); return this; },
        textWidth(value, size) { return String(value).length * (size || 20) * 0.5; },
        target(x, y, w, h, fn, name) { this.targets.push({ x, y, w, h, fn, name }); return this; } };
    for (const name of ['clear', 'roundRect', 'strokeRoundRect', 'line', 'circle']) cv[name] = function () { return this; };
    return cv;
}

async function blocks() {
    async function run(folder, id8) {
        const appDir = path.join(folder, 'apps/bimmer_blocks'), timer = clock(), app = new EventEmitter();
        const spec = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'))), values = Object.fromEntries(spec.settings.map((x) => [x.key, x.default]));
        const clicks = {}, visibility = [], grabs = [], images = [], storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-blocks-main-'));
        let visible = true, focus = true, available = false, readAt = null, handlers, impl, render, game, shutdowns = 0, listener;
        const originalEngine = require(path.join(appDir, 'engine'));
        class Game extends originalEngine.Game { constructor() { super(() => 0.4); game = this; } }
        const ui = { id8, isVisible: () => visible, hasFocus: () => focus, onVisible(fn) { visibility.push(fn); },
            onClick(name, fn) { clicks[name] = fn; }, text() {}, image(name, cv) { images.push(cv); return Promise.resolve(); } };
        const sub = { error: null, fresh(field) { assert.strictEqual(field, 'statusCarSpeed2'); return available && readAt !== null && timer.now() - readAt >= 0 && timer.now() - readAt <= 6000; },
            shutdown() { shutdowns++; available = false; return Promise.resolve(); } };
        const reader = { watch(iface, instance, h, log, opts) {
            assert.strictEqual(iface, 'de.bmw.infotainment.vehicle.Vehicle2'); assert.strictEqual(instance, '1');
            assert.deepStrictEqual(Object.keys(h), ['statusCarSpeed2']); assert.strictEqual(opts.pollMs, 2000);
            handlers = h; return Promise.resolve(sub);
        } };
        const dependencies = { './kit/mgu': { run(value) { impl = value; } }, './kit/gauges': { frame() {} }, './kit/i18n': { getLanguage: () => 'en' },
            './engine': Object.assign({}, originalEngine, { Game }), './controls': require(path.join(appDir, 'controls')), './scores': require(path.join(appDir, 'scores')),
            './kit/readonly_signals': { forHmi(hmi) { assert.strictEqual(hmi, 'ID8'); return reader; } } };
        load(path.join(appDir, 'main.js'), dependencies, timer);
        await impl.start({ ui, app, signals: reader, spec, dataDir: storeDir, log: quiet,
            settings: { get: (key) => values[key], onChange() {} }, onLayout() {},
            controller: { grab(value) { grabs.push(value); }, onInput(fn) { listener = fn; } },
            theme: () => ({ bg: '#000', text: '#fff', dim: '#888', warn: '#f00' }), canvas, loop(state, rate, fn) { assert.strictEqual(state, 'MAIN'); render = fn; } });
        await settle();
        return { timer, game, grabs, images, clicks, render, app,
            deliver(value) { available = true; handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: value }); readAt = timer.now(); },
            loss() { available = false; }, regainedWithoutSample() { available = true; readAt = null; },
            show(value) { visible = value; visibility.forEach((fn) => fn('MAIN', value)); },
            focus(value) { focus = value; }, shutdowns: () => shutdowns,
            cleanup() { fs.rmSync(storeDir, { recursive: true, force: true }); } };
    }
    const r = await run(PORT, true);
    try {
        r.clicks.BTN_NEW(); assert.strictEqual(r.game.active(), false, 'unknown speed cannot start');
        r.deliver(0); r.clicks.BTN_NEW(); assert.strictEqual(r.game.active(), true);
        const x = r.game.x; r.clicks.BTN_LEFT(); assert.strictEqual(r.game.x, x - 1);
        r.loss(); await r.timer.advance(500); assert.strictEqual(r.game.active(), false, 'provider loss pauses stationary cache');
        assert.strictEqual(r.grabs[r.grabs.length - 1], false); r.clicks.BTN_PAUSE(); assert.strictEqual(r.game.active(), false);
        r.regainedWithoutSample(); r.clicks.BTN_PAUSE(); assert.strictEqual(r.game.active(), false, 'provider recovery alone is insufficient');
        r.deliver(0); r.clicks.BTN_PAUSE(); assert.strictEqual(r.game.active(), true);
        await r.timer.advance(6500); assert.strictEqual(r.game.active(), false, 'ID8 freshness is tighter than the original ten-second guard');
        for (const invalid of [65535, -1, NaN, Infinity]) { r.deliver(invalid); r.clicks.BTN_PAUSE(); assert.strictEqual(r.game.active(), false); }
        r.deliver(33); r.clicks.BTN_PAUSE(); assert.strictEqual(r.game.active(), false, '0.515625km/h exceeds the original stationary limit');
        r.deliver(32); r.clicks.BTN_PAUSE(); assert.strictEqual(r.game.active(), true, '0.5km/h is the original accepted boundary');
        r.show(false); assert.strictEqual(r.game.active(), false, 'visibility loss pauses immediately');
        r.show(true); r.clicks.BTN_PAUSE(); assert.strictEqual(r.game.active(), true);
        r.focus(false); await r.render(); assert.strictEqual(r.game.active(), false, 'covered app cannot play');
        r.focus(true); r.deliver(0); r.clicks.BTN_PAUSE(); assert.strictEqual(r.game.active(), true);
        r.app.emit('shutdown'); assert.strictEqual(r.shutdowns(), 1); assert.strictEqual(r.timer.count(), 0); assert.strictEqual(r.game.active(), false);
        r.deliver(0); r.clicks.BTN_PAUSE(); assert.strictEqual(r.game.active(), false, 'late data cannot restart shutdown game');
    } finally { r.cleanup(); }
    const before = await run(ORIGINAL, false), after = await run(PORT, false);
    try {
        const outcome = async (item) => {
            const results = []; item.deliver(0); item.clicks.BTN_NEW(); item.clicks.BTN_LEFT();
            results.push([item.game.active(), item.game.x, item.game.score]);
            await item.timer.advance(10500); results.push([item.game.active(), item.game.x, item.game.score]);
            item.deliver(100); item.clicks.BTN_PAUSE(); results.push([item.game.active(), item.game.x]);
            item.deliver(0); item.clicks.BTN_PAUSE(); results.push([item.game.active(), item.game.x]);
            return { results, grabs: item.grabs };
        };
        assert.deepStrictEqual(await outcome(after), await outcome(before), 'ID7 actual main decisions preserve original guards');
    } finally { before.cleanup(); after.cleanup(); }
}

async function vehiclePass() {
    for (const language of ['en', 'de']) {
        const appDir = path.join(PORT, 'apps/vehicle_pass'), timer = clock(), clicks = {}, images = [];
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-vehicle-pass-main-'));
        const model = require(path.join(appDir, 'model'));
        let impl, render, tab;
        const dependencies = { './kit/mgu': { run(value) { impl = value; } }, './kit/gauges': { frame() {} },
            './kit/themes': { THEMES: { m_tricolour: {} } }, './kit/i18n': { getLanguage: () => language }, './model': model, './text-font': {} };
        load(path.join(appDir, 'main.js'), dependencies, timer);
        try {
            await impl.start({ dataDir, log: quiet,
                ui: { onClick(name, fn) { clicks[name] = fn; }, text() {}, image(name, cv) { images.push(cv); return Promise.resolve(); } },
                settings: { onChange() {} }, onTab(fn) { tab = fn; }, onLayout() {},
                signals: new Proxy({}, { get() { throw new Error('Vehicle Pass must not request vehicle data'); } }),
                theme: () => ({ bg: '#000', text: '#fff', dim: '#888', warn: '#f00' }), canvas, loop(state, rate, fn) { render = fn; } });
            await render();
            assert.ok(images[0].words.includes(language === 'de' ? 'Übersicht' : 'Overview'));
            clicks.BTN_SAVE(); clicks.BTN_SAVE(); await render();
            const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'vehicle-pass.json')));
            assert.strictEqual(saved.entries.length, 1); assert.strictEqual(saved.entries[0].kind, 'oil');
            assert.strictEqual(saved.odometer, 0, 'mileage remains manually entered');
            assert.strictEqual(saved.tyres.summer.frontBar, null, 'no vehicle target pressure is invented');
            tab(3); await render();
            assert.ok(images[images.length - 1].words.includes(language === 'de' ? 'Fahrzeugprofil' : 'Vehicle profile'));
            assert.strictEqual(new model.Store(dataDir).data.entries.length, 1, 'navigation does not rewrite maintenance history');
        } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
    }
}

async function font() {
    const dir = path.join(PORT, 'apps/vehicle_pass');
    const fonts = { get: () => ({ fallback: true }) };
    load(path.join(dir, 'text-font.js'), { './kit/fonts': fonts, zlib: require('zlib'), './latin-font': require(path.join(dir, 'latin-font')) });
    assert.strictEqual(fonts.get('label', 24, 'plain').fallback, true);
    const atlas = fonts.get('label', 24, 'Öl Ääöüß');
    assert.strictEqual(atlas.family, 'vehicle_pass_latin'); assert.ok(atlas.alpha.length);
    for (const character of 'ÄäÖöÜüß') assert.ok(atlas.glyphs[character.codePointAt(0)], 'German glyph ' + character + ' retained independently of app language');
}

const groups = { blocks, vehiclePass, font };
(async () => { assert.ok(groups[GROUP]); await groups[GROUP](); console.log('PASS AppStudio application ' + GROUP + '; inert runtime and disposable local data only'); })()
    .catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
