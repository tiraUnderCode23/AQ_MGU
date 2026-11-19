'use strict';
/*
 * Seat Lights: holds the seat (headrest) logos on through the body controller, for as long as the switch is ON.
 * Tested on a desktop by tools/test_seatlights.js, against a fake body controller.
 *
 * On the G87 the logos hang on the BDC's lamp output 45 (found with Light Logger): element 44 (0x2C), the
 * output number minus one. How, the way Light Logger's Keep on does it (the MIT-licensed idrive7-apps kit's way):
 *   10 03                       the body controller's extended diagnostic session
 *   2F <ctl> <layout, on>       hold the output on; <ctl> E3B5 when the lamp outputs read with E3B9, 4501 with 4500
 *   2F <ctl> <layout, on>       again every REFRESH_MS (1 s): on the car the hold lasted about 10 s with the engine
 *                               running, and with it renewed every 2.5 s the logos still blinked off for a second with
 *                               the car off and unlocked, so the body controller ends it sooner there. A body controller ends a short-term
 *                               adjustment after a while, and the session after a few quiet seconds; the same
 *                               request every 2.5 s renews both, before either runs out. If the app stops, the
 *                               requests stop, and the BDC ends the session and takes the output back by itself
 *   2F <ctl> <layout, back>     hand it back (switch OFF, the app stopping), then 10 01
 * The record layout: the G87 refused the kit's 03 <el> 01 with "bad length", so the first time the switch goes ON
 * it tries uds.js FORMATS in turn, with the logos dark, and keeps the first one the body controller takes that
 * lights the output (read back) with nothing else switching on. The layout is saved.
 *
 * The switch ON holds them whatever the car does, with one exception: while the car is locked (it says it is parked
 * with nobody in it, VehicleCondition) AND the engine isn't running (CDS.statusEngineSpeed2), the output is handed
 * back and the car switches the logos off. Unlocked, or the engine running, it holds them again. A car that never
 * says its state never bypasses the switch. Both come from the app: car({ engine, locked }).
 *
 * While held it reads nothing: each renewal's answer says the body controller took it, and a renewal refused (the
 * session lost) asks again from the start at once (the log says how long the hold had lasted, the car's state and
 * when the last renewal went through). The lamp outputs are read only before the first hold: to find the layout,
 * with the logos dark, and which status identifier the body controller answers. MAX_FAILS refusals in a row and it gives up: the switch goes OFF and says why.
 *
 *   const s = new SeatLight({ uds, log, output: 45, layout, statusDid });
 *   s.setOn(true | false)      s.state -> { on, holding, note, warn, layout, output }      s.stop()
 *   s.on('change'), s.on('save', { on, layout, statusDid })
 */
const EventEmitter = require('events');
const { FORMATS } = require('./uds.js');
const lamps = require('./lamps.js');

const BDC = 0x40;
const OUTPUT = 45;
const REFRESH_MS = 1000;
const LOCK_SETTLE_MS = 10000;     // locked must hold this long before the switch is bypassed (a passing 'parked' isn't)
const CHECK_MS = 2000;            // while ON and not held: how often it tries again
const SETTLE_MS = 700;
const MAX_FAILS = 5;
const STATUS_DIDS = [[0xe3, 0xb9], [0x45, 0x00]];
const CONTROL = { 'E3B9': [0xe3, 0xb5], '4500': [0x45, 0x01] };
const NEXT_LAYOUT = [0x12, 0x13, 0x31];
const NRC = {
    0x10: 'general reject', 0x11: 'service not supported', 0x12: 'sub-function not supported', 0x13: 'bad length',
    0x21: 'busy', 0x22: 'conditions not correct', 0x31: 'out of range', 0x33: 'security access denied',
    0x7e: 'not supported in this session', 0x7f: 'not supported in this session',
};
const hex = (b) => (b || []).map((x) => (x < 16 ? '0' : '') + x.toString(16).toUpperCase()).join(' ');
const why = (r) => (!r ? 'no answer' : r[0] === 0x7f ? 'refused: ' + (NRC[r[2]] || 'NRC 0x' + hex([r[2]])) : 'answer ' + hex(r.slice(0, 4)));
const key = (did) => hex(did).replace(' ', '');

class SeatLight extends EventEmitter {
    constructor(o) {
        super();
        this.uds = o.uds; this.log = o.log; this.now = o.now || Date.now;
        this.output = o.output || OUTPUT;
        this.element = this.output - 1;
        this.refreshMs = o.refreshMs || REFRESH_MS;
        this.lockSettleMs = o.lockSettleMs === undefined ? LOCK_SETTLE_MS : o.lockSettleMs;
        this._lockedSince = null;
        this._lastRenew = 0;
        this._asserting = false; this._renewing = false;
        this.engine = null;                 // true running, false off, null not known yet
        this.locked = null;                 // true parked and locked, false not, null not known
        this._heldSince = 0;
        this.checkMs = o.checkMs || CHECK_MS;
        this.settleMs = o.settleMs === undefined ? SETTLE_MS : o.settleMs;
        this.layout = Number.isInteger(o.layout) && FORMATS[o.layout] ? o.layout : null;
        this.statusDid = Array.isArray(o.statusDid) && CONTROL[key(o.statusDid)] ? o.statusDid : null;
        this.on_ = false;                   // the switch
        this.holding = false;               // the BDC took it and we keep its session
        this.value = null;                  // the output's latest value
        this.fails = 0;
        this.note = 'Off'; this.warn = false;
        this._busy = null;
        this._keepalive = null; this._check = null;
        this._taken = [];
        this._session = false;              // we opened the extended session (and end it when done)
        this.uds.allowControl(this.element);
    }

    get state() {
        return { on: this.on_, holding: this.holding, note: this.note, warn: this.warn, layout: this.layout, output: this.output,
            value: this.value, busy: !!this._busy, bypassed: this.bypassed(), engine: this.engine, locked: this.locked };
    }

    /* the car's state, from the app: { engine: true | false } and / or { locked: true | false | null } */
    car(c) {
        if (c && c.engine !== undefined && c.engine !== this.engine) {
            this.engine = c.engine;
            this.log.info('seat lights: engine ' + (c.engine ? 'running' : 'off'));
        }
        if (c && c.locked !== undefined && c.locked !== this.locked) {
            this.locked = c.locked;
            this._lockedSince = c.locked === true ? this.now() : null;
            this.log.info('seat lights: car ' + (c.locked === true ? 'locked' : c.locked === false ? 'not locked' : 'state unknown'));
        }
        if (this.on_) this._tick();
    }

    /* the switch bypassed: the car locked and the engine not running */
    bypassed() {
        return this.locked === true && this.engine !== true && this._lockedSince !== null && this.now() - this._lockedSince >= this.lockSettleMs;
    }

    _say(text, warn) {
        this.note = text; this.warn = !!warn;
        (warn ? this.log.warn : this.log.info).call(this.log, 'seat lights: ' + text);
        this.emit('change');
    }
    _save() { this.emit('save', { on: this.on_, layout: this.layout, statusDid: this.statusDid }); }
    get ctl() { return this.statusDid ? CONTROL[key(this.statusDid)] : null; }

    /* the lamp outputs, with whichever status identifier answers: [values] | null */
    _read() {
        const order = this.statusDid ? [this.statusDid] : STATUS_DIDS;
        return order.reduce((p, did) => p.then((got) => {
            if (got) return got;
            return this.uds.read(BDC, did, 8000).then((r) => {
                const mods = r ? lamps.parse(r, did) : null;
                if (!mods) return null;
                if (!this.statusDid) { this.statusDid = did; this._save(); }
                return mods.map((m) => m.value);
            }, () => null);
        }), Promise.resolve(null)).then((v) => {
            if (v) this.value = v[this.output - 1] === undefined ? null : v[this.output - 1];
            return v;
        });
    }

    setOn(on) {
        on = !!on;
        if (on === this.on_) return this._busy || Promise.resolve();
        this.on_ = on; this.fails = 0;
        this._save();
        if (!on) {
            this._stopTimers();
            return (this._busy || Promise.resolve()).then(() => this._release('switched off')).then(() => this._say('Off'));
        }
        this._say('Switching on...');
        this._startCheck();
        return this._tick();
    }

    /* while ON: hold when not held (unless bypassed); asked again when the output reads off */
    _tick() {
        if (!this.on_ || this._busy) return this._busy || Promise.resolve();
        if (this.bypassed()) {
            // locked with the engine off: the car's own logic has the logos (it switches them off)
            if (!this.holding && !this._session) {
                const text = 'On: off while the car is locked';
                if (this.note !== text) this._say(text);
                return Promise.resolve();
            }
            this._busy = this._release('the car is locked, the engine off').then(() => {
                this._say('On: off while the car is locked');
            }).then(() => { this._busy = null; });
            return this._busy;
        }
        // held: nothing to read. Each renewal's answer says the body controller took it, and a read waiting for its
        // answer would hold up the renewals behind it on the link (the logos blinked off for a second like that)
        if (this.holding) return Promise.resolve();
        // the layout known: asked for straight away, no read first
        if (this.layout !== null && this.statusDid) {
            this._busy = this._assert().catch((e) => this._say('Error: ' + ((e && e.message) || e), true)).then(() => { this._busy = null; });
            return this._busy;
        }
        this._busy = this._read().then((v) => {
            if (!this.on_) return undefined;
            if (!v) { this._say('Waiting for the body controller (no lamp outputs read yet)', true); return undefined; }
            const val = v[this.output - 1];
            if (val === undefined) { this._say('The body controller reports no lamp output ' + this.output, true); return undefined; }
            if (this.layout === null) {
                if (val > 0) { this._say('First time: waiting for the logos to go dark (engine on)'); return undefined; }
                return this._probe(v);
            }
            return this._assert();
        }).catch((e) => this._say('Error: ' + ((e && e.message) || e), true)).then(() => { this._busy = null; });
        return this._busy;
    }

    _startCheck() {
        if (this._check) return;
        this._check = setInterval(() => { if (this.on_) this._tick(); }, this.checkMs);
    }
    _stopTimers() {
        if (this._check) { clearInterval(this._check); this._check = null; }
        if (this._keepalive) { clearInterval(this._keepalive); this._keepalive = null; }
    }

    _failed(text) {
        this.fails++;
        this.holding = false;
        if (this.fails >= MAX_FAILS) {
            this.on_ = false; this._save();
            this._stopTimers();
            this._say('Gave up after ' + this.fails + ' refusals in a row (' + text + '). Switch on to try again', true);
            return this._release('gave up');
        }
        this._say(text + ' (' + this.fails + ' in a row, trying again)', true);
        return Promise.resolve();
    }

    /* session, then hold on with the known layout */
    _assert() {
        this._asserting = true;
        return this.uds.control(BDC, 0x10, [0x03]).then((s) => {
            if (!s || s[0] !== 0x50) return this._failed('The body controller didn\'t open the session: ' + why(s));
            this._session = true;
            return this.uds.control(BDC, 0x2f, this.ctl.concat(FORMATS[this.layout].on(this.element))).then((r) => {
                if (!r || r[0] !== 0x6f) return this._failed('The body controller didn\'t take it: ' + why(r));
                if (!this.holding) this._heldSince = this.now();
                this.holding = true; this.fails = 0; this._lastRenew = this.now();
                this._startKeepalive();
                this._say('On');
                return undefined;
            });
        }).then((v) => { this._asserting = false; return v; }, (e) => { this._asserting = false; throw e; });
    }

    /* the first time: find the record layout (see the top of this file) */
    _probe(before) {
        const idx = this.output - 1;
        this._taken = [];
        this._say('First time: finding the layout this body controller takes');
        return this.uds.control(BDC, 0x10, [0x03]).then((s) => {
            if (!s || s[0] !== 0x50) return this._failed('The body controller didn\'t open the session: ' + why(s));
            this._session = true;
            const tryOne = (f) => {
                if (f >= FORMATS.length) {
                    this.on_ = false; this._save(); this._stopTimers();
                    this._say('The body controller took none of the ' + FORMATS.length + ' layouts', true);
                    return this._release('no layout');
                }
                const req = this.ctl.concat(FORMATS[f].on(this.element));
                return this.uds.control(BDC, 0x2f, req).then((a) => {
                    this.log.info('seat lights: layout ' + (f + 1) + ' (2F ' + hex(req) + '): ' + (a && a[0] === 0x6f ? 'taken' : why(a)));
                    if (a && a[0] === 0x7f && NEXT_LAYOUT.indexOf(a[2]) >= 0) return tryOne(f + 1);
                    if (!a || a[0] !== 0x6f) return this._failed('The body controller didn\'t take it: ' + why(a));
                    this._taken.push(f);
                    return new Promise((res) => setTimeout(res, this.settleMs)).then(() => this._read()).then((after) => {
                        if (!after) return this._failed('Couldn\'t read the outputs back');
                        const others = after.map((v, i) => (i !== idx && v > 0 && !(before[i] > 0) ? i + 1 : null)).filter((x) => x !== null);
                        if (others.length) {
                            this.on_ = false; this._save(); this._stopTimers();
                            this._say('Layout ' + (f + 1) + ' also switched on lamp output ' + others.join(', ') + ': handed back, stopped', true);
                            return this._release('wrong layout');
                        }
                        if (!(after[idx] > 0)) {
                            return this.uds.control(BDC, 0x2f, this.ctl.concat(FORMATS[f].back(this.element))).catch(() => null).then(() => tryOne(f + 1));
                        }
                        this.layout = f; this._save();
                        this.holding = true; this.fails = 0; this._heldSince = this.now();
                        this._startKeepalive();
                        this._say('On (layout ' + (f + 1) + ' found and saved)');
                        return undefined;
                    });
                });
            };
            return tryOne(0);
        });
    }

    _heldFor() { return Math.round((this.now() - this._heldSince) / 100) / 10 + ' s'; }
    _sinceRenew() { return this._lastRenew ? Math.round((this.now() - this._lastRenew) / 100) / 10 + ' s' : 'none'; }
    _carText() {
        return 'engine ' + (this.engine === true ? 'running' : this.engine === false ? 'off' : '?') + ', ' +
            (this.locked === true ? 'locked' : this.locked === false ? 'unlocked' : 'lock ?');
    }

    /* the hold asked for again every refreshMs: renews it and the session (see the top of this file) */
    _startKeepalive() {
        if (this._keepalive) clearInterval(this._keepalive);
        this._keepalive = setInterval(() => {
            // never held up by a check's read: only by the hold being asked for again (_asserting)
            if (!this.holding || this._asserting || this._renewing) return;
            this._renewing = true;
            this.uds.control(BDC, 0x2f, this.ctl.concat(FORMATS[this.layout].on(this.element))).then((r) => {
                this._renewing = false;
                if (!this.holding) return;
                if (r && r[0] === 0x6f) { this._lastRenew = this.now(); return; }
                // the session is gone, or the hold refused: ask again from the start
                this.holding = false;
                this._say('Renewal ' + why(r) + ' after ' + this._heldFor() + ' held (' + this._carText() + ', last renewal ' + this._sinceRenew() + ' before): asking again', true);
                this._tick();
            }, () => { this._renewing = false; });
        }, this.refreshMs);
    }

    /* hands the output back and leaves the session; safe any time */
    _release(reason) {
        if (this._keepalive) { clearInterval(this._keepalive); this._keepalive = null; }
        if (!this.on_) this._stopTimers();
        const was = this.holding || this._taken.length > 0;
        const session = this._session;
        this.holding = false; this._session = false;
        if (!this.ctl || (!was && !session)) return Promise.resolve();
        const layouts = !was ? [] : this.layout !== null ? [this.layout] : this._taken;
        this._taken = [];
        this.log.info('seat lights: ' + (was ? 'handing lamp output ' + this.output + ' back' : 'ending the session') + ' (' + reason + ')');
        return layouts.reduce((p, f) => p.then(() => this.uds.control(BDC, 0x2f, this.ctl.concat(FORMATS[f].back(this.element))).catch(() => null)), Promise.resolve())
            .then(() => this.uds.control(BDC, 0x10, [0x01]).catch(() => null));
    }

    /* the app is stopping: hand back, keep the switch as it is (it holds again at the next start) */
    stop() {
        this._stopTimers();
        return this._release('the app is stopping');
    }
}

module.exports = { SeatLight, OUTPUT, CHECK_MS, REFRESH_MS, MAX_FAILS };
