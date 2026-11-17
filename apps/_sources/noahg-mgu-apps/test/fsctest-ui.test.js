'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = require('../apps/noahg_fscpatcher/app.json');

function loadApp(request) {
    let implementation, shutdown, onVisible, onFocus, screen;
    let now = 0, timerId = 0;
    const callbacks = {}, rows = {}, timers = new Map();
    const screens = new Set(app.screens.map(screen => screen.name));
    const buttons = new Set(app.screens.flatMap(screen => screen.items.filter(([kind]) => kind === 'button').map(([, name]) => name)));
    const components = new Set(app.screens.flatMap(screen => screen.items.map(([, name]) => name)));
    const ctx = {
        spec: app, onShutdown: fn => { shutdown = fn; },
        ui: {
            onClick(name, fn) { assert.ok(buttons.has(name), 'Undeclared RHMI button: ' + name); callbacks[name] = fn; },
            text(name, value) { assert.ok(components.has(name), 'Undeclared RHMI row: ' + name); rows[name] = value; },
            open(name) { assert.ok(screens.has(name)); screen = name; },
            onVisible: fn => { onVisible = fn; },
            onFocus: fn => { onFocus = fn; },
        },
    };
    const filename = path.resolve(__dirname, '../apps/noahg_fscpatcher/main.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        require(name) {
            if (name === './kit/mgu') return { run: impl => { implementation = impl; } };
            if (name === './client') return { request };
            throw new Error('Unexpected require: ' + name);
        },
        Date: { now: () => now },
        setTimeout(fn, ms) { timers.set(++timerId, { fn, at: now + ms }); return timerId; },
        clearTimeout(id) { timers.delete(id); },
    }, { filename });
    implementation.start(ctx);
    return {
        callbacks, rows, timers,
        hide: () => onVisible('MAIN', false),
        show: () => onVisible('MAIN', true),
        blur: () => onFocus('MAIN', false),
        shutdown: () => shutdown(),
        screen: () => screen,
        async advance(ms) {
            now += ms;
            for (const [id, timer] of Array.from(timers)) {
                if (timers.has(id) && timer.at <= now) {
                    timers.delete(id);
                    await timer.fn();
                }
            }
        },
    };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const stockStatus = () => ({
    version: '0.1.1',
    binary: { path: '/usr/bin/BAC4x_VSTAR_i386_Eth_Application.out', sha256: 'aaaaaaaaaaaaaaaa', offset: 2592708, state: 'stock' },
    block: { sha256: 'bbbbbbbbbbbbbbbb', state: 'other' },
    binaryBackup: false, blockBackup: false,
});

test('a previous signing key is reported as requiring a patch update', async () => {
    const t = loadApp(async () => ({ ...stockStatus(), binary: {
        ...stockStatus().binary, state: 'patched', trust: 'oem-and-local',
        keyUpdateRequired: true, signingKeySha256: 'previous-local-key',
    } }));
    await flush();
    assert.equal(t.rows.STATUS, 'Signing key update required');
    assert.match(t.rows.DETAIL_TEXT, /Local key SHA-256: previous-local-key/);
    t.shutdown();
});

test('restart uses a separate expiring confirmation and reports NSM failure', async () => {
    const calls = [];
    const t = loadApp(async (method, endpoint) => {
        if (method === 'POST') { calls.push(endpoint); throw new Error('head unit refused restart: Busy'); }
        return stockStatus();
    });
    await flush();
    await t.callbacks.BTN_RESTART();
    assert.equal(t.rows.BTN_RESTART, 'Confirm restart');
    assert.match(t.rows.STATUS, /Park safely/);
    assert.deepEqual(calls, []);
    await t.advance(8000);
    assert.equal(t.rows.BTN_RESTART, 'Restart iDrive');
    await t.callbacks.BTN_RESTART();
    t.hide();
    await t.callbacks.BTN_RESTART();
    assert.deepEqual(calls, []);
    await t.callbacks.BTN_RESTART();
    assert.deepEqual(calls, ['/restart']);
    assert.match(t.rows.STATUS, /refused restart: Busy/);
    t.shutdown();
});

test('legacy key swap is identified and pending support block is visible', async () => {
    const t = loadApp(async () => ({ ...stockStatus(), blockPending: true,
        binary: { ...stockStatus().binary, state: 'patched', trust: 'replacement-only' } }));
    await flush();
    assert.equal(t.rows.STATUS, 'Legacy patch');
    assert.match(t.rows.DETAIL_TEXT, /Keys: Local only/);
    assert.match(t.rows.DETAIL_TEXT, /Support block: Pending/);
    t.shutdown();
});

test('FSC Patch exposes its actions as native menu buttons and refreshes once', async () => {
    const calls = [];
    const t = loadApp(async (method, endpoint) => {
        calls.push(method + ' ' + endpoint);
        return stockStatus();
    });
    await flush();
    assert.equal(app.screens[0].kind, 'menu');
    assert.equal(t.rows.STATUS, 'Stock');
    assert.match(t.rows.DETAIL_TEXT, /SHA-256: aaaaaaaaaaaa/);
    assert.match(t.rows.DETAIL_TEXT, /Service 0\.1\.1/);
    await t.callbacks.BTN_DETAILS();
    assert.equal(t.screen(), 'DETAILS');
    await t.callbacks.BTN_REFRESH();
    assert.deepEqual(calls, ['GET /status', 'GET /status']);
    t.shutdown();
    assert.equal(t.timers.size, 0);
});

test('confirmation expires or cancels when the user leaves, refreshes, or changes actions', async () => {
    const writes = [];
    const t = loadApp(async (method, endpoint) => {
        if (method === 'POST') writes.push(endpoint);
        return stockStatus();
    });
    await flush();
    await t.callbacks.BTN_PATCH();
    assert.equal(t.rows.BTN_PATCH, 'Confirm patch');
    assert.equal(t.rows.STATUS, 'Press again to confirm.');
    await t.advance(8000);
    assert.equal(t.rows.BTN_PATCH, 'Patch');
    await t.callbacks.BTN_PATCH();
    t.blur();
    await t.callbacks.BTN_PATCH();
    t.hide();
    await t.callbacks.BTN_PATCH();
    await t.callbacks.BTN_REFRESH();
    await t.callbacks.BTN_PATCH();
    await t.callbacks.BTN_DETAILS();
    await t.callbacks.BTN_PATCH();
    await t.callbacks.BTN_RESTORE();
    assert.equal(t.rows.BTN_PATCH, 'Patch');
    assert.equal(t.rows.BTN_RESTORE, 'Confirm restore');
    assert.deepEqual(writes, []);
    await t.callbacks.BTN_RESTORE();
    assert.deepEqual(writes, ['/restore']);
    t.shutdown();
    assert.equal(t.timers.size, 0);
});

test('a confirmed write waits for a pending status poll and keeps the error visible', async () => {
    let reads = 0, finishPoll;
    const writes = [];
    const t = loadApp(async (method, endpoint) => {
        if (method === 'POST') {
            writes.push(endpoint);
            throw new Error('Operation rejected by service');
        }
        if (++reads === 2) return new Promise(resolve => { finishPoll = resolve; });
        return { ...stockStatus(), binary: { ...stockStatus().binary, state: 'patched' } };
    });
    await flush();
    const poll = t.advance(2000);
    await t.callbacks.BTN_RESTORE();
    const action = t.callbacks.BTN_RESTORE();
    assert.deepEqual(writes, []);
    finishPoll({ ...stockStatus(), binary: { ...stockStatus().binary, state: 'patched' } });
    await Promise.all([poll, action]);
    assert.deepEqual(writes, ['/restore']);
    assert.equal(t.rows.STATUS, 'Operation rejected by service');
    assert.equal(t.rows.BTN_RESTORE, 'Restore backup');
    t.shutdown();
});

test('a missing service is reported and the app recovers on the next refresh', async () => {
    let available = false;
    const t = loadApp(async () => {
        if (!available) throw new Error('connect ECONNREFUSED');
        return stockStatus();
    });
    await flush();
    assert.match(t.rows.STATUS, /Service unavailable.*ECONNREFUSED/);
    await t.callbacks.BTN_PATCH();
    assert.equal(t.rows.BTN_PATCH, 'Patch');
    available = true;
    await t.advance(2000);
    assert.equal(t.rows.STATUS, 'Stock');
    t.shutdown();
});

test('confirmation is cancelled when the service state changes during a poll', async () => {
    let changed = false;
    const writes = [];
    const t = loadApp(async (method, endpoint) => {
        if (method === 'POST') writes.push(endpoint);
        const status = stockStatus();
        if (changed) status.binary.sha256 = 'new binary';
        return status;
    });
    await flush();
    await t.callbacks.BTN_PATCH();
    changed = true;
    await t.advance(2000);
    assert.equal(t.rows.BTN_PATCH, 'Patch');
    assert.match(t.rows.STATUS, /State changed/);
    await t.callbacks.BTN_PATCH();
    assert.deepEqual(writes, []);
    t.shutdown();
});

test('long failures remain readable in scrollable details and shutdown prevents late writes', async () => {
    let finishPoll, reads = 0;
    const writes = [];
    const t = loadApp(async (method, endpoint) => {
        if (method === 'POST') writes.push(endpoint);
        if (++reads === 2) return new Promise(resolve => { finishPoll = resolve; });
        return stockStatus();
    });
    await flush();
    const pending = t.advance(2000);
    await t.callbacks.BTN_PATCH();
    const action = t.callbacks.BTN_PATCH();
    t.shutdown();
    finishPoll(stockStatus());
    await Promise.all([pending, action]);
    assert.deepEqual(writes, []);
    assert.equal(t.timers.size, 0);

    const longError = 'Cannot make filesystem writable. ' + 'diagnostic detail '.repeat(40);
    const detail = loadApp(async (method) => {
        if (method === 'POST') throw new Error(longError);
        return stockStatus();
    });
    await flush();
    await detail.callbacks.BTN_PATCH();
    await detail.callbacks.BTN_PATCH();
    await detail.callbacks.BTN_DETAILS();
    assert.ok(detail.rows.DETAIL_TEXT.includes(longError));
    assert.equal(app.screens[1].items[0][0], 'scroll');
    detail.shutdown();
});


test('support-block differences do not mislabel the working FSC verifier', async () => {
    for (const [blockState, expected] of [
        ['other', 'Modified'],
        ['patched', 'Ready'],
        ['absent', 'Missing'],
    ]) {
        const t = loadApp(async () => ({ ...stockStatus(),
            binary: { ...stockStatus().binary, state: 'patched', trust: 'oem-and-local' },
            block: { ...stockStatus().block, state: blockState },
        }));
        await flush();
        assert.equal(t.rows.STATUS, 'Patched');
        assert.ok(t.rows.DETAIL_TEXT.includes('Support block: ' + expected));
        assert.doesNotMatch(t.rows.DETAIL_TEXT, /Support block: unpatched/);
        t.shutdown();
    }
});
