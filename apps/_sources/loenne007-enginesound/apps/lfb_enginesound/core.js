'use strict';
/**
 * core.js - turns the car's data into the synthesizer's controls and decides when the sound plays.
 *
 *   rpm     the car's engine speed, estimated between its 10-20 samples a second (track.js), then mapped onto the
 *           chosen engine (setting rpmMap): "locked" = a fixed ratio per preset that puts the engine's firing order
 *           on a harmonic of the car's own engine, so the two blend at every rpm; "scaled" = the car's idle -> the
 *           engine's idle, the car's max rpm -> its redline; "real" = as it is
 *   load    the engine torque against the car's max torque: 0..1 pulling, negative on the overrun (engine braking)
 *   gear    from the gearbox; a change sends S <from> <to> (shift character in the synth)
 *
 * It plays while: switched on, the engine runs, and (setting sportOnly) the driving mode is Sport. Otherwise the
 * synth is muted (it fades) and, after a few seconds, the audio route is released so the car's own source returns.
 * The route (route.js): exclusive (CarLifeMedia, the music pauses) or, with the setting mix ("Play over music"), the
 * mix route chosen on the Audio page (default OAPGenericOverlay), which plays over the music.
 */
/* lock: the "locked" rev ratio (engine rpm = car rpm x lock). The car's four-cylinder fires at engine order 2; the
 * ratio puts the preset's firing order on an even order of it: i6 3 x 4/3 = 4, V8 4 x 1.5 = 6, V10 5 x 1.6 = 8,
 * V12 6 x 4/3 = 8. The diesel's 4800 rpm becomes 6400 / 7200 / 7680 / 6400 rpm. */
const PRESETS = {
    i6: { title: 'Inline 6', sub: '3.0 turbo, B58 / S58 style', idle: 700, red: 7000, turbo: true, lock: 4 / 3 },
    v8: { title: 'V8', sub: 'cross-plane, M5 style', idle: 650, red: 7200, turbo: true, lock: 1.5 },
    v10: { title: 'V10', sub: 'high-revving, naturally aspirated', idle: 900, red: 8250, turbo: false, lock: 1.6 },
    v12: { title: 'V12', sub: 'smooth, naturally aspirated', idle: 700, red: 7500, turbo: false, lock: 4 / 3 },
};
const ORDER = ['i6', 'v8', 'v10', 'v12'];
/* The sound engines (synth/<id>/ in the repository, es-synth-<id> in the service): each one plays all four presets;
 * the service runs the chosen one (ENGINE <id>). The first one is the default. "legacy" ones are offered only with the
 * setting legacyEngines on. */
const SOUND_ENGINES = [
    { id: 'simulate', title: 'Simulate', short: 'a whole engine', sub: 'a whole engine: pulses per cylinder, pipes, muffler' },
    // Active Sound Design emulation: it adds rpm-locked low engine orders under the car's own diesel, so it gets the
    // REAL rpm, and its four presets are diesel characters (shown with these names)
    { id: 'enhance', title: 'Enhance', short: 'bass for the diesel', sub: 'bass under the real diesel (Active Sound)', realRpm: true, presets: {
        i6: { title: 'Inline 6 Diesel', sub: 'BMW B57, X7 40d style' },
        v8: { title: 'V8 TDI', sub: 'Audi SQ7 style' },
        v10: { title: 'V6 TDI', sub: 'Audi S6 / S7 style burble' },
        v12: { title: 'V6 TDI Sport', sub: 'stronger, dynamic calibration' } } },
    { id: 'waveguide', title: 'Waveguide', short: 'legacy', sub: "legacy: Engine_Sim's pipes and resonators", legacy: true },
    { id: 'replica', title: 'Replica', short: 'legacy', sub: 'legacy: the Engine_Sim website, ported 1:1', legacy: true },
];
const DEFAULT_SOUND_ENGINE = SOUND_ENGINES[0].id;
/* The sounds of the main page: a sound engine with one of its presets, in this order. Everything else (the other
 * presets, the legacy sound engines, the Sound and Audio pages) shows only with the setting legacyEngines. */
const SOUNDS = [
    { id: 'i6', soundEngine: 'simulate', engine: 'i6' },
    { id: 'v8', soundEngine: 'simulate', engine: 'v8' },
    { id: 'v12', soundEngine: 'simulate', engine: 'v12' },
    { id: 'i6d', soundEngine: 'enhance', engine: 'i6' },
    { id: 'v8d', soundEngine: 'enhance', engine: 'v8' },
];
/* Sound engine ids saved by earlier versions (setting soundEngine). app.json's "aliases" maps them when the settings
 * load; soundEngineId() does it again. */
const LEGACY_SOUND_ENGINES = { a: 'waveguide', b: 'replica', c: 'simulate', d: 'enhance', pulse: 'simulate', bass: 'enhance' };
/** A stored soundEngine value as a current id (old ids mapped, unknown -> the default). */
function soundEngineId(v) {
    const id = Object.prototype.hasOwnProperty.call(LEGACY_SOUND_ENGINES, v) ? LEGACY_SOUND_ENGINES[v] : v;
    return SOUND_ENGINES.some((x) => x.id === id) ? id : DEFAULT_SOUND_ENGINE;
}
const soundEngineOf = (id) => SOUND_ENGINES.find((x) => x.id === soundEngineId(id));
/** A preset's title / subtitle / redline as shown for a sound engine: the engine's own names where it has them
 * (Enhance: diesel characters, no redline of their own). */
function presetInfoOf(soundEngine, k) {
    const p = PRESETS[k], own = soundEngineOf(soundEngine).presets;
    return own && own[k] ? Object.assign({}, p, own[k], { red: null }) : p;
}

const { routeFor } = require('./route');

/* The sound settings (Sound page): app setting key -> the synth's X name (synth/PROTOCOL.md). Stored in percent,
 * 0..200, 100 = the engine's own default; sent as multipliers 0..2. */
const SOUND_SETTINGS = [
    { key: 'xOffgas', name: 'offgas', label: 'Off the gas', sub: 'idle, coasting, light load' },
    { key: 'xTurbo', name: 'turbo', label: 'Turbo', sub: 'whistle and spool' },
    { key: 'xBov', name: 'bov', label: 'Blow-off', sub: 'whoosh when lifting after boost' },
    { key: 'xPops', name: 'pops', label: 'Pops & bangs', sub: 'on the overrun' },
    { key: 'xBass', name: 'bass', label: 'Bass', sub: 'low end' },
];

const ENGINE_RUNS = 400;      // rpm: below = engine off
const TEST_MS = 11000;        // the test sound (10 s of beeps) owns the route this long
const RELEASE_MS = 4000;      // muted this long: the audio route goes back to the car
const SEND_MS = 10;           // P lines at 100 Hz, each with the rpm estimated for that moment (track.js)
const RATE_LOG_MS = 600000;   // how often the car's rpm samples come: logged after a minute, then every 10 minutes
const STALE_MS = 1500;        // no rpm for this long: no P lines (the synth fades)
const { Track } = require('./track');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const num = (x) => typeof x === 'number' && isFinite(x);

class Core {
    /** opts = { settings, log, daemon, route, now(), mixChoice } */
    constructor(opts) {
        this.settings = opts.settings; this.log = opts.log; this.daemon = opts.daemon; this.route = opts.route;
        this.mixChoice = opts.mixChoice || null;     // the mix route chosen on the Audio page (null: the default)
        this.now = opts.now || Date.now;
        this.d = { rpm: null, rpmT: 0, speed: null, gear: undefined, torque: null, mode: null, demo: false };
        this.track = new Track();     // the rpm between the car's samples
        this.rateLogged = 0; this.t0 = this.now();
        this.idle = 800;          // the car's idle, learned at a standstill
        this.out = { rpm: 0, load: 0, throttle: 0, gear: 0 };
        this.playing = false; this.reason = 'starting'; this.mutedAt = this.now(); this.routed = false; this.lastGear = undefined;
        this.testUntil = 0; this.testRoute = null; this.lastP = 0; this.playRoute = null;
        this.timer = null;
    }

    preset() { const e = this.settings.get('engine'); return PRESETS[e] ? e : 'i6'; }

    /* ---------- inputs ---------- */
    feed(d) {
        const t = this.now();
        // a new rpm or torque goes to the synth at once (not only on the next tick)
        const fresh = num(d.rpm) || (d.torque !== undefined && num(d.torque));
        if (num(d.rpm)) { this.d.rpm = d.rpm; this.d.rpmT = t; this.track.feed(d.rpm, t); }
        if (num(d.speed)) this.d.speed = d.speed;
        if (d.torque !== undefined) this.d.torque = num(d.torque) ? d.torque : null;
        if (d.mode !== undefined) this.d.mode = d.mode;
        if (d.demo !== undefined) this.d.demo = d.demo;
        if (d.gear !== undefined && d.gear !== null) {
            const g = d.gear;
            if (this.lastGear !== undefined && g !== this.lastGear && g > 0 && this.lastGear > 0) this.daemon.send('S ' + this.lastGear + ' ' + g);
            this.lastGear = g; this.d.gear = g;
        }
        if (fresh && this.playing && t - this.lastP >= 4) this._sendP();
        // the car's idle: rpm at a standstill, engine warm and settled (diesel 750-900)
        if (num(this.d.rpm) && this.d.speed !== null && this.d.speed < 1 && this.d.rpm > 550 && this.d.rpm < 1100 && (!num(this.d.torque) || this.d.torque < 60)) {
            this.idle += (this.d.rpm - this.idle) * 0.01;
        }
    }

    /* ---------- mapping ---------- */
    virtualRpm(real) {
        const p = PRESETS[this.preset()];
        const map = this.settings.get('rpmMap');
        if (map === 'real' || soundEngineOf(this.soundEngine()).realRpm) return real;
        if (map !== 'scaled') return Math.min(real * p.lock, p.red * 1.03);          // locked
        const top = Math.max(this.idle + 1000, Number(this.settings.get('realRedline')) || 4800);
        if (real <= this.idle) return real / this.idle * p.idle;
        const x = (real - this.idle) / (top - this.idle);
        return p.idle + clamp(x, 0, 1.1) * (p.red - p.idle);
    }

    load(tq) {
        if (!num(tq)) return 0.2;
        const max = Number(this.settings.get('maxTorque')) || 400;
        return tq >= 0 ? clamp(tq / max, 0, 1) : clamp(tq / 80, -1, 0);
    }

    /* ---------- when it plays ---------- */
    why() {
        const t = this.now();
        if (this.settings.get('enabled') === false) return 'off';
        if (!num(this.d.rpm) || t - this.d.rpmT > STALE_MS) return 'no engine data';
        if (this.d.rpm < ENGINE_RUNS) return 'engine off';
        if (this.settings.get('sportOnly') === true && this.d.mode !== 'sport') return 'waiting for Sport mode';
        return null;
    }

    start() {
        if (this.timer) return;
        this.daemon.send('M 1');
        this._applySettings();
        this.timer = setInterval(() => this.tick(), SEND_MS);
    }

    soundEngine() { return soundEngineId(this.settings.get('soundEngine')); }

    /** The engines offered: the main ones, and the legacy ones with the setting legacyEngines on (or chosen). */
    soundEngines() {
        const all = this.settings.get('legacyEngines') === true, cur = this.soundEngine();
        return SOUND_ENGINES.filter((x) => !x.legacy || all || x.id === cur);
    }

    /** The volume setting (10-100 %) as the synth's gain (V 0..2): linear up to 50 % = 0.9 (about the 90 % of
     * versions before 1.1), then gently up to 100 % = 1.4 (+4 dB, where the speaker protection starts to hold the
     * loudest full-load passages). */
    synthVolume() {
        const s = Number(this.settings.get('volume')), v = isFinite(s) && s > 0 ? clamp(s, 0, 100) : 50;
        return v <= 50 ? v / 50 * 0.9 : 0.9 + (v - 50) / 50 * 0.5;
    }

    /** The preset's title / subtitle / redline as shown: the sound engine's own names where it has them (Enhance). */
    presetInfo(k) { return presetInfoOf(this.soundEngine(), k); }

    /** Setting legacyEngines: all presets, the legacy sound engines and the Sound and Audio pages show. */
    legacy() { return this.settings.get('legacyEngines') === true; }

    /** The main page's sounds: [{ id, title, sub, kind (the sound engine's title), selected }]. */
    sounds() {
        const se = this.soundEngine(), e = this.preset();
        return SOUNDS.map((x) => {
            const q = presetInfoOf(x.soundEngine, x.engine);
            return { id: x.id, title: q.title, sub: q.sub, kind: soundEngineOf(x.soundEngine).title, selected: x.soundEngine === se && x.engine === e };
        });
    }

    /** Choose one of the main page's sounds (the preset first: the new sound engine then starts with it). */
    setSound(id) {
        const x = SOUNDS.find((y) => y.id === id);
        if (!x) return;
        if (this.preset() !== x.engine) this.settings.set('engine', x.engine);
        if (this.soundEngine() !== x.soundEngine) this.settings.set('soundEngine', x.soundEngine);
    }

    _applySettings() {
        const p = this.preset();
        this.daemon.send('ENGINE ' + this.soundEngine());
        this.daemon.send('E ' + p);
        // (Enhance's presets are all turbo diesels)
        const turbo = soundEngineOf(this.soundEngine()).realRpm || PRESETS[p].turbo;
        this.daemon.send('T ' + (turbo && this.settings.get('turbo') !== false ? 1 : 0));
        this.daemon.send('V ' + this.synthVolume().toFixed(2));
        SOUND_SETTINGS.forEach((x) => this.daemon.send('X ' + x.name + ' ' + this.soundSetting(x.key).toFixed(2)));
    }

    /** A sound setting as the synth's multiplier, 0..2. */
    soundSetting(key) { const v = Number(this.settings.get(key)); return isFinite(v) && this.settings.get(key) !== undefined ? clamp(v / 100, 0, 2) : 1; }

    onSetting(key) {
        if (key === 'mix') this.reroute();
        if (key === 'engine' || key === 'turbo' || key === 'volume' || key === 'soundEngine') this._applySettings();
        const x = SOUND_SETTINGS.find((s) => s.key === key);
        if (x) this.daemon.send('X ' + x.name + ' ' + this.soundSetting(key).toFixed(2));
    }

    tick() {
        const t = this.now();
        if (t < this.testUntil) return;                 // the test sound owns the route
        const why = this.why();
        if (why !== this.reason) { this.log.info('sound: ' + (why || 'playing')); this.reason = why; }
        if (!why) {
            if (!this.playing) { this.playing = true; this.daemon.send('M 0'); }
            if (!this.routed) this._route(true);
            if (t - this.lastP >= SEND_MS - 3) this._sendP();
            this._logRate(t);
        } else {
            if (this.playing) { this.playing = false; this.mutedAt = t; this.daemon.send('M 1'); }
            if (this.routed && t - this.mutedAt > RELEASE_MS) this._route(false);
        }
    }

    /** The car's rpm sample rate into the log (it decides how smooth and how quick the sound can follow). */
    _logRate(t) {
        if (t - (this.rateLogged || this.t0) < (this.rateLogged ? RATE_LOG_MS : 60000)) return;
        const st = this.track.stats();
        if (st.samples < 50) return;
        this.rateLogged = t;
        this.log.info('rpm samples every ' + Math.round(st.interval) + ' ms (' + st.perSecond.toFixed(1) + ' a second)');
    }

    /** The car's engine speed now: the estimate between samples (track.js), the last reading without one. */
    rpmNow() { const e = this.track.at(this.now()); return num(e) ? e : this.d.rpm; }

    _sendP() {
        const rpm = this.virtualRpm(this.rpmNow()), load = this.load(this.d.torque);
        // throttle: what the driver asks; the torque follows it closely in a turbo diesel
        const thr = clamp(load * 1.15, 0, 1);
        this.out = { rpm, load, throttle: thr, gear: this.d.gear === undefined ? 0 : this.d.gear };
        this.lastP = this.now();
        this.daemon.send('P ' + rpm.toFixed(1) + ' ' + load.toFixed(3) + ' ' + thr.toFixed(3) + ' ' + this.out.gear + ' ' + (num(this.d.speed) ? this.d.speed.toFixed(1) : '0'));
    }

    /* ---------- the audio route ---------- */
    /** The SmartX endpoints the service found (SHM), or null while unknown. */
    endpoints() { const m = this.daemon.shm; return m && !m.error && Array.isArray(m.endpoints) ? m.endpoints : null; }

    mixOn() { return this.settings.get('mix') === true; }

    /** The route the engine plays on now: exclusive, or (setting mix) the chosen mix route. */
    activeRoute() { return routeFor(this.mixOn(), this.mixChoice, this.endpoints()); }

    /** A new mix choice from the Audio page (null: the default). */
    setMixChoice(choice) { this.mixChoice = choice || null; if (this.mixOn()) this.reroute(); }

    /** The route changed (mix on / off, a new mix choice): release the old one; tick() connects the new one. */
    reroute() { if (this.routed && this.now() >= this.testUntil) this._route(false); }

    _route(on) {
        if (on === this.routed) return;
        this.routed = on;
        if (on) {
            const r = this.playRoute = this.activeRoute();
            if (r.note) this.log.info('sound: ' + r.note);
            this.daemon.send('OUT ' + r.device);
            if (this.route) {
                this.route.connect(r).then((ok) => { if (!ok) this.log.warn('sound: audio route ' + r.name + ' failed: ' + this.route.error); });
            }
        } else {
            this.playRoute = null;
            this.daemon.send('OUT none');
            if (this.route) this.route.disconnect();
        }
    }

    /** Test: 10 s of beeps through a route (default: the one the engine plays on), also with the engine off. */
    test(route) {
        const t = this.now();
        if (t < this.testUntil) return;
        const r = route || this.activeRoute();
        this.testUntil = t + TEST_MS; this.testRoute = r;
        this.log.info('sound: test tone on ' + r.name + ' (' + r.device + ')');
        this.daemon.send('M 1');
        this.playRoute = r; this.routed = true;
        this.daemon.send('OUT ' + r.device);
        const go = () => this.daemon.send('TONE ' + r.device);
        if (this.route) this.route.connect(r).then(go); else go();
        setTimeout(() => this.endTest(), TEST_MS);
    }

    /** After the test: its route goes; tick() decides again (playing on the active route, or nothing). */
    endTest() {
        this.testUntil = 0; this.testRoute = null;
        this._route(false);
        this.playing = false; this.mutedAt = this.now() - RELEASE_MS; this.reason = 'after test';
    }
}

module.exports = { Core, PRESETS, ORDER, SOUNDS, SOUND_ENGINES, SOUND_SETTINGS, soundEngineId };
