'use strict';
/*
 * node packages/seatlights/app/tools/preview_ui.js [out.html] [on|off|waiting]: the app's drawn screen (src/ui.js),
 * played back onto a browser canvas the way the renderer draws its ops (Light Logger's player). Open it in a browser.
 */
const fs = require('fs');
const path = require('path');
const ui = require('../src/ui.js');

const out = process.argv[2] || path.join(__dirname, '..', '..', 'design', 'app_preview.html');
const variant = process.argv[3] || 'on';
const models = {
    on: { on: true, holding: true, note: 'On', warn: false, output: 45, layout: 1 },
    off: { on: false, holding: false, note: 'Off', warn: false, output: 45, layout: 1 },
    waiting: { on: true, holding: false, bypassed: true, note: 'On: off while the car is locked', warn: false, output: 45, layout: 1 },
};
const { rec } = ui.draw(new ui.Recorder(), Object.assign({ focus: 'slSwitch' }, models[variant]));
const words = Array.from(rec.words());
const atlases = rec.atlases.map((a) => ({ id: a.id, w: a.w, h: a.h, alpha: a.alpha.toString('base64') }));
/* the pictures a frame draws: premultiplied RGBA, as the renderer gets them */
const pics = require('../src/seat_images.js');
const pictures = rec.images.map((id) => ({ id: id, w: pics.w, h: pics.h,
    data: require('zlib').inflateSync(Buffer.from(id === ui.PIC.on ? pics.on : pics.off, 'base64')).toString('base64') }));

const html = `<!doctype html><meta charset="utf-8"><title>Seat Lights preview</title>
<style>body{margin:0;background:#000}canvas{width:100%;display:block}</style>
<canvas id="c" width="${ui.W}" height="${ui.H}"></canvas>
<script>
const words = new Uint32Array(${JSON.stringify(words)});
const f = new Float32Array(words.buffer);
const atl = {};
${JSON.stringify(atlases)}.forEach((a) => { const b = atob(a.alpha); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); atl[a.id] = { w: a.w, h: a.h, a: u }; });
const g = document.getElementById('c').getContext('2d');
const pics = {};
${JSON.stringify(pictures)}.forEach((p) => {
  const b = atob(p.data), c = document.createElement('canvas'); c.width = p.w; c.height = p.h;
  const cx = c.getContext('2d'), im = cx.createImageData(p.w, p.h);
  for (let i = 0; i < b.length; i += 4) { const a = b.charCodeAt(i + 3); for (let k = 0; k < 3; k++) im.data[i + k] = a ? Math.min(255, b.charCodeAt(i + k) * 255 / a) : 0; im.data[i + 3] = a; }
  cx.putImageData(im, 0, 0); pics[p.id] = c;
});
const col = (v) => 'rgba(' + (v >>> 24) + ',' + ((v >>> 16) & 255) + ',' + ((v >>> 8) & 255) + ',' + ((v & 255) / 255) + ')';
const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
let i = 0;
while (i < words.length) {
  const op = words[i];
  if (op === 1) { g.fillStyle = col(words[i + 1]); g.fillRect(0, 0, ${ui.W}, ${ui.H}); i += 2; }
  else if (op === 2) { g.fillStyle = col(words[i + 5]); g.fillRect(f[i + 1], f[i + 2], f[i + 3], f[i + 4]); i += 6; }
  else if (op === 4) { g.fillStyle = col(words[i + 6]); rr(f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]); g.fill(); i += 7; }
  else if (op === 5) { g.strokeStyle = col(words[i + 7]); g.lineWidth = f[i + 6]; rr(f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]); g.stroke(); i += 8; }
  else if (op === 18) { const c = pics[words[i + 6]]; if (c) { g.imageSmoothingQuality = 'high'; g.drawImage(c, f[i + 1], f[i + 2], f[i + 3], f[i + 4]); } i += 7; }
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
