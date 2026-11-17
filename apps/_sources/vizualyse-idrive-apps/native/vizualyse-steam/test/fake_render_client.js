// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/* A stand-in for mgu-render's client (mgu_render_client.js) in the off-car
 * tests (a copy of vizualyse-chromium's test/fake/render_client.js): it says ready with a 1920x720 screen and an app area, and notes
 * what it is asked to draw in STEAM_TEST_RENDER_LOG, one line each, the
 * client's name first (the draw ops each time they change; for a pixmap's
 * pixels the area sent, and the whole pixmap in <log>.<name>.rgba). */
'use strict';
const EventEmitter = require('events');
const fs = require('fs');
const LOG = process.env.STEAM_TEST_RENDER_LOG;
function note(s) { if (LOG) fs.appendFileSync(LOG, s + '\n'); }
class RenderClient extends EventEmitter {
    constructor(name) { super(); this.name = name; note(name + ' new'); }
    connect() {
        setTimeout(() => this.emit('ready', { w: 1920, h: 720 }, { modes: ['layer'], video: true, appArea: { x: 108, y: 82, w: 1790, h: 638 }, embedBox: { x: 104, y: 88, w: 1796, h: 632 } }), 50);   /* the car's (2026-11-05) */
    }
    mode(m) { note(this.name + ' mode ' + m); }
    place(p) { note(this.name + ' place ' + p.w + 'x' + p.h + '+' + p.x + '+' + p.y); }
    video(id, file) { note(this.name + ' video ' + id + ' ' + file); }
    fps(f) { note(this.name + ' fps ' + f); }
    show(on) { note(this.name + ' show ' + on); }
    claim(r) { note(this.name + ' claim ' + JSON.stringify(r)); }
    pixmap(id, w, h, f) { note(this.name + ' pixmap ' + id + ' ' + w + 'x' + h + ' ' + f); }
    pixels(id, rects, data) {
        note(this.name + ' pixels ' + id + ' ' + (rects || []).reduce((a, r) => a + r.w * r.h, 0));
        if (LOG && data) fs.writeFileSync(LOG + '.' + this.name + '.rgba', data);
    }
    /* each new list of ops (not every frame) */
    frameWords(u32) {
        const ops = Array.from(u32).filter((v, i) => i % 7 === 0).join(',');
        if (ops !== this.ops) { this.ops = ops; note(this.name + ' frame ops ' + ops); }
    }
    close() { note(this.name + ' close'); }
}
function op(code) { return (id, x, y, w, h) => { const u = new Uint32Array(7); u[0] = code; u[1] = x; u[2] = y; u[3] = w; u[4] = h; u[6] = id; return u; }; }
module.exports = { RenderClient, videoOp: op(19), imageOp: op(18) };
