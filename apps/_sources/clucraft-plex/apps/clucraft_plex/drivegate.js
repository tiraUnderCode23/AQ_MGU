'use strict';
/**
 * drivegate.js - when the picture may show. The centre screen is in the driver's view, so the answer is strict:
 *
 *   the car is parked                              -> the picture shows
 *   the car is not parked, or nothing says it is   -> the picture is off (the sound plays on), unless the owner has
 *                                                     switched on "Video while driving" AND accepted the passenger
 *                                                     disclaimer for it (below)
 *
 * Parked means all of: a speed the car sent in the last 10 s, under 1 km/h, and the selector in P (a car that only
 * tells "N or P" counts as P, with the same speed rule). Anything unknown is NOT parked: no speed yet, no selector
 * signal, a speed that stopped arriving, an error. There is no test switch and no "assume parked" in here.
 *
 * The passenger disclaimer. The setting alone does nothing: the first time it is switched on (and every time it is
 * switched on again after being off) the app shows the disclaimer, and only "I understand" on that page records the
 * consent (passenger.json in the app's data folder: when, and which text). It can only be accepted while the car is
 * parked, so it is not something to tap through on the move. Switching the setting off deletes the consent.
 *
 *   const gate = createGate({ now });            the parked check alone (the tests feed it)
 *   gate.speed(v)  gate.stage(s)  gate.parked()  gate.why()
 *   watch(signals, log, gate)                    feeds a gate from the vehicle signals (speed polled every 2 s)
 *   const consent = createConsent(file);         consent.given()  consent.accept()  consent.clear()
 *   pictureAllowed(gate, motionSetting, consent) the one question the player asks
 *
 * Node 8.
 */
const fs = require('fs');

const MAX_KMH = 1;
const STALE_MS = 10000;
const DISCLAIMER_VERSION = 1;
/** the disclaimer, as shown (drawn one line each) */
const DISCLAIMER = [
    'Video while driving is for passengers only.',
    'The centre screen is in the driver\'s line of sight. A moving picture there takes',
    'the driver\'s eyes off the road, and in many places it is against the law for a',
    'video to be visible to the driver while the vehicle is moving.',
    'By switching this on you confirm that a passenger is watching, that the driver',
    'will not watch or operate the app while driving, and that you have checked it is',
    'legal where you drive. You are responsible for how it is used.',
];

// selector position: statusGearboxDrive.statusActualStageDrive (P = 1 or 'P') and
// DataPowerTrain2.statusGearSelectionDrive (P = 3 or 'P'; 4 = 'NP': N or P, not told apart)
function stageFromGearbox(v) {
    const x = v && v.statusActualStageDrive;
    if (x == null) return undefined;
    return x === 1 || x === 'P' ? 'P' : String(x);
}
function stageFromSelection(v) {
    const x = v && v.statusGearSelectionDrive;
    if (x == null) return undefined;
    return x === 3 || x === 'P' ? 'P' : x === 4 || x === 'NP' || x === 'N_OR_P' ? 'NP' : String(x);
}

function createGate(o) {
    const now = (o && o.now) || Date.now;
    const st = { speed: null, speedT: 0, stage: undefined, stageT: 0 };
    return {
        st,
        /** Vehicle2.statusCarSpeed2: speedVehicleCentreOfGravity, 1/64 km/h a step, 65535 = no value */
        speed(v) {
            const k = v && v.speedVehicleCentreOfGravity;
            if (typeof k === 'number' && k >= 0 && k !== 65535) { st.speed = k * 0.015625; st.speedT = now(); }
        },
        stage(s) { if (s !== undefined) { st.stage = s; st.stageT = now(); } },
        parked() {
            const n = now();
            return st.speed !== null && n - st.speedT < STALE_MS && st.speed < MAX_KMH && (st.stage === 'P' || st.stage === 'NP');
        },
        why() {
            const n = now();
            const sp = st.speed === null ? 'speed unknown' : 'speed ' + st.speed.toFixed(1) + ' km/h' + (n - st.speedT >= STALE_MS ? ' (old)' : '');
            const sg = st.stage === undefined ? 'selector unknown' : 'selector ' + st.stage;
            return sp + ', ' + sg;
        },
    };
}

/** feeds gate g from the vehicle signals; never throws (a gate nothing feeds is never parked) */
function watch(signals, log, g) {
    try {
        if (!signals || typeof signals.watch !== 'function') throw new Error('no vehicle signals');
        const said = (what) => (s) => log && log.info('drive gate: ' + what + ' ' + (s && s.error ? 'error: ' + s.error : 'subscribed'));
        const failed = (what) => (e) => log && log.warn('drive gate: ' + what + ' error: ' + ((e && e.message) || e));
        signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', { statusCarSpeed2: (v) => g.speed(v) }, log, { pollMs: 2000 })
            .then(said('speed'), failed('speed'));
        signals.watch('de.bmw.infrastructure.VehicleInformation', '1', {
            statusGearboxDrive: (v) => g.stage(stageFromGearbox(v)),
            DataPowerTrain2: (v) => g.stage(stageFromSelection(v)),
        }, log, { pollMs: 2000 }).then(said('selector'), failed('selector'));
    } catch (e) {
        if (log) log.warn('drive gate: ' + ((e && e.message) || e) + ' - never parked');
    }
    return g;
}

/** the owner's acceptance of the passenger disclaimer, kept in `file` */
function createConsent(file) {
    let have = null;
    const read = () => {
        if (have !== null) return have;
        try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); have = !!(j && j.accepted === true && j.version === DISCLAIMER_VERSION); }
        catch (e) { have = false; }
        return have;
    };
    return {
        given: read,
        accept() {
            have = true;
            try { fs.writeFileSync(file, JSON.stringify({ accepted: true, version: DISCLAIMER_VERSION, at: new Date().toISOString() })); return true; }
            catch (e) { have = false; return false; }   // not recorded: not given
        },
        clear() { have = false; try { fs.unlinkSync(file); } catch (e) { /* none */ } },
    };
}

/** may the picture show now? false whatever goes wrong */
function pictureAllowed(gate, motionSetting, consent) {
    try {
        if (gate && gate.parked() === true) return true;
        return motionSetting === true && !!consent && consent.given() === true;
    } catch (e) { return false; }
}

module.exports = { createGate, watch, createConsent, pictureAllowed, stageFromGearbox, stageFromSelection, DISCLAIMER, DISCLAIMER_VERSION, MAX_KMH, STALE_MS };
