// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * Builds what the picker on the central screen draws with (src/picker.js),
 * into picker/ (committed; the kit ships them flat as picker.*):
 *   picker/<id>.png        each shipped theme as the bench drive shows it
 *                          (tools/preview_shot.js at PREVIEW_T s), cut to the
 *                          picker's preview size (src/picker_view.js HERO), RGB
 *   picker/<id>.thumb.png  the same as a tile (THUMB: its middle, a cover crop)
 * and lists them in component.json's files. The fonts are the touch kit's
 * (platform/tool/touch_ui, tools/ui_fonts.js).
 *
 *   node tools/picker_build.js [--chrome PATH] [--only <id>,...]
 *   node tools/picker_build.js --resize   (from the previews already in
 *       picker/, at the sizes picker_view.js draws now: no Chrome)
 *
 * Needs Chrome or Edge, as the theme build does.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { readPng } = require('../src/png.js');
const { resize, crop } = require('../src/ui_canvas.js');
const { HERO, THUMB } = require('../src/picker_view.js');

const HERE = path.join(__dirname, '..');
const OUT = path.join(HERE, 'picker');
const BUILT = path.join(HERE, 'themes', 'built');
/* the moment of the bench drive each preview shows: up to speed, every gauge lit */
const PREVIEW_T = 9.5;

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; }

/* An RGB PNG with each row's filter chosen (the smallest sum of absolute
 * differences): the previews are mostly dark, smooth gradients. */
function pngRgb(img) {
    const w = img.w, h = img.h, stride = w * 3;
    const rows = [], prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
        const cur = Buffer.alloc(stride);
        for (let x = 0; x < w; x++) img.rgba.copy(cur, x * 3, (y * w + x) * 4, (y * w + x) * 4 + 3);
        let best = null, bestSum = Infinity;
        for (let f = 0; f < 5; f++) {
            const line = Buffer.alloc(stride + 1);
            line[0] = f;
            let sum = 0;
            for (let i = 0; i < stride; i++) {
                const a = i >= 3 ? cur[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0;
                let p = 0;
                if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
                else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
                const v = (cur[i] - p) & 255;
                line[i + 1] = v;
                sum += v < 128 ? v : 256 - v;
            }
            if (sum < bestSum) { bestSum = sum; best = line; }
        }
        rows.push(best);
        cur.copy(prev);
    }
    const crcTable = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (kind, body) => {
        const k = Buffer.from(kind, 'ascii'), len = Buffer.alloc(4), c = Buffer.alloc(4);
        len.writeUInt32BE(body.length, 0);
        c.writeUInt32BE(crc(Buffer.concat([k, body])), 0);
        return Buffer.concat([len, k, body, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function shipped() {
    return fs.readdirSync(BUILT).filter((n) => /^[a-z0-9]+\.theme\.json$/.test(n))
        .map((n) => JSON.parse(fs.readFileSync(path.join(BUILT, n), 'utf8')))
        .filter((t) => t.ship !== false).map((t) => t.id).sort();
}

function previews(ids, tmp) {
    ids.forEach((id) => {
        const shot = path.join(tmp, id + '.png');
        const a = [path.join(__dirname, 'preview_shot.js'), id, String(PREVIEW_T), shot];
        if (arg('--chrome')) a.push('--chrome', arg('--chrome'));
        const r = spawnSync(process.execPath, a, { encoding: 'utf8', timeout: 180000 });
        if (r.status !== 0 || !fs.existsSync(shot)) throw new Error('preview of ' + id + ' failed: ' + (r.stderr || r.stdout || '').slice(-400));
        const img = readPng(fs.readFileSync(shot));
        if (img.w !== 1920 || img.h !== 720) throw new Error('preview of ' + id + ' is ' + img.w + 'x' + img.h);
        cut(id, img);
    });
}

/* a whole-cluster picture (1920x720, or a preview of that shape) cut to the
 * hero and the tile */
function cut(id, img) {
    {
        const png = pngRgb(resize(img, HERO.w, HERO.h));
        fs.writeFileSync(path.join(OUT, id + '.png'), png);
        /* the tile: as tall as the tile, its middle (a cover crop) */
        const tw = Math.round(img.w * THUMB.h / img.h), small = resize(img, tw, THUMB.h);
        const thumb = pngRgb(crop(small, Math.floor((tw - THUMB.w) / 2), 0, THUMB.w, THUMB.h));
        fs.writeFileSync(path.join(OUT, id + '.thumb.png'), thumb);
        console.log(id + '.png ' + (png.length / 1024).toFixed(0) + ' KB, thumb ' + (thumb.length / 1024).toFixed(0) + ' KB');
    }
}

/* component.json: every file in picker/, flat as picker.<name> */
function list() {
    const cj = path.join(HERE, 'component.json');
    const c = JSON.parse(fs.readFileSync(cj, 'utf8'));
    const keep = c.files.filter((f) => !/^picker\//.test(f.from));
    const add = fs.readdirSync(OUT).filter((n) => !/^\./.test(n)).sort()
        .map((n) => ({ path: 'picker.' + n, from: 'picker/' + n, mode: '0644' }));
    c.files = keep.concat(add);
    fs.writeFileSync(cj, JSON.stringify(c, null, 2) + '\n');
}

function main() {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'picker-'));
    const only = arg('--only');
    if (process.argv.indexOf('--resize') >= 0) {
        (only ? only.split(',') : shipped()).forEach((id) => cut(id, readPng(fs.readFileSync(path.join(OUT, id + '.png')))));
    } else previews(only ? only.split(',') : shipped(), tmp);
    /* a preview of a theme no longer shipped goes */
    const ids = shipped();
    fs.readdirSync(OUT).filter((n) => /^[a-z0-9]+(\.thumb)?\.png$/.test(n) && ids.indexOf(n.split('.')[0]) < 0)
        .forEach((n) => { fs.unlinkSync(path.join(OUT, n)); console.log('removed ' + n); });
    list();
}

if (require.main === module) main();
module.exports = { pngRgb };
