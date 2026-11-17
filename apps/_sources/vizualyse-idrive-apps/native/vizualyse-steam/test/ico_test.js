// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/* A game's icon from its program (src/ico.js), on programs made here: a
 * small PE with a resource section holding icons (a 256x256 PNG, a 32x32
 * 8-bit DIB with its AND mask, a 16x16 32-bit DIB with alpha, a 48x48 24-bit
 * one) in one group: the biggest that reads is taken, its pixels and
 * transparency as drawn; a PNG that doesn't read, the next; no group, no
 * resources, not a program, truncated or garbled: null, never a throw.
 * Node 8 (the unit's; ui_png.js from the touch kit: platform.js sync).
 *   node test/ico_test.js */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exeIcon } = require('../src/ico.js');
const { writePng } = require('../src/ui_png.js');

const FA = 0x200, SA = 0x1000;
const al = (v, a) => Math.ceil(v / a) * a;

/* ---- pictures ------------------------------------------------------------ */
function rgbaOf(w, h, f) {
    const b = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = f(x, y); b.writeUInt32BE(((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0, (y * w + x) * 4); }
    return b;
}
const PAT = (x, y) => [(x * 7) & 255, (y * 5) & 255, ((x + y) * 3) & 255, (x + y) % 3 ? 255 : 128];

/* a DIB icon: bpp 32 (alpha), 24, 8 (a palette of PAL8); mask: (x, y) => transparent */
const PAL8 = Array.from({ length: 256 }, (v, i) => [i, 255 - i, (i * 3) & 255]);
function dib(w, h, bpp, px, mask) {
    const stride = ((w * bpp + 31) >> 5) * 4, mstride = ((w + 31) >> 5) * 4, pal = bpp === 8 ? 256 : 0;
    const b = Buffer.alloc(40 + pal * 4 + stride * h + mstride * h);
    b.writeUInt32LE(40, 0); b.writeInt32LE(w, 4); b.writeInt32LE(h * 2, 8); b.writeUInt16LE(1, 12); b.writeUInt16LE(bpp, 14);
    if (pal) { b.writeUInt32LE(256, 32); PAL8.forEach((c, i) => { b[40 + i * 4] = c[2]; b[41 + i * 4] = c[1]; b[42 + i * 4] = c[0]; }); }
    const xor = 40 + pal * 4, and = xor + stride * h;
    for (let y = 0; y < h; y++) {
        const row = xor + (h - 1 - y) * stride, mrow = and + (h - 1 - y) * mstride;
        for (let x = 0; x < w; x++) {
            const p = px(x, y);
            if (bpp === 32) { b[row + x * 4] = p[2]; b[row + x * 4 + 1] = p[1]; b[row + x * 4 + 2] = p[0]; b[row + x * 4 + 3] = p[3]; }
            else if (bpp === 24) { b[row + x * 3] = p[2]; b[row + x * 3 + 1] = p[1]; b[row + x * 3 + 2] = p[0]; }
            else b[row + x] = p;   /* 8: the palette index */
            if (mask && mask(x, y)) b[mrow + (x >> 3)] |= 0x80 >> (x & 7);
        }
    }
    return b;
}

/* ---- the resource section: [{ type, id, data }] -> bytes at rva ---------- */
function rsrc(list, rva) {
    const types = Array.from(new Set(list.map((r) => r.type))).sort((a, b) => a - b);
    const dirs = [], datas = [];
    let size = 0;
    const dir = (n) => { const d = { at: size, n: n }; size += 16 + n * 8; dirs.push(d); return d; };
    const root = dir(types.length);
    root.e = types.map((t) => {
        const ids = list.filter((r) => r.type === t).sort((a, b) => a.id - b.id);
        const td = dir(ids.length);
        td.e = ids.map((r) => { const ld = dir(1); ld.e = [{ id: 1033, data: r }]; return { id: r.id, sub: ld }; });
        return { id: t, sub: td };
    });
    const entriesAt = size;
    list.forEach((r) => { r.entryAt = size; size += 16; });
    list.forEach((r) => { r.dataAt = size; size = al(size + r.data.length, 4); datas.push(r); });
    const b = Buffer.alloc(size);
    dirs.forEach((d) => {
        b.writeUInt16LE(d.n, d.at + 14);
        d.e.forEach((e, i) => {
            b.writeUInt32LE(e.id, d.at + 16 + i * 8);
            b.writeUInt32LE(e.sub ? (0x80000000 | e.sub.at) >>> 0 : e.data.entryAt, d.at + 20 + i * 8);
        });
    });
    datas.forEach((r) => { b.writeUInt32LE(rva + r.dataAt, r.entryAt); b.writeUInt32LE(r.data.length, r.entryAt + 4); r.data.copy(b, r.dataAt); });
    assert.ok(entriesAt > 0);
    return b;
}
function group(icons) {
    const g = Buffer.alloc(6 + icons.length * 14);
    g.writeUInt16LE(1, 2); g.writeUInt16LE(icons.length, 4);
    icons.forEach((x, i) => {
        const e = 6 + i * 14;
        g[e] = x.side >= 256 ? 0 : x.side; g[e + 1] = g[e]; g.writeUInt16LE(1, e + 4); g.writeUInt16LE(x.bpp, e + 6);
        g.writeUInt32LE(x.data.length, e + 8); g.writeUInt16LE(x.id, e + 12);
    });
    return g;
}

/* ---- a PE (x86): .text, then .rsrc holding the resources ------------------ */
function program(res) {
    const headers = 0x400, rsVa = 2 * SA;
    const r = res ? rsrc(res, rsVa) : Buffer.alloc(0);
    const sections = [{ name: '.text', data: crypto.randomBytes(0x200), va: SA }].concat(res ? [{ name: '.rsrc', data: r, va: rsVa }] : []);
    let ptr = headers;
    sections.forEach((s) => { s.raw = al(s.data.length, FA); s.ptr = ptr; ptr += s.raw; });
    const b = Buffer.alloc(ptr);
    b.writeUInt16LE(0x5a4d, 0); b.writeUInt32LE(0x80, 0x3c); b.writeUInt32LE(0x4550, 0x80);
    b.writeUInt16LE(0x14c, 0x84); b.writeUInt16LE(sections.length, 0x86); b.writeUInt16LE(0xe0, 0x94);
    const opt = 0x98;
    b.writeUInt16LE(0x10b, opt); b.writeUInt32LE(SA, opt + 16); b.writeUInt32LE(0x400000, opt + 28); b.writeUInt32LE(SA, opt + 32); b.writeUInt32LE(FA, opt + 36);
    b.writeUInt32LE(rsVa + al(r.length, SA), opt + 56); b.writeUInt32LE(headers, opt + 60); b.writeUInt32LE(16, opt + 92);
    if (res) { b.writeUInt32LE(rsVa, opt + 96 + 16); b.writeUInt32LE(r.length, opt + 96 + 20); }
    sections.forEach((s, i) => {
        const at = opt + 0xe0 + i * 40;
        b.write(s.name, at, 'latin1'); b.writeUInt32LE(s.data.length, at + 8); b.writeUInt32LE(s.va, at + 12);
        b.writeUInt32LE(s.raw, at + 16); b.writeUInt32LE(s.ptr, at + 20); s.data.copy(b, s.ptr);
    });
    return b;
}

/* the icons a test program carries, and its main group */
const png256 = { side: 256, bpp: 32, id: 1, rgba: rgbaOf(256, 256, PAT) };
png256.data = writePng(256, 256, png256.rgba);
const MASK = (x, y) => x < 4 || y >= 30;
const dib32 = { side: 32, bpp: 8, id: 2, data: dib(32, 32, 8, (x, y) => (x * 8 + y) & 255, MASK) };
const dib16 = { side: 16, bpp: 32, id: 3, data: dib(16, 16, 32, PAT, null) };
const dib48 = { side: 48, bpp: 24, id: 4, data: dib(48, 48, 24, PAT, (x, y) => x === y) };
function res(icons, extra) {
    return icons.map((x) => ({ type: 3, id: x.id, data: x.data })).concat([{ type: 14, id: 101, data: group(icons) }]).concat(extra || []);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ico-'));
let n = 0;
function icon(buf) { const f = path.join(dir, 'p' + (n++) + '.exe'); fs.writeFileSync(f, buf); return exeIcon(f); }

let fails = 0;
function check(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const px = (im, x, y) => Array.from(im.rgba.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 4));

check('the biggest (a 256x256 PNG) taken, its pixels as drawn', () => {
    const im = icon(program(res([dib16, dib32, png256])));
    assert.ok(im && im.w === 256 && im.h === 256, JSON.stringify(im && [im.w, im.h]));
    assert.ok(im.rgba.equals(png256.rgba));
});
check('no PNG: the 48x48 24-bit, its AND mask as transparency', () => {
    const im = icon(program(res([dib16, dib32, dib48])));
    assert.ok(im && im.w === 48);
    assert.deepStrictEqual(px(im, 5, 7), PAT(5, 7).slice(0, 3).concat([255]));
    assert.strictEqual(px(im, 9, 9)[3], 0);
});
check('an 8-bit DIB: its palette, its mask', () => {
    const im = icon(program(res([dib16, dib32])));
    assert.ok(im && im.w === 32 && im.h === 32);
    const i = (10 * 8 + 3) & 255;
    assert.deepStrictEqual(px(im, 10, 3), PAL8[i].concat([255]));
    assert.strictEqual(px(im, 2, 10)[3], 0);
    assert.strictEqual(px(im, 10, 31)[3], 0);
});
check('a 32-bit DIB: its own alpha', () => {
    const im = icon(program(res([dib16])));
    assert.ok(im && im.w === 16);
    assert.deepStrictEqual(px(im, 4, 5), PAT(4, 5));
    assert.deepStrictEqual(px(im, 4, 4), PAT(4, 4));
});
check('a PNG that doesn\'t read: the next biggest', () => {
    const bad = { side: 256, bpp: 32, id: 1, data: Buffer.concat([png256.data.slice(0, 40), crypto.randomBytes(500)]) };
    const im = icon(program(res([bad, dib32])));
    assert.ok(im && im.w === 32, JSON.stringify(im && im.w));
});
check('no group, no resources, not a program: null', () => {
    assert.strictEqual(icon(program([{ type: 3, id: 2, data: dib32.data }])), null);
    assert.strictEqual(icon(program(null)), null);
    assert.strictEqual(icon(Buffer.from('#!/bin/sh\necho hi\n')), null);
    assert.strictEqual(exeIcon(path.join(dir, 'missing.exe')), null);
});
check('truncated and garbled: null or a picture, never a throw', () => {
    const good = program(res([dib16, dib32, png256]));
    [good.slice(0, 0x60), good.slice(0, 0x300), good.slice(0, good.length - 3000), crypto.randomBytes(8192)].forEach((b, i) => {
        const im = icon(b);
        assert.ok(im === null || im.rgba.length === im.w * im.h * 4, 'case ' + i);
    });
    for (let k = 0; k < 60; k++) {
        const b = Buffer.from(good);
        for (let j = 0; j < 12; j++) b[0x80 + Math.floor(Math.random() * (b.length - 0x80))] = Math.floor(Math.random() * 256);
        const im = icon(b);
        assert.ok(im === null || im.rgba.length === im.w * im.h * 4, 'garbled ' + k);
    }
});

fs.readdirSync(dir).forEach((f) => fs.unlinkSync(path.join(dir, f)));
fs.rmdirSync(dir);
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
