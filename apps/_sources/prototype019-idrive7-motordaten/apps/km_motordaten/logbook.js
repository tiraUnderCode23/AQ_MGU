'use strict';
/**
 * The logbook: recordings of the values, one CSV file each in the app's
 * data folder (data/logs/<yyyymmdd-hhmmss>.csv, the car's wall-clock start; the folder KM_DATA_DIR
 * names in the tests).
 *
 *   header  t,rpm,torque,power,boost,boostTarget,oilPress,oil,coolant,intake,charge,gearbox,exhaust,voltage
 *   rows    milliseconds since the start, then the values ('' for none)
 *
 * A recording takes a sample at most every SAMPLE_MS, is written out every
 * FLUSH_MS, and stops by itself after MAX_MS. Only the newest KEEP
 * recordings stay. summary() reads a file back for the list (duration and
 * peaks), load() for the curves (at most POINTS samples per channel).
 */
const fs = require('fs');
const path = require('path');
const clock = require('./clock.js');

const FIELDS = Object.freeze(['rpm', 'torque', 'power', 'boost', 'boostTarget', 'oilPress', 'oil', 'coolant', 'intake',
    'charge', 'gearbox', 'exhaust', 'voltage',
    // what the engine does (only recorded, not shown live)
    'lambda', 'lambdaTarget', 'rail', 'railTarget', 'fuelLow', 'knock', 'ignition', 'pedal', 'load', 'airMass',
    'throttle', 'fuelFlow', 'fuelTemp', 'knockCyl1', 'knockCyl2', 'knockCyl3', 'knockCyl4', 'knockCyl5', 'knockCyl6', 'battSoc', 'battCurrent', 'battVoltage',
    'coolTarget', 'fanDuty', 'fanRpm', 'thermostat', 'pumpTarget', 'pumpRpm', 'pumpCharge', 'pumpPct', 'fanSet', 'fan', 'pumpChargePct']);
const SAMPLE_MS = 100;
const FLUSH_MS = 1000;
const MAX_MS = 30 * 60 * 1000;
const KEEP = 20;
const POINTS = 900;
const SPARK = 60;

function dir() {
    return path.join(process.env.KM_DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'logs');
}

function ensureDir() {
    const d = dir();
    [path.dirname(d), d].forEach((p) => {
        try { fs.mkdirSync(p); } catch (e) { /* there */ }       // Node 8: no recursive mkdir
    });
    return d;
}

const pad = (n) => String(n).padStart(2, '0');
/* A wall-clock Date (clock.wall: its UTC fields are the car's time) as a file name stamp. */
function stamp(d) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
/* The start time a file name says, as a wall-clock Date (read with getUTC...). */
function startOf(name) {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.csv$/.exec(name);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

const cell = (v) => (typeof v === 'number' && isFinite(v) ? String(Math.round(v * 100) / 100) : '');

class Recording {
    constructor(now) {
        this.started = now || Date.now();
        this.name = `${stamp(clock.wall(this.started))}.csv`;
        this.file = path.join(ensureDir(), this.name);
        this.lines = [];
        this.last = -Infinity;
        this.rows = 0;
        fs.writeFileSync(this.file, `t,${FIELDS.join(',')}\n`);
        this.timer = setInterval(() => this.flush(), FLUSH_MS);
    }

    /* One sample of the values (taken at most every SAMPLE_MS); false once the recording is full. */
    sample(v, now) {
        const t = (now || Date.now()) - this.started;
        if (t >= MAX_MS) {
            return false;
        }
        if (t - this.last >= SAMPLE_MS) {
            this.last = t;
            this.lines.push(`${t},${FIELDS.map((f) => cell(v[f])).join(',')}`);
            this.rows++;
        }
        return true;
    }

    flush() {
        if (!this.lines.length) {
            return;
        }
        try {
            fs.appendFileSync(this.file, `${this.lines.join('\n')}\n`);
        } catch (e) {
            /* full or gone: the samples are dropped */
        }
        this.lines = [];
    }

    stop() {
        clearInterval(this.timer);
        this.flush();
        if (this.rows === 0) {
            try { fs.unlinkSync(this.file); } catch (e) { /* gone */ }
        }
        prune();
    }
}

/* The recordings, newest first: { name, start }. */
function list() {
    let names = [];
    try {
        names = fs.readdirSync(dir());
    } catch (e) {
        return [];
    }
    return names.filter((n) => startOf(n)).sort().reverse().map((n) => ({ name: n, start: startOf(n) }));
}

function prune() {
    list().slice(KEEP).forEach((r) => remove(r.name));
}

function remove(name) {
    if (!startOf(name)) {
        return;                         // only our own files
    }
    try { fs.unlinkSync(path.join(dir(), name)); } catch (e) { /* gone */ }
}

/* Every recording but keep (the one running), e.g. the logbook emptied. */
function removeAll(keep) {
    list().filter((r) => r.name !== keep).forEach((r) => remove(r.name));
}

function parse(name) {
    if (!startOf(name)) {
        return null;
    }
    let text;
    try {
        text = fs.readFileSync(path.join(dir(), name), 'utf8');
    } catch (e) {
        return null;
    }
    const lines = text.split('\n');
    // the columns by the header, so recordings made with fewer fields still read
    const head = (lines[0] || '').split(',');
    const col = {};
    FIELDS.forEach((f) => { const i = head.indexOf(f); col[f] = i > 0 ? i : -1; });
    const rows = lines.slice(1).filter(Boolean).map((l) => l.split(',').map((c) => (c === '' ? null : Number(c))));
    const at = (r, f) => (col[f] > 0 && r[col[f]] !== undefined ? r[col[f]] : null);
    return { name, start: startOf(name), rows, at };
}

/* A recording's duration (ms), samples, peaks (each field's maximum) and spark (engine speed, thinned), or null. */
function summary(name) {
    const p = parse(name);
    if (!p) {
        return null;
    }
    const peak = {};
    FIELDS.forEach((f) => {
        let m = null;
        p.rows.forEach((r) => { const v = p.at(r, f); if (v !== null && (m === null || v > m)) m = v; });
        peak[f] = m;
    });
    const last = p.rows.length ? p.rows[p.rows.length - 1][0] : 0;
    // the engine speed thinned to SPARK points, for the list
    const step = Math.max(1, Math.ceil(p.rows.length / SPARK));
    const spark = p.rows.filter((r, i) => i % step === 0).map((r) => p.at(r, 'rpm'));
    return { name, start: p.start, duration: last, samples: p.rows.length, peak, spark };
}

/* A recording for the curves: { name, start, duration, t: [ms], series: { field: [value or null] } },
 * thinned to at most POINTS samples (each kept sample is the one at its slot). */
function load(name) {
    const p = parse(name);
    if (!p) {
        return null;
    }
    const step = Math.max(1, Math.ceil(p.rows.length / POINTS));
    const kept = p.rows.filter((r, i) => i % step === 0);
    const series = {};
    FIELDS.forEach((f) => { series[f] = kept.map((r) => p.at(r, f)); });
    return { name, start: p.start, duration: p.rows.length ? p.rows[p.rows.length - 1][0] : 0, t: kept.map((r) => r[0]), series };
}

module.exports = { Recording, FIELDS, dir, list, summary, load, remove, removeAll, prune, SAMPLE_MS, MAX_MS, KEEP };
