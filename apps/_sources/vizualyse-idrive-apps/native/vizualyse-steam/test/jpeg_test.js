// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/* The JPEG reader (src/jpeg.js) against Pillow's reading of the same files
 * (test/fixtures/jpeg, made by make.py there: synthetic pictures, 4:4:4,
 * 4:2:2, 4:2:0, odd sizes, restart markers, a low quality, grey): every
 * channel within a few levels of Pillow's (the IDCT's rounding: libjpeg's is
 * integer, ours floating), on average within one. A progressive file, and
 * truncated and garbled ones: a clear error, never a crash or a hang.
 * Node 8 (the unit's).   node test/jpeg_test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const jpeg = require('../src/jpeg.js');

const F = path.join(__dirname, 'fixtures', 'jpeg');
let fails = 0;
function check(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

/* name: the most any channel may differ from Pillow's */
const CASES = { c444: 3, c422: 4, c420: 4, odd420: 4, odd422: 4, restart: 4, low: 4, grey: 2 };
Object.keys(CASES).forEach((name) => check(name + ' matches Pillow', () => {
    const im = jpeg.decode(fs.readFileSync(path.join(F, name + '.jpg')));
    const ref = zlib.gunzipSync(fs.readFileSync(path.join(F, name + '.rgb.gz')));
    assert.strictEqual(im.w * im.h * 3, ref.length, 'size ' + im.w + 'x' + im.h);
    let worst = 0, sum = 0;
    for (let i = 0, j = 0; j < ref.length; i += 4, j += 3) {
        for (let k = 0; k < 3; k++) { const d = Math.abs(im.rgba[i + k] - ref[j + k]); sum += d; if (d > worst) worst = d; }
        assert.strictEqual(im.rgba[i + 3], 255);
    }
    const mean = sum / ref.length;
    assert.ok(worst <= CASES[name] && mean < 1, 'worst ' + worst + ', mean ' + mean.toFixed(2));
}));

check('the restart fixture has restart markers', () => {
    const b = fs.readFileSync(path.join(F, 'restart.jpg'));
    let dri = false, rst = 0;
    for (let i = 0; i + 1 < b.length; i++) if (b[i] === 0xff) { if (b[i + 1] === 0xdd) dri = true; if (b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7) rst++; }
    assert.ok(dri && rst > 3, 'DRI ' + dri + ', RSTn ' + rst);
});

check('progressive: refused, saying so', () => {
    assert.throws(() => jpeg.decode(fs.readFileSync(path.join(F, 'progressive.jpg'))), /progressive/);
});

check('truncated and garbled: an Error, never a crash', () => {
    const good = fs.readFileSync(path.join(F, 'c420.jpg'));
    const tries = [Buffer.alloc(0), Buffer.from([0xff, 0xd8]), good.slice(0, 20), good.slice(0, 300), good.slice(0, good.length - 200), crypto.randomBytes(2000),
        Buffer.concat([good.slice(0, 2), crypto.randomBytes(3000)])];
    for (let n = 0; n < 40; n++) { const b = Buffer.from(good); for (let k = 0; k < 8; k++) b[400 + Math.floor(Math.random() * (b.length - 402))] = Math.floor(Math.random() * 256); tries.push(b); }
    tries.forEach((b, i) => {
        try { const im = jpeg.decode(b); assert.ok(im.w > 0 && im.rgba.length === im.w * im.h * 4, 'case ' + i); }
        catch (e) { assert.ok(e instanceof Error && /^jpeg: /.test(e.message), 'case ' + i + ': ' + (e && e.stack)); }
    });
});

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
