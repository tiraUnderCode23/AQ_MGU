'use strict';
/*
 * node packages/vitals/app/tools/preview_ui.js [out.html]: the app's drawn screen (src/ui.js) with sample
 * data, played back onto a browser canvas the way the renderer draws its ops. Open the file in a browser.
 */
const fs = require('fs');
const path = require('path');
const ui = require('../src/ui.js');
const model = require('../src/settings_model.js');

const out = process.argv[2] || path.join(__dirname, '..', '..', 'design', 'app_preview.html');
const settings = { tempUnit: 'auto', pressUnit: 'auto', coolantWarn: 115, oilWarn: 135, gearboxWarn: 120, accent: 'blue',
    pressures: true, demo: false, shiftY: 10, zoom: 100 };
const { rec } = ui.draw(new ui.Recorder(), {
    settings: settings, connected: true, rows: model.ROWS, focus: 'vtCoolantWarn', pressed: null,
    status: { renderer: 'connected', engine: true, gearbox: true, tyres: true },
    data: { coolant: 92, oil: 118, gearbox: 81, carTemp: 'C', carPress: 'BAR',
        tyreT: { FL: 41, FR: 43, RL: 37, RR: 18 }, tyreP: { FL: 2.4, FR: 2.4, RL: 2.6, RR: 2.6 } },
});
const words = Array.from(rec.words());
const atlases = rec.atlases.map((a) => ({ id: a.id, w: a.w, h: a.h, alpha: a.alpha.toString('base64') }));

const html = `<!doctype html><meta charset="utf-8"><title>Vitals app preview</title>
<style>body{margin:0;background:#000}canvas{width:100%;display:block}</style>
<canvas id="c" width="${ui.W}" height="${ui.H}"></canvas>
<script>
const words = new Uint32Array(${JSON.stringify(words)});
const f = new Float32Array(words.buffer);
const atl = {};
${JSON.stringify(atlases)}.forEach((a) => { const b = atob(a.alpha); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); atl[a.id] = { w: a.w, h: a.h, a: u }; });
const g = document.getElementById('c').getContext('2d');
const col = (v) => 'rgba(' + (v >>> 24) + ',' + ((v >>> 16) & 255) + ',' + ((v >>> 8) & 255) + ',' + ((v & 255) / 255) + ')';
const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
let i = 0;
while (i < words.length) {
  const op = words[i];
  if (op === 1) { g.fillStyle = col(words[i + 1]); g.fillRect(0, 0, ${ui.W}, ${ui.H}); i += 2; }
  else if (op === 2) { g.fillStyle = col(words[i + 5]); g.fillRect(f[i + 1], f[i + 2], f[i + 3], f[i + 4]); i += 6; }
  else if (op === 4) { g.fillStyle = col(words[i + 6]); rr(f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]); g.fill(); i += 7; }
  else if (op === 5) { g.strokeStyle = col(words[i + 7]); g.lineWidth = f[i + 6]; rr(f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]); g.stroke(); i += 8; }
  else if (op === 15) { g.fillStyle = col(words[i + 9]); g.beginPath(); g.moveTo(f[i + 1], f[i + 2]); for (let k = 1; k < 4; k++) g.lineTo(f[i + 1 + 2 * k], f[i + 2 + 2 * k]); g.closePath(); g.fill(); i += 10; }
  else if (op === 11) {
    const a = atl[words[i + 1]], c = words[i + 2], n = words[i + 3];
    let j = i + 4;
    for (let k = 0; k < n; k++, j += 8) {
      const x = f[j], y = f[j + 1], w = f[j + 2], h = f[j + 3], u0 = f[j + 4], v0 = f[j + 5];
      const im = g.getImageData(x, y, w, h);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const al = a.a[(v0 + yy) * a.w + u0 + xx] / 255 * ((c & 255) / 255), p = (yy * w + xx) * 4;
        im.data[p] = im.data[p] * (1 - al) + (c >>> 24) * al; im.data[p + 1] = im.data[p + 1] * (1 - al) + ((c >>> 16) & 255) * al;
        im.data[p + 2] = im.data[p + 2] * (1 - al) + ((c >>> 8) & 255) * al;
      }
      g.putImageData(im, x, y);
    }
    i = j;
  } else { console.log('unknown op ' + op); break; }
}
</script>`;
fs.writeFileSync(out, html);
console.log('wrote ' + out);
