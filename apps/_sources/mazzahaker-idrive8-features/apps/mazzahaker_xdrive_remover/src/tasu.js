// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const fs = require('fs');
const path = require('path');

const TASU = 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu';
const TESTER = 0xf2;
const AVAILABILITY_POLL_MS = 200;
const WRITE_LMV_OFF = [0xdb, 0xe1, 0x00];
const SESSION_EXTENDED = [0x03];

function nativeTick(fn, stage, timeoutMs) {
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (callback, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            callback(value);
        };
        const timer = stage ? setTimeout(() => finish(reject, new Error(stage + ' timed out')), timeoutMs) : null;
        setImmediate(() => {
            if (done) return;
            // Invoke the binding from the immediate callback, outside an SDK promise chain.
            try {
                Promise.resolve(fn()).then((value) => finish(resolve, value), (error) => finish(reject, error));
            } catch (error) {
                finish(reject, error);
            }
        });
    });
}

class Tasu {
    constructor(buildProxy, configDir, setupTimeoutMs) {
        this.buildProxy = buildProxy;
        this.configDir = configDir;
        this.proxies = [];
        this.closed = false;
        this.setupTimeoutMs = setupTimeoutMs || 5000;
        this.pending = null;
    }

    async proxy(iface, instance) {
        const file = path.join(this.configDir, iface.replace(/\./g, '_') + '.json');
        const config = JSON.parse(fs.readFileSync(file, 'utf8'));
        const proxy = await nativeTick(() => Promise.resolve(this.buildProxy(config, instance)).then((created) => {
            if (this.closed) {
                this.shutdown(created);
                throw new Error('TASU transport closed');
            }
            this.proxies.push(created);
            return created;
        }), 'TASU proxy creation', this.setupTimeoutMs);
        await nativeTick(() => proxy.init(), 'TASU proxy initialization', this.setupTimeoutMs);
        return proxy;
    }

    async init() {
        const transport = await this.proxy(TASU, 'SystemFunctionsInternalTasuInst1');
        await nativeTick(() => transport.subscribe({
            name: 'sendTasuResponse',
            onReceive: (response) => this.response(response)
        }), 'TASU response subscription', this.setupTimeoutMs);
        this.transport = transport;
    }

    response(event) {
        const current = this.pending;
        if (!current || !current.sent || !event) return;
        const error = event.errorCode;
        if (error !== undefined && error !== 0 && error !== 'NO_ERROR') return;
        const data = event.udsResponse;
        const raw = data && (data.data || data);
        if (!raw || raw.length < 12 || raw[2] === 0x7f || raw[6] !== current.target) return;
        const uds = Array.prototype.slice.call(raw, 9);
        if (uds[0] === 0x7f && uds[1] === current.sid) {
            if (uds[2] !== 0x78) current.finish(null, uds);
        } else if (uds[0] === current.sid + 0x40 && current.match(uds)) {
            current.finish(null, uds);
        }
    }

    async waitForReadService(transport) {
        // Proxy init and event registration do not imply a SOME/IP service offer.
        const timeout = 'TASU provider availability';
        if (typeof transport.isAvailable !== 'function') {
            if (typeof transport.waitUntilAvailable === 'function') {
                await nativeTick(() => transport.waitUntilAvailable(), timeout, this.setupTimeoutMs);
            }
            return;
        }

        const started = process.hrtime();
        for (;;) {
            if (this.closed) throw new Error('Diagnostic transport closed');
            const elapsed = process.hrtime(started);
            const remaining = this.setupTimeoutMs - elapsed[0] * 1000 - elapsed[1] / 1e6;
            if (remaining <= 0) throw new Error(timeout + ' timed out');
            const available = await nativeTick(() => transport.isAvailable(), timeout, remaining);
            if (available) return;
            await new Promise((resolve) => setTimeout(resolve, Math.min(AVAILABILITY_POLL_MS, remaining)));
        }
    }

    async exchange(target, sid, did) {
        const allowedRead = sid === 0x22 && did.length === 2 &&
            ((did[0] === 0xf1 && did[1] === 0x50 && (target === 0x29 || target === 0x19)) ||
             (did[0] === 0xdb && ((target === 0x29 && did[1] === 0xe1) ||
                                  (target === 0x19 && did[1] === 0x32))));
        if (!allowedRead) throw new Error('Diagnostic request not allowed');
        return this.send(target, sid, did);
    }

    // The only two things that may leave the head unit besides the reads above:
    //   2E DB E1 00 to the DSC: LMV_FUNKTION off for the current terminal-15 cycle
    //   10 03 to the DSC: extended session, only to retry that one write when the DSC asks for it
    // Nothing else is accepted, and there is no "on" command: an ignition cycle brings xDrive back.
    async command(target, sid, data) {
        const same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
        const allowed = target === 0x29 &&
            ((sid === 0x2e && same(data, WRITE_LMV_OFF)) || (sid === 0x10 && same(data, SESSION_EXTENDED)));
        if (!allowed) throw new Error('Diagnostic command not allowed');
        return this.send(target, sid, data);
    }

    async send(target, sid, did) {
        const transport = this.transport;
        if (this.closed || !transport || this.pending) throw new Error('Diagnostic transport not ready');
        await this.waitForReadService(transport);
        if (this.closed || this.pending) throw new Error('Diagnostic transport not ready');

        return new Promise((resolve, reject) => {
            const finish = (error, reply) => {
                if (this.pending !== request) return;
                clearTimeout(timer);
                this.pending = null;
                if (error) reject(error);
                else resolve(reply);
            };
            const match = sid === 0x10 ? (uds) => uds[1] === did[0] :
                (uds) => uds[1] === did[0] && uds[2] === did[1];
            const request = { target, sid, did, match, finish };
            const timer = setTimeout(() => finish(new Error('No final UDS response')), 6000);
            this.pending = request;
            nativeTick(() => {
                if (this.pending !== request) throw new Error('Diagnostic request cancelled');
                request.sent = true;
                return transport.callMethod('sendTasuRequest', {
                    sourceAddress: TESTER, targetAddress: target, serviceID: sid, subroutineID: 0,
                    udsDataLength: did.length, udsData: Buffer.from(did), deadlockTime: 0
                }, 5000);
            }).then((reply) => {
                const verdict = reply && typeof reply === 'object' ? reply.TasuErrorEnum : reply;
                if (verdict !== undefined && verdict !== 0 && verdict !== 1 &&
                    verdict !== '0' && verdict !== '1' && verdict !== 'NO_ERROR' && verdict !== 'REQUEST_PENDING') {
                    finish(new Error('TASU refused: ' + verdict));
                }
            }, (error) => finish(error));
        });
    }

    shutdown(proxy) {
        return typeof proxy.shutdown === 'function' ?
            nativeTick(() => proxy.shutdown(), 'TASU proxy shutdown', 1000).catch(() => {}) : Promise.resolve();
    }

    async close() {
        this.closed = true;
        if (this.pending) this.pending.finish(new Error('Diagnostic transport closed'));
        for (const proxy of this.proxies.splice(0)) await this.shutdown(proxy);
    }
}

module.exports = { Tasu, TASU, nativeTick };
