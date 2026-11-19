'use strict';
/**
 * The question for Nastya.
 * The cluster carries the words. The glass carries the question only after OK.
 */
const { withAlpha } = require('./kit/canvas');

const INK = '#fff6ea';
const GOLD = '#e8c27a';
const ROSE = '#e23d5b';
const NIGHT = '#14080d';

function heart(cv, cx, cy, size, color) {
    const k = size / 16;
    const pts = [];
    for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push([cx + x * k, cy - y * k]);
    }
    cv.fill(pts, color);
}

function wrap(cv, text, size, maxW) {
    const words = String(text).split(' ');
    const lines = [];
    let cur = '';
    for (let i = 0; i < words.length; i++) {
        const next = cur ? cur + ' ' + words[i] : words[i];
        if (cur && cv.textWidth(next, size, { font: 'label', literal: true }) > maxW) {
            lines.push(cur);
            cur = words[i];
        } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
}

function fit(cv, text, maxW, maxSize) {
    let size = maxSize;
    while (size > 14 && cv.textWidth(text, size, { font: 'label', literal: true }) > maxW) size -= 2;
    return size;
}

function cluster(cv, area, phase, shift) {
    const x = area.nx;
    const y = area.ny;
    const w = area.nw;
    const h = area.nh;
    const slide = Math.max(0, Math.min(w * 0.42, Number(shift) || 0));
    const span = w - slide;
    const cx = x + slide + span / 2;
    cv.fillRect(x, y, w, h, NIGHT);
    cv.strokeRoundRect(x + 10, y + 10, w - 20, h - 20, 16, 2, GOLD);
    const pulse = 0.9 + 0.1 * Math.sin(Date.now() / 320);
    heart(cv, cx, y + h * 0.22, Math.min(w, h) * 0.08 * pulse, ROSE);
    if (phase < 3) {
        const hello = 'Привет, Кисун';
        const helloSize = fit(cv, hello, span * 0.9, Math.min(52, h * 0.14));
        cv.text(hello, cx, y + h * 0.42, helloSize, GOLD, { align: 'center', font: 'label', literal: true });
        const lines = [
            'Это я, твой Кисун) У меня к тебе есть вопрос)',
            'Чтобы я мог тебе его задать, нажми OK на мониторе)',
        ];
        let size = Math.min(28, h * 0.07);
        for (let n = 0; n < lines.length; n++) size = Math.min(size, fit(cv, lines[n], span * 0.92, size));
        const top = y + h * 0.58;
        for (let i = 0; i < lines.length; i++) {
            cv.text(lines[i], cx, top + i * (size + 10), size, INK, { align: 'center', font: 'label', literal: true });
        }
        return;
    }
    const line = 'Посмотри на проекцию';
    const size = fit(cv, line, span * 0.9, Math.min(52, h * 0.16));
    cv.text(line, cx, y + h * 0.58, size, INK, { align: 'center', font: 'label', literal: true });
    const ay = y + h * 0.78;
    cv.line(cx, ay + 18, cx, ay - 16, 3, GOLD);
    cv.line(cx, ay - 16, cx - 14, ay, 3, GOLD);
    cv.line(cx, ay - 16, cx + 14, ay, 3, GOLD);
}

function glass(cv, area) {
    const x = area.nx;
    const y = area.ny;
    const w = area.nw;
    const h = area.nh;
    const cx = x + w / 2;
    const pulse = 0.88 + 0.12 * Math.sin(Date.now() / 260);
    const glow = 0.35 + 0.25 * Math.sin(Date.now() / 260);
    heart(cv, cx, y + h * 0.26, Math.min(w, h) * 0.16 * pulse, withAlpha(ROSE, glow));
    heart(cv, cx, y + h * 0.26, Math.min(w, h) * 0.12 * pulse, ROSE);
    const lines = ['Я тебя люблю.', 'Ты станешь моей женой?'];
    let size = Math.min(32, h * 0.18);
    for (let i = 0; i < lines.length; i++) size = Math.min(size, fit(cv, lines[i], w * 0.94, size));
    const top = y + h * 0.62;
    for (let i = 0; i < lines.length; i++) {
        cv.text(lines[i], cx, top + i * (size + 6), size, INK, { align: 'center', font: 'label', literal: true });
    }
}

module.exports = { cluster: cluster, glass: glass };
