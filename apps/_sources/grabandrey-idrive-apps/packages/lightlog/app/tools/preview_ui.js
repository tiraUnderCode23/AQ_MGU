'use strict';
/*
 * node packages/lightlog/app/tools/preview_ui.js [out.html] [seat|empty|all|find]: the app's drawn screen (src/ui.js)
 * with a sample drive, played back onto a browser canvas the way the renderer draws its ops (the player is
 * Vitals' tools/preview_ui.js). Open the file in a browser.
 */
const fs = require('fs');
const path = require('path');
const ui = require('../src/ui.js');
const lin = require('../src/lin.js');
const screen = require('../src/screen_model.js');
const { Journal } = require('../src/journal.js');
const lamps = require('../src/lamps.js');
const { Finder } = require('../src/finder.js');

const out = process.argv[2] || path.join(__dirname, '..', '..', 'design', 'app_preview.html');
const variant = process.argv[3] || 'seat';

/* a sample drive: lights found, the engine started, a light with an unknown code going off, a mark */
const rec10 = (loc, r, g, b, bright) => [loc, b, g, r, bright, 0, 0, 0, 0, 0];
function reply(bus, recs) {
    const o = [0x62].concat(lin.BUSES[bus].did);
    for (let i = 0; i < 26; i++) o.push.apply(o, recs[i] || [0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    return o;
}
let t = new Date(2026, 10, 18, 14, 2, 0).getTime();
const j = new Journal({ now: () => t });
const logo = variant === 'empty' ? 0x0d : 0x5a;
const bus0 = (on) => [rec10(0x05, 254, 120, 0, 70), rec10(0x07, 254, 120, 0, 70), rec10(0x01, 254, 120, 0, 40), rec10(0x13, 254, 120, 0, 70),
    rec10(0x15, 254, 120, 0, 70), rec10(0x1f, 254, 120, 0, 50), rec10(logo, 255, 255, 255, on ? 100 : 0)];
const bus1 = [rec10(0x0c, 254, 120, 0, 70), rec10(0x0e, 254, 120, 0, 70), rec10(0x03, 254, 120, 0, 40), rec10(0x17, 254, 120, 0, 70),
    rec10(0x2b, 254, 120, 0, 60), rec10(0x2d, 254, 120, 0, 60)];
j.note('Light Logger started');
const lampBytes = [0, 1, 1, 0, 0x64, 0, 0, 1, 0, 0, 0x32, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0];
j.lights(2, lamps.parse([0x62, 0xe3, 0xb9].concat(lampBytes), [0xe3, 0xb9]));
j.lights(0, lin.parseStatus(0, reply(0, bus0(true))));
j.lights(1, lin.parseStatus(1, reply(1, bus1)));
j.rpm({ actualValueRPMEngineCrankshaft: 0 });
j.speed({ speedVehicleCentreOfGravity: 0 });
t += 21000; j.rpm({ actualValueRPMEngineCrankshaft: 2880 });
if (variant !== 'empty') {
    t += 18000; j.lights(0, lin.parseStatus(0, reply(0, bus0(false))));
    t += 3000; j.mark();
    j.togglePin('2:5');
}
const keep = variant === 'empty' ? {} : { output: 5, enabled: true, holding: true, mode: 'keep', fails: 0, note: 'holding lamp output 5 on (the body controller took it)' };
const st = { keep: keep, linkReady: true, buses: [{ modules: 7, on: 6, reads: 12 }, { modules: 6, on: 6, reads: 12 }, { modules: 24, on: 8, reads: 12 }, {}], engine: true, kmh: 0 };
/* the finder, learned, with two snapshots each */
const finder = new Finder({ uds: null, log: { info() {}, warn() {} } });
finder.units = [0x40, 0x6d];
finder.known = { 64: { dids: {}, next: 12288, done: true }, 109: { dids: {}, next: 12288, done: true } };
for (let i = 0; i < 412; i++) finder.known[64].dids[0xd000 + i] = 1;
for (let i = 0; i < 37; i++) finder.known[109].dids[0x4000 + i] = 1;
const snap = (on) => ({ t: t, values: { 'd:6D:4012': on ? '01' : '00', 'd:40:D5A1': on ? '0164' : '0000', 'd:40:D021': on ? '03' : '02', 'd:40:D300': '07' } });
finder.snaps = { on: [snap(true), snap(true)], off: [snap(false), snap(false)] };
const view = variant === 'all' ? 'all' : variant === 'find' ? 'find' : 'seat';
const { rec } = ui.draw(new ui.Recorder(), screen.drawModel(j, st, view, 'llMark', null, finder, 0));
const words = Array.from(rec.words());
const atlases = rec.atlases.map((a) => ({ id: a.id, w: a.w, h: a.h, alpha: a.alpha.toString('base64') }));

const html = `<!doctype html><meta charset="utf-8"><title>Light Logger preview</title>
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
