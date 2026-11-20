'use strict';
/**
 * ReadOnlyDiag - deliberately narrow DDE diagnostic facade.
 * Only physical UDS ReadDataByIdentifier (0x22) requests to ECU 0x12 are exposed.
 */
const { Diag } = require('./diag');
class ReadOnlyDiag {
    constructor(signals, log, options) {
        this.ecu = options && options.ecu != null ? options.ecu : 0x12;
        this.diag = new Diag(signals, log);
        this.ready = false;
        this.error = null;
        this.stats = { sent: 0, replies: 0, missed: 0 };
    }
    get available() { return !!this.diag.available; }
    async init() {
        await this.diag.init();
        this.ready = !!this.diag.p;
        this.error = this.diag.error || null;
        return this;
    }
    async physical(target, sid, data, timeoutMs, accept) {
        if (!this.ready) throw new Error(this.error || 'diagnostic transport not ready');
        if (target !== this.ecu) throw new Error('read-only DPF access is restricted to ECU 0x' + this.ecu.toString(16));
        if (sid !== 0x22) throw new Error('read-only DPF access permits UDS service 0x22 only');
        if (!Array.isArray(data) || data.length !== 2 ||
            data.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
            throw new Error('read-only DPF access requires exactly one 16-bit DID');
        }
        this.stats.sent++;
        try {
            const reply = await this.diag.physical(target, sid, data, timeoutMs, accept);
            if (reply) this.stats.replies++;
            else this.stats.missed++;
            return reply;
        } catch (e) {
            this.stats.missed++;
            throw e;
        }
    }
}
module.exports = { ReadOnlyDiag };
