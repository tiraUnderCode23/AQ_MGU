// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * Steam's touch screen, off the car:
 *   - its look (touch_view.js in the touch kit): every target 64 px or more,
 *     inside the app area, none overlapping (the kit's lint), in both tabs and
 *     every state drawn (a game running, starting, ended, none; a download;
 *     pages; an empty library; Steam off; the picture size's sheet open; no
 *     link); four games a page; the QR code decodes to the link's modules; a
 *     press redraws its button alone; the Library and Settings tabs as PNGs;
 *   - one picture at a time (touch_screen.js against a stand-in mgu-render
 *     client and a stand-in game): the app's screen state open, the touch
 *     screen; the game shown, the touch screen gone first; the game hidden or
 *     ended, the touch screen back while the state is open, not after; Show,
 *     Stop, Play (and its picture by itself once it draws), the pages, the
 *     picture's shape and size, upscaling, Steam on / off from taps; the List
 *     corner; the car moving (the game's picture goes, the touch screen
 *     stays and comes back in its place);
 *   - the tool end to end, where it can run (Linux, root: Node 8 in a
 *     container, below): server.js with no bundles, driven over the control
 *     socket as the iDrive app drives it, a stand-in mgu-render client, touches
 *     from a stand-in reader (test/fake_touch.js): {"cmd":"ui","on":true}
 *     shows the touch screen in the app area as one opaque pixmap; a tap on the
 *     Settings tab, the picture size from its sheet, upscaling, Steam off and
 *     on; the List corner sends {"ev":"list"} and hides it; the car moving
 *     keeps it, and it shows when asked while moving; off.
 *
 *   node test/touch_test.js [out dir]
 *   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/w" ml-unit:18.04-node8 sh -c \
 *       'cp -r /w /x && cd /x && node native/vizualyse-steam/test/touch_test.js'
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
/* the kit's copies (component.json "platform") */
try { execFileSync(process.execPath, [path.join(ROOT, 'platform', 'platform.js'), 'sync', HERE], { stdio: 'ignore' }); }
catch (e) { if (!fs.existsSync(path.join(HERE, 'src', 'ui_kit.js'))) throw e; }
const kit = require('../src/ui_kit.js');
const view = require('../src/touch_view.js');
const { writePng } = require('../src/ui_png.js');
const { SteamTouch, qrMatrix, nearest } = require('../src/touch_screen.js');
const qrcode = require('../src/qrcode.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vzs-ui-'));
const OUT = process.argv[2] || tmp;
const F = kit.loadFonts(path.join(HERE, 'src'));
const chipW = (t) => kit.chipW(F, t);
const now = () => { const t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; };

/* ---- the look ---- */
const RES = [
    { id: '960x540', shape: '16:9', short: '960 × 540 · the default' }, { id: '1136x640', shape: '16:9', short: '1136 × 640 · the size it is shown at' },
    { id: '1280x720', shape: '16:9', short: '1280 × 720 · more than is shown' }, { id: '848x480', shape: '16:9', short: '848 × 480 · lighter' },
    { id: '640x360', shape: '16:9', short: '640 × 360 · lightest' }, { id: '1344x480', shape: 'screen', short: '1344 × 480' },
    { id: '1792x640', shape: 'screen', short: '1792 × 640 · the screen, full size' }, { id: '1120x400', shape: 'screen', short: '1120 × 400 · lighter' },
    { id: '896x320', shape: 'screen', short: '896 × 320 · half: with FSR' }, { id: '672x240', shape: 'screen', short: '672 × 240 · lightest: with FSR' },
];
const LINK = 'http://172.20.10.2:8494/?t=0123456789abcdef';
const GAMES = [
    { appId: 1794680, name: 'Vampire Survivors', playable: true, why: null },
    { appId: 2868840, name: 'Slay the Spire 2', playable: true, why: null },
    { appId: 504230, name: 'Celeste', playable: false, why: 'Downloading' },
    { appId: 1145360, name: 'Hades', playable: false, why: '(no program found)' },
    { appId: 646570, name: 'Slay the Spire', playable: false, why: '(USB stick not plugged in)' },
    { appId: 250900, name: 'The Binding of Isaac: Rebirth', playable: true, why: null },
];
const BASE = { enabled: true, ready: true, line: { tone: 'ok', text: 'Vampire Survivors is running. Show puts it on the screen' }, right: 'Parked',
    game: { appId: 1794680, name: 'Vampire Survivors', state: 'running', fps: 28, gpuBuffers: true, note: null, shown: false },
    running: true, moving: false, library: GAMES, page: 0, download: { text: 'Downloading Celeste · 42 %', percent: 42 },
    resolution: '960x540', upscale: 'fsr', resolutions: RES, link: LINK, qr: qrMatrix(LINK) };
const M = (o) => Object.assign({}, BASE, o || {});
function widgets(m, tab, open) { return kit.frame(F, Object.assign(view.view(m, { tab: tab }, chipW), { tab: tab }), { open: open || null }); }
const STATES = [
    ['a game running, a download', M(), 'library'],
    ['page 2', M({ page: 1 }), 'library'],
    ['a game starting', M({ game: Object.assign({}, BASE.game, { state: 'starting', fps: 0 }), line: { tone: 'live', text: 'Starting Vampire Survivors (this can take a minute)...' } }), 'library'],
    ['a game ended', M({ game: Object.assign({}, BASE.game, { state: 'ended', note: 'the game ended before it drew anything (exit 1)' }), running: false, download: null }), 'library'],
    ['nothing ran', M({ game: null, running: false, download: { text: 'Steam Guard asks for a code: answer on the phone page', percent: null } }), 'library'],
    ['no games', M({ game: null, running: false, library: [], download: null }), 'library'],
    ['Steam off', M({ enabled: false, game: null, running: false, library: [], download: null, link: null, qr: null }), 'library'],
    ['moving', M({ moving: true, right: 'Moving · 19 mph' }), 'library'],
    ['Settings', M(), 'settings'],
    ['Settings, the screen\'s shape', M({ resolution: '896x320' }), 'settings'],
    ['Settings, the sheet open', M(), 'settings', 'res'],
    ['Settings, no link', M({ link: null, qr: null }), 'settings'],
    ['Settings, Steam off', M({ enabled: false, link: null, qr: null }), 'settings'],
];
STATES.forEach((s) => {
    const p = kit.lint(widgets(s[1], s[2], s[3]));
    assert.deepStrictEqual(p, [], s[0] + ': ' + p.join('; '));
});
const lib = widgets(M(), 'library');
assert.strictEqual(lib.filter((d) => /^play:/.test(d.id)).length, view.PER_PAGE, 'four games a page');
assert.strictEqual(widgets(M({ page: 1 }), 'library').filter((d) => /^play:/.test(d.id)).length, GAMES.length - view.PER_PAGE, 'the rest on page 2');
const byId = (ws, id) => ws.filter((d) => d.id === id)[0];
assert.strictEqual(byId(lib, 'prev').on, false, 'no page before the first');
assert.notStrictEqual(byId(lib, 'next').on, false, 'a next page');
assert.strictEqual(byId(lib, 'show').on, true, 'Show on: running, hidden, parked');
assert.strictEqual(byId(lib, 'play:1794680').on, false, 'no Play while a game runs');
assert.strictEqual(byId(lib, 'what:1794680').text, 'Running now');
assert.strictEqual(byId(lib, 'what:1145360').text, '(no program found)');
assert.strictEqual(byId(widgets(M({ running: false, game: null }), 'library'), 'play:2868840').on, true, 'Play on with nothing running');
assert.strictEqual(byId(widgets(M({ running: false, game: null }), 'library'), 'play:1145360').on, false, 'no Play without a program');
assert.strictEqual(byId(widgets(M({ moving: true }), 'library'), 'show').on, false, 'no Show while moving');
assert.strictEqual(byId(widgets(M({ game: Object.assign({}, BASE.game, { shown: true }) }), 'library'), 'show').on, false, 'no Show while shown');
const sheet = byId(widgets(M(), 'settings', 'res'), '_sheet');
assert.deepStrictEqual(sheet.options.map((o) => o.v), ['960x540', '1136x640', '1280x720', '848x480', '640x360'], 'the sheet: the sizes of the shape');
assert.deepStrictEqual(byId(widgets(M({ resolution: '896x320' }), 'settings', 'res'), '_sheet').options.length, 5, 'and of the screen\'s shape');
/* the QR code: the link's modules, a light border */
const q = qrcode(0, 'M'); q.addData(LINK); q.make();
const mx = qrMatrix(LINK), n = q.getModuleCount();
assert.strictEqual(mx.length, n + 4);
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) assert.strictEqual(mx[r + 2][c + 2], q.isDark(r, c));
assert.ok(mx[0].every((x) => !x) && mx[mx.length - 1].every((x) => !x), 'a light border');
/* the shape: the nearest size in pixels */
assert.strictEqual(nearest(RES, '960x540', 'screen').id, '1120x400');
assert.strictEqual(nearest(RES, '1792x640', '16:9').id, '1280x720');
const sf = new kit.Surface(F);
let t0 = now();
sf.render(lib, null);
const fullMs = now() - t0;
fs.writeFileSync(path.join(OUT, 'steam_library.png'), writePng(kit.AREA.w, kit.AREA.h, sf.cv.px));
const showB = byId(lib, 'show');
t0 = now();
const pr = sf.render(lib, { id: 'show', part: 0 });
const pressMs = now() - t0;
assert.deepStrictEqual(pr, [{ x: showB.x, y: showB.y, w: showB.w, h: showB.h }], 'a press redraws its button alone');
const tile = byId(lib, 'play:2868840');
const pt = sf.render(widgets(M({ running: false, game: null }), 'library'), null);
assert.ok(pt.length >= 1);
const sf2 = new kit.Surface(F);
sf2.render(widgets(M(), 'settings', 'res'), null);
fs.writeFileSync(path.join(OUT, 'steam_settings_sheet.png'), writePng(kit.AREA.w, kit.AREA.h, sf2.cv.px));
const sf3 = new kit.Surface(F);
t0 = now();
sf3.render(widgets(M(), 'settings'), null);
const setMs = now() - t0;
fs.writeFileSync(path.join(OUT, 'steam_settings.png'), writePng(kit.AREA.w, kit.AREA.h, sf3.cv.px));
console.log('ok   the look: ' + STATES.length + ' states lint clean, four games a page, the QR code (' + n + ' modules), a press redraws ' + showB.w * showB.h +
    ' px; a full frame ' + fullMs.toFixed(1) + ' ms (Settings ' + setMs.toFixed(1) + '), a press ' + pressMs.toFixed(1) + ' ms (' + process.version + '); tile ' + tile.w + 'x' + tile.h);
console.log('     ' + ['steam_library.png', 'steam_settings.png', 'steam_settings_sheet.png'].map((f) => path.join(OUT, f)).join('\n     '));

/* ---- the games' pictures (art.js's, made here from synthetic ones) ---- */
{
    const art = require('../src/art.js');
    const pic = (w, h, f) => { const b = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f(x, y); b[(y * w + x) * 4] = c[0]; b[(y * w + x) * 4 + 1] = c[1]; b[(y * w + x) * 4 + 2] = c[2]; b[(y * w + x) * 4 + 3] = c[3]; } return { w: w, h: h, rgba: b }; };
    const poster = pic(616, 353, (x, y) => [x * 255 / 616, 120 + (y % 40) * 3, 255 - y * 255 / 353, 255]);
    const icon = pic(64, 64, (x, y) => ((x - 32) * (x - 32) + (y - 32) * (y - 32) < 900 ? [240, 200, 40, 255] : [0, 0, 0, 0]));
    const made = {
        tile: { 1794680: art.finish(art.cover(poster, view.TILE.w, view.TILE.h), true, false), 2868840: art.finish(art.onPlate(icon, view.TILE.w, view.TILE.h, view.plate(2868840), 96, 20), false, false),
            504230: art.finish(art.cover(poster, view.TILE.w, view.TILE.h), true, true) },
        thumb: { 1794680: art.finish(art.cover(poster, view.THUMB.w, view.THUMB.h), false, false) },
    };
    const withArt = (o) => M(Object.assign({ art: (id, which) => (made[which][id] ? { img: made[which][id], key: which + id } : null) }, o || {}));
    [['pictures, a game running', withArt(), 'library'], ['pictures, nothing running', withArt({ game: null, running: false }), 'library'], ['pictures, page 2', withArt({ page: 1 }), 'library']].forEach((s) => {
        const p = kit.lint(widgets(s[1], s[2]));
        assert.deepStrictEqual(p, [], s[0] + ': ' + p.join('; '));
    });
    const la = widgets(withArt({ game: null, running: false }), 'library');
    const ids = la.map((d) => d.id);
    ['1794680', '2868840', '504230'].forEach((id) => {
        assert.ok(ids.indexOf('art:' + id) >= 0 && ids.indexOf('art:' + id) < ids.indexOf('play:' + id), 'the picture under its tile ' + id);
        assert.strictEqual(byId(la, 'play:' + id).under, undefined, 'no plate over the picture ' + id);
    });
    assert.strictEqual(ids.indexOf('art:1145360'), -1, 'no picture: none drawn');
    assert.notStrictEqual(byId(la, 'play:1145360').under, undefined, 'no picture: the plate as before');
    const card = widgets(withArt(), 'library');
    assert.ok(byId(card, 'gameArt') && byId(card, 'title').x > view.THUMB.x + view.THUMB.w, 'the running game\'s thumb, its name after it');
    assert.strictEqual(byId(widgets(withArt({ game: null, running: false }), 'library'), 'gameArt'), undefined, 'no game: no thumb');
    const sa = new kit.Surface(F);
    sa.render(card, null);
    fs.writeFileSync(path.join(OUT, 'steam_library_art.png'), writePng(kit.AREA.w, kit.AREA.h, sa.cv.px));
    const sb = new kit.Surface(F);
    sb.render(la, null);
    const tb = byId(la, 'play:2868840'), redraw = sb.render(la, { id: 'play:2868840', part: 0 });
    assert.deepStrictEqual(redraw, [{ x: tb.x, y: tb.y, w: tb.w, h: tb.h }], 'a press on a pictured tile redraws that tile');
    fs.writeFileSync(path.join(OUT, 'steam_library_art_pressed.png'), writePng(kit.AREA.w, kit.AREA.h, sb.cv.px));
    console.log('ok   the pictures: under their tiles, the plate without one, the running game\'s thumb, a press on a pictured tile');
    console.log('     ' + ['steam_library_art.png', 'steam_library_art_pressed.png'].map((f) => path.join(OUT, f)).join('\n     '));
}

/* ---- one picture at a time ---- */
const clientPath = path.join(tmp, 'client.js');
fs.writeFileSync(clientPath, `
const EventEmitter = require('events');
const ops = [];
class RenderClient extends EventEmitter {
  constructor(name) { super(); this.name = name; ops.push({ op: 'new', name }); }
  connect() { setTimeout(() => this.emit('ready', { w: 1920, h: 720 }, { appArea: { x: 108, y: 82, w: 1790, h: 638 } }), 5); }
  mode() {} place(p) { ops.push({ op: 'place', p }); } show(on) { ops.push({ op: 'show', on }); }
  pixmap(id, w, h) { ops.push({ op: 'pixmap', w, h }); }
  pixels(id, rects) { ops.push({ op: 'pixels', area: rects.reduce((a, r) => a + r.w * r.h, 0) }); }
  frameWords() {} close() { ops.push({ op: 'close', name: this.name }); }
}
module.exports = { RenderClient, imageOp: () => new Uint32Array(7), ops };`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 60));
const T = { moving: false, gameShown: false, model: M({ game: null, running: false, download: null }), acts: [] };
let ui = null;
/* the server's show / hide, as server.js calls the touch screen around the game */
const showGame = () => { if (T.moving) return 'not while driving'; if (!T.model.running) return 'no game is running'; if (T.gameShown) return null; ui.gameUp(); T.gameShown = true; return null; };
const hideGame = () => { T.gameShown = false; ui.gameGone(); };
ui = new SteamTouch({ dir: path.join(HERE, 'src'), clientPath: clientPath, log: () => {}, touch: { python: path.join(tmp, 'none') },
    state: () => Object.assign({}, T.model), moving: () => T.moving, gameShown: () => T.gameShown,
    actions: {
        show: () => { T.acts.push(['show']); return showGame(); },
        stop: () => { T.acts.push(['stop']); return null; },
        play: (id) => { T.acts.push(['play', id]); return null; },
        resolution: (id) => { T.acts.push(['resolution', id]); T.model.resolution = id; return null; },
        upscale: (id) => { T.acts.push(['upscale', id]); T.model.upscale = id; return null; },
        enable: (on) => { T.acts.push(['enable', on]); T.model.enabled = on; return null; },
    } });
let lists = 0;
ui.on('list', () => lists++);
const at = (id, dx, dy) => { const w = ui.ui.widgets.filter((d) => d.id === id)[0]; if (!w) throw new Error('no ' + id); return [108 + w.x + (dx === undefined ? w.w / 2 : dx), 82 + w.y + (dy === undefined ? w.h / 2 : dy)]; };
const tap = async (id, dx, dy) => { const p = at(id, dx, dy); ui.ui.onTouch(1, p[0], p[1]); await wait(30); ui.ui.onTouch(3, p[0] + 2, p[1] + 1); await wait(); };
const ops = () => require(clientPath).ops;
const upNow = () => { const o = ops(); let up = 0; o.forEach((x) => { if (x.op === 'new') up++; if (x.op === 'close') up--; }); return up; };
/* exactly one picture: never the touch screen and the game both */
const one = (what) => assert.ok(!(ui.shown() && T.gameShown) && upNow() <= 1, what + ': one picture at a time');

(async () => {
    assert.strictEqual(ui.want(true), null);
    await wait();
    assert.ok(ui.shown() && ops().some((o) => o.op === 'pixmap' && o.w === 1790 && o.h === 638), 'the screen state open: the touch screen');
    one('opened');
    /* a game: Play, then its picture by itself once it draws */
    await tap('play:2868840');
    assert.deepStrictEqual(T.acts.pop(), ['play', 2868840]);
    T.model = M({ game: Object.assign({}, BASE.game, { appId: 2868840, name: 'Slay the Spire 2', state: 'starting' }), running: true, download: null });
    ui.onGame({ o: { appId: 2868840 }, state: 'starting' });
    assert.ok(ui.shown() && !T.gameShown, 'starting: still the touch screen');
    T.model.game.state = 'running';
    ui.onGame({ o: { appId: 2868840 }, state: 'running' });
    await wait();
    assert.ok(T.gameShown && !ui.shown(), 'it draws: the game, the touch screen gone');
    one('the game up');
    /* hidden (the phone, or the app's hide): the touch screen back, the state still open */
    hideGame();
    await wait();
    assert.ok(ui.shown() && !T.gameShown, 'the game hidden: the touch screen back');
    one('back');
    /* Show from the touch screen */
    await tap('show');
    assert.ok(T.gameShown && !ui.shown(), 'Show: the game in its place');
    one('Show');
    /* the game ends: the touch screen back */
    T.model = M({ game: Object.assign({}, BASE.game, { appId: 2868840, name: 'Slay the Spire 2', state: 'ended', note: 'stopped' }), running: false, download: null });
    hideGame();
    await wait();
    assert.ok(ui.shown(), 'the game ended: the touch screen back');
    /* the app's state closed while the game is up: neither comes back */
    T.model.running = true;
    T.model.game.state = 'running';
    ui.refresh();
    await wait();
    await tap('show');
    assert.ok(T.gameShown);
    assert.strictEqual(ui.want(false), null);
    hideGame();
    await wait();
    assert.ok(!ui.shown() && !T.gameShown, 'the screen state closed: nothing back');
    /* opened again with the game up: the game stays, the touch screen when it goes */
    assert.strictEqual(showGame(), null);
    assert.strictEqual(ui.want(true), null);
    await wait();
    assert.ok(T.gameShown && !ui.shown(), 'opened over the game: the game stays');
    hideGame();
    await wait();
    assert.ok(ui.shown(), 'then the touch screen');
    console.log('ok   one picture at a time: the touch screen on the screen state; the game (Show, or a Play drawing) in its place; back when the game is hidden or ends; not once the state is closed');

    /* taps: Stop, the pages, Settings */
    await tap('stop');
    assert.deepStrictEqual(T.acts.pop(), ['stop']);
    T.model = M({ game: null, running: false, download: null });
    await wait(80);
    await tap('next');
    await wait(80);
    assert.ok(ui.ui.widgets.some((d) => d.id === 'play:250900') && !ui.ui.widgets.some((d) => d.id === 'play:1794680'), 'next: page 2');
    await tap('prev');
    await wait(80);
    assert.ok(ui.ui.widgets.some((d) => d.id === 'play:1794680'), 'prev: page 1');
    await tap('_tabs', 260, 30);
    await wait(80);
    assert.ok(ui.ui.widgets.some((d) => d.id === 'qr'), 'Settings: the QR code');
    await tap('shape', 450);
    assert.deepStrictEqual(T.acts.pop(), ['resolution', '1120x400'], 'the screen\'s shape: its nearest size');
    await wait(80);
    await tap('res');
    await wait(80);
    assert.ok(ui.ui.widgets.some((d) => d.id === '_sheet'), 'the sizes\' sheet');
    await tap('_sheet', 40, 6 + 66 * 3 + 30);
    assert.deepStrictEqual(T.acts.pop(), ['resolution', '896x320'], 'a size from the sheet');
    await wait(80);
    await tap('upscale', 50);
    assert.deepStrictEqual(T.acts.pop(), ['upscale', 'off']);
    await tap('enabled');
    assert.deepStrictEqual(T.acts.pop(), ['enable', false]);
    await wait(80);
    await tap('enabled');
    assert.deepStrictEqual(T.acts.pop(), ['enable', true]);
    console.log('ok   taps: Stop, the pages, Settings (the shape: its nearest size; a size from the sheet; upscaling; Steam off and on)');

    /* the List corner; the car moving */
    await tap('_list');
    assert.ok(lists === 1 && !ui.shown() && !ui.wanted, 'List: hidden, the app told');
    hideGame();
    await wait();
    assert.ok(!ui.shown(), 'and it stays down');
    assert.strictEqual(ui.want(true), null);
    await wait();
    assert.ok(ui.shown(), 'wanted again: shown');
    /* the car moving: the touch screen stays; the game's picture can't go
     * up; one already up goes (the server's hide), the touch screen back */
    const wasRunning = T.model.running;
    T.model.running = true;
    T.moving = true;
    assert.strictEqual(showGame(), 'not while driving', 'no game picture while moving');
    assert.ok(ui.shown(), 'moving: the touch screen stays');
    T.moving = false;
    assert.strictEqual(showGame(), null);
    assert.ok(!ui.shown(), 'the game up: the touch screen down');
    T.moving = true;
    hideGame();
    await wait();
    assert.ok(ui.shown(), 'driving hid the game: the touch screen back in its place');
    ui.want(false);
    assert.ok(!ui.shown(), 'hidden by the app');
    assert.strictEqual(ui.want(true), null, 'not refused while moving');
    await wait();
    assert.ok(ui.shown(), 'shown while moving');
    T.moving = false;
    T.model.running = wasRunning;
    ui.stop('done');
    one('the end');
    console.log('ok   the List corner hides it and tells the app; the car moving keeps it (the game\'s picture goes, the touch screen back in its place)');
    await endToEnd();
    console.log('all passed');
    process.exit(0);
})().catch((e) => { console.error('FAIL ' + (e.stack || e.message)); process.exit(1); });

/* ---- the tool end to end (Linux, root) ---- */
async function endToEnd() {
    if (process.platform !== 'linux' || !process.getuid || process.getuid() !== 0) {
        console.log('skip the tool end to end: needs Linux and root (Node 8 in a container, at the top)');
        return;
    }
    const LOG = path.join(tmp, 'render.log'), TOUCH = path.join(tmp, 'touch.txt'), CTL = path.join(tmp, 'ctl', 'ctl.sock');
    fs.writeFileSync(path.join(tmp, 'lease.json'), JSON.stringify({ ip: '172.20.10.2', dns: ['192.0.2.53'] }));
    const out = [];
    const tool = spawn(process.execPath, [path.join(HERE, 'src', 'server.js')], { stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { STEAM_ROOT: path.join(tmp, 'root'), STEAM_RUN_DIR: path.join(tmp, 'run'), STEAM_DNS_FILE: path.join(tmp, 'dns'),
            STEAM_NO_FIREWALL: '1', STEAM_LEASE: path.join(tmp, 'lease.json'), STEAM_CTL_SOCKET: CTL, CTL_OAP_DIR: path.join(tmp, 'oap'), STEAM_PORT: '18494',
            STEAM_SWAP_MB: '0', STEAM_SWAP_DELAY_MS: '600000', STEAM_CGROUP_ROOT: path.join(tmp, 'nocg'), STEAM_DISK: path.join(tmp, 'nodisk'),
            STEAM_USB_MEDIA: path.join(tmp, 'media'), VZ_BUS_SOCKET: path.join(tmp, 'nobus.sock'),
            STEAM_RUNTIME_ARCHIVE: path.join(tmp, 'none.tgz'), STEAM_RENDER_CLIENT: path.join(HERE, 'test', 'fake_render_client.js'), STEAM_TEST_RENDER_LOG: LOG,
            STEAM_UI_TOUCH_CMD: JSON.stringify([process.execPath, path.join(HERE, 'test', 'fake_touch.js'), TOUCH]) }) });
    tool.stdout.on('data', (d) => out.push(String(d)));
    tool.stderr.on('data', (d) => out.push(String(d)));
    const until = async (f, ms, what) => { for (let i = 0; i < ms / 50; i++) { if (f()) return; await wait(50); } throw new Error('timed out: ' + what + '\n' + out.join('').slice(-3000)); };
    const logged = () => { try { return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean); } catch (e) { return []; } };
    let st = null, errors = [], lists2 = 0, sock = null;
    try {
        await until(() => fs.existsSync(CTL), 8000, 'the control socket');
        sock = net.connect(CTL);
        sock.setEncoding('utf8');
        let buf = '';
        sock.on('data', (d) => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
                if (m.ev === 'status') st = m; else if (m.ev === 'error') errors.push(m.error); else if (m.ev === 'list') lists2++;
            }
        });
        const send = (c) => sock.write(JSON.stringify(c) + '\n');
        await until(() => st, 5000, 'the first status');
        assert.strictEqual(st.ui, false);
        send({ cmd: 'speed', kmh: 0 });
        send({ cmd: 'ui', on: true });
        await until(() => st.ui === true && logged().some((l) => /^vizualyse_steam_ui pixels 1 1142020$/.test(l)), 5000, 'the touch screen, whole first');
        const L = logged();
        assert.ok(L.indexOf('vizualyse_steam_ui place 1790x638+108+82') >= 0 && L.indexOf('vizualyse_steam_ui pixmap 1 1790x638 rgbx') >= 0, 'in the app area, one opaque pixmap');
        assert.ok(L.indexOf('vizualyse_steam_ui show true') >= 0, 'shown');
        assert.strictEqual(st.uiWanted, true);
        console.log('ok   the tool: {"cmd":"ui","on":true} shows the touch screen in the app area (1790x638+108+82), one opaque pixmap');
        const tapAt = async (id, tab, dx, dy, open) => {
            const m = { enabled: st.enabled, ready: st.bundle === 'ready', line: {}, right: '', game: null, running: false, moving: false, library: [], page: 0, download: null,
                resolution: st.settings.resolution, upscale: st.settings.upscale, resolutions: RES, link: st.link, qr: st.link ? [[true]] : null };
            const w = widgets(m, tab, open).filter((d) => d.id === id)[0];
            if (!w) throw new Error('no ' + id);
            const x = 108 + w.x + (dx === undefined ? w.w / 2 : dx), y = 82 + w.y + (dy === undefined ? w.h / 2 : dy);
            await until(() => !fs.existsSync(TOUCH), 3000, 'the reader took the last touches');
            fs.writeFileSync(TOUCH, [{ ev: 'touch', p: 1, x: Math.round(x), y: Math.round(y) }, 'wait 60', { ev: 'touch', p: 3, x: Math.round(x) + 2, y: Math.round(y) + 1 }]
                .map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
            await until(() => !fs.existsSync(TOUCH), 3000, 'the reader took the touches');
            await wait(250);
        };
        await tapAt('_tabs', 'library', 260, 30);
        await tapAt('res', 'settings');
        await tapAt('_sheet', 'settings', 40, 6 + 66 * 2 + 30, 'res');
        await until(() => st.settings.resolution === '1280x720', 3000, 'the picture size from the sheet');
        await tapAt('upscale', 'settings', 1290 - 60);
        await until(() => st.settings.upscale === 'fsr-soft', 3000, 'upscaling');
        await tapAt('enabled', 'settings');
        await until(() => st.enabled === false, 3000, 'Steam off');
        await tapAt('enabled', 'settings');
        await until(() => st.enabled === true, 3000, 'Steam on');
        await wait(400);
        fs.writeFileSync(path.join(OUT, 'steam_tool_settings.png'), writePng(1790, 638, fs.readFileSync(LOG + '.vizualyse_steam_ui.rgba')));
        console.log('ok   the tool: taps on the Settings tab: the picture size from its sheet, upscaling, Steam off and on (' + path.join(OUT, 'steam_tool_settings.png') + ')');
        await tapAt('_list', 'settings');
        await until(() => lists2 === 1 && st.ui === false && st.uiWanted === false, 3000, 'List');
        assert.ok(logged().indexOf('vizualyse_steam_ui close') >= 0, 'its client closed');
        send({ cmd: 'ui', on: true });
        await until(() => st.ui === true, 3000, 'shown again');
        send({ cmd: 'speed', kmh: 40 });
        await until(() => st.moving === true, 3000, 'moving in the status');
        await wait(1200);
        assert.ok(st.ui === true && st.uiWanted === true, 'still shown while moving');
        errors = [];
        send({ cmd: 'ui', on: false });
        await until(() => st.ui === false, 3000, 'hidden by the app while moving');
        send({ cmd: 'ui', on: true });
        await until(() => st.ui === true, 3000, 'shown while moving');
        assert.ok(!errors.length, 'not refused while moving: ' + errors.join('; '));
        send({ cmd: 'speed', kmh: 0 });
        await until(() => st.moving === false, 3000, 'parked');
        send({ cmd: 'ui', on: false });
        await until(() => st.ui === false && st.uiWanted === false, 3000, 'off');
        assert.ok(!logged().some((l) => /^vizualyse_steam /.test(l)), 'no game client');
        console.log('ok   the tool: the List corner sends {"ev":"list"} and hides it; kept while moving, shown when asked while moving; off');
    } finally {
        if (sock) sock.destroy();
        tool.kill('SIGTERM');
        await wait(400);
    }
}
