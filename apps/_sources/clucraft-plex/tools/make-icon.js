'use strict';
/**
 * make-icon.js - draws the app's tile icon, apps/clucraft_plex/icon.png (140 x 140, transparent): a drive-in
 * screen on its two posts with a play mark on it. The project's own mark, drawn here with the kit's canvas; no
 * third-party artwork and nobody's logo.
 *
 *   node tools/make-icon.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { Canvas } = require(path.join(ROOT, 'kit', 'runtime', 'canvas'));

const S = 4, N = 140;                      // drawn four times the size, then averaged down: smooth edges
const big = new Canvas(N * S, N * S);
big.clear([0, 0, 0, 0]);
const k = (v) => v * S;
const WHITE = '#ffffff', BLUE = '#3d8bfd';
// the screen: a white frame, see-through inside
big.roundRect(k(14), k(26), k(112), k(70), k(12), WHITE);
big.roundRect(k(21), k(33), k(98), k(56), k(6), '#101014');
// the play mark
big.triangle([[k(58), k(45)], [k(58), k(77)], [k(88), k(61)]], BLUE);
// its posts and the ground
big.fillRect(k(36), k(96), k(7), k(18), WHITE);
big.fillRect(k(97), k(96), k(7), k(18), WHITE);
big.roundRect(k(22), k(112), k(96), k(6), k(3), WHITE);

const out = new Canvas(N, N);
for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
            const i = ((y * S + yy) * N * S + x * S + xx) * 4, al = big.d[i + 3];
            r += big.d[i] * al; g += big.d[i + 1] * al; b += big.d[i + 2] * al; a += al;
        }
        const o = (y * N + x) * 4;
        if (a) { out.d[o] = Math.round(r / a); out.d[o + 1] = Math.round(g / a); out.d[o + 2] = Math.round(b / a); out.d[o + 3] = Math.round(a / (S * S)); }
    }
}
const file = path.join(ROOT, 'apps', 'clucraft_plex', 'icon.png');
fs.writeFileSync(file, Buffer.from(out.png()));
console.log('icon: ' + path.relative(ROOT, file) + ' (' + fs.statSync(file).size + ' bytes)');
