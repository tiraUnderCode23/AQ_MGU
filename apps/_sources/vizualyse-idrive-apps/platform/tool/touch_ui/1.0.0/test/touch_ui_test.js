// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * The touch kit, off the car:
 *   - every kind drawn in the frame (a gallery screen), no tappable widget
 *     under 64 px, outside the app area or over another;
 *   - only what changed is redrawn: a press redraws its button, a tab its
 *     body; the picture after a partial redraw equals a full one;
 *   - what a touch hits (seg options, tabs, a dropdown's sheet);
 *   - TouchScreen end to end against a stand-in mgu-render client: shown in
 *     the app area, a tap acts, the List corner emits 'list', a dropdown's
 *     sheet chooses, a toggle flips, a swipe, an error in the status line;
 *   - how long a frame takes (printed).
 *   node test/touch_ui_test.js [out.png]   (the gallery, to look at)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HERE = path.resolve(__dirname, '..');
const kit = require(path.join(HERE, 'ui_kit.js'));
const { TouchScreen } = require(path.join(HERE, 'ui_host.js'));
const { writePng } = require(path.join(HERE, 'ui_png.js'));

const OUT = process.argv[2] || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tui-')), 'gallery.png');
const F = kit.loadFonts(HERE);
const now = () => { const t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; };
let failures = 0;
function check(ok, what) { if (!ok) { failures++; console.log('FAIL ' + what); } else console.log('ok   ' + what); }

/* a picture to draw */
function picture(w, h) {
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; rgba[i] = x * 255 / w; rgba[i + 1] = 60; rgba[i + 2] = y * 255 / h; rgba[i + 3] = 255; }
    return { w: w, h: h, rgba: rgba };
}
const PIC = picture(560, 210), THUMB = picture(207, 84);
const QR = Array.from({ length: 25 }, (r, i) => Array.from({ length: 25 }, (c, j) => ((i * 7 + j * 3) % 5 === 0) || (i < 7 && j < 7)));

/* the gallery: every kind */
function gallery(m, ui) {
    const body = [];
    if (ui.tab === 'one') {
        body.push({ id: 'card', kind: 'panel', x: 0, y: 0, w: 560, h: 210 });
        body.push({ id: 'chip', kind: 'chip', x: 24, y: 24, w: kit.chipW(F, 'Running · 28 pictures/s'), h: 36, text: 'Running · 28 pictures/s', tone: 'live' });
        body.push({ id: 'title', kind: 'text', x: 24, y: 70, w: 512, h: 58, font: 'f44', text: 'Vampire Survivors' });
        body.push({ id: 'prog', kind: 'progress', x: 24, y: 160, w: 512, h: 12, value: 0.42 });
        body.push({ id: 'primary', kind: 'button', x: 584, y: 0, w: 320, h: 80, label: 'Show on the screen', icon: 'play', style: 'primary', act: true });
        body.push({ id: 'secondary', kind: 'button', x: 584, y: 92, w: 320, h: 80, label: 'Try on the cluster', sub: 'for 10 s, then back', act: true });
        body.push({ id: 'disabled', kind: 'button', x: 916, y: 0, w: 260, h: 80, label: 'Resume last', sub: 'while nothing streams', act: true, on: false });
        ['back', 'reload', 'home', 'minus', 'plus', 'stop'].forEach((ic, i) => body.push({ id: 'ic' + i, kind: 'button', x: 916 + i * 92, y: 92, w: 80, h: 80, icon: ic, act: true }));
        body.push({ id: 'seg', kind: 'seg', x: 0, y: 230, w: 560, h: 80, options: [{ v: 'auto', l: 'Auto', s: 'by drive mode' }, { v: 'sport', l: 'Sport', s: 'always' }, { v: 'comfort', l: 'Comfort', s: 'always' }], value: m.mode, act: true });
        body.push({ id: 'tog', kind: 'toggle', x: 584, y: 230, w: 560, h: 80, label: 'Directions card', sub: 'on the cluster, at once', value: m.on, act: true });
        body.push({ id: 'dd', kind: 'dropdown', x: 1168, y: 230, w: 574, h: 80, label: 'Picture on', options: [{ v: 'console', l: 'Centre console' }, { v: 'cluster', l: 'Cluster' }, { v: 'hud', l: 'HUD' }], value: m.out, act: true });
        body.push({ id: 'hero', kind: 'image', x: 0, y: 330, w: 280, h: 105, img: picture(280, 105), imgKey: 'p', r: 14, swipe: true });
        body.push({ id: 'tile', kind: 'tile', x: 300, y: 330, w: 219, h: 96, img: THUMB, imgKey: 't', caption: 'G20 inspired 1', current: true, act: true });
        body.push({ id: 'info', kind: 'info', x: 540, y: 330, w: 600, h: 120, rows: [['Host', 'GAMING-PC'], ['Pictures', '60 fps · GPU']] });
        body.push({ id: 'qr', kind: 'qr', x: 1168, y: 330, w: 128, h: 128, matrix: QR });
    } else {
        body.push({ id: 'big', kind: 'image', x: 0, y: 0, w: 560, h: 210, img: PIC, imgKey: 'big', r: 14 });
    }
    return { tabs: [['one', 'Gallery'], ['two', 'Picture']], status: { tone: 'ok', text: 'Ready', right: 'Parked · 0 mph' }, body: body };
}

/* ---- the look ---- */
const model = { mode: 'auto', on: true, out: 'console' };
const W1 = kit.frame(F, Object.assign(gallery(model, { tab: 'one' }), { tab: 'one' }), { open: null });
const problems = kit.lint(W1);
check(problems.length === 0, 'the gallery lints clean' + (problems.length ? ': ' + problems.join('; ') : ''));
const s = new kit.Surface(F);
let t0 = now();
const full = s.render(W1, null);
let fullMs = now() - t0;
for (let i = 0; i < 3; i++) { s.reset(); s.render(W1, null); }
t0 = now(); for (let i = 0; i < 5; i++) { s.reset(); s.render(W1, null); } fullMs = (now() - t0) / 5;
check(full.length === 1 && full[0].w === kit.AREA.w && full[0].h === kit.AREA.h, 'the first render is the whole picture');
check(s.render(W1, null).length === 0, 'nothing changed: nothing redrawn');
fs.writeFileSync(OUT, writePng(kit.AREA.w, kit.AREA.h, s.cv.px));
console.log('     gallery: ' + OUT);

/* a press redraws its button only */
const btn = W1.filter((d) => d.id === 'secondary')[0];
t0 = now();
const pr = s.render(W1, { id: 'secondary', part: 0 });
const pressMs = now() - t0;
check(pr.length === 1 && pr[0].x === btn.x && pr[0].y === btn.y && pr[0].w === btn.w && pr[0].h === btn.h, 'a press redraws its button alone (' + JSON.stringify(pr) + ')');
check(s.stats.redrawn === 1, 'one widget redrawn for a press (' + s.stats.redrawn + ')');

/* partial redraws equal a full one */
const model2 = { mode: 'sport', on: false, out: 'hud' };
const W2 = kit.frame(F, Object.assign(gallery(model2, { tab: 'one' }), { tab: 'one' }), { open: 'dd' });
s.render(W2, null);
const fresh = new kit.Surface(F);
fresh.render(W2, null);
check(Buffer.compare(s.cv.px, fresh.cv.px) === 0, 'after partial redraws the picture equals a full one (seg, toggle, an open sheet)');
check(W2.some((d) => d.kind === 'sheet'), 'an open dropdown has its sheet');

/* a tab change redraws the tabs and the body, not the corner or status */
const W3 = kit.frame(F, Object.assign(gallery(model2, { tab: 'two' }), { tab: 'two' }), { open: null });
const tr = s.render(W3, null);
check(!tr.some((r) => r.y >= kit.STATUS.y), 'a tab change leaves the status line alone');

/* hits */
const segW = W1.filter((d) => d.id === 'seg')[0];
check(kit.hit(F, W1, segW.x + segW.w - 10, segW.y + 40).part === 2, 'the seg\'s third option');
check(kit.hit(F, W1, kit.TOP.x + 210, kit.TOP.y + 30).part === 1, 'the second tab');
check(kit.hit(F, W1, kit.CORNER.x + 10, kit.CORNER.y + 10).w.id === '_list', 'the List corner');
check(kit.hit(F, W1, 5, 300) === null, 'nothing between widgets');

console.log('     full frame ' + fullMs.toFixed(1) + ' ms, a press ' + pressMs.toFixed(2) + ' ms (' + process.version + ')');

/* ---- TouchScreen against a stand-in client ---- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-'));
const clientPath = path.join(tmp, 'client.js');
fs.writeFileSync(clientPath, `
const EventEmitter = require('events');
const ops = [];
class RenderClient extends EventEmitter {
  constructor(name) { super(); ops.push({ op: 'new', name }); }
  connect() { setTimeout(() => this.emit('ready', { w: 1920, h: 720 }, { appArea: { x: 108, y: 82, w: 1790, h: 638 } }), 5); }
  mode() {} place(p) { ops.push({ op: 'place', p }); } show(on) { ops.push({ op: 'show', on }); }
  pixmap(id, w, h) { ops.push({ op: 'pixmap', w, h }); }
  pixels(id, rects, data) { if (data.length !== 1790 * 638 * 4) throw new Error('size'); ops.push({ op: 'pixels', area: rects.reduce((a, r) => a + r.w * r.h, 0) }); }
  frameWords() {} close() { ops.push({ op: 'close' }); }
}
module.exports = { RenderClient, imageOp: () => new Uint32Array(7), ops };`);
const ops = require(clientPath).ops;
const acts = [];
const st = { mode: 'auto', on: true, out: 'console' };
const ui = new TouchScreen({ name: 'test', dir: HERE, clientPath: clientPath, log: () => {}, touch: { python: path.join(tmp, 'none') },
    state: () => st, view: gallery,
    act: (id, v) => { acts.push([id, v]); if (id === 'seg') st.mode = v; if (id === 'tog') st.on = v; if (id === 'dd') st.out = v; return id === 'disabled' ? 'no' : id === 'secondary' ? 'the cluster is busy' : null; } });
let listed = 0;
ui.on('list', () => listed++);
const wait = (n) => new Promise((r) => setTimeout(r, n || 60));
const at = (id, dx, dy) => { const w = ui.widgets.filter((d) => d.id === id)[0]; return [108 + w.x + (dx === undefined ? w.w / 2 : dx), 82 + w.y + (dy === undefined ? w.h / 2 : dy)]; };
const tap = async (xy) => { ui.onTouch(1, xy[0], xy[1]); await wait(45); ui.onTouch(2, xy[0] + 3, xy[1]); ui.onTouch(3, xy[0] + 3, xy[1]); };

(async () => {
    check(ui.show() === null, 'shown');
    await wait(80);
    check(ops.some((o) => o.op === 'pixmap' && o.w === 1790 && o.h === 638) && ops.some((o) => o.op === 'show' && o.on), 'one pixmap the size of the app area, shown');
    const before = ops.length;
    await tap(at('primary'));
    await wait();
    check(acts.some((a) => a[0] === 'primary'), 'a tap acts');
    const sent = ops.slice(before).filter((o) => o.op === 'pixels');
    check(sent.length >= 1 && sent.every((o) => o.area <= 320 * 80 * 2), 'a press and its release send only the button (' + sent.map((o) => o.area).join(', ') + ' px)');
    await tap(at('seg', 520 * 2 / 3 + 40));
    await wait();
    check(st.mode === 'comfort', 'the seg chooses');
    await tap(at('tog'));
    await wait();
    check(st.on === false, 'the toggle flips');
    await tap(at('dd'));
    await wait();
    check(ui.widgets.some((d) => d.id === '_sheet'), 'a dropdown opens its sheet');
    await tap(at('_sheet', 40, 6 + 66 * 2 + 30));
    await wait();
    check(st.out === 'hud' && !ui.widgets.some((d) => d.id === '_sheet'), 'the sheet chooses and closes');
    await tap(at('disabled'));
    await wait();
    check(!acts.some((a) => a[0] === 'disabled'), 'a disabled button does nothing');
    await tap(at('secondary'));
    await wait();
    check(ui.widgets.filter((d) => d.id === '_status')[0].text === 'Error: the cluster is busy', 'an error shows in the status line');
    const h = at('hero');
    ui.onTouch(1, h[0] + 60, h[1]); ui.onTouch(2, h[0] - 20, h[1]); ui.onTouch(3, h[0] - 60, h[1]);
    await wait();
    check(acts.some((a) => a[0] === 'hero' && a[1] === 'next'), 'a swipe left is next');
    const moved = at('primary');
    const n = acts.length;
    ui.onTouch(1, moved[0], moved[1]); ui.onTouch(2, moved[0] + 60, moved[1]); ui.onTouch(3, moved[0] + 60, moved[1]);
    await wait();
    check(acts.length === n, 'a finger that slides off is not a tap');
    await tap(at('_tabs', 210, 30));
    await wait();
    check(ui.ui.tab === 'two' && ui.widgets.some((d) => d.id === 'big'), 'a tab shows its body');
    await tap(at('_list'));
    await wait();
    check(listed === 1, 'the List corner asks for the list');
    ui.hide('done');
    check(!ui.shown() && ops.some((o) => o.op === 'close'), 'hidden');
    if (failures) { console.log(failures + ' failed'); process.exit(1); }
    console.log('all passed');
})().catch((e) => { console.log(e.stack); process.exit(1); });
