'use strict';
/**
 * Fifteen projection layouts. Each one draws a tachometer and the gear.
 * At the redline the live part and the gear flash red.
 * Colours, font, size and height come from the settings on the chosen layout.
 */
const { withAlpha } = require('./kit/canvas');

const STYLES = [
    { id: 'arc', name: 'Arc' },
    { id: 'bar', name: 'Bar' },
    { id: 'ring', name: 'Ring' },
    { id: 'split', name: 'Split' },
    { id: 'lights', name: 'Lights' },
    { id: 'needle', name: 'Needle' },
    { id: 'stack', name: 'Stack' },
    { id: 'corner', name: 'Corner' },
    { id: 'tape', name: 'Tape' },
    { id: 'halo', name: 'Halo' },
    { id: 'steps', name: 'Steps' },
    { id: 'dual', name: 'Dual' },
    { id: 'horizon', name: 'Horizon' },
    { id: 'chevron', name: 'Chevron' },
    { id: 'orbit', name: 'Orbit' },
];

const RAD = Math.PI / 180;
const pt = (cx, cy, r, deg) => {
    const a = deg * RAD;
    return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
};

function place(area, look) {
    const k = (Number(look.size) || 100) / 100;
    const bw = Math.max(120, Math.round(area.nw * k));
    const bh = Math.max(64, Math.round(area.nh * k));
    const lift = Math.round((Number(look.height) || 0) * (area.nh / 168));
    return {
        x: area.nx + Math.round((area.nw - bw) / 2),
        y: area.ny + Math.round((area.nh - bh) / 2) - lift,
        w: bw,
        h: bh,
    };
}

function face(look, s) {
    const redline = Number(look.redline) || 7000;
    const rpm = s.rpmN || 0;
    const f = Math.max(0, Math.min(1, rpm / redline));
    const hot = rpm >= redline;
    const blink = look.blink != null ? !!look.blink : hot && look.flash !== false && ((Date.now() / 160) | 0) % 2 === 0;
    return {
        font: look.font || 'num',
        gear: look.font && look.font !== 'num' ? look.font : 'gear',
        accent: blink ? (look.red || '#ff3b3b') : (look.accent || '#9fd0ff'),
        text: blink ? '#ffffff' : (look.text || '#f4f7fb'),
        red: look.red || '#ff3b3b',
        blink: blink,
        f: f,
        redline: redline,
    };
}

function rpmText(s) {
    return s.rpm === '--' ? '--' : s.rpm;
}

function track(cv, b, L) {
    if (L.blink) cv.strokeRoundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, Math.max(8, b.h * 0.08), 3, L.red);
}

function arcTach(cv, cx, cy, r0, r1, f, L) {
    const a0 = -135;
    const sweep = 270;
    cv.arc(cx, cy, r0, r1, a0, a0 + sweep, withAlpha(L.text, 0.16), { round: true });
    const zone = 0.86;
    if (f > 0.02) {
        const live = Math.min(f, zone);
        cv.arc(cx, cy, r0, r1, a0, a0 + sweep * live, L.accent, { round: true });
    }
    if (f > zone) cv.arc(cx, cy, r0, r1, a0 + sweep * zone, a0 + sweep * f, L.red, { round: true });
    cv.arc(cx, cy, r0, r1, a0 + sweep * zone, a0 + sweep, withAlpha(L.red, 0.35), { round: true });
}

const DRAW = {
    arc(cv, b, L, s) {
        const cx = b.x + b.w * 0.38;
        const cy = b.y + b.h * 0.58;
        const r = b.h * 0.42;
        arcTach(cv, cx, cy, r * 0.72, r, L.f, L);
        cv.text(s.gear, cx, cy + b.h * 0.08, b.h * 0.42, L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), b.x + b.w * 0.78, b.y + b.h * 0.62, b.h * 0.28, L.accent, { align: 'center', font: L.font });
    },
    bar(cv, b, L, s) {
        const x = b.x + b.w * 0.06;
        const y = b.y + b.h * 0.62;
        const w = b.w * 0.62;
        const h = Math.max(10, b.h * 0.16);
        const zone = 0.86;
        cv.roundRect(x, y, w, h, h / 2, withAlpha(L.text, 0.12));
        cv.roundRect(x + w * zone, y, w * (1 - zone), h, h / 2, withAlpha(L.red, 0.35));
        if (L.f > 0.02) {
            const live = Math.min(L.f, zone);
            cv.roundRect(x, y, Math.max(h, w * live), h, h / 2, L.accent);
            if (L.f > zone) cv.roundRect(x + w * zone, y, w * (L.f - zone), h, h / 2, L.red);
        }
        cv.text(s.gear, b.x + b.w * 0.86, b.y + b.h * 0.7, b.h * 0.5, L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), x, y - b.h * 0.08, b.h * 0.22, L.accent, { font: L.font });
    },
    ring(cv, b, L, s) {
        const cx = b.x + b.w * 0.32;
        const cy = b.y + b.h * 0.52;
        const r = b.h * 0.4;
        cv.arc(cx, cy, r * 0.78, r, 0, 360, withAlpha(L.text, 0.14));
        cv.arc(cx, cy, r * 0.78, r, -90, -90 + 360 * L.f, L.f > 0.86 ? L.red : L.accent);
        cv.text(s.gear, cx, cy + b.h * 0.1, b.h * 0.4, L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), b.x + b.w * 0.72, cy + b.h * 0.08, b.h * 0.32, L.accent, { align: 'center', font: L.font });
    },
    split(cv, b, L, s) {
        const cx = b.x + b.w * 0.28;
        const cy = b.y + b.h * 0.58;
        arcTach(cv, cx, cy, b.h * 0.28, b.h * 0.42, L.f, L);
        cv.text(rpmText(s), cx, cy + b.h * 0.12, b.h * 0.2, L.accent, { align: 'center', font: L.font });
        cv.text(s.gear, b.x + b.w * 0.72, b.y + b.h * 0.68, b.h * 0.62, L.text, { align: 'center', font: L.gear });
    },
    lights(cv, b, L, s) {
        const n = 12;
        const gap = b.w * 0.008;
        const x0 = b.x + b.w * 0.06;
        const w = b.w * 0.6;
        const lw = (w - gap * (n - 1)) / n;
        const y = b.y + b.h * 0.28;
        const lh = b.h * 0.16;
        const lit = Math.round(L.f * n);
        for (let i = 0; i < n; i++) {
            const zone = i >= n * 0.86;
            const on = i < lit;
            const c = !on ? withAlpha(L.text, 0.12) : zone || L.blink ? L.red : i > n * 0.7 ? '#ffb020' : L.accent;
            cv.roundRect(x0 + i * (lw + gap), y, lw, lh, 4, c);
        }
        cv.text(s.gear, b.x + b.w * 0.84, b.y + b.h * 0.62, b.h * 0.5, L.blink ? L.red : L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), x0, b.y + b.h * 0.78, b.h * 0.22, L.accent, { font: L.font });
    },
    needle(cv, b, L, s) {
        const cx = b.x + b.w * 0.36;
        const cy = b.y + b.h * 0.72;
        const r = b.h * 0.5;
        cv.arc(cx, cy, r * 0.86, r, -120, 120, withAlpha(L.text, 0.16), { round: true });
        cv.arc(cx, cy, r * 0.86, r, 70, 120, withAlpha(L.red, 0.45), { round: true });
        const ang = -120 + 240 * L.f;
        const tip = pt(cx, cy, r * 0.78, ang);
        cv.line(cx, cy, tip[0], tip[1], Math.max(2, b.h * 0.025), L.f > 0.86 ? L.red : L.accent);
        cv.circle(cx, cy, b.h * 0.035, L.text);
        cv.text(s.gear, b.x + b.w * 0.78, b.y + b.h * 0.66, b.h * 0.48, L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), cx, cy - r * 0.35, b.h * 0.16, L.accent, { align: 'center', font: L.font });
    },
    stack(cv, b, L, s) {
        cv.text(s.gear, b.x + b.w * 0.22, b.y + b.h * 0.62, b.h * 0.55, L.text, { align: 'center', font: L.gear });
        const n = 16;
        const x0 = b.x + b.w * 0.4;
        const w = b.w * 0.54;
        const gap = 3;
        const lw = (w - gap * (n - 1)) / n;
        const base = b.y + b.h * 0.78;
        const lit = Math.round(L.f * n);
        for (let i = 0; i < n; i++) {
            const hh = b.h * (0.12 + 0.28 * (i / (n - 1)));
            const zone = i >= n * 0.86;
            const c = i >= lit ? withAlpha(L.text, 0.12) : zone || L.blink ? L.red : L.accent;
            cv.roundRect(x0 + i * (lw + gap), base - hh, lw, hh, 3, c);
        }
        cv.text(rpmText(s), x0, b.y + b.h * 0.28, b.h * 0.18, L.accent, { font: L.font });
    },
    corner(cv, b, L, s) {
        cv.text(s.gear, b.x + b.w * 0.16, b.y + b.h * 0.7, b.h * 0.62, L.text, { align: 'center', font: L.gear });
        const x = b.x + b.w * 0.32;
        const y = b.y + b.h * 0.42;
        const w = b.w * 0.6;
        const h = Math.max(8, b.h * 0.1);
        cv.roundRect(x, y, w, h, h / 2, withAlpha(L.text, 0.12));
        const ticks = 9;
        for (let i = 0; i <= ticks; i++) {
            const px = x + (w * i) / ticks;
            const zone = i / ticks >= 0.86;
            cv.line(px, y - b.h * 0.06, px, y, Math.max(1, b.h * 0.012), zone ? L.red : withAlpha(L.text, 0.45));
        }
        if (L.f > 0.02) cv.roundRect(x, y, Math.max(h, w * L.f), h, h / 2, L.f > 0.86 ? L.red : L.accent);
        cv.text(rpmText(s), x, b.y + b.h * 0.78, b.h * 0.2, L.accent, { font: L.font });
    },
    tape(cv, b, L, s) {
        const x = b.x + b.w * 0.18;
        const y = b.y + b.h * 0.14;
        const w = Math.max(12, b.w * 0.045);
        const h = b.h * 0.72;
        cv.roundRect(x, y, w, h, w / 2, withAlpha(L.text, 0.12));
        const zone = 0.86;
        cv.roundRect(x, y, w, h * (1 - zone), w / 2, withAlpha(L.red, 0.4));
        if (L.f > 0.02) {
            const fh = h * L.f;
            cv.roundRect(x, y + h - fh, w, fh, w / 2, L.f > zone ? L.red : L.accent);
        }
        cv.text(s.gear, b.x + b.w * 0.62, b.y + b.h * 0.68, b.h * 0.62, L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), b.x + b.w * 0.28, b.y + b.h * 0.58, b.h * 0.2, L.accent, { font: L.font });
    },
    halo(cv, b, L, s) {
        const cx = b.x + b.w * 0.34;
        const cy = b.y + b.h * 0.52;
        const r = b.h * 0.42;
        cv.arc(cx, cy, r * 0.9, r, 0, 360, withAlpha(L.text, 0.1));
        cv.arc(cx, cy, r * 0.62, r * 0.74, 0, 360, withAlpha(L.text, 0.16));
        cv.arc(cx, cy, r * 0.9, r, -90, -90 + 360 * L.f, L.f > 0.86 ? L.red : L.accent);
        cv.arc(cx, cy, r * 0.62, r * 0.74, -90, -90 + 360 * Math.min(1, L.f * 1.05), withAlpha(L.accent, 0.85));
        cv.text(s.gear, cx, cy + b.h * 0.1, b.h * 0.36, L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), b.x + b.w * 0.74, cy + b.h * 0.06, b.h * 0.26, L.accent, { align: 'center', font: L.font });
    },
    steps(cv, b, L, s) {
        const n = 10;
        const x0 = b.x + b.w * 0.06;
        const w = b.w * 0.62;
        const gap = b.w * 0.008;
        const lw = (w - gap * (n - 1)) / n;
        const base = b.y + b.h * 0.8;
        const lit = L.f * n;
        for (let i = 0; i < n; i++) {
            const hh = b.h * (0.16 + 0.4 * (i / (n - 1)));
            const zone = i >= 8;
            const on = i < lit;
            const c = !on ? withAlpha(L.text, 0.1) : zone || L.blink ? L.red : L.accent;
            cv.roundRect(x0 + i * (lw + gap), base - hh, lw, hh, 4, c);
        }
        cv.text(s.gear, b.x + b.w * 0.84, b.y + b.h * 0.68, b.h * 0.52, L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), x0, b.y + b.h * 0.22, b.h * 0.16, L.accent, { font: L.font });
    },
    dual(cv, b, L, s) {
        cv.text(s.gear, b.x + b.w * 0.22, b.y + b.h * 0.66, b.h * 0.58, L.text, { align: 'center', font: L.gear });
        const cx = b.x + b.w * 0.68;
        const cy = b.y + b.h * 0.56;
        arcTach(cv, cx, cy, b.h * 0.26, b.h * 0.4, L.f, L);
        cv.arc(cx, cy, b.h * 0.16, b.h * 0.22, -135, -135 + 270 * L.f, withAlpha(L.accent, 0.7), { round: true });
        cv.text(rpmText(s), cx, cy + b.h * 0.08, b.h * 0.16, L.accent, { align: 'center', font: L.font });
    },
    horizon(cv, b, L, s) {
        const cx = b.x + b.w * 0.5;
        const cy = b.y + b.h * 0.92;
        const r = b.w * 0.42;
        cv.arc(cx, cy, r * 0.9, r, -80, 80, withAlpha(L.text, 0.14), { round: true });
        cv.arc(cx, cy, r * 0.9, r, 48, 80, withAlpha(L.red, 0.4), { round: true });
        if (L.f > 0.02) cv.arc(cx, cy, r * 0.9, r, -80, -80 + 160 * L.f, L.f > 0.86 ? L.red : L.accent, { round: true });
        cv.text(s.gear, b.x + b.w * 0.22, b.y + b.h * 0.48, b.h * 0.42, L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), b.x + b.w * 0.72, b.y + b.h * 0.48, b.h * 0.28, L.accent, { align: 'center', font: L.font });
    },
    chevron(cv, b, L, s) {
        const n = 9;
        const x0 = b.x + b.w * 0.08;
        const w = b.w * 0.84;
        const y = b.y + b.h * 0.34;
        const step = w / n;
        const lit = Math.round(L.f * n);
        for (let i = 0; i < n; i++) {
            const zone = i >= n * 0.86;
            const c = i >= lit ? withAlpha(L.text, 0.16) : zone || L.blink ? L.red : L.accent;
            const x = x0 + i * step;
            const h = b.h * 0.16;
            cv.line(x, y + h, x + step * 0.35, y, Math.max(2, b.h * 0.035), c);
            cv.line(x + step * 0.35, y, x + step * 0.7, y + h, Math.max(2, b.h * 0.035), c);
        }
        cv.text(s.gear, b.x + b.w * 0.32, b.y + b.h * 0.82, b.h * 0.4, L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), b.x + b.w * 0.7, b.y + b.h * 0.8, b.h * 0.26, L.accent, { align: 'center', font: L.font });
    },
    orbit(cv, b, L, s) {
        const cx = b.x + b.w * 0.34;
        const cy = b.y + b.h * 0.52;
        const r = b.h * 0.38;
        const n = 16;
        const lit = L.f * n;
        for (let i = 0; i < n; i++) {
            const ang = -90 + (360 * i) / n;
            const p = pt(cx, cy, r, ang);
            const zone = i / n >= 0.86;
            const on = i < lit;
            const c = !on ? withAlpha(L.text, 0.16) : zone || L.blink ? L.red : L.accent;
            cv.circle(p[0], p[1], Math.max(3, b.h * 0.035), c);
        }
        cv.text(s.gear, cx, cy + b.h * 0.1, b.h * 0.4, L.text, { align: 'center', font: L.gear });
        cv.text(rpmText(s), b.x + b.w * 0.74, cy + b.h * 0.06, b.h * 0.28, L.accent, { align: 'center', font: L.font });
    },
};

function drawProjection(cv, area, look, s, glass) {
    const b = place(area, look);
    const L = face(look, s);
    const paint = DRAW[look.id] || DRAW.arc;
    if (!glass) cv.roundRect(b.x, b.y, b.w, b.h, Math.max(10, b.h * 0.08), '#07090d');
    track(cv, b, L);
    paint(cv, b, L, s);
    if (look.cam) {
        cv.text('CAMERA', b.x + 16, b.y + Math.max(22, b.h * 0.22), Math.max(14, b.h * 0.16), L.red, { font: 'bold' });
        cv.text(look.cam, b.x + b.w - 16, b.y + Math.max(28, b.h * 0.28), Math.max(18, b.h * 0.22), L.red, { align: 'right', font: 'num' });
    }
}

module.exports = { STYLES, drawProjection };
