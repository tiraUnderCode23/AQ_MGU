'use strict';
/**
 * track.js - the engine speed between the car's samples.
 *
 * The car sends rpm only 10-20 times a second (every 50-100 ms). Played as it comes, a rev climbs in audible steps
 * and trails the engine. So, as Redline does for its rev bar: between two samples the value moves on along the last
 * climb (or fall), for at most 1.2 sample intervals and 150 ms; a new sample replaces the estimate. After that window
 * without a new sample (the revs settled: the car only sends changes) the estimate eases back to the last reading.
 * The small difference between the estimate and a new reading is blended away over 15 ms.
 * A gap over 300 ms is no climb, nor is a jump faster than `glitch` per second (a glitch or a gear change's step).
 *
 *   const tr = new Track({ glitch: 12000 });
 *   tr.feed(rpm, tMs);       // every reading (repeats of the same value are ignored for 500 ms)
 *   tr.at(tMs)               // the estimate now
 *   tr.stats()               // { interval (ms between samples, averaged), perSecond, samples }
 */
const EASE_MS = 200;       // back to the reading over this long, after the window

class Track {
    constructor(opts) {
        const o = opts || {};
        this.glitch = o.glitch || 12000;          // per second: faster is no climb
        this.minRate = o.minRate || 150;          // per second: slower is not worth predicting
        this.v = null; this.t = 0; this.rate = 0; this.dt = 0; this.n = 0;
    }

    feed(v, t) {
        if (typeof v !== 'number' || !isFinite(v)) return;
        if (this.v !== null && v === this.v && t - this.t < 500) return;      // the same reading again (another signal's tick)
        const dt = t - this.t;
        if (this.v !== null && dt > 15 && dt < 300) {
            const r = (v - this.v) * 1000 / dt;
            // the climb: mostly the newest step, a little of the one before when it went the same way (arrival jitter)
            this.rate = Math.abs(r) > this.glitch ? 0 : (r * this.rate > 0 ? 0.75 * r + 0.25 * this.rate : r);
            this.dt = this.dt ? this.dt * 0.9 + dt * 0.1 : dt;
            this.n++;
        } else this.rate = 0;
        this.v = v; this.t = t;
    }

    at(t) {
        if (this.v === null) return null;
        if (Math.abs(this.rate) < this.minRate) return this.v;
        const win = Math.min(this.dt ? this.dt * 1.2 : 100, 150), age = Math.max(0, t - this.t);
        let ahead = this.rate * Math.min(age, win) / 1000;
        if (age > win) ahead *= Math.max(0, 1 - (age - win) / EASE_MS);
        return Math.max(0, this.v + ahead);
    }

    stats() { return { interval: this.dt, perSecond: this.dt ? 1000 / this.dt : 0, samples: this.n }; }
}

module.exports = { Track };
