'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.argv[2], scenario = process.argv[3];
const port = path.join(root, 'apps/_ports/maxxxfoka-idrive8');
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
function runtime() {
    let id = 0; const timers = new Map(), clock = { now: 1700000000000 };
    clock.Date = class extends Date { static now() { return clock.now; } };
    clock.setInterval = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
    clock.clearInterval = (token) => timers.delete(token); clock.timers = timers;
    clock.setTimeout = clock.setInterval; clock.clearTimeout = clock.clearInterval;
    return clock;
}
function load(file, dependencies, clock) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(file), Date: clock.Date,
        setImmediate, setInterval: clock.setInterval, clearInterval: clock.clearInterval,
        setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
        process: { hrtime() { return [Math.floor(clock.now / 1000), clock.now % 1000 * 1e6]; } },
        require(name) { if (!(name in dependencies)) throw new Error('Forbidden import: ' + name); return dependencies[name]; },
    }, { filename: file }); return module.exports;
}
async function shell() {
    const c = runtime(), visibleFns = [], appEvents = {}, subscriptions = [], handlers = [], buttons = [], chips = [];
    let visible = true, entry, draw, touch, tap, knob, creations = 0, updates = 0, inputs = 0, pauses = 0;
    const reader = { watch(iface, instance, values, log, opts) {
        assert.strictEqual(iface, 'de.bmw.infotainment.vehicle.Vehicle2'); assert.strictEqual(instance, '1');
        assert.deepStrictEqual(Object.keys(values), ['statusCarSpeed2']); assert.strictEqual(opts.pollMs, 2000);
        const sub = { ok: false, closed: false, fresh() { return this.ok && !this.closed; }, shutdown() { this.closed = true; } };
        subscriptions.push(sub); handlers.push(values); return Promise.resolve(sub);
    } };
    const guard = load(path.join(port, 'kit/runtime/parked_id8.js'), {
        './readonly_signals': { forHmi(hmi) { assert.strictEqual(hmi, 'ID8'); return reader; } },
    }, c);
    const realStyle = require(path.join(port, 'apps/parked_games/style.js'));
    const style = Object.assign({}, realStyle, { backdrop() {}, panel() {}, vignette() {}, glowCircle() {}, label() {}, chip(cv, text) { chips.push(text); } });
    const game = { id: 'fixture', title: 'Fixture game', score: {}, create(api) {
        creations++; assert.strictEqual(api.controllerAvailable(), false);
        return { update() { updates++; }, draw() {}, input() { inputs++; }, pause() { pauses++; }, resume() {} };
    } };
    const canvas = new Proxy({ target(x, y, w, h, fn, key) { buttons.push({ fn, key }); return canvas; },
        textWidth(text, size) { return String(text).length * size / 2; } }, { get(obj, key) { return key in obj ? obj[key] : () => canvas; } });
    const ui = { id8: true, isVisible(name) { return visible && name === 'MAIN'; }, hasFocus() { return true; },
        onVisible(fn) { visibleFns.push(fn); }, onFocus() {}, async image() {} };
    const ctx = { ui, log: { info() {}, warn() {}, error(msg) { throw new Error(msg); } }, dataDir: '/fixture',
        app: { on(name, fn) { appEvents[name] = fn; } }, display: { ctl() { return false; } },
        signals: { watch() { throw new Error('ID8 must not open legacy/raw controller or speed readers'); } },
        theme() { return {}; }, canvas() { return canvas; }, onTab() {},
        controller: { onInput(fn) { knob = fn; }, grab(on) { assert.strictEqual(on, false, 'no controller gate means no grab'); } },
        onTouch(fn) { touch = fn; }, onTap(fn) { tap = fn; }, loop(name, fps, fn) { draw = fn; },
    };
    load(path.join(port, 'apps/parked_games/main.js'), {
        path, './kit/mgu': { run(value) { entry = value; } },
        './kit/parked': { watch() { throw new Error('Unknown-as-parked legacy gate is forbidden for ID8'); } },
        './kit/parked_id8': guard, './kit/gauges': { frame() {}, TOP: 38, pageBottom() { return 520; } },
        './vehicle': { Vehicle: class {} }, './controls': { Controller: class { feed() { return [{ type: 'press' }]; } } },
        './registry': { load() { return [game]; }, Scores: class { best() { return null; } top() { return []; } }, Store: class { forGame() { return {}; } } },
        './style': style,
    }, c);
    await entry.start(ctx); await flush();
    const frame = async () => { buttons.length = 0; await draw(); };
    const open = () => { const target = buttons.find((b) => b.key === 'fixture'); assert(target); target.fn(); };
    const sample = (raw) => { const i = handlers.length - 1; subscriptions[i].ok = true; handlers[i].statusCarSpeed2({ speedVehicleCentreOfGravity: raw }); };
    await frame(); open(); await frame(); assert.strictEqual(creations, 0); assert(chips.some((s) => /unavailable/.test(s)));
    sample(0); await frame(); open(); c.now += 800; await frame(); assert.strictEqual(creations, 1); assert(updates > 0);
    touch(1, 400, 300); assert.strictEqual(inputs, 1); knob({}); assert.strictEqual(inputs, 1, 'raw knob cannot act through absent gate');
    subscriptions[0].ok = false; const before = updates; touch(1, 400, 300); await frame();
    assert.strictEqual(inputs, 1); assert.strictEqual(updates, before); assert(pauses > 0);
    sample(193); await frame(); open(); assert.strictEqual(creations, 1, 'above original 3km/h threshold blocks opening');
    sample(0); c.now += 6001; await frame(); open(); assert.strictEqual(updates, before, 'stale zero does not permit play');
    sample(0); c.now -= 1; await frame(); open(); assert.strictEqual(updates, before, 'clock rollback cannot extend a parked reading');
    sample(65535); await frame(); open(); assert.strictEqual(updates, before);
    sample(-1); await frame(); open(); assert.strictEqual(updates, before);
    visible = false; visibleFns.forEach((fn) => fn('MAIN', false)); await flush(); assert.strictEqual(subscriptions[0].closed, true);
    visible = true; visibleFns.forEach((fn) => fn('MAIN', true)); await flush(); assert.strictEqual(subscriptions.length, 2);
    handlers[0].statusCarSpeed2({ speedVehicleCentreOfGravity: 0 }); await frame(); open(); assert.strictEqual(updates, before, 'late reading from stopped subscription rejected');
    visibleFns.forEach((fn) => fn('MAIN', true)); appEvents.shutdown(); await flush();
    assert.strictEqual(subscriptions[1].closed, true); assert.strictEqual(subscriptions.length, 2); assert.strictEqual(c.timers.size, 0);
}
async function multiplayer() {
    const style = require(path.join(port, 'apps/parked_games/style.js'));
    let available = false;
    const api = { style, theme() { return {}; }, random: () => 0.5, now: () => 0, controllerAvailable: () => available,
        store: { get() {}, set() {} }, best: () => null, top: () => [], end() {}, log: { info() {} } };
    const paddle = require(path.join(port, 'apps/parked_games/games/paddle-duel/index.js')).create(api);
    paddle.two = true; paddle.start(); assert.strictEqual(paddle.setup, true); assert.match(paddle.inputNotice, /requires a supported controller/);
    paddle.two = false; paddle.start(); assert.strictEqual(paddle.setup, false);
    paddle.input({ type: 'touch', phase: 'move', x: paddle.side === 'L' ? 1500 : 100, y: 250 });
    assert.strictEqual(paddle.joined, false, 'second-player join cannot strand the first player without knob control');
    available = true; paddle.setup = true; paddle.two = true; paddle.start(); assert.strictEqual(paddle.setup, false); assert.strictEqual(paddle.joined, true);
    available = false;
    const chess = require(path.join(port, 'apps/parked_games/games/chess/index.js')).create(api);
    chess.prefs.mode = 'friend'; chess.start(null); assert.strictEqual(chess.state, 'setup'); assert.match(chess.inputNotice, /requires a supported controller/);
    chess.prefs.mode = 'computer'; chess.start(null); assert.strictEqual(chess.state, 'play');
    chess.state = 'setup'; chess.start({ mode: 'friend', moves: [] }); assert.strictEqual(chess.state, 'setup', 'saved multiplayer must be checked too');
    available = true; chess.start({ mode: 'friend', moves: [] }); assert.strictEqual(chess.state, 'play');
}
({ shell, multiplayer }[scenario])().then(() => process.stdout.write('PASS ' + scenario + '\n'))
    .catch((e) => { process.stderr.write(e.stack + '\n'); process.exitCode = 1; });
