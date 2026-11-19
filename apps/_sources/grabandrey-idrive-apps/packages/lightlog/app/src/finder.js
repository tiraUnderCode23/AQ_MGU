'use strict';
/*
 * Light Logger: finds the value that follows the seat logos, when they aren't among the lights the app knows
 * (lin.js, lamps.js). Read only: nothing but ReadDataByIdentifier, through uds.js.
 *
 *   1. units()     which units answer: the body controller (0x40) and the seat modules (0x6D, 0x6E, 0x6F)
 *   2. learn()     every identifier those units answer in RANGES, eight a request (an ECU leaves out the ones it
 *                  doesn't have), then the ones of a request that answered one by one: each one's length.
 *                  ~1500 requests a unit, a few minutes; kept (store) and resumed where it stopped.
 *   3. snapshot('on' | 'off')   reads every learned value (eight a request, cut by their known lengths), with the
 *                  logos ON, then OFF; as many of each as you like
 *   4. candidates() the values the same in every ON snapshot, the same in every OFF one, and different between the
 *                  two. Engine start changes plenty (voltages, counters); taking two of each removes what moves
 *                  anyway.
 *
 *   const f = new Finder({ uds, log, store: { load() -> obj | null, save(obj) } });
 *   f.state -> { phase, units, learn: { unit, done, total }, counts: { on, off }, error }     f.on('change', fn)
 */
const EventEmitter = require('events');
const { hex, unitName } = require('./lamps.js');

const UNITS = [0x40, 0x6d, 0x6e, 0x6f];
const RANGES = [[0x4000, 0x4fff], [0xd000, 0xefff]];
const BATCH = 8;
const BIG = 120;                    // values longer than this are read alone
const KEEP = 4;                     // snapshots of each kind kept
const PROBE = [0xf1, 0x50];         // the unit's identification (SGBD index): any answer, even a refusal, means it's there

const keyOf = (ecu, did) => 'd:' + hex(ecu) + ':' + hex(did, 4);
const total = () => RANGES.reduce((a, r) => a + r[1] - r[0] + 1, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Finder extends EventEmitter {
    constructor(o) {
        super();
        this.uds = o.uds; this.log = o.log; this.store = o.store || null; this.now = o.now || Date.now;
        this.gapMs = o.gapMs === undefined ? 20 : o.gapMs;
        this.units = null;                  // [addr] that answered, null before units()
        this.known = {};                    // 'ecu' -> { dids: { did: length }, next: index into the ranges, done }
        this.snaps = { on: [], off: [] };   // [{ t, values: { key: hex } }]
        this.phase = 'idle';                // idle | units | learning | snapshot
        this.progress = null;               // { unit, done, total }
        this.error = null;
        this._stop = false;
        const saved = this.store && this.store.load();
        if (saved && saved.version === 1) {
            this.units = saved.units || null; this.known = saved.known || {}; this.snaps = saved.snaps || this.snaps;
        }
    }

    _save() { if (this.store) this.store.save({ version: 1, units: this.units, known: this.known, snaps: this.snaps }); }
    _changed() { this.emit('change'); }

    get state() {
        const learned = (this.units || []).map((u) => {
            const k = this.known[u] || { dids: {}, next: 0, done: false };
            return { unit: u, name: unitName(u), values: Object.keys(k.dids).length, done: !!k.done, next: k.next || 0 };
        });
        return {
            phase: this.phase, units: learned, unitsKnown: !!this.units, progress: this.progress, total: total(),
            learnedAll: !!this.units && this.units.length > 0 && learned.every((x) => x.done),
            counts: { on: this.snaps.on.length, off: this.snaps.off.length }, error: this.error,
        };
    }

    stop() { this._stop = true; }

    /* which units answer */
    findUnits() {
        this.phase = 'units'; this.error = null; this._changed();
        const found = [];
        return UNITS.reduce((p, u) => p.then(() => this.uds.read(u, PROBE, 4000)
            .then((r) => { if (r) found.push(u); }, () => null)), Promise.resolve())
            .then(() => {
                this.units = found;
                this.log.info('finder: units ' + found.map((u) => hex(u)).join(', '));
                this.phase = 'idle'; this._save(); this._changed();
                return found;
            });
    }

    /* learn every unit's identifiers, from where it stopped */
    learn() {
        if (this.phase !== 'idle') return Promise.resolve();
        this._stop = false;
        const go = this.units ? Promise.resolve(this.units) : this.findUnits();
        return go.then((units) => units.reduce((p, u) => p.then(() => this._learnUnit(u)), Promise.resolve()))
            .catch((e) => { this.error = (e && e.message) || String(e); this.log.warn('finder: ' + this.error); })
            .then(() => { this.phase = 'idle'; this.progress = null; this._save(); this._changed(); });
    }

    _learnUnit(u) {
        const k = this.known[u] || (this.known[u] = { dids: {}, next: 0, done: false });
        if (k.done) return Promise.resolve();
        this.phase = 'learning';
        const all = [];
        RANGES.forEach((r) => { for (let d = r[0]; d <= r[1]; d++) all.push(d); });
        const step = () => {
            if (this._stop) return Promise.resolve();
            if (k.next >= all.length) { k.done = true; this.log.info('finder: ' + unitName(u) + ' has ' + Object.keys(k.dids).length + ' values'); return Promise.resolve(); }
            const batch = all.slice(k.next, k.next + BATCH);
            this.progress = { unit: u, name: unitName(u), done: k.next, total: all.length };
            return this.uds.read(u, flat(batch), 6000).then((r) => {
                if (r && r[0] === 0x62) return batch.reduce((p, d) => p.then(() => this._learnOne(u, d)), Promise.resolve());
                return undefined;
            }, () => null).then(() => {
                k.next += batch.length;
                if (k.next % (BATCH * 32) === 0) { this._save(); this._changed(); }
                return sleep(this.gapMs).then(step);
            });
        };
        this._changed();
        return step();
    }

    _learnOne(u, d) {
        return this.uds.read(u, [d >> 8, d & 255], 6000).then((r) => {
            if (r && r[0] === 0x62 && r[1] === d >> 8 && r[2] === (d & 255)) this.known[u].dids[d] = r.length - 3;
        }, () => null);
    }

    /* read every learned value now: 'on' (the logos lit) or 'off' */
    snapshot(kind) {
        if (this.phase !== 'idle' || (kind !== 'on' && kind !== 'off')) return Promise.resolve(null);
        this.phase = 'snapshot'; this.error = null;
        const values = {};
        const units = Object.keys(this.known).map(Number);
        const work = [];
        units.forEach((u) => {
            const dids = Object.keys(this.known[u].dids).map(Number).sort((a, b) => a - b);
            let batch = [], size = 0;
            dids.forEach((d) => {
                const len = this.known[u].dids[d];
                if (len > BIG) { work.push([u, [d]]); return; }
                if (batch.length === BATCH || size + len > 400) { work.push([u, batch]); batch = []; size = 0; }
                batch.push(d); size += 2 + len;
            });
            if (batch.length) work.push([u, batch]);
        });
        let done = 0;
        this.progress = { snapshot: kind, done: 0, total: work.length };
        this._changed();
        return work.reduce((p, w) => p.then(() => this._readBatch(w[0], w[1], values)).then(() => {
            done++; this.progress = { snapshot: kind, done: done, total: work.length };
            if (done % 10 === 0) this._changed();
        }), Promise.resolve()).then(() => {
            const snap = { t: this.now(), values: values };
            this.snaps[kind].push(snap);
            if (this.snaps[kind].length > KEEP) this.snaps[kind].shift();
            this.phase = 'idle'; this.progress = null; this._save(); this._changed();
            this.log.info('finder: ' + kind + ' snapshot, ' + Object.keys(values).length + ' values');
            return snap;
        });
    }

    /* one request for several values, cut by their lengths; one by one when that doesn't add up */
    _readBatch(u, dids, values) {
        const lens = this.known[u].dids;
        return this.uds.read(u, flat(dids), 6000).then((r) => {
            if (!r || r[0] !== 0x62) return undefined;
            const got = {};
            let i = 1;
            while (i < r.length) {
                const d = (r[i] << 8) | r[i + 1];
                const len = lens[d];
                if (dids.indexOf(d) < 0 || len === undefined || i + 2 + len > r.length) return this._oneByOne(u, dids, values);
                got[d] = r.slice(i + 2, i + 2 + len);
                i += 2 + len;
            }
            Object.keys(got).forEach((d) => { values[keyOf(u, Number(d))] = got[d].map((x) => hex(x)).join(''); });
            return undefined;
        }, () => null);
    }

    _oneByOne(u, dids, values) {
        return dids.reduce((p, d) => p.then(() => this.uds.read(u, [d >> 8, d & 255], 6000).then((r) => {
            if (r && r[0] === 0x62) values[keyOf(u, d)] = r.slice(3).map((x) => hex(x)).join('');
        }, () => null)), Promise.resolve());
    }

    /* the values that follow the logos: [{ key, unit, did, on, off, bytes (how many bytes differ) }], fewest bytes first */
    candidates() {
        const on = this.snaps.on, off = this.snaps.off;
        if (!on.length || !off.length) return [];
        const out = [];
        Object.keys(on[0].values).forEach((key) => {
            const a = on.map((s) => s.values[key]), b = off.map((s) => s.values[key]);
            if (a.concat(b).some((v) => v === undefined)) return;
            if (a.some((v) => v !== a[0]) || b.some((v) => v !== b[0]) || a[0] === b[0]) return;
            const m = /^d:([0-9A-F]{2}):([0-9A-F]{4})$/.exec(key);
            let diff = 0;
            for (let i = 0; i < Math.max(a[0].length, b[0].length); i += 2) if (a[0].substr(i, 2) !== b[0].substr(i, 2)) diff++;
            out.push({ key: key, unit: parseInt(m[1], 16), did: parseInt(m[2], 16), on: a[0], off: b[0], bytes: diff });
        });
        return out.sort((x, y) => (y.unit !== 0x40) - (x.unit !== 0x40) || x.bytes - y.bytes || x.on.length - y.on.length);
    }

    clearSnapshots() { this.snaps = { on: [], off: [] }; this._save(); this._changed(); }
}

function flat(dids) { const o = []; dids.forEach((d) => { o.push(d >> 8, d & 255); }); return o; }

module.exports = { Finder, UNITS, RANGES, BATCH, keyOf, flat };
