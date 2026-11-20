'use strict';
/**
 * Proven Gauges - Proven Performance Solutions gauge sets for BMW iDrive 7 and iDrive 8 (MGU).
 *
 * Five gauge sets, one per tab (touch a tab, or "Next set" / "Previous set"):
 *   Street   tach dial with redline and shift lights, speed + gear, power and torque bars,
 *            boost dial, oil / coolant / intake temperatures
 *   Track    full-width shift lights, rev bar, speed + gear, oil and coolant with traces,
 *            friction circle with session peak g
 *   Boost    boost dial with target marker and peak tell-tale, 60 s boost trace against target,
 *            intake air, ignition timing, fuel rail and feed pressure
 *   Thermal  warm-up status, coolant / oil / gearbox / intake / outside temperature with 5 min traces
 *   Tyres    pressures against the car's targets, temperatures, and the pressure gained since the start
 *
 * Built on the idrive7-apps kit (MIT): kit/runtime draws at 60 fps through the GPU renderer and
 * builds the iDrive 7 and iDrive 8 screens from app.json. Data: vitals.js. Faces: faces.js.
 * Colours: proven-theme.js (the logo's white, light blue, dark blue and red). Logo: logo.js.
 */
require('./proven-theme').register();
const mgu = require('./kit/mgu');
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const Engine = require('./kit/engine');
const Vitals = require('./vitals');
const F = require('./faces');
const Logo = require('./logo');

const W = 1600, H = 520;
const PAGES = ['street', 'track', 'boost', 'thermal', 'tyres'];
const TABS = ['Street', 'Track', 'Boost', 'Thermal', 'Tyres'];
const GO = '#2fd27a';
/** Pressure units (values arrive in bar): factor from bar, label, decimals for boost / fuel feed / tyres. */
const PRESS = { bar: [1, 'bar', 2, 1, 1], psi: [14.5038, 'psi', 1, 0, 0], kpa: [100, 'kPa', 0, 0, 0] };
/** Boost dial per "Boost gauge max" setting and unit: [top of the scale, numbered step, subdivisions]. */
const BOOST = {
    '2.0': { bar: [2, 0.5, 5], psi: [30, 5, 5], kpa: [200, 50, 5] },
    '2.5': { bar: [2.5, 0.5, 5], psi: [40, 5, 5], kpa: [250, 50, 5] },
    '3.0': { bar: [3, 0.5, 5], psi: [45, 5, 5], kpa: [300, 50, 5] },
    '3.5': { bar: [3.5, 0.5, 5], psi: [50, 10, 5], kpa: [350, 50, 5] },
};

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const engine = new Engine({ settings, dataDir: ctx.dataDir, log });
        const vitals = new Vitals(ctx, engine);
        const hist = vitals.hist;

        /* ---------- units ---------- */
        const T = (c) => (c == null ? null : settings.get('tempUnit') === 'f' ? c * 9 / 5 + 32 : c);
        const tU = () => (settings.get('tempUnit') === 'f' ? '°F' : '°C');
        const pressU = () => PRESS[settings.get('pressUnit')] || PRESS.psi;
        const P = (b) => (b == null ? null : b * pressU()[0]);
        const pU = () => pressU()[1];
        const V = (k) => (k == null ? null : settings.get('speedUnit') === 'mph' ? k * 0.621371 : k);
        const vU = () => (settings.get('speedUnit') === 'mph' ? 'mph' : 'km/h');
        const PW = (kw) => (G.isNum(kw) ? kw * ({ kw: 1, hp: 1.34102, ps: 1.35962 }[settings.get('powerUnit')] || 1) : null);
        const pwU = () => ({ kw: 'kW', hp: 'hp', ps: 'PS' }[settings.get('powerUnit')] || 'kW');
        const TQ = (nm) => (G.isNum(nm) ? nm * (settings.get('torqueUnit') === 'lbft' ? 0.737562 : 1) : null);
        const tqU = () => (settings.get('torqueUnit') === 'lbft' ? 'lb-ft' : 'Nm');
        /** Boost dial scale in the unit shown. */
        const boostScale = () => {
            const u = PRESS[settings.get('pressUnit')] ? settings.get('pressUnit') : 'psi';
            const b = (BOOST[settings.get('boostMax')] || BOOST['2.0'])[u];
            return { max: b[0], major: b[1], minor: b[2], unit: pU(), dec: pressU()[2], labelDec: u === 'bar' ? 1 : 0 };
        };
        /** Shift point of the shift lights: the setting, or 300 rpm under the redline. */
        const shiftPoint = () => { const s = settings.get('shiftAt'); return s > 0 ? Math.min(s, engine.scaleMax()) : engine.redline() - 300; };
        /** Power in kW: the sport display's % of the car's max power, or torque x rpm. */
        const power = (d) => {
            if (settings.get('powerSource') !== 'calc' && G.isNum(d.powerPct)) return { kw: d.powerPct / 100 * settings.get('maxPower'), calc: false };
            return { kw: G.isNum(d.powerCalc) ? d.powerCalc : null, calc: true };
        };
        /** An engine-unit value, only while it is fresh. */
        const val = (d, k) => (vitals.fresh(k === 'boostTarget' || k === 'boostActual' ? 'boostCtl' : k) ? d[k] : null);
        /** min / max of a history for a tile's last line. */
        const mm = (h, f, dec) => {
            const v = h.filter(G.isNum);
            return v.length ? 'min ' + G.fmt(f(Math.min.apply(null, v)), dec) + '  ·  max ' + G.fmt(f(Math.max.apply(null, v)), dec) : 'last 5 min';
        };

        /** The same for a narrow tile: "range 31 - 44". */
        const range = (h, f, dec) => {
            const v = h.filter(G.isNum);
            return v.length ? 'range ' + G.fmt(f(Math.min.apply(null, v)), dec) + ' – ' + G.fmt(f(Math.max.apply(null, v)), dec) : 'last 5 min';
        };

        /**
         * { letter, num, est } for the gear readout, or null without gear information. P / R / N come
         * from the selector position; stopped in D (no gear engaged yet) shows D.
         */
        function gearText(d) {
            const st = d.stage, m = d.gearMode || d.program;
            if (st === 'P' || st === 'R' || st === 'N') return { letter: st, num: '', est: false };
            let g = d.gear, est = false;
            if (!G.isNum(g)) { g = d.gearGuess; est = true; }
            const letter = m === 'S' || m === 'M' ? m : 'D';
            if (!G.isNum(g)) return st === 'D' ? { letter, num: '', est: false } : null;
            if (g < 0) return { letter: 'R', num: '', est };
            if (g === 0) return st === 'D' ? { letter, num: '', est } : { letter: m === 'P' ? 'P' : 'N', num: '', est };
            return { letter, num: String(g), est };
        }
        /** Gear, right-aligned at xr on baseline y: D / S / M + number (R, N, P alone). */
        function drawGear(cv, t, d, xr, y, size) {
            const gr = gearText(d);
            if (!gr) { cv.text('-', xr, y, size, t.dim, { align: 'right', font: 'gear', literal: true }); return; }
            const nw = gr.num ? cv.text(gr.num, xr, y, size, t.text, { align: 'right', font: 'gear', literal: true }) : 0;
            cv.text(gr.letter, xr - (nw ? nw + size * 0.04 : 0), y, size, gr.letter === 'M' ? t.crit : gr.letter === 'S' ? t.accent : nw ? t.dim : t.text, { align: 'right', font: 'gear', literal: true });
            if (gr.est) cv.text('EST.', xr, y - size * 0.80, 16, t.dim, { align: 'right', font: 'bold', spacing: 1.5 });
        }
        /** Speed, left-aligned at x on baseline y, with its unit. */
        function drawSpeed(cv, t, d, x, y, size) {
            const sp = V(G.hold('speed', d.speed, 1000 / settings.get('speedRate')));
            const sw = cv.text(G.fmt(sp, 0), x, y, size, sp == null ? t.dim : t.text, { font: 'num', literal: true });
            cv.text(vU(), x + sw + size * 0.07, y, Math.max(20, Math.round(size * 0.2)), t.dim);
        }
        const resetPeaks = () => { vitals.resetPeaks(); return render(); };
        /** "Reset peaks" on the page, where the kit runs the screen (elsewhere it is a button of the HMI's bar). */
        const resetBtn = (cv, t, x, y, w) => G.button(cv, t, x, y, w || 150, 34, 'Reset peaks', resetPeaks, { key: 'reset' });
        const shiftLights = (cv, t, d, x, y, w, h, n) => G.shiftLights(cv, t, x, y, w, h, {
            rpm: d.rpm, shift: shiftPoint(), range: 1800, n, style: settings.get('shiftStyle'), blink: Math.floor(Date.now() / 70) % 2 === 0,
        });
        const tempZones = {
            coolant: () => [{ from: T(112), to: 9999, color: 'crit' }, { from: -999, to: T(60), color: 'cold' }],
            oil: () => [{ from: T(settings.get('oilWarn')), to: 9999, color: 'crit' }, { from: -999, to: T(70), color: 'cold' }],
            gearbox: () => [{ from: T(120), to: 9999, color: 'warn' }, { from: -999, to: T(50), color: 'cold' }],
            iat: () => [{ from: T(50), to: T(65), color: 'warn' }, { from: T(65), to: 9999, color: 'crit' }],
        };

        /* ---------- Street ---------- */
        function drawStreet(cv, t, d) {
            const red = engine.redline(), max = engine.scaleMax(), pk = vitals.pk(), showPk = settings.get('peaks'), brand = settings.get('branding');
            const showIat = vitals.has('iat');
            vitals.want((showIat || !vitals.usingDemo() ? ['iat'] : []).concat(vitals.boostFromDme() ? ['boost'] : []));
            // tach
            F.dial(cv, t, 250, 282, 212, {
                key: 'tach', value: d.rpm, min: 0, max, major: 1000, minor: 4, div: 1000, label: 'RPM x1000', unit: 'rpm',
                redFrom: red, warnFrom: Math.min(shiftPoint(), red), peak: showPk ? pk.rpm : null, brand,
            });
            // centre: shift lights, speed + gear, power and torque
            shiftLights(cv, t, d, 500, 58, 580, 24, 12);
            cv.text('SPEED', 500, 114, 18, t.dim, { font: 'bold', spacing: 2 });
            cv.text('GEAR', 1080, 114, 18, t.dim, { font: 'bold', spacing: 2, align: 'right' });
            drawSpeed(cv, t, d, 500, 250, 150);
            drawGear(cv, t, d, 1080, 250, 170);
            const pw = power(d);
            G.bar(cv, t, 500, 284, 580, 92, {
                label: pw.calc ? 'Power (torque x rpm)' : 'Power', value: PW(pw.kw), unit: pwU(), max: PW(settings.get('maxPower')), niceMax: true, ramp: 'hot',
                peak: showPk && G.isNum(pk.power) ? PW(pk.power) : null, peakText: true,
            });
            G.bar(cv, t, 500, 400, 580, 92, {
                label: 'Torque', value: TQ(d.torque), unit: tqU(), max: TQ(settings.get('maxTorque')), niceMax: true, ramp: 'hot',
                peak: showPk ? TQ(pk.torque) : null, peakText: true,
            });
            // right: boost dial, temperatures
            const B = boostScale();
            F.dial(cv, t, 1348, 226, 150, {
                key: 'boost-street', value: P(d.boost), min: 0, max: B.max, major: B.major, minor: B.minor, labelDecimals: B.labelDec,
                label: 'Boost', unit: B.unit, decimals: B.dec, warnFrom: B.max * 0.85, peak: showPk ? P(pk.boost) : null, brand,
            });
            resetBtn(cv, t, 1440, 48, 136);
            if (!G.isNum(d.boost) && !vitals.usingDemo()) cv.text(vitals.boostWhy(), 1348, 404, 18, t.dim, { align: 'center' });
            const third = showIat ? { label: 'Intake', value: T(val(d, 'iat')), zones: tempZones.iat() } : { label: 'Outside', value: T(d.ambient) };
            [{ label: 'Oil', value: T(d.oil), zones: tempZones.oil() }, { label: 'Coolant', value: T(d.coolant), zones: tempZones.coolant() }, third]
                .forEach((g, i) => G.readout(cv, t, 1128 + i * 156, 418, Object.assign({ unit: tU(), size: 54, decimals: 0 }, g)));
        }

        /* ---------- Track ---------- */
        const trail = [];
        function drawTrack(cv, t, d) {
            const red = engine.redline(), max = engine.scaleMax(), pk = vitals.pk(), showPk = settings.get('peaks');
            if (G.isNum(d.gLat) && G.isNum(d.gLong)) { trail.push([d.gLat, d.gLong]); if (trail.length > 60) trail.shift(); }
            shiftLights(cv, t, d, 24, 56, 1552, 26, 16);
            G.segBar(cv, t, 24, 98, 1016, 206, {
                label: 'Engine speed', value: d.rpm, unit: 'rpm', decimals: 0, min: 0, max, step: 500,
                scale: { every: 1000, div: 1000 }, ramp: 'hot', limit: red, marks: [{ value: red, color: 'crit' }, { value: shiftPoint(), color: 'warn' }],
                peak: showPk ? pk.rpm : null,
            });
            // speed + gear
            const p = G.panel(cv, t, 24, 320, 330, 192, 'Speed');
            drawSpeed(cv, t, d, 46, p.y + p.h - 30, 84);
            drawGear(cv, t, d, 24 + 330 - 22, p.y + p.h - 30, 124);
            // oil and coolant with their last 5 minutes
            G.stat(cv, t, 370, 320, 323, 192, { label: 'Engine oil', value: T(d.oil), unit: tU(), size: 64, color: 'oil', zones: tempZones.oil(), history: hist.oil.map(T) });
            G.stat(cv, t, 717, 320, 323, 192, { label: 'Coolant', value: T(d.coolant), unit: tU(), size: 64, zones: tempZones.coolant(), history: hist.coolant.map(T) });
            // friction circle and the session's peak g
            G.panel(cv, t, 1064, 98, 512, 414, 'G-force');
            G.gmeter(cv, t, 1234, 296, 128, { lat: d.gLat, long: d.gLong, trail, max: 1.5, flipLong: settings.get('flipLong') });
            resetBtn(cv, t, 1406, 108, 150);
            [['Peak lateral', pk.gLat], ['Peak accel', pk.gAccel], ['Peak brake', pk.gBrake]]
                .forEach(([label, v], i) => G.readout(cv, t, 1556, 168 + i * 104, { label, value: v, decimals: 2, unit: 'g', size: 48, align: 'right' }));
        }

        /* ---------- Boost ---------- */
        function drawBoost(cv, t, d) {
            vitals.want(['iat', 'hpfp', 'lpfp', 'timing', 'boostCtl'].concat(vitals.boostFromDme() ? ['boost'] : []));
            const B = boostScale(), pk = vitals.pk(), showPk = settings.get('peaks'), pd = pressU();
            const target = val(d, 'boostTarget');
            F.dial(cv, t, 250, 282, 212, {
                key: 'boost', value: P(d.boost), min: 0, max: B.max, major: B.major, minor: B.minor, labelDecimals: B.labelDec,
                label: 'Boost', unit: B.unit, decimals: B.dec, warnFrom: B.max * 0.85, peak: showPk ? P(pk.boost) : null,
                target: P(target), brand: settings.get('branding'),
            });
            if (!G.isNum(d.boost) && !vitals.usingDemo()) cv.text(vitals.boostWhy(), 250, 508, 18, t.dim, { align: 'center' });
            // the last 60 s: boost (filled) against the engine unit's target (thin white line)
            const p = G.panel(cv, t, 488, G.TOP, 640, 468, 'Boost in ' + B.unit + '  ·  last 60 s');
            resetBtn(cv, t, p.x + p.w - 166, p.y + 12, 150);
            const tr = vitals.trace, n = tr.boost.length;
            const pts = (a) => a.map((v, i) => [-(n - 1 - i) * 0.2, v == null ? null : P(v)]);
            G.chart(cv, t, p.x + 14, p.y + 60, p.w - 30, p.h - 60 - 100, {
                xMin: -60, xMax: 0, xStep: 10, yMin: 0, yMax: B.max, yStep: B.major, xUnit: 's',
                yFmt: (v) => G.fmt(v, B.labelDec),
                series: [{ pts: pts(tr.boost), color: 'accent2', width: 3, fill: 0.22 }, { pts: pts(tr.target), color: 'text', width: 1.5 }],
                empty: 'no boost data yet',
            });
            const yb = p.y + p.h - 88, err = G.isNum(d.boost) && G.isNum(target) && target > 0.2 ? d.boost - target : null;
            // (the peak of what the chart shows, so the two agree; the dial's tell-tale follows the Peak hold setting)
            const seen = tr.boost.filter(G.isNum), peak60 = seen.length ? Math.max.apply(null, seen) : null;
            G.readout(cv, t, p.x + 24, yb, { label: 'Peak, 60 s', value: P(peak60), decimals: B.dec, unit: B.unit, size: 46 });
            G.readout(cv, t, p.x + 232, yb, { label: 'Target', value: P(target), decimals: B.dec, unit: B.unit, size: 46 });
            G.readout(cv, t, p.x + 440, yb, {
                label: 'Against target', value: P(err), text: G.isNum(err) ? (err >= 0 ? '+' : '') + G.fmt(P(err), B.dec) : null, unit: B.unit, size: 46,
                color: !G.isNum(err) || Math.abs(err) < 0.15 ? 'text' : err > 0 ? 'crit' : 'warn',
            });
            // engine-unit values
            const running = G.isNum(d.rpm) && d.rpm > 500;
            const tile = (i, g) => G.stat(cv, t, 1152 + (i % 2) * 220, G.TOP + (i > 1 ? 242 : 0), 204, 226, Object.assign({ size: 56 }, g));
            const sub = (k, h, f, dec) => (G.isNum(val(d, k)) ? range(h, f, dec) : vitals.usingDemo() ? 'no data' : vitals.dmeWhy(k));
            tile(0, { label: 'Intake air', value: T(val(d, 'iat')), unit: tU(), decimals: 0, zones: tempZones.iat(), history: hist.iat.map(T), sub: sub('iat', hist.iat, T, 0) });
            tile(1, { label: 'Timing', value: val(d, 'timing'), unit: '°', decimals: 1, history: hist.timing, sub: sub('timing', hist.timing, (x) => x, 0) });
            tile(2, { label: 'Fuel rail', value: P(val(d, 'hpfp')), unit: pU(), decimals: 0, history: hist.hpfp.map(P),
                zones: running ? [{ from: -999, to: P(20), color: 'crit' }] : [], sub: sub('hpfp', hist.hpfp, P, 0) });
            tile(3, { label: 'Fuel feed', value: P(val(d, 'lpfp')), unit: pU(), decimals: pd[3], history: hist.lpfp.map(P),
                zones: running ? [{ from: -999, to: P(3), color: 'crit' }, { from: P(3), to: P(4), color: 'warn' }] : [], sub: sub('lpfp', hist.lpfp, P, pd[3]) });
        }

        /* ---------- Thermal ---------- */
        /** Warm-up state from oil and coolant: { title, note, color }. Guidance only: thresholds are general, not a tune's. */
        function warmState(d) {
            const oil = d.oil, cool = d.coolant, u = tU(), oilWarn = settings.get('oilWarn');
            if (!G.isNum(oil) && !G.isNum(cool)) return { title: 'No temperature data', note: vitals.usingDemo() ? '' : vitals.why('oil'), color: 'dim' };
            if ((G.isNum(oil) && oil >= oilWarn) || (G.isNum(cool) && cool >= 112)) return { title: 'Hot', note: 'Ease off and let it cool before switching off', color: 'crit' };
            // without an oil temperature the engine is never called up to temperature on coolant alone
            if (!G.isNum(oil)) return { title: 'No oil temperature', note: 'Coolant ' + G.fmt(T(cool), 0) + u + (vitals.usingDemo() ? '' : '  ·  ' + vitals.why('oil')), color: 'dim' };
            if (oil < 60) return { title: 'Cold', note: 'Oil ' + G.fmt(T(oil), 0) + u + '  ·  keep the revs and load down', color: 'cold' };
            if (oil < 85) return { title: 'Warming up', note: 'Oil ' + G.fmt(T(oil), 0) + u + '  ·  full load from ' + G.fmt(T(85), 0) + u, color: 'warn' };
            // (only what was measured is named)
            return { title: 'Up to temperature', note: 'Oil ' + G.fmt(T(oil), 0) + u + (G.isNum(cool) ? '  ·  coolant ' + G.fmt(T(cool), 0) + u : ''), color: GO };
        }
        function drawThermal(cv, t, d) {
            const showIat = vitals.has('iat');
            vitals.want(showIat || !vitals.usingDemo() ? ['iat'] : []);
            F.statusStrip(cv, t, 24, G.TOP, 1336, 52, warmState(d));
            if (!resetBtn(cv, t, 1386, G.TOP + 9, 190)) Logo.draw(cv, 1576 - 196, G.TOP + (52 - Logo.size(196, 'word').h) / 2, 196, 'word');
            const tile = (k, label, zones, color, valueColor, value, why) => ({
                label, value: T(value === undefined ? d[k] : value), unit: tU(), zones, color, valueColor, history: hist[k].map(T),
                sub: (value === undefined ? d[k] : value) == null ? (vitals.usingDemo() ? 'no data' : why || vitals.why(k)) : mm(hist[k], T, 0),
            });
            const box = vitals.has('gearbox') ? tile('gearbox', 'Gearbox oil', tempZones.gearbox())
                : vitals.has('egs') ? tile('egs', 'Gearbox', tempZones.gearbox(), null, null, val(d, 'egs'), vitals.dmeWhy('egs')) : null;
            const tiles = [
                tile('coolant', 'Coolant', tempZones.coolant()),
                tile('oil', 'Engine oil', [{ from: T(settings.get('oilWarn')), to: 9999, color: 'crit' }, { from: -999, to: T(70), color: 'cold', tintOnly: true }], 'oil'),
                box,
                showIat && tile('iat', 'Intake air', tempZones.iat(), null, null, val(d, 'iat'), vitals.dmeWhy('iat')),
                tile('ambient', 'Outside', [{ from: -999, to: T(3), color: 'cold' }], GO, GO),
            ].filter(Boolean);
            const gap = 16, w = (1552 - gap * (tiles.length - 1)) / tiles.length;
            tiles.forEach((g, i) => G.stat(cv, t, 24 + i * (w + gap), 108, w, 404, Object.assign({ size: 96 }, g)));
        }

        /* ---------- Tyres ---------- */
        /** Top-down car: each tyre's pressure (against the car's target) and temperature. After M Vitals' tyre card. */
        function tyreCard(cv, t, x, y, w, h, d) {
            const temps = vitals.has('tyreTemp');
            const p = G.panel(cv, t, x, y, w, h, 'Tyres');
            const unitP = pU(), dec = pressU()[4];
            const cx = x + w / 2, top = y + 70, bh = h - 100 + G.toMargin(p.h - h, 26), bw = 150;
            cv.roundRect(cx - bw / 2, top, bw, bh, 52, withAlpha(t.track, 0.9));
            cv.strokeRoundRect(cx - bw / 2, top, bw, bh, 52, 3, t.tick);
            cv.roundRect(cx - bw / 2 + 18, top + bh * 0.24, bw - 36, 34, 12, withAlpha(t.tick, 0.45));
            cv.roundRect(cx - bw / 2 + 22, top + bh * 0.70, bw - 44, 26, 10, withAlpha(t.tick, 0.35));
            cv.text('FRONT', cx, top + 36, 20, t.dim, { align: 'center', font: 'bold', spacing: 1 });
            const tyw = 34, tyh = 84;
            const corners = [['FL', -1, top + 30], ['FR', 1, top + 30], ['RL', -1, top + bh - 30 - tyh], ['RR', 1, top + bh - 30 - tyh]];
            for (const [k, side, ty] of corners) {
                const temp = d['t' + k], pr = P(d['p' + k]), tgt = P(d['pt' + k]);
                // pressure: big, coloured against the car's target
                let pc = G.isNum(pr) ? t.text : t.dim;
                if (G.isNum(pr) && G.isNum(tgt) && tgt > 0) { const r = pr / tgt; pc = r < 0.85 ? t.crit : r < 0.93 || r > 1.15 ? t.warn : GO; }
                // tyre colour: temperature, or the pressure state when the car sends no temperatures
                const tc = !temps ? (G.isNum(pr) ? pc : t.tick) : !G.isNum(temp) ? t.tick : temp < 20 ? t.cold : temp > 105 ? t.crit : temp > 90 ? t.warn : GO;
                const tx0 = side < 0 ? cx - bw / 2 - tyw - 8 : cx + bw / 2 + 8;
                cv.roundRect(tx0, ty, tyw, tyh, 10, tc);
                for (let i = 1; i < 4; i++) cv.fillRect(tx0 + 6, ty + i * tyh / 4, tyw - 12, 2, withAlpha(t.bg, 0.35));
                const al = side < 0 ? 'right' : 'left', lx = side < 0 ? tx0 - 26 : tx0 + tyw + 26;
                const size = 72 + (temps ? 0 : 16), py = ty + (temps ? 52 : 62);
                const pw = cv.text(G.fmt(pr, dec), lx + (side < 0 ? -cv.textWidth(' ' + unitP, 24) : 0), py, size, pc, { align: al, font: 'num', literal: true });
                cv.text(' ' + unitP, side < 0 ? lx : lx + pw, py, 24, t.dim, { align: al });
                cv.text(G.isNum(tgt) ? 'target ' + G.fmt(tgt, dec) : 'no target', lx, py + 30, 22, t.dim, { align: al });
                if (temps) cv.text(G.isNum(temp) ? G.fmt(T(temp), 0) + tU() : '--' + tU(), lx, ty + 118, 30, G.isNum(temp) ? tc : t.dim, { align: al, font: 'bold' });
            }
        }
        function drawTyres(cv, t, d) {
            tyreCard(cv, t, 24, G.TOP, 1000, 468, d);
            const p = G.panel(cv, t, 1048, G.TOP, 528, 468, 'Since start, ' + pU());
            resetBtn(cv, t, p.x + p.w - 166, p.y + 12, 150);
            const st = vitals.starts(), dec = pressU()[4], names = { FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right' };
            const rows = Vitals.TYRES.map((k) => {
                const now = d['p' + k], s0 = st['p' + k], ch = G.isNum(now) && G.isNum(s0) ? P(now) - P(s0) : null;
                return [names[k], G.fmt(P(s0), dec), { text: G.fmt(P(now), dec), color: G.isNum(now) ? 'text' : 'dim' },
                    { text: G.isNum(ch) ? (ch >= 0 ? '+' : '') + G.fmt(ch, Math.max(1, dec)) : '--', color: !G.isNum(ch) ? 'dim' : ch > P(0.05) ? 'accent2' : ch < -P(0.05) ? 'cold' : 'text' }];
            });
            G.table(cv, t, p.x + 24, p.y + 70, p.w - 48, [
                { label: 'Tyre', w: 170, size: 26 }, { label: 'Start', w: 100, align: 'right', font: 'num', size: 34, color: 'dim' },
                { label: 'Now', w: 100, align: 'right', font: 'num', size: 34 }, { label: 'Change', w: 110, align: 'right', font: 'num', size: 34 },
            ], rows, { rowH: 66, middle: true });
            const any = Vitals.TYRES.some((k) => G.isNum(d['p' + k]));
            cv.text(any ? 'Start = the first reading of this drive, or since Reset peaks.' : 'No tyre pressures from the car yet.', p.x + 24, p.y + p.h - 52, 20, t.dim);
            if (any) cv.text('Hot pressures rise as the tyres work: set them against this.', p.x + 24, p.y + p.h - 26, 20, t.dim);
        }

        /* ---------- frame ---------- */
        let page = Math.max(0, PAGES.indexOf(settings.get('page')));
        const DRAW = [drawStreet, drawTrack, drawBoost, drawThermal, drawTyres];
        /*
         * Start-up logo: the first time the app is opened after a start of the head unit, the logo alone
         * for SPLASH_MS, then the gauges fade in over FADE_MS (setting "Start-up logo").
         */
        const SPLASH_MS = 1400, FADE_MS = 450;
        let shownAt = 0;
        // a clock that only moves forward: the head unit sets its wall clock after start-up, and the logo must not return
        const mono = () => { const h = process.hrtime(); return h[0] * 1000 + h[1] / 1e6; };
        async function render() {
            const t = ctx.theme(), d = vitals.data();
            vitals.seenScreen();
            const age = shownAt && settings.get('splash') ? mono() - shownAt : Infinity;
            if (age < SPLASH_MS) {
                const cv = ctx.canvas(W, H).clear('#000000'), lw = 760, z = Logo.size(lw, 'full');
                Logo.draw(cv, (W - lw) / 2, G.TOP + (G.BOTTOM - G.TOP - z.h) / 2, lw, 'full');
                G.frame(cv, t, TABS, page, [vitals.usingDemo() && { text: 'DEMO' }]);
                await ui.image('MAIN_GFX', cv);
                return;
            }
            // peaks: raised every frame, so a held peak also drops back while the car sends nothing new
            ['rpm', 'boost', 'torque'].forEach((k) => vitals.raise(k, d[k]));
            vitals.raise('power', power(d).kw);
            if (G.isNum(d.gLat)) vitals.max('gLat', Math.abs(d.gLat));
            if (G.isNum(d.gLong)) { vitals.max('gAccel', Math.max(0, d.gLong)); vitals.max('gBrake', Math.max(0, -d.gLong)); }
            const cv = ctx.canvas(W, H).clear(t.bg);
            DRAW[page](cv, t, d);
            if (age < SPLASH_MS + FADE_MS) cv.fillRect(0, G.BAR_H, W, H - G.BAR_H, withAlpha('#000000', 1 - (age - SPLASH_MS) / FADE_MS));
            G.frame(cv, t, TABS, page, [vitals.usingDemo() && { text: 'DEMO' }]);
            if (!render.n) { render.n = 1; log.info('first frame drawn'); }
            await ui.image('MAIN_GFX', cv);
        }

        ui.onClick('BTN_PAGE', () => { page = (page + 1) % PAGES.length; return render(); });
        ui.onClick('BTN_PREV', () => { page = (page + PAGES.length - 1) % PAGES.length; return render(); });
        ui.onClick('BTN_RESET', resetPeaks);
        ctx.hideButton('BTN_RESET');                       // on the page where the kit runs the screen (resetBtn)
        ctx.onTab((i) => { page = i; return render(); });
        // every screen refresh (60 fps) with the GPU renderer; 10 fps in software (PNG frames)
        ctx.loop('MAIN', 10, () => { if (!shownAt) shownAt = mono() || 1; return render(); });
        settings.onChange((k) => {
            if (k === 'maxPower' || k === 'powerSource') { delete vitals.peak.power; delete vitals.demoPeak.power; }
            if (k === 'boostSource') { delete vitals.peak.boost; vitals.updBoost(); }
            if (k === 'page') page = Math.max(0, PAGES.indexOf(settings.get('page')));
        });
        log.info('Proven Gauges: first render');
        render().catch((e) => log.warn('first render: ' + e));
    },
});
