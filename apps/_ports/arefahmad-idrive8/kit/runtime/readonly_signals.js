'use strict';
/**
 * AQ ID8 read-only adapter. Raw config/native binding follows the unchanged
 * Aref signals module. The typed member contract follows the public MIT Perea
 * implementation at 5b758fad17761b8696989e2a4ffbfbfab4926b6f (LICENSE.alexpereap).
 * This module exports no method-call, field-setter or raw proxy capability.
 * A constructed proxy is not evidence of a live value: each field needs a
 * successful read/event, loses freshness on failure and expires after three
 * requested polling intervals. No unit SDK is distributed with this source.
 */
const fs = require('fs');
const legacy = require('./signals');
const CATALOG = '/etc/oap/someip/someip-interfaces.json';
let native = null;
try { native = require('someip'); } catch (e) { /* SDK typed fallback below */ }

let chain = Promise.resolve();
function nativeTick(fn) {
    const run = () => new Promise((resolve, reject) => setImmediate(() => {
        try { Promise.resolve(fn()).then(resolve, reject); } catch (e) { reject(e); }
    }));
    const p = chain.then(run, run); chain = p.catch(() => {}); return p;
}
function bounded(operation, ms, label, discardLate) {
    let timer, expired = false;
    const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { expired = true; reject(new Error(label + ' timed out')); }, ms); });
    const work = Promise.resolve().then(operation).then((value) => {
        if (expired && discardLate) discardLate(value);
        return value;
    });
    return Promise.race([work, timeout]).then(
        (v) => { clearTimeout(timer); return v; }, (e) => { clearTimeout(timer); throw e; });
}
function enumerationConfig(iface) {
    try { return legacy.loadConfig(iface); } catch (e) { /* typed SDK uses the unit catalog */ }
    const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
    const seen = new Set(), fields = {};
    function collect(name) {
        if (seen.has(name)) throw new Error('cyclic interface inheritance: ' + name);
        seen.add(name);
        const row = catalog.interfaces && catalog.interfaces[name];
        if (!row) throw new Error('unit has no interface ' + name);
        if (row.extends) collect(row.extends);
        Object.assign(fields, row.fields || row.attributes || {});
        seen.delete(name);
    }
    collect(iface);
    return { fields, instances: catalog.instanceIDs && catalog.instanceIDs[iface] || {} };
}

function forHmi(hmi) {
    if (hmi !== 'ID8') throw new Error('read-only typed adapter requires the loaded ID8 UI marker');
    async function watch(iface, instance, handlers, log, options) {
        const opts = options || {}, fields = Object.keys(handlers || {}), state = Object.create(null);
        const pollMs = Math.max(0, Number(opts.pollMs) || 0), maxAge = pollMs ? 3 * pollMs : 0;
        let px = null, cfg = null, typed = false, provider = null, providerEpoch = 0, closed = false, timer = null, openingError = null;
        fields.forEach((field) => { state[field] = { seen: null, error: null, busy: false, deadline: null }; });
        const warn = (text) => { if (log && log.warn) log.warn(text); };
        const discardLate = (p) => Promise.resolve().then(() => p && typeof p.shutdown === 'function' ? p.shutdown() : null)
            .catch((e) => warn('read-only late reader shutdown ' + iface + ': ' + e));
        const fresh = (field) => {
            const s = state[field];
            const age = s && s.seen !== null ? Date.now() - s.seen : NaN;
            return !!(!closed && provider !== false && !openingError && s && s.seen !== null && !s.error &&
                age >= 0 && (!maxAge || age <= maxAge));
        };
        const result = {
            iface, instance: String(instance), fresh,
            get availabilityGeneration() { return providerEpoch; },
            get available() { return fields.some(fresh); },
            get backend() { return px ? typed ? 'typed' : 'raw' : 'none'; },
            get error() {
                if (closed) return 'subscription stopped';
                if (openingError) return openingError;
                if (provider === false) return 'provider unavailable';
                const failed = fields.filter((f) => state[f].error).map((f) => f + ': ' + state[f].error);
                return failed.length ? failed.join('; ') : null;
            },
            health(field) {
                const s = state[field];
                return { available: fresh(field), seen: s && s.seen, error: !s ? 'unknown field' :
                    result.error || (!fresh(field) ? 'waiting for a fresh reading' : null) };
            },
            shutdown() {
                if (closed) return Promise.resolve();
                closed = true;
                if (timer !== null) clearInterval(timer);
                fields.forEach((field) => {
                    if (state[field].deadline !== null) clearTimeout(state[field].deadline);
                    state[field].deadline = null;
                });
                return Promise.resolve().then(() => px && typeof px.shutdown === 'function' ? px.shutdown() : null)
                    .catch((e) => warn('read-only shutdown ' + iface + ': ' + e));
            },
        };
        const failed = (field, error) => {
            if (closed) return;
            state[field].error = String(error && error.message || error);
            warn('read-only ' + iface + '/' + instance + '.' + field + ': ' + state[field].error);
        };
        const receive = (field, value) => {
            if (closed || provider === false) return;
            try {
                handlers[field](value);
                state[field].seen = Date.now(); state[field].error = null;
            } catch (e) { failed(field, e); }
        };
        const member = (field) => px && px[field];
        const getter = (field) => typed ? member(field) && typeof member(field).getValue === 'function' :
            cfg && cfg.fields && cfg.fields[field] && cfg.fields[field].getter;
        const fetchAll = () => {
            if (closed || provider === false) return;
            fields.forEach((field) => {
                if (!getter(field) || state[field].busy) return;
                state[field].busy = true;
                const epoch = providerEpoch;
                let expired = false;
                const current = () => !closed && provider !== false && epoch === providerEpoch;
                // A reporting deadline does not cancel the underlying SDK call.
                // Keep busy until that call settles; never pile up hung getters.
                state[field].deadline = setTimeout(() => {
                    state[field].deadline = null; expired = true;
                    if (current()) failed(field, new Error(field + ' read timed out'));
                }, 3500);
                const settled = () => {
                    if (state[field].deadline !== null) clearTimeout(state[field].deadline);
                    state[field].deadline = null; state[field].busy = false;
                };
                Promise.resolve().then(() => {
                    if (!current()) return undefined;
                    return typed ? member(field).getValue() : px.getValue(field, 3000);
                }).then((v) => { if (!expired && current()) receive(field, v); },
                    (e) => { if (!expired && current()) failed(field, e); }).then(settled, settled);
            });
        };
        try {
            try { cfg = legacy.loadConfig(iface); } catch (e) { /* no generated raw config */ }
            if (native && cfg) {
                px = await bounded(() => nativeTick(() => native.buildProxy(cfg, String(instance))
                    .then((p) => Promise.resolve(p.init()).then(() => p))), 15000, 'raw proxy', discardLate);
            } else {
                const sdk = require('oap-sdk'), builders = sdk && sdk.someipBuilders;
                if (!builders || typeof builders.buildAndInitTypedProxy !== 'function') throw new Error('SDK typed reader is unavailable');
                typed = true;
                px = await bounded(() => builders.buildAndInitTypedProxy(iface, String(instance), { timeoutMs: 10000 }), 15000, 'typed proxy', discardLate);
                if (!px) throw new Error('SDK returned no typed reader');
            }
            if (typeof px.isAvailable === 'function') provider = !!px.isAvailable();
            if (typeof px.subscribeToAvailability === 'function') {
                await nativeTick(() => px.subscribeToAvailability((value) => {
                    if (closed) return;
                    provider = !!value;
                    // Even unchanged odometer/metadata needs a new sample after a provider outage.
                    if (!provider) { providerEpoch++; fields.forEach((field) => { state[field].seen = null; }); }
                    else setImmediate(fetchAll);
                }));
            }
            for (const field of fields) {
                const m = typed ? member(field) : null;
                try {
                    if (typed && (!m || typeof m.subscribe !== 'function')) {
                        if (!getter(field)) throw new Error('SDK exposes neither subscription nor getter');
                    } else {
                        await nativeTick(() => typed ? m.subscribe((v) => receive(field, v)) :
                            px.subscribe({ name: field, onReceive: (v) => receive(field, v) }));
                    }
                } catch (e) { failed(field, e); }
            }
            setImmediate(fetchAll);
            if (pollMs) timer = setInterval(fetchAll, pollMs);
            if (timer && timer.unref) timer.unref();
        } catch (e) {
            openingError = String(e && e.message || e);
            warn('read-only ' + iface + '/' + instance + ': ' + openingError);
        }
        return result;
    }
    return { watch, loadConfig: enumerationConfig, readOnly: true };
}
module.exports = { forHmi };
