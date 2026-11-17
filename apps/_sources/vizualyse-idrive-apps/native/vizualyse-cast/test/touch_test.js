// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * Cast's touch screen on the central screen, off the car (Node 8):
 *   - its look (touch_view.js in the touch kit): every tab in every state
 *     drawn (nothing played, playing, paused, off, no hotspot, the CarPlay
 *     picture with and without its preview, no hook111): every target 64 px
 *     or more, inside the app area, none overlapping (the kit's lint); the
 *     texts in the font's characters; a press redraws its button alone; the
 *     QR code reads back as the link's; PNGs of the Cast, CarPlay and Info
 *     tabs written;
 *   - the preview's pictures (touch.js): split anyhow across reads, kept
 *     only while the CarPlay tab shows, in two buffers made once;
 *   - the tool end to end (server.js, a fake mgu-render client and touch
 *     reader, test/fake_*.js), driven over the control socket as the iDrive
 *     app drives it: shown in the app area as one opaque pixmap; a toggle
 *     tapped turns Cast off and on; refused and hidden while the car moves;
 *     the List corner sends {"ev":"list"} and hides it; with ffmpeg
 *     (CAST_FFMPEG or build/ffmpeg): a stream on this screen hides it and it
 *     comes back when the stream ends; the CarPlay map played from the
 *     CarPlay tab, its live preview drawn from the second ffmpeg output.
 *
 *   node test/touch_test.js [out-dir]   (the PNGs, to look at)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');
const ROOT = path.resolve(HERE, '..', '..');
try { execFileSync(process.execPath, [path.join(ROOT, 'platform', 'platform.js'), 'sync', HERE], { stdio: 'ignore' }); }
catch (e) { if (!fs.existsSync(path.join(HERE, 'src', 'ui_kit.js'))) throw e; }
const view = require('../src/touch_view.js');
const kit = require('../src/ui_kit.js');
const { writePng } = require('../src/ui_png.js');
const { CastTouch, qrMatrix } = require('../src/touch.js');
const qrcode = require('../src/qrcode.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vct-'));
const OUT = process.argv[2] || tmp;
const FFMPEG = path.resolve(process.env.CAST_FFMPEG || path.join(HERE, 'build', 'ffmpeg'));

/* ---- the look ---- */
const F = kit.loadFonts(path.join(HERE, 'src'));
const chipW = (t) => kit.chipW(F, t);
const LINK = 'http://172.20.10.2:8480/?t=0123456789abcdef';
const OUTPUTS = [{ id: 'map', title: 'Cluster map' }, { id: 'hud', title: 'HUD' }, { id: 'console', title: 'Media console' }, { id: 'none', title: 'Audio only' }];
const CP = { armed: true, ready: true, why: null, mode: 'alt', streaming: true, frames: 4520, size: '984x480', switch: { installed: true, on: true, pending: null },
    cards: { directions: true, eta: true }, centre: { on: true }, hudAlt: false };
const BASE = { enabled: true, state: 'idle', uplink: 'online', render: 'connected', qr: false, link: LINK, canReplay: false, outputs: OUTPUTS,
    source: 'url', carplay: CP, moving: false, speed: 0, qrMatrix: qrMatrix(LINK), preview: null };
/* a picture standing in for the CarPlay map */
function mapPicture() {
    const w = view.PREVIEW.w, h = view.PREVIEW.h, rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4, road = Math.abs(y - (h - x * 0.4)) < 9 || Math.abs(x - 380) < 7;
            rgba[i] = road ? 61 : 27; rgba[i + 1] = road ? 139 : 34; rgba[i + 2] = road ? 255 : 41; rgba[i + 3] = 255;
        }
    }
    return { w: w, h: h, rgba: rgba, opaque: true };
}
const PIC = mapPicture();
const NOW = Date.now();
const STATES = {
    idle: {},
    playing: { state: 'playing', output: 'map', audio: true, seconds: 72, url: 'http://172.20.10.5:8080/live.m3u8?…', canReplay: true },
    paused: { state: 'paused', output: 'map', note: 'paused while steam (a game runs) asks for it', url: 'http://172.20.10.5/v.mp4', canReplay: true },
    carplay: { state: 'playing', output: 'map', source: 'carplay', seconds: 30, url: 'CarPlay second screen', canReplay: true,
        preview: { img: PIC, key: 'pv1', at: NOW } },
    carplayWaiting: { state: 'waiting', output: 'hud', source: 'carplay', note: 'listening again for the second screen in 2 s', canReplay: true },
    off: { enabled: false, state: 'idle', note: 'turned off', url: 'http://172.20.10.5/v.mp4', canReplay: true },
    noHotspot: { link: null, qrMatrix: null, uplink: 'searching', outputs: OUTPUTS.filter((o) => o.id !== 'console') },
    noHook: { carplay: { armed: false, ready: false, why: 'hook111 is not armed this start', switch: { installed: false, on: false, pending: null } } },
    error: { state: 'error', output: 'hud', error: 'http://x: Connection refused', canReplay: true },
};
function model(name) { return Object.assign({}, BASE, STATES[name]); }
function widgets(m, tab) { const v = view.view(m, { tab: tab }, chipW, NOW); v.tab = tab; return kit.frame(F, v, { open: null }); }
const GLYPHS = new Set(kit.GLYPHS.split(''));
let screens = 0;
Object.keys(STATES).forEach((name) => view.TABS.forEach((t) => {
    const W = widgets(model(name), t[0]);
    const problems = kit.lint(W);
    assert.deepStrictEqual(problems, [], name + ' / ' + t[0] + ': ' + problems.join('; '));
    W.forEach((d) => ['text', 'label', 'sub'].forEach((k) => {
        const s = typeof d[k] === 'string' ? d[k] : '';
        s.split('').forEach((ch) => assert(GLYPHS.has(ch), name + ' / ' + t[0] + ': ' + d.id + ' has "' + ch + '", not in the font'));
    }));
    (W.filter((d) => d.rows)[0] || { rows: [] }).rows.forEach((r) => (r[0] + r[1]).split('').forEach((ch) => assert(GLYPHS.has(ch), name + ' info: "' + ch + '"')));
    screens++;
}));
/* every row of the iDrive page has a place here */
const ids = {};
['cast', 'carplay', 'info'].forEach((t) => widgets(model('playing'), t).forEach((d) => { ids[d.id] = true; }));
['qrCode', 'qrLink', 'enabled', 'stop', 'cp2', 'dir', 'eta', 'zoomIn', 'zoomOut', 'centre', 'hudalt', 'cpOut', 'replay', 'qr', 'info', '_status']
    .forEach((id) => assert(ids[id], 'the touch screen has ' + id));
const seg = widgets(model('playing'), 'cast').filter((d) => d.id === 'replay')[0];
assert.deepStrictEqual(seg.options.map((o) => o.v), ['map', 'hud', 'console'], 'Play again on: the cluster map, the HUD, this screen');
assert.deepStrictEqual(widgets(model('noHotspot'), 'cast').filter((d) => d.id === 'replay')[0].options.map((o) => o.v), ['map', 'hud'], 'no This screen without mgu-render');
assert.strictEqual(widgets(model('carplay'), 'carplay').filter((d) => d.id === 'preview')[0].kind, 'image', 'the CarPlay map playing: its preview');
assert.strictEqual(widgets(model('carplayWaiting'), 'carplay').filter((d) => d.id === 'preview')[0].kind, 'panel', 'no picture yet: the placeholder');
assert.strictEqual(widgets(Object.assign(model('carplay'), { preview: { img: PIC, key: 'pv1', at: NOW - 5000 } }), 'carplay').filter((d) => d.id === 'preview')[0].kind, 'panel',
    'a picture 5 s old: the placeholder');
assert.strictEqual(widgets(model('playing'), 'carplay').filter((d) => d.id === 'zoomIn')[0].on, false, 'zoom only while the CarPlay map plays');
assert.strictEqual(widgets(model('noHook'), 'carplay').filter((d) => d.id === 'dir')[0].on, false, 'the CarPlay toggles off without hook111');
/* the QR code is the link's: the module grid, a quiet zone of 2 */
const q = qrcode(0, 'M'); q.addData(LINK); q.make();
const qm = qrMatrix(LINK), n = q.getModuleCount();
assert.strictEqual(qm.length, n + 4);
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) assert.strictEqual(qm[r + 2][c + 2], q.isDark(r, c));
assert(qm[0].every((x) => !x) && qm.every((row) => !row[0]), 'a quiet zone');
/* draw: each tab, the slowest whole frame, a press */
const sf = new kit.Surface(F);
let slowest = 0;
[['idle', 'cast'], ['playing', 'cast'], ['carplay', 'carplay'], ['playing', 'info']].forEach((x) => {
    const s = new kit.Surface(F), t0 = Date.now();
    s.render(widgets(model(x[0]), x[1]), null);
    slowest = Math.max(slowest, Date.now() - t0);
    fs.writeFileSync(path.join(OUT, 'cast_' + x[1] + '_' + x[0] + '.png'), writePng(1790, 638, s.cv.px));
});
const WP = widgets(model('playing'), 'cast');
sf.render(WP, null);
const stopBox = WP.filter((d) => d.id === 'stop')[0];
assert.deepStrictEqual(sf.render(WP, { id: 'stop', part: 0 }), [{ x: stopBox.x, y: stopBox.y, w: stopBox.w, h: stopBox.h }], 'a press redraws its button alone');
/* a new preview picture redraws the preview alone (its chip on it) */
const s2 = new kit.Surface(F);
s2.render(widgets(model('carplay'), 'carplay'), null);
const pv = widgets(Object.assign(model('carplay'), { preview: { img: PIC, key: 'pv2', at: NOW } }), 'carplay');
const t1 = Date.now();
const rects = s2.render(pv, null);
const pvMs = Date.now() - t1;
const pvBox = pv.filter((d) => d.id === 'preview')[0];
assert.deepStrictEqual(rects, [{ x: pvBox.x, y: pvBox.y, w: pvBox.w, h: pvBox.h }], 'a new preview picture redraws the preview alone');
console.log('ok   the look: ' + screens + ' screens lint clean, every page row has a place, the QR code is the link\'s; slowest whole frame ' + slowest +
    ' ms, a preview picture ' + pvMs + ' ms; PNGs in ' + OUT);

/* ---- the preview's pictures ---- */
(function previewBuffers() {
    const t = new CastTouch({ dir: path.join(HERE, 'src'), log: () => {}, clientPath: '/nonexistent', state: () => BASE, command: () => null });
    let want = false, draws = 0;
    t.wantsPreview = () => want;
    t.ui.invalidate = () => { draws++; };
    const size = view.PREVIEW.w * view.PREVIEW.h * 4;
    const frame = (v) => Buffer.alloc(size, v);
    /* feeds the pictures in pieces of odd sizes */
    const feed = (bufs) => { const all = Buffer.concat(bufs); for (let i = 0; i < all.length; i += 65521) t.previewData(all.slice(i, i + 65521)); };
    t.previewStart();
    feed([frame(1), frame(2)]);
    assert(t.model().preview === null, 'not kept while the CarPlay tab is not shown');
    assert(t.pv.bufs === null, 'no buffers made until a picture is kept');
    want = true;
    feed([frame(3).slice(0, 1000)]);
    feed([frame(3).slice(1000)]);
    assert(t.model().preview === null, 'the picture under way when the tab opened is not kept (only whole pictures)');
    feed([frame(5)]);
    let m = t.model().preview;
    assert(m && m.img.rgba[0] === 5 && m.img.rgba[size - 1] === 5 && m.img.w === view.PREVIEW.w && m.img.opaque, 'the next whole picture kept');
    const bufs = t.pv.bufs.slice();
    feed([frame(6), frame(7)]);
    m = t.model().preview;
    assert(m.img.rgba[0] === 7 && m.img.rgba[size - 1] === 7 && t.pv.bufs[0] === bufs[0] && t.pv.bufs[1] === bufs[1], 'the newest, in the same two buffers');
    assert(draws >= 3, 'each picture asks for a frame');
    want = false;
    feed([frame(8), frame(9)]);
    assert.strictEqual(t.model().preview.img.rgba[0], 8, 'the tab closed: the picture under way finished, then nothing copied');
    t.previewEnd();
    assert(t.model().preview === null, 'ffmpeg ended: no picture');
    console.log('ok   the preview: whole pictures only, kept only while the CarPlay tab shows, two buffers made once');
})();

/* ---- the tool end to end ---- */
const win = process.platform === 'win32';
if (win) {
    console.log('skip the tool end to end: server.js runs ffmpeg\'s proxy as another uid (Linux; Node 8 in ml-unit:18.04-node8)');
    console.log('all touch tests passed');
    process.exit(0);
}
const CTL = path.join(tmp, 'ctl.sock');
const LOG = path.join(tmp, 'render.log'), TOUCH = path.join(tmp, 'touch.txt');
const AREA = { x: 108, y: 82 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms, what) {
    for (let i = 0; i < ms / 50; i++) { if (f()) return; await wait(50); }
    throw new Error('timed out: ' + what);
}
function logged() { try { return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } }
async function touch(lines) {
    await until(() => !fs.existsSync(TOUCH), 3000, 'the reader took the last touches');
    fs.writeFileSync(TOUCH, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify({ ev: 'touch', p: l[0], x: Math.round(l[1] + AREA.x), y: Math.round(l[2] + AREA.y) }))).join('\n') + '\n');
    await until(() => !fs.existsSync(TOUCH), 3000, 'the reader took the touches');
    await wait(250);
}
const tap = (p) => touch([[1, p[0], p[1]], 'wait 60', [3, p[0] + 2, p[1] + 1]]);
let statusNow = null, errors = [], lists = 0, out = '', srv = null, ctl = null, web = null;
/* a widget's centre on a tab as the tool draws it now (dx: from its left) */
function at(id, tab, dx) {
    const v = view.view(Object.assign({}, statusNow, { qrMatrix: qrMatrix(statusNow.link || 'x'), preview: null }), { tab: tab }, chipW, Date.now());
    v.tab = tab;
    const r = kit.frame(F, v, { open: null }).filter((d) => d.id === id)[0];
    if (!r) throw new Error('no ' + id + ' on ' + tab);
    return [r.x + (dx === undefined ? r.w / 2 : dx), r.y + r.h / 2];
}
const tabX = (i) => { const ws = kit.tabWidths(F, view.TABS); let x = kit.TOP.x; for (let k = 0; k < i; k++) x += ws[k] + 4; return [x + ws[i] / 2, kit.TOP.y + 30]; };
function send(c) { ctl.write(JSON.stringify(c) + '\n'); }
function fakeRun() {
    const run = fs.mkdtempSync(path.join(os.tmpdir(), 'hook111-'));
    fs.writeFileSync(path.join(run, 'env'), 'LD_PRELOAD="/var/opt/hook111/current/libhook111.so"\nHOOK111_SINK_PORT=46411\n');
    fs.writeFileSync(path.join(run, 'mode'), 'alt\n');
    fs.mkdirSync(path.join(run, 'log'));
    return run;
}

(async () => {
    const state = path.join(tmp, 'state');
    fs.mkdirSync(state);
    const lease = path.join(tmp, 'lease.json');
    fs.writeFileSync(lease, JSON.stringify({ ip: '172.20.10.2' }));
    const run = fakeRun(), hookVar = fs.mkdtempSync(path.join(os.tmpdir(), 'hook111-var-'));
    fs.writeFileSync(path.join(hookVar, 'hook111-arm.sh'), '#!/bin/sh\nexit 0\n');
    fs.writeFileSync(path.join(hookVar, 'config'), 'HOOK111_MODE=alt\n');
    srv = spawn(process.execPath, [path.join(HERE, 'src', 'server.js')], {
        env: Object.assign({}, process.env, { CAST_STATE: state, CAST_PORT: '18490', CAST_CTL_SOCKET: CTL, CAST_LEASE: lease, CTL_OAP_DIR: path.join(tmp, 'oap'),
            CAST_HOOK_RUN: run, CAST_HOOK_VAR: hookVar, CAST_HOOK_ARM: path.join(hookVar, 'hook111-arm.sh'), CAST_FFMPEG: FFMPEG,
            CAST_RENDER_CLIENT: path.join(HERE, 'test', 'fake_render_client.js'), CAST_TEST_RENDER_LOG: LOG,
            CAST_TOUCH_CMD: JSON.stringify([process.execPath, path.join(HERE, 'test', 'fake_touch.js'), TOUCH]) }),
        stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    await until(() => { try { return fs.statSync(CTL) && true; } catch (e) { return false; } }, 5000, 'the control socket');
    ctl = net.connect(CTL);
    ctl.on('error', () => {});
    ctl.setEncoding('utf8');
    let lb = '';
    ctl.on('data', (d) => {
        lb += d;
        let i;
        while ((i = lb.indexOf('\n')) >= 0) {
            const m = JSON.parse(lb.slice(0, i)); lb = lb.slice(i + 1);
            if (m.ev === 'status') statusNow = m; else if (m.ev === 'error') errors.push(m.error); else if (m.ev === 'list') lists++;
        }
    });
    await until(() => statusNow, 5000, 'the first status');
    assert.strictEqual(statusNow.touch, false);
    assert.strictEqual(statusNow.touchAvailable, true, 'mgu-render\'s client there: the touch screen offered');
    assert.strictEqual(statusNow.link, 'http://172.20.10.2:18490/?t=' + fs.readFileSync(path.join(state, 'token'), 'utf8').trim());

    /* shown: the app area, one opaque pixmap, whole at first */
    send({ cmd: 'touch', on: true });
    await until(() => logged().some((o) => o.op === 'frame'), 5000, 'the touch screen drawn');
    await until(() => statusNow.touch === true && statusNow.touchWanted === true, 3000, 'the status says it shows');
    const L = logged();
    const place = L.filter((o) => o.op === 'place')[0], pm = L.filter((o) => o.op === 'pixmap')[0];
    assert.deepStrictEqual([place.x, place.y, place.w, place.h], [108, 82, 1790, 638], 'placed in the app area');
    assert.deepStrictEqual([pm.w, pm.h, pm.format], [1790, 638, 'rgbx'], 'one opaque pixmap the size of the area');
    assert.strictEqual(L.filter((o) => o.op === 'pixels')[0].area, 1790 * 638, 'sent whole first');
    console.log('ok   shown in the app area (1790x638+108+82) as one opaque pixmap');

    /* Cast to cluster off and on by its toggle; a tap redraws parts */
    const n0 = logged().length;
    await tap(at('enabled', 'cast'));
    await until(() => statusNow.enabled === false, 3000, 'Cast off by touch');
    const px = logged().slice(n0).filter((o) => o.op === 'pixels');
    assert(px.length >= 1 && px.every((o) => o.area < 1790 * 638), 'only parts redrawn: ' + px.map((o) => o.area).join(', '));
    await tap(at('enabled', 'cast'));
    await until(() => statusNow.enabled === true, 3000, 'Cast on by touch');
    fs.writeFileSync(path.join(OUT, 'cast_tool.png'), writePng(1790, 638, fs.readFileSync(LOG + '.1.rgba')));
    console.log('ok   Cast to cluster off and on by its toggle; ' + px.length + ' parts redrawn (' + px.map((o) => o.area).join(', ') + ' px)');

    /* the car moves: the touch screen stays (map settings on the move);
     * shown when asked while moving; parked again: still up */
    const closes = logged().filter((o) => o.op === 'close').length;
    send({ cmd: 'speed', kmh: 40 });
    await until(() => statusNow.moving === true, 3000, 'moving in the status');
    await wait(1200);
    assert(statusNow.touch === true, 'still shown while moving');
    assert(logged().filter((o) => o.op === 'close').length === closes, 'its mgu-render client kept');
    errors = [];
    send({ cmd: 'touch', on: false });
    await until(() => statusNow.touch === false, 3000, 'hidden by the app');
    send({ cmd: 'touch', on: true });
    await until(() => statusNow.touch === true, 3000, 'shown while moving');
    assert(!errors.length, 'not refused while moving: ' + errors.join('; '));
    send({ cmd: 'speed', kmh: 0 });
    await until(() => statusNow.moving === false, 3000, 'parked again');
    assert(statusNow.touch === true, 'still shown parked');
    console.log('ok   the touch screen stays while the car moves, and shows when asked while moving');

    /* the List corner: {"ev":"list"}, hidden */
    await wait(300);
    await tap(at('_list', 'cast'));
    await until(() => lists === 1 && statusNow.touch === false && statusNow.touchWanted === false, 3000, 'List');
    console.log('ok   the List corner: {"ev":"list"} to the app, the touch screen hidden');

    if (!fs.existsSync(FFMPEG)) {
        console.log('skip this screen and the CarPlay preview: no ffmpeg at ' + FFMPEG + ' (CAST_FFMPEG, or node tools/fetch_ffmpeg.js)');
        return finish(0);
    }
    /* a stream on this screen: the touch screen gives way, and comes back */
    const clip = path.join(tmp, 'clip.ts');
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-f', 'mpegts', clip]);
    web = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'video/mp2t' }); res.end(fs.readFileSync(clip)); }).listen(18495, '127.0.0.1');
    const token = fs.readFileSync(path.join(state, 'token'), 'utf8').trim();
    const post = (p, o) => new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: 18490, path: p, method: 'POST', headers: { 'X-Cast-Token': token } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        r.on('error', reject); r.end(JSON.stringify(o));
    });
    assert.strictEqual(await post('/api/play', { url: 'http://127.0.0.1:18495/clip.ts', output: 'hud', audio: false }), 200);
    await until(() => statusNow.state !== 'playing', 15000, 'the clip played on the HUD');
    send({ cmd: 'touch', on: true });
    await until(() => statusNow.touch === true, 3000, 'shown');
    await wait(300);
    const n1 = logged().length;
    await tap(at('replay', 'cast', 1318 * 5 / 6));
    await until(() => statusNow.state === 'playing' && statusNow.output === 'console', 5000, 'played again on this screen');
    await until(() => statusNow.touch === false && statusNow.touchWanted === true, 3000, 'the touch screen gives way, still wanted');
    const L1 = logged().slice(n1);
    const closeAt = L1.findIndex((o) => o.op === 'close'), videoAt = L1.findIndex((o) => o.op === 'video' && o.file);
    assert(closeAt >= 0 && videoAt > closeAt, 'the touch screen\'s client closed before the stream\'s showed');
    await until(() => statusNow.state !== 'playing', 15000, 'the clip ended');
    await until(() => statusNow.touch === true, 3000, 'the touch screen back');
    console.log('ok   a stream on this screen: the touch screen gives way (its client closed first) and comes back when it ends');

    /* the CarPlay map from the CarPlay tab; its live preview */
    await tap(tabX(1));
    await wait(300);
    await tap(at('cpOut', 'carplay', 100));
    await until(() => statusNow.state === 'playing' && statusNow.source === 'carplay' && statusNow.output === 'map', 5000, 'the CarPlay map on the cluster');
    assert(/a preview for the touch screen/.test(out), 'its ffmpeg has the preview output');
    const stream = path.join(tmp, 'cp.h264');
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=984x480:rate=16', '-t', '4', '-pix_fmt', 'yuv420p', '-c:v', 'libx264',
        '-preset', 'ultrafast', '-x264-params', 'keyint=1000:repeat-headers=1', '-f', 'h264', stream]);
    let sock = null;
    for (let i = 0; i < 50 && !sock; i++) {
        sock = await new Promise((r) => { const s = net.connect(46411, '127.0.0.1'); s.once('connect', () => r(s)); s.once('error', () => { s.destroy(); r(null); }); });
        if (!sock) await wait(100);
    }
    assert(sock, 'ffmpeg listens for the hook');
    const n2 = logged().length;
    const pvArea = view.PREVIEW.w * view.PREVIEW.h;
    /* the hook's pace: 16 pictures a second */
    const data = fs.readFileSync(stream);
    for (let i = 0; i < 40; i++) { sock.write(data.slice(Math.floor(i * data.length / 40), Math.floor((i + 1) * data.length / 40))); await wait(100); }
    sock.end();
    const pv = logged().slice(n2).filter((o) => o.op === 'pixels' && o.rects.some((r) => r.w * r.h >= pvArea));
    assert(pv.length >= 3, 'the preview drawn as its pictures come (' + pv.length + ' in 4 s)');
    assert(statusNow.frames >= 30, 'the cluster\'s output went on: ' + statusNow.frames + ' frames');
    fs.writeFileSync(path.join(OUT, 'cast_tool_carplay.png'), writePng(1790, 638, fs.readFileSync(LOG + '.1.rgba')));
    console.log('ok   the CarPlay map played from the CarPlay tab; its live preview drawn ' + pv.length + ' times in 4 s while ' + statusNow.frames + ' frames went to the cluster');
    finish(0);
})().catch((e) => { console.error('FAIL ' + e.message + '\n--- the tool said:\n' + out.slice(-3000)); finish(1); });

function finish(code) {
    if (!code) { console.log('     the pictures: ' + OUT); console.log('all touch tests passed'); }
    if (process.env.TOUCH_TEST_LOG) console.log(out);
    try { if (ctl) ctl.destroy(); } catch (e) { /* gone */ }
    if (web) web.close();
    if (srv) srv.kill('SIGTERM');
    setTimeout(() => process.exit(code), 600);
}
