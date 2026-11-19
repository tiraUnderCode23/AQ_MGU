'use strict';
/*
 * Light Logger: UDS over TASU, the head unit's own diagnostic transport, used the way BMW's ts_diagnostic_service
 * uses it (and the MIT-licensed idrive7-apps kit's kit/runtime/diag.js):
 *
 *   request  InternalTasu.sendTasuRequest { sourceAddress 0xF2, targetAddress, serviceID, subroutineID 0,
 *            udsDataLength, udsData = the bytes after the service id, deadlockTime 0 }
 *   reply    broadcast sendTasuResponse { udsResponse, errorCode }. The frame has a 9-byte header: [2] 0x7F =
 *            rejected by the transport (code in [4]), [6] = the address of the ECU that answered, the UDS reply
 *            from [9] on. 7F <sid> 78 = "response pending": the real reply comes later.
 *
 * Reads: check() lets through ReadDataByIdentifier (22) of one to MAX_DIDS identifiers to one ECU, nothing else.
 *
 * The one thing it may change (keeper.js, "keep the logos on", off until the driver switches it on): control()
 * lets through exactly these, to the body controller (0x40) only, and only for the one lamp output allowControl()
 * named (the output the driver pinned):
 *   10 03 / 10 01                 extended diagnostic session / back to the default session
 *   3E 00                         tester present (keeps the session)
 *   2F <ctl> <FORMATS[i].on>      hold that output on (shortTermAdjustment), <ctl> E3B5 (BDC_G05) or 4501 (BDC)
 *   2F <ctl> <FORMATS[i].back>    hand it back to the car (returnControlToECU)
 * FORMATS are the record layouts the keeper may try (a body controller answers NRC 13 to a length it doesn't
 * take): the kit's <control> <element> <state> first, then a 2-byte element, a trailing byte, a 2-byte state.
 * checkControl() refuses anything else before it reaches the car. If the app stops talking, the session times out
 * after a few seconds and the body controller takes the output back by itself. The SOME/IP side (link) is passed in: someip_link.js on the car, a fake in the tests.
 *
 *   const uds = new Uds(link, log);  await uds.init();
 *   const reply = await uds.read(0x40, [0xDA, 0x5F]);   // 62 DA 5F ... | 7F 22 xx | null (no answer)
 *   uds.read(0x40, [0xD1, 0x00, 0xD1, 0x01])            // several at once: 62 D1 00 <data> D1 01 <data>; the ECU
 *                                                       // leaves out the ones it doesn't have (7F 22 31: none)
 */
const EventEmitter = require('events');

const IFACE = 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu';
const INSTANCE = 'SystemFunctionsInternalTasuInst1';
const TESTER = 0xF2;
const READ = 0x22;
const MAX_DIDS = 8;

function toBytes(b) {
    if (!b) return [];
    if (Buffer.isBuffer(b) || b instanceof Uint8Array) return Array.prototype.slice.call(b);
    if (Array.isArray(b)) return b.slice();
    if (b.data) return toBytes(b.data);
    if (typeof b === 'object' && typeof b.length === 'number') return Array.prototype.slice.call(b);
    return [];
}

/* throws unless it is a single-ECU ReadDataByIdentifier */
function check(target, sid, data) {
    const byte = (x) => Number.isInteger(x) && x >= 0 && x <= 0xff;
    if (sid !== READ) throw new Error('read-only: service ' + sid + ' is not allowed');
    if (!byte(target) || target === 0xdf) throw new Error('read-only: one ECU only');
    if (!Array.isArray(data) || data.length < 2 || data.length > 2 * MAX_DIDS || data.length % 2 || !data.every(byte)) {
        throw new Error('read-only: 1 to ' + MAX_DIDS + ' identifiers');
    }
}

const BDC = 0x40;
const CONTROL_DIDS = [[0xe3, 0xb5], [0x45, 0x01]];
const FORMATS = [
    { name: '<control> <element> <state>', on: (el) => [0x03, el, 0x01], back: (el) => [0x00, el, 0x00] },
    { name: '<control> <element, 2 bytes> <state>', on: (el) => [0x03, 0x00, el, 0x01], back: (el) => [0x00, 0x00, el, 0x00] },
    { name: '<control> <element> <state> <one more byte>', on: (el) => [0x03, el, 0x01, 0x00], back: (el) => [0x00, el, 0x00, 0x00] },
    { name: '<control> <element> <state, 2 bytes>', on: (el) => [0x03, el, 0x00, 0x01], back: (el) => [0x00, el, 0x00, 0x00] },
];

/* throws unless it is one of the few requests the keeper may send (see the top of this file) */
function checkControl(target, sid, data, allowed) {
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (target !== BDC) throw new Error('control: the body controller only');
    if (!Array.isArray(data)) throw new Error('control: bad request');
    if (sid === 0x10 && (same(data, [0x03]) || same(data, [0x01]))) return;
    if (sid === 0x3e && same(data, [0x00])) return;
    if (sid === 0x2f) {
        if (!allowed) throw new Error('control: no output allowed');
        const did = CONTROL_DIDS.find((d) => d[0] === data[0] && d[1] === data[1]);
        if (!did) throw new Error('control: only the lamp output control identifiers');
        const rest = data.slice(2), el = allowed.element;
        if (FORMATS.some((f) => same(rest, f.on(el)) || same(rest, f.back(el)))) return;
        throw new Error('control: only the allowed lamp output, on or back to the car');
    }
    throw new Error('control: service ' + sid + ' is not allowed');
}

/* a sendTasuResponse value -> { ecu, uds } | { reject: code } | { error } | null */
function parseFrame(v) {
    const err = v && v.errorCode;
    if (err !== undefined && err !== null && err !== 'NO_ERROR' && err !== 0) return { error: String(err) };
    const b = toBytes(v && (v.udsResponse !== undefined ? v.udsResponse : v));
    if (b.length >= 5 && b[2] === 0x7f) return { reject: b[4] };
    if (b.length < 10) return null;
    return { ecu: b[6], uds: b.slice(9) };
}

/* the transport's verdict from a sendTasuRequest result */
function verdictOf(r) {
    if (r === undefined || r === null) return 'NO_ERROR';
    if (typeof r !== 'object') return String(r);
    if (r.TasuErrorEnum !== undefined) return String(r.TasuErrorEnum);
    const s = Object.keys(r).map((k) => r[k]).find((x) => typeof x === 'string' || typeof x === 'number');
    return s === undefined ? 'NO_ERROR' : String(s);
}
const accepted = (v) => v === 'NO_ERROR' || v === 'REQUEST_PENDING' || v === '0' || v === '1';

class Uds extends EventEmitter {
    constructor(link, log) {
        super();
        this.link = link; this.log = log;
        this.ready = false; this.error = null;
        this.sent = 0; this.answered = 0; this.missed = 0;
        this._queue = [];
        this._running = false;
        this._allowed = null;               // { element } the keeper may switch, null: none
    }

    init() {
        return this.link.open(IFACE, INSTANCE, { broadcasts: { sendTasuResponse: (v) => this._onFrame(v) } })
            .then(() => { this.ready = true; this.error = null; this.log.info('diagnostic link ready'); })
            .catch((e) => { this.error = (e && e.message) || String(e); throw e; });
    }

    _onFrame(v) {
        const f = parseFrame(v);
        if (!f) return;
        if (f.error) { this.emit('transportError', f.error); return; }
        if (f.reject !== undefined) { this.emit('reject', f.reject); return; }
        this.emit('frame', f);
    }

    /* one request at a time (the transport takes one at a time); urgent ones (the keeper's) go first */
    _enqueue(fn, urgent) {
        return new Promise((resolve, reject) => {
            const job = { fn: fn, resolve: resolve, reject: reject };
            if (urgent) this._queue.unshift(job); else this._queue.push(job);
            this._pump();
        });
    }
    _pump() {
        if (this._running || !this._queue.length) return;
        const job = this._queue.shift();
        this._running = true;
        let p;
        try { p = Promise.resolve(job.fn()); } catch (e) { p = Promise.reject(e); }
        p.then(job.resolve, job.reject).then(() => { this._running = false; this._pump(); });
    }

    /* Resolves with the ECU's UDS reply, or null when it didn't answer within timeoutMs (more after each
     * "pending"). Several identifiers: the reply starts with the first one the ECU has. */
    read(target, did, timeoutMs) {
        try { check(target, READ, did); } catch (e) { return Promise.reject(e); }
        const asked = (a, b) => { for (let i = 0; i < did.length; i += 2) if (did[i] === a && did[i + 1] === b) return true; return false; };
        return this._enqueue(() => this._request(target, READ, did, timeoutMs || 15000, (u) => asked(u[1], u[2])));
    }

    /* the keeper's few requests (checkControl); only for the output allowControl() named */
    allowControl(element) { this._allowed = Number.isInteger(element) && element >= 0 && element <= 255 ? { element: element } : null; }

    control(target, sid, data, timeoutMs) {
        try { checkControl(target, sid, data, this._allowed); } catch (e) { return Promise.reject(e); }
        const echo = sid === 0x2f ? (u) => u[1] === data[0] && u[2] === data[1] : sid === 0x10 ? (u) => u[1] === data[0] : () => true;
        return this._enqueue(() => this._request(target, sid, data, timeoutMs || 3000, echo), true);
    }

    _request(target, sid, data, timeoutMs, echo) {
        let timer, onFrame, onReject, finish, done = false;
        const got = new Promise((resolve) => {
            finish = (v) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                this.removeListener('frame', onFrame); this.removeListener('reject', onReject);
                resolve(v);
            };
            onFrame = (f) => {
                if (f.ecu !== target) return;
                const u = f.uds;
                if (u[0] === 0x7f && u[1] === sid && u[2] === 0x78) {      // pending: wait longer
                    clearTimeout(timer); timer = setTimeout(() => finish(null), timeoutMs);
                    return;
                }
                if (u[0] === sid + 0x40 && echo(u)) finish(u);
                else if (u[0] === 0x7f && u[1] === sid) finish(u);
            };
            onReject = () => finish(null);
            this.on('frame', onFrame); this.on('reject', onReject);
        });
        this.sent++;
        const req = {
            sourceAddress: TESTER, targetAddress: target, serviceID: sid, subroutineID: 0,
            udsDataLength: data.length, udsData: Buffer.from(data), deadlockTime: 0,
        };
        return Promise.resolve()
            .then(() => this.link.call(IFACE, 'sendTasuRequest', req, 8000))
            .then((r) => {
                const v = verdictOf(r);
                if (!accepted(v)) throw new Error('transport refused: ' + v);
                if (!done) timer = setTimeout(() => finish(null), timeoutMs);
                return got;
            }, (e) => { finish(null); throw e; })
            .then((u) => { if (u) this.answered++; else this.missed++; return u; });
    }
}

module.exports = { Uds, IFACE, INSTANCE, MAX_DIDS, BDC, CONTROL_DIDS, FORMATS, check, checkControl, parseFrame, verdictOf, toBytes };
