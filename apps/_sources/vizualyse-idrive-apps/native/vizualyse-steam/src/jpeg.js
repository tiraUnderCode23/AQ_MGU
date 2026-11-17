// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * A baseline JPEG reader, for Steam's store pictures on the touch screen
 * (capsule_616x353.jpg, header.jpg: baseline, 8-bit, YCbCr, checked
 * 2026-11-16). Node 8, no dependencies: written from the JPEG standard
 * (ITU-T T.81: Huffman tables, the zigzag order, the IDCT) and JFIF's
 * YCbCr. Chroma subsampled 2x across (4:2:2) or 2x both ways (4:2:0) is
 * upsampled the "fancy" way libjpeg does by default (each sample 3/4 its
 * own, 1/4 its neighbour's), so the picture matches what other readers
 * give within a level or two; other ratios take the nearest sample.
 *
 *   decode(buf)   { w, h, rgba } (alpha 255), or throws Error: progressive,
 *                 arithmetic-coded, 12-bit, CMYK or damaged files
 */
'use strict';

/* the zigzag order: the k-th coefficient in a block's stream is at ZZ[k] */
const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

/* the IDCT's basis: T[x * 8 + u] = C(u) cos((2x + 1) u pi / 16) / 2 */
const T = new Float64Array(64);
for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) T[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos((2 * x + 1) * u * Math.PI / 16) / 2;

const MAX_PIXELS = 16 * 1024 * 1024;

function fail(msg) { throw new Error('jpeg: ' + msg); }

/* a Huffman table from its 16 counts and its symbols (T.81 annex C) */
function huffman(counts, symbols) {
    const maxcode = new Int32Array(18).fill(-1), valptr = new Int32Array(17), mincode = new Int32Array(17);
    let code = 0, k = 0;
    for (let l = 1; l <= 16; l++) {
        valptr[l] = k;
        mincode[l] = code;
        code += counts[l - 1];
        k += counts[l - 1];
        maxcode[l] = counts[l - 1] ? code - 1 : -1;
        code <<= 1;
    }
    return { maxcode: maxcode, valptr: valptr, mincode: mincode, symbols: symbols };
}

/* the entropy-coded data: bits, the stuffed 0x00 after 0xFF dropped, stopping at a marker */
class Bits {
    constructor(buf, pos) { this.b = buf; this.pos = pos; this.acc = 0; this.n = 0; this.marker = null; }
    bit() {
        if (this.n === 0) {
            let v = 0;
            if (this.marker === null) {
                if (this.pos >= this.b.length) fail('the data ends inside a scan');
                v = this.b[this.pos];
                if (v === 0xff) {
                    const nx = this.b[this.pos + 1];
                    if (nx === 0) this.pos += 2;
                    else { this.marker = nx; v = 0; }   /* pos stays on the marker's 0xFF */
                } else this.pos++;
            }
            this.acc = v; this.n = 8;
        }
        this.n--;
        return (this.acc >> this.n) & 1;
    }
    get(s) { let v = 0; for (let i = 0; i < s; i++) v = (v << 1) | this.bit(); return v; }
    decode(h) {
        let code = 0;
        for (let l = 1; l <= 16; l++) {
            code = (code << 1) | this.bit();
            if (code <= h.maxcode[l]) return h.symbols[h.valptr[l] + code - h.mincode[l]];
        }
        fail('a bad Huffman code');
    }
    /* at a restart: the rest of the byte dropped, the RSTn marker passed */
    restart() {
        this.n = 0;
        if (this.marker === null) {
            while (this.pos + 1 < this.b.length && !(this.b[this.pos] === 0xff && this.b[this.pos + 1] >= 0xd0 && this.b[this.pos + 1] <= 0xd7)) this.pos++;
            if (this.pos + 1 >= this.b.length) fail('a restart marker is missing');
            this.pos += 2;
        } else if (this.marker >= 0xd0 && this.marker <= 0xd7) {
            this.pos += 2; this.marker = null;
        } else fail('a restart marker is missing');
    }
    /* where the next marker after the scan starts */
    end() {
        let p = this.pos;
        while (p + 1 < this.b.length && !(this.b[p] === 0xff && this.b[p + 1] !== 0 && !(this.b[p + 1] >= 0xd0 && this.b[p + 1] <= 0xd7))) p++;
        return p;
    }
}

function extend(v, s) { return v < (1 << (s - 1)) ? v - (1 << s) + 1 : v; }

/* one 8x8 block: decoded, dequantised, inverse-transformed into the plane */
const coef = new Float64Array(64), rows = new Float64Array(64);
function block(bits, c, q, plane, stride, bx, by) {
    coef.fill(0);
    const t = bits.decode(c.dc);
    c.pred += t ? extend(bits.get(t), t) : 0;
    coef[0] = c.pred * q[0];
    for (let k = 1; k < 64;) {
        const rs = bits.decode(c.ac), r = rs >> 4, s = rs & 15;
        if (!s) { if (r !== 15) break; k += 16; continue; }
        k += r;
        if (k > 63) fail('a block runs past 64 coefficients');
        coef[ZZ[k]] = extend(bits.get(s), s) * q[k];
        k++;
    }
    for (let v = 0; v < 8; v++) {
        const o = v * 8;
        for (let x = 0; x < 8; x++) {
            let s = 0;
            for (let u = 0; u < 8; u++) s += T[x * 8 + u] * coef[o + u];
            rows[o + x] = s;
        }
    }
    for (let y = 0; y < 8; y++) {
        const at = (by * 8 + y) * stride + bx * 8;
        for (let x = 0; x < 8; x++) {
            let s = 0;
            for (let v = 0; v < 8; v++) s += T[y * 8 + v] * rows[v * 8 + x];
            const p = Math.round(s + 128);
            plane[at + x] = p < 0 ? 0 : p > 255 ? 255 : p;
        }
    }
}

/* a component's plane brought to the picture's size (w x h, stride w) */
function upsample(c, w, h, hmax, vmax) {
    const out = new Uint8Array(w * h), src = c.plane, sw = c.stride, cw = c.cw, ch = c.ch;
    if (c.h === hmax && c.v === vmax) {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = src[y * sw + x];
        return out;
    }
    if (hmax === 2 * c.h && (vmax === c.v || vmax === 2 * c.v)) {
        const two = vmax === 2 * c.v;
        for (let y = 0; y < h; y++) {
            const sy = two ? y >> 1 : y;
            /* the row above or below (fancy: 3/4 this row, 1/4 that), edges repeated */
            const ny = !two ? sy : (y & 1) ? Math.min(sy + 1, ch - 1) : Math.max(sy - 1, 0);
            const sum = (x) => {
                const xx = x < 0 ? 0 : x >= cw ? cw - 1 : x;
                return two ? 3 * src[sy * sw + xx] + src[ny * sw + xx] : 4 * src[sy * sw + xx];
            };
            for (let x = 0; x < w; x++) {
                const sx = x >> 1, me = sum(sx);
                /* libjpeg's rounding: +8 / +7 (2x2), +2 / +1 in quarters (2x1) */
                const v = (x & 1) ? (3 * me + sum(sx + 1) + (two ? 7 : 4)) >> 4 : (3 * me + sum(sx - 1) + 8) >> 4;
                out[y * w + x] = v;
            }
        }
        return out;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = src[Math.floor(y * c.v / vmax) * sw + Math.floor(x * c.h / hmax)];
    return out;
}

function decode(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) fail('not a JPEG');
    const qt = [], dc = [], ac = [];
    let frame = null, interval = 0, adobe = null, pos = 2;
    while (pos + 4 <= buf.length) {
        if (buf[pos] !== 0xff) fail('a marker was expected at ' + pos);
        const m = buf[pos + 1];
        if (m === 0xff) { pos++; continue; }
        if (m === 0xd9) break;
        const len = buf.readUInt16BE(pos + 2), seg = pos + 4, end = pos + 2 + len;
        if (len < 2 || end > buf.length) fail('a truncated segment');
        if (m === 0xdb) {
            for (let p = seg; p < end;) {
                const pq = buf[p] >> 4, tq = buf[p] & 15, q = new Int32Array(64);
                if (tq > 3) fail('a bad quantisation table');
                for (let k = 0; k < 64; k++) q[k] = pq ? buf.readUInt16BE(p + 1 + 2 * k) : buf[p + 1 + k];
                qt[tq] = q;
                p += 1 + 64 * (pq ? 2 : 1);
            }
        } else if (m === 0xc4) {
            for (let p = seg; p < end;) {
                const tc = buf[p] >> 4, th = buf[p] & 15, counts = buf.slice(p + 1, p + 17);
                let n = 0;
                for (let i = 0; i < 16; i++) n += counts[i];
                if (th > 3 || tc > 1 || p + 17 + n > end) fail('a bad Huffman table');
                (tc ? ac : dc)[th] = huffman(counts, buf.slice(p + 17, p + 17 + n));
                p += 17 + n;
            }
        } else if (m === 0xc0 || m === 0xc1) {
            if (buf[seg] !== 8) fail(buf[seg] + '-bit samples (only 8-bit)');
            const h = buf.readUInt16BE(seg + 1), w = buf.readUInt16BE(seg + 3), nf = buf[seg + 5];
            if (!w || !h) fail('no size (DNL is not supported)');
            if (w * h > MAX_PIXELS) fail('too big (' + w + 'x' + h + ')');
            if (nf !== 1 && nf !== 3) fail(nf + ' components (only grey or colour)');
            const comps = [];
            for (let i = 0; i < nf; i++) {
                const a = seg + 6 + 3 * i;
                const c = { id: buf[a], h: buf[a + 1] >> 4, v: buf[a + 1] & 15, tq: buf[a + 2], pred: 0 };
                if (c.h < 1 || c.h > 4 || c.v < 1 || c.v > 4) fail('a bad sampling factor');
                comps.push(c);
            }
            const hmax = Math.max.apply(null, comps.map((c) => c.h)), vmax = Math.max.apply(null, comps.map((c) => c.v));
            const mx = Math.ceil(w / (8 * hmax)), my = Math.ceil(h / (8 * vmax));
            comps.forEach((c) => {
                c.stride = mx * c.h * 8;
                c.plane = new Uint8Array(c.stride * my * c.v * 8);
                c.cw = Math.ceil(w * c.h / hmax); c.ch = Math.ceil(h * c.v / vmax);
            });
            frame = { w: w, h: h, comps: comps, hmax: hmax, vmax: vmax, mx: mx, my: my };
        } else if (m >= 0xc2 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
            fail(m === 0xc2 ? 'progressive (only baseline)' : 'an unsupported coding (0x' + m.toString(16) + ')');
        } else if (m === 0xdd) {
            interval = buf.readUInt16BE(seg);
        } else if (m === 0xee && len >= 14 && buf.toString('latin1', seg, seg + 5) === 'Adobe') {
            adobe = buf[seg + 11];
        } else if (m === 0xda) {
            if (!frame) fail('a scan before the frame');
            const ns = buf[seg], sc = [];
            for (let i = 0; i < ns; i++) {
                const id = buf[seg + 1 + 2 * i], t = buf[seg + 2 + 2 * i];
                const c = frame.comps.filter((x) => x.id === id)[0];
                if (!c || !dc[t >> 4] || !ac[t & 15] || !qt[c.tq]) fail('a scan with a missing component or table');
                c.dc = dc[t >> 4]; c.ac = ac[t & 15]; c.pred = 0;
                sc.push(c);
            }
            const bits = new Bits(buf, end);
            let n = 0;
            const tick = () => {
                if (interval && n > 0 && n % interval === 0) { bits.restart(); sc.forEach((c) => { c.pred = 0; }); }
                n++;
            };
            if (sc.length === 1) {
                /* one component by itself: its own grid of blocks, a block an MCU */
                const c = sc[0], bw = Math.ceil(c.cw / 8), bh = Math.ceil(c.ch / 8);
                for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) { tick(); block(bits, c, qt[c.tq], c.plane, c.stride, bx, by); }
            } else {
                for (let my = 0; my < frame.my; my++) for (let mx = 0; mx < frame.mx; mx++) {
                    tick();
                    sc.forEach((c) => {
                        for (let v = 0; v < c.v; v++) for (let u = 0; u < c.h; u++) block(bits, c, qt[c.tq], c.plane, c.stride, mx * c.h + u, my * c.v + v);
                    });
                }
            }
            pos = bits.end();
            continue;
        }
        pos = end;
    }
    if (!frame) fail('no picture');
    const w = frame.w, h = frame.h, out = Buffer.alloc(w * h * 4);
    const planes = frame.comps.map((c) => upsample(c, w, h, frame.hmax, frame.vmax));
    const rgb = frame.comps.length === 3 && adobe === 0;   /* Adobe's "no transform": RGB as it is */
    const c8 = (v) => { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; };
    for (let i = 0, o = 0; i < w * h; i++, o += 4) {
        if (planes.length === 1) { out[o] = out[o + 1] = out[o + 2] = planes[0][i]; }
        else if (rgb) { out[o] = planes[0][i]; out[o + 1] = planes[1][i]; out[o + 2] = planes[2][i]; }
        else {
            const y = planes[0][i], cb = planes[1][i] - 128, cr = planes[2][i] - 128;
            out[o] = c8(y + 1.402 * cr);
            out[o + 1] = c8(y - 0.344136 * cb - 0.714136 * cr);
            out[o + 2] = c8(y + 1.772 * cb);
        }
        out[o + 3] = 255;
    }
    return { w: w, h: h, rgba: out };
}

module.exports = { decode };
