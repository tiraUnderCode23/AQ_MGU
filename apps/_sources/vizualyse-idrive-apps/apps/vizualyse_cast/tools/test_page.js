// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
'use strict';
/**
 * Runs the app's source modules (mgu-app.json, the entry first) against a
 * fake SDK and HMI built from the shipped uiDescription.json, talking to the
 * tool's real control socket module (native/vizualyse-cast/src/control.js)
 * with a scripted status.
 *
 *   node tools/test_page.js
 *
 * Covers: application.xml and uiDescription.json agree and the app binds
 * every button, an empty screen state, the Vehicle2 speed in the manifest,
 * ASCII texts; with no tool the status says so; entered with the tool
 * there, the touch screen opens by itself (the empty screen state, then the
 * tool's touch screen once it is visible); its List corner ({"ev":"list"})
 * brings the page back; the Touch screen row opens it again; the car moving
 * keeps it up, the row on while moving; without mgu-render no
 * touch screen (the row says so, the app stays on its list); the speed goes
 * to the tool, also with the page hidden; the CarPlay second screen
 * switch is off without hook111 and sends hook111 alt / off; connected and idle, the
 * link is written and shown as a QR PNG (a new file per link, the old handle
 * released); Stop and Play last follow the tool's state and send stop and
 * replay; the console button hides without mgu-render; the QR toggle sends
 * the opposite of the tool's state; the tool going away is shown.
 */
const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/* the copies of the pinned platform version (release.json "platform") */
require(path.join(ROOT, '..', '..', 'platform', 'platform.js')).sync(ROOT);
const PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\vcast-test-' + process.pid : path.join(os.tmpdir(), 'vcast-' + process.pid + '.sock');
const QR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vcast-qr-'));
process.env.CAST_CTL_SOCKET = PIPE;
process.env.CAST_QR_DIR = QR_DIR;

const STAGED = fs.readdirSync(ROOT).find((n) => n.startsWith('vizualyse_cast@') && !n.endsWith('.tgz'));
const PKG = path.join(ROOT, STAGED);
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'mgu-app.json'), 'utf8'));
const UI_DIR = path.join(PKG, 'rhmiData', 'uiDescriptions', 'ID7');
const UI = JSON.parse(fs.readFileSync(path.join(UI_DIR, 'uiDescription.json'), 'utf8'));
const XML = fs.readFileSync(path.join(UI_DIR, 'application.xml'), 'utf8');
const APP_JSON = JSON.parse(fs.readFileSync(path.join(PKG, 'rhmiData', 'application.json'), 'utf8'));
const { startControl } = require(path.join(ROOT, '..', '..', 'native', 'vizualyse-cast', 'src', 'control.js'));

const STATE = 'ST_OnlineApps_VizualyseCast', SCREEN = 'ST_OnlineApps_VizualyseCastScreen';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function until(what, check, ms) {
    const deadline = Date.now() + (ms || 3000);
    return new Promise((resolve, reject) => {
        const poll = () => {
            if (check()) resolve();
            else if (Date.now() > deadline) reject(new Error('timed out waiting for ' + what));
            else setTimeout(poll, 10);
        };
        poll();
    });
}

/* ---- fake HMI ----------------------------------------------------------- */
class FakeComponent extends EventEmitter {
    constructor(id, desc) {
        super();
        this.id = Number(id);
        this.text = null; this.graphic = null; this.enabled = null;
        this.visible = desc && desc.properties && desc.properties.Visible ? desc.properties.Visible.value === 1 : null;
    }
    getId() { return this.id; }
    setValue(row, cell, value, type) { if (cell === 'Graphic') this.graphic = { value, type }; else this.text = value; return Promise.resolve(); }
    setEnabled(v) { this.enabled = v; return Promise.resolve(); }
    setVisible(v) { this.visible = v; return Promise.resolve(); }
    updateResources() { return Promise.resolve(); }
}
const byName = {};
Object.keys(UI.containers).forEach((cid) => {
    const cont = UI.containers[cid];
    byName[cont.name] = new FakeComponent(cid, cont);
    Object.keys(cont.components).forEach((id) => { byName[cont.components[id].name] = new FakeComponent(id, cont.components[id]); });
});
const handles = new Set(), destroyed = [];
const bundle = {
    createResourceHandles(files) { files.forEach((f) => { assert(fs.existsSync(f), 'handle for a missing file'); handles.add(f); }); return Promise.resolve(); },
    destroyResourceHandles(files) { files.forEach((f) => { handles.delete(f); destroyed.push(f); }); return Promise.resolve(); },
};
const rhmi = new EventEmitter();
rhmi.getByName = (n) => byName[n] || null;
rhmi.mapEntryState = () => Promise.resolve();
rhmi.openEntryState = () => Promise.resolve();
/* openState: the main state goes, the state opened comes (as the HMI does) */
const opened = [];
rhmi.openState = (st) => {
    opened.push(st);
    setImmediate(() => { byName[STATE].emit('visible', { visible: false }); st.emit('visible', { visible: true }); });
    return Promise.resolve();
};
/* closeState: the state goes, the main state comes */
const closed = [];
rhmi.closeState = (st) => {
    closed.push(st);
    setImmediate(() => { st.emit('visible', { visible: false }); byName[STATE].emit('visible', { visible: true }); });
    return Promise.resolve();
};
rhmi.getResourceBundle = () => bundle;
rhmi.flush = () => Promise.resolve();

/* ---- fake SDK ----------------------------------------------------------- */
const logs = [];
const logger = {};
['error', 'warn', 'info', 'verbose', 'debug'].forEach((l) => { logger[l] = (m) => logs.push(l + ': ' + m); });
class OnlineApp extends EventEmitter {
    constructor() {
        super();
        OnlineApp.last = this;
        this._packageJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
        this.appDescription = APP_JSON;
        this.rhmiApplication = rhmi;
        this.startReason = 'ENTRY_POINT';
        this._initialized = false;
        this._appStatusService = null;
        const d = APP_JSON.application.entryPoints[0];
        this._eps = [{ entryPoint: { setText: () => Promise.resolve(), setIcon: () => Promise.resolve() },
            getDescription: () => d, init: () => Promise.resolve(), setAvailability: () => Promise.resolve() }];
    }
    start() { setImmediate(() => this.emit('initialized')); return Promise.resolve(); }
    getAppId() { return 'vizualyse_cast'; }
    getEntryPoints() { return this._eps; }
    getLastExecutedEntryPointUuid() { return null; }
    initialized() { this._initialized = true; this._appStatusService = {}; return Promise.resolve(); }
    registerActive() { return Promise.resolve(); }
    registerInactive() { return Promise.resolve(); }
    registerHmiVisible() { return Promise.resolve(); }
    unregisterHmiVisible() { return Promise.resolve(); }
    destroyBundles() { return Promise.resolve(); }
}
/* Vehicle2's speed, raw (km/h x 64; 65535 invalid) */
let speedRaw = 65535;
const someipBuilders = {
    buildTypedProxy(iface, instance) {
        assert.strictEqual(iface, 'de.bmw.infotainment.vehicle.Vehicle2', 'the app reads the speed only');
        assert.strictEqual(instance, '1');
        return Promise.resolve({ init: () => Promise.resolve(), statusCarSpeed2: { getValue: () => Promise.resolve({ speedVehicleCentreOfGravity: speedRaw }) } });
    },
};
function runSource() {
    const Module = require('module');
    const load = Module._load;
    const FAKES = { 'oap-sdk/src/core/OnlineApp.js': OnlineApp, 'oap-sdk/src/logging/logging': { getSDKLogger: () => logger },
        'oap-sdk/src/someip/someipBuilders': someipBuilders };
    Module._load = function (req, parent, isMain) { return FAKES[req] || load.call(this, req, parent, isMain); };
    require(path.join(ROOT, MANIFEST.modules[0]));
}

/* ---- the tool's side, scripted ------------------------------------------ */
const LINK1 = 'http://172.20.10.2:8480/?t=0123456789abcdef';
const LINK2 = 'http://172.20.10.3:8480/?t=0123456789abcdef';
const OUTPUTS = [{ id: 'map' }, { id: 'hud' }, { id: 'console' }, { id: 'none' }];
let st = { state: 'idle', uplink: 'online', render: 'connected', qr: true, link: LINK1, canReplay: false, outputs: OUTPUTS,
    touch: false, touchWanted: false, touchAvailable: true, moving: null, speed: null };
const received = [];
let control = null;
function serve() {
    control = startControl({ app: 'vizualyse_cast', status: () => st, command: (c) => {
        received.push(c);
        if (c.cmd === 'touch') st = Object.assign({}, st, { touch: !!c.on && st.moving !== true, touchWanted: !!c.on });
        return null;
    }, log: () => {} });
}
const count = (cmd, f) => received.filter((c) => c.cmd === cmd && (!f || f(c))).length;
const press = async (name) => { await sleep(450); byName[name].emit('action'); };

async function main() {
    const comps = UI.containers['1'].components, scr = UI.containers['2'];
    assert.strictEqual(UI.containers['1'].name, STATE);
    assert.strictEqual(scr.name, SCREEN);
    const xmlIds = (XML.match(/<component id="(\d+)"/g) || []).map((m) => m.match(/\d+/)[0]).sort();
    assert.deepStrictEqual(Object.keys(comps).concat(Object.keys(scr.components)).sort(), xmlIds, 'application.xml and uiDescription.json list the same components');
    assert(Object.keys(scr.components).every((id) => scr.components[id].type !== 'button' &&
        !(scr.components[id].properties.Focusable && scr.components[id].properties.Focusable.value)), 'the screen state has nothing to press');
    assert(/<container id="2" type="state" widget="LT_State_Wide">\r?\n {8}<property id="9" value="1"\/>/.test(XML), 'the screen state\'s parent is the main state');
    assert(!/[^\x00-\x7f]/.test(JSON.stringify(UI)), 'uiDescription.json is ASCII');
    const manifest = JSON.parse(fs.readFileSync(path.join(PKG, 'manifest.json'), 'utf8'));
    const v2 = manifest.proxies['de.bmw.infotainment.vehicle.Vehicle2'];
    assert(v2 && v2.instances[0] === '1' && v2.attributes.statusCarSpeed2 === 'rs', 'the manifest asks to read and subscribe Vehicle2.statusCarSpeed2');
    assert(MANIFEST.sdk.indexOf('oap-sdk/src/someip/someipBuilders') >= 0, 'the SOME/IP builders linked');
    assert.strictEqual(comps['21'].name, 'castQr');
    assert(/<component id="21" type="label" widget="LT_Label_1Graphic_Scalable">/.test(XML), 'the QR is a scalable graphic label');
    const buttons = Object.keys(comps).filter((id) => comps[id].type === 'button').map((id) => comps[id].name).sort();
    assert.deepStrictEqual(buttons, ['castCarplayCentre', 'castCarplayDirections', 'castCarplayEta', 'castCarplayHud', 'castCarplayHudAlt', 'castCarplayMap', 'castCarplayOn', 'castCarplayZoomIn', 'castCarplayZoomOut',
        'castConsole', 'castEnable', 'castHud', 'castMap', 'castQrToggle', 'castStop', 'castTouch']);
    assert.strictEqual(UI.containers['1'].components['46'].name, 'castTouch');
    console.log('ok   page: 16 buttons (Touch screen first), a QR graphic, an empty screen state, the speed in the manifest, ASCII, xml and uiDescription agree');

    process.exit = (code) => { throw new Error('process.exit(' + code + ')'); };
    runSource();
    /* the HMI shows the entry state */
    setTimeout(() => byName[STATE].emit('visible', { visible: true }), 50);
    const S = byName.castStatus;
    await until('no-tool status', () => /not running/.test(S.text || ''));
    assert(!logs.some((l) => /^error/.test(l)), logs.filter((l) => /^error/.test(l)).join('\n'));
    assert.strictEqual(byName.castStop.enabled, false);
    assert.strictEqual(byName.castTouch.enabled, false);
    console.log('ok   without the tool: "' + S.text + '", buttons disabled');

    /* entered with the tool there: the touch screen by itself; its List corner: the page */
    serve();
    await until('the screen state opened by itself', () => opened.length === 1 && opened[0] === byName[SCREEN]);
    await until('the touch screen asked for', () => count('touch', (c) => c.on === true) === 1);
    await until('the page says so', () => /^The touch screen is up/.test(S.text || ''));
    st = Object.assign({}, st, { touch: false, touchWanted: false });
    control.send({ ev: 'list' });
    control.broadcast();
    await until('the page back on List', () => closed.length === 1 && closed[0] === byName[SCREEN]);
    await sleep(600);
    assert.strictEqual(opened.length, 1, 'the touch screen does not come back by itself after List');
    console.log('ok   entered: the touch screen opens by itself (the screen state, then the tool\'s); its List corner closes it to the page');

    await until('ready status', () => /^Ready/.test(S.text || ''));
    assert.strictEqual(byName.castTouch.text, 'Touch screen');
    assert.strictEqual(byName.castTouch.enabled, true, 'Touch screen on (speed unknown: the tool decides)');
    assert.strictEqual(byName.castLink.text, LINK1);
    await until('QR graphic', () => byName.castQr.graphic);
    const qr1 = byName.castQr.graphic.value;
    assert.strictEqual(byName.castQr.graphic.type, 'ResourceId');
    assert(handles.has(qr1) && fs.readFileSync(qr1).slice(1, 4).toString() === 'PNG', 'a PNG with a resource handle');
    assert.strictEqual(byName.castQr.visible, true);
    assert.strictEqual(byName.castMap.enabled, false, 'nothing to replay yet');
    assert.strictEqual(byName.castStop.enabled, false);
    console.log('ok   connected: "' + S.text + '", link written, QR ' + path.basename(qr1));

    st = Object.assign({}, st, { state: 'playing', output: 'map', audio: true, seconds: 12, canReplay: true, url: 'https://example.org/v.mkv?…' });
    control.broadcast();
    await until('playing', () => /^Playing on the cluster map, with sound/.test(S.text || ''));
    assert.strictEqual(byName.castStop.enabled, true);
    assert.strictEqual(byName.castConsole.enabled, true);
    byName.castConsole.emit('action');
    await until('replay sent', () => received.some((c) => c.cmd === 'replay' && c.output === 'console'));
    await sleep(450);
    byName.castStop.emit('action');
    await until('stop sent', () => received.some((c) => c.cmd === 'stop'));
    byName.castQrToggle.emit('action');
    await until('qr sent', () => received.some((c) => c.cmd === 'qr' && c.show === false));
    console.log('ok   playing: "' + S.text + '"; Play last on this screen, Stop and the QR toggle send replay, stop, qr off');

    assert.strictEqual(byName.castCarplayMap.enabled, false, 'no CarPlay second screen without hook111');
    assert.strictEqual(byName.castCarplayOn.enabled, false, 'no switch without hook111');
    assert.strictEqual(byName.castCarplayOn.text, 'CarPlay second screen: hook111 not installed');
    st = Object.assign({}, st, { carplay: { armed: true, ready: false, mode: 'off', switch: { installed: true, on: false, pending: null } } });
    control.broadcast();
    await until('switch enabled, off', () => byName.castCarplayOn.enabled === true && byName.castCarplayOn.text === 'CarPlay second screen: off');
    assert.strictEqual(byName.castCarplayMap.enabled, false, 'the CarPlay map waits for the switch');
    await sleep(450);
    byName.castCarplayOn.emit('action');
    await until('hook111 alt sent', () => received.some((c) => c.cmd === 'hook111' && c.mode === 'alt'));
    st = Object.assign({}, st, { carplay: { armed: true, ready: true, mode: 'alt', switch: { installed: true, on: true, pending: 'from the phone\'s next connection' } } });
    control.broadcast();
    await until('switch on, pending', () => byName.castCarplayOn.text === 'CarPlay second screen: on (from the phone\'s next connection)');
    await sleep(450);
    byName.castCarplayOn.emit('action');
    await until('hook111 off sent', () => received.some((c) => c.cmd === 'hook111' && c.mode === 'off'));
    console.log('ok   the switch: disabled without hook111; on / off sends hook111 alt / off; shows when it applies');

    st = Object.assign({}, st, { state: 'playing', carplay: Object.assign({}, st.carplay, { ready: true, cards: { directions: true, eta: true, url: 'maps:/car/instrumentcluster?showETA=yes', pending: null } }) });
    control.broadcast();
    await until('cards shown', () => byName.castCarplayDirections.enabled === true && byName.castCarplayDirections.text === 'CarPlay directions card: on' &&
        byName.castCarplayEta.text === 'CarPlay time / distance card: on');
    await sleep(450);
    byName.castCarplayDirections.emit('action');
    await until('directions off sent', () => received.some((c) => c.cmd === 'carplayCards' && c.directions === false && c.eta === undefined));
    await sleep(450);
    byName.castCarplayEta.emit('action');
    await until('time / distance off sent', () => received.some((c) => c.cmd === 'carplayCards' && c.eta === false && c.directions === undefined));
    st = Object.assign({}, st, { carplay: Object.assign({}, st.carplay, { cards: { directions: false, eta: false, url: 'maps:/car/instrumentcluster/map', pending: null } }) });
    control.broadcast();
    await until('cards shown off', () => byName.castCarplayDirections.text === 'CarPlay directions card: off' && byName.castCarplayEta.text === 'CarPlay time / distance card: off');
    await until('zoom enabled while the CarPlay picture plays', () => byName.castCarplayZoomIn.enabled === true && byName.castCarplayZoomOut.enabled === true);
    await sleep(450);
    byName.castCarplayZoomIn.emit('action');
    await until('zoom in sent', () => received.some((c) => c.cmd === 'carplayZoom' && c.dir === 'in'));
    await sleep(450);
    byName.castCarplayZoomOut.emit('action');
    await until('zoom out sent', () => received.some((c) => c.cmd === 'carplayZoom' && c.dir === 'out'));
    console.log('ok   the cluster cards: each shown and toggled on its own (carplayCards); zoom in / out sent while the CarPlay picture plays');

    st = Object.assign({}, st, { carplay: Object.assign({}, st.carplay, { centre: { on: true, safearea: '322,80,340,330', offered: '322,80,340,330', pending: null } }) });
    control.broadcast();
    await until('centring shown, on', () => byName.castCarplayCentre.enabled === true && byName.castCarplayCentre.text === 'CarPlay: centre the map: on');
    await sleep(450);
    byName.castCarplayCentre.emit('action');
    await until('centre off sent', () => received.some((c) => c.cmd === 'carplayCentre' && c.on === false));
    st = Object.assign({}, st, { carplay: Object.assign({}, st.carplay, { centre: { on: false, safearea: null, offered: '322,80,340,330', pending: 'from the phone\'s next connection' } }) });
    control.broadcast();
    await until('centring off, pending', () => byName.castCarplayCentre.text === 'CarPlay: centre the map: off (from the phone\'s next connection)');
    await sleep(450);
    byName.castCarplayCentre.emit('action');
    await until('centre on sent', () => received.some((c) => c.cmd === 'carplayCentre' && c.on === true));
    console.log('ok   centring: shown with when it applies; a press toggles it (carplayCentre)');

    st = Object.assign({}, st, { carplay: Object.assign({}, st.carplay, { hudAlt: false }) });
    control.broadcast();
    await until('HUD alternate mode shown, off', () => byName.castCarplayHudAlt.enabled === true && byName.castCarplayHudAlt.text === 'CarPlay HUD alternate mode: off');
    await sleep(450);
    byName.castCarplayHudAlt.emit('action');
    await until('HUD alternate on sent', () => received.some((c) => c.cmd === 'carplayHudAlt' && c.on === true));
    st = Object.assign({}, st, { carplay: Object.assign({}, st.carplay, { hudAlt: true }) });
    control.broadcast();
    await until('HUD alternate mode shown, on', () => byName.castCarplayHudAlt.text === 'CarPlay HUD alternate mode: on');
    await sleep(450);
    byName.castCarplayHudAlt.emit('action');
    await until('HUD alternate off sent', () => received.some((c) => c.cmd === 'carplayHudAlt' && c.on === false));
    console.log('ok   the HUD alternate mode: shown; a press toggles it (carplayHudAlt)');
    st = Object.assign({}, st, { carplay: { armed: true, ready: true, mode: 'alt', switch: { installed: true, on: true, pending: null } } });
    control.broadcast();
    await until('carplay enabled', () => byName.castCarplayMap.enabled === true && byName.castCarplayHud.enabled === true);
    await sleep(450);
    byName.castCarplayMap.emit('action');
    await until('carplay map sent', () => received.some((c) => c.cmd === 'carplay' && c.output === 'map'));
    byName.castCarplayHud.emit('action');
    await until('carplay hud sent', () => received.some((c) => c.cmd === 'carplay' && c.output === 'hud'));
    assert.strictEqual(byName.castEnable.text, 'Cast to cluster: on');
    byName.castEnable.emit('action');
    await until('disable sent', () => received.some((c) => c.cmd === 'disable'));
    st = Object.assign({}, st, { enabled: false, state: 'idle' });
    control.broadcast();
    await until('off status', () => /^Off/.test(S.text || ''));
    assert.strictEqual(byName.castEnable.text, 'Cast to cluster: off');
    assert.strictEqual(byName.castQr.visible, false, 'no QR while off');
    assert.strictEqual(byName.castCarplayMap.enabled, false);
    assert.strictEqual(byName.castMap.enabled, false);
    await sleep(450);
    byName.castEnable.emit('action');
    await until('enable sent', () => received.some((c) => c.cmd === 'enable'));
    st = Object.assign({}, st, { enabled: true, state: 'playing' });
    control.broadcast();
    await until('back on', () => /^Playing/.test(S.text || '') && byName.castQr.visible === true);
    console.log('ok   CarPlay map on the cluster / the HUD send carplay map / hud (only with hook111 ready); on/off sends disable and enable, off hides the QR and disables the rest');

    st = Object.assign({}, st, { qr: false, outputs: OUTPUTS.filter((o) => o.id !== 'console') });
    control.broadcast();
    await until('console hidden', () => byName.castConsole.visible === false);
    assert(/: off$/.test(byName.castQrToggle.text));
    console.log('ok   without mgu-render the console button hides; toggle reads "' + byName.castQrToggle.text + '"');

    const qrBefore = byName.castQr.graphic.value;
    st = Object.assign({}, st, { link: LINK2 });
    control.broadcast();
    await until('new QR', () => byName.castQr.graphic.value !== qrBefore && byName.castLink.text === LINK2);
    await until('old QR released', () => destroyed.indexOf(qrBefore) >= 0 && !fs.existsSync(qrBefore));
    assert(destroyed.indexOf(qr1) >= 0 && !fs.existsSync(qr1), 'the first QR was released when it was replaced');
    assert.strictEqual(byName.castLink.text, LINK2);
    console.log('ok   a new link: new QR file, the old handle released and its file removed');

    /* Touch screen: the screen state, then the touch screen */
    await press('castTouch');
    await until('the screen state opened', () => opened.length === 2 && opened[1] === byName[SCREEN]);
    await until('touch on sent once it is visible', () => count('touch', (c) => c.on === true) === 2);
    /* BACK: the page, the touch screen hidden */
    byName[SCREEN].emit('visible', { visible: false });
    byName[STATE].emit('visible', { visible: true });
    await until('touch off on BACK', () => count('touch', (c) => c.on === false) === 1, 1500);
    console.log('ok   the Touch screen row opens the screen state, then the touch screen; BACK hides it');

    /* the car moving: the touch screen stays (map settings on the move) */
    await press('castTouch');
    await until('the screen state for the move', () => opened.length === 3);
    await until('shown for the move', () => st.touch);
    const closedBefore = closed.length, offBefore = count('touch', (c) => c.on === false);
    st = Object.assign({}, st, { moving: true, speed: 30 });
    control.broadcast();
    await sleep(1000);
    assert.strictEqual(closed.length, closedBefore, 'the screen state stays when the car moves');
    assert.strictEqual(count('touch', (c) => c.on === false), offBefore, 'the touch screen not hidden when the car moves');
    byName[SCREEN].emit('visible', { visible: false });
    byName[STATE].emit('visible', { visible: true });
    await until('BACK while moving: the touch screen hidden', () => count('touch', (c) => c.on === false) === offBefore + 1, 1500);
    await until('moving: Touch screen on', () => byName.castTouch.enabled === true && byName.castTouch.text === 'Touch screen');
    assert.strictEqual(byName.castStop.enabled, true, 'the list keeps working while driving');
    await press('castTouch');
    await until('opened again while moving', () => opened.length === 4);
    await until('touch on while moving', () => count('touch', (c) => c.on === true) === 4);
    byName[SCREEN].emit('visible', { visible: false });
    byName[STATE].emit('visible', { visible: true });
    await until('BACK: the page', () => count('touch', (c) => c.on === false) === offBefore + 2, 1500);
    console.log('ok   the car moving keeps the touch screen up; moving: the row on, it opens again');

    /* the speed: to the tool once the car gives one, with the page hidden too */
    assert(!received.some((c) => c.cmd === 'speed'), 'no speed sent while the car gives none (65535)');
    speedRaw = 48 * 64;
    await until('speed 48 sent', () => received.some((c) => c.cmd === 'speed' && c.kmh === 48), 3000);
    byName[STATE].emit('visible', { visible: false });
    const n = count('speed');
    await sleep(1300);
    assert(count('speed') > n, 'the speed goes on with the page hidden');
    assert(/^Playing/.test(S.text || ''), 'the socket kept with the page hidden');
    byName[STATE].emit('visible', { visible: true });
    st = Object.assign({}, st, { moving: false, speed: 0 });
    speedRaw = 0;
    control.broadcast();
    await until('parked: Touch screen on', () => byName.castTouch.enabled === true && byName.castTouch.text === 'Touch screen');
    console.log('ok   the speed goes to the tool, with the page hidden too; parked again: the row on');

    /* without mgu-render: no touch screen, the app stays on its list */
    st = Object.assign({}, st, { touchAvailable: false });
    control.broadcast();
    await until('the row says why', () => byName.castTouch.enabled === false && byName.castTouch.text === 'Touch screen (needs mgu-render)');
    const o = opened.length;
    /* the tile again: entered, but no touch screen here */
    OnlineApp.last.emit('entryPointExecute', APP_JSON.application.entryPoints[0].uuid);
    await sleep(600);
    assert.strictEqual(opened.length, o, 'entered: the list stays');
    assert.strictEqual(count('touch', (c) => c.on === true), 4, 'the touch screen not asked for');
    console.log('ok   without mgu-render: "' + byName.castTouch.text + '", the app stays on its list');

    control.close();
    await until('tool gone', () => /not running/.test(S.text || ''));
    console.log('ok   the tool going away: "' + S.text + '"');

    assert(!logs.some((l) => /^(error|warn)/.test(l)), logs.filter((l) => /^(error|warn)/.test(l)).join('\n'));
    console.log('all page tests passed');
}

main().then(() => { try { fs.rmSync(QR_DIR, { recursive: true, force: true }); } catch (e) { /* left */ } process.exitCode = 0; setTimeout(() => require('process').reallyExit(0), 50); },
    (e) => { console.error('FAIL ' + e.message); console.error(logs.slice(-15).join('\n')); setTimeout(() => require('process').reallyExit(1), 50); });
