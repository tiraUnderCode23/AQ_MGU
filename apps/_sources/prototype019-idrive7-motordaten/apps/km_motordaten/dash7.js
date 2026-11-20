'use strict';
/**
 * iD7: the live page in the page's own pixels (1600 x 520, the kit's visible part
 * VIS), larger than the iD8 page scaled down (dash.js is 2880 wide for the M2's
 * 14.9" screen; on the G20's 10.25" everything came out at about half size, field
 * photo 17.11.2026). Fewer things side by side, larger numbers:
 *
 *   row 1  engine speed band, engine speed
 *   row 2  oil temperature, boost, oil pressure (large)
 *   row 3  coolant, gearbox oil, intake, exhaust, power, torque, knock, battery
 *   row 4  Aufnehmen, Reset, Max Cooling, Klappe (the last two with MHD)
 *
 * The tab rail stays dash.js's (drawn scaled, as on every other page, by main.js).
 * Colours, strips and limits are dash.js's. live(rec, v, cfg, ui, extra, box) draws;
 * targets(extra, box) lists the buttons in controller order; box = { x0, x1 } is where
 * the content goes (right of the rail).
 */
const D = require('./dash.js');
const L = require('./limits.js');

const C = D.C;
const isNum = (v) => typeof v === 'number' && isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const de = D.de;

const TOP = 46;                 // VIS starts at 38
const BTN_Y = 432;
const BTN_H = 58;
const FLAP_WORD = { AUTO: 'Auto', OPEN: 'Auf', CLOSED: 'Zu' };

/* The buttons of row 4, left to right (controller order). */
function targets(extra, box) {
    const out = [];
    let x = box.x0;
    const add = (t) => { out.push(Object.assign({ y: BTN_Y, h: BTN_H }, t, { x })); x += t.w + 20; };
    const rec = extra && extra.recording;
    const s = rec ? Math.floor(rec.ms / 1000) : 0;
    add({ id: 'record', w: 230, label: rec ? `Stopp ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'Aufnehmen', live: !!rec });
    add({ id: 'reset', w: 170, label: 'Reset' });
    const c = extra && extra.cooling;
    if (c) {
        add({ id: c.confirm ? 'cooling!' : 'cooling', w: 270, danger: !!c.confirm, on: c.state === 'ON',
            label: c.note ? c.note : c.busy ? 'Sende …' : c.confirm ? 'Wirklich an?' : c.state === 'ON' ? 'Max Cooling an' : 'Max Cooling' });
    }
    const f = extra && extra.flap;
    if (f) {
        add({ id: 'flap', w: 270, on: f.state !== 'AUTO',
            label: f.note ? f.note : f.busy ? 'Sende …' : `Klappe: ${FLAP_WORD[f.state] || '?'}${f.paused ? ' (Auto)' : ''}` });
    }
    return out;
}

/* The engine speed band across, the speed at the right. */
function rpmRow(rec, v, cfg, box) {
    const x = box.x0;
    const w = box.x1 - box.x0 - 330;
    const y = TOP + 4;
    const h = 26;
    const max = D.RPM_MAX;
    const red = cfg.rpmRed;
    rec.roundRect(x, y, w, h, 4, C.line);
    rec.fillRect(x + w * red / max, y, w * (max - red) / max, h, C.redzone);
    const bar = isNum(v.rpmBar) ? v.rpmBar : v.rpm;
    if (isNum(bar) && bar > 0) {
        rec.fillRect(x, y, w * clamp(bar, 0, max) / max, h, isNum(v.rpm) && v.rpm >= red ? C.limit : C.text);
    }
    for (let k = 0; k <= 7; k++) {
        rec.text(String(k), x + w * k * 1000 / max, y + h + 24, 18, C.dim, { font: 'scale', align: k ? 'center' : 'left' });
    }
    const hot = isNum(v.rpm) && v.rpm >= red;
    D.valueUnit(rec, isNum(v.rpm) ? D.thousands(v.rpm) : '–', 'U/min', box.x1, TOP + 56, 70, hot ? C.limit : C.text, 24, 'right');
    if (isNum(v.rpmPeak) && v.rpmPeak > 0) {
        rec.text(`Spitze ${D.thousands(v.rpmPeak)}`, box.x1, TOP + 80, 18, C.ice, { font: 'scale', align: 'right' });
    }
}

/* One of the three large tiles: label, value, unit; returns nothing. */
function big(rec, x, label, text, unit, color, labelColor) {
    rec.text(label, x, TOP + 108, 24, labelColor || C.dim, { font: 'label' });
    D.valueUnit(rec, text, unit, x, TOP + 196, 104, color, 28, 'left');
}

function bar(rec, x, y, w, h, frac, color, zoneFrom) {
    rec.roundRect(x, y, w, h, 5, C.line);
    if (isNum(zoneFrom) && zoneFrom < 1) {
        rec.roundRect(x + w * clamp(zoneFrom, 0, 1), y, w * (1 - clamp(zoneFrom, 0, 1)), h, 5, C.redzone);
    }
    if (isNum(frac) && frac > 0) {
        rec.roundRect(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, 5, color);
    }
}

/* Ready for full load, small under the oil's bar: "Bereit", or "Warmfahren" and what is still missing. */
function ready(rec, x, y, v, cfg, w) {
    const r = L.readiness(cfg, v);
    if (!r.on) return;
    const h = 30;
    if (r.ready) {
        const bw = rec.textWidth('Bereit', 20, { font: 'label' }) + 40;
        rec.roundRect(x, y, bw, h, h / 2, C.text);
        rec.text('Bereit', x + bw / 2, y + h / 2 + 7, 20, C.asphalt, { font: 'label', align: 'center' });
        return;
    }
    const bw = rec.textWidth('Warmfahren', 19, { font: 'label' }) + 32;
    rec.strokeRoundRect(x, y, bw, h, h / 2, 2, C.cold);
    rec.text('Warmfahren', x + bw / 2, y + h / 2 + 7, 19, C.cold, { font: 'label', align: 'center' });
    let ix = x + bw + 16;
    r.items.forEach((it) => {
        const nw = rec.textWidth(it.short, 19, { font: 'label' });
        if (ix + nw > x + w) return;
        rec.text(it.short, ix, y + h / 2 + 7, 19, it.reached ? C.ok : C.limit, { font: 'label' });
        ix += nw + 18;
    });
}

function tiles(rec, v, cfg, box) {
    const gap = 48;
    const tw = (box.x1 - box.x0 - 2 * gap) / 3;
    const bx = (i) => box.x0 + i * (tw + gap);
    const barY = TOP + 210;

    // oil temperature: blue while cold, white once ready, red at its limit
    const oil = v.oil;
    const readyAt = cfg.oilReady;
    const hotOil = isNum(oil) && oil >= cfg.oilMax;
    const warm = isNum(oil) ? clamp((oil - 20) / (readyAt - 20), 0, 1) : 0;
    const oilColor = !isNum(oil) ? C.dim : hotOil ? C.limit : oil >= readyAt ? C.text : D.mix(C.cold, C.text, warm * 0.6);
    big(rec, bx(0), 'Öltemperatur', isNum(oil) ? String(Math.round(oil)) : '–', '°C', oilColor, hotOil ? C.limit : null);
    bar(rec, bx(0), barY, tw, 16, isNum(oil) ? oil / D.OIL_MAX : null, oilColor, cfg.oilMax / D.OIL_MAX);
    ready(rec, bx(0), barY + 26, v, cfg, tw);

    // boost, with target and peak under its bar
    const b = isNum(v.boost) ? Math.max(0, v.boost) : null;
    big(rec, bx(1), 'Ladedruck', b === null ? '–' : de(b, 2), 'bar', C.text);
    const bb = isNum(v.boostBar) ? Math.max(0, v.boostBar) : b;
    bar(rec, bx(1), barY, tw, 16, bb === null ? null : bb / cfg.boostMax, C.text, null);
    const soll = isNum(v.boostTarget) ? `Soll ${de(Math.max(0, v.boostTarget), 2)}` : 'Soll –';
    rec.text(soll, bx(1), barY + 44, 20, C.dim, { font: 'label' });
    if (isNum(v.boostPeak)) {
        rec.text(`Spitze ${de(Math.max(0, v.boostPeak), 2)} bar`, bx(1) + tw, barY + 44, 20, C.ice, { font: 'scale', align: 'right' });
    }

    // oil pressure: red when low with the engine above its speed
    const low = isNum(v.oilPress) && isNum(v.rpm) && v.rpm > cfg.oilPressRpm && v.oilPress < cfg.oilPressMin;
    big(rec, bx(2), 'Öldruck', isNum(v.oilPress) ? de(v.oilPress, 1) : '–', 'bar', low ? C.limit : C.text, low ? C.limit : null);
    if (isNum(v.oilPressPeak)) {
        rec.text(`Spitze ${de(v.oilPressPeak, 1)} bar`, bx(2), barY + 44, 20, C.ice, { font: 'scale' });
    }
}

/* Row 3: eight small cells, the temperatures with their heat strips. */
function cells(rec, v, cfg, box) {
    const H = D.HEAT;
    const batt = D.battery(v, cfg);
    const knocking = isNum(v.knock) && v.knock >= cfg.knockMax;
    const list = [
        { label: 'Kühlmittel', v: v.coolant, unit: '°C', r: Object.assign({}, H.coolant, { limit: cfg.coolantMax, warm: cfg.coolantReady }) },
        { label: 'Getriebeöl', v: v.gearbox, unit: '°C', r: Object.assign({}, H.gearbox, { limit: cfg.gearboxMax, warm: cfg.gearboxReady }) },
        { label: 'Ansaugluft', v: v.intake, unit: '°C', r: Object.assign({}, H.intake, { limit: cfg.intakeMax }) },
        { label: 'Abgas', v: v.exhaust, unit: '°C', r: Object.assign({ limit: cfg.exhaustMax }, H.exhaust) },
        { label: 'Leistung', text: isNum(v.power) ? String(Math.round(Math.max(0, v.power))) : '–', unit: 'PS', peak: v.powerPeak },
        { label: 'Drehmoment', text: isNum(v.torque) ? String(Math.round(v.torque)) : '–', unit: 'Nm', peak: v.torquePeak },
        { label: v.knockCyl && isNum(v.knock) && v.knock > 0 ? `Klopfen Zyl. ${v.knockCyl}` : 'Klopfen',
            text: isNum(v.knock) ? de(Math.max(0, v.knock), 1) : '–', unit: '°', hot: knocking },
        { label: batt[0], text: batt[1], unit: batt[2], hot: batt[3], note: batt.note,
            r: batt.soc ? { lo: 0, hi: 100, warm: null, limit: cfg.batteryMin, low: true } : null, sv: v.battSoc }
    ];
    const cw = (box.x1 - box.x0) / list.length;
    const y = TOP + 292;
    list.forEach((c, i) => {
        const x = box.x0 + i * cw;
        const hot = c.hot || (c.r && isNum(c.v) && c.r.limit !== null && !c.r.low && c.v >= c.r.limit);
        rec.text(c.label, x, y, 20, hot ? C.limit : C.dim, { font: 'label' });
        const text = c.text != null ? c.text : (isNum(c.v) ? String(Math.round(c.v)) : '–');
        D.valueUnit(rec, text, c.unit, x, y + 42, 42, hot ? C.limit : C.text, 20, 'left');
        if (c.r) {
            D.heatStrip(rec, x, y + 52, cw - 26, 9, c.sv != null ? c.sv : c.v, c.r);
        } else if (isNum(c.peak) && c.peak > 0) {
            rec.text(`max ${Math.round(c.peak)}`, x, y + 64, 17, C.ice, { font: 'scale' });
        }
    });
}

function live(rec, v, cfg, ui, extra, box) {
    rpmRow(rec, v, cfg, box);
    tiles(rec, v, cfg, box);
    cells(rec, v, cfg, box);
    targets(extra, box).forEach((t) => D.button(rec, t, ui, { size: 24 }));
}

module.exports = { live, targets };
