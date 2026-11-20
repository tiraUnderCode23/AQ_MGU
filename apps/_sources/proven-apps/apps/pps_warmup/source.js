'use strict';
/**
 * source.js - where Proven Warm-Up's readings come from.
 *
 *   const src = new Source({ settings, signals, log });      // the app's ctx, or the background's
 *   src.wantGearbox = () => true / false                      // may the gearbox unit be asked now?
 *   src.data() -> { rpm, speed, oil, coolant, gearbox, gearboxFrom, demo }     deg C, rpm, km/h
 *
 *   engine oil, coolant, rpm   the car's own signals (CDS), which arrive on their own: nothing is asked
 *   speed                      the car's own signal (Vehicle2)
 *   gearbox oil                gearbox.js, the idrive7-apps kit's reader, unchanged: the gearbox unit
 *                              (read only, 22 6000 as on a ZF 8HP), else the car's own signal once it has
 *                              moved. Setting "Gearbox oil temperature": Auto / Car signal only / Not monitored.
 *
 * Scaling is BMW's own, as in kit/runtime/car.js: rpm x 0.25, speed x 0.015625 km/h, temperatures - 48 deg C
 * (255 = no value).
 *
 * A temperature the car stops giving (it sends 255 in its place) is kept for GONE_MS and then dropped, so a
 * reading that is no longer live is not shown as one: warm.js then waits for it again. A reading whose
 * signal simply stops arriving is kept: the car only sends a value when it changes, so silence is also
 * what a steady temperature looks like.
 *
 * Demo (setting "Demo data": Never, as shipped / Auto until the car answers / Always): a warm-up from cold
 * in 50 s with one burst past the cold rev limit, then half a minute up to temperature, and round again.
 */
const { Gearbox } = require('./gearbox');

const RPM = { factor: 0.25, invalid: 65535 }, SPEED = { factor: 0.015625, invalid: 65535 }, TEMP = { offset: -48, invalid: 255 };
const GONE_MS = 10000;             // "no value" from the car for this long: the last temperature is dropped
const isNum = (x) => typeof x === 'number' && isFinite(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
/** A clock that only moves forward (the head unit sets its wall clock after start-up). */
const mono = () => { const h = process.hrtime(); return h[0] * 1000 + h[1] / 1e6; };

class Demo {
    constructor() { this.t0 = mono(); }
    sample() {
        const t = ((mono() - this.t0) / 1000) % 80;
        const ease = (x, p) => 1 - Math.pow(1 - clamp(x, 0, 1), p);
        const driving = t >= 5;
        return {
            rpm: !driving ? 950 + 15 * Math.sin(t * 5) : 2100 + 700 * Math.sin(t / 3) + (t > 21 && t < 24.5 ? 2500 : 0),
            speed: driving ? 52 + 18 * Math.sin(t / 7) : 0,
            coolant: 22 + 70 * ease(t / 44, 1.6),
            gearbox: 20 + 50 * ease((t - 4) / 56, 1.2),
            oil: 21 + 72 * ease((t - 2) / 58, 1.3),
            gearboxFrom: 'demo', demo: true,
        };
    }
}

class Source {
    constructor(env) {
        const { settings, signals, log } = env;
        this.settings = settings; this.log = log;
        this.live = {}; this.lastCar = 0; this.subs = []; this.t0 = Date.now();
        this.gone = {};                // reading -> when the car first sent "no value" in its place (steady clock)
        this.demo = new Demo();
        this.wantGearbox = () => false;
        const put = (k, v) => { if (isNum(v)) { this.live[k] = v; this.lastCar = Date.now(); delete this.gone[k]; } };
        const lost = (k) => { if (this.gone[k] === undefined) this.gone[k] = mono(); };
        const watch = (iface, handlers) => {
            if (!signals || !signals.watch) return;
            Promise.resolve(signals.watch(iface, '1', handlers, log))
                .then((s) => { if (s) { this.subs.push(s); log.info('signal ' + iface.split('.').pop() + (s.error ? ' error: ' + s.error : ' subscribed')); } })
                .catch((e) => log.warn('signal ' + iface + ': ' + (e && e.message || e)));
        };
        watch('de.bmw.infotainment.vehicle.CDS', {
            statusEngineSpeed2: (v) => { const r = v && v.actualValueRPMEngineCrankshaft; if (isNum(r) && r !== RPM.invalid) put('rpm', r * RPM.factor); },
            statusEngineTemperature: (v) => {
                const c = v && v.temperatureEngineDrive, o = v && v.temperatureEngineOilDrive;
                if (isNum(c)) { if (c !== TEMP.invalid) put('coolant', c + TEMP.offset); else lost('coolant'); }
                if (isNum(o)) { if (o !== TEMP.invalid) put('oil', o + TEMP.offset); else lost('oil'); }
            },
        });
        watch('de.bmw.infotainment.vehicle.Vehicle2', {
            statusCarSpeed2: (v) => { const s = v && v.speedVehicleCentreOfGravity; if (isNum(s) && s !== SPEED.invalid) put('speed', s * SPEED.factor); },
        });
        // the gearbox unit is only asked while wantGearbox() says so, on the car, with the setting on Auto
        this.gearbox = new Gearbox({ signals }, log, () => settings.get('gearboxSource') === 'auto' && !this.usingDemo() && this.wantGearbox()).start();
    }

    /** Has the car answered: a value arrived, or a signal's provider is there. */
    carPresent() { return this.lastCar > 0 || this.subs.some((s) => s.available); }
    usingDemo() {
        const m = this.settings.get('demo');
        return m === 'on' || (m !== 'off' && !this.carPresent() && Date.now() - this.t0 > 5000);
    }

    data() {
        if (this.usingDemo()) {
            const d = this.demo.sample();
            if (this.settings.get('gearboxSource') === 'none') d.gearbox = null;
            return d;
        }
        const none = this.settings.get('gearboxSource') === 'none', live = Object.assign({}, this.live), now = mono();
        // a temperature the car has not given for GONE_MS is no longer a reading
        Object.keys(this.gone).forEach((k) => { if (now - this.gone[k] > GONE_MS) delete live[k]; });
        return Object.assign(live, { gearbox: none ? null : this.gearbox.temp(), gearboxFrom: none ? null : this.gearbox.source(), demo: false });
    }
}

module.exports = { Source, Demo, mono };
