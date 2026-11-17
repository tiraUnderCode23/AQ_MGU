// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * The browser's touch screen, off the car (no Chromium: a stand-in
 * browser.js and unpack.js, test/fake/):
 *   - its look (touch_view.js in the touch kit): every target 64 px or more,
 *     inside the app area, none overlapping (the kit's lint), in both tabs,
 *     running, off, without a link, with the resolution's sheet open; the
 *     phone page's QR code decodes to a square of the right size; a press
 *     redraws its button alone; Browse and Settings drawn to PNGs;
 *   - the tool end to end: server.js from a kit assembled from
 *     component.json in a temp folder, a stand-in mgu-render client
 *     (test/fake/render_client.js) and touches from a stand-in reader
 *     (test/fake/touch.js), driven over the control socket as the iDrive app
 *     drives it: {"cmd":"ui","on":true} shows the touch screen in the app
 *     area as one opaque pixmap; Back, Reload, Home reach the browser; the
 *     resolution from its dropdown, game mode and the browser off / on from
 *     Settings; Show on the screen hides the touch screen (its mgu-render
 *     client closed) before the browser's goes up; the browser hidden: the
 *     touch screen back; "ui" with browser: the page at once; the car
 *     moving hides the browser, the touch screen back in its place (Show
 *     refused, "ui" not); the List corner sends {"ev":"list"};
 *     "ui" off hides it.
 *   node test/touch_test.js [out dir]   (Linux, root: the tool's folders are
 *   under /var/opt; run_touch_test.sh runs it in Node 8)
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vzc-'));
const OUT = process.argv[2] || tmp;
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

/* the kit: the tool's files as installed, but the browser and its bundle */
try { execFileSync(process.execPath, [path.join(ROOT, 'platform', 'platform.js'), 'sync', HERE], { stdio: 'ignore' }); }
catch (e) { if (!fs.existsSync(path.join(HERE, 'src', 'ui_kit.js'))) throw e; }
const kit = path.join(tmp, 'kit');
fs.mkdirSync(kit);
const comp = JSON.parse(fs.readFileSync(path.join(HERE, 'component.json'), 'utf8'));
comp.files.filter((f) => !/^build\//.test(f.from)).forEach((f) => fs.copyFileSync(path.join(HERE, f.from), path.join(kit, f.path)));
['browser.js', 'unpack.js'].forEach((n) => fs.copyFileSync(path.join(HERE, 'test', 'fake', n), path.join(kit, n)));

const kitUi = require(path.join(kit, 'ui_kit.js'));
const view = require(path.join(kit, 'touch_view.js'));
const { qrMatrix } = require(path.join(kit, 'touch_screen.js'));
const { writePng } = require(path.join(kit, 'ui_png.js'));
const F = kitUi.loadFonts(kit);

/* ---- the look ---- */
const LINK = 'http://192.168.43.1:8491/?t=0123456789abcdef';
const GPU = { mode: 'cpu', webgpu: 'google / swiftshader', webgpuFallback: true, webgpuCompute: 'ok', webgl2: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', jspi: 'ok' };
const RES = [[1, 1790, 638], [0.75, 1340, 476], [0.5, 892, 316], [1 / 3, 596, 212], [0.25, 444, 156]].map((r) => ({ scale: r[0], w: r[1], h: r[2] }));
const base = { enabled: true, bundle: 'ready', browser: 'running', paused: null, error: null, gpuMode: false, gameMode: false, gpuNote: null, gpu: GPU,
    scale: 0.75, resolutions: RES, moving: false, kmh: 0, link: LINK, uplink: 'online', url: 'https://www.shadertoy.com/view/4tjGRh', title: 'Shadertoy BETA', oomMb: null, qr: qrMatrix(LINK) };
function widgets(m, tab, open) { return kitUi.frame(F, Object.assign(view.view(m, { tab: tab }), { tab: tab }), { open: open || null }); }
function find(ws, id) { const w = ws.filter((d) => d.id === id)[0]; if (!w) throw new Error('no ' + id); return w; }
const looks = [['running', base], ['off', Object.assign({}, base, { enabled: false, browser: 'off', link: null })],
    ['no link', Object.assign({}, base, { link: null, uplink: 'offline' })], ['starting', Object.assign({}, base, { browser: 'starting', gpuMode: true, gpu: null })],
    ['moving', Object.assign({}, base, { moving: true, kmh: 40 })], ['a GPU note', Object.assign({}, base, { gpuNote: 'the GPU did not start: back on the CPU' })]];
looks.forEach((l) => ['browse', 'settings'].forEach((tab) => {
    const problems = kitUi.lint(widgets(l[1], tab));
    assert.deepStrictEqual(problems, [], l[0] + ', ' + tab + ': ' + problems.join('; '));
}));
const sheetOpen = widgets(base, 'settings', 'resolution');
assert.deepStrictEqual(kitUi.lint(sheetOpen), [], 'the resolution sheet: ' + kitUi.lint(sheetOpen).join('; '));
assert.strictEqual(find(sheetOpen, '_sheet').options.length, 5, 'the sheet has the tool\'s five scales');
assert.ok(find(sheetOpen, '_sheet').y + find(sheetOpen, '_sheet').h <= kitUi.AREA.h, 'the sheet fits');
assert.strictEqual(find(widgets(base, 'browse'), 'show').on, true, 'Show on while running and parked');
assert.strictEqual(find(widgets(looks[4][1], 'browse'), 'show').on, false, 'Show off while moving');
assert.strictEqual(find(widgets(looks[1][1], 'settings'), 'gpuMode').on, false, 'GPU mode off while the browser is off');
assert.strictEqual(find(widgets(looks[1][1], 'settings'), 'enabled').on, undefined, 'the Browser toggle always works');
assert.ok(/WebGPU: CPU \(SwiftShader\) · WebGL 2: CPU \(SwiftShader\) · JSPI: ok/.test(find(widgets(base, 'browse'), 'gpu').rows[0][1]), 'the GPU row');
/* the QR code: version 3 or so for the link, with its quiet zone, drawn whole in its box */
const q = base.qr, qw = find(widgets(base, 'browse'), 'qr');
assert.ok(q.length >= 25 + 4 && q.every((r) => r.length === q.length), 'a square code with a quiet zone (' + q.length + ')');
assert.ok(Math.floor((qw.w - 28) / q.length) >= 6, 'at least 6 px a module (' + Math.floor((qw.w - 28) / q.length) + ')');
const sf = new kitUi.Surface(F);
let t0 = Date.now();
sf.render(widgets(base, 'browse'), null);
const fullMs = Date.now() - t0;
fs.writeFileSync(path.join(OUT, 'browser-browse.png'), writePng(kitUi.AREA.w, kitUi.AREA.h, sf.cv.px));
const W = widgets(base, 'browse');
const pressed = sf.render(W, { id: 'reload', part: 0 });
const rb = find(W, 'reload');
assert.deepStrictEqual(pressed, [{ x: rb.x, y: rb.y, w: rb.w, h: rb.h }], 'a press redraws its button alone');
const sf2 = new kitUi.Surface(F);
sf2.render(widgets(base, 'settings'), null);
fs.writeFileSync(path.join(OUT, 'browser-settings.png'), writePng(kitUi.AREA.w, kitUi.AREA.h, sf2.cv.px));
sf2.render(sheetOpen, null);
fs.writeFileSync(path.join(OUT, 'browser-settings-sheet.png'), writePng(kitUi.AREA.w, kitUi.AREA.h, sf2.cv.px));
console.log('ok   the look: both tabs lint clean in ' + looks.length + ' states and with the sheet open; a QR code of ' + q.length + ' modules; a full frame ' + fullMs + ' ms; a press redraws ' + rb.w * rb.h + ' px');
console.log('     ' + ['browser-browse.png', 'browser-settings.png', 'browser-settings-sheet.png'].map((n) => path.join(OUT, n)).join('\n     '));

if (process.platform === 'win32') { console.log('skip the tool end to end (Linux only: run_touch_test.sh)'); process.exit(0); }

/* ---- the tool end to end ---- */
const STATE = path.join(tmp, 'state'), CTL = path.join(tmp, 'ctl.sock');
const RLOG = path.join(tmp, 'render.log'), BLOG = path.join(tmp, 'browser.log'), TOUCH = path.join(tmp, 'touch.txt');
const AREA = { x: 108, y: 82 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms, what) {
    for (let i = 0; i < ms / 50; i++) { if (f()) return; await wait(50); }
    throw new Error('timed out: ' + what);
}
const rlog = () => { try { return fs.readFileSync(RLOG, 'utf8').split('\n').filter(Boolean); } catch (e) { return []; } };
const blog = () => { try { return fs.readFileSync(BLOG, 'utf8').split('\n').filter(Boolean); } catch (e) { return []; } };
/* touches at app-area points */
async function touch(lines) {
    await until(() => !fs.existsSync(TOUCH), 3000, 'the reader took the last touches');
    fs.writeFileSync(TOUCH, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify({ ev: 'touch', p: l[0], x: Math.round(l[1] + AREA.x), y: Math.round(l[2] + AREA.y) }))).join('\n') + '\n');
    await until(() => !fs.existsSync(TOUCH), 3000, 'the reader took the touches');
    await wait(250);
}
const tap = (p) => touch([[1, p[0], p[1]], 'wait 60', [3, p[0] + 2, p[1] + 1]]);
function centre(id, tab, dx, open) { const r = find(widgets(base, tab || 'browse', open), id); return [r.x + (dx === undefined ? r.w / 2 : dx), r.y + r.h / 2]; }

let tool, ctl, st = null, errors = [], out = '', lists = 0;
function send(c) { ctl.write(JSON.stringify(c) + '\n'); }

(async () => {
    tool = spawn(process.execPath, [path.join(kit, 'server.js')], {
        env: Object.assign({}, process.env, { CHROMIUM_STATE: STATE, CHROMIUM_CTL_SOCKET: CTL, CTL_OAP_DIR: path.join(tmp, 'oap'),
            CHROMIUM_RENDER_CLIENT: path.join(HERE, 'test', 'fake', 'render_client.js'), CHROMIUM_TEST_RENDER_LOG: RLOG, CHROMIUM_TEST_BROWSER_LOG: BLOG,
            CHROMIUM_VIDEO_FILE: path.join(tmp, 'mgu-video'), CHROMIUM_NO_FIREWALL: '1', CHROMIUM_NO_PROXY: '1', CHROMIUM_CGROUP_ROOT: path.join(tmp, 'no-cgroup'),
            CHROMIUM_TOUCH_IFACE: '', CHROMIUM_LINK_IP: '192.168.43.1', CHROMIUM_PORT: '18491', CHROMIUM_LOCAL_PORT: '18492', VZ_BUS_SOCKET: path.join(tmp, 'no-bus.sock'),
            CHROMIUM_UI_TOUCH_CMD: JSON.stringify([process.execPath, path.join(HERE, 'test', 'fake', 'touch.js'), TOUCH]) }),
        stdio: ['ignore', 'pipe', 'pipe'] });
    tool.stdout.on('data', (d) => { out += d; });
    tool.stderr.on('data', (d) => { out += d; });
    await until(() => fs.existsSync(CTL), 5000, 'the control socket');
    ctl = net.connect(CTL);
    ctl.on('error', () => {});
    ctl.setEncoding('utf8');
    let lb = '';
    ctl.on('data', (d) => {
        lb += d;
        let i;
        while ((i = lb.indexOf('\n')) >= 0) {
            const m = JSON.parse(lb.slice(0, i)); lb = lb.slice(i + 1);
            if (m.ev === 'status') st = m; else if (m.ev === 'error') errors.push(m.error); else if (m.ev === 'list') lists++;
        }
    });
    await until(() => st && st.browser === 'running', 5000, 'the (stand-in) browser running');
    assert.strictEqual(st.touch, false);
    send({ cmd: 'speed', kmh: 0 });

    /* the app's screen state open: the touch screen, in the app area, one opaque pixmap */
    send({ cmd: 'ui', on: true });
    await until(() => st.touch === true && st.touchWanted === true, 3000, 'status says the touch screen shows');
    await until(() => rlog().some((l) => /^pixels 1 /.test(l)), 3000, 'the touch screen drawn');
    let L = rlog();
    assert.ok(L.indexOf('new vizualyse_chromium_ui') >= 0, 'its own mgu-render client');
    assert.ok(L.indexOf('place 1790x638+108+82') >= 0, 'placed in the app area');
    assert.ok(L.indexOf('pixmap 1 1790x638 rgbx') >= 0, 'one opaque pixmap the size of the area');
    assert.ok(L.filter((l) => /^pixels 1 /.test(l))[0].split(' ')[3] === String(1790 * 638), 'sent whole first');
    assert.ok(L.indexOf('frame ops 18') >= 0, 'drawn by an IMAGE op');
    console.log('ok   ui on: the touch screen in the app area (1790x638+108+82), one opaque pixmap');

    /* Back, Reload, Home: to the browser, a part redrawn */
    const n0 = rlog().length;
    await tap(centre('reload'));
    await until(() => blog().indexOf('reload') >= 0, 3000, 'reload');
    const px = rlog().slice(n0).filter((l) => /^pixels 1 /.test(l)).map((l) => Number(l.split(' ')[3]));
    assert.ok(px.length >= 1 && px.every((a) => a < 1790 * 638 / 4), 'only parts redrawn: ' + px.join(', '));
    await tap(centre('back'));
    await until(() => blog().indexOf('history -1') >= 0, 3000, 'back');
    await tap(centre('home'));
    await until(() => blog().filter((l) => /^navigate /.test(l)).length >= 2, 3000, 'home');
    console.log('ok   Back, Reload and Home reach the browser; a tap redraws ' + px.join(' + ') + ' px');
    await wait(400);
    fs.writeFileSync(path.join(OUT, 'browser-tool-browse.png'), writePng(1790, 638, fs.readFileSync(RLOG + '.1.rgba')));

    /* Settings: the resolution from its dropdown, game mode, the browser off and on */
    await tap(centre('_tabs', 'browse', 300));
    await tap(centre('resolution', 'settings'));
    await wait(200);
    const sheet = find(widgets(base, 'settings', 'resolution'), '_sheet');
    await tap([sheet.x + 60, sheet.y + 6 + 2 * 66 + 32]);
    await until(() => st.scale === 0.5, 3000, 'the resolution 1/2');
    assert.ok(blog().indexOf('scale 0.5') >= 0, 'the browser told');
    await tap(centre('game', 'settings'));
    await until(() => st.gameMode === true, 3000, 'game mode on');
    await until(() => st.browser === 'running', 5000, 'running again in game mode');
    await wait(400);
    fs.writeFileSync(path.join(OUT, 'browser-tool-settings.png'), writePng(1790, 638, fs.readFileSync(RLOG + '.1.rgba')));
    await tap(centre('game', 'settings'));
    await until(() => st.gameMode === false, 3000, 'game mode off');
    await tap(centre('enabled', 'settings'));
    await until(() => st.enabled === false && st.browser === 'off', 3000, 'the browser off');
    assert.strictEqual(st.touch, true, 'the touch screen stays with the browser off');
    await tap(centre('enabled', 'settings'));
    await until(() => st.enabled === true && st.browser === 'running', 5000, 'the browser on again');
    console.log('ok   Settings: the resolution 1/2 from the dropdown, game mode on / off, the browser off and on (the touch screen stays)');

    /* Show on the screen: the touch screen's client closed before the browser's comes */
    await tap(centre('_tabs', 'settings', 100));
    const n1 = rlog().length;
    await tap(centre('show'));
    await until(() => st.shown === true && st.touch === false, 3000, 'the browser up, the touch screen down');
    L = rlog().slice(n1);
    const closed = L.indexOf('close'), opened = L.indexOf('new vizualyse_chromium');
    assert.ok(closed >= 0 && opened > closed, 'the touch screen\'s client closed before the browser\'s: ' + L.join(' | '));
    assert.ok(L.indexOf('video 1 ' + path.join(tmp, 'mgu-video')) > opened, 'the browser\'s picture shown');
    assert.strictEqual(st.touchWanted, true, 'still wanted: it comes back after');
    console.log('ok   Show on the screen: the touch screen hidden (its client closed), then the browser over the same screen state');

    /* the browser hidden (the phone, a restart): the touch screen back */
    send({ cmd: 'hide' });
    await until(() => st.shown === false && st.touch === true, 3000, 'the touch screen back');
    /* a new resolution while shown hides and shows the browser: the touch screen stays down */
    send({ cmd: 'ui', on: true, browser: true });
    await until(() => st.shown === true && st.touch === false, 3000, 'ui with browser: the page at once');
    const n2 = rlog().length;
    send({ cmd: 'scale', scale: 1 });
    await until(() => st.scale === 1, 3000, 'full resolution');
    await wait(300);
    assert.ok(!rlog().slice(n2).some((l) => l === 'new vizualyse_chromium_ui'), 'no touch screen between the hide and show of a new resolution');
    assert.strictEqual(st.shown, true);
    console.log('ok   the browser hidden: the touch screen back; "ui" with browser shows the page at once; a new resolution does not flash the touch screen');

    /* the car moving: the browser hidden, the touch screen back in its place */
    send({ cmd: 'speed', kmh: 30 });
    await until(() => st.shown === false && st.touch === true && st.touchWanted === true, 3000, 'the browser hidden, the touch screen back while moving');
    errors = [];
    send({ cmd: 'show' });
    await until(() => errors.length, 3000, 'Show refused while moving');
    assert.ok(/driving/.test(errors[0]), errors[0]);
    assert.strictEqual(st.touch, true, 'the touch screen stays');
    errors = [];
    send({ cmd: 'ui', on: false });
    await until(() => st.touch === false, 3000, 'hidden by the app');
    send({ cmd: 'ui', on: true });
    await until(() => st.touch === true, 3000, 'the touch screen shown while moving');
    assert.ok(!errors.length, 'not refused: ' + errors.join('; '));
    console.log('ok   the car moving hides the browser, the touch screen back in its place and shown while moving; Show refused');

    /* parked again: the List corner, and the app hiding it */
    send({ cmd: 'speed', kmh: 0 });
    send({ cmd: 'ui', on: true });
    await until(() => st.touch === true, 3000, 'shown again');
    await wait(300);
    lists = 0;
    await tap(centre('_list'));
    await until(() => lists === 1 && st.touch === false && st.touchWanted === false, 3000, 'List');
    send({ cmd: 'ui', on: true });
    await until(() => st.touch === true, 3000, 'shown again');
    send({ cmd: 'ui', on: false });
    await until(() => st.touch === false && st.touchWanted === false, 3000, 'hidden by the app');
    console.log('ok   the List corner: {"ev":"list"} to the app, the touch screen hidden; ui off hides it');
    const timing = out.split('\n').filter((l) => /touches to pixels/.test(l));
    /* (a summary after a List tap counts from that tap to the next show's first frame: the kit's, ui_host.js) */
    timing.forEach((l) => console.log('     ' + l.replace(/^\S+ /, '')));
    console.log('     ' + ['browser-tool-browse.png', 'browser-tool-settings.png'].map((n) => path.join(OUT, n)).join('\n     '));
    if (process.env.TOUCH_TEST_LOG) console.log(out);
    finish(0);
})().catch((e) => { console.error('FAIL ' + e.message + '\n--- the tool said:\n' + out.slice(-4000)); finish(1); });

function finish(code) {
    try { if (ctl) ctl.destroy(); } catch (e) { /* gone */ }
    if (tool) tool.kill('SIGTERM');
    setTimeout(() => process.exit(code), 700);
}
