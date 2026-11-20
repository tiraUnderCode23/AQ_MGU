'use strict';
/**
 * logo.js - the Proven Performance Solutions logo, drawn from colour spans (logo-data.js, made from
 * the logo file by tools/logo_to_spans.py). Spans are plain rectangles, so the logo is sharp at any
 * size, keeps a see-through background, and needs no image decoder on the head unit.
 *
 *   size(w, part)                 -> { w, h } of the logo drawn w wide
 *   paint(c, x, y, w, part)       draw it straight onto a surface (use inside a cached layer, e.g. a dial face)
 *   draw(cv, x, y, w, part)       draw it on a frame through its own cached layer (GPU texture, drawn once)
 *
 * part: 'full' = the whole logo (PROVEN / PERFORMANCE / SOLUTIONS with the stripes),
 *       'word' = its first line only (PROVEN), for small places.
 */
const zlib = require('zlib');
const G = require('./kit/gauges');
const DATA = require('./logo-data');

let bands = null;
function load() {
    if (bands) return bands;
    const raw = zlib.inflateSync(Buffer.from(DATA.spans, 'base64'));
    const u = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    bands = [];
    let i = 1;
    for (let b = 0; b < u[0]; b++) {
        const y0 = u[i], y1 = u[i + 1], n = u[i + 2], runs = [];
        i += 3;
        for (let k = 0; k < n; k++, i += 3) runs.push([u[i], u[i + 1], u[i + 2]]);
        bands.push({ y0, y1, runs });
    }
    return bands;
}
/** Source rows [from, to] of a part. */
const rowsOf = (part) => (part === 'word' ? DATA.lines[0] : [0, DATA.h]);

function size(w, part) {
    const r = rowsOf(part);
    return { w, h: w * (r[1] - r[0]) / DATA.w };
}

/*
 * Painted a row of device pixels at a time (as a scanline renderer would): every rectangle is whole
 * pixel rows high, so no hairlines show between them at any size, and its left and right ends keep
 * their exact position, so slanted strokes stay smooth. c.textScale (or c.k) = device pixels per logical one.
 */
function paint(c, x, y, w, part) {
    // (a frame or layer says its scale as textScale, the widget's canvas as k)
    const r = rowsOf(part), s = w / DATA.w, k = c.textScale || c.k || 1, all = load();
    const rows = Math.max(1, Math.round((r[1] - r[0]) * s * k));
    y = Math.round(y * k) / k;                                    // on a device pixel row
    let bi = 0, from = 0, cur = null;
    const flush = (to) => {
        if (cur) for (const run of cur.runs) c.fillRect(x + run[0] * s, y + from / k, (run[1] - run[0]) * s, (to - from) / k, DATA.colors[run[2] - 1]);
    };
    for (let p = 0; p < rows; p++) {
        const sy = r[0] + (p + 0.5) / rows * (r[1] - r[0]);       // the source row at this pixel row's middle
        while (bi < all.length && all[bi].y1 <= sy) bi++;
        const b = bi < all.length && all[bi].y0 <= sy ? all[bi] : null;
        if (b !== cur) { flush(p); cur = b; from = p; }
    }
    flush(rows);
    return size(w, part).h;
}

function draw(cv, x, y, w, part) {
    const z = size(w, part), W = Math.ceil(w) + 2, H = Math.ceil(z.h) + 2;
    cv.blit(G.layer(['pps-logo', part || 'full', Math.round(w * 4)].join('|'), W, H, (c) => paint(c, 1, 1, w, part), cv.textScale), Math.round(x) - 1, Math.round(y) - 1);
    return z.h;
}

module.exports = { size, paint, draw, COLORS: DATA.colors };
