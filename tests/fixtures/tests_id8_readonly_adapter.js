'use strict';
// Inert tests: no SDK, native binding, socket, installer or vehicle service is loaded.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = process.argv[2], scenario = process.argv[3];
const port = path.join(root, process.argv[4]);
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

    // Deadline reporting must not free a still-pending SDK getter.
    let resolveRead, calls = 0, got = null, halted = 0;
    const hangClock = clock();
    const hangReader = load(path.join(port, 'kit/runtime/readonly_signals.js'), Object.assign({}, dependencies, {
        'oap-sdk': { someipBuilders: { async buildAndInitTypedProxy() { return {
            status: { subscribe() {}, getValue() { calls++; return new Promise((resolve) => { resolveRead = resolve; }); } },
            isAvailable() { return true; }, shutdown() { halted++; },
        }; } } },
    }), hangClock).forHmi('ID8');
    const hanging = await hangReader.watch('Example', 'hung', { status(v) { got = v; } }, log, { pollMs: 2000 });
    await flush(); assert.strictEqual(calls, 1);
    for (const [id, timer] of Array.from(hangClock.timers.entries())) if (timer.ms === 3500) { hangClock.timers.delete(id); timer.fn(); }
    assert.match(hanging.error, /timed out/); assert.strictEqual(hanging.available, false);
    for (let i = 0; i < 8; i++) { hangClock.now += 2000; hangClock.poll(); await flush(); }
    assert.strictEqual(calls, 1, 'hung getter must occupy its single slot beyond the reporting timeout');
    resolveRead({ value: 999 }); await flush();
    assert.strictEqual(got, null, 'late timed-out result cannot become a fresh sample'); assert.match(hanging.error, /timed out/);
    hangClock.poll(); await flush(); assert.strictEqual(calls, 2, 'polling recovers only after the original request settles');
    resolveRead({ value: 44 }); await flush(); assert.strictEqual(got.value, 44); assert.strictEqual(hanging.available, true);
    hangClock.poll(); await flush(); assert.strictEqual(calls, 3);
    await hanging.shutdown(); assert.strictEqual(hangClock.intervals.size, 0); assert.strictEqual(hangClock.timers.size, 0);
    resolveRead({ value: 888 }); await flush(); assert.strictEqual(got.value, 44); assert.strictEqual(halted, 1);

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

adapter().then(()=>process.stdout.write('PASS adapter\n')).catch((e)=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
