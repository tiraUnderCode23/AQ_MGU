// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * Every switch between two shipped themes stays inside cluster-render's
 * limits for one client: at most 16 assets and 64 layers alive at any time,
 * and every bind to an asset that is alive. A fake cluster-render that
 * refuses past the limits as the real one does (it hands out a ref, the
 * server refuses it). Regression: switching into tri2 from another family
 * made its 12 assets while the last theme's 12 were still held; the glyph
 * atlases, made last, were refused and tri2 showed no text (2026-11-14).
 *   node test/switch_test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ThemeRuntime } = require('../src/theme_runtime.js');

const MAX_ASSETS = 16, MAX_LAYERS = 64;
/* the kit as it ships (component.json): the themes and the shaders, flat */
const HERE = path.join(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vzc-switch-'));
JSON.parse(fs.readFileSync(path.join(HERE, 'component.json'), 'utf8')).files
    .filter((x) => /(\.theme\.json|\.logic\.js|\.gz|^fs_\w+\.frag)$/.test(x.path))
    .forEach((x) => fs.copyFileSync(path.join(HERE, x.from), path.join(DIR, x.path)));

function fakeCr() {
    let n = 0;
    const assets = new Set(), layers = new Set();
    const st = { peakAssets: 0, peakLayers: 0, refused: [], badBinds: [] };
    const cr = {
        asset() { const r = 'a' + (++n); if (assets.size >= MAX_ASSETS) st.refused.push(r); else assets.add(r); st.peakAssets = Math.max(st.peakAssets, assets.size); return r; },
        pixels() { return true; },
        effect() { const r = 'l' + (++n); if (layers.size >= MAX_LAYERS) st.refused.push(r); else layers.add(r); st.peakLayers = Math.max(st.peakLayers, layers.size); return r; },
        image() { return cr.effect(); },
        bind(layer, slot, asset) { if (!assets.has(asset)) st.badBinds.push(slot + ' -> ' + asset); return true; },
        uniform() { return true; },
        set() { return true; },
        drop(r) { assets.delete(r); layers.delete(r); return true; },
    };
    return { cr, st, alive: () => ({ assets: assets.size, layers: layers.size }) };
}

const f = fakeCr();
const rt = new ThemeRuntime(f.cr, DIR);
const ids = rt.list().filter((t) => {
    return JSON.parse(fs.readFileSync(path.join(DIR, t.id + '.theme.json'), 'utf8')).ship !== false;
}).map((t) => t.id).sort();
assert(ids.length >= 16, 'the shipped themes: ' + ids.length);
/* the curtain (theme_runtime.js start) lifts once the client's frames have
 * gone: the fake has none, so after a few of these ms */
rt.liftMs = 1;
const lifted = () => new Promise((ok) => { const t = setInterval(() => { if (!(rt.curtains || []).length) { clearInterval(t); ok(); } }, 2); });
(async () => {
    let switches = 0, curtained = 0;
    for (const a of ids) {
        for (const b of ids) {
            if (a === b) continue;
            rt.start(a);
            await lifted();
            rt.cover = true;
            rt.start(b);
            /* black under the new theme, so the panel is never empty and BMW's cluster can't show */
            if ((rt.curtains || []).length === 3) curtained++;
            await lifted();
            switches++;
        }
    }
    rt.stop();
    assert.deepStrictEqual(f.st.refused, [], 'refused by cluster-render: ' + f.st.refused.length);
    assert.deepStrictEqual(f.st.badBinds, [], 'binds to assets that are not alive');
    assert.deepStrictEqual(f.alive(), { assets: 0, layers: 0 }, 'everything dropped at the end');
    assert.strictEqual(curtained, switches, 'every switch had its curtain');
    console.log('ok   ' + switches + ' switches between ' + ids.length + ' themes: at most ' + f.st.peakAssets + ' assets (limit ' + MAX_ASSETS +
        ') and ' + f.st.peakLayers + ' layers (limit ' + MAX_LAYERS + ') alive; every bind to a live asset; a curtain under every switch, lifted after');
})().catch((e) => { console.error(e); process.exit(1); });
