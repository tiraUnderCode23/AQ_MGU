'use strict';
/**
 * Side View (amn_sideview): the camera on the side you signal, on the instrument cluster.
 *
 * Left signal: the left side on the cluster. Right signal: the right side. Signal off: it goes, a moment
 * later. Hazards: nothing. It starts with the car and runs in the background.
 *
 * 0.1 is the half that can be built without knowing where the car's camera pictures are: the turn signal
 * (learned once, parked: hardly anyone has mapped BMW's light status) and the cluster layer, which shows a
 * panel naming the side. The camera picture plugs into that layer once a source is found; "Camera check"
 * lists what the app can see of the unit's cameras toward that.
 *
 * 0.3.0: the camera. While a side is signalled, the camera unit is asked for that side's camera (cam/camera.js:
 * ICAM2Proxy changeState, Drive Recorder's view 3 left / 4 right) and the tool amn-sideview-cam draws its picture in
 * the cluster's centre; the panel shrinks to a badge over it. Toward the car it reads the turn signals and asks the
 * camera unit for a view (what Drive Recorder does); it writes no value and changes no setting. No internet.
 *
 * Node 8 only (the car's version): no ?. ?? import, object spread, class fields, optional catch binding.
 * Nothing may throw out of a callback: every callback goes through guard().
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const { Canvas } = require('./kit/canvas');
const { Turn, CAPTURE_MS } = require('./turn');
// 0.2.0: the turn signals straight from the light module (de.bmw.body.Light); the taught light status is the fallback
const { Indicators } = require('./indicators');
const { SidePanel, PW, PH, BW, BH } = require('./sidepanel');
const camprobe = require('./camprobe');
const { Camera } = require('./camera');
// 0.5.0: the screen in IPTV's design (full screen: its rail, pills and cards), Inter as in HUD and IPTV
// 0.5.1: the camera claim survives no update: kept in /dev/shm, an earlier copy's put on standby and given back at
// start, and given back on SIGTERM (the cluster flickered between two views after a Store update)
const FS = require('./kit/fullscreen');
const G = require('./kit/gauges');
const fonts = require('./kit/fonts');
const pack = require('./kit/pack');

const VERSION = '0.5.4';
const W = 1600, H = 520;
const LIGHT = ['de.bmw.infotainment.vehicle.Vehicle2', '1', 'statusLightStatus'];
const BODY_LIGHT = ['de.bmw.body.Light', '1', ['StatusFunctionsIndicators', 'StatusFunctionsIndicators2']];
const POLL_MS = 300;              // the light status re-read this often (the car may not notify each flash)
const TICK_MS = 100;              // the side decided this often

const C = {
    bg: '#000000', card: '#1c1c1e', pill: '#26262a', rail: '#161618',
    text: '#ffffff', dim: '#98989f', faint: '#636366',
    accent: '#2f7df6', accentDim: '#0f2340',     // 0.5.0: the apps' one accent, BMW M blue (the turn signals stay amber)
    mLight: '#5fb4ff', mDark: '#1c69d4', mRed: '#e2001a',
    green: '#30d158', amber: '#ff9f0a', red: '#ff453a', grey: '#636366', blue: '#64d2ff',
};
const A = (c, a) => { const s = String(c).replace('#', '').slice(0, 6); return '#' + s + ('0' + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16)).slice(-2); };
let B = { font: 'bold' }, M = { font: 'label' };

function fit(cv, s, size, w, o) {
    s = String(s || '');
    if (cv.textWidth(s, size, o) <= w) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cv.textWidth(s.slice(0, mid) + '...', size, o) <= w) lo = mid; else hi = mid - 1; }
    return s.slice(0, lo) + '...';
}
function wrap(cv, s, size, w, max, o) {
    const words = String(s || '').split(/\s+/).filter(Boolean), out = [];
    let cur = '';
    words.forEach((word) => { const n = cur ? cur + ' ' + word : word; if (!cur || cv.textWidth(n, size, o) <= w) cur = n; else { out.push(cur); cur = word; } });
    if (cur) out.push(cur);
    if (out.length > max) { const rest = out.slice(max - 1).join(' '); out.length = max - 1; out.push(fit(cv, rest, size, w, o)); }
    return out;
}
/** A turn-signal arrow pointing dir (-1 left, 1 right), centred on cx, cy, s wide. */
function arrow(cv, cx, cy, s, dir, c) {
    const h = s * 0.62, head = s * 0.5, shaft = h * 0.42;
    const tip = cx + dir * s / 2, base = tip - dir * head, tail = cx - dir * s / 2;
    // quad() only: the screen's recorder has no triangle or convex (the head is a quad with the tip twice)
    cv.quad([[tip, cy], [base, cy - h / 2], [base, cy + h / 2], [tip, cy]], c);
    cv.quad([[base + dir * 1, cy - shaft / 2], [tail, cy - shaft / 2], [tail, cy + shaft / 2], [base + dir * 1, cy + shaft / 2]], c);
}

/** The cluster panel for a side (PW x PH, opaque RGBA); badge: the small one over the camera picture (BW x BH). */
let camText = 'Camera feed not connected yet';
function panelImage(side, badge) {
    const dir = side === 'left' ? -1 : 1;
    if (badge) {
        const bv = new Canvas(BW, BH);
        bv.clear('#000000');
        bv.card(0, 0, BW, BH, BH / 2, [[0, '#141b28'], [1, '#06080d']]);
        bv.strokeRoundRect(1, 1, BW - 2, BH - 2, BH / 2 - 1, 2, A(C.amber, 0.7));
        arrow(bv, side === 'left' ? 46 : BW - 46, BH / 2, 46, dir, C.amber);
        bv.text(side === 'left' ? 'LEFT' : 'RIGHT', side === 'left' ? 84 : BW - 84, BH / 2 + 12, 32, C.text, { font: 'bold', align: side === 'left' ? 'left' : 'right', spacing: 2 });
        const bd = Buffer.from(bv.d.buffer, bv.d.byteOffset, bv.d.length);
        for (let i = 3; i < bd.length; i += 4) bd[i] = 255;
        return { w: BW, h: BH, d: Buffer.from(bd) };
    }
    const cv = new Canvas(PW, PH);
    cv.clear('#000000');
    cv.card(0, 0, PW, PH, 36, [[0, '#141b28'], [1, '#06080d']]);
    cv.strokeRoundRect(1, 1, PW - 2, PH - 2, 35, 2, A(C.amber, 0.55));
    arrow(cv, PW / 2, 150, 200, dir, C.amber);
    cv.text(side === 'left' ? 'LEFT SIDE' : 'RIGHT SIDE', PW / 2, 300, 52, C.text, { font: 'bold', align: 'center', spacing: 3 });
    cv.text(camText, PW / 2, 352, 26, C.dim, { font: 'label', align: 'center' });
    const d = Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length);
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    return { w: PW, h: PH, d: Buffer.from(d) };
}

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const guard = (name, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { log.error('error in ' + name + ': ' + (e && e.stack || e)); return undefined; }
        };
        try {
            /* ---------- what was learned, kept in the data folder ---------- */
            const FILE = path.join(ctx.dataDir || __dirname, 'turn-signals.json');
            let saved = null;
            try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first start */ }
            const T = new Turn(saved);
            const D = new Indicators();
            const ready = () => D.live() || T.ready();
            const sideNow = (now) => (D.live() ? D.side(now, holdMs()) : T.ready() ? T.side(now, holdMs()) : null);
            const litNow = (s, now) => (D.live() ? D.lit(s) : T.lit(s, now));
            const hazards = (now) => (D.live() ? D.state === 'hazard' : T.lit('left', now) && T.lit('right', now));
            const save = () => {
                try { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(T.learned(), null, 1)); fs.renameSync(tmp, FILE); }
                catch (e) { log.warn('save: ' + e.message); }
            };
            let toast = null;
            const say = (text, ms) => { toast = { text: text, until: Date.now() + (ms || 4000) }; };
            let page = 'main', cams = null, sigs = null, test = null, light = { state: 'connecting', n: 0, at: 0 };

            /* ---------- the car's light status ---------- */
            if (ctx.signals && ctx.signals.watch) {
                const h = {};
                h[LIGHT[2]] = guard('light', (v) => {
                    const now = Date.now();
                    light.n++; light.at = now; light.state = 'on';
                    if (T.capturing(now)) log.info('light (' + T.capturing(now) + '): ' + JSON.stringify(v));
                    T.feed('light', v, now);
                });
                ctx.signals.watch(LIGHT[0], LIGHT[1], h, log, { pollMs: POLL_MS })
                    .then((s) => { if (s.error) { light.state = 'error'; light.err = s.error; } log.info('light status: ' + (s.error ? 'error: ' + s.error : 'subscribed')); })
                    .catch((e) => { light.state = 'error'; light.err = e.message; log.warn('light status: ' + e.message); });
            } else light.state = 'error';

            /* ---------- 0.2.0: the light module's turn-signal status ---------- */
            if (ctx.signals && ctx.signals.watch) {
                const h = {};
                let logged = 0;
                BODY_LIGHT[2].forEach((f) => {
                    h[f] = guard(f, (v) => {
                        const was = D.state, st = D.feed(v, Date.now());
                        if (st !== was || logged < 3) { logged++; log.info('indicators (' + f + '): ' + JSON.stringify(v) + ' -> ' + st); }
                    });
                });
                ctx.signals.watch(BODY_LIGHT[0], BODY_LIGHT[1], h, log)
                    .then((s2) => { D.err = s2.error || null; log.info('indicators: ' + (s2.error ? 'error: ' + s2.error : 'subscribed')); })
                    .catch((e) => { D.err = e.message; log.warn('indicators: ' + e.message); });
            }

            /* ---------- the cluster ---------- */
            const panel = new SidePanel({ log: log, app: 'amn_sideview', draw: panelImage });
            const holdMs = () => Number(settings.get('hold')) || 1500;
            const camOn = () => settings.get('camera') !== false;
            const cam = new Camera({ ctx: ctx, log: log, enabled: camOn, night: () => settings.get('night') === true,
                cookieFile: path.join(ctx.dataDir || __dirname, 'camera-cookie') });
            cam.start();
            let lastSide = null;
            setInterval(guard('tick', () => {
                const now = Date.now();
                const done = T.tick(now);
                if (done) {
                    say(done.text, 6000);
                    log.info('learn ' + done.which + ': ' + done.text + ' ' + JSON.stringify(T.learned().marks));
                    save();
                }
                let side = settings.get('cluster') && ready() ? sideNow(now) : null;
                if (test && now < test.until) side = test.side; else test = null;
                if (side !== lastSide) { log.info('side: ' + (side || 'none')); lastSide = side; }
                // 0.3.1: no side signalled -> the front camera, if Settings say so (never during hazards)
                const idle = !side && camOn() && settings.get('front') !== false && ready() && !hazards(now);
                cam.set(side || (idle ? 'front' : null));
                const nt = !camOn() ? 'Camera off in Settings' : cam.view().kind === 'error' ? cam.view().text : 'Camera starting...';
                if (nt !== camText) { camText = nt; panel.drawn = null; }
                panel.show(side, !!side && cam.showing());
            }), TICK_MS);
            // 0.5.1: a Store update or the app manager stops the app with SIGTERM, which ends Node without its 'exit'
            // work: the camera claim stayed asking its view. Give it back first (2 s at most), then end.
            let stopping = false;
            const stop = (why) => {
                if (stopping) return; stopping = true;
                log.info('stopping (' + why + '): giving the camera back');
                try { panel.close(); } catch (e) { /* closing */ }
                cam.close(2000).then(() => process.exit(0), () => process.exit(0));
            };
            process.once('SIGTERM', () => stop('SIGTERM'));
            process.once('SIGINT', () => stop('SIGINT'));
            process.once('SIGHUP', () => stop('SIGHUP'));
            process.once('exit', () => { try { cam.close(); } catch (e) { /* closing */ } try { panel.close(); } catch (e) { /* closing */ } });

            /* ---------- the buttons ---------- */
            const teach = (which, label) => guard(which, () => {
                if (light.state !== 'on') { say('No light status from the car yet - cannot learn', 5000); return; }
                if (which !== 'off' && !T.base) { say('First tap Signals off, with both signals off', 5000); return; }
                T.capture(which, Date.now());
                say(label, CAPTURE_MS);
                log.info('learn ' + which + ': recording');
            });
            ui.onClick('BTN_OFF', teach('off', 'Recording: keep both signals off'));
            ui.onClick('BTN_LEFT', teach('left', 'Recording: keep the LEFT signal on'));
            ui.onClick('BTN_RIGHT', teach('right', 'Recording: keep the RIGHT signal on'));
            ui.onClick('BTN_TEST', guard('test', () => {
                const now = Date.now(), side = test && test.side === 'left' ? 'right' : 'left';
                test = { side: side, until: now + 8000 };
                say('Test: the ' + side + ' camera on the cluster for 8 s');
            }));
            ui.onClick('BTN_NIGHT', guard('night', () => {
                const on = settings.get('night') !== true;
                settings.set('night', on);
                say(on ? 'Night look: on (black and white, bright highlights)' : 'Night look: off (normal colours)');
            }));
            ui.onClick('BTN_CAMS', guard('cams', () => {
                if (page === 'cams') { page = 'cameras'; return; }
                cams = camprobe.probe();
                sigs = camprobe.findSignals();
                page = 'cams';
                camprobe.lines(cams).forEach((l) => log.info('camera check: ' + l));
                log.info('signal finder: ' + sigs.files.join(', ') + (sigs.error ? ' error: ' + sigs.error : '') + ' - ' + sigs.hits.length + ' hits');
                sigs.hits.forEach((h) => log.info('signal finder: ' + h));
            }));
            settings.onChange(guard('settings', (k) => { if (k === 'cluster') say(settings.get('cluster') ? 'Cluster: on' : 'Cluster: off'); }));

            /* ---------- the centre screen: IPTV's design (0.5.0) ---------- */
            try {
                const dirs = [path.join(__dirname, 'fonts'), path.join(__dirname, 'data', 'fonts')];
                const src = pack.open(fs.existsSync(dirs[0] + '.pack') || fs.existsSync(dirs[0]) ? dirs[0] : dirs[1]);
                if (fonts.register('cl_bold', src.json('cl_bold.json'))) B = { font: 'cl_bold', literal: true };
                if (fonts.register('cl_med', src.json('cl_med.json'))) M = { font: 'cl_med', literal: true };
            } catch (e) { log.warn('fonts: ' + e.message); }
            const btn = (cv, key, x, y, w, h, fn, r) => FS.button(cv, key, x, y, w, h, guard(key, fn), { r: r != null ? r : 16, slop: 4 });
            const DOT = { on: C.green, wait: C.amber, off: C.grey, error: C.red };
            const testSide = (side) => { test = { side: side, until: Date.now() + 8000 }; say('Test: the ' + side + ' camera on the cluster for 8 s'); };
            if (page === 'main') page = 'cameras';

            function icon(cv, kind, cx, cy, col) {
                if (kind === 'cameras') {          // the car from above
                    cv.strokeRoundRect(cx - 9, cy - 16, 18, 32, 8, 3.5, col);
                    cv.line(cx - 6, cy - 5, cx + 6, cy - 5, 3, col);
                    cv.line(cx - 19, cy - 3, cx - 13, cy - 3, 3, col); cv.line(cx + 13, cy - 3, cx + 19, cy - 3, 3, col);
                } else if (kind === 'cams') {      // a check list
                    [-9, 0, 9].forEach((o) => { cv.circle(cx - 11, cy + o, 2.6, col); cv.line(cx - 5, cy + o, cx + 14, cy + o, 3, col); });
                }
            }
            function rail(cv, Ar) {
                const x = Ar.x, w = 108;
                cv.roundRect(x, Ar.y, w, Ar.h, 28, C.rail);
                const items = [['cameras', 'Cameras'], ['cams', 'Car check']];
                const step = 96;
                items.forEach((it, i) => {
                    const cy = Ar.y + 24 + i * step + step / 2;
                    const on = page === it[0];
                    if (on) cv.roundRect(x + 8, cy - step / 2 + 6, w - 16, step - 12, 20, C.accentDim);
                    const col = on ? C.accent : '#e8e8ec';
                    icon(cv, it[0], x + w / 2, cy - 12, col);
                    cv.text(it[1], x + w / 2, cy + 26, 15, col, Object.assign({ align: 'center' }, on ? B : M));
                    btn(cv, 'rail_' + it[0], x + 6, cy - step / 2 + 4, w - 12, step - 8, () => {
                        page = it[0];
                        if (page === 'cams') { cams = camprobe.probe(); sigs = camprobe.findSignals(); }
                    }, 20);
                });
                const by = Ar.y + Ar.h - 34, bx = x + w / 2 - 21;
                [C.mLight, C.mDark, C.mRed].forEach((c, k) => cv.quad([[bx + k * 15 + 5, by], [bx + k * 15 + 14, by], [bx + k * 15 + 9, by + 14], [bx + k * 15, by + 14]], c));
            }
            function toggle(cv, key, x, y, label, on, fn) {
                const h = 52, w = cv.textWidth(label, 20, B) + 96;
                cv.roundRect(x, y, w, h, h / 2, on ? C.accentDim : C.pill);
                cv.text(label, x + 24, y + h / 2 + 7, 20, on ? C.text : C.dim, B);
                const sx = x + w - 62, sy = y + h / 2 - 13;
                cv.roundRect(sx, sy, 46, 26, 13, on ? C.accent : '#3a3a3e');
                cv.circle(on ? sx + 33 : sx + 13, sy + 13, 10, C.text);
                btn(cv, key, x, y, w, h, fn, h / 2);
                return w;
            }
            function topBar(cv, Ar, x0) {
                const y = Ar.y, h = 52;
                let x = x0;                               // no title pill: the car's header names the app
                x += toggle(cv, 'tg_cam', x, y, 'Camera', camOn(), () => settings.set('camera', !camOn())) + 14;
                x += toggle(cv, 'tg_front', x, y, 'Front camera', settings.get('front') !== false, () => settings.set('front', settings.get('front') === false)) + 14;
                toggle(cv, 'tg_night', x, y, 'Night look', settings.get('night') === true, () => settings.set('night', settings.get('night') !== true));
            }
            function chips(cv, x0, y, right, items) {
                const gap = 12, h = 46, w = (right - x0 - gap * (items.length - 1)) / items.length;
                items.forEach((it, k) => {
                    const x = x0 + k * (w + gap);
                    cv.roundRect(x, y, w, h, h / 2, C.card);
                    cv.circle(x + 24, y + h / 2, 6, it[1]);
                    cv.text(it[0], x + 40, y + h / 2 + 6, 15, C.dim, B);
                    const lw = cv.textWidth(it[0], 15, B);
                    cv.text(fit(cv, it[2], 17, w - 60 - lw, M), x + 50 + lw, y + h / 2 + 6, 17, C.text, M);
                });
            }

            /* the Cameras page */
            function drawCameras(cv, Ar, x0, now) {
                const top = Ar.y + 76;
                const side = ready() ? sideNow(now) : null, testOn = test && now < test.until;
                const showing = testOn ? test.side : side || (camOn() && settings.get('front') !== false && ready() && !hazards(now) ? 'front' : null);
                cv.text('On the cluster', x0, top + 4, 26, C.text, B);
                // the car card
                const cw = 560, ch = Ar.bottom - top - 88, cx0 = x0, cy0 = top + 22;
                cv.roundRect(cx0, cy0, cw, ch, 24, C.card);
                const mx = cx0 + cw / 2, my = cy0 + ch / 2 - 6, bw = 92, bh = 190;
                cv.roundRect(mx - bw / 2, my - bh / 2, bw, bh, 40, '#2c2c30');
                cv.roundRect(mx - bw / 2 + 12, my - bh / 2 + 40, bw - 24, 42, 12, '#0e0e10');
                cv.roundRect(mx - bw / 2 + 14, my + bh / 2 - 52, bw - 28, 28, 10, '#0e0e10');
                cv.roundRect(mx - bw / 2 - 16, my - bh / 2 + 58, 18, 10, 4, '#2c2c30');
                cv.roundRect(mx + bw / 2 - 2, my - bh / 2 + 58, 18, 10, 4, '#2c2c30');
                ['left', 'right'].forEach((s2) => {
                    const dir = s2 === 'left' ? -1 : 1, on = litNow(s2, now), held = showing === s2;
                    arrow(cv, mx + dir * 150, my, 70, dir, on ? C.amber : held ? A(C.amber, 0.4) : A('#ffffff', 0.12));
                });
                if (showing === 'front') { const ty = my - bh / 2 - 28; cv.line(mx - 22, ty + 14, mx, ty - 8, 6, C.text); cv.line(mx, ty - 8, mx + 22, ty + 14, 6, C.text); }
                const label = !ready() ? 'Waiting for the turn signals' : hazards(now) ? 'Hazards: nothing shown' :
                    showing ? (showing === 'front' ? 'Front camera' : showing === 'left' ? 'Left camera' : 'Right camera') + (testOn ? '  ·  test' : '') : 'Nothing on the cluster';
                cv.text(label, mx, cy0 + ch - 30, 22, showing ? C.text : C.dim, Object.assign({ align: 'center' }, B));
                // right: the big state, and the tests
                const rx = cx0 + cw + 48, rw = Ar.right - rx;
                cv.text('Now showing', rx, cy0 + 40, 18, C.dim, B);
                const big = !showing ? 'Off' : showing === 'front' ? 'Front' : showing === 'left' ? 'Left' : 'Right';
                cv.text(big, rx, cy0 + 120, 76, showing ? C.text : C.faint, B);
                const night = settings.get('night') === true;
                cv.text(night ? 'Night look: black and white, lit things bright' : 'Normal colours', rx, cy0 + 162, 19, night ? C.blue : C.dim, M);
                const by = cy0 + 210, pw = Math.min(220, (rw - 16) / 2);
                [['left', 'Test left'], ['right', 'Test right']].forEach((t, k) => {
                    const bx = rx + k * (pw + 16);
                    cv.roundRect(bx, by, pw, 52, 26, k === 0 ? C.accent : C.pill);
                    cv.text(t[1], bx + pw / 2, by + 33, 20, C.text, Object.assign({ align: 'center' }, B));
                    btn(cv, 'test_' + t[0], bx, by, pw, 52, () => testSide(t[0]), 26);
                });
                cv.text(fit(cv, 'Left signal: left camera  ·  right: right  ·  none: front  ·  hazards: nothing', 18, rw, M), rx, by + 88, 18, C.dim, M);
                const pv = panel.view(), cvw = cam.view();
                chips(cv, x0, Ar.bottom - 46, Ar.right, [
                    ['Signals', D.live() || T.ready() ? C.green : C.amber, D.live() ? 'From the car' : T.ready() ? 'Learned' : 'Waiting'],
                    ['Cluster', !settings.get('cluster') ? C.grey : DOT[pv.kind] || C.grey, settings.get('cluster') ? pv.text : 'Off in Settings'],
                    ['Camera', DOT[cvw.kind] || C.grey, cvw.text],
                    ['Version', C.grey, VERSION],
                ]);
            }

            /* the Car check page */
            function drawCheck(cv, Ar, x0, now) {
                const top = Ar.y + 76;
                cv.text('Car check', x0, top + 4, 26, C.text, B);
                const lw = (Ar.right - x0 - 24) / 2, ch = Ar.bottom - top - 22;
                // camera steps
                cv.roundRect(x0, top + 22, lw, ch, 24, C.card);
                cv.text('Camera', x0 + 28, top + 64, 20, C.accent, B);
                cam.lines().forEach((l, k) => {
                    const p2 = l.indexOf(':'), key = p2 > 0 ? l.slice(0, p2) : l, val = p2 > 0 ? l.slice(p2 + 1).trim() : '';
                    const y = top + 106 + k * 52;
                    cv.text(key, x0 + 28, y, 18, C.dim, M);
                    cv.text(fit(cv, val, 19, lw - 220, M), x0 + 200, y, 19, C.text, M);
                    if (k < 4) cv.fillRect(x0 + 28, y + 20, lw - 56, 1, '#2c2c30');
                });
                // turn signals (and teaching, for a car that does not report them)
                const tx = x0 + lw + 24;
                cv.roundRect(tx, top + 22, lw, ch, 24, C.card);
                cv.text('Turn signals', tx + 28, top + 64, 20, C.accent, B);
                if (D.live()) {
                    const st = { left: 'Left', right: 'Right', hazard: 'Hazards', off: 'Off', other: 'Off' }[D.state] || '-';
                    cv.text(st, tx + 28, top + 150, 60, D.state === 'left' || D.state === 'right' ? C.accent : C.text, B);
                    wrap(cv, 'From the car\'s light module: nothing to teach.', 19, lw - 56, 2, M).forEach((r, k) => cv.text(r, tx + 28, top + 196 + k * 26, 19, C.dim, M));
                    cv.text(fit(cv, 'Light module: ' + JSON.stringify(D.raw), 15, lw - 56, M), tx + 28, top + ch - 6, 15, C.faint, M);
                } else {
                    const steps = [['off', 'Both signals off', !!T.base], ['left', 'Left signal on', T.has('left')], ['right', 'Right signal on', T.has('right')]];
                    const cap = T.capturing(now);
                    steps.forEach((st2, k) => {
                        const y = top + 100 + k * 66, rec = cap === st2[0];
                        cv.circle(tx + 46, y + 18, 16, rec ? C.amber : st2[2] ? C.green : '#3a3a3e');
                        cv.text(st2[1], tx + 76, y + 25, 20, C.text, M);
                        const bx = tx + lw - 160;
                        cv.roundRect(bx, y, 132, 40, 20, C.pill);
                        cv.text(rec ? 'Recording' : 'Record', bx + 66, y + 27, 17, C.text, Object.assign({ align: 'center' }, B));
                        btn(cv, 'teach_' + st2[0], bx, y, 132, 40, teach(st2[0], st2[0] === 'off' ? 'Recording: keep both signals off' : 'Recording: keep the ' + st2[0].toUpperCase() + ' signal on'), 20);
                    });
                }
            }

            FS.setup(ctx);
            ctx.loop('MAIN', 6, guard('draw', async () => {
                const now = Date.now(), cv = ctx.canvas(W, H), Ar = FS.area(cv), fullH = H + (cv.extra || 0);
                if (cv.chrome) G.frame(cv, ctx.theme(), ['Side View'], 0, []);
                cv.fillRect(0, 0, W, fullH, C.bg);
                rail(cv, Ar);
                const x0 = Ar.x + 128;
                topBar(cv, Ar, x0);
                if (page === 'cams') drawCheck(cv, Ar, x0, now); else drawCameras(cv, Ar, x0, now);
                if (toast && now < toast.until) {
                    const s2 = fit(cv, toast.text, 19, 800, B), tw = cv.textWidth(s2, 19, B) + 52;
                    cv.roundRect(Ar.right - tw, Ar.bottom - 50, tw, 46, 23, A('#2c2c30', 0.97));
                    cv.text(s2, Ar.right - tw / 2, Ar.bottom - 20, 19, C.text, Object.assign({ align: 'center' }, B));
                }
                await ui.image('MAIN_GFX', cv);
            }));

            log.info('started ' + VERSION + ', signals ' + (T.ready() ? 'learned' : 'not learned') + ', cluster ' + (settings.get('cluster') ? 'on' : 'off'));
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
