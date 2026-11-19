'use strict';
/** Read-only ID8 freshness gate for the two CDS fields ALREADY declared "rs".
 * No vehicle methods, setters, permissions, or diagnostic requests are added.
 * At most one unresolved getter per field; a timeout hides output but does not
 * issue another getter until that promise settles. Late/previous-provider
 * responses are discarded by signals.watch().readField's accept predicate.
 */
const CDS = 'de.bmw.infotainment.vehicle.CDS';
const RPM = 'statusEngineSpeed2', OIL = 'statusEngineTemperature';
const POLICY = { rpmIdleMs: 500, rpmFreshMs: 1500, oilPollMs: 1000, oilFreshMs: 3000, oilTimeoutMs: 600, healthMs: 100 };
const numeric = (n) => typeof n === 'number' && isFinite(n);
const valid = (field, value) => {
    const n = value && value[field === RPM ? 'actualValueRPMEngineCrankshaft' : 'temperatureEngineOilDrive'];
    return numeric(n) && n >= 0 && n < (field === RPM ? 65535 : 255);
};

function createSignalGate(o) {
    const now = o.now || Date.now, T = Object.assign({ setTimeout, clearTimeout, setInterval, clearInterval }, o.timers);
    const fields = { [RPM]: { at: null, error: '', busy: false, timer: null, deadline: null }, [OIL]: { at: null, error: '', busy: false, timer: null, deadline: null } };
    let sub = null, running = false, stopped = false, epoch = 0, generation = null, healthTimer = null, changeTimer = null, lastReason = '';
    const guarded = (label, fn) => o.guard ? o.guard('ID8 signals ' + label, fn) : fn;
    const changed = () => { if (!stopped && changeTimer === null) changeTimer = T.setTimeout(guarded('changed', () => { changeTimer = null; if (o.onChange) o.onChange(); }), 0); };
    const invalidate = () => { epoch++; Object.keys(fields).forEach((field) => { fields[field].at = null; }); };
    function syncGeneration() {
        const value = sub && sub.availabilityGeneration;
        if (value !== generation) { generation = value; invalidate(); }
    }
    function provider() {
        syncGeneration();
        if (!sub || !sub.proxy) return false;
        try { if (typeof sub.proxy.isAvailable === 'function' && !sub.proxy.isAvailable()) return false; }
        catch (error) { return false; }
        const failures = o.signals.readFailures ? o.signals.readFailures(now()) : [];
        return !failures.some((failure) => failure.iface === CDS && failure.reason === 'provider unavailable');
    }
    function reason() {
        if (!running) return 'WAITING: ID8 signal checks not started';
        if (!provider()) return 'WAITING: ID8 RPM/oil provider unavailable';
        for (const field of [RPM, OIL]) {
            const state = fields[field], name = field === RPM ? 'RPM' : 'oil temperature';
            if (state.error) return 'WAITING: ID8 ' + name + ': ' + state.error;
            if (state.at === null) return 'WAITING: fresh ID8 ' + name;
            const age = now() - state.at;
            if (age < 0 || age > (field === RPM ? POLICY.rpmFreshMs : POLICY.oilFreshMs)) return 'WAITING: ID8 ' + name + ' reading expired';
        }
        const failures = o.signals.readFailures ? o.signals.readFailures(now()) : [];
        const critical = failures.find((failure) => failure.iface === CDS && (!failure.field || fields[failure.field]));
        if (critical) return 'WAITING: ID8 signal read failed: ' + critical.reason;
        if (!sub.available) return 'WAITING: ID8 RPM/oil subscription not ready';
        return '';
    }
    function publish() {
        const next = reason();
        if (next !== lastReason) {
            lastReason = next;
            if (o.log) o.log.info('ID8 shift signal gate: ' + (next || 'fresh RPM and oil readings'));
            changed();
        }
    }
    function fail(field, error) {
        const state = fields[field];
        state.error = String(error && error.message || error || 'read failed'); state.at = null;
        publish();
    }
    function wrap(handlers) {
        const out = Object.assign({}, handlers);
        [RPM, OIL].forEach((field) => {
            if (typeof handlers[field] !== 'function') return;
            out[field] = (value) => {
                if (stopped) return;
                syncGeneration();
                if (!valid(field, value)) { fail(field, 'invalid or missing value'); return; }
                fields[field].at = now(); fields[field].error = '';
                handlers[field](value); // even unchanged valid readings refresh their own timestamp
                publish();
                if (field === OIL) changed(); // Car does not emit an RPM sample for an oil-only change
            };
        });
        return out;
    }
    const period = (field) => field === OIL ? POLICY.oilPollMs : o.fast && o.fast() ? Math.max(40, o.rpm.pollMs) : POLICY.rpmIdleMs;
    function schedule(field, delay) {
        const state = fields[field];
        if (running && state.timer === null && !state.busy) state.timer = T.setTimeout(guarded('poll', () => { state.timer = null; tick(field); }), delay);
    }
    function tick(field) {
        const state = fields[field];
        if (!running || state.busy) return;
        if (!provider() || (o.enabled && !o.enabled())) { publish(); schedule(field, POLICY.rpmIdleMs); return; }
        const age = state.at === null ? Infinity : now() - state.at;
        if (!state.error && age >= 0 && age < period(field)) { schedule(field, period(field) - age); return; }
        if (!sub || typeof sub.readField !== 'function') { fail(field, 'bounded watched getter unavailable'); schedule(field, POLICY.oilPollMs); return; }
        state.busy = true;
        const ownEpoch = epoch, ownGeneration = sub.availabilityGeneration;
        let expired = false;
        const timeout = field === RPM ? o.rpm.pollTimeoutMs : POLICY.oilTimeoutMs;
        const accept = () => running && !expired && ownEpoch === epoch && sub.availabilityGeneration === ownGeneration && provider();
        state.deadline = T.setTimeout(guarded('timeout', () => { state.deadline = null; expired = true; fail(field, 'getter timed out'); }), timeout);
        const done = () => {
            if (state.deadline !== null) T.clearTimeout(state.deadline);
            state.deadline = null; state.busy = false;
            schedule(field, state.error ? Math.min(o.rpm.pollMaxBackoffMs, Math.max(POLICY.rpmIdleMs, period(field) * 2)) : period(field));
        };
        try {
            Promise.resolve(sub.readField(field, timeout, accept)).then(() => { publish(); done(); }, (error) => { if (accept()) fail(field, error); done(); });
        } catch (error) { fail(field, error); done(); }
    }
    function stop() {
        running = false; stopped = true; invalidate();
        if (healthTimer !== null) T.clearInterval(healthTimer);
        if (changeTimer !== null) T.clearTimeout(changeTimer);
        healthTimer = null; changeTimer = null;
        Object.keys(fields).forEach((field) => {
            const state = fields[field];
            if (state.timer !== null) T.clearTimeout(state.timer);
            if (state.deadline !== null) T.clearTimeout(state.deadline);
            state.timer = null; state.deadline = null;
        });
    }
    return {
        wrap,
        attach(result) { if (stopped) return; sub = result; syncGeneration(); publish(); },
        start() {
            if (running || stopped) return;
            running = true; [RPM, OIL].forEach((field) => schedule(field, 0));
            healthTimer = T.setInterval(guarded('health', publish), POLICY.healthMs); publish();
        },
        stop, reason,
        state() { return { reason: reason(), fields: Object.keys(fields).map((field) => ({ field, at: fields[field].at, error: fields[field].error, pending: fields[field].busy })) }; },
    };
}

module.exports = { createSignalGate, CDS, RPM, OIL, POLICY, valid };
