'use strict';
/*
 * Light Logger: what happened, in order. Pure (the clock is passed in), tested on a desktop by tools/test_lightlog.js.
 *
 *   const j = new Journal({ now: Date.now });
 *   j.lights(bus, modules | null)   a read of one LIN bus (lin.parseStatus), or null when the BDC didn't answer:
 *                                   each module that appears, goes, switches on or off, or changes brightness or
 *                                   colour becomes an event
 *   j.rpm(raw) / j.speed(raw)       CDS.statusEngineSpeed2 / Vehicle2.statusCarSpeed2: engine started or stopped,
 *                                   car moving or standing
 *   j.mark()                        the driver's own mark ("the logo just went off")
 *   j.events                        newest last: [{ t, kind, text, seat, key }]   j.on('event', fn)
 *   j.modules()                     every module of the latest reads, by bus and place
 *   j.relevant()                    only the modules that may be the seat logos, each with why:
 *                                     'pinned'    the driver said so (togglePin(key), kept by the app)
 *                                     'seat'      a seat location of the BDC_G05 table
 *                                     'mark'      it switched on or off, or changed, from MARK_BEFORE before a mark
 *                                                 to MARK_AFTER after it (the reads lag the light by a few seconds)
 *                                     'unknown'   a location code the table doesn't know (the G87's may be one)
 *   j.isRelevant(event)             the car, the marks, the link, and these modules' events; not other lights'
 *
 * Kinds: light, seat (a light in or on a seat), car, mark, link. key: a module's 'bus:location' (light events).
 */
const EventEmitter = require('events');
const lin = require('./lin.js');

/* the sources a read comes from: lin.js's two buses, the BDC's lamp outputs (lamps.js), the finder's pinned values */
const SOURCES = ['LIN 1', 'LIN 2', 'BDC lamp outputs', 'Pinned values'];

const MAX = 400;
const MARK_BEFORE = 25000, MARK_AFTER = 15000;
const ORDER = ['pinned', 'seat', 'mark', 'unknown'];
const BRIGHT_STEP = 5;          // % of brightness that counts as a change
const COLOUR_STEP = 8;          // of 255 in any channel
const RPM = { factor: 0.25, invalid: 65535, on: 400, off: 50 };
const SPEED = { factor: 0.015625, invalid: 65535, moving: 3, standing: 0.5 };

const pad = (n) => (n < 10 ? '0' : '') + n;
function clock(t) { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

function scaled(raw, c) { return typeof raw === 'number' && isFinite(raw) && raw !== c.invalid ? raw * c.factor : null; }

class Journal extends EventEmitter {
    constructor(o) {
        super();
        this.now = (o && o.now) || Date.now;
        this.events = [];
        this._buses = SOURCES.map(() => null);    // per source: Map(nad -> module), null before its first answer
        this._silent = SOURCES.map(() => 0);      // reads without an answer in a row
        this.engine = null;                 // true running / false off / null unknown
        this.moving = null;
        this.rpmValue = null; this.kmh = null;
        this.marks = 0;
        this._markTimes = [];
        this._changes = [];                 // [{ t, key }]: a module switched, dimmed, recoloured, came or went
        this.pins = new Set();
    }

    _add(kind, text, seat, key) {
        const e = { t: this.now(), kind: kind, text: text, seat: !!seat, key: key || null };
        this.events.push(e);
        if (this.events.length > MAX) this.events.splice(0, this.events.length - MAX);
        this.emit('event', e);
        return e;
    }

    lights(bus, modules) {
        const name = SOURCES[bus];
        if (!modules) {
            this._silent[bus]++;
            if (this._silent[bus] === 3) this._add('link', name + ': the body controller stopped answering');
            return;
        }
        if (this._silent[bus] >= 3) this._add('link', name + ': the body controller answers again');
        this._silent[bus] = 0;
        const before = this._buses[bus];
        const now = new Map();
        modules.forEach((m) => now.set(m.key || m.nad, m));
        this._buses[bus] = now;
        if (!before) {
            this._add('link', name + ': ' + modules.length + (bus < 2 ? ' light modules, ' : bus === 2 ? ' outputs, ' : ' values, ') + modules.filter((m) => m.on).length + ' on');
            modules.forEach((m) => this._add(m.seat ? 'seat' : 'light', 'found ' + lin.describe(m), m.seat, keyOf(m)));
            return;
        }
        const changed = (m, text) => {
            this._changes.push({ t: this.now(), key: keyOf(m) });
            if (this._changes.length > MAX) this._changes.shift();
            this._add(m.seat ? 'seat' : 'light', text, m.seat, keyOf(m));
        };
        now.forEach((m, nad) => {
            const old = before.get(nad);
            if (!old || old.loc !== m.loc) { changed(m, 'new ' + lin.describe(m)); return; }
            const what = change(old, m);
            if (what) changed(m, what + ': ' + lin.describe(m));
        });
        before.forEach((m, nad) => {
            if (!now.has(nad)) changed(m, 'gone ' + m.name + (bus < 2 ? ' (' + name + ' #' + nad + ')' : ''));
        });
    }

    rpm(v) {
        const r = scaled(v && v.actualValueRPMEngineCrankshaft, RPM);
        if (r === null) return;
        this.rpmValue = r;
        if (r >= RPM.on && this.engine !== true) { this.engine = true; this._add('car', 'engine running (' + Math.round(r) + ' rpm)'); }
        else if (r <= RPM.off && this.engine !== false) { this.engine = false; this._add('car', 'engine off'); }
    }

    speed(v) {
        const k = scaled(v && v.speedVehicleCentreOfGravity, SPEED);
        if (k === null) return;
        this.kmh = k;
        if (k >= SPEED.moving && this.moving !== true) { this.moving = true; this._add('car', 'moving (' + Math.round(k) + ' km/h)'); }
        else if (k <= SPEED.standing && this.moving !== false) { this.moving = false; this._add('car', 'standing still'); }
    }

    mark() {
        this.marks++;
        this._markTimes.push(this.now());
        return this._add('mark', 'MARK ' + this.marks + ' (pressed on the screen)');
    }

    note(text) { return this._add('link', text); }

    clear() { this.events = []; this.marks = 0; this._markTimes = []; this._changes = []; }

    modules() {
        const out = [];
        this._buses.forEach((m) => { if (m) m.forEach((x) => out.push(Object.assign({ key: keyOf(x) }, x))); });
        return out;
    }

    /* why a module may be a seat logo: a list of ORDER's reasons, empty when it isn't one */
    reasons(m) {
        const key = keyOf(m), out = [];
        if (this.pins.has(key)) out.push('pinned');
        if (m.seat) out.push('seat');
        if (this._changes.some((c) => c.key === key && this._markTimes.some((t) => c.t >= t - MARK_BEFORE && c.t <= t + MARK_AFTER))) out.push('mark');
        if (!m.known && !m.lamp && !m.did) out.push('unknown');
        return out;
    }

    /* the modules that may be the seat logos, the likeliest first: [module + { reasons }] */
    relevant() {
        const rank = (r) => ORDER.indexOf(r[0]);
        return this.modules().map((m) => Object.assign(m, { reasons: this.reasons(m) }))
            .filter((m) => m.reasons.length)
            .sort((a, b) => (rank(a.reasons) - rank(b.reasons)) || (a.bus - b.bus) || (a.nad - b.nad));
    }

    isRelevant(e) {
        if (!e.key) return true;
        if (e.seat) return true;
        return this.relevant().some((m) => m.key === e.key);
    }

    togglePin(key) {
        if (this.pins.has(key)) this.pins.delete(key); else this.pins.add(key);
        const m = this.modules().find((x) => x.key === key);
        const what = m ? m.name + (m.bus < 2 ? ' (' + SOURCES[m.bus] + ', 0x' + lin.hex(m.loc) + ')' : '') : key;
        this._add('link', (this.pins.has(key) ? 'pinned ' : 'unpinned ') + what + ' as a seat logo', false, key);
        this.emit('pins', Array.from(this.pins));
        return this.pins.has(key);
    }

    setPins(keys) { this.pins = new Set((keys || []).filter((k) => PIN.test(k))); }

    /* the finder's values pinned: 'd:<ecu>:<did>' keys */
    pinnedValues() { return Array.from(this.pins).filter((k) => /^d:/.test(k)); }

    answered(bus) { return !!this._buses[bus]; }
}

/* a module's key: its bus and location code ('0:27'), the same across reads and starts */
function keyOf(m) { return m.key || m.bus + ':' + m.loc; }
const PIN = /^([0-2]:\d+|d:[0-9A-F]{2}:[0-9A-F]{4})$/;

/* what changed between two reads of one module, or '' */
function change(a, b) {
    if (a.on !== b.on) return b.on ? 'ON' : 'OFF';
    if ((a.lamp || a.did) && a.raw !== b.raw) return 'value ' + a.raw + ' -> ' + b.raw;
    if (a.fault !== b.fault) return b.fault ? 'fault' : 'fault cleared';
    if (Math.abs(a.bright - b.bright) >= BRIGHT_STEP) return 'brightness ' + a.bright + '% -> ' + b.bright + '%';
    if (b.on && (Math.abs(a.r - b.r) >= COLOUR_STEP || Math.abs(a.g - b.g) >= COLOUR_STEP || Math.abs(a.b - b.b) >= COLOUR_STEP ||
        Math.abs(a.white - b.white) >= COLOUR_STEP)) return 'colour';
    return '';
}

/* one event as a line: "14:02:31  SEAT  OFF: Driver seat back (...)" */
function line(e) {
    const tag = { light: 'light', seat: 'SEAT ', car: 'car  ', mark: 'MARK ', link: 'link ' }[e.kind] || e.kind;
    return clock(e.t) + '  ' + tag + '  ' + e.text;
}

module.exports = { Journal, SOURCES, change, line, clock, keyOf, RPM, SPEED, MARK_BEFORE, MARK_AFTER };
