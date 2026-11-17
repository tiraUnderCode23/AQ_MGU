// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * Moonlight's touch screen, off the car (no stream, no PC, no Docker):
 *   - its look (touch_view.js in the touch kit): every target 64 px or
 *     more, inside the app area, none overlapping (the kit's lint) in both
 *     tabs, for every state (off, waiting for the hotspot, ready, a game to
 *     resume, starting, streaming, ended, an error) and with the Picture on
 *     sheet open; the buttons enabled as the iDrive list's; the QR code is
 *     the link's, worked out once; a press redraws its button alone;
 *   - hiding for a stream on the centre console (touch.js against a
 *     stand-in mgu-render client): covered, it goes; uncovered, it comes back
 *     GAP_MS later if still wanted, never while the stream's client is up;
 *     not if the app closed its screen state meanwhile;
 *   - the tool end to end: server.js from a kit assembled from
 *     component.json in a temp folder, a stand-in mgu-render client
 *     (test/fake/render_client.js) and touch reader (test/fake/touch.js),
 *     driven over the control socket as the iDrive app drives it: shown in
 *     the app area as one opaque pixmap; the Info tab; Moonlight off and on
 *     from its toggle; Resume last does nothing with nothing to resume;
 *     Picture on's sheet (the HUD refused: no cluster-render here); the List
 *     corner sends {"ev":"list"}; kept while the car moves and shown when
 *     asked while it moves; hidden by the app.
 *   node test/touch_test.js [out-dir]   (the PNGs, to look at)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');
const ROOT = path.resolve(HERE, '..', '..');
/* the kit (component.json "platform") */
try { execFileSync(process.execPath, [path.join(ROOT, 'platform', 'platform.js'), 'sync', HERE], { stdio: 'ignore' }); }
catch (e) { if (!fs.existsSync(path.join(HERE, 'src', 'ui_kit.js'))) throw e; }
const kitUi = require('../src/ui_kit.js');
const view = require('../src/touch_view.js');
const { writePng } = require('../src/ui_png.js');
const { Touch, qrMatrix, GAP_MS } = require('../src/touch.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlt-'));
const OUT = process.argv[2] || tmp;
const win = process.platform === 'win32';
const CTL = win ? '\\\\.\\pipe\\mlt-' + process.pid + '-ctl' : path.join(tmp, 'ctl.sock');
const FAKE_CLIENT = path.join(HERE, 'test', 'fake', 'render_client.js');
const AREA = { x: 108, y: 82 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms, what) {
    for (let i = 0; i < ms / 50; i++) { if (f()) return; await wait(50); }
    throw new Error('timed out: ' + what);
}

/* ---- the look ---- */
const F = kitUi.loadFonts(path.join(HERE, 'src'));
const chipW = (t) => kitUi.chipW(F, t);
const LINK = 'http://192.168.43.1:8490/?t=0123456789abcdef';
const QR = qrMatrix(LINK);
const OUTPUTS = [{ id: 'console', title: 'Centre console', ready: true }, { id: 'map', title: 'Cluster', ready: true }, { id: 'hud', title: 'HUD', ready: false }];
const HOST = { name: 'GAMING-PC', address: '192.168.43.20' }, APP = { name: 'Forza Horizon 5' };
const base = { enabled: true, link: LINK, qr: QR, uplink: 'online', state: 'idle', host: null, app: null, fps: 0, size: null, decoder: null, seconds: 0, via: null,
    pads: [], output: 'console', outputs: OUTPUTS, canResume: false, last: null, error: null, note: null, moving: false, kmh: 0, render: 'mgu-render · cluster-render' };
const M = (o) => Object.assign({}, base, o);
const MODELS = {
    off: M({ enabled: false, link: null, qr: null }),
    noLink: M({ link: null, qr: null, uplink: 'offline', kmh: null }),
    ready: M({}),
    resumable: M({ canResume: true, last: { host: 'GAMING-PC', app: 'Forza Horizon 5' }, pads: ['Xbox 360 Controller'] }),
    starting: M({ state: 'starting', host: HOST, app: APP }),
    streaming: M({ state: 'streaming', host: HOST, app: APP, fps: 60, size: '1280x720@60', seconds: 83, via: 'mgu-render', output: 'map',
        decoder: 'msdk (GPU, API 1.24, GPU copy, Intel iHD driver)', pads: ['Xbox 360 Controller'], last: { host: 'GAMING-PC', app: 'Forza Horizon 5' } }),
    ended: M({ state: 'ended', host: HOST, app: APP, note: 'the stream ended; the game keeps running on the PC', canResume: true, last: { host: 'GAMING-PC', app: 'Forza Horizon 5' } }),
    error: M({ state: 'error', host: HOST, app: APP, error: 'no video arrived: UDP 47998 blocked between the car and the PC?', canResume: true, last: { host: 'GAMING-PC', app: 'Forza Horizon 5' } }),
};
function widgets(m, tab, open) {
    const v = view.view(m, { tab: tab || 'stream' }, chipW);
    return kitUi.frame(F, Object.assign(v, { tab: tab || 'stream' }), { open: open || null });
}
const byId = (W, id) => W.filter((w) => w.id === id)[0];
function centre(W, id, dx) { const r = byId(W, id); if (!r) throw new Error('no ' + id); return [r.x + (dx === undefined ? r.w / 2 : dx), r.y + r.h / 2]; }

const sf = new kitUi.Surface(F);
let slowest = 0, n = 0;
Object.keys(MODELS).forEach((k) => [['stream'], ['info'], ['stream', 'out']].forEach((t) => {
    const W = widgets(MODELS[k], t[0], t[1]);
    const problems = kitUi.lint(W);
    assert.deepStrictEqual(problems, [], k + ' / ' + t.join(' ') + ': ' + problems.join('; '));
    const t0 = Date.now();
    sf.reset();
    sf.render(W, null);
    slowest = Math.max(slowest, Date.now() - t0);
    n++;
}));
/* the buttons as the list's: Stop and Quit game while a stream starts or plays, Resume last while nothing does and there is one */
const on = (k, id) => byId(widgets(MODELS[k]), id).on !== false;
['starting', 'streaming'].forEach((k) => assert.deepStrictEqual([on(k, 'stop'), on(k, 'quit'), on(k, 'resume')], [true, true, false], k));
['ready', 'off', 'noLink'].forEach((k) => assert.deepStrictEqual([on(k, 'stop'), on(k, 'quit'), on(k, 'resume')], [false, false, false], k));
['resumable', 'ended', 'error'].forEach((k) => assert.deepStrictEqual([on(k, 'stop'), on(k, 'quit'), on(k, 'resume')], [false, false, true], k));
assert.strictEqual(on('off', 'out'), false, 'Picture on is off while Moonlight is');
assert.strictEqual(byId(widgets(MODELS.off), 'enabled').value, false);
assert.ok(byId(widgets(MODELS.ready), 'qr') && !byId(widgets(MODELS.noLink), 'qr') && byId(widgets(MODELS.noLink), 'qrNone'), 'the QR code only with a link');
assert.strictEqual(byId(widgets(MODELS.ready), 'qr').matrix, QR);
assert.ok(QR.length >= 25 && QR.every((r) => r.length === QR.length), 'a square QR matrix (' + QR.length + ' modules)');
const sw = widgets(MODELS.streaming);
assert.deepStrictEqual(sw.filter((w) => w.kind === 'chip').map((w) => w.text), ['Streaming · 1:23', '60 fps', 'GPU decoding']);
assert.strictEqual(byId(sw, '_status').text, 'Streaming Forza Horizon 5 from GAMING-PC on the Cluster');
assert.strictEqual(byId(sw, '_status').right, 'Parked · 0 mph');
assert.strictEqual(byId(widgets(MODELS.noLink), '_status').right, 'Speed unknown');
assert.deepStrictEqual(byId(widgets(MODELS.ready, 'stream', 'out'), '_sheet').options.map((o) => o.l), ['Centre console', 'Cluster', 'HUD (not connected)']);
const info = byId(widgets(MODELS.streaming, 'info'), 'info').rows.map((r) => r[0] + ': ' + r[1]);
assert.deepStrictEqual(info.slice(0, 4), ['Host: GAMING-PC · 192.168.43.20', 'Game: Forza Horizon 5', 'Pictures: 60 fps of 1280x720@60 · GPU decoding · through mgu-render',
    'Controllers: 1 · Xbox 360 Controller']);
/* a press redraws its button alone */
sf.reset();
sf.render(sw, null);
const pressed = sf.render(sw, { id: 'stop', part: 0 });
const stopBox = byId(sw, 'stop');
assert.deepStrictEqual(pressed, [{ x: stopBox.x, y: stopBox.y, w: stopBox.w, h: stopBox.h }], 'a press redraws its button alone');
/* the pictures to look at */
const png = (name, W) => { const s = new kitUi.Surface(F); s.render(W, null); const f = path.join(OUT, name); fs.writeFileSync(f, writePng(kitUi.AREA.w, kitUi.AREA.h, s.cv.px)); return f; };
const pngs = [png('moonlight-streaming.png', sw), png('moonlight-ready-sheet.png', widgets(MODELS.resumable, 'stream', 'out')),
    png('moonlight-info.png', widgets(MODELS.streaming, 'info')), png('moonlight-off.png', widgets(MODELS.off))];
console.log('ok   the look: ' + Object.keys(MODELS).length + ' states x 2 tabs and the sheet lint clean (slowest full frame ' + slowest + ' ms of ' + n +
    '); buttons as the list\'s; the QR ' + QR.length + ' modules; a press redraws ' + stopBox.w * stopBox.h + ' px');

/* ---- covered by a stream on the centre console ---- */
const UNIT_LOG = path.join(tmp, 'unit-render.log');
process.env.MOONLIGHT_TEST_RENDER_LOG = UNIT_LOG;
function clients(file) {
    /* how many of this name's mgu-render clients are open, at most, and now */
    let open = 0, most = 0;
    (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n').forEach((l) => {
        if (/^new /.test(l)) { open++; most = Math.max(most, open); } else if (l === 'close') open--;
    });
    return { open: open, most: most };
}

/* ---- the tool end to end ---- */
const kit = path.join(tmp, 'kit');
fs.mkdirSync(kit);
const comp = JSON.parse(fs.readFileSync(path.join(HERE, 'component.json'), 'utf8'));
/* moonlight-core and the stop hint are build/'s (sh build.sh): not needed here */
comp.files.forEach((f) => { const src = path.join(HERE, f.from); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(kit, f.path)); });
const LOG = path.join(tmp, 'render.log'), TOUCH = path.join(tmp, 'touch.txt');
const TOUCH_CMD = [process.execPath, path.join(HERE, 'test', 'fake', 'touch.js'), TOUCH];
function logged() { try { return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean); } catch (e) { return []; } }
async function touch(lines) {
    await until(() => !fs.existsSync(TOUCH), 3000, 'the reader took the last touches');
    fs.writeFileSync(TOUCH, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify({ ev: 'touch', p: l[0], x: Math.round(l[1] + AREA.x), y: Math.round(l[2] + AREA.y) }))).join('\n') + '\n');
    await until(() => !fs.existsSync(TOUCH), 3000, 'the reader took the touches');
    await wait(250);
}
const tap = (p) => touch([[1, p[0], p[1]], 'wait 60', [2, p[0] + 2, p[1] + 1], 'wait 60', [3, p[0] + 2, p[1] + 1]]);

let tool, ctl, statusNow = null, errors = [], out = '', lists = 0;
function send(c) { ctl.write(JSON.stringify(c) + '\n'); }

(async () => {
    /* the cover, on touch.js alone */
    let model = M({});
    const t = new Touch({ dir: path.join(HERE, 'src'), log: () => {}, clientPath: FAKE_CLIENT, touch: { cmd: TOUCH_CMD }, state: () => Object.assign({}, model), act: () => null });
    assert.strictEqual(t.want(true), null);
    await until(() => t.shown() && t.ui.area, 2000, 'shown');
    t.cover('a stream on the centre console');
    assert.ok(!t.shown() && t.isWanted(), 'covered: hidden, still wanted');
    assert.strictEqual(clients(UNIT_LOG).open, 0, 'its client closed before the stream\'s opens');
    t.cover(null);
    await wait(GAP_MS / 2);
    assert.ok(!t.shown(), 'not back at once (the stream\'s client closes first)');
    await until(() => t.shown(), GAP_MS + 500, 'back after the stream');
    t.cover('a stream on the centre console');
    t.want(false);
    t.cover(null);
    await wait(GAP_MS + 200);
    assert.ok(!t.shown(), 'not back: the app closed its screen state during the stream');
    t.cover('a stream on the centre console');
    t.want(true);
    assert.ok(!t.shown(), 'wanted during a stream: not shown');
    t.cover(null);
    await until(() => t.shown(), GAP_MS + 500, 'shown when it ends');
    t.drop('the tool stops');
    assert.ok(!t.shown() && !t.isWanted(), 'dropped: hidden and forgotten');
    assert.strictEqual(clients(UNIT_LOG).most, 1, 'never two clients at once');
    console.log('ok   a stream on the centre console hides it; back ' + GAP_MS + ' ms after it ends if still wanted, not if the app closed it');

    tool = spawn(process.execPath, [path.join(kit, 'server.js')], {
        env: Object.assign({}, process.env, { MOONLIGHT_STATE: path.join(tmp, 'state'), MOONLIGHT_PORT: String(18000 + process.pid % 1000), MOONLIGHT_CTL_SOCKET: CTL,
            MOONLIGHT_NO_FIREWALL: '1', MOONLIGHT_RENDER_CLIENT: FAKE_CLIENT, MOONLIGHT_TEST_RENDER_LOG: LOG, MOONLIGHT_LINK_IP: '192.0.2.10',
            MOONLIGHT_CORE: path.join(tmp, 'no-core'), MOONLIGHT_VIDEO_FILE: path.join(tmp, 'video'), MOONLIGHT_SMALL_DIR: path.join(tmp, 'small'),
            MOONLIGHT_PYTHON: path.join(tmp, 'no-python'), MOONLIGHT_UI_TOUCH_CMD: JSON.stringify(TOUCH_CMD), CTL_OAP_DIR: path.join(tmp, 'oap') }),
        stdio: ['ignore', 'pipe', 'pipe'] });
    tool.stdout.on('data', (dd) => { out += dd; });
    tool.stderr.on('data', (dd) => { out += dd; });
    await until(() => /control: listening/.test(out), 8000, 'the control socket');
    ctl = net.connect(CTL);
    ctl.on('error', () => {});
    ctl.setEncoding('utf8');
    let lb = '';
    ctl.on('data', (dd) => {
        lb += dd;
        let i;
        while ((i = lb.indexOf('\n')) >= 0) {
            const m = JSON.parse(lb.slice(0, i)); lb = lb.slice(i + 1);
            if (m.ev === 'status') statusNow = m; else if (m.ev === 'error') errors.push(m.error); else if (m.ev === 'list') lists++;
        }
    });
    await until(() => statusNow, 5000, 'first status');
    assert.strictEqual(statusNow.touch, false);
    await wait(300);

    /* shown: the app area, one opaque pixmap, whole at first */
    send({ cmd: 'touch', on: true });
    await until(() => logged().some((l) => /^frame ops 18$/.test(l)), 5000, 'the touch screen drawn');
    await until(() => statusNow.touch === true && statusNow.touchWanted === true, 3000, 'status says it shows');
    const L = logged();
    assert.ok(L.indexOf('place 1790x638+108+82') >= 0, 'placed in the app area: ' + L.join(' | '));
    assert.ok(L.indexOf('pixmap 1 1790x638 rgbx') >= 0, 'one opaque pixmap the size of the area');
    assert.ok(L.indexOf('pixels 1 ' + 1790 * 638) >= 0, 'sent whole first');
    assert.ok(L.indexOf('show true') >= 0, 'shown');
    console.log('ok   shown in the app area (1790x638+108+82) as one opaque pixmap');

    /* the Info tab and back: parts redrawn */
    const W0 = widgets(MODELS.ready);
    const n0 = logged().length;
    await tap(centre(W0, '_tabs', kitUi.tabWidths(F, view.TABS)[0] + 4 + 100));
    await tap(centre(W0, '_tabs', 100));
    const parts = logged().slice(n0).filter((l) => /^pixels 1 /.test(l)).map((l) => Number(l.split(' ')[2]));
    /* the press (the tab alone), then the body (most of the area: the whole picture) */
    assert.ok(parts.length >= 4 && parts[0] < 1790 * 638 / 10, 'a tab\'s press, then the tab: ' + parts.join(', '));
    console.log('ok   the Info tab and back: ' + parts.length + ' uploads (' + parts.join(', ') + ' px)');

    /* Moonlight off and on from its toggle */
    await tap(centre(W0, 'enabled'));
    await until(() => statusNow.enabled === false, 3000, 'off from the toggle');
    await tap(centre(W0, 'enabled'));
    await until(() => statusNow.enabled === true, 3000, 'on from the toggle');
    /* Resume last: nothing played yet, so it does nothing */
    await tap(centre(W0, 'resume'));
    await wait(200);
    assert.ok(!/ui: resume/.test(out), 'Resume last is off with nothing to resume');
    console.log('ok   Moonlight off and on from the toggle; Resume last off with nothing to resume');

    /* the picture to look at: the Stream tab, ready, the phone page's QR code */
    await wait(400);
    pngs.push(path.join(OUT, 'moonlight-tool.png'));
    fs.writeFileSync(pngs[pngs.length - 1], writePng(1790, 638, fs.readFileSync(LOG + '.1.rgba')));

    /* Picture on: the sheet, the HUD (no cluster-render here: refused, in the status line) */
    await tap(centre(W0, 'out'));
    const sheet = byId(widgets(MODELS.ready, 'stream', 'out'), '_sheet');
    await tap([sheet.x + sheet.w / 2, sheet.y + 6 + 2 * 66 + 32]);
    await until(() => /ui: out hud/.test(out), 3000, 'the HUD chosen');
    assert.strictEqual(statusNow.output, 'console', 'not moved: the HUD is not there');
    console.log('ok   Picture on: the sheet chooses the HUD, refused without cluster-render');

    /* the List corner: the app is told to go back to its list, the touch screen hides */
    lists = 0;
    await tap(centre(W0, '_list'));
    await until(() => lists === 1 && statusNow.touch === false && statusNow.touchWanted === false, 3000, 'List');
    console.log('ok   the List corner: {"ev":"list"} to the app, the touch screen hidden');

    /* the car moves: the touch screen stays; shown when asked while moving */
    send({ cmd: 'touch', on: true });
    await until(() => statusNow.touch === true, 3000, 'shown again');
    send({ cmd: 'speed', kmh: 40 });
    await until(() => statusNow.moving === true, 3000, 'moving in the status');
    await wait(1200);
    assert.ok(statusNow.touch === true && statusNow.touchWanted === true, 'still shown while moving');
    errors = [];
    send({ cmd: 'touch', on: false });
    await until(() => statusNow.touch === false, 3000, 'hidden by the app while moving');
    send({ cmd: 'touch', on: true });
    await until(() => statusNow.touch === true, 3000, 'shown while moving');
    assert.ok(!errors.length, 'not refused while moving: ' + errors.join('; '));
    send({ cmd: 'speed', kmh: 0 });
    await until(() => statusNow.moving === false, 3000, 'parked');
    send({ cmd: 'touch', on: false });
    await until(() => statusNow.touch === false && statusNow.touchWanted === false, 3000, 'hidden by the app');
    assert.strictEqual(clients(LOG).most, 1, 'one mgu-render client at a time');
    console.log('ok   kept while the car moves, shown when asked while it moves; hidden by the app');
    console.log('     pictures: ' + pngs.join(', '));
    if (process.env.TOUCH_TEST_LOG) console.log(out);
    finish(0);
})().catch((e) => { console.error('FAIL ' + e.message + '\n--- the tool said:\n' + out.slice(-3000)); finish(1); });

function finish(code) {
    try { if (ctl) ctl.destroy(); } catch (e) { /* gone */ }
    if (tool) tool.kill('SIGTERM');
    setTimeout(() => process.exit(code), 300);
}
