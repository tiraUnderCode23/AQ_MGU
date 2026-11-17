// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/* The games' pictures (src/art.js), without the network: a store picture in
 * the folder becomes a picture of the exact size asked, made in the
 * background (null until then, onReady when made, the same one again from
 * then on); darkened at the bottom for a tile, dimmed for a game that can't
 * be played; a store picture that doesn't read (progressive) falls back to
 * the program's icon, or to nothing; remove() forgets it; no DNS: no fetch
 * tried (and tried once DNS comes). Node 8.   node test/art_test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Art } = require('../src/art.js');

const FX = path.join(__dirname, 'fixtures', 'jpeg');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
const logs = [];
let ready = 0;
let dns = null;
const a = new Art({ dir: dir, log: (s) => logs.push(s), onReady: () => { ready++; }, dns: () => dns, uid: process.getuid ? process.getuid() : 0, gid: process.getgid ? process.getgid() : 0 });
const settle = () => new Promise((res) => { (function w() { if (a.queue.length || a.busy) return setTimeout(w, 5); setTimeout(res, 5); })(); });
const mean = (img, y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < img.w; x++) { const o = (y * img.w + x) * 4; s += img.rgba[o] + img.rgba[o + 1] + img.rgba[o + 2]; n += 3; } return s / n; };

(async () => {
    let fails = 0;
    const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } };

    await check('no store picture, no program: nothing', async () => {
        assert.strictEqual(a.picture(1, 100, 60, {}), null);
        await settle();
        assert.strictEqual(a.picture(1, 100, 60, { exe: path.join(dir, 'missing.exe') }), null);
        await settle();
        assert.strictEqual(a.picture(1, 100, 60, { exe: path.join(dir, 'missing.exe') }), null, 'no icon: remembered, nothing');
    });
    await check('a store picture: made in the background at the size asked, then kept', async () => {
        fs.copyFileSync(path.join(FX, 'c420.jpg'), path.join(dir, '7.jpg'));
        const before = ready;
        assert.strictEqual(a.picture(7, 120, 90, { fade: true }), null, 'not made yet');
        await settle();
        assert.ok(ready > before, 'onReady');
        const p = a.picture(7, 120, 90, { fade: true });
        assert.ok(p && p.img.w === 120 && p.img.h === 90 && p.img.rgba.length === 120 * 90 * 4 && p.img.opaque, JSON.stringify(p && [p.img.w, p.img.h]));
        assert.strictEqual(a.picture(7, 120, 90, { fade: true }).img, p.img, 'the same picture again');
        assert.ok(mean(p.img, 80, 90) < mean(p.img, 0, 20) * 0.5, 'darker at the bottom (a tile)');
        a.picture(7, 120, 90, { fade: true, dim: true });
        await settle();
        const d = a.picture(7, 120, 90, { fade: true, dim: true });
        assert.ok(d && mean(d.img, 0, 20) < mean(p.img, 0, 20) * 0.6, 'dimmed: can\'t be played');
        assert.notStrictEqual(d.key, p.key);
    });
    await check('a store picture that doesn\'t read: said once, then nothing (no icon)', async () => {
        fs.copyFileSync(path.join(FX, 'progressive.jpg'), path.join(dir, '8.jpg'));
        assert.strictEqual(a.picture(8, 50, 50, {}), null);
        await settle();
        assert.ok(logs.some((l) => /8's store picture: jpeg: progressive/.test(l)), logs.join('\n'));
        assert.strictEqual(a.picture(8, 50, 50, {}), null);
        await settle();
        assert.strictEqual(logs.filter((l) => /8's store picture/.test(l)).length, 1, 'said once');
    });
    await check('remove(): the file and the pictures gone', async () => {
        a.remove(7);
        assert.ok(!fs.existsSync(path.join(dir, '7.jpg')));
        assert.strictEqual(a.picture(7, 120, 90, { fade: true }), null);
    });
    await check('no DNS: no fetch tried; tried once there is', async () => {
        a.want(9);
        assert.strictEqual(a.fetching, null);
        assert.ok(!a.tried.has(9), 'asked again later');
        fs.writeFileSync(path.join(dir, '10.jpg'), 'x');
        dns = '192.0.2.1';
        a.want(10);
        assert.ok(a.tried.has(10) && a.fetching === null, 'a picture already there: no fetch');
    });
    await check('kept: the last 16 pictures only', async () => {
        fs.copyFileSync(path.join(FX, 'c444.jpg'), path.join(dir, '11.jpg'));
        for (let w = 20; w < 60; w += 2) a.picture(11, w, 20, {});
        await settle();
        assert.ok(a.made.size <= 16, String(a.made.size));
    });

    fs.readdirSync(dir).forEach((f) => fs.unlinkSync(path.join(dir, f)));
    fs.rmdirSync(dir);
    if (fails) { console.log(fails + ' failed'); process.exit(1); }
    console.log('all passed');
})();
