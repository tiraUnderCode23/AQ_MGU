'use strict';
/*
 * Light Logger: an iDrive 8 app that watches the car's interior light modules and logs every change, to find out
 * what switches the seat (headrest) logos off and when.
 *
 *   - every POLL_MS it reads both LIN buses of the body controller (BDC 0x40, 22 DA5F / 22 E3D1) through the head
 *     unit's diagnostic link (uds.js): which light modules there are, and each one's state (lin.js);
 *   - it follows the engine (CDS.statusEngineSpeed2) and the car's speed (Vehicle2.statusCarSpeed2);
 *   - each change is an event (journal.js), shown on the screen, written to the app's log (LTLG) and to a text file;
 *   - its screen shows only what may be the seat logos (journal.relevant()) and their log: drawn by the head unit's
 *     renderer (ui.js, gpu.js) when MGU Store's Renderer is installed (touch, or the controller through the HMI
 *     list underneath), else the HMI's own list (screen_model.js). A light can be pinned as a logo (touch); pins
 *     are kept in lightlog-pins.json next to the log file.
 *
 * Keep on (keeper.js, off until the driver switches it on): holds the pinned lamp output on through the body
 * controller, so the logos stay lit with the car on. The only requests that change anything; uds.js allows them
 * for that one output only.
 *
 * It starts with the head unit (package.json mguAppStartType autostart), so the welcome light at unlocking is in the
 * log before anyone opens it.
 *
 * READ ONLY: it sends nothing but ReadDataByIdentifier requests (uds.check()). It changes nothing on the car.
 * Built on the head unit by MGU Store against the car's own oap-sdk (mgu-app.json).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const OnlineApp = require('oap-sdk/src/core/OnlineApp.js');
const logging = require('oap-sdk/src/logging/logging');
const { SomeipLink } = require('./someip_link.js');
const { Uds, IFACE: TASU } = require('./uds.js');
const lin = require('./lin.js');
const { Journal, SOURCES, line } = require('./journal.js');
const { LogFile } = require('./log_file.js');
const screen = require('./screen_model.js');
const lamps = require('./lamps.js');
const { Finder } = require('./finder.js');
const { Keeper } = require('./keeper.js');
const { Gpu } = require('./gpu.js');
const ui = require('./ui.js');

const logger = logging.getSDKLogger();

const STATE = 'ST_OnlineApps_LightLog';
const STATUS = 'llStatus';
const POLL_MS = 4000;               // between two rounds of reads
const SLOW_MS = 20000;              // between rounds while the body controller doesn't answer
const REFUSED_MS = 60000;           // a bus whose read was refused is asked again after this
const RENDER_MS = 1000;
const FRAME_MS = 100;               // the drawn screen: looked at this often, sent when it changed (or each second)
const ID8_AREA = { x: 0, y: 76, w: 2880, h: 764 };     // the app area under iDrive 8's status bar
const VALUE_KEY = 0;                // a focus event's value in a raw userEvent's parameterMap
const FOREGROUND_REASONS = ['ENTRY_POINT', 'LUM', 'BOOKMARK', 'START_WIDGET', 'TRIGGER_HMI', 'SPEECH_COMMAND'];
const isTrue = (v) => v === true || v === 1 || v === 'true' || v === '1';

function within(p, ms, what) {
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => { logger.warn(what + ': no answer after ' + ms + ' ms, going on'); resolve(); }, ms); });
    return Promise.race([Promise.resolve(p), late])
        .catch((err) => logger.warn(what + ' failed: ' + (err && err.message)))
        .then((v) => { clearTimeout(timer); return v; });
}

class LightLog extends OnlineApp {
    constructor() {
        super();
        this._state = null;
        this._comps = {};
        this._byId = {};
        this._written = {};
        this._lastPress = {};
        this._visible = false;
        this._shutdown = null;
        this._view = 'seat';
        this._gpu = null;
        this._ui = { rec: new ui.Recorder(), targets: [], focus: null, pressed: null, down: null, key: '', timer: null };
        this._opening = null;
        this._dirty = true;
        this._timers = [];
        this._pollTimer = null;
        this._polling = false;
        this._buses = SOURCES.map(() => ({ reads: 0, modules: null, on: 0, refused: null, refusedAt: 0, raw: '' }));
        this._lampDid = null;
        this._page = 0;

        this._journal = new Journal();
        this._file = new LogFile([process.env.HOME, process.cwd(), os.tmpdir()], 'lightlog.txt');
        this._pinsFile = this._file.path ? path.join(path.dirname(this._file.path), 'lightlog-pins.json') : null;
        try { if (this._pinsFile) this._journal.setPins(JSON.parse(fs.readFileSync(this._pinsFile, 'utf8'))); } catch (e) { /* none yet */ }
        this._journal.on('pins', (keys) => {
            try { if (this._pinsFile) fs.writeFileSync(this._pinsFile, JSON.stringify(keys)); } catch (e) { logger.warn('pins not saved: ' + e.message); }
        });
        this._link = new SomeipLink(logger);
        this._uds = new Uds(this._link, logger);
        const findFile = this._file.path ? path.join(path.dirname(this._file.path), 'lightlog-find.json') : null;
        this._finder = new Finder({ uds: this._uds, log: logger, store: {
            load: () => { try { return findFile ? JSON.parse(fs.readFileSync(findFile, 'utf8')) : null; } catch (e) { return null; } },
            save: (o) => { try { if (findFile) fs.writeFileSync(findFile, JSON.stringify(o)); } catch (e) { logger.warn('finder not saved: ' + e.message); } },
        } });
        this._finder.on('change', () => { this._dirty = true; });
        this._keepFile = this._file.path ? path.join(path.dirname(this._file.path), 'lightlog-keep.json') : null;
        let kept = {};
        try { if (this._keepFile) kept = JSON.parse(fs.readFileSync(this._keepFile, 'utf8')) || {}; } catch (e) { /* off */ }
        this._keeper = new Keeper({ uds: this._uds, log: logger, format: kept.format,
            readStatus: () => (this._lampDid ? this._uds.read(lamps.BDC, this._lampDid, 8000) : Promise.resolve(null)) });
        this._keeper.enabled = kept.enabled === true;
        this._keeper.on('note', (text) => this._journal.note('KEEP ' + text));
        this._keeper.on('change', () => { this._dirty = true; });
        this._keeper.on('format', () => this._saveKeep());
        this._journal.on('event', (e) => {
            const text = line(e);
            logger.info('LIGHT ' + text);
            this._file.write(new Date(e.t).toISOString().slice(0, 10) + ' ' + text);
            this._dirty = true;
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
        logger.info('Light Logger ' + this.getAppId() + ' starting; log file ' + (this._file.path || 'none (' + this._file.error + ')'));
        this._journal.note('Light Logger started' + (this._file.path ? ', writing ' + this._file.path : ''));
        this._startCar();
        this._timers.push(setInterval(() => { if (this._dirty) this._render(); }, RENDER_MS));
        if (!this.rhmiApplication) {
            logger.info('no RhmiApplication for this start reason; logging without a screen');
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

    /* ---- the car ---- */
    _startCar() {
        // one after another: the SDK's native binding wants one proxy at a time
        this._uds.init()
            .then(() => this._poll(), () => this._journal.note('diagnostic link unavailable: ' + this._uds.error + ' (trying again)'))
            .then(() => this._link.open('de.bmw.infotainment.vehicle.CDS', '1', { fields: { statusEngineSpeed2: (v) => this._journal.rpm(v) } }))
            .catch(() => null)
            .then(() => this._link.open('de.bmw.infotainment.vehicle.Vehicle2', '1', { fields: { statusCarSpeed2: (v) => this._journal.speed(v) } }))
            .catch(() => null)
            .then(() => { if (!this._uds.ready) this._retryLink(); });
    }

    /* the diagnostic link's interface came up late: link.open() retries it by itself; poll once it is there */
    _retryLink() {
        const t = setInterval(() => {
            if (this._shutdown) { clearInterval(t); return; }
            if (this._link.proxies[TASU]) {
                clearInterval(t);
                this._uds.ready = true;
                this._journal.note('diagnostic link ready');
                this._poll();
            }
        }, 5000);
        this._timers.push(t);
    }

    /* one round, one read after another: both LIN buses, the lamp outputs, the pinned values; then the next round.
     * While the finder learns or takes a snapshot, the rounds wait: the link takes one request at a time. */
    _poll() {
        if (this._shutdown || this._polling) return Promise.resolve();
        clearTimeout(this._pollTimer);
        if (this._finder.phase !== 'idle') { this._pollTimer = setTimeout(() => this._poll(), 2000); return Promise.resolve(); }
        this._polling = true;
        let answered = 0;
        const read = (i, did, parse) => {
            const st = this._buses[i], name = SOURCES[i];
            if (st.refused && Date.now() - st.refusedAt < REFUSED_MS) return Promise.resolve(false);
            st.reads++;
            return this._uds.read(lin.BDC, did).then((u) => {
                if (u && u[0] === 0x7f) {
                    const why = 'NRC 0x' + lin.hex(u[2]);
                    if (st.refused !== why) this._journal.note(name + ': the body controller refuses the read (' + why + ')');
                    st.refused = why; st.refusedAt = Date.now();
                    return false;
                }
                st.refused = null;
                const mods = u ? parse(u) : null;
                if (mods) {
                    answered++;
                    const raw = lin.hexBytes(u);
                    if (raw !== st.raw) { st.raw = raw; logger.info(name + ' raw ' + raw); }
                    st.modules = mods.length; st.on = mods.filter((m) => m.on).length;
                }
                this._journal.lights(i, mods);
                return !!mods;
            }, (e) => {
                logger.warn(name + ' read failed: ' + (e && e.message));
                this._journal.lights(i, null);
                return false;
            });
        };
        /* the lamp outputs: the identifier that answered before, else each in turn */
        const readLamps = () => {
            const st = this._buses[2];
            if (st.refused && Date.now() - st.refusedAt < REFUSED_MS) return Promise.resolve();
            const order = this._lampDid === null ? lamps.DIDS : [this._lampDid];
            return order.reduce((p, did) => p.then((ok) => {
                if (ok) return true;
                st.refused = null;
                return read(2, did, (u) => lamps.parse(u, did)).then((got) => { if (got) this._lampDid = did; return got; });
            }), Promise.resolve(false)).then((ok) => { if (!ok && this._lampDid) this._lampDid = null; });
        };
        /* the finder's values pinned as logos, each read alone */
        const readPinned = () => {
            const keys = this._journal.pinnedValues();
            if (!keys.length) return Promise.resolve();
            const mods = [];
            return keys.reduce((p, key, n) => p.then(() => {
                const m = /^d:([0-9A-F]{2}):([0-9A-F]{4})$/.exec(key);
                const ecu = parseInt(m[1], 16), did = parseInt(m[2], 16);
                return this._uds.read(ecu, [did >> 8, did & 255], 8000).then((u) => {
                    if (u && u[0] === 0x62) mods.push(lamps.valueModule(ecu, did, u.slice(3), null, n + 1));
                }, () => null);
            }), Promise.resolve()).then(() => { this._journal.lights(3, mods.length ? mods : null); });
        };
        return read(0, lin.readRequest(0), (u) => lin.parseStatus(0, u))
            .then(() => read(1, lin.readRequest(1), (u) => lin.parseStatus(1, u)))
            .then(readLamps).then(readPinned).then(() => this._keep()).catch((e) => logger.warn('round: ' + (e && e.message)))
            .then(() => {
                this._polling = false;
                this._dirty = true;
                if (!this._shutdown) this._pollTimer = setTimeout(() => this._poll(), answered ? POLL_MS : SLOW_MS);
            });
    }

    /* ---- keep on ---- */
    /* the pinned lamp output (the first, if several) */
    _keepOutput() {
        const k = Array.from(this._journal.pins).find((x) => /^2:\d+$/.test(x));
        return k ? Number(k.slice(2)) : null;
    }

    /* each round: which output, the car's state, the output's latest value */
    _keep() {
        const out = this._keepOutput();
        this._keeper.target({ output: out, statusDid: this._lampDid });
        this._keeper.update({ engine: this._journal.engine });
        const m = out === null ? null : this._journal.modules().find((x) => x.key === '2:' + out);
        if (m) this._keeper.observe(m.value);
    }

    _keepPress(what) {
        const k = this._keeper;
        if (this._keepOutput() === null) { this._journal.note('KEEP pin the logos\' lamp output first (under All, tap its pin)'); return; }
        this._keep();
        if (what === 'test') { k.test(); return; }
        k.setEnabled(!k.enabled);
        this._saveKeep();
        this._keep();
    }

    _saveKeep() {
        const k = this._keeper;
        try { if (this._keepFile) fs.writeFileSync(this._keepFile, JSON.stringify({ enabled: k.enabled, format: k.format })); } catch (e) { logger.warn('keep not saved: ' + e.message); }
    }

    /* ---- the finder ---- */
    _find(what) {
        const f = this._finder;
        if (f.phase !== 'idle') { this._journal.note('finder busy (' + f.phase + '), press again when it is done'); return; }
        if (what === 'learn') {
            this._journal.note('finder: learning what the body controller and the seat modules report (a few minutes a unit; keep the car on)');
            f.learn().then(() => {
                const st = f.state;
                this._journal.note('finder: ' + (st.units.length ? st.units.map((u) => u.name + ' ' + u.values + ' values' + (u.done ? '' : ' (not finished)')).join(', ') : 'no unit answered'));
            });
            return;
        }
        if (!f.state.learnedAll) { this._journal.note('finder: press Learn first'); return; }
        this._journal.note('finder: snapshot with the logos ' + what.toUpperCase());
        f.snapshot(what).then((snap) => {
            if (!snap) return;
            const c = f.candidates(), st = f.state;
            this._journal.note('finder: ' + Object.keys(snap.values).length + ' values read; logos ON x' + st.counts.on + ', OFF x' + st.counts.off +
                (st.counts.on && st.counts.off ? ': ' + c.length + ' follow the logos' : ''));
            c.slice(0, 60).forEach((x) => this._file.write('    candidate ' + lamps.unitName(x.unit) + ' 0x' + lamps.hex(x.did, 4) + '  ON ' + x.on + '  OFF ' + x.off));
        });
    }

    /* ---- the screen ---- */
    _setupRhmi() {
        const rhmi = this.rhmiApplication;
        this._state = rhmi.getByName(STATE);
        if (!this._state) return Promise.reject(new Error('uiDescription has no ' + STATE));
        this._comps[STATUS] = rhmi.getByName(STATUS);
        screen.LINE_IDS.forEach((l) => { this._comps[l.name] = rhmi.getByName(l.name); });
        screen.BUTTONS.forEach((b) => {
            const comp = rhmi.getByName(b.name);
            if (!comp) { logger.warn('uiDescription has no ' + b.name); return; }
            this._comps[b.name] = comp;
            try { this._byId[Number(comp.getId())] = b; } catch (e) { /* events from the component only */ }
            comp.on('action', () => this._press(b));
            comp.on('focus', (ev) => this._focus(b.name, isTrue(ev && ev.value)));
        });
        rhmi.on('userEvent', (ev) => {
            const b = ev && ev.eventType === 'ACTION' && this._byId[Number(ev.sourceId)];
            if (b) this._press(b);
            const f = ev && ev.eventType === 'FOCUS' && this._byId[Number(ev.sourceId)];
            if (f) this._focus(f.name, isTrue((ev.parameterMap || {})[VALUE_KEY]));
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

    /* ---- the drawn screen ---- */
    _startGpu() {
        if (this._gpu) return;
        const gpu = new Gpu('ida_lightlog', logger);
        this._gpu = gpu;
        gpu.on('ready', (scr, area) => {
            const a = area && area.w >= 1000 && area.h >= 400 ? area
                : scr.w === 2880 ? ID8_AREA : { x: 0, y: 0, w: scr.w, h: scr.h };
            gpu.place(ui.placement(a));
            this._ui.key = '';
            if (this._view === 'log') this._view = 'seat';     // the drawn screen shows the log beside the lights
            this._syncGpu();
        });
        gpu.on('touch', (phase, x, y) => this._touch(phase, x, y));
        gpu.on('closed', () => setTimeout(() => this._syncGpu(true), 700));
        gpu.on('lost', () => { this._ui.key = ''; });
        gpu.connect();
        this._ui.timer = setInterval(() => this._frame(), FRAME_MS);
    }

    _drawn() { return !!(this._gpu && this._gpu.ready); }

    _syncGpu(again) {
        const gpu = this._gpu;
        if (!gpu) return;
        const on = this._visible && gpu.ready && !this._shutdown;
        if (again && on) gpu.visible = false;
        gpu.show(on);
        if (on) { this._ui.key = ''; this._frame(); }
    }

    _statusData() {
        const j = this._journal;
        return { linkReady: this._uds.ready, linkError: this._uds.error, buses: this._buses, engine: j.engine, kmh: j.kmh, file: this._file.path,
            keep: Object.assign(this._keeper.state, { output: this._keepOutput() }) };
    }

    _frame() {
        const gpu = this._gpu, u = this._ui;
        if (!gpu || !gpu.ready || !gpu.visible) return;
        const m = screen.drawModel(this._journal, this._statusData(), this._view, u.focus, u.pressed, this._finder, this._page);
        const key = JSON.stringify([m.status, m.view, m.seat, m.all.length, m.log.length && m.log[0], m.log.length, m.pins, m.marks, m.focus, m.pressed, m.find, m.page]);
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
        if (key.indexOf('pin:') === 0) { this._journal.togglePin(key.slice(4)); this._dirty = true; return; }
        if (key.indexOf('view:') === 0) { this._view = key.slice(5); this._page = 0; this._dirty = true; return; }
        if (key === 'page:next') { this._page++; return; }
        if (key === 'page:prev') { this._page = Math.max(0, this._page - 1); return; }
        const b = screen.BUTTONS.find((x) => x.name === key);
        if (b) this._press(b);
    }

    _press(b) {
        const now = Date.now();
        if (now - (this._lastPress[b.name] || 0) < 250) return;     // the same press by both paths
        this._lastPress[b.name] = now;
        if (b.name === 'llMark') this._journal.mark();
        else if (b.name === 'llRead') { this._journal.note('read asked for on the screen'); this._poll(); }
        else if (b.name === 'llView') this._view = this._drawn() ? screen.nextDrawnView(this._view) : screen.nextView(this._view);
        else if (b.name === 'llKeepTest') this._keepPress('test');
        else if (b.name === 'llKeep') this._keepPress('toggle');
        else if (b.name === 'llLearn') { this._view = 'find'; this._find('learn'); }
        else if (b.name === 'llSnapOn') { this._view = 'find'; this._find('on'); }
        else if (b.name === 'llSnapOff') { this._view = 'find'; this._find('off'); }
        else if (b.name === 'llClear') { this._journal.clear(); this._file.write('---- screen log cleared ----'); }
        this._dirty = true;
        this._render();
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
        const j = this._journal;
        this._set(STATUS, 'Text', screen.status(this._statusData()));
        screen.BUTTONS.forEach((b) => {
            this._set(b.name, 'PrimaryText', b.label);
            const v = screen.buttonValue(b.name, this._statusData(), this._view, j.marks);
            this._set(b.name, 'FrequencyText', v);
            this._set(b.name, 'FrequencyVisible', !!v);
        });
        screen.lines(this._view, j, this._finder).forEach((text, i) => this._set(screen.LINE_IDS[i].name, 'PrimaryText', text));
        Promise.resolve(this.rhmiApplication.flush && this.rhmiApplication.flush()).catch(() => { /* next render */ });
    }

    _stop(reason) {
        if (this._shutdown) return this._shutdown;
        logger.info('shutting down (' + reason + ')');
        this._file.write('---- stopped (' + reason + ') ----');
        clearTimeout(this._pollTimer);
        this._finder.stop();
        this._timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
        clearInterval(this._ui.timer);
        if (this._gpu) this._gpu.close();
        this._link.stop();
        this._shutdown = within(this._keeper.release('the app is stopping'), 2000, 'keep on: hand back')
            .then(() => this.destroyBundles().catch((err) => logger.info('destroyBundles: ' + (err && err.message))))
            .then(() => process.exit(0));
        return this._shutdown;
    }
}

const app = new LightLog();
app.start().catch((err) => {
    logger.error('failed to start: ' + (err && err.message));
});
