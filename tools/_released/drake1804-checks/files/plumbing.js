'use strict';
/**
 * The plumbing check: colour bars through mgu-render's video path on the car, before anything else is trusted. Run it
 * over SSH as root (the renderer does not gate root clients, so it shows without an HMI page). Node 8.
 *
 *   node plumbing.js bars [--seconds 60]        one still frame: right aspect? hides under a popup? comes back?
 *   node plumbing.js rate [--seconds 60]        frames at 30 a second: what the renderer presents is the ceiling for video
 *
 * Passes when the bars show at the right aspect, survive the time, hide when the HMI opens a popup and come back.
 * An `error` line below is the renderer refusing the file (owner or path); then read `journalctl -u mgu-render`.
 * With "stats N fps", N is what the HD 505 really presents; the player needs 28 or more.
 *
 * Options: --client FILE (the renderer's client; the installed one by default), --socket FILE, --frame-file FILE.
 */
const fs = require('fs');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WIDTH = 1280, HEIGHT = 720, SLOTS = 3, HEADER = 64;
const FRAME = WIDTH * HEIGHT * 3 / 2;
const mode = process.argv[2];
const seconds = Number(arg('--seconds', 60));
const file = arg('--frame-file', '/dev/shm/mgu-video-test');
const clientFile = arg('--client', '/var/opt/mgu-render/current/mgu_render_client.js');
if (mode !== 'bars' && mode !== 'rate') {
    console.log('usage: node plumbing.js bars|rate [--seconds N]');
    process.exit(2);
}
const { RenderClient, videoOp } = require(clientFile);

/* SMPTE-ish bars as limited-range BT.709 Y, U, V: white, yellow, cyan, green, magenta, red, blue, black */
const BARS = [[235, 128, 128], [219, 16, 138], [188, 154, 16], [173, 42, 26], [78, 214, 230], [63, 102, 240], [32, 240, 118], [16, 128, 128]];
function barsFrame(shift) {
    const f = Buffer.alloc(FRAME);
    const barW = WIDTH / BARS.length;
    const at = (x) => BARS[Math.floor(((x + shift) % WIDTH) / barW)];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) f[y * WIDTH + x] = at(x)[0];
    const cw = WIDTH / 2, ch = HEIGHT / 2, u0 = WIDTH * HEIGHT, v0 = u0 + cw * ch;
    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            f[u0 + y * cw + x] = at(x * 2)[1];
            f[v0 + y * cw + x] = at(x * 2)[2];
        }
    }
    return f;
}

const fd = fs.openSync(file, 'w+', 0o644);
const head = Buffer.alloc(HEADER);
[0x4656474d, 1, WIDTH, HEIGHT, 0, 0, SLOTS, 1, 0].forEach((v, i) => head.writeUInt32LE(v, i * 4));
fs.writeSync(fd, head, 0, HEADER, 0);
fs.ftruncateSync(fd, HEADER + FRAME * SLOTS);

let seq = 0, slot = 0;
const word = Buffer.alloc(4);
function writeWord(index, value) {
    word.writeUInt32LE(value, 0);
    fs.writeSync(fd, word, 0, 4, index * 4);
}
function present(frame) {
    slot = (slot + 1) % SLOTS;
    fs.writeSync(fd, frame, 0, FRAME, HEADER + slot * FRAME);
    writeWord(5, slot);
    writeWord(4, ++seq);
}
present(barsFrame(0));

const log = { info: (m) => console.log(m), warn: (m) => console.log(`warn: ${m}`) };
const gpu = new RenderClient('plumbing_check', log, { mode: 'layer', socket: arg('--socket') });
let words = null, framesShown = 0, statsSeen = 0;

gpu.on('ready', (screen, info) => {
    console.log(`ready ${JSON.stringify({ screen, info })}`);
    if (!info) { console.log('FAIL not mgu-render: it speaks no mgu-render/1'); process.exit(1); }
    if (!info.video) { console.log('FAIL this renderer has no video: update Renderer in the Store (0.4.0 or later)'); process.exit(1); }
    const box = info.appArea;
    gpu.mode('layer');
    gpu.place({ x: box.x, y: box.y, w: box.w, h: box.h, scale: 1, ox: 0, oy: 0 });
    gpu.video(1, file);
    words = videoOp(1, 0, 0, box.w, box.h, 0);
    gpu.frameWords(words);
    gpu.show(true);
    console.log(`bars at ${box.x},${box.y} ${box.w}x${box.h}`);
});
gpu.on('state', (s) => console.log(`state ${JSON.stringify(s)}`));
gpu.on('renderer-error', (e) => console.log(`error ${e}`));
gpu.on('stats', (s) => {
    statsSeen++;
    console.log(`stats ${s.fps} fps, render avg ${s.avgUs} us, max ${s.maxUs} us`);
});

/* a shown app must talk at least once a second, even with a still picture */
setInterval(() => { if (words) gpu.frameWords(words); }, 1000);

if (mode === 'rate') {
    const frames = [0, 160, 320, 480].map(barsFrame);     // made once: this measures the renderer, not this script
    const started = Date.now();
    setInterval(() => {
        const due = Math.floor((Date.now() - started) * 30 / 1000);
        while (framesShown < due) {
            present(frames[framesShown % frames.length]);
            framesShown++;
        }
    }, 10);
}

setTimeout(() => {
    console.log(`done: ${seq} frames written${mode === 'rate' ? ` at ${(framesShown / seconds).toFixed(1)} a second` : ''}, ${statsSeen} stats lines`);
    gpu.close();
    try { fs.unlinkSync(file); } catch (e) { /* gone already */ }
    process.exit(0);
}, seconds * 1000);
gpu.connect();
