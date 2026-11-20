'use strict';
const { Diag, replyTo, NRC } = require('./tasu');
const P = require('./protocol');
const F = require('./flm-control');
const R = require('./rlm-control');

// Addresses the vehicle scan may ask for their identity (BimmerLight's light-module set for
// G-series: gateway, rear light modules, body, headlamps, older footwell/rear modules).
const SCAN_ADDRESSES = Object.freeze([0x10, 0x17, 0x1A, 0x1C, 0x1E, 0x40, 0x43, 0x44, 0x72]);

class Link {
    constructor(signals, log, changed, options) {
        this.allowExperimental = (options && options.allowExperimental) || (() => false);
        this.diag = new Diag(signals, log); this.diag.quiet = true;
        this.log = log; this.changed = changed || (() => {});
        this.available = false; this.index = null; this.identifiedAt = 0;
        this.trace = []; this._busy = false;
        this.verifiedFlm = {}; this.verifiedRlm = {}; this.body = null;
    }
    async init() {
        await this.diag.init(); this.available = this.diag.available;
        this.diag.on('available', (up) => {
            this.available = !!up; this.index = null; this.identifiedAt = 0; this.verifiedFlm = {}; this.changed();
        });
        return this;
    }
    async request(sid, data, release, address) {
        address = address === undefined ? P.ADDRESS : address;
        const identityOnly = sid === 0x22 && (P.hex(data) === 'F1 50' || (address === 0x10 && P.hex(data) === '3F 06'));
        const session = (sid === 0x10 && (P.hex(data) === '03' || P.hex(data) === '01'))
            || (sid === 0x3E && P.hex(data) === '00');
        if (Object.prototype.hasOwnProperty.call(R.MODULES, address)) {
            // rear light modules: identity always; session and the light telegrams only once identified
            const control = this.verifiedRlm[address] && (session || (sid === 0x2E && R.permitted(data))
                || (sid === 0x31 && this.verifiedRlm[address].kinds.indexOf('grp') >= 0 && R.permittedRoutine(data)));
            if (!identityOnly && !control) throw new Error('Rear light module 0x' + address.toString(16) + ': request not allowed / module not identified');
        } else if (address !== P.ADDRESS && SCAN_ADDRESSES.indexOf(address) >= 0 && [0x43, 0x44].indexOf(address) < 0) {
            // other light-related units: identity and vehicle order only, never control
            if (!identityOnly) throw new Error('Only identity reads are allowed at 0x' + address.toString(16));
        } else if (address !== P.ADDRESS) {
            const validAddress = [0x43, 0x44].indexOf(address) >= 0;
            const readOnly = sid === 0x22 && ['F1 50', 'D9 FC'].indexOf(P.hex(data)) >= 0;
            const routine = (sid === 0x31 && F.isPermittedRoutine(data)) || (sid === 0x28 && F.isPermittedCommunication(data));
            if (!validAddress || (!readOnly && !this.verifiedFlm[address]) || (!readOnly && !session && !routine))
                throw new Error('Unsupported FLM diagnostic request / module not identified');
        }
        if (this._busy) throw new Error('Diagnostic request already in flight');
        if (!this.available) throw new Error('No BDC diagnostic connection');
        this._busy = true;
        const record = { address, at: new Date().toISOString(), tx: P.hex([sid].concat(data)) };
        this.trace.push(record); if (this.trace.length > 80) this.trace.shift();
        const start = Date.now();
        try {
            const u = await this.diag.physical(address, sid, data, release ? 800 : 400, replyTo(sid, data), {
                maxRetries: 0, callTimeoutMs: 700, hardTimeoutMs: 1200, pendingTimeoutMs: 800,
            });
            record.ms = Date.now() - start; record.rx = u ? P.hex(u) : 'TIMEOUT';
            const controller = address === P.ADDRESS ? 'BDC' : [0x43, 0x44].indexOf(address) >= 0 ? 'FLM' : '0x' + address.toString(16).toUpperCase();
            if (!u || !u.length) throw new Error(controller + ' reply timed out');
            if (u[0] === 0x7F) throw new Error(controller + ' NRC ' + P.hex([u[2]]) + ': ' + (NRC[u[2]] || 'request refused'));
            if (!replyTo(sid, data)(u) || u[0] !== sid + 0x40) throw new Error('Unexpected ' + controller + ' reply');
            return u;
        } catch (e) {
            record.error = String(e.message || e); this.log.warn('Light Show ' + record.tx + ': ' + record.error); throw e;
        } finally { this._busy = false; }
    }
    async identify() {
        this.index = null;
        const u = await this.request(0x22, [0xF1, 0x50]);
        this.index = P.indexOf(u.slice(3, 6)); this.identifiedAt = Date.now();
        const v = P.bodyVariant(this.index);
        this.body = v ? Object.assign({ index: this.index }, v) : null;
        if (!v) throw new Error('Body controller ' + (this.index || 'unknown') + ' is not supported (BDC_G05, BDC_G11 or BDC)');
        return this.index;
    }
    async identifyFlm(side) {
        const m = F.moduleFor(side);
        delete this.verifiedFlm[m.address];
        const u = await this.request(0x22, [0xF1, 0x50], false, m.address);
        const index = P.indexOf(u.slice(3, 6));
        const v = index && F.variant(side, index);
        if (!F.usable(side, index, this.allowExperimental()))
            throw new Error((v ? v.name : 'Headlamp ' + side) + ' variant ' + (index || 'unknown') +
                (v && v.support === 'experimental' ? ' is experimental - enable it in Vehicle first' : ' unsupported'));
        this.verifiedFlm[m.address] = index;
        return index;
    }
    async identifyRlm(address) {
        R.module(address);
        delete this.verifiedRlm[address];
        const u = await this.request(0x22, [0xF1, 0x50], false, address);
        const index = P.indexOf(u.slice(3, 6)), v = index && R.variant(address, index);
        if (!v) throw new Error('Rear light module 0x' + address.toString(16) + ' variant ' + (index || 'unknown') + ' unsupported');
        this.verifiedRlm[address] = v;
        return v;
    }
    async rlmSession(address) { return this.request(0x10, [0x03], false, address); }
    async rlmDefaultSession(address) { return this.request(0x10, [0x01], true, address); }
    async rlmKeepalive(address) { return this.request(0x3E, [0x00], false, address); }
    /** kind 'fn' (RLM2 light function), 'ch' (RLM_1 channel) or 'grp' (RLM2 segment group); ms 0 switches off. */
    async rlmSet(address, kind, item, ms, pwm) {
        const v = this.verifiedRlm[address];
        if (!v || v.kinds.indexOf(kind) < 0) throw new Error('Rear light module 0x' + address.toString(16) + ' not identified for this light');
        if (kind === 'grp') return ms === 0 ? this.request(0x31, R.groupStop(), true, address)
            : this.request(0x31, R.groupStart(item, ms, pwm), false, address);
        return this.request(0x2E, R.telegram(kind, item, ms, pwm), ms === 0, address);
    }
    /**
     * Read-only vehicle scan: one functional 22 F1 50 to all control units. Resolves with
     * Map(address -> SGBD index string) and the raw replies. No session change, no control.
     */
    async scan(options) {
        if (this._busy) throw new Error('Diagnostic request already in flight');
        if (!this.available) throw new Error('No diagnostic connection (TASU unavailable)');
        this._busy = true;
        const record = { address: 0xDF, at: new Date().toISOString(), tx: '22 F1 50' };
        this.trace.push(record); if (this.trace.length > 80) this.trace.shift();
        const start = Date.now();
        try {
            const replies = await this.diag.functional(0x22, [0xF1, 0x50], Object.assign({ idleMs: 2500, maxMs: 15000 }, options || {}));
            const ids = new Map();
            replies.forEach((u, address) => {
                if (u && u[0] === 0x62 && u[1] === 0xF1 && u[2] === 0x50 && u.length >= 6) ids.set(address, P.indexOf(u.slice(3, 6)));
                else ids.set(address, null);
            });
            record.ms = Date.now() - start; record.rx = ids.size + ' control units answered';
            return ids;
        } catch (e) { record.error = String(e.message || e); throw e; }
        finally { this._busy = false; }
    }
    /** Physical read-only identity of one address (fallback when functional requests are refused). */
    async readIdentity(address) {
        const u = await this.request(0x22, [0xF1, 0x50], false, address);
        return P.indexOf(u.slice(3, 6));
    }
    /** Vehicle order (FA) from the gateway: 22 3F 06, read-only. */
    async readVehicleOrder() { return this.request(0x22, [0x3F, 0x06], false, 0x10); }
    /** Test option: headlamp module ignores normal bus messages (on = false) or listens again (on = true). */
    async flmCommunication(side, on) {
        return this.request(0x28, (on ? F.COMM_ON : F.COMM_OFF).slice(), on, F.moduleFor(side).address);
    }
    async flmKeepalive(side) { return this.request(0x3E, [0x00], false, F.moduleFor(side).address); }
    async flmSession(side) { return this.request(0x10, [0x03], false, F.moduleFor(side).address); }
    async flmStart(side, channel, pwm = F.DEFAULT_PWM, seconds = F.DEFAULT_SECONDS) {
        const m = F.moduleFor(side), v = F.variant(side, this.verifiedFlm[m.address]);
        if (v && channel > v.channels) throw new Error(v.name + ' has channels 1-' + v.channels);
        return this.request(0x31, F.start(channel, pwm, seconds), false, F.moduleFor(side).address);
    }
    async flmStop(side) { return this.request(0x31, F.stop(), true, F.moduleFor(side).address); }
    async flmDefaultSession(side) { return this.request(0x10, [0x01], true, F.moduleFor(side).address); }
    async readOutputs() { return this.request(0x22, [0xE3, 0xB9]); }
    async readFunctionStatus() { return this.request(0x22, P.FUNCTION_DID); }
    async timed(lights, ms) {
        if (this.body && this.body.functions.indexOf(lights) < 0) throw new Error(this.body.name + ' has no light function ' + lights);
        return this.request(0x2E, P.timedControl(lights, ms), ms === 0); }
    async session() { return this.request(0x10, [0x03]); }
    async set(output, on) {
        if (!this.body || !this.body.outputs) throw new Error('Single BDC outputs need BDC_G05');
        return this.request(0x2F, P.control(output, on));
    }
    async keepalive() { return this.request(0x3E, [0x00]); }
    async release() { return this.request(0x2F, P.release(), true); }
    async defaultSession() { return this.request(0x10, [0x01], true); }
}
module.exports = Link;
module.exports.SCAN_ADDRESSES = SCAN_ADDRESSES;
