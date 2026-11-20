'use strict';
/**
 * logos.js - a channel's logo (PNG or JPEG bytes from the service) made into the picture the page draws: decoded,
 * scaled smoothly (box filter) to fit the plate at its exact size, laid on the plate's colour (UHF's look: each logo
 * on a tile tinted by the logo's own colour). The kit's image op scales by nearest pixel, so pictures are made at the
 * size they are drawn. amn_iptv's own.
 *
 *   const pic = make(bytes, w, h)   -> { w, h, rgba (Buffer), plate: '#rrggbb' } or null
 *   const pic = poster(bytes, w, h) -> the same, a film's or a series' poster filling w x h (cropped, not on a plate)
 */
const png = require('./png_decode');
let jpeg = null;
function decode(b) {
    if (b[0] === 0x89 && b[1] === 0x50) { const p = png.decode(b); return { w: p.w, h: p.h, d: p.rgba }; }
    if (b[0] === 0xff && b[1] === 0xd8) {
        if (!jpeg) jpeg = require('./jpeg_decoder');
        const j = jpeg(b, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 32 });
        return { w: j.width, h: j.height, d: j.data };
    }
    return null;
}
/** the logo's main colour: the commonest saturated, mid-light colour of its opaque pixels */
function mainColour(p) {
    const n = {}, step = Math.max(1, Math.floor(p.w * p.h / 4096));
    let best = null, bestN = 0;
    for (let i = 0; i < p.w * p.h; i += step) {
        const o = i * 4, r = p.d[o], g = p.d[o + 1], b = p.d[o + 2], a = p.d[o + 3];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (r + g + b) / 3;
        if (a < 200 || l < 40 || l > 230 || mx - mn < 40) continue;
        const k = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5);
        const e = n[k] || (n[k] = [0, 0, 0, 0]);
        e[0] += r; e[1] += g; e[2] += b; e[3]++;
        if (e[3] > bestN) { bestN = e[3]; best = e; }
    }
    return best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]] : [110, 110, 118];
}
const hex = (c) => '#' + c.map((v) => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('');
/** the plate: the logo's colour, softened toward a light grey (UHF's tiles) */
function plateOf(c) { return c.map((v, i) => v + ([196, 196, 202][i] - v) * 0.62); }

function make(bytes, bw, bh) {
    let p;
    try { p = decode(bytes); } catch (e) { return null; }
    if (!p || !p.w || !p.h) return null;
    const plate = plateOf(mainColour(p));
    const out = Buffer.alloc(bw * bh * 4);
    for (let i = 0; i < bw * bh; i++) { out[i * 4] = plate[0]; out[i * 4 + 1] = plate[1]; out[i * 4 + 2] = plate[2]; out[i * 4 + 3] = 255; }
    // the logo fitted into 74% x 64% of the plate, centred
    const s = Math.min(bw * 0.74 / p.w, bh * 0.64 / p.h);
    const w = Math.max(1, Math.round(p.w * s)), h = Math.max(1, Math.round(p.h * s));
    const ox = (bw - w) >> 1, oy = (bh - h) >> 1, inv = 1 / s;
    for (let y = 0; y < h; y++) {
        const sy0 = Math.floor(y * inv), sy1 = Math.min(p.h, Math.max(sy0 + 1, Math.floor((y + 1) * inv)));
        for (let x = 0; x < w; x++) {
            const sx0 = Math.floor(x * inv), sx1 = Math.min(p.w, Math.max(sx0 + 1, Math.floor((x + 1) * inv)));
            let r = 0, g = 0, b = 0, a = 0, k = 0;
            for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) {
                const o = (yy * p.w + xx) * 4, al = p.d[o + 3];
                r += p.d[o] * al; g += p.d[o + 1] * al; b += p.d[o + 2] * al; a += al; k++;
            }
            if (!a) continue;
            const al = a / k / 255, d = ((oy + y) * bw + ox + x) * 4;
            out[d] = Math.round(r / a * al + out[d] * (1 - al));
            out[d + 1] = Math.round(g / a * al + out[d + 1] * (1 - al));
            out[d + 2] = Math.round(b / a * al + out[d + 2] * (1 - al));
        }
    }
    return { w: bw, h: bh, rgba: out, plate: hex(plate), colour: hex(mainColour(p)) };
}
/** a poster: scaled to cover w x h (box filter), the overflow cropped evenly; its plate is its main colour, dimmed */
function poster(bytes, bw, bh) {
    let p;
    try { p = decode(bytes); } catch (e) { return null; }
    if (!p || !p.w || !p.h) return null;
    const s = Math.max(bw / p.w, bh / p.h), inv = 1 / s;
    const ox = (p.w * s - bw) / 2, oy = (p.h * s - bh) / 2;
    const out = Buffer.alloc(bw * bh * 4);
    for (let y = 0; y < bh; y++) {
        const sy0 = Math.min(p.h - 1, Math.floor((y + oy) * inv)), sy1 = Math.min(p.h, Math.max(sy0 + 1, Math.floor((y + oy + 1) * inv)));
        for (let x = 0; x < bw; x++) {
            const sx0 = Math.min(p.w - 1, Math.floor((x + ox) * inv)), sx1 = Math.min(p.w, Math.max(sx0 + 1, Math.floor((x + ox + 1) * inv)));
            let r = 0, g = 0, b = 0, k = 0;
            for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) { const o = (yy * p.w + xx) * 4; r += p.d[o]; g += p.d[o + 1]; b += p.d[o + 2]; k++; }
            const d = (y * bw + x) * 4;
            out[d] = Math.round(r / k); out[d + 1] = Math.round(g / k); out[d + 2] = Math.round(b / k); out[d + 3] = 255;
        }
    }
    const c = mainColour(p);
    return { w: bw, h: bh, rgba: out, plate: hex(plateOf(c)), colour: hex(c) };
}
module.exports = { make, poster, mainColour, plateOf, hex };
