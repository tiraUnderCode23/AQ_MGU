'use strict';
// AQ ID8 gate for the existing Vehicle2 speed field. Missing/invalid/stale data
// is a closed gate, never an emulator exception. No control or diagnostic API.
const MAX_KMH = 3; // preserve the stricter threshold of the publisher's two original guards
const POLL_MS = 2000, MAX_AGE_MS = 3 * POLL_MS;
function watch(ctx, log) {
    if (!ctx.ui || !ctx.ui.id8) throw new Error('ID8 parked gate needs the loaded ID8 UI marker');
    const reader = require('./readonly_signals').forHmi('ID8');
    let sub = null, starting = false, generation = 0, stopped = false, speed = null, at = null;
    const state = () => {
        const known = speed !== null && at !== null && Date.now() - at >= 0 && Date.now() - at <= MAX_AGE_MS &&
            sub && sub.fresh('statusCarSpeed2');
        return { known: !!known, moving: !known || speed > MAX_KMH, speed: known ? speed : null,
            reason: known ? speed > MAX_KMH ? 'Vehicle moving: games paused' : 'Current stationary speed confirmed' :
                'Current speed unavailable: games remain paused' };
    };
    const stop = () => {
        generation++; starting = false; speed = null; at = null;
        const old = sub; sub = null;
        if (old && old.shutdown) old.shutdown();
    };
    const start = () => {
        if (stopped || sub || starting) return;
        starting = true; const token = generation;
        reader.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2(value) {
                if (token !== generation) return;
                const raw = value && value.speedVehicleCentreOfGravity;
                if (!(typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw < 65535)) { speed = null; at = null; return; }
                speed = raw * 0.015625; at = Date.now();
            },
        }, log, { pollMs: POLL_MS }).then((result) => {
            if (token !== generation || stopped) { if (result && result.shutdown) result.shutdown(); return; }
            starting = false; sub = result;
            if (sub && sub.error && log) log.warn('ID8 parked guard: ' + sub.error);
        }, (error) => {
            if (token !== generation) return;
            starting = false; speed = null; at = null;
            if (log) log.warn('ID8 parked guard unavailable: ' + error);
        });
    };
    const sync = () => { if (!stopped && ctx.ui.isVisible('MAIN')) start(); else stop(); };
    ctx.ui.onVisible(() => setImmediate(sync));
    if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => { stopped = true; stop(); });
    sync();
    return { state, moving: () => state().moving, speed: () => state().speed,
        stop: () => { stopped = true; stop(); } };
}
module.exports = { watch, MAX_KMH, POLL_MS, MAX_AGE_MS };
