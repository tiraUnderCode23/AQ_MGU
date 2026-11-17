// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * Builds the touch kit's fonts (platform/tool/touch_ui/<version>/ui.fonts.json
 * and ui.f<size>.font.gz): Barlow Semi Condensed (OFL, themes/fonts) at the
 * kit's four sizes, as glyph atlases (R8), with headless Chrome as the theme
 * build does.  node tools/ui_fonts.js <module version folder> [--chrome PATH]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { fontAtlas } = require('./theme_build.js');

const out = process.argv[2];
if (!out || !fs.existsSync(path.join(out, 'ui_kit.js'))) { console.error('usage: node tools/ui_fonts.js platform/tool/touch_ui/<version>'); process.exit(2); }
const { FONTS, GLYPHS } = require(path.resolve(out, 'ui_kit.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uifonts-'));
const meta = {};
Object.keys(FONTS).forEach((name) => {
    const f = FONTS[name];
    const cell = Math.ceil(f.size * 1.05), lineH = Math.ceil(f.size * 1.3);
    const a = fontAtlas(path.join(__dirname, '..', 'themes', 'fonts'), { file: 'BarlowSemiCondensed-' + f.weight + '.woff2', glyphs: GLYPHS,
        cell: [cell, lineH], size: f.size, weight: f.weight, proportional: true }, tmp);
    const file = 'ui.' + name + '.font.gz';
    fs.writeFileSync(path.join(out, file), zlib.gzipSync(a.r8, { level: 9, mtime: 0 }));
    meta[name] = { file: file, size: f.size, weight: f.weight, glyphs: GLYPHS, cell: a.cw, lineH: lineH, w: a.w, h: a.h, top: a.top, adv: a.adv };
    console.log(file + ' ' + a.w + 'x' + a.h);
});
fs.writeFileSync(path.join(out, 'ui.fonts.json'), JSON.stringify(meta) + '\n');
