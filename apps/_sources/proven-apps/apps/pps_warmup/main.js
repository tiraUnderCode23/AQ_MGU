'use strict';
/**
 * Proven Warm-Up - tells the driver when engine oil, gearbox oil and coolant are in their safe range.
 *
 * The workshop programs, per car, in Settings > Workshop settings:
 *   - "safe from" and "too hot above" for engine oil, gearbox oil and coolant
 *   - the rev limit to keep to until everything is warm
 *   - where the gearbox oil temperature comes from (or that this car has none)
 *
 * The driver sees
 *   - one screen: a status line and three gauges with a blue (not yet), green (safe) and red (too hot)
 *     zone each, the minutes until each is ready, and a warning when revving past the limit while cold.
 *     Gauge style (setting): horizontal bars with the full Proven logo, the rev limit and the time to ready
 *     beside them, or round dials
 *   - an announcement over the screen when everything has come up to temperature
 *   - the same on the iDrive home screen as a widget, without opening the app
 *
 * It runs from the head unit's start (app.json "autostart"), so the warm-up is followed with the app closed.
 * Decision: warm.js. Readings: source.js. Gauge faces and logo: faces.js, logo.js. Colours: proven-theme.js.
 * Built on the idrive7-apps kit (MIT).
 */
require('./proven-theme').register();
const mgu = require('./kit/mgu');
const { withAlpha, ScaledCanvas } = require('./kit/canvas');
const G = require('./kit/gauges');
const Faces = require('./faces');
const Logo = require('./logo');
const { WarmUp, limitsFrom, FLUIDS } = require('./warm');
const { Source, mono } = require('./source');

const W = 1600, H = 520;
const GO = '#2fd27a';
const NAMES = { oil: 'Engine oil', gearbox: 'Gearbox oil', coolant: 'Coolant' };
const SHORT = { oil: 'OIL', gearbox: 'GEARBOX', coolant: 'COOLANT' };
const CX = { oil: 283, gearbox: 800, coolant: 1317 };
// horizontal bars: three rows on the left, the brand column on the right
const ROW_Y = { oil: 108, gearbox: 244, coolant: 380 }, ROW_H = 128, ROWS_W = 1204, BAR_X = 330, BAR_W = 722, BAR_H = 44;
const SIDE = { x: 1244, w: 332 };
const ANNOUNCE_MS = 6000;
const ANNOUNCE_FRESH_MS = 15000;   // the announcement is only shown this soon after the car came up to temperature
const ANNOUNCE_AGAIN_MS = 600000;  // and not again within this time (a fluid that dips under its hold and comes back)
// dial scales: deg C, and deg F
const SCALE = { c: { min: 0, max: 150, major: 30, minor: 3 }, f: { min: 0, max: 300, major: 50, minor: 5 } };

/** "engine oil", "engine oil and coolant", "engine oil, gearbox oil and coolant" */
const list = (keys) => {
    const n = keys.map((k) => NAMES[k].toLowerCase());
    return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* With or without the screen (autostart): the readings, and the decision once a second. */
async function background(bg) {
    const { settings, log } = bg;
    const src = new Source(bg);
    const warm = new WarmUp(() => limitsFrom((k) => settings.get(k)));
    let wasDemo = null;
    const tick = () => {
        const d = src.data();
        if (d.demo !== wasDemo) { if (wasDemo !== null) warm.reset(); wasDemo = d.demo; log.info(d.demo ? 'demo data' : 'car data'); }
        return warm.feed(d, mono());
    };
    // (the kit does not guard a timer the app starts itself, and an uncaught error would stop the app;
    // an error that keeps coming is logged the first time and then once in 300, not every second)
    let tickErr = 0;
    setInterval(() => { try { tick(); } catch (e) { if (tickErr++ % 300 === 0) log.warn('tick (' + tickErr + 'x): ' + (e && e.stack || e)); } }, 1000);
    // until the car is up to temperature the gearbox unit is asked with the engine running, app open or not
    src.wantGearbox = () => { const st = warm.status(mono()); return st.running && st.overall !== 'ready'; };
    // fedDemo: the temperatures the decision holds now are demo data (true until the next tick after the demo ends)
    return { src, warm, tick, fedDemo: () => wasDemo === true };
}

mgu.run({
    background,
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const { src, warm, tick, fedDemo } = ctx.background || await background(ctx);
        const demoShown = () => src.usingDemo() || fedDemo();
        const visible = () => { try { return !!ui.isVisible('MAIN'); } catch (e) { return true; } };
        const widgetOn = () => !!(ctx.widget && ctx.widget.active && ctx.widget.active());
        // ... and while someone is looking (the screen or the widget), also once it is warm
        src.wantGearbox = () => { const st = warm.status(mono()); return st.running && (st.overall !== 'ready' || visible() || widgetOn()); };

        const isF = () => settings.get('tempUnit') === 'f';
        const T = (c) => (G.isNum(c) ? (isF() ? c * 9 / 5 + 32 : c) : null);
        const tU = () => (isF() ? '°F' : '°C');
        const deg = (c) => G.fmt(T(c), 0) + tU();
        const rpmText = (r) => String(Math.round(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const stateColor = (t, s) => (s === 'hot' ? t.crit : s === 'ready' ? GO : s === 'warming' || s === 'stalled' || s === 'off' ? t.cold : t.tick);

        /** The status line: { title, note, color }. */
        function headline(st, d) {
            const counted = FLUIDS.filter((k) => st.fluids[k].counted && st.fluids[k].temp !== null);
            const left = st.unwatched.length ? '  ·  ' + list(st.unwatched) + ' not monitored' : '';
            // (an engine that runs while the car gives no temperature at all still gets the rev advice)
            if (st.overall === 'nodata') return { title: 'No temperature data', note: d.demo ? '' : (st.running && st.limit > 0 ? 'Keep below ' + rpmText(st.limit) + ' rpm  ·  ' : '') + 'waiting for the car', color: 'dim' };
            if (st.overall === 'hot') {
                const hot = FLUIDS.filter((k) => st.fluids[k].state === 'hot');
                return { title: 'Too hot', note: cap(list(hot)) + ' above ' + (hot.length > 1 ? 'their limits' : 'its limit') + '  ·  ease off and let it cool', color: 'crit' };
            }
            if (st.overall === 'ready') return { title: 'Up to temperature', note: cap(list(counted)) + (counted.length > 1 ? ' are in their safe range' : ' is in its safe range') + left, color: GO };
            if (st.over) return { title: 'Ease off', note: rpmText(d.rpm) + ' rpm on a cold engine  ·  keep below ' + rpmText(st.limit) + ' rpm until warm', color: 'crit' };
            const wait = 'Waiting for ' + list(st.waiting);
            if (st.overall === 'off') return { title: 'Engine off', note: wait, color: 'dim' };
            return {
                title: 'Warming up', color: 'warn',
                // the advice first: keep below the limit until warm
                note: (st.limit > 0 ? 'Keep below ' + rpmText(st.limit) + ' rpm until warm  ·  ' + wait.charAt(0).toLowerCase() + wait.slice(1) : wait)
                    + (G.isNum(st.min) ? '  ·  about ' + Math.max(1, Math.round(st.min)) + ' min' : ''),
            };
        }

        /** One fluid: its dial, its state and the workshop's two numbers. */
        function drawFluid(cv, t, k, f) {
            const cx = CX[k], sc = SCALE[isF() ? 'f' : 'c'], used = f.state !== 'unused';
            Faces.dial(cv, t, cx, 284, 158, {
                key: 'warm-' + k, value: used ? T(f.temp) : null, min: sc.min, max: sc.max, major: sc.major, minor: sc.minor,
                label: NAMES[k], unit: tU(), decimals: 0, holdMs: 500, endLabels: false,
                bands: used ? [{ from: sc.min, to: T(f.ready), color: 'cold' }, { from: T(f.ready), to: T(f.hot), color: GO }, { from: T(f.hot), to: sc.max, color: 'crit' }] : [],
                color: stateColor(t, f.state), needleColor: 'text', brand: settings.get('branding'),
            });
            const s = stateText(t, k, f), line = s.line, col = s.col, sub = s.sub || 'safe from ' + deg(f.ready) + '  ·  too hot above ' + deg(f.hot);
            // (the two lines end 16 px over the page's bottom: on iDrive 8 the climate bar starts right under the page)
            cv.text(line, cx, 481, 24, col, { align: 'center', font: 'bold', spacing: 2, literal: true });
            cv.text(sub, cx, 504, 18, t.dim, { align: 'center' });
        }

        /** A fluid's state in words: { line, col, sub }. */
        function stateText(t, k, f) {
            let line, col = t.text, sub = '';
            if (f.state === 'ready') { line = '✓  READY'; col = GO; }
            else if (f.state === 'hot') { line = 'TOO HOT'; col = t.crit; }
            else if (f.state === 'warming') line = f.min > 60 ? 'READY IN OVER 60 MIN' : 'READY IN ABOUT ' + Math.max(1, Math.round(f.min)) + ' MIN';
            else if (f.state === 'stalled') { line = 'NOT WARMING'; col = t.warn; }
            else if (f.state === 'off') { line = 'ENGINE OFF'; col = t.dim; }
            else if (f.state === 'unused') { line = 'NOT MONITORED'; col = t.dim; sub = 'switched off in Workshop settings'; }
            else { line = 'NO READING'; col = t.dim; sub = 'no ' + NAMES[k].toLowerCase() + ' temperature reading'; }
            return { line, col, sub };
        }

        /** One fluid as a horizontal gauge: its name and state, the bar with the two limits marked, the temperature. */
        function drawFluidBar(cv, t, k, f) {
            const x = 24, y = ROW_Y[k], used = f.state !== 'unused', has = used && f.temp !== null;
            const min = T(0), max = T(150), step = isF() ? 9 : 5, s = stateText(t, k, f);
            cv.roundRect(x, y, ROWS_W, ROW_H, 8, withAlpha('#b4bccc', 0.06));
            cv.fillRect(x, y, 6, ROW_H, has ? stateColor(t, f.state) : t.tick);
            cv.text(NAMES[k].toUpperCase(), x + 28, y + 44, 22, t.dim, { font: 'bold', spacing: 2 });
            cv.text(s.line, x + 28, y + 80, 22, s.col, { font: 'bold', spacing: 1.5, literal: true });
            if (s.sub) cv.text(s.sub, x + 28, y + 108, 17, t.dim);
            // two limits close together: their numbers go to either side of their ticks
            const close = (f.hot - f.ready) / 150 * BAR_W < 72;
            Faces.hbar(cv, t, BAR_X, y + 30, BAR_W, BAR_H, {
                key: 'warm-' + k, value: has ? T(f.temp) : null, min, max, step, color: stateColor(t, f.state),
                zones: used ? [{ from: min, to: T(f.ready), color: 'cold' }, { from: T(f.ready), to: T(f.hot), color: GO }, { from: T(f.hot), to: max, color: 'crit' }] : [],
                marks: used ? [{ value: T(f.ready), text: deg(f.ready), color: GO, align: close ? 'right' : 'center' },
                    { value: T(f.hot), text: deg(f.hot), color: 'crit', align: close ? 'left' : 'center' }] : [],
            });
            const rx = x + ROWS_W - 26, uw = cv.textWidth(' ' + tU(), 24);
            cv.text(' ' + tU(), rx, y + 86, 24, t.dim, { align: 'right' });
            cv.text(has ? G.fmt(G.hold('warm-n-' + k, T(f.temp), 500), 0) : '--', rx - uw, y + 88, 68, !has ? t.dim : f.state === 'hot' ? t.crit : t.text, { align: 'right', font: 'num', literal: true });
        }

        /** Beside the bars: the full Proven logo, then the rev limit with the live revs and the time to ready, or the state. */
        function drawSide(cv, t, st, d) {
            const x = SIDE.x, w = SIDE.w, cx = x + w / 2, iw = w - 56, ix = x + 28;
            cv.roundRect(x, G.TOP, w, G.BOTTOM - 4 - G.TOP, 8, withAlpha('#b4bccc', 0.06));
            let y = G.TOP + 8;
            if (settings.get('branding')) {
                y += 14 + Logo.draw(cv, ix, y + 14, iw, 'full') + 20;
                cv.fillRect(ix, y, iw, 2, withAlpha('#ffffff', 0.1));
            }
            const mid = (text, yy, size, col, opt) => cv.text(text, cx, yy, size, col, Object.assign({ align: 'center', font: 'bold', spacing: 2 }, opt));
            // a number with a small unit after it, centred as one
            const pair = (num, unit, yy, ns, us, col) => {
                const nw = cv.textWidth(num, ns, { font: 'num', literal: true }), uw = cv.textWidth(' ' + unit, us), left = cx - (nw + uw) / 2;
                cv.text(num, left, yy, ns, col, { font: 'num', literal: true });
                cv.text(' ' + unit, left + nw, yy, us, t.dim);
            };
            const lamp = (yy, col, mark) => {
                cv.arc(cx, yy, 46, 54, 0, 360, col); cv.arc(cx, yy, 54, 66, 0, 360, withAlpha(col, 0.16));
                if (mark === 'tick') { cv.line(cx - 23, yy + 2, cx - 7, yy + 18, 9, col); cv.line(cx - 7, yy + 18, cx + 25, yy - 18, 9, col); }
                else { cv.line(cx, yy - 24, cx, yy + 6, 9, col); cv.circle(cx, yy + 22, 5.5, col); }
            };
            const room = G.BOTTOM - 4 - y;
            if (st.overall === 'warming') {
                const rev = st.limit > 0 && G.isNum(d.rpm), c = st.over ? t.crit : t.text;
                if (rev) {
                    mid(st.over ? 'EASE OFF' : 'KEEP BELOW', y + 36, 18, st.over ? t.crit : t.dim);
                    pair(rpmText(st.limit), 'rpm', y + 84, 46, 22, c);
                    Faces.hbar(cv, t, ix, y + 100, iw, 26, {
                        key: 'warm-rev', value: d.rpm, min: 0, max: st.limit * 1.5, step: st.limit / 8, color: st.over ? 'crit' : 'text',
                        zones: [{ from: st.limit, to: st.limit * 1.5, color: 'crit' }], marks: [{ value: st.limit, color: 'crit' }],
                    });
                    pair(rpmText(G.hold('warm-rpm', d.rpm, 200)), 'rpm now', y + 168, 28, 18, c);
                    cv.fillRect(ix, y + 188, iw, 2, withAlpha('#ffffff', 0.1));
                }
                const y2 = rev ? y + 188 : y + (room - 110) / 2;
                if (G.isNum(st.min)) { mid('READY IN ABOUT', y2 + 34, 18, t.dim); pair(String(Math.max(1, Math.round(st.min))), 'min', y2 + 92, 56, 24, t.text); }
                else mid('WARMING UP', y2 + 64, 24, t.warn);
            } else if (st.overall === 'ready') {
                lamp(y + room / 2 - 30, GO, 'tick'); mid('UP TO TEMPERATURE', y + room / 2 + 72, 21, GO, { spacing: 1.5 });
            } else if (st.overall === 'hot') {
                lamp(y + room / 2 - 44, t.crit, 'warn'); mid('TOO HOT', y + room / 2 + 62, 30, t.crit);
                cv.text('Ease off and let it cool', cx, y + room / 2 + 94, 19, t.dim, { align: 'center' });
            } else {
                mid(st.overall === 'off' ? 'ENGINE OFF' : 'NO DATA', y + room / 2 + 4, 24, t.dim);
                if (st.overall === 'nodata' && !d.demo) cv.text('waiting for the car', cx, y + room / 2 + 34, 19, t.dim, { align: 'center' });
            }
        }

        /** "Up to temperature", over the screen for ANNOUNCE_MS. */
        function drawAnnounce(cv, t, age, st) {
            const a = G.clamp(Math.min(age / 300, (ANNOUNCE_MS - age) / 500), 0, 1), cx = W / 2, cy = 146, brand = settings.get('branding');
            const dy = brand ? 0 : 50;                                  // without the logo the rest sits lower
            cv.fillRect(0, G.BAR_H, W, H - G.BAR_H, withAlpha('#000000', 0.9 * a));
            cv.arc(cx, cy + dy, 56, 66, 0, 360, withAlpha(GO, a));
            cv.arc(cx, cy + dy, 66, 80, 0, 360, withAlpha(GO, 0.16 * a));
            cv.line(cx - 28, cy + dy + 2, cx - 8, cy + dy + 22, 10, withAlpha(GO, a));
            cv.line(cx - 8, cy + dy + 22, cx + 30, cy + dy - 22, 10, withAlpha(GO, a));
            cv.text('UP TO TEMPERATURE', cx, 286 + dy, 52, withAlpha('#ffffff', a), { align: 'center', font: 'bold', spacing: 5 });
            const counted = FLUIDS.filter((k) => st.fluids[k].counted && st.fluids[k].temp !== null);
            // a gearbox that is left out is named here too, as on the status line
            cv.text(cap(list(counted)) + (counted.length > 1 ? ' are in their safe range' : ' is in its safe range')
                + (st.unwatched.length ? '  ·  ' + list(st.unwatched) + ' not monitored' : ''), cx, 328 + dy, 24, withAlpha(t.dim, a), { align: 'center' });
            // the full logo (PROVEN / PERFORMANCE / SOLUTIONS)
            if (brand && a > 0.5) Logo.draw(cv, cx - 170, 364, 340, 'full');
        }

        let announceAt = 0, lastAnnounce = -Infinity;
        async function render() {
            const t = ctx.theme(), now = mono(), d = src.data(), st = warm.status(now);
            // the announcement is taken every frame, and shown only while it is news: the car is ready now, became so
            // in the last ANNOUNCE_FRESH_MS (not minutes later, when the screen is next opened), and it was not
            // already shown in the last ANNOUNCE_AGAIN_MS
            const due = warm.announce();
            if (due && settings.get('announce') && st.overall === 'ready' && st.readyAt !== null && now - st.readyAt < ANNOUNCE_FRESH_MS
                && now - lastAnnounce > ANNOUNCE_AGAIN_MS) { announceAt = lastAnnounce = now; log.info('up to temperature: announced'); }
            if (st.overall !== 'ready') announceAt = 0;        // no longer true: taken off, and it does not come back
            const cv = ctx.canvas(W, H).clear(t.bg);
            if (settings.get('gaugeStyle') === 'dials') {
                // status line; on its right the revs against the limit while warming up
                Faces.statusStrip(cv, t, 24, G.TOP, 1552, 56, headline(st, d));
                if (st.overall === 'warming' && st.limit > 0 && G.isNum(d.rpm)) {
                    const lw = cv.text(' / ' + rpmText(st.limit) + ' rpm', 1556, G.TOP + 38, 22, t.dim, { align: 'right' });
                    cv.text(rpmText(G.hold('warm-rpm', d.rpm, 200)), 1556 - lw, G.TOP + 40, 36, st.over ? t.crit : t.text, { align: 'right', font: 'num', literal: true });
                }
                FLUIDS.forEach((k) => drawFluid(cv, t, k, st.fluids[k]));
            } else {
                // horizontal bars: status line and three bars on the left, the brand column on the right
                Faces.statusStrip(cv, t, 24, G.TOP, ROWS_W, 56, headline(st, d));
                FLUIDS.forEach((k) => drawFluidBar(cv, t, k, st.fluids[k]));
                drawSide(cv, t, st, d);
            }
            // (taken off at once if the car stops being ready while it shows, so it never covers "Too hot")
            if (announceAt && now - announceAt < ANNOUNCE_MS && st.overall === 'ready') drawAnnounce(cv, t, now - announceAt, st);
            G.frame(cv, t, ['Warm-up'], 0, [(d.demo || fedDemo()) && { text: 'DEMO' }]);
            await ui.image('MAIN_GFX', cv);
        }

        /* ---------- home-screen widget ----------
         * Layout and cells as the kit's eDrive widget (BMW's Drive Recorder widget layout): the big widget shows the
         * drawn picture, the small one the layout's own text lines and progress bar. */
        const wcan = {}, wtext = {};
        const word = (st) => ({ ready: 'UP TO TEMPERATURE', hot: 'TOO HOT', warming: st.over ? 'EASE OFF' : 'WARMING UP', off: 'ENGINE OFF', nodata: 'NO DATA' }[st.overall]);
        const wordColor = (t, st) => (st.overall === 'ready' ? GO : st.overall === 'hot' || st.over ? t.crit : st.overall === 'warming' ? t.warn : t.dim);
        const progress = (st) => { const p = FLUIDS.filter((k) => st.fluids[k].counted).map((k) => st.fluids[k].progress); return p.length ? Math.min.apply(null, p) : 0; };
        function widgetCells(inst, st) {
            const on = !inst.big, n = (k) => (st.fluids[k].temp === null ? '--' : String(Math.round(T(st.fluids[k].temp))));
            const cells = {
                // demo data is marked, so invented temperatures are never taken for the car's
                Title: [on ? (demoShown() ? 'Warm-Up DEMO' : 'Warm-Up') : '', 'Text'],
                // (widget text cells take plain ASCII)
                TextRecordings: [on ? word(st) : '', 'Text'],
                TextCam: [on ? 'Oil ' + n('oil') + '  Gbx ' + n('gearbox') + '  Clt ' + n('coolant') + (isF() ? ' F' : ' C') : '', 'Text'],
                ProgressbarVisible: [on, 'Bool'],
                Progress: [on ? Math.round(progress(st) * 100) / 100 : 0, 'Float'],
                // (a gearbox that is left out is named once the car is called ready)
                TimeElapsed: [!on ? '' : st.limit > 0 && st.overall === 'warming' ? 'below ' + st.limit + ' rpm' : st.overall === 'ready' && st.unwatched.length ? 'no gearbox temp' : '', 'Text'],
                TimeRemaining: [on && G.isNum(st.min) ? '~' + Math.max(1, Math.round(st.min)) + ' min' : '', 'Text'],
            };
            const prev = wtext[inst.spawnId] || (wtext[inst.spawnId] = {});
            Object.keys(cells).forEach((k) => {
                const v = JSON.stringify(cells[k][0]);
                if (prev[k] === v) return;
                prev[k] = v;
                ctx.widget.set(inst.spawnId, k, cells[k][0], cells[k][1]);
            });
        }
        function renderWidget(inst) {
            const sw = ctx.spec.startWidget || {}, [w, h] = sw.size || [384, 256], scale = sw.scale || 1;
            const st = warm.status(mono()), t = ctx.theme();
            if (inst) widgetCells(inst, st);
            const cv = (wcan[w + 'x' + h] = wcan[w + 'x' + h] || new ScaledCanvas(w, h, scale)).clear([0, 0, 0, 0]);
            // the HMI crops and fades the picture's edges: everything stays inside the safe box
            const sf = sw.safe || [0.09, 0.17], x0 = Math.round(w * sf[0]), y0 = Math.round(h * sf[1]), x1 = w - x0, y1 = h - y0, iw = x1 - x0;
            cv.text(word(st), x0, y0 + 18, 18, wordColor(t, st), { font: 'bold', spacing: 1.5 });
            if (G.isNum(st.min)) cv.text('~' + Math.max(1, Math.round(st.min)) + ' min', x1, y0 + 18, 18, t.text, { font: 'bold', align: 'right' });
            const gap = 10, cw = (iw - gap * 2) / 3;
            FLUIDS.forEach((k, i) => {
                const f = st.fluids[k], x = x0 + i * (cw + gap), c = stateColor(t, f.state);
                cv.text(SHORT[k], x, y0 + 46, 12, t.dim, { font: 'bold', spacing: 1 });
                const vw = cv.text(f.temp === null || f.state === 'unused' ? '--' : String(Math.round(T(f.temp))), x, y0 + 92, 42, f.temp === null ? t.dim : f.state === 'ready' ? GO : f.state === 'hot' ? t.crit : t.text, { font: 'num', literal: true });
                cv.text('°', x + vw + 2, y0 + 74, 18, t.dim, { literal: true });
                cv.roundRect(x, y0 + 104, cw, 8, 4, withAlpha(t.track, 0.95));
                if (f.progress > 0.02) cv.roundRect(x, y0 + 104, cw * f.progress, 8, 4, c);
                cv.text(f.state === 'ready' ? 'READY' : f.state === 'hot' ? 'TOO HOT' : f.state === 'unused' ? 'OFF' : f.state === 'none' ? 'NO READING' : 'from ' + Math.round(T(f.ready)) + '°',
                    x, y0 + 130, 12, f.state === 'ready' ? GO : f.state === 'hot' ? t.crit : t.dim, { font: 'bold', spacing: 0.5, literal: true });
            });
            // demo data is marked where the logo otherwise is, so invented temperatures are never taken for the car's
            if (demoShown()) cv.text('DEMO DATA', x0 + iw / 2, y1 - 2, 13, t.warn, { align: 'center', font: 'bold', spacing: 2 });
            else Logo.paint(cv, x0 + (iw - 84) / 2, y1 - 14, 84, 'word');
            return cv.canvas;
        }
        if (ctx.widget) {
            ctx.widget.loop(() => 2, renderWidget);
            ctx.widget.onChange((why) => { if (why === 'resized' || why === 'placed') Object.keys(wtext).forEach((k) => delete wtext[k]); });
        }

        // every screen refresh (60 fps) with the GPU renderer; 5 fps in software
        ctx.loop('MAIN', 5, render);
        tick();
        log.info('Proven Warm-Up: first render');
        render().catch((e) => log.warn('first render: ' + e));
    },
});
