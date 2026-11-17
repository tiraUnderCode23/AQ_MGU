// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * A game's icon from its Windows program, for the touch screen's cards when
 * there is no store picture (offline, or none to be had). The program's
 * first icon group (as Explorer shows it): its largest picture, PNG (8-bit
 * RGB / RGBA, ui_png.js) or a DIB (32-bit with alpha; 24, 8, 4 or 1-bit
 * with the AND mask's transparency). Only the bytes it needs are read: a
 * game's program can be hundreds of MB.
 *
 *   exeIcon(file)    { w, h, rgba } or null (no icon, not a program, damaged): never throws
 */
'use strict';
const fs = require('fs');
const { readPng } = require('./ui_png.js');

const RT_ICON = 3, RT_GROUP_ICON = 14;
const MAX_ICON = 4 * 1024 * 1024, MAX_SIDE = 512;

function reader(fd) {
    return (off, len) => {
        const b = Buffer.alloc(len);
        const n = fs.readSync(fd, b, 0, len, off);
        if (n < len) throw new Error('short read');
        return b;
    };
}

/* the sections and the resource directory's place */
function pe(read) {
    const mz = read(0, 64);
    if (mz.readUInt16LE(0) !== 0x5a4d) return null;
    const at = mz.readUInt32LE(0x3c);
    const h = read(at, 24);
    if (h.readUInt32LE(0) !== 0x00004550) return null;
    const count = h.readUInt16LE(6), optSize = h.readUInt16LE(20);
    if (count > 96 || optSize < 96) return null;
    const opt = read(at + 24, optSize), wide = opt.readUInt16LE(0) === 0x20b;
    const dirAt = wide ? 112 : 96;
    if (dirAt + 3 * 8 > optSize) return null;
    const res = { rva: opt.readUInt32LE(dirAt + 16), size: opt.readUInt32LE(dirAt + 20) };
    const t = read(at + 24 + optSize, count * 40), sections = [];
    for (let i = 0; i < count; i++) sections.push({ va: t.readUInt32LE(i * 40 + 12), vs: t.readUInt32LE(i * 40 + 8), raw: t.readUInt32LE(i * 40 + 16), ptr: t.readUInt32LE(i * 40 + 20) });
    const off = (rva) => {
        const s = sections.filter((x) => rva >= x.va && rva < x.va + Math.max(x.vs, x.raw))[0];
        return s && rva - s.va < s.raw ? s.ptr + rva - s.va : null;
    };
    return res.rva && res.size ? { res: res, off: off } : null;
}

/* a resource directory's entries: { id (a number) or name (true), sub, data } */
function entries(read, p, rel) {
    const o = p.off(p.res.rva + rel);
    if (o === null) return [];
    const d = read(o, 16), n = d.readUInt16LE(12) + d.readUInt16LE(14);
    if (n > 4096) return [];
    const e = read(o + 16, n * 8), out = [];
    for (let i = 0; i < n; i++) {
        const name = e.readUInt32LE(i * 8), to = e.readUInt32LE(i * 8 + 4);
        out.push({ named: !!(name & 0x80000000), id: name & 0x7fffffff, sub: !!(to & 0x80000000), at: to & 0x7fffffff });
    }
    return out;
}

/* the bytes of a resource: type, then the entry (id, or the first), then its first language */
function resource(read, p, type, id) {
    const t = entries(read, p, 0).filter((e) => !e.named && e.id === type && e.sub)[0];
    if (!t) return null;
    const names = entries(read, p, t.at).filter((e) => e.sub);
    const one = id === undefined ? names[0] : names.filter((e) => !e.named && e.id === id)[0];
    if (!one) return null;
    const lang = entries(read, p, one.at).filter((e) => !e.sub)[0];
    if (!lang) return null;
    const de = p.off(p.res.rva + lang.at);
    if (de === null) return null;
    const d = read(de, 16), rva = d.readUInt32LE(0), size = d.readUInt32LE(4), o = p.off(rva);
    if (o === null || !size || size > MAX_ICON) return null;
    return read(o, size);
}

/* a DIB icon: the XOR picture (bottom-up) and the AND mask (1: transparent) */
function dib(b) {
    if (b.readUInt32LE(0) < 40) return null;
    const w = b.readInt32LE(4), h2 = b.readInt32LE(8), bpp = b.readUInt16LE(14), comp = b.readUInt32LE(16);
    const h = h2 / 2;
    if (w <= 0 || w > MAX_SIDE || h <= 0 || h !== Math.floor(h) || h > MAX_SIDE) return null;
    if ([1, 4, 8, 24, 32].indexOf(bpp) < 0 || (comp !== 0 && !(comp === 3 && bpp === 32))) return null;
    const hdr = b.readUInt32LE(0), pal = bpp <= 8 ? (b.readUInt32LE(32) || 1 << bpp) : 0;
    const palAt = hdr + (comp === 3 && hdr === 40 ? 12 : 0), xorAt = palAt + pal * 4;
    const stride = ((w * bpp + 31) >> 5) * 4, maskStride = ((w + 31) >> 5) * 4, maskAt = xorAt + stride * h;
    if (xorAt + stride * h > b.length) return null;
    const hasMask = maskAt + maskStride * h <= b.length;
    const rgba = Buffer.alloc(w * h * 4);
    let anyAlpha = false;
    for (let y = 0; y < h; y++) {
        const row = xorAt + (h - 1 - y) * stride;
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            let r, g, bl, a = 255;
            if (bpp === 32) { bl = b[row + x * 4]; g = b[row + x * 4 + 1]; r = b[row + x * 4 + 2]; a = b[row + x * 4 + 3]; if (a) anyAlpha = true; }
            else if (bpp === 24) { bl = b[row + x * 3]; g = b[row + x * 3 + 1]; r = b[row + x * 3 + 2]; }
            else {
                const bit = x * bpp, v = (b[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1), pa = palAt + v * 4;
                if (v >= pal) return null;
                bl = b[pa]; g = b[pa + 1]; r = b[pa + 2];
            }
            rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = bl; rgba[o + 3] = a;
        }
    }
    /* the mask: always below 32 bits; at 32 bits only when the picture has no alpha at all */
    if (hasMask && (bpp < 32 || !anyAlpha)) {
        for (let y = 0; y < h; y++) {
            const row = maskAt + (h - 1 - y) * maskStride;
            for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = (b[row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
        }
    }
    return { w: w, h: h, rgba: rgba };
}

function picture(b) {
    if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) {
        const im = readPng(b);
        return im.w > 0 && im.w <= MAX_SIDE && im.h > 0 && im.h <= MAX_SIDE ? im : null;
    }
    return dib(b);
}

function exeIcon(file) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const read = reader(fd), p = pe(read);
        if (!p) return null;
        const g = resource(read, p, RT_GROUP_ICON);
        if (!g || g.length < 6 || g.readUInt16LE(2) !== 1) return null;
        const n = Math.min(g.readUInt16LE(4), Math.floor((g.length - 6) / 14)), list = [];
        for (let i = 0; i < n; i++) {
            const e = 6 + i * 14;
            list.push({ side: g[e] || 256, bpp: g.readUInt16LE(e + 6), id: g.readUInt16LE(e + 12) });
        }
        /* the biggest first, the deepest colour first; one that doesn't read: the next */
        list.sort((a, b) => b.side - a.side || b.bpp - a.bpp);
        for (const x of list) {
            try {
                const b = resource(read, p, RT_ICON, x.id);
                const im = b && picture(b);
                if (im) return im;
            } catch (e) { /* the next */ }
        }
        return null;
    } catch (e) {
        return null;
    } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* closed */ }
    }
}

module.exports = { exeIcon };
