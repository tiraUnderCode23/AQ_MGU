'use strict';
/*
 * Light Logger: the app's own screen, drawn by the head unit's renderer (gpu.js) over the HMI page.
 * Pure: draw(rec, model) records a frame (renderd draw ops) and returns what a tap or the controller can press.
 * The recorder and glyph atlases are Vitals' (packages/vitals/app/src/ui.js); the screen is this app's own.
 * Tested and previewed on a desktop (tools/test_lightlog.js, tools/preview_ui.js).
 *
 *   Light Logger   SEAT LOGOS · READ ONLY        [link] [LIN 1 · 9] [LIN 2 · 7] [engine] [km/h]  [Read now] [MARK THIS MOMENT]
 *   +--- SEAT LIGHTS -------------------[Seat | All]--+  +--- SEAT LIGHT LOG --------------------[Clear]--+
 *   | (o) Driver seat back             ON 100 %  [pin]|  | 14:02:41  MARK   MARK 1                          |
 *   |     LIN 1 #3 · 0x1B  SEAT                       |  | 14:02:39  SEAT   OFF: Driver seat back ...       |
 *   | (o) Light 0x5A                   OFF       [pin]|  | 14:02:12  CAR    engine running (720 rpm)        |
 *   |     LIN 2 #7 · 0x5A  UNKNOWN CODE  CHANGED AT MARK |  ...                                             |
 *   +-------------------------------------------------+  +-------------------------------------------------+
 *
 * The buttons have the keys of the HMI list's rows under the drawn screen (screen_model.js BUTTONS), so the
 * controller's focus there lights the button here. A light's pin is touch only (key 'pin:<bus>:<location>').
 */
const FONT = require('./ui_font.js');

const W = 2880, H = 764;
const OP = { CLEAR: 1, RECT: 2, RRECT: 4, RSTROKE: 5, GLYPHS: 11, QUAD: 15 };


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
    const key = 'ida_lightlog/' + style + '@' + f.px;
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


const C = {
    bg: [9, 11, 16, 255], card: [17, 20, 28, 255], line: [36, 41, 54, 255], tile: [25, 29, 40, 255],
    tileFocus: [33, 43, 64, 255], text: [242, 244, 248, 255], dim: [138, 147, 166, 255], faint: [86, 93, 110, 255],
    track: [44, 48, 58, 255], red: [229, 67, 46, 255], green: [60, 192, 122, 255], orange: [240, 160, 48, 255],
    accent: [30, 123, 224, 255], seat: [245, 196, 66, 255], mark: [87, 168, 245, 255], unknown: [178, 132, 240, 255],
};
const TAG = {
    pinned: ['PINNED', C.green], seat: ['SEAT', C.seat], mark: ['CHANGED AT MARK', C.mark], unknown: ['UNKNOWN CODE', C.unknown],
};
const KIND = { seat: ['SEAT', C.seat], light: ['LIGHT', C.dim], car: ['CAR', C.dim], mark: ['MARK', C.mark], link: ['APP', C.faint] };
const BUS = ['LIN 1', 'LIN 2', 'Lamps', 'Pinned'];
const UNIT = { 0x40: 'BDC', 0x10: 'BDC gateway', 0x6d: 'Seat module 0x6D', 0x6e: 'Seat module 0x6E', 0x6f: 'Seat module 0x6F' };
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const pad = (n) => (n < 10 ? '0' : '') + n;
function clock(t) { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

/* s cut to fit maxW (with an ellipsis) */
function fit(rec, style, s, maxW) {
    s = String(s);
    if (rec.width(style, s) <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rec.width(style, s.slice(0, mid) + '...') <= maxW) lo = mid; else hi = mid - 1; }
    return s.slice(0, lo) + '...';
}

/* a light's colour as it glows: its rgb (white channel mixed in) at its brightness, grey when off */
function glow(m) {
    if (!m.on) return C.track;
    if (m.lamp || m.did) return [236, 240, 248, 255];
    const k = 0.35 + 0.65 * Math.max(0, Math.min(100, m.bright)) / 100, w = (m.white || 0) / 255;
    const ch = (v) => Math.round(Math.min(255, v + (255 - v) * w) * k);
    return [ch(m.r), ch(m.g), ch(m.b), 255];
}
function swatch(rec, x, y, r, m) {
    const c = glow(m);
    if (m.on) [[r * 2.1, 40], [r * 1.6, 70]].forEach((g) => rec.rrect(x - g[0], y - g[0], g[0] * 2, g[0] * 2, g[0], [c[0], c[1], c[2], g[1]]));
    rec.rrect(x - r, y - r, r * 2, r * 2, r, c);
    if (!m.on) rec.stroke(x - r, y - r, r * 2, r * 2, r, 3, C.faint);
}
function pinIcon(rec, x, y, on) {
    const c = on ? C.green : C.faint;
    rec.rrect(x - 13, y - 22, 26, 26, 13, c);
    rec.quad([[x - 6, y + 2], [x + 6, y + 2], [x, y + 22], [x, y + 22]], c);
}

/*
 * model: { status: { linkReady, linkError, buses: [{ modules, on, refused, reads }], engine, kmh },
 *          view: 'seat' | 'all' (the left card), seat: journal.relevant(), all: journal.modules(),
 *          noSeat: [lines] (shown when seat is empty), log: [events, newest first], marks, focus, pressed }
 * Returns { rec, targets: [{ key, x, y, w, h }] }.
 */
function draw(rec, m) {
    rec.reset();
    const st = m.status || {}, targets = [];
    const ring = (key, x, y, w, h, r) => {
        if (m.pressed === key) rec.rrect(x, y, w, h, r, [C.accent[0], C.accent[1], C.accent[2], 90]);
        if (m.focus === key) rec.stroke(x, y, w, h, r, 4, C.accent);
    };
    const button = (key, label, x, y, w, h, fill, textC, style) => {
        rec.rrect(x, y, w, h, h / 2, m.focus === key ? C.tileFocus : fill);
        rec.text(style || 'body', label, x + w / 2, y + h / 2 + 12, textC || C.text, 'center');
        ring(key, x, y, w, h, h / 2);
        targets.push({ key: key, x: x, y: y, w: w, h: h });
    };
    rec.clear(C.bg);

    /* ---- header ---- */
    rec.text('title', 'Light Logger', 90, 86, C.text);
    const markW = 420, readW = 250, by = 30, bh = 72;
    const markX = W - 90 - markW;
    button('llMark', m.marks ? 'MARK THIS MOMENT  (' + m.marks + ')' : 'MARK THIS MOMENT', markX, by, markW, bh, C.accent, C.text, 'strong');
    const readX = markX - 24 - readW;
    button('llRead', 'Read now', readX, by + 4, readW, bh - 8, C.tile, C.dim);
    const chips = [];
    chips.push(st.linkReady ? ['Diagnostic link', C.green] : ['Link: ' + (st.linkError || 'starting'), st.linkError ? C.red : C.orange]);
    (st.buses || []).forEach((b, i) => {
        if (i === 3) return;
        if (b.refused) chips.push([BUS[i] + ' refused', C.red]);
        else if (b.modules === null || b.modules === undefined) chips.push([BUS[i] + (b.reads ? ' no answer' : ' ...'), b.reads ? C.orange : C.faint]);
        else chips.push([BUS[i] + ' · ' + b.modules, C.green]);
    });
    if (st.keep && st.keep.holding) chips.push(['Holding output ' + st.keep.output + ' on', C.green]);
    chips.push([st.engine === true ? 'Engine running' : st.engine === false ? 'Engine off' : 'Engine ?', st.engine ? C.green : C.faint]);
    if (st.kmh !== null && st.kmh !== undefined) chips.push([Math.round(st.kmh) + ' km/h', C.faint]);
    let cx = readX - 30;
    // as many chips as fit right of the title, the speed first to go
    const chipW = (c) => rec.width('small', c[0]) + 76 + 14;
    while (chips.length > 1 && readX - 30 - chips.reduce((a, c) => a + chipW(c), 0) < 440) chips.splice(chips.length - 1, 1);
    if (readX - 30 - chips.reduce((a, c) => a + chipW(c), 0) > 440 + rec.width('small', 'SEAT LOGOS') + 40) rec.text('small', 'SEAT LOGOS', 450, 84, C.faint, 'left', 2);
    chips.slice().reverse().forEach((ch) => {
        const w = rec.width('small', ch[0]) + 76;
        cx -= w;
        rec.rrect(cx, by + 10, w, bh - 20, 26, C.card);
        rec.rrect(cx + 24, by + 30, 12, 12, 6, ch[1]);
        rec.text('small', ch[0], cx + 50, by + 45, C.dim);
        cx -= 14;
    });

    /* ---- left: the seat lights (or all of them) ---- */
    const L = { x: 90, y: 130, w: 1510, h: 610 };
    rec.rrect(L.x, L.y, L.w, L.h, 28, C.card);
    const all = m.view === 'all', find = m.view === 'find';
    rec.text('head', find ? 'FIND THE LOGOS' : all ? 'ALL LIGHTS' : 'SEAT LIGHTS', L.x + 44, L.y + 58, C.faint, 'left', 4);
    if (!all && !find) rec.text('small', 'in a seat, an unknown code, changed at a mark, or pinned', L.x + 290, L.y + 56, C.faint);
    if (find) rec.text('small', 'body controller + seat modules, logos ON vs OFF', L.x + 330, L.y + 56, C.faint);
    // the Seat | All | Find switch (the controller's llView steps through it)
    const views = [['seat', 'Seat'], ['all', 'All'], ['find', 'Find']];
    const sw = 390, sx = L.x + L.w - 40 - sw, sy = L.y + 22, sh = 56, seg = sw / views.length;
    rec.rrect(sx, sy, sw, sh, sh / 2, m.focus === 'llView' ? C.tileFocus : C.tile);
    views.forEach((v, i) => {
        const on = m.view === v[0];
        if (on) rec.rrect(sx + i * seg, sy, seg, sh, sh / 2, C.line);
        rec.text('small', v[1], sx + i * seg + seg / 2, sy + 37, on ? C.text : C.dim, 'center');
        targets.push({ key: 'view:' + v[0], x: sx + i * seg, y: sy, w: seg, h: sh });
    });
    ring('llView', sx, sy, sw, sh, sh / 2);

    const pinTarget = (mod, x, y, w, h) => targets.push({ key: 'pin:' + mod.key, x: x, y: y, w: w, h: h });
    if (find) drawFind(rec, m, L, targets, button, pinTarget);
    else if (!all) {
        const list = m.seat || [];
        if (!list.length) {
            (m.noSeat || []).forEach((t, i) => rec.text(i ? 'body' : 'strong', fit(rec, i ? 'body' : 'strong', t, L.w - 88), L.x + 44, L.y + 160 + i * 60 + (i ? 16 : 0), i ? C.dim : C.text));
        }
        const rowH = 100, max = 3;
        drawKeep(rec, m, L, targets);
        list.slice(0, max).forEach((mod, i) => {
            const y = L.y + 96 + i * (rowH + 4);
            rec.rrect(L.x + 24, y, L.w - 48, rowH, 18, C.tile);
            swatch(rec, L.x + 84, y + rowH / 2, 22, mod);
            rec.text('strong', fit(rec, 'strong', mod.name, 700), L.x + 140, y + 44, C.text);
            const where = mod.lamp ? 'BDC lamp output, element ' + (mod.nad - 1) + ' (0x' + hex2(mod.nad - 1) + ')' : mod.did ? 'a value the finder found' : BUS[mod.bus] + ' #' + mod.nad + '  ·  0x' + hex2(mod.loc);
            const ww = rec.text('small', where, L.x + 140, y + 82, C.faint);
            let tx = L.x + 140 + ww + 22;
            (mod.reasons || []).forEach((r) => {
                const t = TAG[r];
                if (!t) return;
                const w = rec.width('small', t[0]) + 28;
                rec.rrect(tx, y + 58, w, 34, 17, [t[1][0], t[1][1], t[1][2], 46]);
                rec.text('small', t[0], tx + 14, y + 83, t[1]);
                tx += w + 10;
            });
            const state = (mod.on ? 'ON' : 'OFF') + (mod.lamp || mod.did ? '  (' + mod.raw + ')' : mod.on ? '  ' + mod.bright + ' %' : '');
            rec.text('strong', state, L.x + L.w - 210, y + 62, mod.on ? C.text : C.dim, 'right');
            if (mod.fault) rec.text('small', 'FAULT', L.x + L.w - 210, y + 90, C.red, 'right');
            const pinned = (mod.reasons || []).indexOf('pinned') >= 0;
            const px = L.x + L.w - 176, pw = 138, ph = 56, py = y + (rowH - ph) / 2;
            rec.rrect(px, py, pw, ph, ph / 2, pinned ? [C.green[0], C.green[1], C.green[2], 60] : C.card);
            pinIcon(rec, px + 32, py + ph / 2 - 1, pinned);
            rec.text('small', pinned ? 'Pinned' : 'Pin', px + 54, py + 37, pinned ? C.green : C.dim);
            pinTarget(mod, px - 10, y, pw + 20, rowH);
        });
        if (list.length > max) rec.text('small', '+ ' + (list.length - max) + ' more (Seat light log, or lightlog.txt)', L.x + 44, L.y + L.h - 18, C.faint);
    } else {
        const list = m.all || [];
        if (!list.length) rec.text('strong', 'No answer from the body controller yet.', L.x + 44, L.y + 170, C.dim);
        const cols = 3, rows = 9, per = cols * rows, cw = (L.w - 48) / cols, rh = 52;
        const pages = Math.max(1, Math.ceil(list.length / per)), page = Math.min(m.page || 0, pages - 1);
        list.slice(page * per, page * per + per).forEach((mod, i) => {
            const c = Math.floor(i / rows), r = i % rows;
            const x = L.x + 24 + c * cw, y = L.y + 96 + r * rh;
            const name = mod.lamp ? 'Lamp output ' + mod.nad : mod.did ? mod.name : mod.name;
            if (mod.lamp || mod.did) {
                rec.rrect(x + 20, y + rh / 2 - 9, 20, 18, 4, mod.on ? C.text : C.track);
            } else swatch(rec, x + 30, y + rh / 2, 13, mod);
            rec.text('small', fit(rec, 'small', name, cw - 230), x + 58, y + 35, mod.seat || (!mod.known && !mod.lamp) ? C.seat : C.dim);
            rec.text('small', mod.lamp || mod.did ? mod.raw : mod.on ? mod.bright + ' %' : 'off', x + cw - 100, y + 35, mod.on ? C.text : C.faint, 'right');
            pinIcon(rec, x + cw - 62, y + rh / 2 - 1, (m.pins || []).indexOf(mod.key) >= 0);
            pinTarget(mod, x + cw - 92, y, 60, rh);
            if (c > 0) rec.rect(x - 4, y + 8, 1, rh - 16, C.line);
        });
        if (pages > 1) {
            const py = L.y + L.h - 62;
            rec.text('small', 'Page ' + (page + 1) + ' of ' + pages + '  ·  ' + list.length + ' lights', L.x + 44, py + 38, C.faint);
            [['page:prev', '<', L.x + L.w - 260], ['page:next', '>', L.x + L.w - 140]].forEach((b) => {
                rec.rrect(b[2], py, 100, 52, 26, C.tile);
                rec.text('strong', b[1], b[2] + 50, py + 39, C.text, 'center');
                targets.push({ key: b[0], x: b[2], y: py, w: 100, h: 52 });
            });
        }
    }

    /* ---- right: the seat light log ---- */
    const R = { x: 1640, y: 130, w: 1150, h: 610 };
    rec.rrect(R.x, R.y, R.w, R.h, 28, C.card);
    rec.text('head', 'SEAT LIGHT LOG', R.x + 44, R.y + 58, C.faint, 'left', 4);
    button('llClear', 'Clear', R.x + R.w - 40 - 160, R.y + 22, 160, 56, C.tile, C.dim, 'small');
    const log = m.log || [];
    if (!log.length) rec.text('body', 'Nothing logged yet.', R.x + 44, R.y + 150, C.dim);
    log.slice(0, 11).forEach((e, i) => {
        const y = R.y + 128 + i * 44;
        const k = KIND[e.kind] || [e.kind, C.dim];
        rec.text('small', clock(e.t), R.x + 44, y, C.faint);
        rec.text('small', k[0], R.x + 170, y, k[1], 'left', 1);
        rec.text('small', fit(rec, 'small', e.text, R.w - 300), R.x + 256, y, e.kind === 'mark' || e.seat ? C.text : C.dim);
        if (i < 10) rec.rect(R.x + 44, y + 14, R.w - 88, 1, C.line);
    });
    return { rec: rec, targets: targets };
}

/* keep on: the pinned lamp output held on through the body controller, at the bottom of the seat card */
function drawKeep(rec, m, L, targets) {
    const k = (m.status && m.status.keep) || {};
    const x = L.x + 24, w = L.w - 48, h = 112, y = L.y + L.h - 24 - h;
    rec.rrect(x, y, w, h, 20, k.holding ? [C.green[0], C.green[1], C.green[2], 34] : C.tile);
    rec.text('head', 'KEEP ON', x + 28, y + 42, C.faint, 'left', 4);
    if (!k.output) {
        rec.text('body', 'Pin the logos\' lamp output (All, its pin) to keep it on.', x + 28, y + 86, C.dim);
        return;
    }
    rec.text('strong', 'Lamp output ' + k.output, x + 200, y + 44, C.text);
    rec.text('small', fit(rec, 'small', k.note || '', w - 640), x + 28, y + 88, k.holding ? C.green : k.fails ? C.orange : C.dim);
    const btn = (key, label, bx, bw, fill, tc) => {
        const by = y + (h - 64) / 2;
        rec.rrect(bx, by, bw, 64, 32, m.focus === key ? C.tileFocus : fill);
        rec.text('body', label, bx + bw / 2, by + 44, tc, 'center');
        if (m.pressed === key) rec.rrect(bx, by, bw, 64, 32, [C.accent[0], C.accent[1], C.accent[2], 90]);
        if (m.focus === key) rec.stroke(bx, by, bw, 64, 32, 4, C.accent);
        targets.push({ key: key, x: bx, y: by, w: bw, h: 64 });
    };
    const kw = 300, tw = 250;
    btn('llKeep', k.enabled ? 'Keep on: ON' : 'Keep on: OFF', x + w - 24 - kw, kw, k.enabled ? C.green : C.card, k.enabled ? C.bg : C.text);
    btn('llKeepTest', k.mode === 'test' ? 'Testing...' : 'Test 10 s', x + w - 24 - kw - 20 - tw, tw, C.card, C.text);
}

/* the finder: three steps, then the values that follow the logos */
function drawFind(rec, m, L, targets, button, pinTarget) {
    const f = m.find;
    if (!f) { rec.text('body', 'The finder is not running.', L.x + 44, L.y + 160, C.dim); return; }
    const gw = (L.w - 48 - 32) / 3, gy = L.y + 96, gh = 150;
    const unitsLine = !f.unitsKnown ? 'Not done yet' : f.units.length ? f.units.map((u) => u.name.replace('Seat module ', 'Seat ') + ' ' + u.values).join(' · ') : 'No unit answered';
    const steps = [
        ['llLearn', '1  Learn', 'Once, car on, a few min a unit', unitsLine],
        ['llSnapOn', '2  Logos ON', 'Snapshot while they glow', 'Taken ' + f.counts.on + 'x'],
        ['llSnapOff', '3  Logos OFF', 'Snapshot once they are dark', 'Taken ' + f.counts.off + 'x'],
    ];
    steps.forEach((st, i) => {
        const x = L.x + 24 + i * (gw + 16);
        const ready = i === 0 || f.learnedAll;
        rec.rrect(x, gy, gw, gh, 20, m.focus === st[0] ? C.tileFocus : C.tile);
        rec.text('strong', st[1], x + 28, gy + 50, ready ? C.text : C.faint);
        rec.text('small', st[2], x + 28, gy + 90, C.dim);
        rec.text('small', fit(rec, 'small', st[3], gw - 56), x + 28, gy + 128, i === 0 && f.learnedAll ? C.green : C.faint);
        if (m.pressed === st[0]) rec.rrect(x, gy, gw, gh, 20, [C.accent[0], C.accent[1], C.accent[2], 90]);
        if (m.focus === st[0]) rec.stroke(x, gy, gw, gh, 20, 4, C.accent);
        targets.push({ key: st[0], x: x, y: gy, w: gw, h: gh });
    });
    // busy: a bar
    const p = f.progress, by = gy + gh + 22;
    if (f.phase !== 'idle' && p) {
        const k = Math.max(0, Math.min(1, p.done / Math.max(1, p.total)));
        rec.rrect(L.x + 24, by, L.w - 48, 14, 7, C.track);
        rec.rrect(L.x + 24, by, Math.max(14, (L.w - 48) * k), 14, 7, C.accent);
        rec.text('small', (f.phase === 'learning' ? 'Learning ' + (p.name || '') : 'Reading, logos ' + String(p.snapshot).toUpperCase()) + '  ' + Math.round(k * 100) + ' %', L.x + 24, by + 48, C.dim);
        return;
    }
    if (f.error) rec.text('small', 'Error: ' + f.error, L.x + 24, by + 30, C.red);
    const list = f.candidates || [];
    if (!f.counts.on || !f.counts.off) {
        rec.text('body', 'Take a snapshot with the logos ON, then one with them OFF.', L.x + 44, by + 60, C.dim);
        rec.text('small', 'Two of each is better: whatever moves anyway (voltages, counters) drops out.', L.x + 44, by + 104, C.faint);
        return;
    }
    rec.text('small', list.length + ' values follow the logos' + (list.length ? '. Pin the likeliest to watch it live.' : '. Try another pair of snapshots.'), L.x + 44, by + 30, list.length ? C.text : C.dim);
    list.slice(0, 4).forEach((c, i) => {
        const y = by + 52 + i * 62;
        rec.rrect(L.x + 24, y, L.w - 48, 56, 14, C.tile);
        rec.text('body', (UNIT[c.unit] || 'ECU') + '  0x' + hex4(c.did), L.x + 52, y + 40, c.unit !== 0x40 ? C.seat : C.text);
        rec.text('small', 'ON ' + fit(rec, 'small', c.on, 260), L.x + 520, y + 37, C.green);
        rec.text('small', 'OFF ' + fit(rec, 'small', c.off, 260), L.x + 860, y + 37, C.dim);
        const pinned = (m.pins || []).indexOf(c.key) >= 0;
        const px = L.x + L.w - 176, pw = 138, ph = 44, py = y + 6;
        rec.rrect(px, py, pw, ph, ph / 2, pinned ? [C.green[0], C.green[1], C.green[2], 60] : C.card);
        pinIcon(rec, px + 30, py + ph / 2 - 1, pinned);
        rec.text('small', pinned ? 'Pinned' : 'Pin', px + 52, py + 31, pinned ? C.green : C.dim);
        pinTarget({ key: c.key }, px - 10, y, pw + 20, 56);
    });
    if (list.length > 4) rec.text('small', '+ ' + (list.length - 4) + ' more in lightlog.txt', L.x + 44, L.y + L.h - 18, C.faint);
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

module.exports = { W, H, OP, Recorder, draw, hit, placement, atlas, pack, fit, glow };
