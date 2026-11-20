'use strict';
/**
 * signals.js - the app's live data layer.
 *
 * Every widget id maps to a real SOME/IP field the car broadcasts. A value is
 * only shown when the car actually sent it: `valid` is false until then, and
 * `stale` marks a value the car stopped refreshing. Nothing here invents a
 * number - the demo drive is a separate, explicitly labelled source.
 *
 * Scalings and struct members are BMW's own (M Laptimer TypeConverters, x_call's
 * converters); they are the same ones kit/runtime/car.js uses.
 */

const CDS = 'de.bmw.infotainment.vehicle.CDS';
const CDS2 = 'de.bmw.infotainment.vehicle.CDS2';
const V2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const KOMBI = 'de.bmw.infotainment.KombiIF';
const FES = 'de.bmw.infotainment.drivingexcitement.FES';
const TPMS = 'de.bmw.infotainment.vehicle.TPMS';
const VI = 'de.bmw.infrastructure.VehicleInformation';
const ENV = 'de.bmw.infrastructure.EnvironmentalInformation';
const PEDAL = 'de.bmw.powertrain.AcceleratorPedal';
const STEER = 'de.bmw.chassis.SteeringAngle';
const VM = 'de.bmw.chassis.VehicleModel';
const DSC = 'de.bmw.chassis.VehicleStabilizationManagement';

const G0 = 9.80665;

// Fields a car may not notify on its own: BMW's own app only ever reads TPMS,
// it never subscribes. Read them on a timer instead of waiting for a change.
const POLL = { [TPMS]: 10000, [KOMBI]: 10000 };

// A parked car sends nothing new for minutes, so "no update for a while" is not
// "no car". Only a value older than this is marked stale.
const STALE_MS = 120000;

const NO_ENUM = /UNGUELTIG|UNBEFUELLT|INITIALISIERUNG|NICHT_VERFUEGBAR|RESERVIERT|FEHLER/;

function words(x) {
    const s = String(x).replace(/_+/g, ' ').trim().toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** P / R / N and the gear from DataPowerTrain2 (names or wire numbers). */
function selection(v) {
    const x = v.statusGearSelectionDrive;
    const n = typeof x === 'number' ? x : { N: 1, R: 2, P: 3, NP: 4 }[x] || (/^_\d$/.test(String(x)) ? 4 + Number(String(x).slice(1)) : 0);
    if (n === 1) return { text: 'N' };
    if (n === 2) return { text: 'R' };
    if (n === 3) return { text: 'P' };
    if (n === 4) return { text: 'N/P' };
    if (n >= 5 && n <= 13) return { text: 'D' + (n - 4) };
    return { bad: true };
}

const corner = (list, extra) => list.map((m, n) => Object.assign({ m, wheel: n }, extra));

/**
 * id -> where the value comes from.
 *   k / o: value = raw * k + o        bad / max: raw values meaning "no data"
 *   lim: [lo, hi] outside is no data  s16: raw is signed 16 bit
 *   e: enum text per raw value        fn: the value from the whole struct
 *   calc: built from other values     d: decimals for display
 */
const SRC = {
    // ---- engine ----
    rpm: { i: CDS, f: 'statusEngineSpeed2', m: 'actualValueRPMEngineCrankshaft', k: 0.25, bad: [65535], d: 0 },
    torque: { i: FES, f: 'statusActualValueTorque2', m: 'actualValueTorqueCrankshaft', k: 0.5, o: -1023.5, max: 4095, d: 0 },
    power: { calc: (get) => { const t = get('torque'), r = get('rpm'); return t && r && r.n > 0 ? { n: Math.max(0, t.n) * r.n / 9549 } : null; }, d: 0 },
    boost: { i: FES, f: 'statusSwitchDriveDynamicSport2', m: 'displayBoostPressure', k: 0.01, bad: [255], d: 2 },
    boostMax: { i: FES, f: 'statusSwitchDriveDynamicSport2', m: 'displayMaximumValueBoostPressure', k: 0.01, bad: [255], d: 2 },
    powerPct: { i: FES, f: 'statusVehicleDynamicEngine', m: 'displaySportEnginePower', bad: [255], d: 0 },
    torquePct: { i: FES, f: 'statusVehicleDynamicEngine', m: 'displaySportEngineTorque', bad: [255], d: 0 },
    pedal: { i: PEDAL, f: 'AngleAcceleratorPedal', m: 'actualValueAngleAcceleratorPedal', k: 0.025, lim: [-2, 102], d: 0 },
    gear: { i: VI, f: 'DataPowerTrain2', fn: selection },
    engineState: { i: CDS, f: 'statusEngineStatus', m: 'statusEngineRunDrive', e: { MOTOR_AUS: 'ВЫКЛ', MOTOR_STARTET: 'ЗАПУСК', MOTOR_LAEUFT: 'РАБОТАЕТ', 0: 'ВЫКЛ', 1: 'ЗАПУСК', 2: 'РАБОТАЕТ', 3: null } },
    startStop: { i: CDS2, f: 'statusPushButtonMSA2', m: 'statusFunctionMSA', e: { MSA_AKTIVIERT: 'ВКЛ', MSA_DEAKTIVIERT: 'ВЫКЛ', 0: 'ВЫКЛ', 1: 'ВКЛ', 3: null } },
    oilLevel: { i: V2, f: 'statusOilDipstick2', m: 'fluidLevelEngineOilRelative', e: { MOTOROELSTAND_UNTER_MINIMUM: 'НИЖЕ МИН', MOTOROELSTAND_AM_MINIMUM: 'МИНИМУМ', MOTOROELSTAND_1_4: '1/4', MOTOROELSTAND_2_4: '2/4', MOTOROELSTAND_3_4: '3/4', MOTOROELSTAND_4_4: 'ПОЛНЫЙ', MOTOROELSTAND_5_4: 'ВЫШЕ НОРМЫ', MOTOROELSTAND_UEBERFUELLT: 'ПЕРЕЛИВ', MOTOROELSTAND_OK: 'НОРМА', SERVICEFUNKTION_AKTIV: 'ЗАМЕР', 0: 'НИЖЕ МИН', 1: 'МИНИМУМ', 2: '1/4', 3: '2/4', 4: '3/4', 5: 'ПОЛНЫЙ', 6: 'ВЫШЕ НОРМЫ', 7: 'ПЕРЕЛИВ', 13: 'НОРМА', 14: 'ЗАМЕР', 15: null } },

    // ---- temperatures ----
    coolant: { i: CDS, f: 'statusEngineTemperature', m: 'temperatureEngineDrive', o: -48, bad: [255], d: 0 },
    oil: { i: CDS, f: 'statusEngineTemperature', m: 'temperatureEngineOilDrive', o: -48, bad: [255], d: 0 },
    outside: { i: ENV, f: 'ExteriorTemperature', m: 'temperatureExterior', k: 0.5, o: -40, bad: [255], d: 1 },

    // ---- tyres: 0.1 bar a step, 65532+ is no value; temperatures in °C + 40 ----
    p_fl: { i: TPMS, f: 'statusTyrePressure', m: 'actualValuePressureTyreFLH', k: 0.1, max: 65532, d: 1, wheel: 0 },
    p_fr: { i: TPMS, f: 'statusTyrePressure', m: 'actualValuePressureTyreFRH', k: 0.1, max: 65532, d: 1, wheel: 1 },
    p_rl: { i: TPMS, f: 'statusTyrePressure', m: 'actualValuePressureTyreRLH', k: 0.1, max: 65532, d: 1, wheel: 2 },
    p_rr: { i: TPMS, f: 'statusTyrePressure', m: 'actualValuePressureTyreRRH', k: 0.1, max: 65532, d: 1, wheel: 3 },
    t_fl: { i: TPMS, f: 'statusTyreTemperature', m: 'actualValueTemperatureTyreFLH', o: -40, bad: [65535], lim: [-40, 150], d: 0, wheel: 0 },
    t_fr: { i: TPMS, f: 'statusTyreTemperature', m: 'actualValueTemperatureTyreFRH', o: -40, bad: [65535], lim: [-40, 150], d: 0, wheel: 1 },
    t_rl: { i: TPMS, f: 'statusTyreTemperature', m: 'actualValueTemperatureTyreRLH', o: -40, bad: [65535], lim: [-40, 150], d: 0, wheel: 2 },
    t_rr: { i: TPMS, f: 'statusTyreTemperature', m: 'actualValueTemperatureTyreRRH', o: -40, bad: [65535], lim: [-40, 150], d: 0, wheel: 3 },
    // Target pressures: not offered as widgets of their own, they give the four-wheel widget its
    // frame of reference - "how far from where it should be" is what a driver acts on.
    tp_fl: { i: TPMS, f: 'statusTargetTyrePressure', m: 'targetPressureTyreFLH', k: 0.1, max: 65532, d: 1 },
    tp_fr: { i: TPMS, f: 'statusTargetTyrePressure', m: 'targetPressureTyreFRH', k: 0.1, max: 65532, d: 1 },
    tp_rl: { i: TPMS, f: 'statusTargetTyrePressure', m: 'targetPressureTyreRLH', k: 0.1, max: 65532, d: 1 },
    tp_rr: { i: TPMS, f: 'statusTargetTyrePressure', m: 'targetPressureTyreRRH', k: 0.1, max: 65532, d: 1 },

    // ---- driving ----
    speed: { i: V2, f: 'statusCarSpeed2', m: 'speedVehicleCentreOfGravity', k: 0.015625, bad: [65535], d: 0 },
    g_long: { i: CDS2, f: 'statusLongitudinalAccelerationMassCenter', m: 'longitudinalAccelerationCentreOfGravity', k: 0.002 / G0, o: -65 / G0, bad: [65535], d: 2 },
    g_lat: { i: CDS2, f: 'statusLateralAccelerationMassCenter', m: 'lateralAccelerationCentreOfGravity', k: 0.002 / G0, o: -65 / G0, bad: [65535], d: 2 },
    yaw: { i: CDS2, f: 'statusYawVelocityVehicle', m: 'yawVelocityVehicle', k: 0.005, o: -163.84, bad: [65535], d: 1 },
    steer: { i: STEER, f: 'ActualSteeringAngleDriver', m: 'actualValueSteeringAngleDriver', s16: true, k: 0.04395, lim: [-900, 900], d: 0 },
    mode: { i: FES, f: 'statusFESVehicleDynamicSwitchHMI', m: 'actualValueModeDrivingExperience', e: { SPORT_DYNAMIC: 'SPORT', SPORT_EXPERT: 'SPORT+', ECO_PRO_EFFICIENT: 'ECO PRO', 1: 'SPORT', 2: 'SPORT+', 3: 'SPORT IND', 4: 'COMFORT', 5: 'COMFORT+', 6: 'COMFORT IND', 7: 'ECO PRO', 8: 'ECO PRO+', 9: 'ECO IND', 10: 'ADAPTIVE', 0: null, 61: null, 62: null, 63: null } },
    slope: { i: VM, f: 'LaneSlope', m: 'actualValueLongitudinalGradientRoadway', raw: true, d: 0 },
    braking: { i: DSC, f: 'StabilizationManagement', m: 'statusBrakingDriver', raw: true, d: 0 },
    handbrake: { i: CDS, f: 'statusHandBrake', m: 'statusContactHandBrake', e: { HANDBREMSE_ANGEZOGEN: 'ЗАТЯНУТ', HANDBREMSE_GELOEST: 'СНЯТ', NICHT_CODIERT: null, 1: 'СНЯТ', 2: 'ЗАТЯНУТ', 0: null, 3: null } },

    // ---- fuel and trip ----
    fuel: { i: KOMBI, f: 'statusRangeTankStatus', m: 'fluidLevelFuelTank', max: 255, d: 0 },
    range: { i: KOMBI, f: 'statusRangeTankStatus', m: 'range', max: 4095, d: 0 },
    odo: { i: KOMBI, f: 'statusRangeTankStatus', m: 'mileageKilometre', max: 16777215, d: 0 },
    trip: { i: KOMBI, f: 'statusBordcomputerTravelData', m: 'wayPassed', bad: [65535], d: 0 },
    avgCons1: { i: KOMBI, f: 'statusBordcomputerAverage', m: 'consumptionAverage1BC1', k: 0.1, bad: [65535], d: 1 },
    avgSpeed1: { i: KOMBI, f: 'statusBordcomputerAverage', m: 'speedAverage1BC1', k: 0.1, bad: [65535], d: 0 },
    tripTime: { i: KOMBI, f: 'statusBordcomputerTravelData', fn: (v) => (typeof v.rideDurationHours === 'number' && typeof v.rideDurationMinutes === 'number' && v.rideDurationHours < 65535 && v.rideDurationMinutes < 60 ? { text: v.rideDurationHours + ':' + String(v.rideDurationMinutes).padStart(2, '0') } : { bad: true }) },
    // the injection signal is a counter of injected fuel (16 bit, it wraps): its rate is the flow
    fuelFlow: { flow: true, i: CDS2, f: 'statusInjectionVolume', m: 'injectionVolumeFuelEngine', d: 1 },
    consumption: { calc: (get) => { const f = get('fuelFlow'), s = get('speed'); return f && s && s.n >= 5 ? { n: f.n / s.n * 100 } : null; }, d: 1 },

    // ---- electrics ----
    battery: { i: CDS, f: 'statusBattery2', m: 'conditionBatteryChargingCondition', max: 151, d: 0 },
};

/** 0-100 km/h from the speed signal: a real stopwatch, not a guess. */
class AccelTimer {
    constructor() { this.t0 = null; this.best = null; this.standingSince = null; }
    feed(kmh, now) {
        if (typeof kmh !== 'number') return;
        if (kmh < 1) {
            if (this.standingSince === null) this.standingSince = now;
            if (now - this.standingSince > 2000) { this.t0 = null; }
        } else {
            this.standingSince = null;
            if (kmh < 3) { if (this.t0 === null) this.t0 = now; return; }
            if (this.t0 !== null && kmh >= 100) {
                const t = (now - this.t0) / 1000;
                if (t > 1.5 && t < 60 && (this.best === null || t < this.best)) this.best = t;
                this.t0 = null;
            }
        }
    }
    running(now) { return this.t0 === null ? null : (now - this.t0) / 1000; }
}

/** Fuel flow from the injection counter: counts a second, wrapped-safe. */
class Flow {
    constructor() { this.last = null; this.acc = 0; this.accT = 0; this.rate = null; this.rateT = 0; }
    feed(raw, t) {
        if (typeof raw !== 'number' || !isFinite(raw)) return;
        if (this.last && t > this.last.t) {
            const d = (raw - this.last.raw + 65536) % 65536, dt = t - this.last.t;
            if (dt > 5000 || d > 40000) { this.acc = 0; this.accT = 0; }
            else {
                this.acc += d; this.accT += dt;
                if (this.accT >= 1000) { this.rate = this.acc / this.accT * 1000; this.rateT = t; this.acc = 0; this.accT = 0; }
            }
        }
        this.last = { raw, t };
    }
    lph(now) {
        if (!this.last) return null;
        if (now - this.last.t > 3000) return 0;
        if (this.rate === null) return null;
        return this.rate * 0.0036;
    }
}

function valueOf(src, raw) {
    if (!raw || typeof raw !== 'object') return { valid: false };
    if (src.fn) { const r = src.fn(raw); return r.bad ? { valid: false } : { valid: true, text: r.text, n: r.n }; }
    let x = raw[src.m];
    if (typeof x === 'string' && /^\d+$/.test(x)) x = Number(x);
    if (x === undefined || x === null) return { valid: false };
    if (src.e) {
        const t = src.e[x];
        if (t === null || (t === undefined && NO_ENUM.test(String(x)))) return { valid: false };
        return { valid: true, text: t !== undefined ? t : words(x) };
    }
    if (typeof x !== 'number') return { valid: true, text: words(x) };
    if ((src.bad && src.bad.indexOf(x) >= 0) || (src.max !== undefined && x >= src.max)) return { valid: false };
    if (src.raw) return { valid: true, n: x };
    if (src.s16 && x >= 32768) x -= 65536;
    const n = x * (src.k === undefined ? 1 : src.k) + (src.o || 0);
    if (src.lim && (n < src.lim[0] || n > src.lim[1])) return { valid: false };
    return { valid: true, n };
}

/** Every interface and field this app needs: what app.json "signals" must list. */
function fields() {
    const out = {};
    Object.keys(SRC).forEach((id) => {
        const s = SRC[id];
        if (!s.i) return;
        const l = out[s.i] || (out[s.i] = []);
        if (l.indexOf(s.f) < 0) l.push(s.f);
    });
    return out;
}

class Signals {
    constructor(ctx) {
        this.ctx = ctx;
        // A host without a logger (tests, preview harnesses) must not break the data layer.
        this.log = ctx.log || { info() {}, warn() {}, error() {} };
        this.raw = {};                 // "iface.field" -> last struct
        this.at = {};                  // "iface.field" -> when it arrived
        this.subs = [];
        this.flow = new Flow();
        this.accel = new AccelTimer();
        this.available = false;

        const byIface = {};
        this.byField = {};
        Object.keys(SRC).forEach((id) => {
            const s = SRC[id];
            if (!s.i) return;
            const w = byIface[s.i] || (byIface[s.i] = {});
            w[s.f] = (v) => this._put(s.i, s.f, v);
            this.byField[s.i + '.' + s.f] = id;
        });

        if (!ctx.signals || typeof ctx.signals.watch !== 'function') {
            this.log.info('signals: no vehicle bus on this host');
            return;
        }
        Object.keys(byIface).forEach((iface) => {
            const poll = POLL[iface];
            ctx.signals.watch(iface, '1', byIface[iface], this.log, poll ? { pollMs: poll } : undefined)
                .then((sub) => {
                    this.subs.push(sub);
                    if (sub.available) this.available = true;
                    this.log.info('signal ' + iface.split('.').pop() + (sub.error ? ' error: ' + sub.error : ' subscribed'));
                })
                .catch((e) => this.log.warn('signals ' + iface + ': ' + e));
        });
    }

    _put(iface, field, v) {
        const key = iface + '.' + field;
        this.raw[key] = v;
        this.at[key] = Date.now();
        const id = this.byField[key];
        if (id && SRC[id].flow) this.flow.feed(valueOf(SRC[id], v).n, Date.now());
    }

    /** Does the car answer at all: a value arrived, or a provider is available. */
    carPresent() { return Object.keys(this.at).length > 0 || this.subs.some((s) => s.available); }

    /**
     * One widget id -> { n, text, valid, stale, at }.
     * `n` is the number, `text` the enum/word form, `valid` false when the car
     * has not sent a usable value yet.
     */
    read(id) {
        const src = SRC[id];
        if (!src) return { valid: false };
        const now = Date.now();
        if (src.flow) {
            const lph = this.flow.lph(now);
            return lph === null ? { valid: false } : { valid: true, n: lph, at: this.flow.rateT };
        }
        if (src.calc) {
            const r = src.calc((k) => this.read(k));
            return r ? { valid: true, n: r.n, at: now } : { valid: false };
        }
        const key = src.i + '.' + src.f;
        const v = valueOf(src, this.raw[key]);
        if (!v.valid) return { valid: false };
        const at = this.at[key] || 0;
        const out = { valid: true, at, stale: now - at > STALE_MS };
        if (v.n !== undefined) out.n = v.n;
        if (v.text !== undefined) out.text = v.text;
        if (id === 'speed' && v.n !== undefined) this.accel.feed(v.n, now);
        return out;
    }

    /** The 0-100 run: live seconds while it runs, else the best one measured. */
    accel100() {
        const now = Date.now();
        const run = this.accel.running(now);
        return { running: run, best: this.accel.best };
    }

    /** Honest one-line source state for the header. */
    status() {
        if (!this.carPresent()) return { text: 'НЕТ ДАННЫХ', live: false };
        const any = Object.keys(this.at).length > 0;
        return { text: any ? 'С АВТО' : 'ОЖИДАНИЕ', live: any };
    }
}

module.exports = { Signals, SRC, fields, valueOf, selection, Flow, AccelTimer, POLL, STALE_MS };
