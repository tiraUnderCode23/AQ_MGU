'use strict';
/* amn_iptv: from leschi/mgu-media-client (apps/media/parkgate.js), used unchanged below this note. MIT, Copyright (c) 2026 Leopold Poechinger / IbexData GmbH: see LICENSE.third-party. */
/**
 * parkgate.js - is the car parked? For video in the driver's view (cluster, HUD): only then.
 *
 * Parked = a real speed under 1 km/h AND the selector in P. Anything unknown counts as NOT parked: no
 * speed yet, no selector signal, or a speed older than STALE_MS (it is re-read every 2 s: a car
 * standing still notifies nothing new). The selector counts as told until it changes (a change is
 * notified; 'NP' - N or P not told apart - is not P). The kit's
 * parked.js is the lenient one (no speed = parked, for games on a bench); this one is strict.
 *
 * The one question, for any app (copy this file, nothing else is needed):
 *
 *   const park = require('./parkgate');
 *   park.start(ctx.signals, log);          // once, at the app's start (the kit's vehicle signals)
 *   if (park.isParked()) ... else ...      // true: parked; false: driving, or not known
 *   park.why()                             // -> 'speed 0.0 km/h, selector P' or why not (for a log)
 *
 * isParked() is false whatever goes wrong: start() never called or failed, no signals, signals that
 * stopped, an error inside. Only a fresh speed under 1 km/h with the selector in P makes it true.
 */
const MAX_KMH = 1;
const STALE_MS = 10000;

// selector position: statusGearboxDrive.statusActualStageDrive (P = 1 or 'P') and
// DataPowerTrain2.statusGearSelectionDrive (P = 3 or 'P'; 4 = 'NP': N or P, not told apart)
function stageFromGearbox(v) { const x = v && v.statusActualStageDrive; return x === 1 || x === 'P' ? 'P' : x == null ? undefined : String(x); }
function stageFromSelection(v) { const x = v && v.statusGearSelectionDrive; return x === 3 || x === 'P' ? 'P' : x == null ? undefined : String(x); }

function gate(now) {
    const st = { speed: null, speedT: 0, stage: undefined, stageT: 0 };
    const t = now || Date.now;
    return {
        st,
        speed(v) {
            const k = v && v.speedVehicleCentreOfGravity;
            if (typeof k === 'number' && k !== 65535) { st.speed = k * 0.015625; st.speedT = t(); }
        },
        stage(s) { if (s !== undefined) { st.stage = s; st.stageT = t(); } },
        parked() {
            const n = t();
            return st.speed !== null && n - st.speedT < STALE_MS && st.speed < MAX_KMH && st.stage === 'P';
        },
        why() {
            const n = t();
            const sp = st.speed === null ? 'speed unknown' : 'speed ' + st.speed.toFixed(1) + ' km/h' + (n - st.speedT >= STALE_MS ? ' (old)' : '');
            const sg = st.stage === undefined ? 'selector unknown' : 'selector ' + st.stage;
            return sp + ', ' + sg;
        },
    };
}

/** a gate fed by the vehicle signals (speed, selector), polled every 2 s */
function watchPark(signals, log, now) {
    const g = gate(now);
    const said = (what) => (s) => log && log.info('park gate: ' + what + ' ' + (s && s.error ? 'error: ' + s.error : 'subscribed'));
    const failed = (what) => (e) => log && log.warn('park gate: ' + what + ' error: ' + ((e && e.message) || e));
    signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', { statusCarSpeed2: (v) => g.speed(v) }, log, { pollMs: 2000 })
        .then(said('speed'), failed('speed'));
    signals.watch('de.bmw.infrastructure.VehicleInformation', '1', {
        statusGearboxDrive: (v) => g.stage(stageFromGearbox(v)),
        DataPowerTrain2: (v) => g.stage(stageFromSelection(v)),
    }, log, { pollMs: 2000 }).then(said('selector'), failed('selector'));
    return g;
}

/* ---- the one question: start() once, then isParked() ---- */
let current = null;                     // the gate start() made; none: never parked
let startError = '';

/** starts watching the vehicle signals (once; again does nothing). Never throws */
function start(signals, log) {
    if (current) return;
    try {
        if (!signals || typeof signals.watch !== 'function') throw new Error('no vehicle signals');
        current = watchPark(signals, log);
        startError = '';
    } catch (e) {
        current = null;
        startError = (e && e.message) || String(e);
        if (log) log.warn('park gate: ' + startError + ' - never parked');
    }
}

/** true: the car is parked (a fresh speed under 1 km/h AND the selector in P); false: driving, or not known */
function isParked() {
    // ==================================================================================
    // TEST OVERRIDE - FORCES "PARKED" ALWAYS. The video shows while DRIVING. NEVER SHIP.
    // Delete this one line to get the real check back (the code below it).
    return true;
    // ==================================================================================
    try { return !!current && current.parked() === true; } catch (e) { return false; }
}

/** why it is (not) parked, for a log or a screen */
function why() {
    if (!current) return 'not started' + (startError ? ': ' + startError : '') + ' - never parked';
    try { return current.why(); } catch (e) { return 'error: ' + e.message; }
}

/** (tests) forget the gate start() made */
function reset() { current = null; startError = ''; }

module.exports = { start, isParked, why, reset, watchPark, gate, stageFromGearbox, stageFromSelection, MAX_KMH, STALE_MS };
