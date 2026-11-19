'use strict';
/**
 * signals.js - read live vehicle signals over SOME/IP.
 *
 * Interface configs come from the app's own oap_<uid>/someipInterfaces/,
 * which the installer generates from the app's manifest.json with BMW's own
 * generator (kit/tools/oapgen) against the unit's master catalog
 * /etc/oap/someip/someip-interfaces.json - exactly what MainApp does when it
 * installs an app. So any interface/field listed in app.json "signals" is
 * reachable, not just the trimmed MainApp subset.
 *
 *   const sub = await signals.watch('de.bmw.infotainment.vehicle.CDS', '1', {
 *       statusEngineSpeed2: (v) => rpm = v.actualValueRPMEngineCrankshaft,
 *   });
 *   sub.available  // raw provider status, or SDK typed-proxy initial readiness
 *
 * ID8 compatibility: allowTyped() enables the public SDK typed adapter only
 * when raw native/config inputs are absent. Raw configuration remains preferred.
 * No interfaces, diagnostic requests or permissions are added by this adapter.
 */
const fs = require('fs');
const path = require('path');

let someip = null;
try { someip = require('someip'); } catch (e) { /* host preview / not installed */ }

const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIRS = [path.join(APP_ROOT, 'someipInterfaces'), path.join(__dirname, '..', '..', 'someipdefs')];

// The native binding deadlocks (main thread stuck on a futex) when buildProxy/
// init run inline inside the app's promise chains next to the SDK's own SOME/IP
// traffic. The SDK always calls them from a fresh setImmediate tick, one at a
// time - do the same.
let typedOk = false, typedLog = null;
const typedReadState = Object.create(null);
/** Fail-visible facts only; event-only streams have no invented timeout/cadence. */
function readFailures(now) {
    const time = now === undefined ? Date.now() : now, failures = [];
    Object.keys(typedReadState).forEach((iface) => {
        const state = typedReadState[iface];
        if (state.initialError) failures.push({ iface, field: null, reason: state.initialError });
        if (state.provider === false) failures.push({ iface, field: null, reason: 'provider unavailable' });
        Object.keys(state.errors || {}).forEach((field) => failures.push({ iface, field, reason: state.errors[field] }));
        // Only streams the original app already polls have a known cadence.
        // Three missed polls hide cached canvas data until that same field is fresh.
        if (state.pollMs) Object.keys(state.last || {}).forEach((field) => {
            if (time - state.last[field] > 3 * state.pollMs) {
                failures.push({ iface, field, reason: 'no fresh reading within three polling intervals' });
                if (state.result) state.result.available = false;
            }
        });
    });
    return failures;
}
const backend = {};                          // interface -> 'raw' | 'typed' | 'none (why)'
function allowTyped(on, log) { typedOk = !!on; typedLog = log || null; }
function backends() { return Object.assign({}, backend); }

/** An SDK typed proxy in the raw proxy's shape. Fields and broadcasts are members with subscribe / getValue; methods are functions. */
function typedAdapter(px) {
    let available = true; // buildAndInit completed; continuous status is optional in the SDK.
    const member = (name) => (px && px[name] !== undefined ? px[name] : null);
    return {
        typed: true, px,
        init() { return Promise.resolve(this); },
        callMethod(method, params) {
            const fn = member(method);
            if (typeof fn !== 'function') return Promise.reject(new Error('typed proxy has no method ' + method));
            return Promise.resolve().then(() => fn.call(px, params || {}));
        },
        subscribe(o) {
            const m = member(o.name);
            if (!m || typeof m.subscribe !== 'function') return Promise.reject(new Error('typed proxy has no ' + o.name + ' to subscribe to'));
            return Promise.resolve().then(() => m.subscribe(o.onReceive));
        },
        hasGetter(name) { const m = member(name); return !!(m && typeof m.getValue === 'function'); },
        getValue(name) {
            const m = member(name);
            if (!m || typeof m.getValue !== 'function') return Promise.reject(new Error('typed proxy has no getter for ' + name));
            return Promise.resolve().then(() => m.getValue());
        },
        setValue(name, value) {
            const m = member(name);
            if (!m || typeof m.setValue !== 'function') return Promise.reject(new Error('typed proxy has no setter for ' + name));
            return Promise.resolve().then(() => m.setValue(value));
        },
        // Honour live status when exposed by the SDK; otherwise this is initial
        // readiness only. The application's existing stale-signal guards remain authoritative.
        subscribeToAvailability(fn) {
            if (typeof px.subscribeToAvailability === 'function') return px.subscribeToAvailability((value) => { available = !!value; fn(available); });
            setImmediate(() => fn(available)); return null;
        },
        isAvailable() { return typeof px.isAvailable === 'function' ? !!px.isAvailable() : available; },
        shutdown() { available = false; return Promise.resolve().then(() => typeof px.shutdown === 'function' ? px.shutdown() : null); },
    };
}
function typedProxy(iface, instance) {
    let builders = null;
    try { builders = require('oap-sdk').someipBuilders; } catch (e) { /* no SDK (host preview) */ }
    if (!builders || typeof builders.buildAndInitTypedProxy !== 'function') return Promise.reject(new Error('this oap-sdk has no someipBuilders.buildAndInitTypedProxy'));
    let timer;
    const late = new Promise((res, rej) => { timer = setTimeout(() => rej(new Error('typed proxy: no answer after 15 s')), 15000); });
    return Promise.race([Promise.resolve().then(() => builders.buildAndInitTypedProxy(iface, String(instance), { timeoutMs: 10000 })), late])
        .then((px) => { clearTimeout(timer); return typedAdapter(px); }, (e) => { clearTimeout(timer); throw e; });
}

/** The proxy for an interface instance: { p, cfg } - the raw one from the app's config, else (allowTyped) the SDK's typed one. */
function open(iface, instance) {
    let cfg = null, why = '';
    if (!someip) why = 'someip native module not available';
    else { try { cfg = loadConfig(iface); } catch (e) { why = String(e && e.message || e); } }
    if (cfg) {
        return nativeTick(() => someip.buildProxy(cfg, String(instance)).then((px) => px.init().then(() => px)))
            .then((p) => { backend[iface] = 'raw'; return { p, cfg }; });
    }
    if (!typedOk) { backend[iface] = 'none (' + why + ')'; return Promise.reject(new Error(why)); }
    return typedProxy(iface, instance).then((p) => {
        backend[iface] = 'typed';
        if (typedLog) typedLog.info('signals backend: ' + iface + ' (' + instance + ') typed proxy of the SDK (' + why + ')');
        return { p, cfg: null };
    }, (e) => {
        backend[iface] = 'none (' + why + '; typed: ' + (e && e.message || e) + ')';
        if (typedLog) typedLog.warn('signals backend: ' + iface + ' (' + instance + ') none: ' + why + '; typed proxy: ' + (e && e.message || e));
        throw new Error(why + '; typed proxy: ' + (e && e.message || e));
    });
}

let chain = Promise.resolve();
function nativeTick(fn) {
    const run = () => new Promise((resolve, reject) => setImmediate(() => { try { Promise.resolve(fn()).then(resolve, reject); } catch (e) { reject(e); } }));
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
}

function loadConfig(iface) {
    const f = iface.replace(/\./g, '_') + '.json';
    for (const d of DIRS) {
        try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { /* next */ }
    }
    throw new Error('no SOME/IP config for ' + iface + ' (add it to app.json "signals")');
}

/**
 * Build a proxy and subscribe to fields. handlers = { fieldName: fn(value) }.
 * Also does an initial getValue() for fields that have a getter, so values
 * show up without waiting for the next change.
 * opts.pollMs: also re-read those fields that often while the provider is available - for
 * fields a car may not notify (BMW's x_call only ever reads TPMS, it never subscribes).
 */
async function watch(iface, instance, handlers, log, opts) {
    const res = { iface, available: false, proxy: null, error: null, availabilityGeneration: 0, shutdown: () => Promise.resolve() };
    if (!someip && !typedOk) { res.error = 'someip native module not available'; return res; }
    try {
        const o = await open(iface, instance);
        const cfg = o.cfg, p = o.p;
        res.proxy = p;
        const fields = Object.keys(handlers || {});
        let availability = null;
        const typedErrors = {};
        const state = p.typed ? (typedReadState[iface] = { errors: typedErrors, last: {}, pollMs: opts && opts.pollMs || 0, provider: null, result: res }) : null;
        let typedFresh = false, typedProvider = null, typedClosed = false, pollTimer = null;
        const typedPending = Object.create(null);
        fields.forEach((field) => { typedPending[field] = { busy: false, deadline: null }; });
        res.shutdown = () => {
            if (p.typed) {
                if (typedClosed) return Promise.resolve();
                typedClosed = true; res.available = false; res.availabilityGeneration++;
                state.initialError = res.error = 'typed subscription stopped';
                if (pollTimer !== null) clearInterval(pollTimer);
                fields.forEach((field) => {
                    if (typedPending[field].deadline !== null) clearTimeout(typedPending[field].deadline);
                    typedPending[field].deadline = null;
                });
            }
            return Promise.resolve().then(() => p.shutdown && p.shutdown()).catch(() => {});
        };
        const failed = (field, error) => {
            if (!p.typed || typedClosed) return;
            typedErrors[field] = String(error && error.message || error);
            res.error = 'typed fields: ' + Object.keys(typedErrors).map((key) => key + ': ' + typedErrors[key]).join('; ');
            res.available = false;
            if (log) log.warn('signals ' + iface + '.' + field + ': ' + typedErrors[field]);
        };
        const receive = (field, value) => {
            if (p.typed && (typedClosed || typedProvider === false)) return;
            handlers[field](value);
            if (p.typed) {
                delete typedErrors[field];
                state.last[field] = Date.now();
                typedFresh = true;
                const errors = Object.keys(typedErrors);
                res.error = errors.length ? 'typed fields: ' + errors.map((key) => key + ': ' + typedErrors[key]).join('; ') : null;
                res.available = typedProvider !== false && !res.error;
            }
        };
        // A caller may refresh ONLY an already-watched getter. The Shiftlights
        // ID8 guard bounds its calls and can discard a late response without
        // feeding cached data or clearing another field's health error.
        res.readField = (field, timeoutMs, accept) => {
            if (p.typed && typedClosed) return Promise.reject(new Error('typed subscription stopped'));
            const getter = fields.indexOf(field) >= 0 && (cfg ? cfg.fields && cfg.fields[field] && cfg.fields[field].getter : p.hasGetter && p.hasGetter(field));
            if (!getter) return Promise.reject(new Error('no watched getter for ' + field));
            const generation = res.availabilityGeneration;
            const accepted = () => (!p.typed || !typedClosed) && (!accept || accept()) && (!opts || !opts.dropStaleReads || generation === res.availabilityGeneration);
            return new Promise((resolve, reject) => setImmediate(() => {
                if (p.typed && typedClosed) { resolve(null); return; }
                try { Promise.resolve(p.getValue(field, timeoutMs || 3000)).then(resolve, reject); } catch (error) { reject(error); }
            })).then((value) => {
                if (!accepted()) return null;
                if (p.typed) receive(field, value); else handlers[field](value);
                return value;
            }, (error) => { if (accepted()) failed(field, error); throw error; });
        };
        const fetchAll = () => fields.forEach((f) => {
            if (cfg ? cfg.fields && cfg.fields[f] && cfg.fields[f].getter : p.hasGetter && p.hasGetter(f)) {
                const generation = res.availabilityGeneration;
                if (p.typed) {
                    const pending = typedPending[f];
                    if (typedClosed || typedProvider === false || pending.busy) return;
                    pending.busy = true;
                    let expired = false;
                    const current = () => !typedClosed && typedProvider !== false && generation === res.availabilityGeneration;
                    // Timeout reports a failure; it cannot cancel an SDK getter.
                    // Keep its slot busy until the underlying promise settles.
                    pending.deadline = setTimeout(() => {
                        pending.deadline = null; expired = true;
                        if (current()) failed(f, new Error('typed getter timed out'));
                    }, 3500);
                    const settled = () => {
                        if (pending.deadline !== null) clearTimeout(pending.deadline);
                        pending.deadline = null; pending.busy = false;
                    };
                    Promise.resolve().then(() => current() ? p.getValue(f, 3000) : null)
                        .then((v) => { if (!expired && current()) receive(f, v); },
                            (e) => { if (!expired && current()) failed(f, e); }).then(settled, settled);
                    return;
                }
                // Raw ID7 binding behavior is unchanged.
                p.getValue(f, 3000).then((v) => {
                    if (opts && opts.dropStaleReads && generation !== res.availabilityGeneration) return;
                    if (p.typed) receive(f, v); else handlers[f](v);
                }).catch((e) => { if (!opts || !opts.dropStaleReads || generation === res.availabilityGeneration) failed(f, e); });
            }
        });
        await nativeTick(() => {
            try { return p.subscribeToAvailability((a) => {
                if (p.typed && typedClosed) return;
                if (availability !== !!a) { availability = !!a; res.availabilityGeneration++; }
                if (p.typed) {
                    typedProvider = !!a;
                    state.provider = typedProvider;
                    if (!a) { typedFresh = false; res.available = false; }
                    else res.available = typedFresh && !res.error;
                } else res.available = !!a;
                if (a && (!opts || opts.initialRead !== false)) setImmediate(fetchAll);
            }); } catch (e) { return null; /* older binding */ }
        });
        for (const f of fields) {
            try {
                await nativeTick(() => p.subscribe({ name: f, onReceive: (v) => { try { if (p.typed) receive(f, v); else handlers[f](v); } catch (e) { failed(f, e); if (log) log.warn(iface + '.' + f + ': ' + e); } } }));
            } catch (e) {
                failed(f, e);
                if (log) log.warn('subscribe ' + iface + '.' + f + ': ' + e);
            }
        }
        if (p.isAvailable && p.isAvailable()) {
            if (!p.typed) res.available = true;
            if (!opts || opts.initialRead !== false) fetchAll();
        }
        // A typed getter failure must not stop polling forever; retry while the
        // provider has not explicitly become unavailable. Raw polling is unchanged.
        if (opts && opts.pollMs) pollTimer = setInterval(() => { if (p.typed ? !typedClosed && typedProvider !== false : res.available) setImmediate(fetchAll); }, opts.pollMs);
    } catch (e) {
        res.error = String(e);
        if (typedOk && backend[iface] && backend[iface].indexOf('none (') === 0) typedReadState[iface] = { initialError: res.error, errors: {}, last: {}, pollMs: 0 };
        if (log) log.warn('signals ' + iface + ': ' + e);
    }
    return res;
}

/** Call a method on an interface instance (e.g. UDS over InternalTasu). */
async function proxy(iface, instance) {
    if (!someip && !typedOk) throw new Error('someip native module not available');
    return (await open(iface, instance)).p;
}

/** Call a method on a proxy from proxy(); params = the method's argument struct. */
function call(p, method, params, timeoutMs) {
    return nativeTick(() => p.callMethod(method, params || {}, timeoutMs || 5000));
}

/**
 * Write a field that has a setter (e.g. ConditionBasedServicesLegacy.cBSReset) on a proxy from
 * proxy() or watch().proxy, as BMW's SDK does (_someIpProxy.setValue). value = the field's struct;
 * resolves when the provider took it. Needs "w" in the field's app.json flags, or the installer
 * leaves the setter out of the app's interface config.
 */
function set(p, field, value, timeoutMs) {
    return nativeTick(() => p.setValue(field, value, timeoutMs || 5000));
}

/** Subscribe to a broadcast/event or field on a proxy from proxy(). */
function on(p, name, fn, log) {
    return nativeTick(() => p.subscribe({ name, onReceive: (v) => { try { fn(v); } catch (e) { if (log) log.warn(name + ': ' + e); } } }));
}

/** Availability of a proxy's provider; fn(bool) on every change. */
function onAvailable(p, fn) {
    return nativeTick(() => { try { return p.subscribeToAvailability((a) => fn(!!a)); } catch (e) { return null; } })
        .then(() => { if (p.isAvailable && p.isAvailable()) fn(true); });
}

module.exports = { watch, proxy, call, set, on, onAvailable, loadConfig, hasNative: () => !!someip, allowTyped, backends, readFailures };
