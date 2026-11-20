'use strict';
/**
 * vitals.js - Proven Gauges data layer.
 *
 *   const v = new Vitals(ctx, engine);
 *   v.data()            the values to draw (demo drive or the car), internal units:
 *                       rpm, km/h, bar (boost above outside air, tyres), deg C, g, Nm, kW
 *   v.usingDemo()       demo data on screen?
 *   v.pk()              peaks (peak hold), v.raise(key, value), v.resetPeaks()
 *   v.hist              1 Hz, last 5 minutes: coolant, oil, gearbox, egs, ambient, iat, hpfp, lpfp, timing
 *   v.trace             5 Hz, last 60 s: boost, target
 *   v.want([keys])      engine-unit values on screen now (read fast while they are)
 *   v.seenScreen()      called per frame: the app is on screen
 *   v.has(group)        the car has sent real data for this group (boost, gearbox, egs, iat, tyres, ...)
 *   v.why(key) / v.dmeWhy(key) / v.boostWhy()    short reason for a missing value
 *
 * Where the values come from
 *   - the car's own signals (SOME/IP notifications, nothing is asked): rpm, speed, coolant, oil,
 *     acceleration, sport-display boost / power, torque, gear, gearbox oil, outside temperature, tyres
 *   - the engine unit (DME) and gearbox unit (EGS) over the head unit's diagnostic gateway, READ ONLY
 *     (kit/readonly-diag.js lets nothing but UDS 0x22 and OBD 0x01 / 0x09 leave the head unit):
 *     intake air temperature, rail and low-side fuel pressure, ignition timing, boost target / actual,
 *     boost and oil temperature as fallbacks, gearbox temperature
 *
 * Signal names, scaling, plausibility ranges and the "only once it has changed" rule for fields
 * some cars never fill follow M Vitals (apps/car_vitals) of the idrive7-apps kit
 * (MIT, (c) cauliflowermossgrape), where they were tested on cars.
 */
const fs = require('fs');
const path = require('path');
const G = require('./kit/gauges');
const { GearGuess, selectionOf } = require('./kit/car');
const { ReadOnlyDiag } = require('./kit/readonly-diag');
const { DidReader } = require('./kit/dids');
const Demo = require('./demo');

const HIST_SEC = 300, TRACE_N = 300, TRACE_MS = 200;
/* Plausible ranges. Outside = the car's "no data" marker or a field this car fills differently. */
const TYRE_T = [-40, 150], TYRE_P = [0.5, 6], TYRE_PT = [1, 6];
const RANGE = {
    rpm: [0, 12000], coolant: [-40, 160], oil: [-40, 170], gearbox: [-40, 160], egs: [-40, 160], ambient: [-50, 60],
    iat: [-40, 150], hpfp: [0, 500], lpfp: [0, 15], timing: [-64, 64],
    boostFes: [-1, 4], boostDme: [-1, 4], boostTarget: [-1, 4], boostActual: [-1, 4],
    tFL: TYRE_T, tFR: TYRE_T, tRL: TYRE_T, tRR: TYRE_T, pFL: TYRE_P, pFR: TYRE_P, pRL: TYRE_P, pRR: TYRE_P,
    ptFL: TYRE_PT, ptFR: TYRE_PT, ptRL: TYRE_PT, ptRR: TYRE_PT,
};
/* Fields some cars never fill sit at one number: they only count once they changed by this much. */
const MOVE = { gearbox: 1, egs: 1, boostFes: 0.03, boostDme: 0.03 };
const GROUP = {
    gearbox: 'gearbox', egs: 'egs', boostFes: 'boost', boostDme: 'boost', iat: 'iat', hpfp: 'hpfp', lpfp: 'lpfp', timing: 'timing',
    boostTarget: 'boostCtl', boostActual: 'boostCtl',
    tFL: 'tyreTemp', tFR: 'tyreTemp', tRL: 'tyreTemp', tRR: 'tyreTemp', pFL: 'tyres', pFR: 'tyres', pRL: 'tyres', pRR: 'tyres',
};
const DME_KEYS = ['iat', 'hpfp', 'lpfp', 'timing', 'boostCtl', 'egs'];
const TYRES = ['FL', 'FR', 'RL', 'RR'];
// gearbox enums: names or wire numbers, as in kit/car.js
const GEARS = { G1: 1, G2: 2, G3: 3, G4: 4, G5: 5, G6: 6, G7: 7, G8: 8, G9: 9, G10: 10, R: -1, N_OR_P: 0 };
const gearOf = (x) => (typeof x === 'number' ? (x >= 3 && x <= 12 ? x - 2 : x === 1 ? -1 : x === 2 ? 0 : undefined) : GEARS[x]);
const STAGES = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' };
const PROGRAMS = { S_MINUS_PROGRAMM: 'S', M_MINUS_PROGRAMM: 'M', 1: 'S', 2: 'M' };

/** Selector programme (D / S / M / P / R / N) from the gearbox status; field names differ between cars. */
function modeOf(o) {
    for (const k of Object.keys(o || {})) {
        if (k === 'statusActualGearDrive' || /StageDrive/.test(k) || !/select|lever|position|program|mode|range|manual|sport|tip/i.test(k)) continue;
        const v = o[k];
        if (v === true || v === 1) { if (/manual|tip/i.test(k)) return 'M'; if (/sport/i.test(k)) return 'S'; continue; }
        const x = String(v).toUpperCase();
        if (/NOT|INACTIVE|INVALID|SIGNAL|UNKNOWN|OFF|NO_/.test(x)) continue;
        if (/MANU|TIPP|^M$|^M_|_M$|^M\d/.test(x)) return 'M';
        if (/SPORT|^S$|_S$|^DS$/.test(x)) return 'S';
        if (/PARK|^P$/.test(x)) return 'P';
        if (/REVERSE|^R$/.test(x)) return 'R';
        if (/NEUTRAL|^N$/.test(x)) return 'N';
        if (/DRIVE|^D$|^D_|_D$/.test(x)) return 'D';
    }
    return null;
}

class Vitals {
    constructor(ctx, engine) {
        const { settings, log } = ctx;
        this.ctx = ctx; this.settings = settings; this.log = log; this.engine = engine;
        const cfg = ctx.spec.config || {};
        const S = cfg.scaling || {};
        const sc = (k, raw) => {
            const c = S[k];
            if (!c || raw === undefined || raw === null || raw === c.invalid || (c.invalidFrom != null && raw >= c.invalidFrom)) return null;
            return raw * c.factor + (c.offset || 0);
        };

        const live = this.live = {};
        this.peak = {}; this.demoPeak = {}; this.peakAt = new Map();
        this.hist = { coolant: [], oil: [], gearbox: [], egs: [], ambient: [], iat: [], hpfp: [], lpfp: [], timing: [] };
        this.trace = { boost: [], target: [] };
        this.tyreStart = {}; this.demoTyreStart = {};
        this.bad = {}; this.first = {}; this.moved = {};
        this.lastCar = 0; this.startT = Date.now(); this.subs = [];
        this.screenT = 0; this.wantT = {};
        this.demo = new Demo();
        this.demo.setRedline(engine.redline());
        engine.onChange(() => this.demo.setRedline(engine.redline()));

        // which groups this car has sent real data for: remembered, so the next start shows them at once
        this.seenFile = path.join(ctx.dataDir, 'seen.json');
        this.seen = {};
        try { this.seen = JSON.parse(fs.readFileSync(this.seenFile, 'utf8')) || {}; } catch (e) { /* not yet */ }

        /*
         * The car's display units: the TPMS sends tyre pressures as 0.1 x raw in the car's pressure unit
         * and tyre temperatures as the car's degrees + 40 (deg F on a car set to Fahrenheit).
         */
        const carUnits = { press: null, temp: null, psiSeen: false };
        const PRESS_UNITS = { 1: 'BAR', 2: 'KPA', 3: 'PSI' }, TEMP_UNITS = { 1: 'C', 2: 'F' };
        const PRESS_TO_BAR = { BAR: 1, KPA: 0.01, PSI: 1 / 14.5038 };
        const unitName = (map, v) => (map[v] || (Object.values(map).indexOf(v) >= 0 ? v : null));
        const tyreP = (raw) => {
            const v = sc('tyrePress', raw);
            if (v === null) return null;
            const k = PRESS_TO_BAR[carUnits.press];
            if (k) return v * k;
            // unit not known yet: each unit's plausible tyre pressures lie apart
            if (v >= TYRE_P[0] && v <= TYRE_P[1]) return v;
            if (v >= 7 && v < 60) { carUnits.psiSeen = true; return v / 14.5038; }
            if (v >= 60 && v <= 600) return v / 100;
            return v;
        };
        const tyreT = (raw) => {
            const v = sc('tyreTemp', raw), f = carUnits.temp ? carUnits.temp === 'F' : carUnits.psiSeen;
            return v !== null && f ? (v - 32) * 5 / 9 : v;
        };
        /*
         * g-force: whatever an axis reads at a standstill is its offset (sensor zero, or a slope):
         * learned while the car stands and taken off.
         */
        const G0 = 9.80665, gZero = { gLong: { z: 0, n: 0 }, gLat: { z: 0, n: 0 } };
        let stillSince = 0;
        const standing = () => stillSince > 0 && Date.now() - stillSince > 2000;
        const putG = (k, raw) => {
            const a = sc('accel', raw);
            if (a === null) return;
            const g = a / G0, z = gZero[k];
            if (standing() && Math.abs(g) <= 1) { z.n = Math.min(z.n + 1, 50); z.z += (g - z.z) / z.n; }
            put(k, g - z.z);
        };

        const guess = new GearGuess();
        const put = this.put = (k, v) => {
            if (v === null || v === undefined || !isFinite(v)) return;
            this.lastCar = Date.now();
            const r = RANGE[k];
            if (r && (v < r[0] || v > r[1])) { this.bad[k] = v; return; }
            delete this.bad[k];
            if (MOVE[k] != null) {
                if (this.first[k] === undefined) this.first[k] = v;
                else if (!this.moved[k] && Math.abs(v - this.first[k]) >= MOVE[k]) { this.moved[k] = true; this.remember([GROUP[k], k]); }
            } else if (GROUP[k]) this.remember([GROUP[k]]);
            live[k] = v;
            if (k === 'boostFes' || k === 'boostDme') { this.updBoost(); return; }
            if (k === 'rpm' || k === 'torque') {
                // power without sport-display data: crankshaft torque x engine speed
                if (G.isNum(live.torque) && G.isNum(live.rpm)) live.powerCalc = Math.max(0, live.torque * live.rpm / 9549);
            }
            if (k === 'rpm') this.rpmT = Date.now();
            if (k === 'speed') stillSince = v < 0.5 ? stillSince || Date.now() : 0;
            if ((k === 'rpm' || k === 'speed') && G.isNum(live.rpm) && G.isNum(live.speed)) {
                const g = guess.feed(live.rpm, live.speed);
                live.gearGuess = live.speed < 3 ? null : g;          // nothing at a standstill: it can't tell P, N or D there
            }
            if (/^p(FL|FR|RL|RR)$/.test(k) && this.tyreStart[k] === undefined) this.tyreStart[k] = v;
        };

        let oilCarT = 0;
        this.oilCarT = () => oilCarT;
        const watches = [
            ['de.bmw.infotainment.vehicle.CDS', {
                statusEngineSpeed2: (v) => put('rpm', sc('rpm', v.actualValueRPMEngineCrankshaft)),
                statusEngineTemperature: (v) => {
                    put('coolant', sc('engineTemp', v.temperatureEngineDrive));
                    const oil = sc('engineTemp', v.temperatureEngineOilDrive);
                    if (oil !== null) { oilCarT = Date.now(); put('oil', oil); }
                },
            }],
            ['de.bmw.infotainment.vehicle.CDS2', {
                statusLongitudinalAccelerationMassCenter: (v) => putG('gLong', v.longitudinalAccelerationCentreOfGravity),
                statusLateralAccelerationMassCenter: (v) => putG('gLat', v.lateralAccelerationCentreOfGravity),
            }],
            ['de.bmw.infotainment.vehicle.Vehicle', {
                statusNewCurrentUnitsStatusExt: (v) => {
                    const press = unitName(PRESS_UNITS, v && v.unitOfMeasurementAirPressure), temp = unitName(TEMP_UNITS, v && v.unitOfMeasurementTemperature);
                    if (press === carUnits.press && temp === carUnits.temp) return;
                    carUnits.press = press; carUnits.temp = temp;
                    log.info('car units: pressure ' + (press || '?') + ', temperature ' + (temp || '?'));
                },
            }],
            ['de.bmw.infotainment.vehicle.Vehicle2', Object.assign({ statusCarSpeed2: (v) => put('speed', sc('speed', v.speedVehicleCentreOfGravity)) }, engine.handlers())],
            ['de.bmw.infotainment.drivingexcitement.FES', {
                statusSwitchDriveDynamicSport2: (v) => {
                    // in the car's pressure unit: 0.01 bar (or 1 kPa) a step, 0.1 psi a step on a car set to psi
                    const b = sc('boost', v.displayBoostPressure);
                    put('boostFes', G.isNum(b) && carUnits.press === 'PSI' ? b * 10 / 14.5038 : b);
                },
                // the HMI's sport display: power / torque in % of the car's maximum
                statusVehicleDynamicEngine: (v) => { put('powerPct', sc('sportPct', v.displaySportEnginePower)); put('torquePct', sc('sportPct', v.displaySportEngineTorque)); },
                // negative = engine braking: shown as 0
                statusActualValueTorque2: (v) => { const tq = sc('torque', v.actualValueTorqueCrankshaft); put('torque', tq === null ? null : Math.max(0, tq)); },
            }],
            ['de.bmw.infrastructure.VehicleInformation', {
                statusGearboxDrive: (v) => {
                    const g = gearOf(v && v.statusActualGearDrive);
                    if (g !== undefined) { live.gear = g; this.lastCar = Date.now(); }
                    live.stage = STAGES[v && v.statusActualStageDrive];
                    live.gearMode = modeOf(v);
                },
                // some cars never send statusGearboxDrive: P / R / N / gear from here too
                DataPowerTrain2: (v) => {
                    const sel = selectionOf(v && v.statusGearSelectionDrive);
                    if (!sel) return;
                    if (sel.stage !== undefined) live.stage = sel.stage;
                    live.gear = sel.gear; this.lastCar = Date.now();
                },
            }],
            ['de.bmw.infrastructure.analytics.BasicDataSet', { basicDataSet: (v) => put('gearbox', sc('gearboxTemp', v.valueTemperatureTransmissionOil)) }],
            ['de.bmw.infrastructure.EnvironmentalInformation', { ExteriorTemperature: (v) => put('ambient', sc('ambient', v.temperatureExterior)) }],
            ['de.bmw.infotainment.vehicle.TPMS', {
                statusTyreTemperature: (v) => {
                    put('tFL', tyreT(v.actualValueTemperatureTyreFLH)); put('tFR', tyreT(v.actualValueTemperatureTyreFRH));
                    put('tRL', tyreT(v.actualValueTemperatureTyreRLH)); put('tRR', tyreT(v.actualValueTemperatureTyreRRH));
                },
                statusTyrePressure: (v) => {
                    put('pFL', tyreP(v.actualValuePressureTyreFLH)); put('pFR', tyreP(v.actualValuePressureTyreFRH));
                    put('pRL', tyreP(v.actualValuePressureTyreRLH)); put('pRR', tyreP(v.actualValuePressureTyreRRH));
                },
                statusTargetTyrePressure: (v) => {
                    put('ptFL', tyreP(v.targetPressureTyreFLH)); put('ptFR', tyreP(v.targetPressureTyreFRH));
                    put('ptRL', tyreP(v.targetPressureTyreRLH)); put('ptRR', tyreP(v.targetPressureTyreRRH));
                },
            }],
            ['de.bmw.infotainment.misc.MDrive', { dataDisplayGearbox: (v) => { live.program = PROGRAMS[v && v.displayProgramGearbox] || null; } }],
        ];
        log.info('subscribing signals');
        // tyre values are also read every 10 s: a car may not notify them
        Promise.all(watches.map(([iface, h]) => ctx.signals.watch(iface, '1', h, log, /\.TPMS$/.test(iface) ? { pollMs: 10000 } : undefined)
            .then((s) => { this.subs.push(s); return s; })))
            .then((all) => log.info('signals: ' + all.map((s) => s.iface.split('.').pop() + (s.error ? '(err)' : '')).join(' ')))
            .catch((e) => log.warn('signals: ' + e));

        /* ---------- engine unit (read only) ---------- */
        const dme = this.dme = Object.assign({ ecu: 18 }, cfg.dme || {});
        const link = this.link = new ReadOnlyDiag(ctx.signals, log);
        Promise.resolve().then(() => link.init()).catch((e) => log.warn('diagnostic link: ' + e));   // in the background: the screen never waits for it
        const rd = this.rd = new DidReader(link, { ecu: dme.ecu });
        const at = this.dmeAt = {}, fail = this.dmeFail = {}, tried = {};
        let baro = 101.3, baroT = 0, timer = null, busy = false, last = 0, round = 0;
        const freshBaro = async () => {
            if (Date.now() - baroT > 60000) { baroT = Date.now(); const b = await rd.value('baro', dme.baro); if (b !== null) baro = b; }
        };
        /** Boost from the engine unit: charge / manifold pressure (absolute, kPa) minus outside air pressure -> bar. */
        const readBoost = async () => {
            await freshBaro();
            const m = await rd.value('boost', dme.boost);
            return m === null ? null : (m - baro) / 100;
        };
        /** Boost target and actual (absolute kPa -> bar above outside air); null while the target doesn't answer. */
        const readBoostCtl = async () => {
            let target = await rd.value('boostTarget', dme.boostTarget);
            if (target === null) return null;
            let actual = await rd.value('boostActual', dme.boostActual);
            await freshBaro();
            target = (target - baro) / 100;
            actual = actual === null ? null : (actual - baro) / 100;
            return { target, actual };
        };
        const have = (k) => (dme[k === 'boostCtl' ? 'boostTarget' : k] || []).length > 0;
        /*
         * The engine unit is only asked while someone can see the result or the engine runs: with the
         * app on screen (the values of the gauge set shown about twice a second, everything else every
         * 5 s so the traces keep filling) or, off screen, every 5 s while the engine turns. A parked,
         * switched-off car is left alone.
         */
        const poll = async () => {
            busy = true; last = Date.now(); round++;
            const now = Date.now();
            const onScreen = now - this.screenT < 3000, running = now - (this.rpmT || 0) < 10000 && live.rpm > 400;
            const needBoost = this.boostFromDme(), needOil = (dme.oil || []).length > 0 && now - oilCarT > 15000;
            const visible = DME_KEYS.filter((k) => k !== 'egs' && have(k) && now - (this.wantT[k] || 0) < 1500)
                .concat(needBoost && now - (this.wantT.boost || 0) < 1500 ? ['boost'] : []);
            const fast = onScreen && visible.length && round % 12 ? visible : null;
            try {
                if (settings.get('engineData') !== 'off' && link.available && (onScreen || running) && !this.usingDemo()) {
                    if (round % 6 === 0) link.wake();                // a unit that was asleep gets another go
                    const keys = fast || DME_KEYS.filter(have).concat(needBoost ? ['boost'] : [], needOil ? ['oil'] : []);
                    for (const k of keys) {
                        if ((fail[k] || 0) >= 3 && Date.now() - (tried[k] || 0) < 30000) continue;      // refused: only every 30 s
                        tried[k] = Date.now();
                        const v = k === 'boost' ? await readBoost() : k === 'boostCtl' ? await readBoostCtl() : await rd.value(k, dme[k]);
                        if (k === 'oil' && v !== null && Date.now() - oilCarT < 15000) continue;       // the car's own value came meanwhile
                        if (v === null || v === undefined) { fail[k] = (fail[k] || 0) + 1; continue; }
                        at[k] = Date.now(); fail[k] = 0;
                        if (k === 'boostCtl') { put('boostTarget', v.target); if (v.actual !== null) put('boostActual', v.actual); else delete live.boostActual; }
                        else put(k === 'boost' ? 'boostDme' : k, v);
                    }
                }
            } catch (e) { log.warn('engine unit poll: ' + e); }
            busy = false;
            timer = setTimeout(poll, fast ? 400 : 5000);
        };
        timer = setTimeout(poll, 1500);
        /** A gauge set that shows engine-unit values was opened: don't wait for the slow timer. */
        this.kick = () => { if (!busy && Date.now() - last > 600) { clearTimeout(timer); timer = setTimeout(poll, 0); } };

        // 1 Hz histories (5 minutes) for the thermal traces
        // (the kit does not guard a timer the app starts itself, and an uncaught error would stop the app;
        // an error that keeps coming is logged the first time and then once in 300, not every time)
        let histErr = 0, traceErr = 0;
        setInterval(() => {
            try {
                const d = this.data();
                Object.keys(this.hist).forEach((k) => {
                    let v = d[k] == null ? null : d[k];
                    if (DME_KEYS.indexOf(k) >= 0 && !this.fresh(k)) v = null;
                    this.hist[k].push(v); if (this.hist[k].length > HIST_SEC) this.hist[k].shift();
                });
            } catch (e) { if (histErr++ % 300 === 0) log.warn('history (' + histErr + 'x): ' + (e && e.stack || e)); }
        }, 1000);
        // 5 Hz boost trace (60 s) for the Boost gauge set
        setInterval(() => {
            try {
                const d = this.data(), tr = this.trace;
                tr.boost.push(G.isNum(d.boost) ? d.boost : null);
                tr.target.push(this.fresh('boostCtl') && G.isNum(d.boostTarget) ? d.boostTarget : null);
                if (tr.boost.length > TRACE_N) { tr.boost.shift(); tr.target.shift(); }
            } catch (e) { if (traceErr++ % 300 === 0) log.warn('boost trace (' + traceErr + 'x): ' + (e && e.stack || e)); }
        }, TRACE_MS);
    }

    remember(keys) {
        const add = keys.filter((x, i) => x && !this.seen[x] && keys.indexOf(x) === i);
        if (!add.length) return;
        add.forEach((x) => { this.seen[x] = true; });
        this.log.info('real data from the car: ' + add.join(', '));
        try { fs.writeFileSync(this.seenFile, JSON.stringify(this.seen)); } catch (e) { this.log.warn('seen save: ' + e); }
    }
    /** A MOVE value counts once it changed this session or the car is known to send it. */
    trusted(k) { return MOVE[k] == null || !!this.moved[k] || !!this.seen[k]; }

    carPresent() { return this.lastCar > 0 || this.subs.some((s) => s.available); }
    /** Auto: demo only until the car answers (a parked car sends nothing new for minutes, which is not "no car"). */
    usingDemo() {
        const m = this.settings.get('demo');
        return m === 'on' || (m === 'auto' && !this.carPresent() && Date.now() - this.startT > 5000);
    }

    /** What the screen shows: demo data as it is; the car's values with doubtful ones left out until proven real. */
    data() {
        if (this.usingDemo()) {
            const d = this.demo.sample();
            TYRES.forEach((k) => { if (this.demoTyreStart['p' + k] === undefined) this.demoTyreStart['p' + k] = d['p' + k]; });
            return d;
        }
        const v = Object.assign({}, this.live);
        Object.keys(MOVE).forEach((k) => { if (!this.trusted(k)) v[k] = null; });
        return v;
    }

    /** Boost from the source the setting asks for; Auto: the sport display if it works, else the engine unit. */
    updBoost() {
        const src = this.settings.get('boostSource'), live = this.live;
        const fes = G.isNum(live.boostFes) ? live.boostFes : null, dmeB = G.isNum(live.boostDme) ? live.boostDme : null;
        live.boost = src === 'fes' ? fes : src === 'dme' ? dmeB
            : fes !== null && this.trusted('boostFes') ? fes : dmeB !== null && this.trusted('boostDme') ? dmeB : null;
    }
    /** Boost still needed from the engine unit? */
    boostFromDme() {
        const src = this.settings.get('boostSource');
        return (this.dme.boost || []).length > 0 && (src === 'dme' || (src !== 'fes' && !(G.isNum(this.live.boostFes) && this.trusted('boostFes'))));
    }

    /* ---------- peaks ---------- */
    pk() { return this.usingDemo() ? this.demoPeak : this.peak; }
    /**
     * Peak hold: a peak follows new highs and drops back to the current value "peakHold" seconds after
     * it was last raised (0 = until Reset peaks). Called per frame, so it also drops while nothing new arrives.
     */
    raise(k, v) {
        if (!G.isNum(v)) return;
        const o = this.pk(), atMap = this.peakAt.get(o) || this.peakAt.set(o, {}).get(o), now = Date.now(), hold = this.settings.get('peakHold') * 1000;
        if (o[k] === undefined || v >= o[k] || (hold > 0 && now - (atMap[k] || 0) > hold)) { o[k] = v; atMap[k] = now; }
    }
    /** Session maximum (never drops until reset): for the g-force peaks. */
    max(k, v) { if (G.isNum(v)) { const o = this.pk(); if (o[k] === undefined || v > o[k]) o[k] = v; } }
    resetPeaks() {
        const o = this.pk();
        Object.keys(o).forEach((k) => delete o[k]);
        if (this.usingDemo()) this.demoTyreStart = {}; else this.tyreStart = {};
        this.log.info('peaks reset');
    }
    starts() { return this.usingDemo() ? this.demoTyreStart : this.tyreStart; }

    /* ---------- engine unit bookkeeping ---------- */
    seenScreen() { this.screenT = Date.now(); }
    /** These engine-unit values are on screen now. */
    want(keys) {
        const now = Date.now();
        keys.forEach((k) => { this.wantT[k] = now; });
        this.kick();
    }
    /** Is an engine-unit value fresh (demo: always)? */
    fresh(k) { return this.usingDemo() || (!!this.dmeAt[k] && Date.now() - this.dmeAt[k] < 15000); }
    /** The car / engine unit has sent real data for this group (demo: yes). */
    has(group) { return this.usingDemo() || !!this.seen[group]; }

    /** Why a car signal is missing (short: it goes under a tile). */
    why(k) {
        if (this.bad[k] !== undefined) return 'not a real value';
        if (G.isNum(this.live[k]) && !this.trusted(k)) return 'waiting for a change';
        return 'no data from the car';
    }
    /** Why an engine-unit value is missing. */
    dmeWhy(k) {
        if (this.settings.get('engineData') === 'off') return 'engine data off';
        if (!this.link.ready) return 'no diagnostic link';
        if (!this.link.available) return 'link down';
        const list = this.dme[k === 'boostCtl' ? 'boostTarget' : k] || [];
        const r = list.map((c) => this.rd.raws[this.rd.key(c)]).filter(Boolean);
        if (!r.length) return 'reading...';
        if (r.every((x) => /NRC 31|NRC 11|NRC 12/.test(x.why))) return 'not on this car';
        return 'no reading';
    }
    boostWhy() {
        const src = this.settings.get('boostSource');
        if (src === 'fes') return this.bad.boostFes !== undefined ? 'sport display: not a real value' : 'no boost from the sport display';
        const dmeMsg = this.settings.get('engineData') === 'off' ? 'engine data off' : !this.link.ready ? 'no diagnostic link'
            : !this.link.available ? 'diagnostic link down' : this.dmeFail.boost ? 'engine unit: no boost value' : 'engine unit: reading...';
        return src === 'dme' ? dmeMsg : 'sport display: ' + (G.isNum(this.live.boostFes) ? 'not changing' : 'nothing') + '  ·  ' + dmeMsg;
    }
}

Vitals.TYRES = TYRES;
module.exports = Vitals;
