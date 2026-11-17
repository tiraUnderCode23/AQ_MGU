'use strict';
// Runs under the installed OAP app's UID with its generated SOME/IP config.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
// App launchers can add /usr/lib to Node's lookup paths. This standalone
// service has no launcher, and ID7 ships the binding directly at this path.
function loadSomeip(root, resolve, load) {
    resolve = resolve || require.resolve; load = load || require;
    let file;
    try { file = resolve('someip', { paths: [path.join(root, 'source')] }); }
    catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; file = '/usr/lib/someip.node'; }
    return load(file);
}
function pack(type, body) {
    const b = Buffer.alloc(6 + body.length);
    b.writeUInt32BE(body.length, 0); b.writeUInt16BE(type, 4); body.copy(b, 6);
    return b;
}
function matches(uds, request) {
    if (uds[0] === 0x7f) return uds[1] === request[0];
    if (uds[0] !== request[0] + 0x40) return false;
    const subfunction = [0x10, 0x19, 0x3e].indexOf(request[0]) >= 0;
    const count = [0x2c, 0x31].indexOf(request[0]) >= 0 ? 3 : request[0] === 0x22 ? 2 : [0x01, 0x09, 0x10, 0x19, 0x1a, 0x21, 0x3e].indexOf(request[0]) >= 0 ? 1 : 0;
    return request.slice(1, 1 + count).every((v, i) => uds[i + 1] === (subfunction && i === 0 ? v & 0x7f : v));
}

const verdicts = ['NO_ERROR', 'REQUEST_PENDING', 'TAS_CONNECTION_ERROR', 'TIMEOUT_ERROR', 'DEACTIVATED',
    'INVALID_REQUEST', 'INVALID_LENGTH', 'APP_REQUEST_TEMPORARILY_NOT_ACCEPTED', 'INVALID_SESSION',
    'EXCLUSIVE_MODE_REQUESTED', 'EXCLUSIVE_MODE_OCCUPIED', 'EXCLUSIVE_MODE_ACTIVE', 'EXCLUSIVE_MODE_PENDING', 'WRONG_IDENTIFIER'];
function methodVerdict(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return verdicts[value] || 'INVALID_VERDICT';
    if (typeof value === 'string' && /^(?:[0-9]|1[0-3])$/.test(value)) return verdicts[Number(value)];
    return verdicts.indexOf(value) >= 0 ? value : 'INVALID_VERDICT';
}

// One provider request owns the reply stream. Client pipelining is bounded
// and serialized, including functional-response collection and pending replies.
function createSession(proxy, emit, options) {
    options = options || {};
    const quietMs = options.quietMs || 1000, replyMs = options.replyMs || 10000;
    let active = null, idle, hard, retry, cancelRetry, lockWait, turn, available = false, stopped = false, draining = false;
    const queue = [];
    let chain = Promise.resolve();
    const tick = fn => {
        const p = chain.then(() => new Promise((resolve, reject) => setImmediate(() => {
            try { Promise.resolve(fn()).then(resolve, reject); } catch (e) { reject(e); }
        })));
        chain = p.catch(() => {}); return p;
    };
    function release() { if (turn) { turn.release(); turn = null; } }
    function clear() {
        clearTimeout(idle); clearTimeout(hard);
        // Private probe completion is separate from ENET data. A functional
        // VIN probe must drain every ECU reply before another request starts.
        if (active && active.reportComplete) emit({ type: 'probe_done' });
        release(); active = null; idle = hard = null; setImmediate(drain);
    }
    function stop() {
        stopped = true; queue.length = 0;
        clearTimeout(idle); clearTimeout(hard); clearTimeout(retry);
        if (cancelRetry) cancelRetry();
        if (lockWait && lockWait.cancel) lockWait.cancel();
        release();
        active = null;
    }
    function fail(code) { if (stopped) return; stop(); emit({ type: 'error', code: typeof code === 'string' ? code : 'transport_failed' }); }
    function reply(value) {
        if (stopped) return;
        if (!active || active.waitingRetry || !active.owned) { emit({ type: 'tasu_trace', stage: 'unowned' }); return; }
        if (!value || typeof value !== 'object') return fail('malformed_reply');
        const raw = value.udsResponse;
        let b = Buffer.from(raw && raw.data || raw || []);
        const eventVerdict = value.errorCode === undefined ? 'NO_ERROR' : methodVerdict(value.errorCode);
        const pendingVerdict = eventVerdict === 'REQUEST_PENDING';
        // The descriptor supplies both a ByteBuffer and its populated length.
        // Exclude backing-buffer padding, and never read beyond native data.
        if (!pendingVerdict && value.udsResponseLength !== undefined) {
            const length = value.udsResponseLength;
            if (!Number.isInteger(length) || length < 0 || length > b.length) return fail('malformed_reply');
            b = b.slice(0, length);
        }
        emit({ type: 'tasu_trace', stage: 'event', target: b.length >= 7 ? b[6] : 0,
            sid: b.length >= 10 ? b[9] : 0, identifier: b.length >= 12 && b[9] === 0x62 ? b.readUInt16BE(10) : 0,
            size: b.length });
        if (pendingVerdict) {
            emit({ type: 'tasu_trace', stage: 'provider_pending' });
            const req = active;
            clearTimeout(idle);
            idle = setTimeout(() => { if (active === req) fail('ecu_timeout'); }, replyMs);
            return;
        }
        if (eventVerdict !== 'NO_ERROR') return fail(eventVerdict === 'INVALID_VERDICT' ? 'malformed_reply' : verdictError(eventVerdict));
        if (b.length >= 5 && b[2] === 0x7f) return fail('transport_rejected');
        if (b.length < 10) return fail('malformed_reply');
        const req = active, uds = Array.prototype.slice.call(b.slice(9));
        if (uds[0] === 0x7f && uds.length < 3) return fail('malformed_reply');
        if (req.target !== 0xdf && req.target !== b[6]) { emit({ type: 'tasu_trace', stage: 'other_ecu' }); return; }
        if (!matches(uds, req.uds)) { emit({ type: 'tasu_trace', stage: 'other_reply' }); return; }
        emit({ type: 'tasu_trace', stage: 'matched' });
        const response = pack(1, Buffer.concat([Buffer.from([b[6], req.tester]), b.slice(9)]));
        if (!req.accepted) req.buffer.push(response); else emit({ type: 'frame', hex: response.toString('hex') });
        if (req.buffer.length > 32) return fail();
        const pending = uds[0] === 0x7f && uds[2] === 0x78;
        clearTimeout(idle); idle = null;
        if (pending) idle = setTimeout(() => fail('ecu_timeout'), replyMs);
        else if (req.target === 0xdf) {
            req.complete = false;
            idle = setTimeout(() => { if (active === req) { req.complete = true; if (req.accepted) clear(); } }, req.reportComplete ? (options.probeQuietMs || 4000) : quietMs);
        }
        else req.complete = true;
        if (req.complete && req.accepted) clear();
    }
    async function drain() {
        if (stopped || draining || active || !queue.length || !available) return;
        draining = true;
        const queued = queue.shift(), b = queued.frame;
        const req = { tester: b[6], target: b[7], uds: Array.prototype.slice.call(b.slice(8)), buffer: [], accepted: false, complete: false, reportComplete: queued.reportComplete };
        active = req;
        try {
            // A busy verdict means TASU did not accept the request. Only that
            // verdict can be retried. An accepted diagnostic is sent once.
            for (let attempt = 0; ; attempt++) {
                lockWait = options.acquire ? options.acquire() : Promise.resolve({ release() {} });
                const acquired = await lockWait;
                lockWait = null;
                if (stopped || active !== req) { acquired.release(); return; }
                turn = acquired;
                if (turn.lost) turn.lost.catch(() => { if (turn === acquired) fail('coordinator_lost'); });
                req.owned = true;
                emit({ type: 'tasu_trace', stage: 'request', target: req.target, sid: req.uds[0] });
                hard = setTimeout(() => fail('request_timeout'), 60000);
                const r = await tick(() => proxy.callMethod('sendTasuRequest', {
                    sourceAddress: 0xf2, targetAddress: req.target, serviceID: req.uds[0], subroutineID: 0,
                    udsDataLength: req.uds.length - 1, udsData: Buffer.from(req.uds.slice(1)), deadlockTime: 0,
                }, 8000));
                if (stopped || active !== req) return;
                const v = methodVerdict(r && typeof r === 'object' ? r.TasuErrorEnum : r);
                emit({ type: 'tasu_trace', stage: 'verdict', code: v });
                if (v === 'INVALID_VERDICT') return fail('method_verdict_invalid');
                const busy = v === 'APP_REQUEST_TEMPORARILY_NOT_ACCEPTED';
                if (busy && attempt < 4) {
                    req.owned = false;
                    clearTimeout(hard); hard = null;
                    release();
                    req.buffer.length = 0;
                    req.complete = false;
                    req.waitingRetry = true;
                    clearTimeout(idle); idle = null;
                    await new Promise(resolve => {
                        cancelRetry = resolve;
                        retry = setTimeout(resolve, (options.busyRetryMs || 1000) * (attempt + 1));
                    });
                    cancelRetry = null;
                    if (stopped || active !== req) return;
                    req.waitingRetry = false;
                    continue;
                }
                if (v !== 'NO_ERROR' && v !== 'REQUEST_PENDING') {
                    return fail(verdictError(v));
                }
                break;
            }
            if (stopped) return;
            if (active !== req) throw new Error('request expired');
            req.accepted = true;
            emit({ type: 'frame', hex: pack(2, b.slice(6)).toString('hex') });
            req.buffer.forEach(response => emit({ type: 'frame', hex: response.toString('hex') }));
            const suppressed = [0x10, 0x3e].indexOf(req.uds[0]) >= 0 && (req.uds[1] & 0x80) !== 0;
            if (req.complete || suppressed) clear();
            else if (!idle) idle = setTimeout(() => { if (active === req) { if (req.target === 0xdf) clear(); else fail('ecu_timeout'); } }, req.target === 0xdf ? (req.reportComplete ? 6000 : quietMs * 4) : replyMs);
        } catch (e) { fail(req.owned ? 'request_refused' : 'coordinator_unavailable'); }
        finally { draining = false; if (!active) setImmediate(drain); }
    }
    function enqueue(hex, reportComplete) {
        if (stopped || typeof hex !== 'string' || hex.length > 2 * 1048582 || !/^(?:[0-9a-f]{2})+$/i.test(hex)) return fail();
        const b = Buffer.from(hex, 'hex');
        if (b.length < 9 || b.readUInt16BE(4) !== 1 || b.readUInt32BE(0) !== b.length - 6 || queue.length >= 16) return fail();
        queue.push({ frame: b, reportComplete: reportComplete === true && b[7] === 0xdf && b[8] === 0x22 && b.length === 11 && b[9] === 0xf1 && b[10] === 0x90 }); drain();
    }
    function availability(a) { if (stopped) return; available = !!a; if (available) { emit({ type: 'ready' }); drain(); } else if (active || queue.length) fail('provider_unavailable'); }
    return { enqueue, reply, availability, stop, tick };
}

// A subscription's initial callback can be queued before a newer availability
// snapshot. Re-read current state on the serialized native tick, so a delayed
// initial false cannot tear down a request started after isAvailable() was true.
async function monitorAvailability(proxy, session) {
    let generation = 0;
    function refresh(fallback) {
        const mine = ++generation;
        return session.tick(() => {
            if (mine !== generation) return;
            const current = typeof proxy.isAvailable === 'function' ? proxy.isAvailable() : fallback;
            session.availability(!!current);
        });
    }
    await session.tick(() => proxy.subscribeToAvailability(value => {
        refresh(value).catch(() => session.availability(false));
    }));
    if (typeof proxy.isAvailable === 'function') await refresh(false);
}

function verdictError(value) {
    switch (String(value)) {
        case '7': case 'APP_REQUEST_TEMPORARILY_NOT_ACCEPTED': return 'request_busy';
        case '3': case 'TIMEOUT_ERROR': return 'method_timeout';
        case '2': case 'TAS_CONNECTION_ERROR': return 'tas_connection_error';
        case '5': case 'INVALID_REQUEST': return 'invalid_request';
        case '6': case 'INVALID_LENGTH': return 'invalid_length';
        case '13': case 'WRONG_IDENTIFIER': return 'wrong_identifier';
        case '4': case 'DEACTIVATED': return 'diagnostics_deactivated';
        case '8': case 'INVALID_SESSION': return 'invalid_session';
        case '9': case '10': case '11': case '12':
        case 'EXCLUSIVE_MODE_REQUESTED': case 'EXCLUSIVE_MODE_OCCUPIED':
        case 'EXCLUSIVE_MODE_ACTIVE': case 'EXCLUSIVE_MODE_PENDING': return 'exclusive_mode';
        default: return 'request_refused';
    }
}

async function start() {
    const root = process.argv[1], emit = value => process.stdout.write('HUOBD:' + JSON.stringify(value) + '\n');
    let cfg, someip, proxy;
    function startupFailure(code) { emit({ type: 'error', code }); process.exit(1); }
    try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'someipInterfaces', 'com_harman_infotainment_systemfunctions_tasu_tasu_InternalTasu.json'), 'utf8')); }
    catch (e) { return startupFailure('config_invalid'); }
    try { someip = loadSomeip(root); }
    catch (e) { return startupFailure('module_load_failed'); }
    try { proxy = await new Promise((resolve, reject) => setImmediate(() => {
        try { someip.buildProxy(cfg, 'SystemFunctionsInternalTasuInst1').then(p => p.init().then(() => p)).then(resolve, reject); }
        catch (e) { reject(e); }
    })); } catch (e) { return startupFailure('proxy_init_failed'); }
    const session = createSession(proxy, m => { emit(m); if (m.type === 'error') { process.exitCode = 1; process.stdin.destroy(); } },
        { acquire: () => sharedTASU.acquire({ socket: process.env.HUOBD_TASU_LOCK_SOCKET }) });
    try {
        await session.tick(() => proxy.subscribe({ name: 'sendTasuResponse', onReceive: session.reply }));
        await monitorAvailability(proxy, session);
    } catch (e) { return startupFailure('subscribe_failed'); }
    const lines = readline.createInterface({ input: process.stdin });
    lines.on('line', line => { try { const value = JSON.parse(line); session.enqueue(value.hex, value.reportComplete); } catch (e) { emit({ type: 'error' }); process.stdin.destroy(); } });
    lines.on('close', () => { session.stop(); if (proxy.shutdown) Promise.resolve(proxy.shutdown()).then(() => process.exit(0), () => process.exit(1)); else process.exit(0); });
}
module.exports = { pack, matches, createSession, loadSomeip, methodVerdict, monitorAvailability };
if (!module.parent) {
    const fail = () => { process.stdout.write('HUOBD:{"type":"error"}\n'); process.exit(1); };
    process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
    start().catch(fail);
}
