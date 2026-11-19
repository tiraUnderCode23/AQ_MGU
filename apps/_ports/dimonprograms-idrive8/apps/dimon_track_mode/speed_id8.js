'use strict';
// Existing Vehicle2 field, read-only. No location, vehicle command or new permission.
const POLL_MS = 1000, MAX_AGE_MS = 3000;
function watch(ctx, onSample) {
    if (!ctx.ui || !ctx.ui.id8) throw new Error('ID8 speed reader requires loaded ID8 UI');
    const reader = require('./kit/readonly_signals').forHmi('ID8');
    const scale = ctx.spec.config.scaling.speed;
    let sub = null, starting = false, stopped = false, generation = 0, value = null, at = null, serial = 0, delivered = -1;
    const read = () => {
        const age = at === null ? NaN : Date.now() - at;
        return value !== null && age >= 0 && age <= MAX_AGE_MS && sub && sub.fresh('statusCarSpeed2') ? value : null;
    };
    const deliver = () => {
        const v = read();
        if (!stopped && v !== null && serial !== delivered) { delivered = serial; onSample(v, at); }
    };
    const pause = () => {
        generation++; starting = false; value = null; at = null;
        const old = sub; sub = null;
        if (old && old.shutdown) old.shutdown();
    };
    const start = () => {
        if (stopped || starting || sub) return;
        starting = true; const token = generation;
        reader.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2(v) {
                if (stopped || token !== generation) return;
                const raw = v && v.speedVehicleCentreOfGravity;
                if (!(typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw < scale.invalid)) { value = null; at = null; return; }
                const scaled = raw * scale.factor + (scale.offset || 0);
                if (!isFinite(scaled) || scaled < 0) { value = null; at = null; return; }
                value = scaled; at = Date.now(); serial++;
                setImmediate(deliver); // reader marks the actual sample fresh after this handler returns
            },
        }, ctx.log, { pollMs: POLL_MS }).then((result) => {
            if (stopped || token !== generation) { if (result && result.shutdown) result.shutdown(); return; }
            starting = false; sub = result; setImmediate(deliver);
            if (result && result.error) ctx.log.warn('ID8 speed unavailable: ' + result.error);
        }, (error) => { if (token === generation) { starting = false; value = null; at = null; ctx.log.warn('ID8 speed unavailable: ' + error); } });
    };
    const sync = () => { if (!stopped && ctx.ui.isVisible('MAIN')) start(); else pause(); };
    ctx.ui.onVisible(() => setImmediate(sync));
    if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => { stopped = true; pause(); });
    sync();
    return { read, stop() { stopped = true; pause(); } };
}
module.exports = { watch, POLL_MS, MAX_AGE_MS };
