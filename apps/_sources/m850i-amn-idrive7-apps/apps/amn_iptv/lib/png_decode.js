'use strict';
/* amn_iptv: from leschi/mgu-media-client (apps/media/png.js), changed only to keep transparency (alpha and palette tRNS) for channel logos. MIT, Copyright (c) 2026 Leopold Poechinger / IbexData GmbH: see LICENSE.third-party. */
/**
 * png.js - a PNG to RGBA pixels, for node 8 on the head unit (no image library there): the posters
 * Jellyfin sends (format=Png), fitted into a box (fit) for a mgu-render/1 pixmap.
 * 8-bit grey, grey + alpha, RGB, RGBA and palette images, not interlaced (what Jellyfin's image
 * encoder writes); anything else throws. Alpha is dropped (the box is opaque).
 *
 *   const { w, h, rgba } = decode(buffer);  const box = fit({ w, h, rgba }, [r, g, b], bw, bh);
 */
const zlib = require('zlib');

const SIG = '89504e470d0a1a0a';
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decode(buf) {
    if (buf.length < 33 || buf.toString('hex', 0, 8) !== SIG) throw new Error('not a PNG');
    let w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
    const idat = [];
    for (let o = 8; o + 8 <= buf.length;) {
        const len = buf.readUInt32BE(o), kind = buf.toString('ascii', o + 4, o + 8), d = buf.slice(o + 8, o + 8 + len);
        if (kind === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
        else if (kind === 'PLTE') palette = d;
        else if (kind === 'tRNS') trns = d;
        else if (kind === 'IDAT') idat.push(d);
        else if (kind === 'IEND') break;
        o += 12 + len;
    }
    if (depth !== 8 || !CHANNELS[type] || interlace) throw new Error('PNG kind not handled: depth ' + depth + ', type ' + type + (interlace ? ', interlaced' : ''));
    if (type === 3 && !palette) throw new Error('PNG palette missing');
    if (!w || !h || w * h > 4e6) throw new Error('PNG size ' + w + 'x' + h);
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const bpp = CHANNELS[type], stride = w * bpp;
    if (raw.length < h * (stride + 1)) throw new Error('PNG data short');
    // the rows unfiltered in place (each row: a filter byte, then stride bytes)
    const px = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[up + x] : 0, c = x >= bpp && y ? px[up + x - bpp] : 0;
            const v = raw[src + x];
            px[row + x] = f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : f === 4 ? v + paeth(a, b, c) : v;
        }
    }
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
        const s = i * bpp;
        rgba[j + 3] = 255;
        if (type === 6 || type === 2) { rgba[j] = px[s]; rgba[j + 1] = px[s + 1]; rgba[j + 2] = px[s + 2]; if (type === 6) rgba[j + 3] = px[s + 3]; }
        else if (type === 3) { const k = px[s] * 3; rgba[j] = palette[k]; rgba[j + 1] = palette[k + 1]; rgba[j + 2] = palette[k + 2]; if (trns && px[s] < trns.length) rgba[j + 3] = trns[px[s]]; }
        else { rgba[j] = rgba[j + 1] = rgba[j + 2] = px[s]; if (type === 4) rgba[j + 3] = px[s + 1]; }
    }
    return { w, h, rgba };
}

/** a picture (w x h RGBA) scaled into a box bw x bh (proportions kept, centred, nearest pixel) on bg */
function fit(p, bg, bw, bh) {
    const out = Buffer.alloc(bw * bh * 4);
    for (let i = 0; i < bw * bh * 4; i += 4) { out[i] = bg[0]; out[i + 1] = bg[1]; out[i + 2] = bg[2]; out[i + 3] = 255; }
    const s = Math.min(bw / p.w, bh / p.h), w = Math.max(1, Math.round(p.w * s)), h = Math.max(1, Math.round(p.h * s));
    const ox = (bw - w) >> 1, oy = (bh - h) >> 1;
    for (let y = 0; y < h; y++) {
        const sy = Math.min(p.h - 1, (y / s) | 0) * p.w, row = ((oy + y) * bw + ox) * 4;
        for (let x = 0; x < w; x++) {
            const si = (sy + Math.min(p.w - 1, (x / s) | 0)) * 4, di = row + x * 4;
            out[di] = p.rgba[si]; out[di + 1] = p.rgba[si + 1]; out[di + 2] = p.rgba[si + 2];
        }
    }
    return out;
}

module.exports = { decode, fit };
