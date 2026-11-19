'use strict';
/*
 * Vitals: the app's own screen, drawn by the head unit's renderer (gpu.js) over the HMI page.
 * Pure: draw(model) records a frame (renderd draw ops, 32-bit words) and returns what a tap or the
 * controller can press on it. Tested and previewed on a desktop (tools/test_model.js, tools/preview_ui.js).
 *
 * Logical size W x H (the iDrive 8 app area, 2880 x 764); gpu.js scales it to the real area.
 *
 *   Vitals                                        [Widget on] [Engine live] [Gearbox ...] [Tyres ...]  [Reset]
 *   +--- LIVE --------------------------+  +--- SETTINGS --------------------------------------------+
 *   | WATER                       92 °C |  | Temperature unit   Car setting | Pressure unit       bar  |
 *   | ////////////////////---------     |  | Water warning           115 °C | Engine oil warning ... |
 *   | ENGINE OIL ...                    |  | Gearbox oil warning ...        | Gauge colour     Blue  |
 *   | GEARBOX OIL ...                   |  | Tyre pressures          Shown  | Demo values       Off  |
 *   | TYRES  FL 41 °C 2.4 bar ...       |  | Widget position  [^] 10 px [v] | Widget size [-] 100 [+]|
 *   +-----------------------------------+  +--------------------------------------------------------+
 *
 * Each pressable thing has the key of the settings row it stands for (settings_model.js ROWS name):
 * the HMI's own list under the drawn screen keeps the controller's focus, and its focused row lights
 * up the matching tile here.
 */
const FONT = require('./ui_font.js');

const W = 2880, H = 764;
const OP = { CLEAR: 1, RECT: 2, RRECT: 4, RSTROKE: 5, GLYPHS: 11, QUAD: 15 };

const C = {
    bg: [9, 11, 16, 255], card: [17, 20, 28, 255], line: [36, 41, 54, 255], tile: [25, 29, 40, 255],
    tileFocus: [33, 43, 64, 255], text: [242, 244, 248, 255], dim: [138, 147, 166, 255], faint: [86, 93, 110, 255],
    track: [38, 41, 49, 255], red: [229, 67, 46, 255], green: [60, 192, 122, 255], orange: [240, 160, 48, 255],
    blueCold: [77, 148, 245, 255],
};
const ACCENTS = { blue: [30, 123, 224, 255], lightblue: [87, 168, 245, 255], white: [228, 232, 240, 255] };

function pack(c) { return (((c[0] & 255) << 24) | ((c[1] & 255) << 16) | ((c[2] & 255) << 8) | (c[3] & 255)) >>> 0; }

/* ---- glyph atlases: one per style, packed in rows, built once ---- */
const atlases = {};
function atlas(style) {
    if (atlases[style]) return atlases[style];
    const f = FONT[style], AW = 1024, pad = 2;
    const glyphs = {};
    let x = pad, y = pad, rowH = 0;
    const place = [];
    Object.keys(f.glyphs).forEach((ch) => {
        const g = f.glyphs[ch], w = g[3], h = g[4];
        if (x + w + pad > AW) { x = pad; y += rowH + pad; rowH = 0; }
        place.push([ch, x, y]);
        glyphs[ch] = { adv: g[0], ox: g[1], oy: g[2], w: w, h: h, x: x, y: y };
        x += w + pad;
        rowH = Math.max(rowH, h);
    });
    let AH = 64;
    while (AH < y + rowH + pad) AH *= 2;
    const alpha = Buffer.alloc(AW * AH);
    place.forEach((p) => {
        const g = f.glyphs[p[0]], w = g[3], h = g[4];
        if (!w || !h) return;
        const src = Buffer.from(g[5], 'base64');
        for (let r = 0; r < h; r++) src.copy(alpha, (p[2] + r) * AW + p[1], r * w, r * w + w);
    });
    let id = 0;
    const key = 'ida_vitals/' + style + '@' + f.px;
    for (let i = 0; i < key.length; i++) id = (Math.imul(id, 31) + key.charCodeAt(i)) >>> 0;
    atlases[style] = { id: (id | 1) >>> 0, w: AW, h: AH, alpha: alpha, glyphs: glyphs, px: f.px, ascent: f.ascent };
    return atlases[style];
}

/* ---- a frame's draw ops ---- */
class Recorder {
    constructor() { this.u = new Uint32Array(16384); this.f = new Float32Array(this.u.buffer); this.n = 0; this.atlases = []; }
    reset() { this.n = 0; this.atlases = []; return this; }
    words() { return this.u.subarray(0, this.n); }
    _grow(k) {
        if (this.n + k <= this.u.length) return;
        const u = new Uint32Array(Math.max(this.u.length * 2, this.n + k));
        u.set(this.u.subarray(0, this.n));
        this.u = u; this.f = new Float32Array(u.buffer);
    }
    clear(c) { this._grow(2); this.u[this.n++] = OP.CLEAR; this.u[this.n++] = pack(c); return this; }
    rect(x, y, w, h, c) {
        if (!(w > 0 && h > 0)) return this;
        this._grow(6); const i = this.n, f = this.f;
        this.u[i] = OP.RECT; f[i + 1] = x; f[i + 2] = y; f[i + 3] = w; f[i + 4] = h; this.u[i + 5] = pack(c);
        this.n += 6; return this;
    }
    rrect(x, y, w, h, r, c) {
        if (!(w > 0 && h > 0)) return this;
        this._grow(7); const i = this.n, f = this.f;
        this.u[i] = OP.RRECT; f[i + 1] = x; f[i + 2] = y; f[i + 3] = w; f[i + 4] = h; f[i + 5] = r; this.u[i + 6] = pack(c);
        this.n += 7; return this;
    }
    stroke(x, y, w, h, r, width, c) {
        this._grow(8); const i = this.n, f = this.f;
        this.u[i] = OP.RSTROKE; f[i + 1] = x; f[i + 2] = y; f[i + 3] = w; f[i + 4] = h; f[i + 5] = r; f[i + 6] = width; this.u[i + 7] = pack(c);
        this.n += 8; return this;
    }
    /* a filled convex quad, points in order (a triangle: one point twice) */
    quad(pts, c) {
        this._grow(10); let i = this.n; const f = this.f;
        this.u[i++] = OP.QUAD;
        pts.forEach((p) => { f[i++] = p[0]; f[i++] = p[1]; });
        this.u[i++] = pack(c);
        this.n = i; return this;
    }
    width(style, s, spacing) {
        const a = atlas(style);
        let w = 0;
        for (const ch of String(s)) { const g = a.glyphs[ch] || a.glyphs['?']; if (g) w += g.adv; }
        return w + (spacing || 0) * Math.max(0, String(s).length - 1);
    }
    /* text, y the baseline; align 'left' | 'right' | 'center'; returns its width */
    text(style, s, x, y, c, align, spacing) {
        s = String(s);
        const a = atlas(style), sp = spacing || 0, w = this.width(style, s, sp);
        let pen = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
        const head = this.n;
        this._grow(4 + s.length * 8);
        let i = head + 4, cnt = 0;
        const f = this.f;
        for (const ch of s) {
            const g = a.glyphs[ch] || a.glyphs['?'];
            if (!g) continue;
            if (g.w && g.h) {
                f[i++] = Math.round(pen + g.ox); f[i++] = y + g.oy; f[i++] = g.w; f[i++] = g.h;
                f[i++] = g.x; f[i++] = g.y; f[i++] = g.x + g.w; f[i++] = g.y + g.h;
                cnt++;
            }
            pen += g.adv + sp;
        }
        if (cnt) {
            this.u[head] = OP.GLYPHS; this.u[head + 1] = a.id; this.u[head + 2] = pack(c); this.u[head + 3] = cnt;
            this.n = i;
            if (this.atlases.indexOf(a) < 0) this.atlases.push(a);
        }
        return w;
    }
}

/* ---- the model -> what is shown ---- */
function num(v) { return typeof v === 'number' && isFinite(v); }
function tempUnit(s, d) { return s && s.tempUnit !== 'auto' ? s.tempUnit : (d && d.carTemp) || 'C'; }
function pressUnit(s, d) {
    if (s && s.pressUnit !== 'auto') return s.pressUnit;
    return { BAR: 'bar', KPA: 'kPa', PSI: 'psi' }[d && d.carPress] || 'bar';
}
function fmtT(c, tu) { return num(c) ? String(Math.round(tu === 'F' ? c * 9 / 5 + 32 : c)) : '– –'; }
function fmtP(b, pu) {
    if (!num(b)) return '– –';
    if (pu === 'psi') return String(Math.round(b * 14.5038));
    if (pu === 'kPa') return String(Math.round(b * 100));
    return b.toFixed(1);
}
function tyreColour(c) {
    if (!num(c)) return C.track;
    if (c < 20) return C.blueCold;
    if (c < 45) return C.green;
    if (c < 70) return C.orange;
    return C.red;
}

/* a tyre seen from above: dark rubber faintly tinted by its temperature, a centre groove and V sipes */
function tyreIcon(rec, x, y, w, h, t) {
    const tint = tyreColour(t), amt = num(t) ? 0.22 : 0;
    const mix = (a, b, k) => [0, 1, 2].map((i) => Math.round(a[i] * (1 - k) + b[i] * k)).concat(255);
    const rubber = mix([20, 21, 24], tint, amt);
    rec.rrect(x, y, w, h, 9, mix([70, 72, 78], tint, amt * 1.6));
    rec.rrect(x + 1.5, y + 1.5, w - 3, h - 3, 8, rubber);
    rec.rrect(x + 5, y + 2, w - 10, h - 4, 6, mix(rubber, [255, 255, 255], 0.06));
    const groove = mix(rubber, [0, 0, 0], 0.6), cx = x + w / 2;
    rec.rect(cx - 1.5, y + 4, 3, h - 8, groove);
    for (let yy = y + 8; yy < y + h - 8; yy += 9) {
        rec.quad([[x + 4, yy], [cx - 3, yy + 5], [cx - 3, yy + 7], [x + 4, yy + 2]], groove);
        rec.quad([[cx + 3, yy + 5], [x + w - 4, yy], [x + w - 4, yy + 2], [cx + 3, yy + 7]], groove);
    }
}

const GAUGES = [
    { key: 'coolant', label: 'WATER', min: 40, max: 140, warn: 'coolantWarn', live: 'engine' },
    { key: 'oil', label: 'ENGINE OIL', min: 40, max: 160, warn: 'oilWarn', live: 'engine' },
    { key: 'gearbox', label: 'GEARBOX OIL', min: 40, max: 140, warn: 'gearboxWarn', live: 'gearbox' },
];
/* the settings tiles, two to a row; null leaves a place empty */
const TILES = [
    ['vtTempUnit', 'vtPressUnit'],
    ['vtCoolantWarn', 'vtOilWarn'],
    ['vtGearboxWarn', 'vtAccent'],
    ['vtPressures', 'vtDemo'],
];

/*
 * model: { settings, status (the service's), connected, gearboxInfo (what the car sends for it), data (car data: coolant, oil, gearbox, tyreT, tyreP,
 *          carTemp, carPress), rows (settings_model ROWS), focus (a row name), pressed (a row name) }
 * Returns { rec, targets: [{ key, x, y, w, h }] }.
 */
function draw(rec, m) {
    rec.reset();
    const s = m.settings, st = (m.status) || {}, d = m.data || {};
    const rows = {};
    (m.rows || []).forEach((r) => { rows[r.name] = r; });
    const targets = [];
    const acc = ACCENTS[(s && s.accent) || 'blue'] || ACCENTS.blue;
    const tu = tempUnit(s, d), pu = pressUnit(s, d);
    const focusRing = (key, x, y, w, h, r) => {
        if (m.pressed === key) rec.rrect(x, y, w, h, r, [acc[0], acc[1], acc[2], 90]);
        if (m.focus === key) rec.stroke(x, y, w, h, r, 4, acc);
    };
    rec.clear(C.bg);

    /* ---- header ---- */
    rec.text('title', 'Vitals', 90, 86, C.text);
    rec.text('small', 'WATER  ·  ENGINE OIL  ·  GEARBOX OIL  ·  TYRES', 300, 84, C.faint, 'left', 2);
    // reset, far right
    const rw = 300, rx = W - 90 - rw, ry = 34, rh = 64;
    rec.rrect(rx, ry, rw, rh, 32, m.focus === 'vtReset' ? C.tileFocus : C.tile);
    rec.text('body', 'Reset to defaults', rx + rw / 2, ry + 44, C.dim, 'center');
    focusRing('vtReset', rx, ry, rw, rh, 32);
    targets.push({ key: 'vtReset', x: rx, y: ry, w: rw, h: rh });
    // status chips, right to left
    const chips = [];
    if (!m.connected) chips.push(['Widget service not running', C.red]);
    else {
        chips.push([st.renderer === 'connected' ? 'Widget on' : 'Widget ' + (st.renderer || '...'), st.renderer === 'connected' ? C.green : C.orange]);
        if (s && s.demo) chips.push(['Demo values', C.orange]);
        else {
            chips.push(['Engine ' + (st.engine ? 'live' : 'no data'), st.engine ? C.green : C.faint]);
            chips.push(['Gearbox ' + (st.gearbox ? 'live' : 'no data'), st.gearbox ? C.green : C.faint]);
            chips.push(['Tyres ' + (st.tyres ? 'live' : 'no data'), st.tyres ? C.green : C.faint]);
        }
    }
    let cx = rx - 30;
    chips.slice().reverse().forEach((ch) => {
        const w = rec.width('small', ch[0]) + 76;
        cx -= w;
        rec.rrect(cx, ry + 6, w, rh - 12, 26, C.card);
        rec.rrect(cx + 24, ry + 26, 12, 12, 6, ch[1]);
        rec.text('small', ch[0], cx + 50, ry + 41, C.dim);
        cx -= 16;
    });

    /* ---- live card ---- */
    const L = { x: 90, y: 130, w: 1260, h: 610 };
    rec.rrect(L.x, L.y, L.w, L.h, 28, C.card);
    rec.text('head', 'LIVE', L.x + 44, L.y + 58, C.faint, 'left', 4);
    GAUGES.forEach((g, i) => {
        const y = L.y + 116 + i * 116;
        const v = st[g.live] || (s && s.demo) ? d[g.key] : null;
        if (g.key === 'gearbox' && !num(v) && m.gearboxInfo) rec.text('small', m.gearboxInfo, L.x + 330, y, C.faint);
        const warnAt = s ? s[g.warn] : null;
        const hot = num(v) && num(warnAt) && v >= warnAt;
        rec.text('head', g.label, L.x + 44, y, C.dim, 'left', 3);
        // the bar: forward-slanted segments, 10 degrees each; its value in line with it, as tall as it
        const by = y + 18, bh = 40, segs = (g.max - g.min) / 10;
        const unitW = rec.width('body', '°' + tu);
        const vx = L.x + L.w - 44 - unitW - 10;
        rec.text('mid', fmtT(v, tu), vx, by + bh, hot ? C.red : C.text, 'right');
        rec.text('body', '°' + tu, vx + 10, by + bh, C.dim);
        const bx0 = L.x + 44, bx1 = vx - 130;
        const sw = (bx1 - bx0) / segs, slant = 14, gap = 7;
        const fill = num(v) ? Math.max(0, Math.min(1, (v - g.min) / (g.max - g.min))) * segs : 0;
        for (let k = 0; k < segs; k++) {
            const x0 = bx0 + k * sw, x1 = x0 + sw - gap;
            const segMin = g.min + k * 10;
            const on = fill >= k + 0.5;
            const col = on ? (hot ? C.red : acc) : (num(warnAt) && segMin >= warnAt ? [70, 30, 28, 255] : C.track);
            rec.quad([[x0 + slant, by], [x1 + slant, by], [x1, by + bh], [x0, by + bh]], col);
        }
    });
    // tyres
    const ty = L.y + 488;
    rec.rect(L.x + 44, ty - 52, L.w - 88, 2, C.line);
    rec.text('head', 'TYRES', L.x + 44, ty - 14, C.faint, 'left', 4);
    ['FL', 'FR', 'RL', 'RR'].forEach((k, i) => {
        const x = L.x + 44 + i * ((L.w - 88) / 4);
        const t = st.tyres && d.tyreT ? d.tyreT[k] : null, p = st.tyres && d.tyreP ? d.tyreP[k] : null;
        tyreIcon(rec, x, ty + 4, 30, 88, t);
        rec.text('small', k, x + 40, ty + 30, C.faint, 'left', 2);
        const tw = rec.text('mid', fmtT(t, tu), x + 40, ty + 84, C.text);
        rec.text('body', '°' + tu, x + 48 + tw, ty + 84, C.dim);
        if (!s || s.pressures) rec.text('body', fmtP(p, pu) + ' ' + pu, x + 40 + 70, ty + 30, C.dim);
    });

    /* ---- settings card ---- */
    const R = { x: 1400, y: 130, w: 1390, h: 610 };
    rec.rrect(R.x, R.y, R.w, R.h, 28, C.card);
    rec.text('head', 'SETTINGS', R.x + 44, R.y + 58, C.faint, 'left', 4);
    const gx = R.x + 40, gw = (R.w - 80 - 24) / 2, th = 88, tg = 16, ty0 = R.y + 86;
    const tile = (key, x, y, w) => {
        const row = rows[key];
        rec.rrect(x, y, w, th, 18, m.focus === key ? C.tileFocus : C.tile);
        rec.text('body', row ? row.label : key, x + 30, y + 56, C.dim);
        rec.text('strong', s && row ? row.value(s) : '', x + w - 30, y + 58, C.text, 'right');
        focusRing(key, x, y, w, th, 18);
        targets.push({ key: key, x: x, y: y, w: w, h: th });
    };
    TILES.forEach((pair, r) => pair.forEach((key, c) => { if (key) tile(key, gx + c * (gw + 24), ty0 + r * (th + tg), gw); }));
    // widget position and size: a tile each, with two buttons
    const y5 = ty0 + 4 * (th + tg);
    const control = (x, label, value, minus, plus, glyph) => {
        rec.rrect(x, y5, gw, th, 18, C.tile);
        rec.text('body', label, x + 30, y5 + 56, C.dim);
        const bw = 104, bh = th - 16, by = y5 + 8;
        const b2 = x + gw - 8 - bw, b1 = b2 - 170 - bw;
        rec.text('strong', s ? value : '', b1 + bw + 85, y5 + 58, C.text, 'center');
        [[minus, b1, 0], [plus, b2, 1]].forEach((b) => {
            const key = b[0], bx = b[1];
            rec.rrect(bx, by, bw, bh, 14, m.focus === key ? C.tileFocus : C.card);
            focusRing(key, bx, by, bw, bh, 14);
            glyph(b[2], bx + bw / 2, by + bh / 2);
            targets.push({ key: key, x: bx, y: by, w: bw, h: bh });
        });
    };
    control(gx, 'Position', s ? (s.shiftY ? (s.shiftY > 0 ? '+' : '') + s.shiftY + ' px' : '0 px') : '', 'vtUp', 'vtDown', (down, x, y) => {
        const k = down ? 1 : -1;
        rec.quad([[x - 20, y - 10 * k], [x + 20, y - 10 * k], [x, y + 12 * k], [x, y + 12 * k]], C.text);
    });
    control(gx + gw + 24, 'Size', s ? (s.zoom || 100) + ' %' : '', 'vtZoomOut', 'vtZoomIn', (plus, x, y) => {
        rec.rect(x - 18, y - 3, 36, 6, C.text);
        if (plus) rec.rect(x - 3, y - 18, 6, 36, C.text);
    });
    return { rec: rec, targets: targets };
}

/* which target a point is on (logical px), or null */
function hit(targets, x, y) {
    for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return t;
    }
    return null;
}

/* the placement that fits the logical screen into the app area (screen px) */
function placement(area) {
    const scale = Math.min(area.w / W, area.h / H);
    return { x: area.x, y: area.y, w: area.w, h: area.h, scale: scale,
        ox: Math.round((area.w - W * scale) / 2), oy: Math.round((area.h - H * scale) / 2) };
}

module.exports = { W, H, OP, Recorder, draw, hit, placement, atlas, pack };
