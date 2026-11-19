'use strict';
/*
 * Seat Lights: an iDrive 8 app with one switch. ON keeps the seat (headrest) logos lit, with no timer, until it is
 * switched OFF (seat_light.js: the body controller's lamp output 45 held on). The one exception: while the car is
 * locked with the engine off, the car has them (and switches them off); unlocked, they are held again. The switch is kept, and the app starts
 * with the head unit (package.json mguAppStartType autostart), so with it ON the logos come on by themselves each drive.
 *
 * Its screen: drawn by the head unit's renderer (ui.js, gpu.js) when MGU Store's Renderer is installed (touch, or the
 * controller through the HMI list underneath), else the HMI's own list: a status line and the switch's row.
 * Built on the head unit by MGU Store against the car's own oap-sdk (mgu-app.json).
 */
const os = require('os');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const OnlineApp = require('oap-sdk/src/core/OnlineApp.js');
const logging = require('oap-sdk/src/logging/logging');
const { SomeipLink } = require('./someip_link.js');
const { Uds, IFACE: TASU } = require('./uds.js');
const { SeatLight } = require('./seat_light.js');
const { Gpu } = require('./gpu.js');
const ui = require('./ui.js');

const logger = logging.getSDKLogger();

const STATE = 'ST_OnlineApps_SeatLights';
const STATUS = 'slStatus';
const SWITCH = 'slSwitch';
const RENDER_MS = 1000;
const FRAME_MS = 100;
const ID8_AREA = { x: 0, y: 76, w: 2880, h: 764 };
const VALUE_KEY = 0;
const FOREGROUND_REASONS = ['ENTRY_POINT', 'LUM', 'BOOKMARK', 'START_WIDGET', 'TRIGGER_HMI', 'SPEECH_COMMAND'];
const isTrue = (v) => v === true || v === 1 || v === 'true' || v === '1';

/* VehicleCondition.statusConditionVehicle: names or wire numbers -> 1..12 (1-3 parked: locked, nobody in it; 5 living;
 * 7 ignition; 8 starting; 10 driving; 12 ending), or the partial networks it keeps awake when the state isn't sent */
const CONDITIONS = { PARKEN_BN_NIO: 1, PARKEN_BN_IO: 2, STANDFUNKTIONEN_KUNDE_NICHT_IM_FZG: 3, WOHNEN: 5,
    PRUEFEN_ANALYSE_DIAGNOSE: 7, FAHRBEREITSCHAFT_HERSTELLEN: 8, FAHREN: 10, FAHRBEREITSCHAFT_BEENDEN: 12 };
function number(x) { const n = typeof x === 'number' ? x : CONDITIONS[x]; return n >= 1 && n <= 12 ? n : undefined; }
function conditionOf(v) {
    const n = number(v && v.statusConditionVehicle);
    if (n !== undefined) return n;
    const p = v && v.controlBasePartialNetworks;
    if (p === 0 || p === 'KEINE_KOMMUNIKATION') return 1;
    return number(typeof p === 'string' ? p.replace(/^KOM_/, '') : p);
}

function within(p, ms, what) {
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => { logger.warn(what + ': no answer after ' + ms + ' ms, going on'); resolve(); }, ms); });
    return Promise.race([Promise.resolve(p), late])
        .catch((err) => logger.warn(what + ' failed: ' + (err && err.message)))
        .then((v) => { clearTimeout(timer); return v; });
}

/* the first folder of these that takes a write */
function settingsFile(name) {
    const dirs = [process.env.HOME, process.cwd(), os.tmpdir()];
    for (let i = 0; i < dirs.length; i++) {
        if (!dirs[i]) continue;
        const p = path.join(dirs[i], name);
        try { fs.appendFileSync(p, ''); return p; } catch (e) { /* next */ }
    }
    return null;
}

class SeatLightsApp extends OnlineApp {
    constructor() {
        super();
        this._state = null;
        this._comps = {};
        this._byId = {};
        this._written = {};
        this._lastPress = 0;
        this._visible = false;
        this._shutdown = null;
        this._opening = null;
        this._dirty = true;
        this._timers = [];
        this._gpu = null;
        this._ui = { rec: new ui.Recorder(), targets: [], focus: null, pressed: null, down: null, key: '', timer: null };

        this._file = settingsFile('seatlights.json');
        let saved = {};
        try { saved = JSON.parse(fs.readFileSync(this._file, 'utf8') || '{}') || {}; } catch (e) { /* first start */ }
        this._wantOn = saved.on === true;
        this._link = new SomeipLink(logger);
        this._uds = new Uds(this._link, logger);
        this._light = new SeatLight({ uds: this._uds, log: logger, layout: saved.layout, statusDid: saved.statusDid });
        this._watching = false;
        this._light.on('change', () => { this._dirty = true; });
        this._light.on('save', (st) => {
            try { if (this._file) fs.writeFileSync(this._file, JSON.stringify(st)); } catch (e) { logger.warn('not saved: ' + e.message); }
        });

        this.on('initialized', () => {
            this._init().catch((err) => logger.error('init failed: ' + (err && err.message)));
        });
        this.on('shutdown', (reason) => this._stop(reason));
        this.on('error', (err) => logger.warn('OnlineApp error: ' + (err && err.message)));
        this.on('entryPointExecute', (uuid) => this._open(uuid));
        this.on('changeVisibility', (data) => { if (data && data.visible === false) this._setVisible(false); });
    }

    _init() {
        logger.info('Seat Lights ' + this.getAppId() + ' starting; switch ' + (this._wantOn ? 'ON' : 'OFF') + ', settings ' + (this._file || 'not kept'));
        this._startLink();
        this._timers.push(setInterval(() => { if (this._dirty) this._render(); }, RENDER_MS));
        if (!this.rhmiApplication) {
            logger.info('no RhmiApplication for this start reason; running without a screen');
            return this.initialized();
        }
        const data = this.getVisibilityData && this.getVisibilityData();
        const reason = (data && data.reason) || this.startReason;
        const foreground = FOREGROUND_REASONS.indexOf(reason) >= 0;
        return this._setupRhmi()
            .then(() => this._startGpu())
            .then(() => this._pushRows())
            .then(() => this._registerEntryPoint()
                .catch((err) => logger.warn('entry point: ' + (err && err.message) + '; starting without it')))
            .then(() => {
                if (foreground) this.registerActive();
                return this.initialized();
            })
            .then(() => {
                if (foreground) this._setVisible(true);
                const last = this.getLastExecutedEntryPointUuid && this.getLastExecutedEntryPointUuid();
                return last ? this._open(last) : undefined;
            });
    }

    /* the diagnostic link; with the switch ON from the last drive, the logos go on as soon as it is there */
    _startLink() {
        const ready = () => { if (this._wantOn && !this._light.state.on) this._light.setOn(true); this._dirty = true; this._watchCar(); };
        this._uds.init().then(ready, () => {
            logger.warn('diagnostic link unavailable: ' + this._uds.error + ' (trying again)');
            const t = setInterval(() => {
                if (this._shutdown) { clearInterval(t); return; }
                if (this._link.proxies[TASU]) { clearInterval(t); this._uds.ready = true; ready(); }
            }, 5000);
            this._timers.push(t);
        });
    }

    /* the engine (CDS.statusEngineSpeed2: rpm x 4, 65535 none) and whether the car is locked (VehicleCondition: BMW's
     * vehicle state, parked = 1-3 means locked and left, as the MIT-licensed idrive7-apps kit reads it): locked with
     * the engine off bypasses the switch (seat_light.js car()) */
    _watchCar() {
        if (this._watching) return;
        this._watching = true;
        const engine = (v) => {
            const raw = v && v.actualValueRPMEngineCrankshaft;
            if (typeof raw !== 'number' || raw === 65535) return;
            const rpm = raw * 0.25;
            if (rpm >= 400) this._light.car({ engine: true });
            else if (rpm <= 50) this._light.car({ engine: false });
        };
        const seen = [];
        const condition = (v) => {
            const n = conditionOf(v);
            const raw = JSON.stringify(v && v.statusConditionVehicle !== undefined ? v.statusConditionVehicle : v && v.controlBasePartialNetworks);
            if (seen.length < 16 && seen.indexOf(raw) < 0) { seen.push(raw); logger.info('vehicle state ' + raw + (n === undefined ? ' (not known)' : ' = ' + n)); }
            this._light.car({ locked: n === undefined ? null : n <= 3 });
        };
        this._link.open('de.bmw.infotainment.vehicle.CDS', '1', { fields: { statusEngineSpeed2: engine } })
            .catch(() => null)
            .then(() => this._link.open('de.bmw.infrastructure.VehicleCondition', '1', { fields: { VehicleCondition: condition } }))
            .catch(() => logger.info('vehicle state not available: the switch is never bypassed'));
    }

    _toggle() {
        const now = Date.now();
        if (now - this._lastPress < 400) return;            // the same press by both paths
        this._lastPress = now;
        if (!this._uds.ready) {
            this._wantOn = !this._wantOn;
            logger.info('switch ' + (this._wantOn ? 'ON' : 'OFF') + ' before the diagnostic link is ready: applied once it is');
            const st = this._light.state;
            try { if (this._file) fs.writeFileSync(this._file, JSON.stringify({ on: this._wantOn, layout: st.layout, statusDid: this._light.statusDid })); } catch (e) { /* kept in memory */ }
            this._dirty = true;
            return;
        }
        this._wantOn = !this._light.state.on;
        this._light.setOn(this._wantOn);
        this._dirty = true;
    }

    _model() {
        const st = this._light.state;
        const on = this._uds.ready ? st.on : this._wantOn;
        return { on: on, holding: st.holding, bypassed: st.bypassed, note: this._uds.ready ? st.note : 'Waiting for the diagnostic link', warn: st.warn,
            output: st.output, layout: st.layout, focus: this._ui.focus, pressed: this._ui.pressed };
    }

    /* ---- the HMI ---- */
    _setupRhmi() {
        const rhmi = this.rhmiApplication;
        this._state = rhmi.getByName(STATE);
        if (!this._state) return Promise.reject(new Error('uiDescription has no ' + STATE));
        this._comps[STATUS] = rhmi.getByName(STATUS);
        const sw = rhmi.getByName(SWITCH);
        if (sw) {
            this._comps[SWITCH] = sw;
            try { this._byId[Number(sw.getId())] = SWITCH; } catch (e) { /* events from the component only */ }
            sw.on('action', () => this._toggle());
            sw.on('focus', (ev) => this._focus(SWITCH, isTrue(ev && ev.value)));
        }
        rhmi.on('userEvent', (ev) => {
            if (ev && ev.eventType === 'ACTION' && this._byId[Number(ev.sourceId)]) this._toggle();
            if (ev && ev.eventType === 'FOCUS' && this._byId[Number(ev.sourceId)]) this._focus(SWITCH, isTrue((ev.parameterMap || {})[VALUE_KEY]));
        });
        rhmi.on('applicationStackChanged', (stack) => {
            const keys = stack && typeof stack === 'object' ? Object.keys(stack) : [];
            if (keys.length) this._setVisible(Object.prototype.hasOwnProperty.call(stack, 'ROOT_APP'));
        });
        rhmi.on('restoreHmi', () => { this._written = {}; this._render(); });
        this._state.on('visible', (ev) => { if (ev && isTrue(ev.value)) this._setVisible(true); });
        return Promise.resolve();
    }

    _pushRows() {
        if (!this._state || !this._state.updateResources) return Promise.resolve();
        return within(this._state.updateResources(), 4000, 'screen resources').then(() => { this._written = {}; this._render(); });
    }

    _registerEntryPoint() {
        const descriptions = (this.appDescription && this.appDescription.application.entryPoints) || [];
        const ours = this.getEntryPoints().find((ep) => descriptions.some((d) => d.uuid === ep.getDescription().uuid));
        if (!ours) return Promise.reject(new Error('no entry point handed over by the manager'));
        const description = ours.getDescription();
        return ours.init()
            .then(() => this.rhmiApplication.mapEntryState(description.uuid, this._state))
            .then(() => ours.setAvailability('ENABLED'))
            .then(() => logger.info('entry point ' + description.name + ' ENABLED'));
    }

    _open(uuid, tries) {
        if (this._shutdown || !this.rhmiApplication || !uuid) return Promise.resolve();
        if (this._opening) return this._opening;
        if (tries === undefined) tries = 3;
        let again = false;
        this._opening = this._pushRows()
            .then(() => this.rhmiApplication.openEntryState(uuid))
            .then(() => { this._setVisible(true); this._written = {}; this._render(); })
            .catch((err) => {
                const text = String(err && err.message ? err.message : err) + ' ' + JSON.stringify(err || {});
                if (tries > 1 && /INVALID/.test(text)) again = true;
                else logger.warn('openEntryState failed: ' + text);
            })
            .then(() => {
                this._opening = null;
                if (again) setTimeout(() => this._open(uuid, tries - 1), 800);
            });
        return this._opening;
    }

    _setVisible(visible) {
        if (this._shutdown || this._visible === visible) return;
        this._visible = visible;
        this._syncGpu();
        if (visible) { this._written = {}; this._render(); }
        const reports = visible ? [this.registerActive(), this.registerHmiVisible()]
            : [this.unregisterHmiVisible(), this.registerInactive()];
        reports.forEach((r) => Promise.resolve(r).catch((err) => logger.warn('app status report failed: ' + (err && err.message))));
    }

    _set(name, cell, value) {
        const comp = this._comps[name];
        const key = name + '.' + cell;
        if (!comp || this._written[key] === value) return;
        this._written[key] = value;
        Promise.resolve(comp.setValue(0, cell, value, typeof value === 'boolean' ? 'Bool' : 'Text'))
            .catch((err) => logger.warn('render ' + key + ' failed: ' + (err && err.message)));
    }

    _render() {
        this._dirty = false;
        if (!this.rhmiApplication || !this._state) return;
        const m = this._model();
        this._set(STATUS, 'Text', m.note + '  |  lamp output ' + m.output + (m.layout !== null && m.layout !== undefined ? ', layout ' + (m.layout + 1) : ''));
        this._set(SWITCH, 'PrimaryText', 'Seat lights');
        this._set(SWITCH, 'FrequencyText', m.on ? (m.holding ? 'ON' : m.bypassed ? 'ON (off while locked)' : 'ON (starting)') : 'OFF');
        this._set(SWITCH, 'FrequencyVisible', true);
        Promise.resolve(this.rhmiApplication.flush && this.rhmiApplication.flush()).catch(() => { /* next render */ });
    }

    /* ---- the drawn screen ---- */
    _startGpu() {
        if (this._gpu) return;
        const gpu = new Gpu('ida_seatlights', logger);
        this._gpu = gpu;
        // the seat pictures (seat_images.js: premultiplied RGBA, deflated), uploaded the first time a frame draws one
        try {
            const pics = require('./seat_images.js');
            gpu.picture(ui.PIC.off, pics.w, pics.h, zlib.inflateSync(Buffer.from(pics.off, 'base64')));
            gpu.picture(ui.PIC.on, pics.w, pics.h, zlib.inflateSync(Buffer.from(pics.on, 'base64')));
        } catch (e) { logger.warn('seat pictures: ' + e.message); }
        gpu.on('ready', (scr, area) => {
            const a = area && area.w >= 1000 && area.h >= 400 ? area
                : scr.w === 2880 ? ID8_AREA : { x: 0, y: 0, w: scr.w, h: scr.h };
            gpu.place(ui.placement(a));
            this._ui.key = '';
            this._syncGpu();
        });
        gpu.on('touch', (phase, x, y) => this._touch(phase, x, y));
        gpu.on('closed', () => setTimeout(() => this._syncGpu(true), 700));
        gpu.on('lost', () => { this._ui.key = ''; });
        gpu.connect();
        this._ui.timer = setInterval(() => this._frame(), FRAME_MS);
    }

    _syncGpu(again) {
        const gpu = this._gpu;
        if (!gpu) return;
        const on = this._visible && gpu.ready && !this._shutdown;
        if (again && on) gpu.visible = false;
        gpu.show(on);
        if (on) { this._ui.key = ''; this._frame(); }
    }

    _frame() {
        const gpu = this._gpu, u = this._ui;
        if (!gpu || !gpu.ready || !gpu.visible) return;
        const m = this._model();
        const key = JSON.stringify(m);
        const now = Date.now();
        if (gpu.waiting && now - gpu.sentAt < 1000) return;
        if (key === u.key && now - gpu.sentAt < 1000) return;
        u.key = key;
        u.targets = ui.draw(u.rec, m).targets;
        gpu.claim([{ x: 0, y: 0, w: ui.W, h: ui.H }]);
        gpu.frame(u.rec);
    }

    _focus(name, on) {
        if (on) this._ui.focus = name;
        else if (this._ui.focus === name) this._ui.focus = null;
    }

    _touch(phase, x, y) {
        const u = this._ui, t = ui.hit(u.targets, x, y);
        if (phase === 1) { u.down = t ? t.key : null; u.pressed = u.down; return; }
        if (phase === 2) { if (!t || t.key !== u.down) u.pressed = null; return; }
        if (phase !== 3) return;
        const key = u.down;
        u.down = null;
        setTimeout(() => { if (!u.down) u.pressed = null; }, 150);
        if (t && t.key === key && key === SWITCH) this._toggle();
    }

    _stop(reason) {
        if (this._shutdown) return this._shutdown;
        logger.info('shutting down (' + reason + ')');
        this._timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
        clearInterval(this._ui.timer);
        if (this._gpu) this._gpu.close();
        this._shutdown = within(this._light.stop(), 2000, 'seat lights: hand back')
            .then(() => this._link.stop())
            .then(() => this.destroyBundles().catch((err) => logger.info('destroyBundles: ' + (err && err.message))))
            .then(() => process.exit(0));
        return this._shutdown;
    }
}

const app = new SeatLightsApp();
app.start().catch((err) => {
    logger.error('failed to start: ' + (err && err.message));
});
