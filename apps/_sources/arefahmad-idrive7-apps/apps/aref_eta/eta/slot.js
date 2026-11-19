'use strict';
/**
 * slot.js - the second slot: a live readout in the space BMW's own cluster widgets (music, trip computer) use,
 * on the right, drawn only while the bottom strip holds the cluster's panel (those widgets are gone then anyway).
 *
 * The look matches the cluster's own "0 mph" on the left: big white Inter Bold numbers, a small gray unit, no box,
 * so it reads as part of the cluster. Contents (Settings > Second slot):
 *   engine   oil temperature and the gear (D3, S4, M2, P)
 *   temps    oil and coolant temperature
 *   g        lateral and braking / accelerating g, live
 *   clock    the time, large
 *   music    what's playing: the album cover (when the car is online) with the title and artist
 *
 * One image layer on the panel, redrawn only when what it shows changes (at most twice a second); a few hundred
 * KB at most then, nothing in between.
 * Node 8. Never throws out: every call is caught.
 */
const { Canvas } = require('./kit/canvas');

const SW = 420, SH = 360;                               // the picture
// its centre on the cluster: where BMW's own widget sits (its icon and "No active entertainment source", measured
// from Aref's Nov 16 photo: centre x ~1420, y ~292, about 365 x 250 cluster px)
const DEF = { x: 1465, y: 340, scale: 1 };           // (Nov 16: moved toward the gauge's middle, Aref's photo)
const SLOTS = ['off', 'engine', 'temps', 'g', 'clock', 'music'];
const MIN_MS = 500;
const WHITE = [255, 255, 255, 255], GRAY = [152, 152, 159, 255], DIM = [99, 99, 102, 255];

const cToF = (c) => (typeof c === 'number' ? Math.round(c * 9 / 5 + 32) : null);

/** The gear as the cluster writes it: P, R, N, D3, S4, M2 (program from MDrive, else D). */
function gearText(d) {
    if (!d) return '--';
    const st = d.stage || d.selector;
    if (st === 'P' || st === 'R' || st === 'N') return st;
    if (d.gear === -1) return 'R';
    if (d.gear === 0) return st === 'D' ? 'D' : 'N';
    const prog = d.program === 'S' || d.program === 'M' ? d.program : 'D';
    return typeof d.gear === 'number' && d.gear > 0 ? prog + d.gear : prog;
}

/**
 * What a slot shows: [{ v, u }] for one or two big values, or { music: { title, artist, cover } }, or null.
 * d: the kit's car.data(); now: ms; track: nowplaying's track(); cover: { px, n } RGBA square or null.
 */
function content(kind, d, now, track, cover) {
    if (kind === 'engine') { const o = cToF(d && d.oil); return [{ v: o === null ? '--' : String(o), u: '°F oil' }, { v: gearText(d), u: 'gear' }]; }
    if (kind === 'temps') { const o = cToF(d && d.oil), c = cToF(d && d.coolant); return [{ v: o === null ? '--' : String(o), u: '°F oil' }, { v: c === null ? '--' : String(c), u: '°F coolant' }]; }
    if (kind === 'g') {
        const g = (x) => (typeof x === 'number' ? Math.abs(x / 9.81).toFixed(2) : '--');
        const lon = d && typeof d.gLong === 'number' ? (d.gLong < -0.3 ? 'braking' : d.gLong > 0.3 ? 'accel' : 'long') : 'long';
        return [{ v: g(d && d.gLat), u: 'g lateral' }, { v: g(d && d.gLong), u: 'g ' + lon }];
    }
    if (kind === 'clock') {
        const t = new Date(now), h = t.getHours(), m = t.getMinutes();
        return [{ v: ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m, u: h < 12 ? 'AM' : 'PM' }];
    }
    if (kind === 'music') {
        if (!track || !track.title) return null;
        // the progress bar moves in 5 s steps: the slot is a picture, redrawn only when it changes
        const pos = typeof track.position === 'number' ? Math.floor(track.position / 5000) * 5000 : null;
        const dur = typeof track.duration === 'number' && track.duration > 0 ? track.duration : null;
        return { music: { title: track.title, artist: track.artist || '', cover: cover, pos: pos, dur: dur } };
    }
    return null;
}

function draw(c, fonts) {
    const cv = new Canvas(SW, SH);
    cv.clear([0, 0, 0, 0]);
    const B = { font: fonts.bold, literal: true }, M = { font: fonts.med, literal: true };
    const fit = (s, size, w, o) => { s = String(s || ''); if (cv.textWidth(s, size, o) <= w) return s; while (s.length > 1 && cv.textWidth(s + '…', size, o) > w) s = s.slice(0, -1); return s + '…'; };
    if (Array.isArray(c)) {
        // one or two columns, numbers on a shared baseline like the speedometer's "0 mph"
        const cols = c.length, cw = SW / cols, base = 150;
        c.forEach((q, i) => {
            const x = i * cw + cw / 2, size = cols === 1 ? 92 : 76;
            const vw = cv.textWidth(q.v, size, B);
            cv.text(q.v, x - vw / 2, base + 2, size, [0, 0, 0, 120], B);
            cv.text(q.v, x - vw / 2, base, size, WHITE, B);
            cv.text(fit(q.u, 24, cw - 20, M), x, base + 40, 24, GRAY, Object.assign({ align: 'center' }, M));
        });
        if (cols === 2) cv.fillRect(SW / 2, 78, 1, 110, DIM);
    } else if (c && c.music) {
        // as BMW's own widget: the picture on top, centred, the title and the artist under it
        const m = c.music, n = m.size || 140, x0 = (SW - n) / 2, y0 = 76 - Math.round((n - 140) / 2);   // grows from its middle
        if (m.cover && m.cover.px) {
            // the cover, scaled into n x n with rounded corners (nearest from the square it came as)
            const src = m.cover.px, sn = m.cover.n, r = 14;
            for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
                const dx = Math.min(x, n - 1 - x), dy = Math.min(y, n - 1 - y);
                if (dx < r && dy < r && Math.hypot(r - dx - 0.5, r - dy - 0.5) > r) continue;
                const si = ((Math.floor(y * sn / n) * sn) + Math.floor(x * sn / n)) * 4;
                cv._blend(x0 + x, y0 + y, [src[si], src[si + 1], src[si + 2], 255], 1);
            }
        } else {
            cv.roundRect(x0, y0, n, n, 14, [28, 28, 30, 255]);
            cv.text('♪', x0 + n / 2, y0 + n / 2 + 26, 72, DIM, Object.assign({ align: 'center' }, M));
        }
        const C = { align: 'center' };
        cv.text(fit(m.title, 30, SW - 20, B), SW / 2, y0 + n + 42, 30, WHITE, Object.assign({}, B, C));
        cv.text(fit(m.artist, 24, SW - 20, M), SW / 2, y0 + n + 76, 24, GRAY, Object.assign({}, M, { align: 'center' }));
    }
    return Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length);
}

/**
 * The progress bar and time left, a small picture of its own (BAR_W x BAR_H): it changes every second, the cover and
 * names only once a song, so the big picture isn't sent to the cluster each second (Nov 19: ~10 MB a minute).
 */
const BAR_W = 380, BAR_H = 56, BAR_Y = 36;           // the bar's line inside its picture (room above for the time)
function barTop(n) { return 76 - Math.round((n - 140) / 2) + n + 92 + 9 - BAR_Y; }
/**
 * st: { w: length, h: thickness (3 thin .. 9 BMW's), time: 'right' | 'above' (BMW: over the bar's right end),
 * back: a soft black plate behind the bar and the time, so they read over the cover's backdrop }.
 */
function drawBar(m, fonts, st) {
    st = Object.assign({ w: 180, h: 3, time: 'right', back: false }, typeof st === 'number' ? { w: st } : st);
    const cv = new Canvas(BAR_W, BAR_H);
    cv.clear([0, 0, 0, 0]);
    const M = { font: fonts.med, literal: true };
    const left = Math.max(0, Math.round((m.dur - m.pos) / 1000));
    const tt = Math.floor(left / 60) + ':' + (left % 60 < 10 ? '0' : '') + (left % 60), tw = cv.textWidth(tt, 20, M);
    // the time to the right stays inside the picture: the bar gives way (still centred)
    const f = Math.max(0, Math.min(1, m.pos / m.dur)), bw = Math.min(st.w, BAR_W - (st.time === 'right' ? 2 * (tw + 40) : 60));
    const bx = Math.round((BAR_W - bw) / 2), th = st.h, by = BAR_Y - Math.floor(th / 2), r = th / 2;
    if (st.back) {
        // a soft black glow behind them (BMW's), no hard edge: many rounded rects, each smaller and a little darker
        const x0 = bx - 4, x1 = (st.time === 'right' ? bx + bw + 12 + tw : bx + bw) + 4, y0 = st.time === 'above' ? BAR_Y - 24 : BAR_Y - 8, y1 = BAR_Y + 8;
        for (let k = 10; k >= 0; k--) cv.roundRect(x0 - k * 2, y0 - k * 1.6, x1 - x0 + k * 4, y1 - y0 + k * 3.2, 10 + k * 2, [0, 0, 0, 16]);
    }
    cv.roundRect(bx, by, bw, th, r, [255, 255, 255, th > 4 ? 95 : 60]);
    if (f > 0) cv.roundRect(bx, by, Math.max(th, bw * f), th, r, [255, 106, 0, 255]);
    if (st.time === 'above') cv.text(tt, bx + bw, BAR_Y - 12, 20, WHITE, Object.assign({ align: 'right' }, M));
    else cv.text(tt, bx + bw + 10, BAR_Y + 6, 18, GRAY, M);
    return Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length);
}

const BW = 300, BH = 300;                              // the backdrop's picture
// its rect, from the slot's centre: the inside of the right gauge (cluster x 1280-1800, y 90-610 at the default place)
// the backdrop's box on the cluster, from its centre: BMW's music art region in the Flume photo (panel px TL 1269,95
// TR 1705,95 R 1794,357 BR 1646,613 BL 1451,613 ML 1522,357; the slot's centre 1465,340)
const BG = { dx: 66, dy: 14, w: 525, h: 520 };
// Settings > Music backdrop: shapes in the box (0..1 each way), drawn with soft edges
const poly = (pts) => ({ poly: pts });
const arc = (cx, cy, rx, ry, a0, a1, n) => {
    const out = [];
    for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
    return out;
};
const heart = () => {
    const pts = [];
    for (let i = 0; i < 64; i++) {
        const t = i / 64 * 2 * Math.PI, x = 16 * Math.pow(Math.sin(t), 3);
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push([0.5 + x / 36, 0.47 - y / 36]);
    }
    return pts;
};
const SHAPES = {
    // BMW's: flat top, the right side follows the gauge, the left side an inverted half diamond (in to ML, back out)
    bmw: poly([[0, 0], [0.64, 0], [0.87, 0.32], [0.9, 0.5],   // top right cut: clear of the tach's 40 (Nov 19)
        [0.74, 0.98], [0.23, 0.98], [0.42, 0.5]]),   // down to the gauge's rim, the lower left filled (Nov 19 photo)
    full: { circle: 0.5 },                                       // the whole gauge face
    circle: { circle: 0.4 },
    half: poly(arc(0.42, 0.5, 0.5, 0.48, -Math.PI / 2, Math.PI / 2, 40)),   // a D: flat left, round right like the gauge
    diamond: poly([[0.5, 0.04], [0.96, 0.5], [0.5, 0.96], [0.04, 0.5]]),
    heart: poly(heart()),
    square: poly([[0.12, 0.12], [0.88, 0.12], [0.88, 0.88], [0.12, 0.88]]),
};
// every other shape is drawn in the same safe area: clear of the tach's needle and the gauge's rim
const SAFE = { x: 0.04, y: 0, s: 0.9 };
const SHAPE_NAMES = ['bmw', 'full', 'circle', 'half', 'diamond', 'heart', 'square', 'off'];

/** Signed distance from (u, v) to shape s, in box units: > 0 inside. Works for any simple polygon (bmw isn't convex). */
function dist(s, u, v) {
    if (s !== SHAPES.bmw) return SAFE.s * dist0(s, (u - SAFE.x) / SAFE.s, (v - SAFE.y) / SAFE.s);
    return dist0(s, u, v);
}
function dist0(s, u, v) {
    if (s.circle) return s.circle - Math.hypot(u - 0.5, v - 0.5);
    const P = s.poly;
    let d = 1e9, inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const ax = P[j][0], ay = P[j][1], bx = P[i][0], by = P[i][1];
        if ((by > v) !== (ay > v) && u < (ax - bx) * (v - by) / (ay - by) + bx) inside = !inside;
        const ex = bx - ax, ey = by - ay, t = Math.max(0, Math.min(1, ((u - ax) * ex + (v - ay) * ey) / (ex * ex + ey * ey)));
        const dx = u - ax - ex * t, dy = v - ay - ey * t;
        d = Math.min(d, dx * dx + dy * dy);
    }
    d = Math.sqrt(d);
    return inside ? d : -d;
}

/**
 * The backdrop: the cover dimmed, in the chosen shape with a soft edge (shape 'bmw' when unknown).
 * look: { top, bottom, left, right: each side's fade width in box units, opacity 0..1 }: a side over a gauge can
 * fade out instead of moving the whole backdrop.
 */
const DEF_LOOK = { top: 0.05, bottom: 0.25, left: 0.05, right: 0.05, opacity: 1 };
/**
 * The shape's alpha (0..255 per backdrop pixel), made once per shape and look, not per song. Each side has its
 * own edge: look.top / bottom / left / right are fade widths in box units (0.015 sharp .. 0.45 a long gradient).
 * An edge's width comes from the way it faces (a slanted edge mixes its two sides), and a pixel's alpha is the
 * lowest over all edges of its distance to that edge over the edge's width, so the fades meet without seams.
 */
let maskKey = null, maskA = null;
function edgesOf(s) {
    if (s.edges) return s.edges;
    const P = s.poly, E = [];
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const ax = P[j][0], ay = P[j][1], ex = P[i][0] - ax, ey = P[i][1] - ay, len = Math.hypot(ex, ey) || 1;
        let nx = ey / len, ny = -ex / len;                      // outward: the side the midpoint + n is outside
        const mx = ax + ex / 2 + nx * 0.01, my = ay + ey / 2 + ny * 0.01;
        if (dist0(s, mx, my) > 0) { nx = -nx; ny = -ny; }
        E.push({ ax: ax, ay: ay, ex: ex, ey: ey, nx: nx, ny: ny });
    }
    return (s.edges = E);
}
// squared weights: smooth where an edge turns from one side to the next (no crease in a round fade)
const widthFor = (nx, ny, L) => {
    const r = Math.max(nx, 0), l = Math.max(-nx, 0), b = Math.max(ny, 0), t = Math.max(-ny, 0);
    return (r * r * L.right + l * l * L.left + b * b * L.bottom + t * t * L.top) / Math.max(1e-6, r * r + l * l + b * b + t * t);
};
function backdropMask(shape, L) {
    const key = shape + JSON.stringify(L);
    if (key === maskKey) return maskA;
    const A = new Uint8Array(BW * BH);
    const s0 = SHAPES[shape] || SHAPES.bmw, safe = s0 !== SHAPES.bmw;
    const E = s0.circle ? null : edgesOf(s0);
    for (let y = 0; y < BH; y++) {
        for (let x = 0; x < BW; x++) {
            let u = (x + 0.5) / BW, v = (y + 0.5) / BH, k = 1;
            if (safe) { u = (u - SAFE.x) / SAFE.s; v = (v - SAFE.y) / SAFE.s; k = SAFE.s; }
            const d = dist0(s0, u, v);
            if (d <= 0) continue;
            let a = 1;
            if (s0.circle) {
                const r = Math.hypot(u - 0.5, v - 0.5) || 1e-6;
                a = d * k / widthFor((u - 0.5) / r, (v - 0.5) / r, L);
            } else {
                for (let i = 0; i < E.length; i++) {
                    const e = E[i], t = Math.max(0, Math.min(1, ((u - e.ax) * e.ex + (v - e.ay) * e.ey) / (e.ex * e.ex + e.ey * e.ey)));
                    const de = Math.hypot(u - e.ax - e.ex * t, v - e.ay - e.ey * t) * k;
                    const q = de / widthFor(e.nx, e.ny, L);
                    if (q < a) a = q;
                }
            }
            a = Math.min(1, a); a = a * a * (3 - 2 * a);
            A[y * BW + x] = Math.round(a * 240 * L.opacity);
        }
    }
    maskKey = key; maskA = A;
    return A;
}

function drawBackdrop(px, n, shape, look) {
    const A = backdropMask(shape, Object.assign({}, DEF_LOOK, look));
    const out = Buffer.alloc(BW * BH * 4);
    for (let y = 0; y < BH; y++) {
        const sy = Math.floor(y * n / BH) * n;
        for (let x = 0; x < BW; x++) {
            const a = A[y * BW + x];
            if (!a) continue;
            const si = (sy + Math.floor(x * n / BW)) * 4, di = (y * BW + x) * 4;
            out[di] = px[si] * 0.6; out[di + 1] = px[si + 1] * 0.6; out[di + 2] = px[si + 2] * 0.6; out[di + 3] = a;
        }
    }
    return out;
}

class Slot {
    /** cr: the cluster renderer client (or null); fonts: { bold, med } atlas names; note(line): the app's log. */
    constructor(cr, fonts, note, place, fit) {
        this.cr = cr; this.fonts = fonts; this.note = note;
        this.place = Object.assign({}, DEF, place);
        this.fit = Object.assign({ x: 0, y: 0, scale: 1 }, fit);    // the backdrop's own nudge (Moving: backdrop)
        this.ref = null; this.key = null; this.shown = false; this.at = 0; this.pixels = null;
        this.bg = null; this.bgCover = null; this.bgShown = false; this.bar = null; this.barKey = null; this.barShown = false;
        this.music = { size: 140, bar: 180, thick: 3, time: 'right', back: false }; this.shape = 'bmw'; this.look = Object.assign({}, DEF_LOOK);
    }

    /** Settings > backdrop softness, opacity and fade: redrawn at the next update. */
    setLook(look) {
        const l = Object.assign({}, DEF_LOOK, look);
        if (JSON.stringify(l) !== JSON.stringify(this.look)) { this.look = l; this.bgCover = null; }
    }

    /** Settings > Music backdrop: redrawn at the next update. */
    setShape(name) {
        if (SHAPE_NAMES.indexOf(name) < 0) name = 'bmw';
        if (name !== this.shape) { this.shape = name; this.bgCover = null; }
    }

    /** Settings > cover size and bar length (px in the slot's picture). */
    setMusic(o) {
        const m = Object.assign({ size: 140, bar: 180, thick: 3, time: 'right', back: false }, o);
        if (JSON.stringify(m) !== JSON.stringify(this.music)) {
            this.music = m; this.key = null; this.barKey = null;
            if (this.bar) { try { const r = this.barRect(); this.cr.set(this.bar, { x: r.x, y: r.y, w: r.w, h: r.h }); } catch (e) { /* next */ } }
        }
    }

    barRect() {
        const r = this.rect(), s = this.place.scale;
        return { x: r.x + Math.round((SW - BAR_W) / 2 * s), y: r.y + Math.round(barTop(this.music.size) * s), w: Math.round(BAR_W * s), h: Math.round(BAR_H * s) };
    }

    bgRect() {
        const s = this.place.scale, f = this.fit, w = Math.round(BG.w * s * f.scale), h = Math.round(BG.h * s * f.scale);
        // sized from its top-left corner, so Smaller pulls the bottom up off the tach
        const x0 = this.place.x + BG.dx * s - BG.w * s / 2 + f.x, y0 = this.place.y + BG.dy * s - BG.h * s / 2 + f.y;
        return { x: Math.round(x0), y: Math.round(y0), w: w, h: h };
    }

    rect() {
        const s = this.place.scale, w = Math.round(SW * s), h = Math.round(SH * s);
        return { x: Math.round(this.place.x - w / 2), y: Math.round(this.place.y - h / 2), w: w, h: h };
    }

    create() {
        if (!this.cr || this.ref) return;
        try {
            const r = this.rect();
            this.ref = this.cr.image({ target: 'panel', klass: 'content', z: 22, x: r.x, y: r.y, w: r.w, h: r.h, iw: SW, ih: SH,
                sampling: 'bilinear', fps: 2, visible: false });
            const b = this.bgRect();
            this.bg = this.cr.image({ target: 'panel', klass: 'content', z: 21, x: b.x, y: b.y, w: b.w, h: b.h, iw: BW, ih: BH,
                sampling: 'bilinear', fps: 1, visible: false });
            const k = this.barRect();
            this.bar = this.cr.image({ target: 'panel', klass: 'content', z: 23, x: k.x, y: k.y, w: k.w, h: k.h, iw: BAR_W, ih: BAR_H,
                sampling: 'bilinear', fps: 2, visible: false });
        } catch (e) { this.note('slot: ' + e.message); }
    }

    /** want: the bottom strip is on the cluster now; c: content() or null. */
    update(want, c) {
        if (!this.ref) return;
        try {
            const show = !!(want && c);
            if (show) {
                if (c.music) c.music.size = this.music.size;
                const key = JSON.stringify(c, (k, v) => (k === 'cover' || k === 'bg' ? (v ? k : null) : k === 'pos' ? undefined : v));
                const now = Date.now();
                if (key !== this.key && now - this.at >= MIN_MS) {
                    this.key = key; this.at = now;
                    this.pixels = draw(c, this.fonts);
                    this.cr.pixels(this.ref, null, this.pixels);
                }
            }
            if (show !== this.shown) { this.shown = show; this.cr.set(this.ref, { visible: show }); this.note('slot: ' + (show ? 'show' : 'hide')); }
            // the progress bar: its own small picture, at most once a second
            const bm = show && c && c.music && c.music.dur && c.music.pos !== null ? c.music : null;
            if (this.bar && bm) {
                const bk = Math.floor(bm.pos / 1000) + '/' + bm.dur + '/' + JSON.stringify(this.music);
                if (bk !== this.barKey) { this.barKey = bk; this.cr.pixels(this.bar, null, drawBar(bm, this.fonts, { w: this.music.bar, h: this.music.thick, time: this.music.time, back: this.music.back })); }
            }
            if (this.bar && !!bm !== this.barShown) { this.barShown = !!bm; this.cr.set(this.bar, { visible: !!bm }); }
            // the music's backdrop: uploaded once per cover (bg: { px, n } the large cover, from c.music.bg)
            const bg = show && c && c.music && c.music.bg && this.shape !== 'off' ? c.music.bg : null;
            if (this.bg && bg && bg !== this.bgCover) { this.bgCover = bg; this.cr.pixels(this.bg, null, drawBackdrop(bg.px, bg.n, this.shape, this.look)); }
            const bgShow = !!bg;
            if (this.bg && bgShow !== this.bgShown) { this.bgShown = bgShow; this.cr.set(this.bg, { visible: bgShow }); }
        } catch (e) { this.note('slot: ' + e.message); }
    }

    move(place, fit) {
        this.place = Object.assign({}, DEF, place);
        if (fit) this.fit = Object.assign({ x: 0, y: 0, scale: 1 }, fit);
        if (this.ref) { try { const r = this.rect(); this.cr.set(this.ref, { x: r.x, y: r.y, w: r.w, h: r.h }); } catch (e) { /* next */ } }
        if (this.bar) { try { const k = this.barRect(); this.cr.set(this.bar, { x: k.x, y: k.y, w: k.w, h: k.h }); } catch (e) { /* next */ } }
        if (this.bg) { try { const b = this.bgRect(); this.cr.set(this.bg, { x: b.x, y: b.y, w: b.w, h: b.h }); } catch (e) { /* next */ } }
    }
}

module.exports = { Slot, SLOTS, SHAPE_NAMES, drawBar, DEF, SW, SH, BW, BH, content, draw, drawBackdrop, gearText };
