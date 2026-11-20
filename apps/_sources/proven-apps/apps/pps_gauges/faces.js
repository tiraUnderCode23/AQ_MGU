'use strict';
/**
 * faces.js - Proven's own gauge faces, drawn on the kit's frame surface (kit/runtime/record.js).
 *
 *   dial(cv, t, cx, cy, r, g)        the Proven dial: a 270-degree analogue face with a needle
 *   statusStrip(cv, t, x, y, w, h, g) a status line with a coloured lamp
 *
 * dial g = {
 *   key            a name that is unique on the page (smoothing, layer cache)
 *   value, min, max
 *   major          value between two numbered ticks        minor   subdivisions of a major step (default 5)
 *   div            numbers are value / div (1000 for rpm)   labelDecimals
 *   label          text on the face (e.g. 'RPM x1000')      unit    after the digital value
 *   decimals       of the digital value
 *   redFrom        red band from here to max                warnFrom  amber band from here to redFrom / max
 *   coldTo         blue band from min to here
 *   peak           tell-tale on the rim                      target  white marker across the scale
 *   bands          more bands on the rim: [{ from, to, color }] (theme key or #hex), e.g. a green "safe" window
 *   endLabels      false: no numbers at the two ends of the scale (room for a long label between them)
 *   color          the value arc in one colour (theme key or #hex) instead of the calm -> red ramp
 *   needleColor    the needle's colour (default: the theme's needle; red inside redFrom)
 *   brand          false: no Proven logo on the face
 * }
 * Angles as in the kit: degrees, 0 = up, clockwise. The scale runs from -135 to +135.
 * The face (bezel, bands, ticks, numbers, lettering) is drawn once and cached as a GPU layer;
 * only the value arc, needle, markers and the digital value are drawn per frame.
 */
const G = require('./kit/gauges');
const { withAlpha, mix, ramp } = require('./kit/canvas');
const Logo = require('./logo');

const A0 = -135, SWEEP = 270;
const RAD = Math.PI / 180;
const pt = (cx, cy, r, deg) => [cx + Math.sin(deg * RAD) * r, cy - Math.cos(deg * RAD) * r];
const frac = (g, v) => G.clamp((v - g.min) / (g.max - g.min), 0, 1);
const ang = (g, v) => A0 + frac(g, v) * SWEEP;

function dialFace(c, t, S, r, g) {
    const x = S, y = S;
    // bezel: a soft outer ring, a bright thin edge, then the face
    c.arc(x, y, r + 3, r + 10, 0, 360, withAlpha('#ffffff', 0.05));
    c.arc(x, y, r, r + 3, 0, 360, withAlpha('#ffffff', 0.26));
    c.circle(x, y, r, mix(t.bg, '#ffffff', 0.045));
    c.circle(x, y, r * 0.60, withAlpha('#000000', 0.38));
    c.arc(x, y, r * 0.60 - 1.5, r * 0.60, 0, 360, withAlpha('#ffffff', 0.07));
    // coloured bands along the rim
    const band = (from, to, col) => { if (to > from) c.arc(x, y, r - 7, r - 1, ang(g, from), ang(g, to), col); };
    if (G.isNum(g.coldTo)) band(g.min, g.coldTo, withAlpha(t.cold, 0.9));
    if (G.isNum(g.warnFrom)) band(g.warnFrom, G.isNum(g.redFrom) ? g.redFrom : g.max, withAlpha(t.warn, 0.95));
    if (G.isNum(g.redFrom)) band(g.redFrom, g.max, t.crit);
    for (const b of g.bands || []) band(Math.max(g.min, b.from), Math.min(g.max, b.to), t[b.color] || b.color);
    // scale track
    c.arc(x, y, r - 21, r - 11, A0, A0 + SWEEP, t.track, { round: true });
    // ticks and numbers
    const minor = g.minor || 5, nMajor = Math.round((g.max - g.min) / g.major), fs = Math.max(20, Math.round(r * 0.125));
    for (let i = 0; i <= nMajor * minor; i++) {
        const v = g.min + (i / minor) * g.major;
        if (v > g.max + 1e-9) break;
        const a = ang(g, v), isMajor = i % minor === 0, half = minor % 2 === 0 && i % (minor / 2) === 0;
        const red = G.isNum(g.redFrom) && v >= g.redFrom - 1e-9;
        const ri = r - 25 - (isMajor ? 22 : half ? 15 : 10), ro = r - 25;
        const [x0, y0] = pt(x, y, ri, a), [x1, y1] = pt(x, y, ro, a);
        c.line(x0, y0, x1, y1, isMajor ? 4 : 2, red ? t.crit : isMajor ? t.text : withAlpha(t.tick, 0.9));
        if (isMajor && !(g.endLabels === false && (i === 0 || i === nMajor * minor))) {
            // the number sits clear of its tick whatever its width: wide ones (0.5, 150) move further in at the sides
            const txt = G.fmt(v / (g.div || 1), g.labelDecimals || 0), opt = { align: 'center', font: 'bold', literal: true };
            const need = Math.abs(Math.sin(a * RAD)) * c.textWidth(txt, fs, opt) / 2 + Math.abs(Math.cos(a * RAD)) * fs * 0.4 + 8;
            const [lx, ly] = pt(x, y, r - 25 - 22 - need, a);
            c.text(txt, lx, ly + fs * 0.36, fs, red ? t.crit : t.text, opt);
        }
    }
    // the PROVEN line of the logo on the face
    if (g.brand !== false) {
        // (a small dial has its numbers closer in: the logo is narrower there, clear of them)
        const lw = r * (r >= 190 ? 0.70 : 0.54), z = Logo.size(lw, 'word');
        Logo.paint(c, x - lw / 2, y - r * (r >= 190 ? 0.27 : 0.25) - z.h / 2, lw, 'word');
    }
    if (g.label) c.text(String(g.label).toUpperCase(), x, y + r * 0.36, Math.max(16, Math.round(r * 0.095)), t.dim, { align: 'center', font: 'bold', spacing: 2 });
    // window for the digital value, in the gap of the scale
    const ww = r * 0.92, wh = r * 0.34;
    c.roundRect(x - ww / 2, y + r * 0.50, ww, wh, 10, withAlpha('#000000', 0.55));
    c.strokeRoundRect(x - ww / 2, y + r * 0.50, ww, wh, 10, 1.5, withAlpha('#ffffff', 0.14));
}

function dial(cv, t, cx, cy, r, g) {
    g = Object.assign({ min: 0, max: 100, major: 10 }, g);
    const S = Math.ceil(r + 12);
    const key = ['pps-dial', r, g.min, g.max, g.major, g.minor, g.div, g.labelDecimals, g.label || '', g.redFrom, g.warnFrom, g.coldTo,
        JSON.stringify(g.bands || []), g.endLabels !== false, g.brand !== false, t.name].join('|');
    cv.blit(G.layer(key, 2 * S, 2 * S, (c) => dialFace(c, t, S, r, g), cv.textScale), Math.round(cx) - S, Math.round(cy) - S);

    const v = g.value, sv = G.smooth('pps-dial|' + g.key, v);
    const inRed = G.isNum(sv) && G.isNum(g.redFrom) && sv >= g.redFrom;
    // value arc on the scale track: calm -> accent -> red at the limit
    if (G.isNum(sv) && frac(g, sv) > 0.003) {
        const ae = ang(g, sv), hot = t.hotRamp || t.ramp, limA = ang(g, G.isNum(g.redFrom) ? g.redFrom : g.max);
        const solid = g.color ? t[g.color] || g.color : inRed ? t.crit : null;
        cv.arc(cx, cy, r - 26, r - 6, A0, ae, withAlpha(solid || ramp(hot, (ae - A0) / Math.max(1, limA - A0)), 0.16));
        cv.arc(cx, cy, r - 21, r - 11, A0, ae, solid || t.accent, solid ? { round: true } : { round: true, ramp: hot, rampFrom: A0, rampTo: limA });
    }
    // target: a white marker across the scale
    if (G.isNum(g.target) && g.target > g.min) {
        const a = ang(g, g.target), [x0, y0] = pt(cx, cy, r - 30, a), [x1, y1] = pt(cx, cy, r - 2, a);
        cv.line(x0, y0, x1, y1, 5, t.bg); cv.line(x0, y0, x1, y1, 3, '#ffffff');
    }
    // peak: a tell-tale on the rim
    if (G.isNum(g.peak) && g.peak > g.min) {
        const a = ang(g, g.peak), tip = pt(cx, cy, r - 2, a), b1 = pt(cx, cy, r + 13, a - 2.6), b2 = pt(cx, cy, r + 13, a + 2.6);
        cv.fill([tip, b1, b2], t.accent2);
        const [x0, y0] = pt(cx, cy, r - 21, a), [x1, y1] = pt(cx, cy, r - 2, a);
        cv.line(x0, y0, x1, y1, 2.5, t.accent2);
    }
    // needle: tapered, with a soft glow and a short tail
    const a = (G.isNum(sv) ? A0 + G.clamp((sv - g.min) / (g.max - g.min), -0.01, 1.015) * SWEEP : A0) * RAD;
    const dx = Math.sin(a), dy = -Math.cos(a), nx = -dy, ny = dx;
    const nc = !G.isNum(sv) ? t.tick : inRed ? t.crit : g.needleColor ? t[g.needleColor] || g.needleColor : (t.needle || t.accent);
    const tail = r * 0.16, len = r - 30, wb = Math.max(4, r * 0.028), wt = 1.4;
    cv.line(cx - dx * tail, cy - dy * tail, cx + dx * len, cy + dy * len, wb * 2 + 6, withAlpha(nc, 0.18));
    cv.quad([[cx - dx * tail + nx * wb, cy - dy * tail + ny * wb], [cx + dx * len + nx * wt, cy + dy * len + ny * wt],
        [cx + dx * len - nx * wt, cy + dy * len - ny * wt], [cx - dx * tail - nx * wb, cy - dy * tail - ny * wb]], nc);
    cv.quad([[cx - dx * tail + nx * wb, cy - dy * tail + ny * wb], [cx + dx * len + nx * wt, cy + dy * len + ny * wt],
        [cx + dx * len, cy + dy * len], [cx - dx * tail, cy - dy * tail]], withAlpha('#ffffff', 0.22));
    // hub
    cv.circle(cx, cy, r * 0.105, mix(t.bg, '#ffffff', 0.16));
    cv.arc(cx, cy, r * 0.105 - 2, r * 0.105, 0, 360, withAlpha('#ffffff', 0.3));
    cv.circle(cx, cy, r * 0.045, nc);
    // digital value in the window
    const vs = Math.round(r * 0.25), us = Math.max(16, Math.round(r * 0.105)), by = cy + r * 0.50 + r * 0.34 * 0.5 + vs * 0.36;
    const txt = G.fmt(G.hold('pps-dial|' + g.key, v, g.holdMs || 100), g.decimals || 0);
    const uw = g.unit ? cv.textWidth(' ' + g.unit, us) : 0, tw = cv.textWidth(txt, vs, { font: 'num', literal: true });
    const left = cx - (tw + uw) / 2;
    cv.text(txt, left, by, vs, !G.isNum(v) ? t.dim : inRed ? t.crit : t.text, { font: 'num', literal: true });
    if (g.unit) cv.text(' ' + g.unit, left + tw, by, us, t.dim);
}

/** A status line: a lamp in g.color, a bold headline and a dimmer note. */
function statusStrip(cv, t, x, y, w, h, g) {
    const c = t[g.color] || g.color || t.accent;
    cv.roundRect(x, y, w, h, 8, withAlpha('#b4bccc', 0.07));
    cv.fillRect(x, y, 6, h, c);
    cv.circle(x + 34, y + h / 2, 9, withAlpha(c, 0.28)); cv.circle(x + 34, y + h / 2, 6, c);
    const hw = cv.text(String(g.title).toUpperCase(), x + 56, y + h / 2 + 9, 26, c, { font: 'bold', spacing: 2 });
    if (g.note) cv.text(g.note, x + 56 + hw + 22, y + h / 2 + 8, 22, t.dim);
}

module.exports = { dial, statusStrip };
