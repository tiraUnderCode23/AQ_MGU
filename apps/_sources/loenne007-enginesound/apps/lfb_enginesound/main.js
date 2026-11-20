'use strict';
/**
 * Engine Sound - a synthesized engine sound (Inline 6, V8, V12, or bass for the car's own diesel) on the car's speakers,
 * following the car's real rpm, gear and load.
 *
 * The app runs from the platform's start (app.json "autostart"): background() reads the car, drives the synthesizer
 * service (tool lfb-enginesound, see core.js / daemon.js) and the car's audio routing (route.js), with the app closed.
 *
 * One page: what plays and why or why not, on / off, a 10 s test sound, the audio mode; the car's rpm and the
 * engine's, gear, load; and the five sounds to choose from (core.js SOUNDS). With Settings > Legacy the page offers
 * every sound engine and preset instead, and two more pages show: Sound (the sound sliders) and Audio (the audio
 * route: exclusive, the music pauses, or mix, over the music; the mix route candidates with a test each; a report).
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { withAlpha } = require('./kit/canvas');
const Car = require('./kit/car');
const { Core, ORDER, SOUNDS, SOUND_SETTINGS } = require('./core');
const { Daemon } = require('./daemon');
const { Route, MIX_DEFAULT, SINK, mixCandidates, mixRoute, sameRoute } = require('./route');

const W = 1600, H = 520;
const TABS = ['Engine', 'Sound', 'Audio'];
const MIX_ROWS = 5;           // mix route candidates shown on the Audio page at a time
// the Sound page's sliders: track from SX0 to SX1, one row per setting
const SX0 = 520, SX1 = 1290, ROW0 = 112, ROWH = 76;
const FES = 'de.bmw.infotainment.drivingexcitement.FES';
// FES torque: 12 bit, 0.5 Nm per bit, 0 Nm at raw 2047, 4095 = no value (kit/runtime/car.js)
const torqueOf = (raw) => (typeof raw === 'number' && raw < 4095 ? raw * 0.5 - 1023.5 : null);
// FES actualValueModeDrivingExperience -> sport / other (as ambient_config's modeOf)
const SPORT_NO = [1, 2, 3, 15, 16, 23, 28];
function modeOf(v) {
    const raw = v && typeof v === 'object' ? v.actualValueModeDrivingExperience : v;
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw === 'number' || /^\d+$/.test(String(raw))) return SPORT_NO.indexOf(Number(raw)) >= 0 ? 'sport' : 'other';
    return /SPORT|BOOST/i.test(String(raw)) ? 'sport' : 'other';
}

/** A value of the AudioManager for a report line (missing: "?"). */
const show = (v) => (v === undefined || v === null ? '?' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/* The mix route chosen on the Audio page, kept in the app's data folder (no file: the default). */
function mixStore(dataDir, log) {
    const file = path.join(dataDir || '.', 'mix-route.json');
    return {
        load() {
            try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); return c && typeof c.source === 'number' && c.name ? c : null; } catch (e) { return null; }
        },
        save(c) {
            try { if (c) fs.writeFileSync(file, JSON.stringify({ name: c.name, source: c.source, sink: c.sink, device: c.device })); else if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { log.warn('mix route save: ' + e); }
        },
    };
}

async function background(bg) {
    const { settings, signals, log } = bg;
    const daemon = new Daemon(log);
    const route = new Route(signals, log, bg.dataDir);
    const mix = mixStore(bg.dataDir, log);
    const core = new Core({ settings, log, daemon, route, mixChoice: mix.load() });
    route.start();      // a connection a crash or a power-off left goes first

    // the Audio page's lists: the AudioManager's sources (getListMainSources) and the service's SmartX endpoints (SHM)
    const audio = {
        sources: null, error: null, loading: false, at: 0,
        refresh() {
            if (audio.loading) return;
            audio.loading = true; audio.at = Date.now();
            daemon.send('SHM');
            route.sources().then((l) => { audio.sources = l; audio.error = null; log.info('audio: ' + l.length + ' sources'); },
                (e) => { audio.sources = null; audio.error = String(e && e.message || e); log.warn('audio: no source list: ' + audio.error); })
                .then(() => { audio.loading = false; daemon.emit('change'); });
        },
        candidates() { return mixCandidates(audio.sources, core.endpoints()); },
        use(c) {
            const d = !c || sameRoute(c, MIX_DEFAULT);
            log.info('audio: mix route ' + (d ? 'default' : c.name + ' ' + c.source + ' -> ' + c.sink + ' ' + c.device));
            mix.save(d ? null : c);
            core.setMixChoice(d ? null : c);
        },
    };

    /* The car's volumes as the AudioManager lists them per sink (Audio page, read every second while it shows): is
     * the volume knob's position among them? */
    const volumes = {
        sinks: null, error: null, busy: false,
        read() {
            if (volumes.busy) return;
            volumes.busy = true;
            route.sinks().then((l) => { volumes.sinks = l; volumes.error = null; }, (e) => { volumes.error = String(e && e.message || e); })
                .then(() => { volumes.busy = false; });
        },
        text() {
            if (!volumes.sinks) return volumes.error ? 'Car volume: not readable' : 'Car volume: reading...';
            const v = volumes.sinks.filter((x) => x.id === SINK || x.id === 1).map((x) => 'sink ' + x.id + ' = ' + show(x.volume) + (/^MS_MUTED$|^1$/.test(String(x.mute)) ? ' muted' : ''));
            return 'Car volume: ' + (v.join(', ') || 'no sink listed');
        },
    };

    /* The audio report (Audio page > Diagnose): what the AudioManager lists, the SmartX files, the service's last
     * lines. Shown on the page, written to the log and to audio-report.txt in the app's data folder. */
    const report = {
        lines: null, loading: false,
        make() {
            if (report.loading) return;
            report.loading = true;
            daemon.send('SHM'); daemon.send('STATUS');
            const done = (l) => {
                const st = daemon.status || {}, shm = daemon.shm || {}, r = route.route || route.failed, L = [];
                L.push('SERVICE ' + (daemon.connected ? (st.version || '?') + ' engine ' + st.engine + ' synth ' + st.synth : 'not connected'));
                L.push('out ' + (st.device || '-') + (st.tone ? ' tone ' + st.tone : ''));
                if (st.alsa) {
                    L.push('ALSA ' + st.alsa.format);
                    L.push('  dropouts ' + (st.alsa.dropouts || '0') + (st.alsa.queue ? ', queue ' + st.alsa.queue : ''));
                }
                (st.log || []).slice(-10).forEach((x) => L.push('  ' + x));
                L.push('ROUTE ' + route.state + (r ? ' ' + r.name + ' ' + r.source + '->' + r.sink : '') + (route.connState ? ' ' + route.connState : '') + (route.error ? ' ' + route.error : ''));
                L.push('mix ' + (core.mixOn() ? 'on' : 'off') + ', mix route ' + core.activeRoute().name + ' ' + core.activeRoute().device);
                if (l.errors && l.errors.length) l.errors.forEach((e) => L.push('AM error ' + e));
                L.push('CONNECTIONS');
                (l.connections || []).forEach((c) => L.push('  ' + c.id + ': ' + c.source + '->' + c.sink + ' ' + c.state));
                L.push('SINKS');
                (l.sinks || []).forEach((x) => L.push('  ' + x.id + ' ' + x.name + ' vol ' + show(x.volume) + ' ' + show(x.mute) + ' class ' + show(x.cls)));
                L.push('SHM (service ids ' + (shm.ids || '?') + ')' + (shm.error ? ' error ' + shm.error : ''));
                (shm.all || shm.files || []).forEach((x) => L.push('  ' + x));
                L.push('SOURCES');
                (l.sources || []).forEach((x) => L.push('  ' + x.id + ' ' + x.name + ' class ' + show(x.cls) + ' ' + show(x.avail)));
                report.lines = L; report.loading = false;
                L.forEach((x) => log.info('report: ' + x));
                try { fs.writeFileSync(path.join(bg.dataDir || '.', 'audio-report.txt'), L.join('\n') + '\n'); } catch (e) { log.warn('report: ' + e); }
                daemon.emit('change');
            };
            // (a moment for the service's answers)
            setTimeout(() => route.lists().then(done, (e) => done({ errors: [String(e && e.message || e)] })), 600);
        },
    };

    const fesSeen = [];
    const car = new Car(bg, ['rpm', 'speed', 'gear'], {
        [FES]: {
            statusActualValueTorque2: (v) => core.feed({ torque: torqueOf(v && v.actualValueTorqueCrankshaft) }),
            statusFESVehicleDynamicSwitchHMI: (v) => {
                const raw = v && v.actualValueModeDrivingExperience;
                if (fesSeen.length < 10 && fesSeen.indexOf(String(raw)) < 0) { fesSeen.push(String(raw)); log.info('driving mode: ' + JSON.stringify(raw)); }
                const m = modeOf(v);
                if (m) core.feed({ mode: m });
            },
        },
    });
    car.setRedline(4800);
    car.onSample((d) => core.feed({ rpm: d.rpm, speed: d.speed, gear: d.gear, demo: d.demo,
        torque: d.demo && typeof d.torque === 'number' ? d.torque : undefined }));
    settings.onChange((key) => core.onSetting(key));
    core.start();
    log.info('engine sound: background running');
    return { core, car, daemon, route, audio, report, volumes };
}

mgu.run({
    background,
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const { core, daemon, route, audio, report, volumes } = ctx.background || await background(ctx);
        let diag = false, diagPage = 0, mixPage = 0;
        let dirty = true, page = 0;
        const redraw = () => { dirty = true; return render(); };

        ui.onClick('BTN_TOGGLE', () => { settings.set('enabled', settings.get('enabled') === false); return redraw(); });
        ui.onClick('BTN_TEST', () => { core.test(); return redraw(); });
        // the next sound (legacy: the next preset of the sound engine)
        ui.onClick('BTN_ENGINE', () => {
            if (core.legacy()) { const i = ORDER.indexOf(core.preset()); settings.set('engine', ORDER[(i + 1) % ORDER.length]); return redraw(); }
            const i = core.sounds().findIndex((x) => x.selected);
            core.setSound(SOUNDS[(i + 1) % SOUNDS.length].id);
            return redraw();
        });

        /* ---------- Engine page ---------- */
        function drawEngine(cv, t) {
            const p = core.presetInfo(core.preset()), on = settings.get('enabled') !== false;
            const red = p.red || Number(settings.get('realRedline')) || 4800;   // (Enhance: the car's own range)
            const why = core.reason, d = core.d, o = core.out;

            /* ---------- left: status, sound engine, audio mode, on / off and test ---------- */
            G.panel(cv, t, 24, 44, 520, 468, 'Engine Sound');
            const down = !daemon.connected, failed = route.state === 'failed';
            const col = !on ? t.dim : down || failed ? t.crit : why ? t.warn : '#2fd27a';
            cv.roundRect(48, 102, 472, 84, 16, withAlpha(col, 0.14));
            cv.circle(84, 144, 12, col);
            cv.text(!on ? 'OFF' : down ? 'NO SERVICE' : failed ? 'NO SOUND' : why ? 'STANDBY' : 'PLAYING', 112, 138, 30, t.text, { font: 'bold', spacing: 2 });
            const line = down ? 'Restart the head unit once'
                : failed ? 'Audio route failed' + (core.legacy() ? ' (see Audio)' : '')
                    : !on ? 'Switched off' : why ? why.charAt(0).toUpperCase() + why.slice(1) : 'Following the engine';
            cv.text(line.slice(0, 40), 112, 168, 18, down || failed ? t.crit : t.dim);

            const mix = core.mixOn(), testing = Date.now() < core.testUntil, legacy = core.legacy();
            const onOff = (x, y, w, h) => G.button(cv, t, x, y, w, h, on ? 'Switch off' : 'Switch on', () => { settings.set('enabled', !on); return redraw(); }, { primary: !on, key: 'onoff' });
            const test = (x, y, w, h) => G.button(cv, t, x, y, w, h, testing ? 'Listen...' : 'Test sound', () => { core.test(); return redraw(); }, { key: 'test', busy: testing });
            // the audio mode: tap to switch between mix and exclusive
            const mode = (y, h) => G.button(cv, t, 48, y, 472, h, mix ? 'Audio: over the music' : 'Audio: instead of the music', () => { settings.set('mix', !mix); return redraw(); }, { key: 'mix' });
            if (legacy) {
                // the sound engine: big tiles
                const list = core.soundEngines(), se = core.soundEngine(), have = daemon.status && daemon.status.engines;
                cv.text('SOUND ENGINE', 48, 222, 15, t.dim, { font: 'bold', spacing: 1.5 });
                const tw = (472 - 10 * (list.length - 1)) / list.length;
                list.forEach((x, i) => {
                    const tx = 48 + i * (tw + 10), sel = x.id === se, there = !have || have.indexOf(x.id) >= 0;
                    cv.roundRect(tx, 232, tw, 92, 14, sel ? withAlpha(t.accent, 0.3) : withAlpha('#ffffff', 0.05));
                    if (sel) cv.strokeRoundRect(tx, 232, tw, 92, 14, 2, t.accent);
                    cv.text(x.title, tx + tw / 2, 274, list.length > 2 ? 22 : 28, there ? t.text : t.dim, { align: 'center', font: 'bold' });
                    cv.text(x.short, tx + tw / 2, 304, 15, t.dim, { align: 'center' });
                    if (cv.own && there) cv.target(tx, 232, tw, 92, () => { settings.set('soundEngine', x.id); return redraw(); }, 'se-' + x.id);
                });
                mode(346, 52);
                onOff(48, 420, 230, 60); test(290, 420, 230, 60);
            } else {
                onOff(48, 210, 472, 76);
                test(48, 302, 472, 60);
                mode(378, 60);
                const vol = Number(settings.get('volume')) || 50;
                cv.text('Volume ' + vol + ' %' + (settings.get('sportOnly') === true ? ', only in Sport mode' : '') + ' (Settings)', 284, 478, 17, t.dim, { align: 'center' });
            }

            // live
            G.panel(cv, t, 560, 44, 500, 468, 'Live');
            const rpm = typeof d.rpm === 'number' ? Math.round(d.rpm) : null;
            cv.text(rpm === null ? '-' : String(rpm), 700, 176, 72, t.text, { align: 'center', font: 'num' });
            cv.text('CAR RPM', 700, 206, 16, t.dim, { align: 'center', font: 'bold', spacing: 1.5 });
            cv.text(rpm === null ? '-' : String(Math.round(o.rpm)), 920, 176, 72, why ? t.dim : t.accent, { align: 'center', font: 'num' });
            cv.text(p.title.toUpperCase() + ' RPM', 920, 206, 16, t.dim, { align: 'center', font: 'bold', spacing: 1.5 });
            // rev bar of the virtual engine
            const fr = Math.max(0, Math.min(1, o.rpm / (red * 1.05)));
            cv.roundRect(590, 236, 440, 22, 11, withAlpha('#ffffff', 0.08));
            cv.roundRect(590, 236, Math.max(22, 440 * fr), 22, 11, fr > 0.9 / 1.05 ? t.crit : t.accent);
            // load: pulling right, overrun left
            const ld = core.load(d.torque);
            cv.text('LOAD', 590, 300, 16, t.dim, { font: 'bold', spacing: 1.5 });
            cv.roundRect(660, 284, 370, 20, 10, withAlpha('#ffffff', 0.08));
            const mid = 660 + 370 * 0.25;
            if (ld >= 0) cv.roundRect(mid, 284, Math.max(10, 370 * 0.75 * ld), 20, 10, '#2fd27a');
            else cv.roundRect(mid - 370 * 0.25 * -ld, 284, Math.max(10, 370 * 0.25 * -ld), 20, 10, t.cold || '#4aa3ff');
            cv.text(typeof d.torque === 'number' ? Math.round(d.torque) + ' Nm' : 'no torque signal', 1030, 330, 18, t.dim, { align: 'right' });
            G.gear(cv, t, 700, 470, { gear: d.gear, size: 120 });
            cv.text('GEAR', 700, 494, 14, t.dim, { align: 'center', font: 'bold', spacing: 1.5 });
            cv.text(typeof d.speed === 'number' ? String(Math.round(d.speed)) : '-', 920, 450, 56, t.text, { align: 'center', font: 'num' });
            cv.text('KM/H', 920, 480, 14, t.dim, { align: 'center', font: 'bold', spacing: 1.5 });
            if (d.demo) cv.text('DEMO DATA', 1030, 494, 16, t.warn, { align: 'right', font: 'bold' });

            /* ---------- right: the sound (legacy: the sound engine's presets) ---------- */
            if (!legacy) {
                G.panel(cv, t, 1076, 44, 500, 468, 'Sound');
                const list = core.sounds();
                list.forEach((x, i) => {
                    // (a wider gap before the first Enhance sound)
                    const y = 92 + i * 82 + (x.kind !== list[0].kind ? 10 : 0);
                    cv.roundRect(1100, y, 452, 72, 14, x.selected ? withAlpha(t.accent, 0.3) : withAlpha('#ffffff', 0.05));
                    if (x.selected) cv.strokeRoundRect(1100, y, 452, 72, 14, 2, t.accent);
                    cv.text(x.title, 1124, y + 34, 26, t.text, { font: 'bold' });
                    cv.text(x.sub, 1124, y + 58, 15, t.dim);
                    cv.text(x.kind.toUpperCase(), 1532, y + 32, 14, x.selected ? t.text : t.dim, { align: 'right', font: 'bold', spacing: 1.5 });
                    if (cv.own) cv.target(1100, y, 452, 72, () => { core.setSound(x.id); return redraw(); }, 'snd-' + x.id);
                });
                return;
            }
            G.panel(cv, t, 1076, 44, 500, 468, 'Engine');
            ORDER.forEach((k, i) => {
                const q = core.presetInfo(k), sel = k === core.preset(), y = 92 + i * 104;
                cv.roundRect(1100, y, 452, 92, 14, sel ? withAlpha(t.accent, 0.3) : withAlpha('#ffffff', 0.05));
                if (sel) cv.strokeRoundRect(1100, y, 452, 92, 14, 2, t.accent);
                cv.text(q.title, 1124, y + 42, 28, t.text, { font: 'bold' });
                cv.text(q.red ? q.sub + ' - ' + q.red + ' rpm' : q.sub, 1124, y + 72, 16, t.dim);
                if (cv.own) cv.target(1100, y, 452, 92, () => { settings.set('engine', k); return redraw(); }, 'eng-' + k);
            });
        }

        /* ---------- Sound page: sliders for the X settings ---------- */
        const setPct = (key, v) => { settings.set(key, Math.max(0, Math.min(200, Math.round(v / 5) * 5))); return redraw(); };
        function drawSound(cv, t) {
            G.panel(cv, t, 24, 44, 1552, 468, 'Sound');
            G.button(cv, t, 1380, 58, 180, 40, 'Reset all', () => { SOUND_SETTINGS.forEach((x) => settings.set(x.key, 100)); return redraw(); }, { key: 'reset' });
            SOUND_SETTINGS.forEach((x, i) => {
                const y = ROW0 + i * ROWH, v = Math.round(core.soundSetting(x.key) * 100);
                cv.text(x.label, 48, y + 26, 24, t.text, { font: 'bold' });
                cv.text(x.sub, 48, y + 50, 16, t.dim);
                // track, the default (100 %) mark, the filled part and the knob
                const ty = y + 22, fx = SX0 + (SX1 - SX0) * v / 200;
                cv.roundRect(SX0, ty, SX1 - SX0, 14, 7, withAlpha('#ffffff', 0.1));
                cv.roundRect(SX0, ty, Math.max(14, fx - SX0), 14, 7, v === 0 ? t.dim : t.accent);
                cv.fillRect(SX0 + (SX1 - SX0) / 2 - 1, ty - 6, 2, 26, withAlpha('#ffffff', 0.35));
                cv.circle(fx, ty + 7, 15, '#ffffff');
                cv.text(v === 0 ? 'OFF' : v + '%', 1350, y + 34, 24, v === 100 ? t.dim : t.text, { align: 'center', font: 'bold' });
                G.button(cv, t, 1400, y + 6, 70, 48, '-', () => setPct(x.key, v - 10), { key: x.key + '-' });
                G.button(cv, t, 1484, y + 6, 70, 48, '+', () => setPct(x.key, v + 10), { key: x.key + '+' });
            });
        }
        // a tap on a slider's track sets it there
        if (ctx.onTap) {
            ctx.onTap((x, y) => {
                if (page !== 1 || x < SX0 - 20 || x > SX1 + 20) return null;
                const i = Math.floor((y - ROW0) / ROWH);
                if (i < 0 || i >= SOUND_SETTINGS.length) return null;
                return setPct(SOUND_SETTINGS[i].key, (x - SX0) / (SX1 - SX0) * 200);
            });
        }

        /* ---------- Audio page: exclusive or mix, the mix route candidates ---------- */
        /** The route's state in a line; full: with the AudioManager's connection state. */
        function routeText(full) {
            const r = route.route || route.failed;
            const n = r ? ' ' + r.name : '';
            return route.state === 'failed' ? 'Audio route' + n + ' failed: ' + (route.error || '')
                : route.state === 'connecting' ? 'Audio route' + n + ' connecting...'
                    : route.state === 'connected' ? 'Audio route' + n + ' connected' + (full && route.connState ? ' (' + route.connState + ')' : '')
                        : 'Audio route idle (connects when the sound plays)';
        }
        function drawAudio(cv, t) {
            const mixOn = core.mixOn(), r = core.activeRoute(), testing = Date.now() < core.testUntil;
            G.panel(cv, t, 24, 44, 600, 468, 'Audio route');
            G.button(cv, t, 48, 96, 268, 56, 'Exclusive', () => { settings.set('mix', false); return redraw(); }, { primary: !mixOn, key: 'mode-ex' });
            G.button(cv, t, 332, 96, 268, 56, 'Over the music', () => { settings.set('mix', true); return redraw(); }, { primary: mixOn, key: 'mode-mix' });
            cv.text(mixOn ? 'Mix: plays over the music, like a navigation prompt' : 'Exclusive: the music pauses while it plays', 48, 188, 17, t.dim);
            cv.text(r.name, 48, 232, 28, t.text, { font: 'bold' });
            cv.text('source ' + r.source + ' -> sink ' + r.sink, 600, 232, 17, t.dim, { align: 'right' });
            cv.text(r.device.replace(/^plug:smartx:/, 'SmartX ').slice(0, 56), 48, 262, 17, t.dim);
            cv.text(routeText(true).slice(0, 58), 48, 298, 17, route.state === 'failed' ? t.warn : route.state === 'connected' ? '#2fd27a' : t.dim);
            // the synth's own word: does the car take the sound from this channel?
            const heard = synthSays();
            if (r.note) cv.text(r.note.slice(0, 58), 48, 326, 16, t.warn);
            else if (heard) cv.text(heard.text.slice(0, 58), 48, 326, 16, heard.ok ? '#2fd27a' : t.warn);
            G.button(cv, t, 48, 344, 552, 52, testing ? 'Test: listen...' : 'Test this route (10 s beeps)', testing ? null : () => { tested_ = core.activeRoute(); core.test(); return redraw(); },
                { key: 'test-route', busy: testing });
            const eps = core.endpoints();
            // the playing synth's device: its format, and the dropouts it counted (underruns, an empty queue)
            const al = outputSays();
            cv.text(al.text.slice(0, 62), 48, 418, 16, al.bad ? t.warn : t.dim);
            cv.text(audio.loading ? 'AudioManager: reading the sources...' : audio.sources ? 'AudioManager: ' + audio.sources.length + ' sources' + (eps ? ', SmartX: ' + eps.length + ' endpoints' : '')
                : 'AudioManager list unavailable' + (audio.error ? ': ' + audio.error : '') + ' - default used', 48, 442, 16, audio.sources || audio.loading ? t.dim : t.warn);
            if (!eps) cv.text('SmartX list unavailable: default device assumed', 48, 466, 16, t.warn);
            cv.text(volumes.text().slice(0, 40), 48, 494, 16, t.dim);
            G.button(cv, t, 420, 468, 180, 36, diag ? 'Routes' : 'Diagnose', () => { diag = !diag; diagPage = 0; if (diag) report.make(); return redraw(); }, { key: 'diag' });

            if (diag) return drawReport(cv, t);

            G.panel(cv, t, 640, 44, 936, 468, 'Mix routes');
            G.button(cv, t, 1416, 58, 144, 40, audio.loading ? 'Reading...' : 'Refresh', audio.loading ? null : () => { audio.refresh(); return redraw(); }, { key: 'refresh', busy: audio.loading });
            const list = audio.candidates(), chosen = mixRoute(core.mixChoice, eps);
            const pages = Math.max(1, Math.ceil(list.length / MIX_ROWS));
            mixPage = Math.min(mixPage, pages - 1);
            if (pages > 1) G.button(cv, t, 1276, 58, 128, 40, (mixPage + 1) + ' / ' + pages, () => { mixPage = (mixPage + 1) % pages; return redraw(); }, { key: 'mix-page' });
            list.slice(mixPage * MIX_ROWS, mixPage * MIX_ROWS + MIX_ROWS).forEach((c, i) => {
                const y = 108 + i * 74, sel = sameRoute(c, chosen), tested = testing && sameRoute(c, core.testRoute), key = c.source + '-' + c.sink;
                cv.roundRect(664, y, 888, 66, 14, sel ? withAlpha(t.accent, 0.22) : withAlpha('#ffffff', 0.05));
                if (sel) cv.strokeRoundRect(664, y, 888, 66, 14, 2, t.accent);
                cv.text(c.name + (sameRoute(c, MIX_DEFAULT) ? ' (default)' : ''), 684, y + 30, 22, t.text, { font: 'bold' });
                cv.text(c.source + ' -> ' + c.sink + (c.sink === SINK ? ' front speakers' : ' main sink') + '   ' + c.device.replace(/^plug:smartx:/, ''), 684, y + 54, 15, t.dim);
                G.button(cv, t, 1220, y + 9, 140, 48, tested ? 'Listen...' : 'Test', testing ? null : () => { tested_ = c; core.test(c); return redraw(); }, { key: 'mt-' + key, busy: tested });
                G.button(cv, t, 1372, y + 9, 168, 48, sel ? 'Chosen' : 'Use for mix', sel ? null : () => { audio.use(c); return redraw(); }, { key: 'mu-' + key, primary: sel });
            });
            // the last test: what its channel did with the beeps
            const res = testSays();
            if (res) cv.text(res.text.slice(0, 96), 664, 494, 16, res.ok ? '#2fd27a' : res.ok === false ? t.warn : t.dim);
            else if (list.length <= 2 && !audio.loading) cv.text(audio.sources ? 'No other mix source with a SmartX endpoint' : 'Only the default (no source list)', 664, 494, 15, t.dim);
        }

        /* What a synth's lines say about its device: { ok: true (the car takes the sound) | false | null (nothing yet), text }. */
        function verdict(lines) {
            const l = lines || [];
            const has = (re) => l.filter((x) => re.test(x)).pop();
            // (the latest of the two decides: a channel can start late)
            const play = l.map((x) => /takes the sound/.test(x)).lastIndexOf(true), none = l.map((x) => /nobody reads/.test(x)).lastIndexOf(true);
            if (play >= 0 && play > none) return { ok: true, text: 'the car takes the sound' };
            if (none >= 0) return { ok: false, text: 'the car does not read this channel' };
            const err = has(/refused|unavailable|retry|reconnecting/);
            if (err) return { ok: false, text: String(err).replace(/^alsa: /, '').replace(/plug:smartx:/g, '') };
            return { ok: null, text: has(/connected/) ? 'opened, waiting for the car to read it' : 'no answer yet' };
        }
        let tested_ = null;       // the route of the last test started here
        /** The last test's result line (from the service's status), or null. */
        function testSays() {
            const lt = daemon.status && daemon.status.lastTone;
            if (!lt || !tested_ || lt.dev !== tested_.device) return null;
            const v = verdict(lt.lines);
            return { ok: v.ok, text: 'Test ' + tested_.name + ' ' + tested_.source + ' -> ' + tested_.sink + ': ' + v.text
                + (route.state === 'failed' ? ' (route failed: ' + (route.error || '') + ')' : '') };
        }
        /** The playing synth's word on its device (not during a test), or null. */
        function synthSays() {
            const st = daemon.status;
            if (!st || st.tone || !st.device || Date.now() < core.testUntil) return null;
            const v = verdict((st.log || []).filter((x) => /^alsa: /.test(x)));
            return v.ok === null ? null : { ok: v.ok, text: 'Synth: ' + v.text };
        }

        /** The playing synth's device in a line: { text, bad (it had dropouts) }. */
        function outputSays() {
            const st = daemon.status, a = st && st.alsa;
            if (!a || !st.device || a.dev !== st.device) return { text: 'Output: not playing', bad: false };
            const m = /^(\d+) Hz, (\w+), (\d+) frames/.exec(a.format), n = a.dropouts ? parseInt(a.dropouts, 10) : 0;
            return { text: 'Output: ' + (m ? m[1] / 1000 + ' kHz ' + m[2] + ', buffer ' + m[3] : a.format) + ', dropouts: ' + n, bad: n > 0 };
        }

        // the audio report: small text, two columns, a page at a time (photograph it, or read audio-report.txt)
        function drawReport(cv, t) {
            G.panel(cv, t, 640, 44, 936, 468, 'Audio report');
            const L = report.lines, per = 22 * 2;
            if (!L) { cv.text(report.loading ? 'Reading...' : 'No report', 664, 110, 18, t.dim); return; }
            const pages = Math.max(1, Math.ceil(L.length / per));
            diagPage = Math.min(diagPage, pages - 1);
            G.button(cv, t, 1300, 58, 120, 40, 'Again', () => { report.make(); return redraw(); }, { key: 'diag-again', busy: report.loading });
            G.button(cv, t, 1432, 58, 128, 40, (diagPage + 1) + ' / ' + pages, () => { diagPage = (diagPage + 1) % pages; return redraw(); }, { key: 'diag-page' });
            L.slice(diagPage * per, diagPage * per + per).forEach((x, i) => {
                const col = Math.floor(i / 22), row = i % 22;
                cv.text(String(x).slice(0, 68), 660 + col * 460, 122 + row * 17.5, 13, /^[A-Z]{3,}/.test(x) ? t.text : t.dim, { literal: true });
            });
        }

        async function render() {
            const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg);
            // the Sound and Audio pages: only with Settings > Legacy
            const tabs = core.legacy() ? TABS : TABS.slice(0, 1);
            if (page >= tabs.length) page = 0;
            (page === 2 ? drawAudio : page === 1 ? drawSound : drawEngine)(cv, t);
            G.frame(cv, t, tabs, page, [core.d.demo && { text: 'DEMO' }]);
            dirty = false;
            await ui.image('MAIN_GFX', cv);
        }
        ctx.onTab((i) => { page = core.legacy() ? i : 0; if (i === 2 && Date.now() - audio.at > 30000) audio.refresh(); return redraw(); });
        daemon.on('change', () => { dirty = true; });
        settings.onChange(() => { dirty = true; });
        let last = 0, asked = 0;
        ctx.loop('MAIN', 10, () => {
            const n = Date.now();
            // the Audio page shows the service's status (a test's result, the output's dropouts) and the car's volumes
            // live: both asked every second
            if (page === 2 && n - asked > 1000) { asked = n; daemon.send('STATUS'); volumes.read(); }
            // the live numbers: 10 times a second on the Engine page; the route's state twice a second on the Audio page
            if (dirty || (page === 0 && n - last > 100) || (page === 2 && n - last > 500)) { last = n; return render(); }
            return null;
        });
        render().catch((e) => log.warn('first render: ' + e));
    },
});

