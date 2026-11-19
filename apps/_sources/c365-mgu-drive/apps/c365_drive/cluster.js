'use strict';
/**
 * Twenty instrument faces for the middle of the cluster.
 * Needles, ticks and a moving light. Speed, gear and rpm stay readable.
 * Side gauges on iDrive 8 stay the car's.
 */
const { withAlpha } = require('./kit/canvas');

const STYLES = [
    { id: 'off', name: 'Stock' },
    { id: 'm2', name: 'M2' },
    { id: 'm3', name: 'M3' },
    { id: '911', name: '911' },
    { id: 'ferrari', name: 'Ferrari' },
    { id: 'fdial', name: 'F Dial' },
    { id: 'lambo', name: 'Lambo' },
    { id: 'amg', name: 'AMG' },
    { id: 'rs', name: 'RS' },
    { id: 'mclaren', name: 'McLaren' },
    { id: 'bugatti', name: 'Bugatti' },
    { id: 'gtr', name: 'GT-R' },
    { id: 'vette', name: 'Vette' },
    { id: 'typer', name: 'Type R' },
    { id: 'aston', name: 'Aston' },
    { id: 'lfa', name: 'LFA' },
    { id: 'pagani', name: 'Pagani' },
    { id: 'rimac', name: 'Rimac' },
    { id: 'fordgt', name: 'Ford GT' },
    { id: 'alpine', name: 'Alpine' },
    { id: 'bentley', name: 'Bentley' },
    { id: 'jesko', name: 'Jesko' },
    { id: 'm5x', name: 'M5' },
    { id: 'amgs', name: 'AMG S' },
    { id: 'bmwr', name: 'Round' },
    { id: 'm2x', name: 'M2 D' },
    { id: 'wing', name: 'Wing' },
    { id: 'split', name: 'Split' },
    { id: 'pods', name: 'Pods' },
    { id: 'night', name: 'Night' },
    { id: 'amgc', name: 'AMG C' },
];

const RED = '#ff2a2a';
const RAD = Math.PI / 180;

function frac(look, s) {
    const redline = Number(look.redline) || 7000;
    return Math.max(0, Math.min(1, (s.rpmN || 0) / redline));
}

function wave(ms) {
    return (Date.now() % ms) / ms;
}

function pt(cx, cy, r, deg) {
    const a = deg * RAD;
    return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
}

function stage(cv, b, bg) {
    cv.fillRect(b.x, b.y, b.w, b.h, bg);
    cv.fillRect(b.x, b.y, b.w, Math.max(1, b.h * 0.012), withAlpha('#ffffff', 0.22));
    cv.fillRect(b.x, b.y + b.h - Math.max(1, b.h * 0.012), b.w, Math.max(1, b.h * 0.012), withAlpha('#000000', 0.65));
    if (b.blink) cv.strokeRoundRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6, 8, 2, RED);
}

function dial(cv, cx, cy, r, face) {
    cv.circle(cx, cy, r, '#050608');
    cv.arc(cx, cy, r * 0.9, r, 0, 360, face || '#14181e');
    cv.arc(cx, cy, r * 0.88, r * 0.94, 0, 360, withAlpha('#ffffff', 0.08));
}

function marks(cv, cx, cy, r, a0, turn, n, ink, redAt) {
    const len = r * 0.09;
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = a0 + turn * t;
        const inner = pt(cx, cy, r - (i % 2 === 0 ? len : len * 0.45), a);
        const outer = pt(cx, cy, r, a);
        const hot = t >= (redAt == null ? 0.82 : redAt);
        cv.line(inner[0], inner[1], outer[0], outer[1], i % 2 === 0 ? 2.4 : 1.2, hot ? RED : ink);
    }
}

function track(cv, cx, cy, r0, r1, a0, turn, f, ink) {
    cv.arc(cx, cy, r0, r1, a0, a0 + turn, withAlpha('#ffffff', 0.1), { round: true });
    const zone = 0.82;
    cv.arc(cx, cy, r0, r1, a0 + turn * zone, a0 + turn, withAlpha(RED, 0.45), { round: true });
    if (f > 0.02) cv.arc(cx, cy, r0, r1, a0, a0 + turn * Math.min(f, zone), ink, { round: true });
    if (f > zone) cv.arc(cx, cy, r0, r1, a0 + turn * zone, a0 + turn * f, RED, { round: true });
    const g = a0 + turn * ((f + wave(1800) * 0.04) % 1);
    cv.arc(cx, cy, r0, r1, g, g + 10, withAlpha('#ffffff', 0.7), { round: true });
}

function hand(cv, cx, cy, deg, len, color, width) {
    const tip = pt(cx, cy, len, deg);
    const back = pt(cx, cy, len * 0.16, deg + 180);
    const left = pt(cx, cy, width, deg - 90);
    const right = pt(cx, cy, width, deg + 90);
    cv.fill([tip, right, back, left], color);
    cv.circle(cx, cy, width * 1.6, color);
    cv.circle(cx, cy, width * 0.55, '#07080a');
}

function speed(cv, x, y, size, s, color) {
    cv.text(s.speed, x, y, size, color || '#f7f8fa', { align: 'center', font: 'num' });
}

function gear(cv, x, y, size, s, look, color) {
    cv.text(s.gear, x, y, size, look.blink ? RED : (color || '#f7f8fa'), { align: 'center', font: 'gear' });
}

function unit(cv, x, y, size, s, color) {
    cv.text(s.unit, x, y, size, color || '#8b939c', { align: 'center', font: 'bold' });
}

function rpm(cv, x, y, size, s, color) {
    cv.text(s.rpm === '--' ? '--' : s.rpm, x, y, size, color || '#c5ced6', { align: 'center', font: 'num' });
}

function lamps(cv, x, y, w, h, n, f) {
    const gap = Math.max(3, w * 0.012);
    const sw = (w - gap * (n - 1)) / n;
    const lit = Math.round(f * n);
    const blink = f > 0.9 && wave(160) > 0.5;
    for (let i = 0; i < n; i++) {
        let c = withAlpha('#ffffff', 0.08);
        if (i < lit) {
            if (i > n * 0.82) c = blink ? '#3a0000' : RED;
            else if (i > n * 0.62) c = '#ffb020';
            else c = '#3dd68c';
        }
        cv.roundRect(x + i * (sw + gap), y, Math.max(3, sw), h, h * 0.45, c);
    }
}

function stripes(cv, x, y, w, h) {
    const a = w / 3;
    const glide = wave(2200);
    cv.fillRect(x, y, a, h, '#1cb5e0');
    cv.fillRect(x + a, y, a, h, '#163a8a');
    cv.fillRect(x + a * 2, y, w - a * 2, h, RED);
    cv.fillRect(x + glide * (w - h * 2), y, h * 2, h, withAlpha('#ffffff', 0.45));
}

const A0 = -125;
const TURN = 250;

const DRAW = {
    m2(cv, b, s, look) {
        stage(cv, b, '#07090c');
        const f = frac(look, s);
        const cx = b.x + b.w * 0.22;
        const cy = b.y + b.h * 0.52;
        const r = b.h * 0.4;
        dial(cv, cx, cy, r, '#12161c');
        marks(cv, cx, cy, r * 0.86, A0, TURN, 16, '#d5dbe3');
        track(cv, cx, cy, r * 0.62, r * 0.74, A0, TURN, f, '#f4f7fb');
        hand(cv, cx, cy, A0 + TURN * f, r * 0.58, '#f4f7fb', Math.max(2, r * 0.035));
        rpm(cv, cx, cy + r * 0.38, r * 0.22, s, '#9aa3ad');
        speed(cv, b.x + b.w * 0.55, b.y + b.h * 0.58, b.h * 0.42, s);
        unit(cv, b.x + b.w * 0.55, b.y + b.h * 0.74, b.h * 0.08, s);
        gear(cv, b.x + b.w * 0.84, b.y + b.h * 0.55, b.h * 0.36, s, look);
        stripes(cv, b.x + b.w * 0.08, b.y + b.h * 0.88, b.w * 0.28, Math.max(5, b.h * 0.045));
    },
    m3(cv, b, s, look) {
        stage(cv, b, '#08090c');
        const f = frac(look, s);
        lamps(cv, b.x + b.w * 0.08, b.y + b.h * 0.12, b.w * 0.84, Math.max(8, b.h * 0.07), 18, f);
        speed(cv, b.x + b.w * 0.38, b.y + b.h * 0.62, b.h * 0.4, s);
        unit(cv, b.x + b.w * 0.38, b.y + b.h * 0.78, b.h * 0.08, s);
        rpm(cv, b.x + b.w * 0.62, b.y + b.h * 0.7, b.h * 0.12, s, '#9aa3ad');
        cv.roundRect(b.x + b.w * 0.74, b.y + b.h * 0.32, b.w * 0.18, b.h * 0.46, b.h * 0.06, '#12151a');
        gear(cv, b.x + b.w * 0.83, b.y + b.h * 0.62, b.h * 0.28, s, look);
    },
    911(cv, b, s, look) {
        stage(cv, b, '#0b0c0e');
        const cx = b.x + b.w * 0.42;
        const cy = b.y + b.h * 0.54;
        const r = b.h * 0.46;
        dial(cv, cx, cy, r, '#1a1c20');
        marks(cv, cx, cy, r * 0.9, -140, 280, 20, '#f2f2f2', 0.78);
        track(cv, cx, cy, r * 0.7, r * 0.8, -140, 280, frac(look, s), '#f7f7f7');
        hand(cv, cx, cy, -140 + 280 * frac(look, s), r * 0.66, '#ffffff', Math.max(2, r * 0.03));
        speed(cv, cx, cy + r * 0.08, b.h * 0.22, s);
        unit(cv, cx, cy + r * 0.28, b.h * 0.06, s);
        gear(cv, b.x + b.w * 0.82, b.y + b.h * 0.48, b.h * 0.32, s, look);
        rpm(cv, b.x + b.w * 0.82, b.y + b.h * 0.7, b.h * 0.1, s, '#9aa0a6');
    },
    ferrari(cv, b, s, look) {
        stage(cv, b, '#120e08');
        const cx = b.x + b.w * 0.62;
        const cy = b.y + b.h * 0.52;
        const r = b.h * 0.44;
        dial(cv, cx, cy, r, '#3a2e12');
        marks(cv, cx, cy, r * 0.88, A0, TURN, 16, '#f5c518');
        hand(cv, cx, cy, A0 + TURN * frac(look, s), r * 0.7, RED, Math.max(2, r * 0.04));
        speed(cv, b.x + b.w * 0.24, b.y + b.h * 0.55, b.h * 0.38, s, '#f5c518');
        unit(cv, b.x + b.w * 0.24, b.y + b.h * 0.74, b.h * 0.07, s, '#c4a24a');
        rpm(cv, cx, cy + r * 0.42, r * 0.18, s, '#f5c518');
    },
    lambo(cv, b, s, look) {
        stage(cv, b, '#070806');
        const f = frac(look, s);
        const y = b.y + b.h * 0.18;
        lamps(cv, b.x + b.w * 0.08, y, b.w * 0.84, Math.max(8, b.h * 0.06), 16, f);
        const tip = b.x + b.w * (0.12 + 0.76 * f);
        cv.fill([[tip, y + b.h * 0.14], [tip - b.h * 0.08, y + b.h * 0.22], [tip + b.h * 0.08, y + b.h * 0.22]], '#c6ff3a');
        speed(cv, b.x + b.w * 0.4, b.y + b.h * 0.66, b.h * 0.4, s, '#e8ff9a');
        unit(cv, b.x + b.w * 0.4, b.y + b.h * 0.84, b.h * 0.07, s, '#8ea85a');
        gear(cv, b.x + b.w * 0.78, b.y + b.h * 0.62, b.h * 0.34, s, look, '#c6ff3a');
    },
    amg(cv, b, s, look) {
        stage(cv, b, '#090b10');
        const r = b.h * 0.36;
        const cy = b.y + b.h * 0.5;
        const lx = b.x + b.w * 0.24;
        const rx = b.x + b.w * 0.76;
        dial(cv, lx, cy, r, '#161a22');
        dial(cv, rx, cy, r, '#161a22');
        marks(cv, lx, cy, r * 0.86, A0, TURN, 12, '#e8e8e8');
        marks(cv, rx, cy, r * 0.86, A0, TURN, 12, '#ffb0b0');
        const sf = Math.min(1, (s.speedN || 0) / 280);
        hand(cv, lx, cy, A0 + TURN * sf, r * 0.62, '#f4f4f4', Math.max(2, r * 0.04));
        hand(cv, rx, cy, A0 + TURN * frac(look, s), r * 0.62, RED, Math.max(2, r * 0.04));
        speed(cv, lx, cy + r * 0.42, b.h * 0.12, s);
        rpm(cv, rx, cy + r * 0.42, b.h * 0.1, s, '#ffb0b0');
        gear(cv, b.x + b.w * 0.5, b.y + b.h * 0.58, b.h * 0.28, s, look);
    },
    rs(cv, b, s, look) {
        stage(cv, b, '#05070b');
        const cx = b.x + b.w * 0.5;
        const cy = b.y + b.h * 0.92;
        const r = b.h * 0.86;
        track(cv, cx, cy, r * 0.82, r, -78, 156, frac(look, s), '#d7e6ff');
        marks(cv, cx, cy, r * 0.78, -78, 156, 14, '#9eb4d6');
        speed(cv, cx, b.y + b.h * 0.58, b.h * 0.4, s);
        unit(cv, cx, b.y + b.h * 0.74, b.h * 0.07, s, '#8aa0c0');
        gear(cv, b.x + b.w * 0.16, b.y + b.h * 0.48, b.h * 0.24, s, look, '#d7e6ff');
        rpm(cv, b.x + b.w * 0.84, b.y + b.h * 0.48, b.h * 0.12, s, '#8aa0c0');
    },
    mclaren(cv, b, s, look) {
        stage(cv, b, '#090909');
        const f = frac(look, s);
        const x = b.x + b.w * 0.08;
        const y = b.y + b.h * 0.2;
        const w = b.w * 0.84;
        cv.fillRect(x, y, w, Math.max(6, b.h * 0.035), '#2a1408');
        cv.fillRect(x, y, w * Math.min(f, 0.82), Math.max(6, b.h * 0.035), '#ff6a00');
        if (f > 0.82) cv.fillRect(x + w * 0.82, y, w * (f - 0.82), Math.max(6, b.h * 0.035), RED);
        const tip = x + w * f;
        cv.fill([[tip, y - b.h * 0.02], [tip - b.h * 0.03, y + b.h * 0.07], [tip + b.h * 0.03, y + b.h * 0.07]], '#ffd2ad');
        speed(cv, b.x + b.w * 0.4, b.y + b.h * 0.66, b.h * 0.4, s, '#ff8a2a');
        unit(cv, b.x + b.w * 0.4, b.y + b.h * 0.82, b.h * 0.07, s, '#a85a28');
        cv.roundRect(b.x + b.w * 0.7, b.y + b.h * 0.4, b.w * 0.18, b.h * 0.34, b.h * 0.04, '#1a1008');
        gear(cv, b.x + b.w * 0.79, b.y + b.h * 0.64, b.h * 0.22, s, look, '#ff6a00');
    },
    bugatti(cv, b, s, look) {
        stage(cv, b, '#061018');
        const cx = b.x + b.w * 0.46;
        const cy = b.y + b.h * 0.52;
        const r = b.h * 0.42;
        cv.arc(cx, cy, r * 0.78, r, 0, 360, '#0e2438');
        cv.arc(cx, cy, r * 0.82, r * 0.9, 0, 360, '#1d4e74');
        track(cv, cx, cy, r * 0.62, r * 0.72, -130, 260, frac(look, s), '#d6ecff');
        const spin = -130 + 260 * wave(4000);
        cv.arc(cx, cy, r * 0.94, r, spin, spin + 28, withAlpha('#ffffff', 0.55), { round: true });
        speed(cv, cx, cy + b.h * 0.06, b.h * 0.32, s, '#f4fbff');
        unit(cv, cx, cy + b.h * 0.22, b.h * 0.07, s, '#7f9cb8');
        gear(cv, b.x + b.w * 0.84, b.y + b.h * 0.42, b.h * 0.26, s, look, '#d6ecff');
        rpm(cv, b.x + b.w * 0.84, b.y + b.h * 0.64, b.h * 0.1, s, '#7f9cb8');
    },
    gtr(cv, b, s, look) {
        stage(cv, b, '#07080c');
        cv.fillRect(b.x, b.y, Math.max(5, b.w * 0.008), b.h, RED);
        const f = frac(look, s);
        const x = b.x + b.w * 0.08;
        const y = b.y + b.h * 0.22;
        const bh = b.h * 0.5;
        cv.fillRect(x, y, b.w * 0.045, bh, '#1a1c22');
        cv.fillRect(x, y + bh * (1 - f), b.w * 0.045, bh * f, f > 0.82 ? RED : '#f4f7fb');
        rpm(cv, x + b.w * 0.12, b.y + b.h * 0.55, b.h * 0.14, s);
        speed(cv, b.x + b.w * 0.5, b.y + b.h * 0.55, b.h * 0.4, s);
        unit(cv, b.x + b.w * 0.5, b.y + b.h * 0.72, b.h * 0.07, s);
        gear(cv, b.x + b.w * 0.82, b.y + b.h * 0.52, b.h * 0.36, s, look, RED);
    },
    vette(cv, b, s, look) {
        stage(cv, b, '#101114');
        cv.strokeRoundRect(b.x + b.w * 0.04, b.y + b.h * 0.08, b.w * 0.92, b.h * 0.84, 6, 2, '#3a3d44');
        lamps(cv, b.x + b.w * 0.1, b.y + b.h * 0.18, b.w * 0.8, Math.max(8, b.h * 0.07), 14, frac(look, s));
        speed(cv, b.x + b.w * 0.34, b.y + b.h * 0.64, b.h * 0.3, s);
        unit(cv, b.x + b.w * 0.34, b.y + b.h * 0.78, b.h * 0.07, s);
        gear(cv, b.x + b.w * 0.7, b.y + b.h * 0.62, b.h * 0.28, s, look, '#f0c14a');
    },
    typer(cv, b, s, look) {
        stage(cv, b, '#0c0c0e');
        cv.fillRect(b.x, b.y, b.w, Math.max(4, b.h * 0.045), RED);
        lamps(cv, b.x + b.w * 0.08, b.y + b.h * 0.12, b.w * 0.84, Math.max(8, b.h * 0.06), 15, frac(look, s));
        gear(cv, b.x + b.w * 0.22, b.y + b.h * 0.58, b.h * 0.42, s, look, RED);
        speed(cv, b.x + b.w * 0.58, b.y + b.h * 0.52, b.h * 0.32, s);
        unit(cv, b.x + b.w * 0.58, b.y + b.h * 0.68, b.h * 0.07, s);
        rpm(cv, b.x + b.w * 0.82, b.y + b.h * 0.7, b.h * 0.1, s, '#ff8a8a');
    },
    aston(cv, b, s, look) {
        stage(cv, b, '#07110d');
        const r = b.h * 0.34;
        const cy = b.y + b.h * 0.48;
        dial(cv, b.x + b.w * 0.2, cy, r, '#10241c');
        dial(cv, b.x + b.w * 0.8, cy, r, '#10241c');
        marks(cv, b.x + b.w * 0.2, cy, r * 0.86, A0, TURN, 12, '#d7c392');
        marks(cv, b.x + b.w * 0.8, cy, r * 0.86, A0, TURN, 12, '#d7c392');
        hand(cv, b.x + b.w * 0.2, cy, A0 + TURN * frac(look, s), r * 0.62, '#e7d7a8', Math.max(2, r * 0.035));
        hand(cv, b.x + b.w * 0.8, cy, A0 + TURN * Math.min(1, (s.speedN || 0) / 280), r * 0.62, '#e7d7a8', Math.max(2, r * 0.035));
        speed(cv, b.x + b.w * 0.5, b.y + b.h * 0.55, b.h * 0.28, s, '#f3ead4');
        unit(cv, b.x + b.w * 0.5, b.y + b.h * 0.72, b.h * 0.06, s, '#8c7d5e');
        gear(cv, b.x + b.w * 0.5, b.y + b.h * 0.88, b.h * 0.12, s, look, '#d7c392');
    },
    lfa(cv, b, s, look) {
        stage(cv, b, '#080808');
        const cx = b.x + b.w * 0.48;
        const cy = b.y + b.h * 0.95;
        const r = b.h * 0.78;
        marks(cv, cx, cy, r * 0.92, -80, 160, 16, '#ff5a5a', 0.75);
        track(cv, cx, cy, r * 0.78, r * 0.9, -80, 160, frac(look, s), '#ff2a2a');
        hand(cv, cx, cy, -80 + 160 * frac(look, s), r * 0.72, '#ffffff', Math.max(2, b.h * 0.012));
        speed(cv, cx, b.y + b.h * 0.62, b.h * 0.32, s);
        unit(cv, cx, b.y + b.h * 0.76, b.h * 0.06, s);
        gear(cv, b.x + b.w * 0.86, b.y + b.h * 0.4, b.h * 0.24, s, look, '#ff2a2a');
    },
    pagani(cv, b, s, look) {
        stage(cv, b, '#0c0b09');
        const cx = b.x + b.w * 0.4;
        const cy = b.y + b.h * 0.52;
        const r = b.h * 0.44;
        dial(cv, cx, cy, r, '#1a1610');
        marks(cv, cx, cy, r * 0.9, -130, 260, 28, '#e6d3a1', 0.84);
        hand(cv, cx, cy, -130 + 260 * frac(look, s), r * 0.72, '#f3e6c4', Math.max(1.5, r * 0.02));
        speed(cv, cx, cy + r * 0.12, b.h * 0.2, s, '#f8f1df');
        unit(cv, cx, cy + r * 0.32, b.h * 0.06, s, '#a89878');
        gear(cv, b.x + b.w * 0.8, b.y + b.h * 0.52, b.h * 0.3, s, look, '#e6d3a1');
    },
    rimac(cv, b, s, look) {
        stage(cv, b, '#05060a');
        const cx = b.x + b.w * 0.32;
        const cy = b.y + b.h * 0.52;
        const r = b.h * 0.4;
        dial(cv, cx, cy, r, '#07141a');
        track(cv, cx, cy, r * 0.7, r * 0.86, -110, 220, frac(look, s), '#3ee0ff');
        const p = pt(cx, cy, r * 0.78, -110 + 220 * frac(look, s));
        cv.circle(p[0], p[1], Math.max(4, r * 0.06), '#e8fbff');
        rpm(cv, cx, cy + r * 0.15, b.h * 0.12, s, '#3ee0ff');
        speed(cv, b.x + b.w * 0.66, b.y + b.h * 0.55, b.h * 0.4, s, '#e8fbff');
        unit(cv, b.x + b.w * 0.66, b.y + b.h * 0.74, b.h * 0.07, s, '#6aa8b8');
        gear(cv, b.x + b.w * 0.88, b.y + b.h * 0.36, b.h * 0.2, s, look, '#3ee0ff');
    },
    fordgt(cv, b, s, look) {
        stage(cv, b, '#0e1014');
        const f = frac(look, s);
        const y = b.y + b.h * 0.34;
        const h = Math.max(16, b.h * 0.16);
        cv.roundRect(b.x + b.w * 0.06, y, b.w * 0.88, h, h * 0.4, '#2a1210');
        cv.roundRect(b.x + b.w * 0.06, y, b.w * 0.88 * f, h, h * 0.4, f > 0.82 ? '#ff5a4a' : '#ff3b30');
        const glide = wave(1600);
        cv.fillRect(b.x + b.w * (0.06 + 0.8 * glide), y, b.w * 0.04, h, withAlpha('#ffffff', 0.35));
        speed(cv, b.x + b.w * 0.4, b.y + b.h * 0.78, b.h * 0.28, s);
        unit(cv, b.x + b.w * 0.58, b.y + b.h * 0.74, b.h * 0.07, s);
        gear(cv, b.x + b.w * 0.84, b.y + b.h * 0.24, b.h * 0.18, s, look);
    },
    alpine(cv, b, s, look) {
        stage(cv, b, '#071018');
        cv.fillRect(b.x, b.y + b.h * 0.12, Math.max(8, b.w * 0.012), b.h * 0.76, '#2f6bff');
        const cx = b.x + b.w * 0.72;
        const cy = b.y + b.h * 0.5;
        const r = b.h * 0.38;
        dial(cv, cx, cy, r, '#0c1c33');
        marks(cv, cx, cy, r * 0.86, A0, TURN, 12, '#9eb6ff');
        hand(cv, cx, cy, A0 + TURN * frac(look, s), r * 0.62, '#7aa2ff', Math.max(2, r * 0.04));
        speed(cv, b.x + b.w * 0.34, b.y + b.h * 0.55, b.h * 0.4, s);
        unit(cv, b.x + b.w * 0.34, b.y + b.h * 0.74, b.h * 0.07, s, '#6d86b0');
    },
    bentley(cv, b, s, look) {
        stage(cv, b, '#0c1210');
        const r = b.h * 0.32;
        const cy = b.y + b.h * 0.46;
        cv.circle(b.x + b.w * 0.2, cy, r, '#101816');
        cv.circle(b.x + b.w * 0.8, cy, r, '#101816');
        cv.arc(b.x + b.w * 0.2, cy, r * 0.86, r, 0, 360, '#1c2a24');
        cv.arc(b.x + b.w * 0.8, cy, r * 0.86, r, 0, 360, '#1c2a24');
        marks(cv, b.x + b.w * 0.2, cy, r * 0.8, A0, TURN, 10, '#e7d7a8');
        marks(cv, b.x + b.w * 0.8, cy, r * 0.8, A0, TURN, 10, '#e7d7a8');
        hand(cv, b.x + b.w * 0.2, cy, A0 + TURN * frac(look, s), r * 0.58, '#f3ead4', Math.max(1.5, r * 0.03));
        hand(cv, b.x + b.w * 0.8, cy, A0 + TURN * Math.min(1, (s.speedN || 0) / 280), r * 0.58, '#f3ead4', Math.max(1.5, r * 0.03));
        speed(cv, b.x + b.w * 0.5, b.y + b.h * 0.5, b.h * 0.26, s, '#f6f1e4');
        unit(cv, b.x + b.w * 0.5, b.y + b.h * 0.66, b.h * 0.06, s, '#b3a88a');
        gear(cv, b.x + b.w * 0.5, b.y + b.h * 0.84, b.h * 0.12, s, look, '#e7d7a8');
    },
    jesko(cv, b, s, look) {
        stage(cv, b, '#000000');
        const cx = b.x + b.w * 0.48;
        const cy = b.y + b.h * 0.55;
        const r = b.h * 0.46;
        const spin = wave(5000) * 20 - 10;
        marks(cv, cx, cy, r, -100 + spin, 200, 22, '#ff2d2d', 0.8);
        cv.arc(cx, cy, r * 0.72, r * 0.8, -100, 100, withAlpha('#ff2d2d', 0.35), { round: true });
        hand(cv, cx, cy, -100 + 200 * frac(look, s), r * 0.62, '#ffffff', Math.max(2, r * 0.025));
        speed(cv, cx, cy + b.h * 0.08, b.h * 0.34, s);
        unit(cv, cx + b.w * 0.16, cy - b.h * 0.02, b.h * 0.06, s);
        gear(cv, b.x + b.w * 0.14, b.y + b.h * 0.4, b.h * 0.2, s, look, '#ff2d2d');
        rpm(cv, b.x + b.w * 0.86, b.y + b.h * 0.72, b.h * 0.1, s, '#ff2d2d');
    },
    fdial(cv, b, s, look) {
        const cx = b.x + b.w * 0.5;
        const cy = b.y + b.h * 0.5;
        const r = Math.min(b.w, b.h) * 0.49;
        const rpmK = Math.max(0, Math.min(10, (s.rpmN || 0) / 1000));
        const a0 = 184;
        const step = 25.1;
        const needle = a0 + rpmK * step;
        cv.circle(cx, cy, r, '#c8ccd0');
        cv.circle(cx, cy, r * 0.94, '#9aa0a6');
        cv.arc(cx, cy, r * 0.9, r * 0.99, 210, 340, withAlpha('#ffffff', 0.55));
        cv.circle(cx, cy, r * 0.88, '#24282c');
        for (let i = 0; i < 90; i++) {
            const a = i * 4;
            const inner = pt(cx, cy, r * 0.94, a);
            const outer = pt(cx, cy, r * 0.995, a);
            cv.line(inner[0], inner[1], outer[0], outer[1], i % 5 === 0 ? 2 : 1, '#f3f4f5');
        }
        for (let i = 0; i <= 50; i++) {
            const a = a0 + step * 10 * (i / 50);
            const major = i % 5 === 0;
            const inner = pt(cx, cy, r * (major ? 0.79 : 0.825), a);
            const outer = pt(cx, cy, r * 0.88, a);
            cv.line(inner[0], inner[1], outer[0], outer[1], major ? 2.4 : 1.1, i >= 43 ? '#ff2418' : '#f4f4f4');
        }
        cv.circle(cx, cy, r * 0.78, '#f6c400');
        cv.arc(cx, cy, r * 0.62, r * 0.78, 210, 330, withAlpha('#ffe56a', 0.28));
        cv.fill([
            [cx + r * 0.3, cy + r * 0.28],
            [cx + r * 0.74, cy + r * 0.34],
            [cx + r * 0.78, cy + r * 0.62],
            [cx + r * 0.48, cy + r * 0.78],
            [cx + r * 0.14, cy + r * 0.62],
        ], '#16181b');
        for (let n = 0; n <= 10; n++) {
            const p = pt(cx, cy, r * 0.64, a0 + n * step);
            cv.text(String(n), p[0], p[1] + r * 0.04, r * 0.11, '#1a1a1a', { align: 'center', font: 'bold' });
        }
        horse(cv, cx - r * 0.3, cy + r * 0.02, r * 0.2);
        cv.text('rpm x1000', cx - r * 0.06, cy + r * 0.34, r * 0.055, '#3a3420', { align: 'center', font: 'bold' });
        cv.roundRect(cx - r * 0.13, cy - r * 0.56, r * 0.26, r * 0.3, r * 0.03, '#140e0c');
        cv.text(s.gear, cx, cy - r * 0.34, r * 0.16, '#ff3a30', { align: 'center', font: 'num' });
        cv.roundRect(cx + r * 0.16, cy + r * 0.28, r * 0.42, r * 0.28, r * 0.05, '#2a0c0c');
        cv.text(s.speed, cx + r * 0.37, cy + r * 0.48, r * 0.15, '#ff2a22', { align: 'center', font: 'num' });
        const tip = pt(cx, cy, r * 0.72, needle);
        const back = pt(cx, cy, r * 0.1, needle + 180);
        const left = pt(cx, cy, r * 0.012, needle - 90);
        const right = pt(cx, cy, r * 0.012, needle + 90);
        cv.fill([tip, right, back, left], look.blink ? '#ffffff' : '#e10600');
        cv.circle(cx, cy, r * 0.075, '#4a4e52');
        cv.circle(cx, cy, r * 0.055, '#1c1e22');
        cv.arc(cx, cy, r * 0.055, r * 0.075, 200, 340, withAlpha('#ffffff', 0.4));
    },
    m5x(cv, b, s, look) { twinBlack(cv, b, s, look, 'm5'); },
    amgs(cv, b, s, look) { twinBlack(cv, b, s, look, 'amgs'); },
    bmwr(cv, b, s, look) { twinBlack(cv, b, s, look, 'bmwr'); },
    m2x(cv, b, s, look) { twinBlack(cv, b, s, look, 'm2'); },
    wing(cv, b, s, look) { twinBlack(cv, b, s, look, 'wing'); },
    split(cv, b, s, look) { twinBlack(cv, b, s, look, 'split'); },
    pods(cv, b, s, look) { twinBlack(cv, b, s, look, 'pods'); },
    night(cv, b, s, look) { twinBlack(cv, b, s, look, 'night'); },
    amgc(cv, b, s, look) { twinBlack(cv, b, s, look, 'amgc'); },
};

function horse(cv, x, y, s) {
    const c = '#1a140c';
    const p = (px, py) => [x + px * s, y + py * s];
    cv.fill([p(0.32, -0.02), p(0.7, -0.62), p(0.5, -0.7), p(0.22, -0.12)], c);
    cv.fill([
        p(-0.22, -0.18),
        p(0.34, -0.08),
        p(0.3, 0.16),
        p(-0.24, 0.18),
    ], c);
    cv.fill([
        p(-0.16, -0.16),
        p(0.02, -0.78),
        p(-0.16, -0.88),
        p(-0.52, -0.58),
        p(-0.62, -0.36),
        p(-0.34, -0.28),
        p(-0.2, 0.02),
    ], c);
    cv.fill([p(-0.02, -0.74), p(0.02, -1.02), p(0.14, -0.7)], c);
    cv.fill([p(-0.24, 0.02), p(-0.55, -0.18), p(-0.64, 0.02), p(-0.3, 0.14)], c);
    cv.fill([p(-0.12, 0.1), p(-0.18, 0.62), p(-0.02, 0.62), p(0.0, 0.1)], c);
    cv.fill([p(0.08, 0.08), p(0.04, 0.62), p(0.18, 0.62), p(0.2, 0.06)], c);
    cv.fill([p(0.2, 0.02), p(0.26, 0.55), p(0.4, 0.55), p(0.32, 0.0)], c);
}

const SPEED = [0, 50, 100, 150, 200, 250, 300, 350, 400];

function seats(b) {
    const r = b.h * 0.46;
    const cy = b.y + b.h * 0.46;
    return { r: r, cy: cy, lx: b.x + b.w * 0.25, rx: b.x + b.w * 0.75, mx: b.x + b.w * 0.5 };
}

function degOf(v, max, a0, sweep) {
    const t = max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
    return a0 + sweep * t;
}

function bowl(cv, cx, cy, r, chrome, face) {
    cv.circle(cx, cy, r, chrome || '#d7dbe0');
    cv.circle(cx, cy, r * 0.965, '#6e757d');
    cv.circle(cx, cy, r * 0.93, '#16191e');
    cv.circle(cx, cy, r * 0.9, face || '#07080c');
    cv.arc(cx, cy, r * 0.94, r * 0.995, 200, 340, withAlpha('#ffffff', 0.55));
    cv.arc(cx, cy, r * 0.94, r * 0.995, 20, 150, withAlpha('#000000', 0.4));
}

function scale(cv, cx, cy, r, a0, sweep, labels, o) {
    const opt = o || {};
    const ink = opt.ink || '#f4f7fb';
    const fine = opt.fine == null ? 4 : opt.fine;
    const n = labels.length - 1;
    const steps = Math.max(1, n * fine);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = a0 + sweep * t;
        const major = i % fine === 0;
        const inner = pt(cx, cy, r * (major ? (opt.riM == null ? 0.78 : opt.riM) : (opt.ri == null ? 0.84 : opt.ri)), a);
        const outer = pt(cx, cy, r * (opt.ro == null ? 0.92 : opt.ro), a);
        const hot = opt.redAt != null && t >= opt.redAt;
        cv.line(inner[0], inner[1], outer[0], outer[1], major ? 2.6 : 1.1, hot ? '#ff2418' : ink);
    }
    if (opt.redAt != null) {
        cv.arc(cx, cy, r * 0.86, r * 0.93, a0 + sweep * opt.redAt, a0 + sweep, '#ff2418');
    }
    const size = opt.size || r * 0.1;
    for (let i = 0; i <= n; i++) {
        const p = pt(cx, cy, r * (opt.nr == null ? 0.66 : opt.nr), a0 + sweep * (i / n));
        cv.text(String(labels[i]), p[0], p[1] + size * 0.34, size, opt.num || ink, { align: 'center', font: 'bold' });
    }
}

function needle(cv, cx, cy, deg, len, color) {
    const tip = pt(cx, cy, len, deg);
    const tail = pt(cx, cy, len * 0.2, deg + 180);
    const w = Math.max(2.4, len * 0.032);
    const left = pt(cx, cy, w, deg - 90);
    const right = pt(cx, cy, w, deg + 90);
    cv.fill([tip, right, tail, left], color);
    cv.fill([tip, pt(cx, cy, 0.7, deg + 90), tail, pt(cx, cy, 0.7, deg - 90)], withAlpha('#ffffff', 0.55));
    cv.circle(cx, cy, w * 2.1, '#d8dce2');
    cv.circle(cx, cy, w * 1.25, '#121418');
    cv.arc(cx, cy, w * 1.25, w * 2.1, 200, 340, withAlpha('#ffffff', 0.45));
}

function infoBar(cv, b, s) {
    const y = b.y + b.h - 26;
    const x = b.x + b.w * 0.28;
    const w = b.w * 0.44;
    cv.roundRect(x, y, w, 22, 8, '#141820');
    cv.text(hm(), x + 12, y + 16, 13, '#e8eaee', { font: 'num' });
    cv.text(s.oil + ' oil', x + w * 0.5, y + 16, 12, '#c5ced6', { align: 'center', font: 'bold' });
    cv.text('+' + s.coolant + ' C', x + w - 12, y + 16, 13, '#e8eaee', { align: 'right', font: 'num' });
}

function hm() {
    const d = new Date();
    const p = (n) => (n < 10 ? '0' : '') + n;
    return p(d.getHours()) + ':' + p(d.getMinutes());
}

function twinBlack(cv, b, s, look, kind) {
    const g = seats(b);
    const kmh = s.kmh || 0;
    const rpmN = s.rpmN || 0;
    const redN = look.blink ? '#ffffff' : '#e10600';
    stage(cv, b, '#050506');
    if (kind === 'wing') return wingFace(cv, b, s, g, kmh, rpmN, redN);
    if (kind === 'm5') m5Face(cv, b, s, g, kmh, rpmN, redN);
    else if (kind === 'amgs') amgScreen(cv, b, s, g, kmh, rpmN, redN);
    else if (kind === 'bmwr') roundFace(cv, b, s, g, kmh, rpmN, redN);
    else if (kind === 'm2') m2Face(cv, b, s, g, kmh, rpmN, redN);
    else if (kind === 'split') splitFace(cv, b, s, g, kmh, rpmN, redN);
    else if (kind === 'pods') podsFace(cv, b, s, g, kmh, rpmN, redN);
    else if (kind === 'night') nightFace(cv, b, s, g, kmh, rpmN, redN);
    else amgCarbon(cv, b, s, g, kmh, rpmN, redN);
}

function m5Face(cv, b, s, g, kmh, rpmN, redN) {
    const r = b.h * 0.44;
    const cy = b.y + b.h * 0.42;
    const mx = b.x + b.w * 0.5;
    const lx = mx - r * 1.48;
    const rx = mx + r * 1.48;
    const spd = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
    const rpm = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const sa = 206;
    const ss = 274;
    const ta = 218;
    const ts = 246;
    bowl(cv, lx, cy, r, '#2a2e34', '#04060a');
    bowl(cv, rx, cy, r, '#2a2e34', '#04060a');
    scale(cv, lx, cy, r, sa, ss, spd, { size: r * 0.095, nr: 0.72, fine: 5, ro: 0.93, ri: 0.86, riM: 0.78 });
    for (let i = 0; i <= 44; i++) {
        const a = sa + ss * (i / 44);
        const major = i % 4 === 0;
        const inner = pt(lx, cy, r * (major ? 0.46 : 0.5), a);
        const outer = pt(lx, cy, r * 0.54, a);
        cv.line(inner[0], inner[1], outer[0], outer[1], major ? 1.6 : 1, '#f4f7fb');
    }
    cv.circle(lx, cy, r * 0.16, '#14181e');
    cv.text('km/h', lx, cy - r * 0.05, r * 0.055, '#d0d6dc', { align: 'center', font: 'bold' });
    cv.text('0', lx - r * 0.22, cy + r * 0.02, r * 0.07, '#f7f8fa', { align: 'center', font: 'bold' });
    scale(cv, rx, cy, r, ta, ts, rpm, { size: r * 0.13, nr: 0.7, fine: 4, redAt: 0.86, ro: 0.93, ri: 0.86, riM: 0.78 });
    cv.text('1/min x 1000', rx - r * 0.28, cy + r * 0.08, r * 0.045, '#9aa3ad', { align: 'center', font: 'bold' });
    stripes(cv, rx - r * 0.22, cy - r * 0.16, r * 0.16, r * 0.045);
    cv.text('M5', rx + r * 0.1, cy - r * 0.12, r * 0.12, '#f7f8fa', { align: 'center', font: 'bold' });
    cv.text('READY', rx + r * 0.02, cy + r * 0.08, r * 0.055, '#f4f7fb', { align: 'center', font: 'bold' });
    needle(cv, lx, cy, degOf(kmh, 330, sa, ss), r * 0.78, redN);
    needle(cv, rx, cy, degOf(rpmN, 8000, ta, ts), r * 0.76, redN);
    const sports = [-r * 0.55, 0, r * 0.55];
    for (let i = 0; i < sports.length; i++) {
        const sx = mx + sports[i];
        cv.circle(sx, b.y + 18, 7, '#c5ced6');
        cv.circle(sx, b.y + 18, 4, '#05060a');
        cv.text('Sport', sx, b.y + 36, r * 0.055, '#e8eaee', { align: 'center', font: 'bold' });
    }
    cv.text('MDM', mx, b.y + 56, r * 0.07, '#f7f8fa', { align: 'center', font: 'bold' });
    cv.text('4WD Sport', mx, b.y + 74, r * 0.055, '#f7f8fa', { align: 'center', font: 'bold' });
    cv.text(s.gear, mx, cy + r * 0.06, r * 0.34, '#f7f8fa', { align: 'center', font: 'num' });
    cv.fill([
        [mx - r * 0.38, cy + r * 0.22],
        [mx, cy + r * 0.38],
        [mx + r * 0.38, cy + r * 0.22],
        [mx + r * 0.26, cy + r * 0.22],
        [mx, cy + r * 0.3],
        [mx - r * 0.26, cy + r * 0.22],
    ], '#ff1e1e');
    const barY = b.y + b.h - 24;
    const barX = mx - r * 1.15;
    const barW = r * 2.3;
    cv.roundRect(barX, barY, barW, 20, 8, '#12161c');
    cv.text(hm(), barX + 12, barY + 15, 12, '#e8eaee', { font: 'num' });
    cv.text('TRIP ' + (s.trip || '0.0') + ' km', mx, barY + 15, 12, '#e8eaee', { align: 'center', font: 'bold' });
    cv.text('+' + s.coolant + ' C', barX + barW - 12, barY + 15, 12, '#e8eaee', { align: 'right', font: 'num' });
}

function amgScreen(cv, b, s, g, kmh, rpmN, redN) {
    const rpm = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    bowl(cv, g.lx, g.cy, g.r, '#e4e7eb', '#1c2026');
    bowl(cv, g.rx, g.cy, g.r, '#e4e7eb', '#1c2026');
    scale(cv, g.lx, g.cy, g.r, 212, 276, SPEED, { size: g.r * 0.07, nr: 0.7, fine: 4, redAt: 0.85 });
    scale(cv, g.rx, g.cy, g.r, 206, 268, rpm, { size: g.r * 0.11, nr: 0.68, fine: 4, redAt: 0.74 });
    cv.text('km/h', g.lx, g.cy + g.r * 0.28, g.r * 0.06, '#c5ced6', { align: 'center', font: 'bold' });
    cv.text('1/min x 1000', g.rx, g.cy + g.r * 0.32, g.r * 0.05, '#c5ced6', { align: 'center', font: 'bold' });
    needle(cv, g.lx, g.cy, degOf(kmh, 400, 212, 276), g.r * 0.78, redN);
    needle(cv, g.rx, g.cy, degOf(rpmN, 9000, 206, 268), g.r * 0.76, redN);
    lamps(cv, g.mx - g.r * 0.42, b.y + 10, g.r * 0.84, 12, 8, Math.min(1, rpmN / 7000));
    cv.text('AMG', g.mx, b.y + 40, g.r * 0.09, '#f7f8fa', { align: 'center', font: 'bold' });
    const px = g.mx - g.r * 0.58;
    const py = g.cy - g.r * 0.48;
    const pw = g.r * 1.16;
    const ph = g.r * 1.05;
    cv.roundRect(px, py, pw, ph, 6, '#101318');
    cv.strokeRoundRect(px, py, pw, ph, 6, 1, '#3a414a');
    const gears = ['1', '2', '3', '4', '5', '6', '7'];
    for (let i = 0; i < gears.length; i++) {
        const gx = px + 16 + i * (pw - 32) / 6;
        const on = s.gear === gears[i];
        if (on) cv.roundRect(gx - 10, py + 10, 20, 18, 3, '#f4f6f8');
        cv.text(gears[i], gx, py + 24, g.r * 0.07, on ? '#101318' : '#d0d4d8', { align: 'center', font: 'bold' });
    }
    cv.text('M', px + pw - 18, py + 24, g.r * 0.06, '#f4f6f8', { align: 'center', font: 'bold' });
    cv.text(s.speed, g.mx, py + ph * 0.58, g.r * 0.26, '#f7f8fa', { align: 'center', font: 'num' });
    cv.text(s.unit, g.mx, py + ph * 0.7, g.r * 0.06, '#9aa3ad', { align: 'center', font: 'bold' });
    cv.text(s.oil + ' C', g.mx - g.r * 0.24, py + ph * 0.88, g.r * 0.07, '#e8eaee', { align: 'center', font: 'num' });
    cv.text(s.coolant + ' C', g.mx + g.r * 0.24, py + ph * 0.88, g.r * 0.07, '#e8eaee', { align: 'center', font: 'num' });
}

function roundFace(cv, b, s, g, kmh, rpmN, redN) {
    const rpm = [0, 1, 2, 3, 4, 5, 6, 7];
    bowl(cv, g.lx, g.cy, g.r, '#f2f4f6', '#121418');
    bowl(cv, g.rx, g.cy, g.r, '#f2f4f6', '#121418');
    scale(cv, g.lx, g.cy, g.r, 205, 265, SPEED, { size: g.r * 0.07, nr: 0.7, fine: 4 });
    scale(cv, g.rx, g.cy, g.r, 214, 248, rpm, { size: g.r * 0.12, nr: 0.68, fine: 4, redAt: 0.78 });
    cv.text('km/h', g.lx, g.cy + g.r * 0.16, g.r * 0.055, '#d0d4d8', { align: 'center', font: 'bold' });
    cv.text('1/min x 1000', g.rx, g.cy - g.r * 0.38, g.r * 0.05, '#d0d4d8', { align: 'center', font: 'bold' });
    cv.roundRect(g.rx - g.r * 0.12, g.cy + g.r * 0.16, g.r * 0.24, g.r * 0.2, 3, '#0c0e12');
    cv.strokeRoundRect(g.rx - g.r * 0.12, g.cy + g.r * 0.16, g.r * 0.24, g.r * 0.2, 3, 1, '#f4f7fb');
    cv.text(s.gear, g.rx, g.cy + g.r * 0.32, g.r * 0.12, '#f7f8fa', { align: 'center', font: 'num' });
    needle(cv, g.lx, g.cy, degOf(kmh, 400, 205, 265), g.r * 0.72, '#f7f8fa');
    needle(cv, g.rx, g.cy, degOf(rpmN, 7000, 214, 248), g.r * 0.74, '#f7f8fa');
    pod(cv, b.x + g.r * 0.36, g.cy + g.r * 0.15, g.r * 0.28, '1/2', 0.55, '#e8eaee');
    pod(cv, b.x + b.w - g.r * 0.36, g.cy + g.r * 0.15, g.r * 0.28, 'C', 0.5, '#e8eaee');
    cv.text('+' + s.coolant + ' C', g.mx, g.cy + g.r * 0.08, g.r * 0.08, '#f7f8fa', { align: 'center', font: 'bold' });
}

function m2Face(cv, b, s, g, kmh, rpmN, redN) {
    const rpm = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    bowl(cv, g.lx, g.cy, g.r, '#1a1e24', '#05060a');
    bowl(cv, g.rx, g.cy, g.r, '#1a1e24', '#05060a');
    scale(cv, g.lx, g.cy, g.r, 210, 285, SPEED, { size: g.r * 0.075, nr: 0.7, fine: 4, ro: 0.94 });
    scale(cv, g.rx, g.cy, g.r, 206, 268, rpm, { size: g.r * 0.12, nr: 0.68, fine: 4, redAt: 0.84 });
    cv.text('km/h', g.lx, g.cy + g.r * 0.34, g.r * 0.06, '#d0d4d8', { align: 'center', font: 'bold' });
    stripes(cv, g.rx - g.r * 0.22, g.cy - g.r * 0.16, g.r * 0.16, g.r * 0.05);
    cv.text('M2', g.rx + g.r * 0.06, g.cy - g.r * 0.1, g.r * 0.14, '#f7f8fa', { align: 'center', font: 'bold' });
    cv.text('1/min x 1000', g.rx, g.cy + g.r * 0.36, g.r * 0.05, '#c5ced6', { align: 'center', font: 'bold' });
    pod(cv, g.lx, g.cy + g.r * 0.42, g.r * 0.2, '1/2', 0.5, '#3a414a');
    needle(cv, g.lx, g.cy, degOf(kmh, 400, 210, 285), g.r * 0.8, redN);
    needle(cv, g.rx, g.cy, degOf(rpmN, 8000, 206, 268), g.r * 0.78, redN);
    cv.text('+' + s.coolant + ' C', g.mx, g.cy - g.r * 0.05, g.r * 0.08, '#f7f8fa', { align: 'center', font: 'bold' });
    const bx = g.mx - g.r * 0.42;
    const by = g.cy + g.r * 0.18;
    cv.roundRect(bx, by, g.r * 0.84, 10, 4, '#3a1010');
    cv.roundRect(bx, by, g.r * 0.84 * Math.min(1, kmh / 200), 10, 4, '#ff2418');
    cv.text('0', bx, by + 22, 11, '#ff6a60', { font: 'bold' });
    cv.text('30', bx + g.r * 0.84, by + 22, 11, '#ff6a60', { align: 'right', font: 'bold' });
    cv.text(hm(), b.x + b.w - 18, b.y + b.h - 12, 14, '#f4f7fb', { align: 'right', font: 'num' });
}

function wingFace(cv, b, s, g, kmh, rpmN, redN) {
    const r = g.r * 1.05;
    cv.fill([
        [b.x + 8, g.cy - r * 0.85],
        [g.mx - r * 1.15, g.cy - r * 0.2],
        [g.mx - r * 1.15, g.cy + r * 0.2],
        [b.x + 8, g.cy + r * 0.85],
    ], '#141820');
    cv.fill([
        [b.x + b.w - 8, g.cy - r * 0.85],
        [g.mx + r * 1.15, g.cy - r * 0.2],
        [g.mx + r * 1.15, g.cy + r * 0.2],
        [b.x + b.w - 8, g.cy + r * 0.85],
    ], '#141820');
    cv.text('0.0', b.x + b.w * 0.08, g.cy - r * 0.05, r * 0.16, '#f7f8fa', { align: 'center', font: 'num' });
    cv.text('L/100km', b.x + b.w * 0.08, g.cy + r * 0.16, r * 0.06, '#9aa3ad', { align: 'center', font: 'bold' });
    cv.text((rpmN / 1000).toFixed(1), b.x + b.w * 0.92, g.cy - r * 0.05, r * 0.16, '#f7f8fa', { align: 'center', font: 'num' });
    cv.text('x1000 r/min', b.x + b.w * 0.92, g.cy + r * 0.16, r * 0.06, '#9aa3ad', { align: 'center', font: 'bold' });
    bowl(cv, g.mx, g.cy, r, '#d5d8dc', '#101318');
    scale(cv, g.mx, g.cy, r, 205, 280, SPEED, { size: r * 0.075, nr: 0.7, fine: 4 });
    cv.text(s.gear, g.mx, g.cy + r * 0.18, r * 0.2, '#f7f8fa', { align: 'center', font: 'num' });
    cv.text('km/h', g.mx, g.cy + r * 0.36, r * 0.06, '#9aa3ad', { align: 'center', font: 'bold' });
    needle(cv, g.mx, g.cy, degOf(kmh, 400, 205, 280), r * 0.72, redN);
}

function splitFace(cv, b, s, g, kmh, rpmN, redN) {
    const rpm = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    bowl(cv, g.lx, g.cy, g.r, '#c5c9ce', '#121418');
    bowl(cv, g.rx, g.cy, g.r, '#c5c9ce', '#121418');
    cv.circle(g.lx, g.cy, g.r * 0.55, '#1a1e24');
    cv.circle(g.rx, g.cy, g.r * 0.55, '#1a1e24');
    scale(cv, g.lx, g.cy, g.r, 208, 274, SPEED, { size: g.r * 0.075, nr: 0.72, fine: 4 });
    scale(cv, g.rx, g.cy, g.r, 208, 260, rpm, { size: g.r * 0.12, nr: 0.7, fine: 4, redAt: 0.8 });
    cv.text('km/h', g.lx, g.cy + g.r * 0.22, g.r * 0.06, '#c5ced6', { align: 'center', font: 'bold' });
    cv.text('x1000 r/min', g.rx, g.cy + g.r * 0.28, g.r * 0.05, '#c5ced6', { align: 'center', font: 'bold' });
    needle(cv, g.lx, g.cy, degOf(kmh, 400, 208, 274), g.r * 0.7, '#f4f7fb');
    needle(cv, g.rx, g.cy, degOf(rpmN, 8000, 208, 260), g.r * 0.68, '#f4f7fb');
    cv.roundRect(g.mx - g.r * 0.28, g.cy + g.r * 0.42, g.r * 0.56, g.r * 0.26, 8, '#101318');
    cv.text(s.gear, g.mx, g.cy + g.r * 0.62, g.r * 0.16, '#7eb6ff', { align: 'center', font: 'num' });
}

function podsFace(cv, b, s, g, kmh, rpmN, redN) {
    const rpm = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const rr = g.r * 0.9;
    bowl(cv, g.lx, g.cy, rr, '#e8eaee', '#121418');
    bowl(cv, g.rx, g.cy, rr, '#e8eaee', '#121418');
    scale(cv, g.lx, g.cy, rr, 206, 272, SPEED, { size: rr * 0.07, nr: 0.7, fine: 4 });
    scale(cv, g.rx, g.cy, rr, 206, 258, rpm, { size: rr * 0.11, nr: 0.68, fine: 4, redAt: 0.78 });
    needle(cv, g.lx, g.cy, degOf(kmh, 400, 206, 272), rr * 0.72, '#f7f8fa');
    needle(cv, g.rx, g.cy, degOf(rpmN, 8000, 206, 258), rr * 0.7, '#f7f8fa');
    pod(cv, b.x + rr * 0.34, g.cy - rr * 0.62, rr * 0.26, 'F', 0.4, '#e8eaee');
    pod(cv, b.x + rr * 0.34, g.cy + rr * 0.62, rr * 0.26, 'E', 0.65, '#e8eaee');
    pod(cv, b.x + b.w - rr * 0.34, g.cy - rr * 0.62, rr * 0.26, 'C', 0.45, '#e8eaee');
    pod(cv, b.x + b.w - rr * 0.34, g.cy + rr * 0.62, rr * 0.26, 'H', 0.55, '#e8eaee');
    cv.text(s.gear, g.mx, g.cy + rr * 0.08, rr * 0.22, '#7eb6ff', { align: 'center', font: 'num' });
    cv.text(s.coolant + ' C', g.mx, g.cy + rr * 0.32, rr * 0.07, '#d0d4d8', { align: 'center', font: 'bold' });
}

function nightFace(cv, b, s, g, kmh, rpmN, redN) {
    const rpm = [0, 1, 2, 3, 4, 5, 6, 7];
    const ink = '#ff9a3a';
    const ring = '#3ad4ff';
    bowl(cv, g.lx, g.cy, g.r, ring, '#05060c');
    bowl(cv, g.rx, g.cy, g.r, ring, '#05060c');
    scale(cv, g.lx, g.cy, g.r, 208, 262, SPEED, { size: g.r * 0.065, nr: 0.7, ink: ink, num: ink, fine: 4 });
    scale(cv, g.rx, g.cy, g.r, 210, 250, rpm, { size: g.r * 0.11, nr: 0.68, ink: ink, num: ink, fine: 4, redAt: 0.82 });
    cv.arc(g.lx, g.cy, g.r * 0.86, g.r * 0.93, 130, 210, '#ff2418');
    cv.arc(g.rx, g.cy, g.r * 0.86, g.r * 0.93, 110, 190, '#ff2418');
    cv.text('km/h', g.lx, g.cy + g.r * 0.18, g.r * 0.05, '#f4f7fb', { align: 'center', font: 'bold' });
    cv.text('1/min x 1000', g.rx, g.cy - g.r * 0.36, g.r * 0.05, ink, { align: 'center', font: 'bold' });
    needle(cv, g.lx, g.cy, degOf(kmh, 400, 208, 262), g.r * 0.72, ink);
    needle(cv, g.rx, g.cy, degOf(rpmN, 7000, 210, 250), g.r * 0.74, ink);
    cv.text('PARK', g.mx, g.cy - g.r * 0.22, g.r * 0.08, '#ffe14a', { align: 'center', font: 'bold' });
    cv.text(s.gear, g.mx, g.cy + g.r * 0.08, g.r * 0.22, '#7eb6ff', { align: 'center', font: 'num' });
    pod(cv, b.x + g.r * 0.34, g.cy, g.r * 0.28, 'E', 0.4, ring);
    pod(cv, b.x + b.w - g.r * 0.34, g.cy, g.r * 0.28, 'H', Math.max(0.2, Math.min(1, Number(s.coolant) / 120)), ring);
    cv.text(hm(), b.x + 16, b.y + b.h - 12, 14, ink, { font: 'num' });
    cv.text('+' + s.coolant + ' C', b.x + b.w - 16, b.y + b.h - 12, 14, ink, { align: 'right', font: 'num' });
}

function amgCarbon(cv, b, s, g, kmh, rpmN, redN) {
    const rpm = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    bowl(cv, g.lx, g.cy, g.r, '#f0f2f4', '#16181c');
    bowl(cv, g.rx, g.cy, g.r, '#f0f2f4', '#16181c');
    cv.circle(g.lx, g.cy, g.r * 0.46, '#2a2e33');
    cv.circle(g.lx, g.cy, g.r * 0.38, '#1a1e22');
    cv.circle(g.rx, g.cy, g.r * 0.46, '#2a2e33');
    cv.circle(g.rx, g.cy, g.r * 0.38, '#1a1e22');
    scale(cv, g.lx, g.cy, g.r, 208, 270, SPEED, { size: g.r * 0.07, nr: 0.72, fine: 4 });
    scale(cv, g.rx, g.cy, g.r, 200, 270, rpm, { size: g.r * 0.11, nr: 0.72, fine: 4, redAt: 0.72 });
    cv.text('AMG', g.rx, g.cy - g.r * 0.52, g.r * 0.06, '#f7f8fa', { align: 'center', font: 'bold' });
    pod(cv, g.lx, g.cy + g.r * 0.55, g.r * 0.22, 'F', 0.5, '#d8dce2');
    pod(cv, g.rx, g.cy + g.r * 0.55, g.r * 0.22, 'C', Math.max(0.2, Math.min(1, Number(s.coolant) / 120)), '#d8dce2');
    needle(cv, g.lx, g.cy, degOf(kmh, 400, 208, 270), g.r * 0.7, '#f7f8fa');
    needle(cv, g.rx, g.cy, degOf(rpmN, 8000, 200, 270), g.r * 0.6, redN);
    const letters = ['P', 'R', 'N', 'D'];
    const bw = g.r * 0.22;
    const bx = g.mx - bw * 2;
    cv.roundRect(bx - 6, b.y + 12, bw * 4 + 12, g.r * 0.2, 4, '#0c0e12');
    cv.strokeRoundRect(bx - 6, b.y + 12, bw * 4 + 12, g.r * 0.2, 4, 1, '#d8dce2');
    for (let i = 0; i < letters.length; i++) {
        const on = s.gear === letters[i] || (letters[i] === 'D' && s.gear >= '1' && s.gear <= '8');
        cv.text(letters[i], bx + bw * i + bw * 0.5, b.y + 12 + g.r * 0.15, g.r * 0.08, on ? '#3dd68c' : '#9aa3ad', { align: 'center', font: 'bold' });
    }
    cv.roundRect(g.mx - g.r * 0.38, g.cy - g.r * 0.22, g.r * 0.76, g.r * 0.62, 6, '#101318');
    cv.text(s.speed, g.mx, g.cy + g.r * 0.02, g.r * 0.22, '#f7f8fa', { align: 'center', font: 'num' });
    cv.text(s.unit, g.mx, g.cy + g.r * 0.2, g.r * 0.06, '#9aa3ad', { align: 'center', font: 'bold' });
    cv.text(hm() + '   ' + s.coolant + ' C', g.mx, g.cy + g.r * 0.34, g.r * 0.055, '#d0d4d8', { align: 'center', font: 'bold' });
}

function pod(cv, cx, cy, r, label, frac, metal) {
    cv.circle(cx, cy, r, metal || '#c5c9ce');
    cv.circle(cx, cy, r * 0.78, '#101216');
    cv.arc(cx, cy, r * 0.5, r * 0.7, 140, 140 + 240 * Math.max(0, Math.min(1, frac)), '#ff2418');
    cv.text(label, cx, cy + r * 0.12, r * 0.5, '#f4f6f8', { align: 'center', font: 'bold' });
}

function drawCluster(cv, area, id, s, look) {
    const b = { x: area.nx, y: area.ny, w: area.nw, h: area.nh, blink: !!look.blink };
    const fn = DRAW[id];
    if (fn) fn(cv, b, s, look);
}

module.exports = { STYLES, drawCluster };
