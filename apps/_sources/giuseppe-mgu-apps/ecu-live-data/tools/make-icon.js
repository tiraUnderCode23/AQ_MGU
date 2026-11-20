'use strict';
/**
 * The app's tile icon (app/icon.png, 140 x 140, the HMI's style: white line art on transparent,
 * one accent element): an engine control unit with its connector pins and a live log trace on it.
 *
 *   node tools/make-icon.js        (after tools/setup.js: it draws with the kit's canvas)
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require(path.join(__dirname, '..', '..', 'vendor', 'idrive7-apps', 'kit', 'runtime', 'canvas'));

const W = '#ffffff', A = '#e1001a';
const c = new Canvas(140, 140);
// the control unit's housing, with the connector on its left and pins along the top and bottom
c.strokeRoundRect(30, 30, 92, 80, 10, 6, W);
c.fillRect(12, 50, 14, 40, W);
c.fillRect(8, 56, 6, 6, W); c.fillRect(8, 67, 6, 6, W); c.fillRect(8, 78, 6, 6, W);
for (let i = 0; i < 5; i++) { c.fillRect(44 + i * 15, 18, 5, 12, W); c.fillRect(44 + i * 15, 110, 5, 12, W); }
// the log: a live trace across the unit, in the accent colour
const pts = [[40, 90], [52, 88], [60, 70], [70, 76], [80, 52], [90, 62], [100, 48], [112, 54]];
c.polyline(pts, 6, A);
c.circle(112, 54, 6, A);
fs.writeFileSync(path.join(__dirname, '..', 'app', 'icon.png'), c.png(9));
console.log('app/icon.png');
