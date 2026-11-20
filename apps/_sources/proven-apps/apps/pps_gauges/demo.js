'use strict';
/**
 * demo.js - a synthetic drive for demo mode (showroom, bench unit, PC preview): a 26 s loop of a
 * pull through the gears, a lift, a hard stop and a few corners, with the engine warming up from
 * cold over about four minutes. Values are in the app's internal units (rpm, km/h, bar, deg C, g, Nm).
 * Same idea as the demo of M Vitals in the idrive7-apps kit.
 */
class Demo {
    constructor() { this.t0 = Date.now(); this.red = 7000; }
    /** The redline the pulls rev to. */
    setRedline(rpm) { this.red = rpm; }
    sample() {
        const t = (Date.now() - this.t0) / 1000;
        const cyc = t % 26;
        // throttle: a 10 s pull, 3 s lift / brake, then part throttle through corners
        const pull = cyc < 10 ? Math.min(1, 0.25 + cyc / 8) : cyc < 13 ? Math.max(0, 1 - (cyc - 10) / 1.2) : 0.28 + 0.14 * Math.sin(cyc * 1.3);
        const gear = cyc < 10 ? Math.min(5, 2 + Math.floor(cyc / 2.6)) : cyc < 13 ? 4 : 3;
        const inGear = cyc < 10 ? (cyc % 2.6) / 2.6 : 0.45 + 0.1 * Math.sin(cyc);
        const rpm = cyc < 10 ? 3300 + inGear * (this.red - 3250) : cyc < 13 ? 4200 - (cyc - 10) * 700 : 2600 + 900 * inGear;
        const speed = cyc < 10 ? 38 + cyc * 15.5 : cyc < 13 ? Math.max(62, 193 - (cyc - 10) * 46) : 62 + 14 * Math.sin((cyc - 13) / 2);
        const corner = cyc > 13 ? Math.sin((cyc - 13) / 13 * Math.PI * 4) : 0.06 * Math.sin(t / 2);
        const warm = Math.min(1, t / 240);
        const spool = Math.min(1, Math.max(0, (rpm - 1800) / 1500));
        const target = Math.max(0, pull > 0.5 ? 1.52 * spool : 0.12 * pull);
        const boost = Math.max(0, target - 0.07 + 0.045 * Math.sin(t * 5) - (cyc < 1 ? 0.5 * (1 - cyc) : 0));
        const torque = Math.round(60 + pull * spool * 560);
        return {
            rpm, speed, gear, gearMode: pull > 0.9 ? 'S' : 'D', stage: 'D',
            boost, boostTarget: target, boostActual: boost,
            torque, powerCalc: torque * rpm / 9549, powerPct: Math.min(100, Math.round(torque * rpm / 9549 / 285 * 100)),
            coolant: 34 + 58 * warm + 2 * Math.sin(t / 40), oil: 26 + 78 * warm + 6 * pull,
            gearbox: 30 + 52 * warm + 3 * pull, egs: 32 + 50 * warm + 4 * pull, ambient: 27.5 + 0.5 * Math.sin(t / 90),
            iat: 31 + 9 * warm + 13 * pull * spool, hpfp: 60 + 270 * pull * spool + 8 * Math.sin(t), lpfp: 5.5 - 0.8 * pull + 0.05 * Math.sin(t * 2),
            timing: 4 + 20 * (1 - pull * spool) + Math.sin(t * 2),
            gLat: corner * 1.02, gLong: cyc < 10 ? 0.5 * pull * (1 - cyc / 16) : cyc < 13 ? -1.02 * Math.min(1, (cyc - 10) * 2.5) * (cyc < 12.4 ? 1 : 0.3) : 0.05 * Math.sin(t),
            tFL: 34 + 34 * warm + 7 * Math.abs(corner), tFR: 35 + 34 * warm + 5 * Math.abs(corner),
            tRL: 36 + 38 * warm + 8 * pull, tRR: 36 + 39 * warm + 8 * pull,
            pFL: 2.30 + 0.26 * warm, pFR: 2.31 + 0.25 * warm, pRL: 2.42 + 0.31 * warm, pRR: 2.40 + 0.3 * warm,
            ptFL: 2.4, ptFR: 2.4, ptRL: 2.6, ptRR: 2.6,
        };
    }
}
module.exports = Demo;
