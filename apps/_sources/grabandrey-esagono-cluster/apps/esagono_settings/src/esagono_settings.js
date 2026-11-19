'use strict';
/*
 * Esagono Settings: the iDrive 8 app (Apps menu tile) that sets up the Esagono cluster
 * widget. One native list screen (rhmiData/uiDescriptions/ID8): a status line, then a
 * row per setting showing its value on the right; pressing a row cycles it. Changes go
 * to the esagono-cluster service over its control socket and show on the cluster at once.
 *
 * Built on the head unit by MGU Store against the car's own oap-sdk (mgu-app.json).
 */
const OnlineApp = require('oap-sdk/src/core/OnlineApp.js');
const logging = require('oap-sdk/src/logging/logging');
const { CtlClient } = require('./ctl_client.js');
const model = require('./settings_model.js');

const logger = logging.getSDKLogger();

const STATE = 'ST_OnlineApps_Esagono';
const STATUS = 'esgStatus';
const ROW_KEY = 2;                  // a press's row in a raw userEvent's parameterMap
const FOREGROUND_REASONS = ['ENTRY_POINT', 'LUM', 'BOOKMARK', 'START_WIDGET', 'TRIGGER_HMI', 'SPEECH_COMMAND'];

class EsagonoSettings extends OnlineApp {
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
        this._ctl = new CtlClient();

        this._ctl.on('up', () => { this._connected = true; logger.info('connected to the Esagono service'); this._render(); });
        this._ctl.on('down', () => { this._connected = false; this._reply = null; logger.info('Esagono service not reachable'); this._render(); });
        this._ctl.on('state', (reply) => { this._reply = reply; this._render(); });
        this._ctl.on('refused', (why) => logger.warn('service refused: ' + why));

        this.on('initialized', () => {
            this._init().catch((err) => logger.error('init failed: ' + (err && err.message)));
        });
        this.on('shutdown', (reason) => this._stop(reason));
        this.on('error', (err) => logger.warn('OnlineApp error: ' + (err && err.message)));
        this.on('entryPointExecute', (uuid) => this._open(uuid));
        this.on('changeVisibility', (data) => { if (data && data.visible === false) this._setVisible(false); });
    }

    _init() {
        logger.info('Esagono Settings ' + this.getAppId() + ' starting');
        this._ctl.connect();
        if (!this.rhmiApplication) {
            logger.info('no RhmiApplication for this start reason; running without a screen');
            return this.initialized();
        }
        const data = this.getVisibilityData && this.getVisibilityData();
        const reason = (data && data.reason) || this.startReason;
        const foreground = FOREGROUND_REASONS.indexOf(reason) >= 0;
        return this._setupRhmi()
            .then(() => this._registerEntryPoint())
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
        });
        // presses can also arrive as the application's raw userEvent; _press keeps one of a pair
        rhmi.on('userEvent', (ev) => {
            const row = ev && ev.eventType === 'ACTION' && this._byId[Number(ev.sourceId)];
            if (row) this._press(row, Number((ev.parameterMap || {})[ROW_KEY]) || 0);
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

    _open(uuid) {
        if (this._shutdown || !this.rhmiApplication || !uuid) return Promise.resolve();
        this._setVisible(true);
        return Promise.resolve(this.rhmiApplication.openEntryState(uuid))
            .catch((err) => logger.warn('openEntryState failed: ' + (err && err.message)));
    }

    _setVisible(visible) {
        if (this._shutdown || this._visible === visible) return;
        this._visible = visible;
        if (visible) {
            this._written = {};
            this._ctl.request({ op: 'get' });
            this._ctl.watch(1000);          // the status line's live rpm while the screen is up
            this._render();
        } else this._ctl.watch(0);
        const reports = visible ? [this.registerActive(), this.registerHmiVisible()]
            : [this.unregisterHmiVisible(), this.registerInactive()];
        reports.forEach((r) => Promise.resolve(r).catch((err) => logger.warn('app status report failed: ' + (err && err.message))));
    }

    _press(row) {
        const now = Date.now();
        if (now - (this._lastPress[row.name] || 0) < 400) return;     // the same press by both paths
        this._lastPress[row.name] = now;
        if (!this._reply || !this._reply.settings) { logger.info('press ' + row.name + ' ignored: no service'); return; }
        const change = row.press(this._reply.settings);
        logger.info('press ' + row.name + ' -> ' + JSON.stringify(change));
        if (change === 'reset') this._ctl.request({ op: 'reset' });
        else this._ctl.request({ op: 'set', settings: change });
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
        this._set(STATUS, 'Text', model.statusText(this._reply, this._connected), 'Text');
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
        this._ctl.close();
        this._shutdown = Promise.resolve()
            .then(() => this.destroyBundles().catch((err) => logger.info('destroyBundles: ' + (err && err.message))))
            .then(() => process.exit(0));
        return this._shutdown;
    }
}

const app = new EsagonoSettings();
app.start().catch((err) => {
    // stays up so the manager can stop or restart it
    logger.error('failed to start: ' + (err && err.message));
});
