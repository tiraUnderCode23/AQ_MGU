'use strict';
/**
 * Drive — one screen for the trip you are on.
 * Speed, gear, oil, coolant, distance, moving time and average speed.
 * Distance is summed from the car's own speed. Reset starts the trip again.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const Car = require('./kit/car');
const { startHud, startCluster } = require('./drive_hud');
const { STYLES, drawProjection } = require('./proj');
const { STYLES: CLUSTERS, drawCluster } = require('./cluster');
const ask = require('./ask');
const radar = require('./radar');
const { startGps } = require('./gps');

const W = 1600;
const H = 520;
const MPH = 1.609344;
const PREVIEW = { nx: 280, ny: 56, nw: 1040, nh: 176 };

mgu.run({
    async start(ctx) {
        const { ui } = ctx;
        const car = new Car(ctx, ['rpm', 'speed', 'temps', 'gear']);
        const gps = startGps(ctx);

        function alertOf(d) {
            const now = Date.now();
            const spd = G.isNum(d.speed) ? d.speed : 0;
            gps.step(spd, now);
            const here = gps.pos.lat == null ? null : gps.pos;
            return radar.tick(here, spd, ctx.settings.get('camAlert') !== false, now);
        }

        let metres = 0;
        let moveMs = 0;
        let lastT = 0;
        let lastKmh = 0;

        car.onSample((d, t) => {
            const kmh = G.isNum(d.speed) && d.speed > 0 ? d.speed : 0;
            if (!lastT) {
                lastT = t;
                lastKmh = kmh;
                return;
            }
            const dt = Math.min(1000, Math.max(0, t - lastT));
            lastT = t;
            metres += ((lastKmh + kmh) / 2) * (dt / 1000) / 3.6;
            lastKmh = kmh;
            if (kmh > 1) moveMs += dt;
        }, () => {
            metres = 0;
            moveMs = 0;
            lastT = 0;
            lastKmh = 0;
        });

        const OCTANE = ['95', '98', '100', '102'];
        const octane = () => {
            const v = String(ctx.settings.get('octane') || '98');
            return OCTANE.indexOf(v) >= 0 ? v : '98';
        };
        function nextOctane() {
            const i = OCTANE.indexOf(octane());
            ctx.settings.set('octane', OCTANE[(i + 1) % OCTANE.length]);
            return render();
        }

        const mph = () => ctx.settings.get('speedUnit') === 'mph';
        const speedOf = (kmh) => (mph() ? kmh / MPH : kmh);
        const distOf = (m) => (mph() ? (m / 1000) / MPH : m / 1000);

        function clock(ms) {
            const s = Math.floor(ms / 1000);
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = s % 60;
            const p = (n) => (n < 10 ? '0' : '') + n;
            return h > 0 ? h + ':' + p(m) + ':' + p(sec) : p(m) + ':' + p(sec);
        }

        let page = 0;
        let vow = 0;
        let askShift = Number(ctx.settings.get('askShift')) || 0;
        function nudgeAsk() {
            askShift += 70;
            if (askShift > 280) askShift = 0;
            ctx.settings.set('askShift', String(askShift));
            return render();
        }

        function look(d) {
            const g = ctx.settings;
            const id = g.get('projStyle') || 'arc';
            const style = STYLES.find((item) => item.id === id) || STYLES[0];
            const redline = Number(g.get('projRedline')) || 7000;
            const rpm = d && G.isNum(d.rpm) ? d.rpm : 0;
            const flash = g.get('projFlash') !== false;
            return {
                id: style.id,
                name: style.name,
                accent: g.get('projAccent') || '#9fd0ff',
                text: g.get('projText') || '#f4f7fb',
                red: g.get('projRed') || '#ff3b3b',
                font: g.get('projFont') || 'num',
                size: Number(g.get('projSize')) || 100,
                height: Number(g.get('projHeight')) || 0,
                redline: redline,
                flash: flash,
                blink: rpm >= redline && flash && ((Date.now() / 160) | 0) % 2 === 0,
            };
        }

        function reset() {
            metres = 0;
            moveMs = 0;
            lastT = 0;
            lastKmh = 0;
            return render();
        }

        function gearText(d) {
            const st = d.stage;
            const gr = d.gear;
            if (st === 'P' || st === 'R' || st === 'N') return st;
            if (gr === -1) return 'R';
            if (G.isNum(gr) && gr > 0) return String(gr);
            if (st === 'D') return 'D';
            if (gr === 0) return 'N';
            return '-';
        }

        function snapOf(d) {
            const spd = G.isNum(d.speed) ? speedOf(d.speed) : null;
            return {
                speed: spd === null ? '--' : String(Math.round(spd)),
                unit: mph() ? 'mph' : 'km/h',
                gear: gearText(d),
                rpm: G.isNum(d.rpm) ? String(Math.round(d.rpm)) : '--',
                rpmN: G.isNum(d.rpm) ? d.rpm : 0,
                speedN: spd === null ? 0 : spd,
                kmh: G.isNum(d.speed) ? d.speed : 0,
                coolant: G.isNum(d.coolant) ? String(Math.round(d.coolant)) : '--',
                oil: G.isNum(d.oil) ? String(Math.round(d.oil)) : '--',
                trip: (metres / 1000).toFixed(1),
            };
        }

        function drawDrive(cv, t, d) {
            const unit = mph() ? 'mph' : 'km/h';
            const distUnit = mph() ? 'mi' : 'km';
            const spd = G.isNum(d.speed) ? speedOf(d.speed) : null;
            const rpm = G.isNum(d.rpm) ? Math.round(d.rpm) : null;

            G.stat(cv, t, 24, 44, 700, 468, {
                label: 'Speed',
                value: spd,
                decimals: 0,
                unit: unit,
                size: 120,
            });
            G.button(cv, t, 48, 268, 220, 56, 'Projection', () => {
                page = 1;
                return render();
            }, { key: 'open-proj', primary: true });
            G.button(cv, t, 284, 268, 220, 56, 'Cluster', () => {
                page = 3;
                return render();
            }, { key: 'open-cluster' });
            cv.text(look(d).name, 48, 348, 22, t.dim, { font: 'bold', spacing: 1 });
            cv.text(hud.status(), 48, 376, 16, t.dim, { font: 'label' });
            cv.text(rpm === null ? '' : rpm + ' rpm', 360, 376, 16, t.dim, { font: 'label' });
            G.button(cv, t, 48, 400, 220, 52, 'Octane ' + octane(), nextOctane, { key: 'octane', primary: true });
            G.button(cv, t, 284, 400, 180, 52, 'Настя', () => {
                vow = 1;
                return render();
            }, { key: 'nastya', color: '#c45b74' });

            G.panel(cv, t, 744, 44, 360, 468, 'Gear');
            G.gear(cv, t, 924, 340, {
                gear: d.gear,
                stage: d.stage,
                guessed: d.gearGuessed,
                size: 200,
            });

            G.stat(cv, t, 1124, 44, 452, 150, {
                label: 'Coolant',
                value: d.coolant,
                decimals: 0,
                unit: '°C',
                size: 56,
                zones: [{ from: 110, color: 'crit' }],
            });
            G.stat(cv, t, 1124, 206, 452, 150, {
                label: 'Oil',
                value: d.oil,
                decimals: 0,
                unit: '°C',
                size: 56,
                zones: [{ from: 125, color: 'crit' }],
            });

            const km = distOf(metres);
            const hours = moveMs / 3600000;
            const avg = hours > 0.0001 ? speedOf((metres / 1000) / hours) : null;
            G.panel(cv, t, 1124, 368, 452, 144, null);
            cv.text(km < 100 ? km.toFixed(1) : String(Math.round(km)), 1144, 430, 42, t.text, { font: 'num' });
            cv.text(distUnit, 1144, 468, 22, t.dim, { font: 'bold' });
            cv.text(clock(moveMs), 1320, 430, 42, t.text, { font: 'num' });
            cv.text(avg === null ? '--' : Math.round(avg) + ' ' + unit, 1320, 468, 22, t.dim, { font: 'bold' });

            G.frame(cv, t, ['Drive', 'Projection', 'Cameras', 'Cluster'], page, [d.demo && { text: 'DEMO' }]);
            G.button(cv, t, 500, 64, 150, 40, 'Reset trip', reset, { key: 'reset', confirm: true });
        }

        function drawPicker(cv, t, d) {
            const s = snapOf(d);
            const view = look(d);
            drawProjection(cv, PREVIEW, view, s, false);
            cv.text(view.name + '  ·  ' + hud.status(), 48, 252, 16, t.dim, { font: 'label' });
            cv.text('Settings: size, height, font, colours, redline', 48, 274, 16, t.dim, { font: 'label' });
            const cols = 5;
            const bw = 300;
            const bh = 44;
            const gap = 12;
            const x0 = 36;
            const y0 = 300;
            STYLES.forEach((item, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                G.button(cv, t, x0 + col * (bw + gap), y0 + row * (bh + gap), bw, bh, item.name, () => {
                    ctx.settings.set('projStyle', item.id);
                    return render();
                }, { key: 'p' + item.id, primary: item.id === view.id });
            });
            G.frame(cv, t, ['Drive', 'Projection', 'Cameras', 'Cluster'], page, [d.demo && { text: 'DEMO' }]);
        }

        function drawClusterPage(cv, t, d) {
            const id = ctx.settings.get('clusterStyle') || 'off';
            const view = look(d);
            const s = snapOf(d);
            const big = id === 'fdial';
            const wide = id === 'm5x' || id === 'amgs' || id === 'bmwr' || id === 'm2x' || id === 'wing' || id === 'split' || id === 'pods' || id === 'night' || id === 'amgc';
            if (id === 'off') {
                cv.fillRect(24, 42, 1552, 248, '#101318');
                cv.text('Stock cluster', 48, 140, 36, t.text, { font: 'bold' });
                cv.text('A style replaces the map in the middle. Side gauges stay.', 48, 186, 20, t.dim, { font: 'label' });
            } else if (big) {
                drawCluster(cv, { nx: 615, ny: 2, nw: 372, nh: 372 }, id, s, view);
            } else if (wide) {
                drawCluster(cv, { nx: 0, ny: 34, nw: 1600, nh: 372 }, id, s, view);
            } else {
                drawCluster(cv, { nx: 24, ny: 42, nw: 1552, nh: 248 }, id, s, view);
            }
            if (!wide) cv.text(cluster.status(), 24, big ? 24 : 308, 14, t.dim, { font: 'label' });
            const cols = wide ? 8 : 7;
            const bw = wide ? 188 : 210;
            const bh = wide ? 22 : big ? 26 : 32;
            const gap = wide ? 4 : big ? 5 : 8;
            const y0 = big ? 378 : wide ? 412 : 324;
            CLUSTERS.forEach((item, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                G.button(cv, t, 24 + col * (bw + gap), y0 + row * (bh + gap), bw, bh, item.name, () => {
                    ctx.settings.set('clusterStyle', item.id);
                    return render();
                }, { key: 'c' + item.id, primary: item.id === id });
            });
            G.frame(cv, t, ['Drive', 'Projection', 'Cameras', 'Cluster'], page, [d.demo && { text: 'DEMO' }]);
        }

        function drawCams(cv, t, d, alert) {
            const src = gps.pos.src === 'car' ? 'Car GPS' : gps.pos.src === 'test' ? 'Test drive' : 'No GPS yet';
            G.stat(cv, t, 24, 56, 760, 280, {
                label: alert.on ? 'Camera ahead' : 'Nearest camera',
                value: alert.dist == null ? null : alert.dist,
                decimals: 0,
                unit: 'm',
                size: 120,
                sub: alert.road || (alert.kind === 'light' ? 'red light' : 'speed'),
            });
            G.panel(cv, t, 820, 56, 740, 280, 'Warsaw');
            cv.text(String(alert.n), 848, 170, 48, t.text, { font: 'num' });
            cv.text('cameras', 960, 168, 28, t.dim, { font: 'bold' });
            cv.text(src, 848, 210, 28, t.dim, { font: 'bold' });
            cv.text(alert.on ? 'Beeping. Closer is faster.' : 'Beep starts at 300 m, for at least 5 s.', 848, 260, 22, t.dim, { font: 'label' });
            G.frame(cv, t, ['Drive', 'Projection', 'Cameras', 'Cluster'], page, [d.demo && { text: 'DEMO' }]);
        }

        function drawBanner(cv, t, alert) {
            if (!alert.on) return;
            cv.roundRect(24, 448, 1552, 56, 12, '#8d1218');
            cv.text('CAMERA', 48, 486, 28, '#ffffff', { font: 'bold' });
            cv.text(alert.dist + ' m', 280, 490, 36, '#ffffff', { font: 'num' });
            cv.text(alert.kind === 'light' ? 'red light' : 'speed', 520, 486, 24, '#ffd0d0', { font: 'bold' });
        }

        function drawVow(cv, t) {
            cv.fillRect(0, 0, W, H, '#14080d');
            cv.strokeRoundRect(28, 28, W - 56, H - 56, 18, 2, '#e8c27a');
            if (vow < 2) {
                cv.text('Настя', 800, 160, 48, '#e8c27a', { align: 'center', font: 'label', literal: true });
                cv.text('Нажми OK', 800, 230, 28, '#fff6ea', { align: 'center', font: 'label', literal: true });
                G.button(cv, t, 560, 280, 480, 88, 'OK', () => {
                    vow = 2;
                    return render();
                }, { key: 'vow-ok', primary: true, color: '#c45b74' });
                G.button(cv, t, 680, 400, 240, 48, 'Не сейчас', () => {
                    vow = 0;
                    return render();
                }, { key: 'vow-no' });
                return;
            }
            if (vow < 3) {
                cv.text('Смотри на приборку', 800, 180, 36, '#fff6ea', { align: 'center', font: 'label', literal: true });
                cv.text('Там просят нажать OK ещё раз', 800, 230, 24, '#e8c27a', { align: 'center', font: 'label', literal: true });
                G.button(cv, t, 560, 290, 480, 88, 'OK', () => {
                    vow = 3;
                    return render();
                }, { key: 'vow-ok2', primary: true, color: '#c45b74' });
                G.button(cv, t, 660, 400, 280, 52, 'Вправо', nudgeAsk, { key: 'vow-right', color: '#e8c27a' });
                return;
            }
            const glassOn = hud.status().indexOf('on the projection') >= 0;
            if (!glassOn) ask.glass(cv, { nx: 280, ny: 70, nw: 1040, nh: 220 });
            else cv.text('Посмотри на проекцию', 800, 200, 36, '#fff6ea', { align: 'center', font: 'label', literal: true });
            G.button(cv, t, 1040, 400, 240, 48, 'Вправо', nudgeAsk, { key: 'vow-right', color: '#e8c27a' });
            G.button(cv, t, 680, 400, 240, 48, 'Закрыть', () => {
                vow = 0;
                return render();
            }, { key: 'vow-close' });
        }

        function paintHud(cv, area, style, snap, glass) {
            if (style.ask >= 3) return ask.glass(cv, area);
            drawProjection(cv, area, style, snap, glass);
        }

        function paintCluster(cv, area, id, snap, look) {
            if (look.ask >= 2) return ask.cluster(cv, area, look.ask, look.shift);
            drawCluster(cv, area, id, snap, look);
        }

        const hud = startHud(ctx.log, paintHud);
        const cluster = startCluster(ctx.log, paintCluster);
        if (ctx.ui && ctx.ui.onVisible) {
            ctx.ui.onVisible((name, v) => {
                if (name !== 'MAIN') return;
                hud.hold(!!v);
                cluster.hold(!!v);
            });
        }

        async function render() {
            const t = ctx.theme();
            const d = car.data();
            const alert = alertOf(d);
            const cv = ctx.canvas(W, H).clear(t.bg);
            if (vow) drawVow(cv, t);
            else if (page === 0) drawDrive(cv, t, d);
            else if (page === 1) drawPicker(cv, t, d);
            else if (page === 2) drawCams(cv, t, d, alert);
            else drawClusterPage(cv, t, d);
            if (!vow && page !== 2 && page !== 3) drawBanner(cv, t, alert);
            const view = look(d);
            view.ask = vow;
            view.shift = askShift;
            if (alert.on) view.cam = alert.dist + ' m';
            const snap = snapOf(d);
            hud.update(view, snap);
            cluster.update(vow >= 2 ? 'ask' : (ctx.settings.get('clusterStyle') || 'off'), view, snap);
            await ui.image('MAIN_GFX', cv);
        }

        ctx.onTab((i) => {
            if (i === page) return null;
            page = i;
            return render();
        });

        ui.onClick('BTN_ACTION', reset);
        ctx.hideButton('BTN_ACTION');
        ctx.loop('MAIN', 10, render);
        render().catch((e) => ctx.log.warn('first render: ' + e));
    },
});
