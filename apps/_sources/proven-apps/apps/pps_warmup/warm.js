'use strict';
/**
 * warm.js - the warm-up decision: are engine oil, gearbox oil and coolant in their safe range?
 *
 * No drawing, no car access: it is fed temperatures and answers with states, so it can be tested on a PC
 * (tools/test_warmup.js).
 *
 *   const warm = new WarmUp(() => limits);            // limits: see limitsFrom()
 *   warm.feed({ rpm, speed, oil, gearbox, coolant }, nowMs)    // about once a second, on a steady clock
 *   warm.status(nowMs) -> {
 *     overall     'nodata' | 'off' | 'warming' | 'ready' | 'hot'
 *     fluids      { oil, gearbox, coolant }: { state, temp, ready, hot, min, est, progress, counted }
 *                 state: 'ready' | 'warming' | 'stalled' | 'off' (engine not running) | 'hot'
 *                        | 'none' (no reading) | 'unused' (switched off for this car)
 *     waiting     the fluids not ready yet: below their safe temperature, or with no reading, e.g. ['oil', 'gearbox']
 *     min         minutes until all are ready (the slowest one), or null
 *     over        the engine is being revved past the cold limit right now
 *     limit       the rev limit until warm (0 = none)
 *     readyAt     when everything first came into range on this warm-up (ms), else null
 *     unwatched   the gearbox, when it counts for nothing because the car gives no reading for it
 *   }
 *   warm.announce() -> true once, when everything has just come into range after a warm-up that was watched
 *
 * Rules
 *   - A fluid is READY from its "safe from" temperature and stays ready until it falls HYST below it
 *     (no flicker at the threshold). From its "too hot above" temperature it is HOT, and stays hot until
 *     it falls HYST below that, for the same reason.
 *   - Engine oil and coolant must each have a reading and be ready before the car is called ready: without
 *     one of them the car is never called ready. Only the gearbox may be left out: with no reading for
 *     NO_DATA_MS of engine running it is left out and named (a manual gearbox has no oil sensor), but only
 *     if it never gave a reading or its last reading was in range (ready and not too hot). A gearbox last
 *     read below its "safe from", or too hot, is never left out: it is waited for until a reading returns.
 *   - The announcement is made once per warm-up, and only when this app read a fluid below its "safe from"
 *     first: a hot restart shows READY straight away without it. It is withdrawn if the car stops being
 *     ready before it has been shown.
 *   - "ready in" comes from the measured warming rate, blended with a typical rate until two minutes
 *     have been measured (as the idrive7-apps kit's Warm-Up app does it).
 */
const FLUIDS = ['oil', 'gearbox', 'coolant'];
const HYST = 3;                    // deg C under the threshold before "ready" is taken back
const NO_DATA_MS = 90000;          // engine running this long with no gearbox reading: the gearbox is left out
const RUNNING_RPM = 400;
const OVER_HOLD_MS = 2500;         // an over-rev stays shown this long
const HIST_MS = 2000, HIST_KEEP = 120;     // a sample every 2 s, 4 minutes
// typical warming rates (deg C / min) until enough has been measured
const TYPICAL = { oil: { drive: 4, idle: 1.5 }, coolant: { drive: 7, idle: 3 }, gearbox: { drive: 3, idle: 0.8 } };

const isNum = (x) => typeof x === 'number' && isFinite(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/**
 * The workshop's numbers from the app's settings: { oil: { ready, hot, use }, gearbox, coolant, revLimit }.
 * A "too hot" at or under "safe from" (a slip while programming) is moved to 10 deg C above it.
 */
function limitsFrom(get) {
    const one = (ready, hot, use) => ({ ready, hot: hot > ready ? hot : ready + 10, use: use !== false });
    return {
        oil: one(get('readyOil'), get('hotOil')),
        gearbox: one(get('readyGearbox'), get('hotGearbox'), get('gearboxSource') !== 'none'),
        coolant: one(get('readyCoolant'), get('hotCoolant')),
        revLimit: get('coldLimit') || 0,
    };
}

class WarmUp {
    constructor(limits) {
        this.limits = limits;
        this.latched = {};             // fluid -> ready (with hysteresis)
        this.hotLatched = {};          // fluid -> too hot (with hysteresis)
        this.last = {};                // the latest feed
        this.hist = [];                // [t, oil, gearbox, coolant]
        this.histT = null;
        this.runSince = null;          // the engine has been running since (ms), null = not running
        this.seenAt = {};              // fluid -> last time it had a reading
        this.sawCold = false;          // this warm-up was watched from below temperature
        this.readyAt = null;           // when everything first came into range on this warm-up
        this.toAnnounce = false;
        this.overAt = null;            // the last moment the engine was over the cold rev limit
    }

    feed(d, now) {
        this.last = d = Object.assign({}, d);
        const lim = this.limits();
        const running = isNum(d.rpm) && d.rpm >= RUNNING_RPM;
        if (running) { if (this.runSince === null) this.runSince = now; } else this.runSince = null;
        FLUIDS.forEach((k) => {
            const v = d[k], L = lim[k];
            if (!isNum(v)) return;
            this.seenAt[k] = now;
            if (v >= L.ready) this.latched[k] = true;
            else if (v < L.ready - HYST) this.latched[k] = false;
            if (v >= L.hot) this.hotLatched[k] = true;
            else if (v < L.hot - HYST) this.hotLatched[k] = false;
        });
        if ((this.histT === null || now - this.histT >= HIST_MS) && FLUIDS.some((k) => isNum(d[k]))) {
            this.histT = now;
            this.hist.push([now, d.oil, d.gearbox, d.coolant]);
            while (this.hist.length > HIST_KEEP) this.hist.shift();
        }
        const st = this._status(now, lim);
        // over-rev on a cold engine
        if (st.overall === 'warming' && lim.revLimit > 0 && isNum(d.rpm) && d.rpm > lim.revLimit) this.overAt = now;
        // the announcement: armed by a watched warm-up, fired once when everything is in range.
        // Armed only by a fluid that was read below its "safe from": one that merely has no reading yet does not count
        // (a gearbox answer that arrives late on a hot restart, or drops out for a moment once warm).
        if (st.overall === 'warming' || st.overall === 'off') { if (st.waiting.some((k) => st.fluids[k].temp !== null)) this.sawCold = true; this.readyAt = null; }
        // not shown yet and no longer true (too hot, cooled, a reading lost): withdrawn, never shown late
        if (st.overall !== 'ready') this.toAnnounce = false;
        if (st.overall === 'ready' && this.readyAt === null) {
            this.readyAt = now;
            if (this.sawCold) this.toAnnounce = true;
            this.sawCold = false;
        }
        return st;
    }

    status(now) {
        const st = this._status(now, this.limits());
        st.over = this.overAt !== null && now - this.overAt < OVER_HOLD_MS && st.overall === 'warming';
        st.readyAt = this.readyAt;
        return st;
    }

    /** true once, when the car has just come up to temperature. */
    announce() { const a = this.toAnnounce; this.toAnnounce = false; return a; }

    /** Forget the history (the data source switched between the car and the demo drive). */
    reset() {
        this.latched = {}; this.hotLatched = {}; this.hist = []; this.histT = null; this.runSince = null; this.seenAt = {};
        this.sawCold = false; this.readyAt = null; this.toAnnounce = false; this.overAt = null; this.last = {};
    }

    /** deg C per minute over the last 3 minutes (least squares) and the time it covers. */
    _rate(idx) {
        const h = this.hist, last = h.length ? h[h.length - 1][0] : 0;
        const pts = h.filter((p) => isNum(p[idx]) && last - p[0] < 180000);
        if (pts.length < 4) return { rate: null, span: 0 };
        const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[idx], 0) / n;
        let num = 0, den = 0;
        pts.forEach((p) => { num += (p[0] - mx) * (p[idx] - my); den += (p[0] - mx) * (p[0] - mx); });
        return { rate: den ? num / den * 60000 : null, span: pts[n - 1][0] - pts[0][0] };
    }

    _status(now, lim) {
        const d = this.last, running = isNum(d.rpm) && d.rpm >= RUNNING_RPM, engineOff = isNum(d.rpm) && d.rpm < RUNNING_RPM;
        const fluids = {}, waiting = [], unwatched = [];
        let anyHot = false, slowest = null;
        FLUIDS.forEach((k, i) => {
            const L = lim[k], v = d[k], f = fluids[k] = { temp: isNum(v) ? v : null, ready: L.ready, hot: L.hot, counted: false, min: null, est: false, progress: 0 };
            if (!L.use) { f.state = 'unused'; return; }
            if (!isNum(v)) {
                f.state = 'none';
                // the gearbox with no reading for a while with the engine running: this car gives none (a manual gearbox
                // has no oil sensor), so it is left out and named; until then it is waited for like the others.
                // Not if it was last read below its "safe from" or too hot: then it is known not to be in range
                // and is waited for.
                // Engine oil and coolant are never left out: without a reading the car is not called ready.
                const since = this.runSince === null ? null : Math.max(this.runSince, this.seenAt[k] === undefined ? this.runSince : this.seenAt[k]);
                if (k === 'gearbox' && (this.seenAt[k] === undefined || (this.latched[k] && !this.hotLatched[k])) && since !== null && now - since > NO_DATA_MS) unwatched.push(k);
                else { f.counted = true; waiting.push(k); }
                return;
            }
            f.counted = true;
            // from the first temperature this drive's history holds to "safe from"
            const first = this.hist.map((p) => p[i + 1]).find(isNum), from = Math.min(isNum(first) ? first : v, L.ready - 20);
            f.progress = clamp((v - from) / (L.ready - from), 0, 1);
            if (v >= L.hot || (this.hotLatched[k] && v >= L.hot - HYST)) { f.state = 'hot'; anyHot = true; return; }
            if (this.latched[k]) { f.state = 'ready'; f.progress = 1; return; }
            waiting.push(k);
            if (engineOff) { f.state = 'off'; return; }
            const m = this._rate(i + 1), typ = TYPICAL[k][isNum(d.speed) && d.speed > 10 ? 'drive' : 'idle'];
            const w = clamp(m.span / 120000, 0, 1), rate = isNum(m.rate) ? w * m.rate + (1 - w) * typ : typ;
            if (w > 0.8 && rate < 0.15) { f.state = 'stalled'; return; }
            f.state = 'warming'; f.min = (L.ready - v) / Math.max(0.15, rate); f.est = w < 0.5;
            if (slowest === null || f.min > slowest) slowest = f.min;
        });
        const haveData = FLUIDS.some((k) => fluids[k].temp !== null);
        let overall;
        if (!haveData) overall = 'nodata';
        else if (anyHot) overall = 'hot';
        else if (!waiting.length) overall = 'ready';
        else if (engineOff) overall = 'off';
        else overall = 'warming';
        const allTimed = waiting.every((k) => fluids[k].state === 'warming');
        return { overall, fluids, waiting, unwatched, min: overall === 'warming' && allTimed ? slowest : null, limit: lim.revLimit, running, over: false, readyAt: null };
    }
}

module.exports = { WarmUp, limitsFrom, FLUIDS, HYST, NO_DATA_MS };
