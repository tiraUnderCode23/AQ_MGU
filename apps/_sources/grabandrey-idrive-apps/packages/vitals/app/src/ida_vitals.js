'use strict';
/*
 * Vitals: the iDrive 8 app (Apps menu tile) behind the Vitals cluster widget. It does two things:
 *
 *   - reads coolant, oil and tyre data from the car through BMW's SDK (car_data.js) and sends
 *     it to the widget service (packages/vitals/tool), which runs as root without the SDK;
 *   - shows its screen: drawn by the head unit's GPU renderer (ui.js, gpu.js) over the HMI page when
 *     MGU Store's renderer is installed, with the live values and the settings as tiles (touch, or the
 *     controller: the HMI's own list underneath keeps the focus and its focused row lights the tile);
 *     otherwise the HMI's own list: a status line, then a row per setting, pressing a row changes it.
 *
 * Built on the head unit by MGU Store against the car's own oap-sdk (mgu-app.json).
 */
const OnlineApp = require('oap-sdk/src/core/OnlineApp.js');
const logging = require('oap-sdk/src/logging/logging');
const { CtlClient } = require('./ctl_client.js');
const { CarData } = require('./car_data.js');
const model = require('./settings_model.js');
const { Gpu } = require('./gpu.js');
const ui = require('./ui.js');

const logger = logging.getSDKLogger();

/* p, or nothing after ms: a call the HMI never answers must not hold up the start */
function within(p, ms, what) {
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => { logger.warn(what + ': no answer after ' + ms + ' ms, going on'); resolve(); }, ms); });
    return Promise.race([Promise.resolve(p), late])
        .catch((err) => logger.warn(what + ' failed: ' + (err && err.message)))
        .then((v) => { clearTimeout(timer); return v; });
}

const STATE = 'ST_OnlineApps_Vitals';
const STATUS = 'vtStatus';
const ROW_KEY = 2;                  // a press's row in a raw userEvent's parameterMap
const SEND_MS = 500;                // car data to the widget at most this often
const VALUE_KEY = 0;                // a focus event's value in a raw userEvent's parameterMap
const FRAME_MS = 100;               // the drawn screen: looked at this often, sent when it changed (or each second)
const ID8_AREA = { x: 0, y: 76, w: 2880, h: 764 };     // the app area under iDrive 8's status bar
const isTrue = (v) => v === true || v === 1 || v === 'true' || v === '1';
const FOREGROUND_REASONS = ['ENTRY_POINT', 'LUM', 'BOOKMARK', 'START_WIDGET', 'TRIGGER_HMI', 'SPEECH_COMMAND'];

class Vitals extends OnlineApp {
    constructor() {
        super();
        this._state = null;
        this._comps = {};
        this._byId = {};
        this._written = {};
        this._lastPress = {};
        this._reply = null;
        this._connected = false;
        this._visible = false;
        this._shutdown = null;
        this._pending = {};
        this._sendTimer = null;
        this._opening = null;
        this._gpu = null;
        this._ui = { rec: new ui.Recorder(), targets: [], focus: null, pressed: null, down: null, key: '', timer: null };
        this._ctl = new CtlClient();
        this._car = new CarData(logger);

        this._ctl.on('up', () => { this._connected = true; logger.info('connected to the widget'); this._flushData(true); this._render(); });
        this._ctl.on('down', () => { this._connected = false; this._reply = null; logger.info('widget service not reachable'); this._render(); });
        this._ctl.on('state', (reply) => { this._reply = reply; this._render(); });
        this._ctl.on('refused', (why) => logger.warn('widget refused: ' + why));
        this._car.on('data', (d) => this._queueData(d));

        this.on('initialized', () => {
            this._init().catch((err) => logger.error('init failed: ' + (err && err.message)));
        });
        this.on('shutdown', (reason) => this._stop(reason));
        this.on('error', (err) => logger.warn('OnlineApp error: ' + (err && err.message)));
        this.on('entryPointExecute', (uuid) => this._open(uuid));
        this.on('changeVisibility', (data) => { if (data && data.visible === false) this._setVisible(false); });
    }

    _init() {
        logger.info('Vitals ' + this.getAppId() + ' starting');
        this._ctl.connect();
        this._car.start();                          // the data runs with or without the screen
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

    /* ---- car data -> the widget ---- */
    _queueData(d) {
        Object.keys(d).forEach((k) => { this._pending[k] = d[k]; });
        if (!this._sendTimer) this._sendTimer = setTimeout(() => { this._sendTimer = null; this._flushData(false); }, SEND_MS);
    }
    _flushData(all) {
        if (all) Object.assign(this._pending, this._last || {});
        if (!Object.keys(this._pending).length) return;
        this._last = Object.assign(this._last || {}, this._pending);
        if (this._ctl.request({ op: 'data', data: this._pending })) {
            this._pending = {};
            // the status line says whether data arrives: ask again while the screen shows it
            const st = this._reply && this._reply.status;
            if (this._visible && (!st || !st.engine || !st.gearbox || !st.tyres)) this._ctl.request({ op: 'get' });
        }
    }

    /* ---- the settings screen ---- */
    _setupRhmi() {
        const rhmi = this.rhmiApplication;
        this._state = rhmi.getByName(STATE);
        if (!this._state) return Promise.reject(new Error('uiDescription has no ' + STATE));
        this._comps[STATUS] = rhmi.getByName(STATUS);
        model.ROWS.forEach((row) => {
            const comp = rhmi.getByName(row.name);
            if (!comp) { logger.warn('uiDescription has no ' + row.name); return; }
            this._comps[row.name] = comp;
            try { this._byId[Number(comp.getId())] = row; } catch (e) { /* events from the component only */ }
            comp.on('action', () => this._press(row));
            comp.on('focus', (ev) => this._focus(row.name, isTrue(ev && ev.value)));
        });
        // presses can also arrive as the application's raw userEvent; _press keeps one of a pair
        rhmi.on('userEvent', (ev) => {
            const row = ev && ev.eventType === 'ACTION' && this._byId[Number(ev.sourceId)];
            if (row) this._press(row, Number((ev.parameterMap || {})[ROW_KEY]) || 0);
            const frow = ev && ev.eventType === 'FOCUS' && this._byId[Number(ev.sourceId)];
            if (frow) this._focus(frow.name, isTrue((ev.parameterMap || {})[VALUE_KEY]));
        });
        rhmi.on('applicationStackChanged', (stack) => {
            const keys = stack && typeof stack === 'object' ? Object.keys(stack) : [];
            if (keys.length) this._setVisible(Object.prototype.hasOwnProperty.call(stack, 'ROOT_APP'));
        });
        rhmi.on('restoreHmi', () => { this._written = {}; this._render(); });
        this._state.on('visible', (ev) => {
            const v = ev && (ev.value === true || ev.value === 1 || ev.value === 'true');
            if (v) this._setVisible(true);
        });
        return Promise.resolve();
    }

    /* The HMI has no rows for a state until the app pushes them (BMW's apps do it with updateResources
     * before opening a state): without this the screen opened empty. Then every cell is written again. */
    _pushRows() {
        if (!this._state || !this._state.updateResources) return Promise.resolve();
        return within(this._state.updateResources(), 4000, 'screen resources').then(() => {
            this._written = {};
            this._render();
        });
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

    /* tries: right after a tap started the app, the HMI can still refuse the state (INVALID_UUID /
     * INVALID_COMPONENTID); it is asked again 0.8 s later rather than needing a second tap */
    _open(uuid, tries) {
        if (this._shutdown || !this.rhmiApplication || !uuid) return Promise.resolve();
        if (this._opening) return this._opening;            // the manager can send one tap twice
        if (tries === undefined) tries = 3;
        let again = false;
        this._opening = this._pushRows()
            .then(() => this.rhmiApplication.openEntryState(uuid))
            .then(() => {
                this._setVisible(true);
                this._written = {};
                this._render();
            })
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
        if (visible) {
            this._written = {};
            this._ctl.request({ op: 'get' });
            this._ctl.watch(2000);          // the status line, while the screen is up
            this._render();
        } else this._ctl.watch(0);
        const reports = visible ? [this.registerActive(), this.registerHmiVisible()]
            : [this.unregisterHmiVisible(), this.registerInactive()];
        reports.forEach((r) => Promise.resolve(r).catch((err) => logger.warn('app status report failed: ' + (err && err.message))));
    }

    /* ---- the drawn screen ---- */
    _startGpu() {
        if (this._gpu) return;
        const gpu = new Gpu('ida_vitals', logger);
        this._gpu = gpu;
        gpu.on('ready', (screen, area) => {
            const a = area && area.w >= 1000 && area.h >= 400 ? area
                : screen.w === 2880 ? ID8_AREA : { x: 0, y: 0, w: screen.w, h: screen.h };
            gpu.place(ui.placement(a));
            this._ui.key = '';
            this._syncGpu();
        });
        gpu.on('touch', (phase, x, y) => this._touch(phase, x, y));
        // a touch outside our area went to the HMI and the renderer hid us: shown again if the page still is
        gpu.on('closed', () => setTimeout(() => this._syncGpu(true), 700));
        gpu.on('lost', () => { this._ui.key = ''; });
        gpu.connect();
        this._ui.timer = setInterval(() => this._frame(), FRAME_MS);
    }

    _syncGpu(again) {
        const gpu = this._gpu;
        if (!gpu) return;
        const on = this._visible && gpu.ready && !this._shutdown;
        if (again && on) gpu.visible = false;       // the renderer hid us itself: ask again
        gpu.show(on);
        if (on) { this._ui.key = ''; this._frame(); }
    }

    _frame() {
        const gpu = this._gpu, u = this._ui;
        if (!gpu || !gpu.ready || !gpu.visible) return;
        const m = {
            settings: this._reply && this._reply.settings, status: this._reply && this._reply.status, connected: this._connected,
            data: this._last || {}, rows: model.ROWS, focus: u.focus, pressed: u.pressed, gearboxInfo: this._car.gearboxText(),
        };
        const key = JSON.stringify([m.settings, m.status, m.connected, m.data, m.focus, m.pressed, m.gearboxInfo]);
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
        if (!t || t.key !== key) return;
        const row = model.ROWS.find((r) => r.name === key);
        if (row) this._press(row);
    }

    _press(row) {
        const now = Date.now();
        if (now - (this._lastPress[row.name] || 0) < 250) return;     // the same press by both paths
        this._lastPress[row.name] = now;
        if (!this._reply || !this._reply.settings) { logger.info('press ' + row.name + ' ignored: no widget service'); return; }
        const change = row.press(this._reply.settings);
        logger.info('press ' + row.name + ' -> ' + JSON.stringify(change));
        if (change === 'reset') this._ctl.request({ op: 'reset' });
        else {
            this._ctl.request({ op: 'set', settings: change });
            Object.assign(this._reply.settings, change);      // shown at once; the service's answer follows
            this._render();
        }
    }

    /* writes a cell only when its value changed */
    _set(name, cell, value, type) {
        const comp = this._comps[name];
        const key = name + '.' + cell;
        if (!comp || this._written[key] === value) return;
        this._written[key] = value;
        Promise.resolve(comp.setValue(0, cell, value, type))
            .catch((err) => logger.warn('render ' + key + ' failed: ' + (err && err.message)));
    }

    _render() {
        if (!this.rhmiApplication || !this._state) return;
        const st = this._reply && this._reply.status;
        const gearbox = st && !st.gearbox && !(this._reply.settings && this._reply.settings.demo) ? '  |  ' + this._car.gearboxText() : '';
        this._set(STATUS, 'Text', model.statusText(this._reply, this._connected, this._car.available) + gearbox, 'Text');
        const s = this._reply && this._reply.settings;
        model.ROWS.forEach((row) => {
            this._set(row.name, 'PrimaryText', row.label, 'Text');
            const v = s ? row.value(s) : '';
            this._set(row.name, 'FrequencyText', v, 'Text');
            this._set(row.name, 'FrequencyVisible', !!v, 'Bool');
        });
        Promise.resolve(this.rhmiApplication.flush && this.rhmiApplication.flush()).catch(() => { /* next render */ });
    }

    _stop(reason) {
        if (this._shutdown) return this._shutdown;
        logger.info('shutting down (' + reason + ')');
        this._car.stop();
        this._ctl.close();
        clearInterval(this._ui.timer);
        if (this._gpu) this._gpu.close();
        this._shutdown = Promise.resolve()
            .then(() => this.destroyBundles().catch((err) => logger.info('destroyBundles: ' + (err && err.message))))
            .then(() => process.exit(0));
        return this._shutdown;
    }
}

const app = new Vitals();
app.start().catch((err) => {
    // stays up so the manager can stop or restart it
    logger.error('failed to start: ' + (err && err.message));
});
