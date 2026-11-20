'use strict';
/**
 * turn.js - which turn signal is on, learned from the car's own light status.
 *
 * Nobody has mapped the turn indicators inside BMW's Vehicle2 statusLightStatus (or any other field an app
 * can read), so the app learns them once, parked: the owner taps "Signals off", then signals left and taps
 * "Left is on", then right and "Right is on". Each tap records every value each watched field takes over
 * CAPTURE_MS (a turn signal flashes, so one sample is not enough). A side's marks are the (field path, value)
 * pairs seen while it was on and never while the signals were off, minus the ones the other side also showed
 * (a shared "an indicator is on" bit cannot tell left from right).
 *
 * Detection: a side is on while one of its marks was seen in the last holdMs (the flash's dark half and the
 * moment after the stalk returns). Both sides flashing in step (hazards) count as neither; a switch from one
 * side to the other goes to the newer one.
 *
 * Pure: no timers of its own (now() is passed in), nothing read from the car. Node 8.
 */

const CAPTURE_MS = 3000;
const SETTLE_MS = 300;        // a side's capture ignores this first part (the value still on from before the tap)
const SIDES = ['left', 'right'];
const HAZARD_MS = 250;        // both sides' flashes starting this close together = the hazard lights (they flash in step)
const GAP_MS = 250;           // a side unseen this long and seen again: a new flash starts

/** Every leaf of v as { 'a.b[0].c': primitive }; v itself under '' when it is a primitive. */
function flatten(v, base, out) {
    out = out || {};
    base = base || '';
    if (v === null || v === undefined || typeof v !== 'object') { out[base] = v === undefined ? null : v; return out; }
    if (Buffer.isBuffer(v)) { out[base] = v.toString('hex'); return out; }
    if (Array.isArray(v)) { v.forEach((x, i) => flatten(x, base + '[' + i + ']', out)); return out; }
    Object.keys(v).sort().forEach((k) => flatten(v[k], base ? base + '.' + k : k, out));
    return out;
}
const key = (src, p) => src + (p ? '/' + p : '');
const vk = (x) => JSON.stringify(x);

class Turn {
    /** saved: what learned() returned last time (or null). */
    constructor(saved) {
        this.cur = {};            // 'src/path' -> the latest value
        this.seenAt = { left: -1e9, right: -1e9 };   // when each side was last seen (never)
        this.onsetAt = { left: -1e9, right: -1e9 };   // when each side's latest flash started
        this.cap = null;          // { which, until, vals: { k: Set(vk) } }
        this.base = null;         // the 'off' capture: { k: [vk] }
        this.marks = { left: [], right: [], at: 0, note: '' };
        this.changes = [];        // the last raw changes, for the screen and the log
        if (saved && saved.marks) {
            this.marks = saved.marks;
            this.base = saved.base || null;
        }
    }

    /** A new value of a watched field (src: 'light', ...). */
    feed(src, value, now) {
        const leaves = flatten(value);
        Object.keys(leaves).forEach((p) => {
            const k = key(src, p), v = leaves[p];
            if (vk(this.cur[k]) !== vk(v)) {
                this.changes.push({ at: now, k: k, v: v });
                if (this.changes.length > 40) this.changes.shift();
            }
            this.cur[k] = v;
            if (this.cap && now >= this.cap.from) (this.cap.vals[k] = this.cap.vals[k] || new Set()).add(vk(v));
            SIDES.forEach((s) => {
                if (!this._hit(s, k, v)) return;
                if (now - this.seenAt[s] > GAP_MS) this.onsetAt[s] = now;
                this.seenAt[s] = now;
            });
        });
    }
    _hit(side, k, v) {
        const m = this.marks[side];
        for (let i = 0; i < m.length; i++) if (m[i].k === k && m[i].v.indexOf(vk(v)) >= 0) return true;
        return false;
    }

    /**
     * Start recording: which = 'off' | 'left' | 'right'. For 'off' the current values count as seen (a steady
     * field the car does not send again is still part of "off"); for a side only what arrives after SETTLE_MS
     * does, or the other side's last value, still current at the tap, would be learned as this side's.
     */
    capture(which, now) {
        const vals = {};
        if (which === 'off') Object.keys(this.cur).forEach((k) => { vals[k] = new Set([vk(this.cur[k])]); });
        this.cap = { which: which, until: now + CAPTURE_MS, vals: vals, from: which === 'off' ? now : now + SETTLE_MS };
    }
    capturing(now) { return this.cap && now < this.cap.until ? this.cap.which : null; }
    /** Ends a capture whose time is up; returns { which, ok, text } once, else null. */
    tick(now) {
        if (!this.cap || now < this.cap.until) return null;
        const c = this.cap;
        this.cap = null;
        const vals = {};
        Object.keys(c.vals).forEach((k) => { vals[k] = Array.from(c.vals[k]); });
        if (!Object.keys(vals).length) return { which: c.which, ok: false, text: 'The car sent no light status - nothing to learn from' };
        if (c.which === 'off') {
            this.base = vals;
            this.marks = { left: [], right: [], at: 0, note: '' };
            this._raw = { off: vals };
            return { which: 'off', ok: true, text: 'Signals off recorded. Now signal left and tap Left is on' };
        }
        if (!this.base) return { which: c.which, ok: false, text: 'Tap Signals off first, with both signals off' };
        const m = [];
        Object.keys(vals).forEach((k) => {
            const was = this.base[k] || [];
            const fresh = vals[k].filter((x) => was.indexOf(x) < 0);
            if (fresh.length) m.push({ k: k, v: fresh });
        });
        this._raw = Object.assign({}, this._raw, { [c.which]: vals });
        this.marks[c.which] = m;
        this._split();
        this.marks.at = now;
        const side = c.which === 'left' ? 'Left' : 'Right';
        if (!m.length) return { which: c.which, ok: false, text: side + ': nothing changed in the light status - tap Car check and send a photo' };
        if (!this.marks[c.which].length) return { which: c.which, ok: false, text: side + ' looks the same as the other side - this field cannot tell them apart' };
        return { which: c.which, ok: true, text: side + ' learned (' + this.marks[c.which].length + ' sign' + (this.marks[c.which].length > 1 ? 's' : '') + ')' };
    }
    /** Drops the marks both sides share (once both are learned). */
    _split() {
        const L = this.marks.left, R = this.marks.right;
        if (!L.length || !R.length) return;
        const strip = (A, B) => A.map((a) => {
            const b = B.filter((x) => x.k === a.k)[0];
            return b ? { k: a.k, v: a.v.filter((x) => b.v.indexOf(x) < 0) } : a;
        }).filter((a) => a.v.length);
        const l2 = strip(L, R), r2 = strip(R, L);
        this.marks.left = l2; this.marks.right = r2;
        this.marks.note = l2.length && r2.length ? '' : 'left and right look the same';
    }

    learned() { return { marks: this.marks, base: this.base, raw: this._raw || null }; }
    ready() { return this.marks.left.length > 0 && this.marks.right.length > 0; }
    has(side) { return this.marks[side].length > 0; }
    forget() { this.marks = { left: [], right: [], at: 0, note: '' }; this.base = null; this._raw = null; }

    /** 'left' | 'right' | null (none, or both = hazards). */
    side(now, holdMs) {
        const a = this.seenAt.left, b = this.seenAt.right;
        const l = now - a <= holdMs, r = now - b <= holdMs;
        if (l && r) {
            // hazards start both flashes together; a switch from one side to the other starts them apart
            if (Math.abs(this.onsetAt.left - this.onsetAt.right) < HAZARD_MS) return null;
            return a > b ? 'left' : 'right';
        }
        return l ? 'left' : r ? 'right' : null;
    }
    /** Raw view of a side right now, ignoring the hold (for the screen's live lamps). */
    lit(side, now) { return now - this.seenAt[side] <= 700; }
}

module.exports = { Turn, flatten, CAPTURE_MS };
