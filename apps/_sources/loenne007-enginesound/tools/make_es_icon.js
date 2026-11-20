'use strict';
// node tools/make_es_icon.js <out.png>: the Engine Sound tile (140 x 140): a rev dial with its red zone and sound waves.
const fs = require('fs');
const path = require('path');
const { Canvas } = require(path.join(__dirname, '..', 'kit', 'runtime', 'canvas'));
const W = '#ffffff', A = '#e1001a';
const c = new Canvas(140, 140);
if (process.env.BG) c.fillRect(0, 0, 140, 140, process.env.BG);
const rad = (d) => d * Math.PI / 180;
const pt = (cx, cy, r, a) => [cx + Math.sin(rad(a)) * r, cy - Math.cos(rad(a)) * r];
const cx = 52, cy = 76;
c.arc(cx, cy, 40, 47, -135, 135, W, { round: true });
c.arc(cx, cy, 40, 47, 80, 135, A, { round: true });
for (let a = -135; a <= 135; a += 54) { const [x0, y0] = pt(cx, cy, 29, a), [x1, y1] = pt(cx, cy, 35, a); c.line(x0, y0, x1, y1, 4, W); }
const [nx, ny] = pt(cx, cy, 36, 55);
c.line(cx, cy, nx, ny, 6, A);
c.circle(cx, cy, 8, W);
// sound waves to the right
[[12, 6], [23, 6], [34, 5]].forEach(([r, w], i) => c.arc(cx + 44, cy, r, r + w, 45, 135, W, { round: true }));
c.fillRect(24, 116, 56, 6, W);
fs.writeFileSync(process.argv[2] || 'icon.png', c.png(9));
