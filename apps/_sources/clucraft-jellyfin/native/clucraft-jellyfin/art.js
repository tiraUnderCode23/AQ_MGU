'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * art.js - a poster from the Jellyfin server (a JPEG) made into the pixels the app draws: decoded, scaled smoothly to
 * cover exactly w x h (what hangs over is cut off evenly), opaque RGBA. Done here, in the client, so the app's own
 * process only copies pixels to the renderer and its screen never waits for a decoder.
 *
 *   const { cover } = require('./art');
 *   const rgba = cover(jpegBytes, 176, 264);     // Buffer, w * h * 4; throws when it is no picture
 *
 * Plain Node 8.
 */
let jpeg = null;

function decode(bytes) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
    if (!jpeg) jpeg = require('./jpeg_decoder');
    const j = jpeg(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 6, maxMemoryUsageInMB: 96 });
    if (!j || !j.width || !j.height) throw new Error('an empty picture');
    return { w: j.width, h: j.height, d: j.data };
}

/** p scaled to cover bw x bh (each pixel the mean of the source pixels under it), cropped evenly */
function scaleCover(p, bw, bh) {
    const s = Math.max(bw / p.w, bh / p.h), inv = 1 / s;
    const ox = (p.w * s - bw) / 2, oy = (p.h * s - bh) / 2;
    const out = Buffer.alloc(bw * bh * 4);
    const x0 = new Int32Array(bw), x1 = new Int32Array(bw);
    for (let x = 0; x < bw; x++) {
        x0[x] = Math.min(p.w - 1, Math.max(0, Math.floor((x + ox) * inv)));
        x1[x] = Math.min(p.w, Math.max(x0[x] + 1, Math.floor((x + ox + 1) * inv)));
    }
    for (let y = 0; y < bh; y++) {
        const sy0 = Math.min(p.h - 1, Math.max(0, Math.floor((y + oy) * inv)));
        const sy1 = Math.min(p.h, Math.max(sy0 + 1, Math.floor((y + oy + 1) * inv)));
        for (let x = 0; x < bw; x++) {
            let r = 0, g = 0, b = 0, k = 0;
            for (let yy = sy0; yy < sy1; yy++) {
                let i = (yy * p.w + x0[x]) * 4;
                for (let xx = x0[x]; xx < x1[x]; xx++, i += 4) { r += p.d[i]; g += p.d[i + 1]; b += p.d[i + 2]; k++; }
            }
            const d = (y * bw + x) * 4;
            out[d] = (r / k + 0.5) | 0; out[d + 1] = (g / k + 0.5) | 0; out[d + 2] = (b / k + 0.5) | 0; out[d + 3] = 255;
        }
    }
    return out;
}

function cover(bytes, w, h) { return scaleCover(decode(bytes), w, h); }

module.exports = { cover, decode, scaleCover };
