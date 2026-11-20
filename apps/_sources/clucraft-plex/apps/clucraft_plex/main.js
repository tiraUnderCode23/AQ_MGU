'use strict';
/**
 * Drive-In (clucraft_plex): the films and series of your own Plex Media Server on the centre screen. An unofficial
 * client: not affiliated with or endorsed by Plex.
 *
 * The Drive-In service (native/clucraft-plex, a root tool from the same repository) holds the account, talks to
 * plex.tv and the server, and plays a film: tvh-player decodes it on the GPU into /dev/shm/mgu-video-clucraft-plex
 * and plays its sound into SmartXbar's CarLife input. This app is the screen: it asks the service (svc.js), keeps
 * what it learns (store.js), draws the pages (ui.js), shows the video file through the kit's renderer connection
 * (Recorder.video), routes the sound to the speakers (caraudio.js) and skips on the steering wheel's buttons.
 *
 * Pages: link (sign in with a code at plex.tv/link), home (continue watching, recently added), a library's posters,
 * a show's seasons and episodes, a film's or episode's page, search, the player (over the whole screen: fullview.js),
 * and the passenger disclaimer.
 *
 * The picture shows while the car is parked (drivegate.js: a fresh speed under 1 km/h and the selector in P). The
 * setting "Video while driving" lets a passenger watch, and counts only once its disclaimer was accepted on the
 * page this app shows for it, with the car parked. The sound plays either way.
 *
 * Built on the kit and the structure of M850i-amn's IPTV app (MIT; see NOTICE).
 * Node 8 only: no ?. ?? object spread, class fields or optional catch binding. Every callback goes through guard().
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const FS = require('./kit/fullscreen');
const G = require('./kit/gauges');
const record = require('./kit/record');
const fonts = require('./kit/fonts');
const pack = require('./kit/pack');
const { RenderClient } = require('./kit/renderd');
const svc = require('./svc');
const { createStore } = require('./store');
const { createUi } = require('./ui');
const DG = require('./drivegate');
const { createCarAudio } = require('./caraudio');
const { createFullView } = require('./fullview');

const VERSION = '0.1.0';
const W = 1600, H = 520;
const VID = 7, VIDEO_FILE = '/dev/shm/mgu-video-clucraft-plex';
const WHEEL_IFACE = 'de.bmw.infotainment.controlelements.SteeringWheelPushButton', WHEEL_FIELD = 'statusSearchSwitch1';

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const guard = (name, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { log.error('error in ' + name + ': ' + (e && e.stack || e)); return undefined; }
        };
        try {
            /* ---------- fonts: Inter (OFL), packed with the app ---------- */
            let F_BOLD = 'bold', F_MED = 'label';
            try {
                const dirs = [path.join(__dirname, 'fonts'), path.join(__dirname, 'data', 'fonts')];
                const src = pack.open(fs.existsSync(dirs[0] + '.pack') || fs.existsSync(dirs[0]) ? dirs[0] : dirs[1]);
                if (fonts.register('cl_bold', src.json('cl_bold.json'))) F_BOLD = 'cl_bold';
                if (fonts.register('cl_med', src.json('cl_med.json'))) F_MED = 'cl_med';
            } catch (e) { log.warn('fonts: ' + e.message); }
            const B = { font: F_BOLD, literal: true }, M = { font: F_MED, literal: true };

            /* ---------- what the app knows (store.js) and the service ---------- */
            const S = createStore({ ask: svc.ask, setImage: record.setImage, settings, log });
            const sendPrefs = () => svc.ask({ cmd: 'prefs', gain: Number(settings.get('gain')) || 0, even: false }).catch(() => {});

            /* ---------- may the picture show (drivegate.js) ---------- */
            const gate = DG.watch(ctx.signals, log, DG.createGate());
            const consent = DG.createConsent(path.join(ctx.dataDir, 'passenger.json'));
            // the setting without its disclaimer accepted (an older file, a copied settings.json): off
            if (settings.get('motion') === true && !consent.given()) { try { settings.set('motion', false); } catch (e) { log.warn('motion: ' + e.message); } }
            const pictureAllowed = () => DG.pictureAllowed(gate, settings.get('motion') === true, consent);
            let consentFrom = 'home';
            function askConsent() {
                if (S.page !== 'consent') { consentFrom = S.page === 'link' ? 'home' : S.page; S.page = 'consent'; S.picker = null; }
                // the kit's settings are drawn over the page: closed, so the disclaimer is what shows next
                try { if (ctx.display && typeof ctx.display.closeSheet === 'function') ctx.display.closeSheet(); } catch (e) { /* the HMI's own settings screen: its back shows it */ }
            }
            const consentHandlers = {
                accept: guard('consent', () => {
                    // only with the car parked: not something to tap through on the move
                    if (!gate.parked()) { S.say('Park the car first (selector in P)'); return; }
                    if (!consent.accept()) { S.say('Could not save this: the setting stays off'); settings.set('motion', false); }
                    else { log.info('video while driving: the disclaimer was accepted'); S.say('Video while driving is on, for a passenger'); }
                    S.page = consentFrom;
                }),
                decline: guard('consent', () => { consent.clear(); settings.set('motion', false); S.page = consentFrom; }),
            };
            function motionChanged() {
                if (settings.get('motion') === true) { if (!consent.given()) askConsent(); }
                else { consent.clear(); if (S.page === 'consent') S.page = consentFrom; }
            }

            settings.onChange(guard('settings', (k) => {
                if (k === 'gain') sendPrefs();
                if (k === 'motion') motionChanged();
                if (k === 'quality' && S.active()) S.say('The new quality is used from the next film or skip');
                if (k === 'signout' && settings.get('signout') === 'yes') { settings.set('signout', 'no'); S.signOut(); }
            }));

            /* ---------- the sound on the speakers, the steering wheel ---------- */
            const audio = createCarAudio(ctx.signals, log, path.join(ctx.dataDir, 'audio.json'));
            const audioSync = () => audio.want(S.playing());
            process.once('exit', () => { try { audio.want(false); } catch (e) { /* ending */ } });
            // the wheel's skip while a film plays: right 30 s on, left 10 s back, on release (as found in the car by
            // aurelmarius' Media Probe: ..._SKIP_RECHTS / ..._SKIP_LINKS while down, KEINE_AKTION once let go)
            let wheelDown = 0;
            function onWheel(v) {
                const val = v && typeof v === 'object' ? v.operationPushButtonAudioAutomaticTuningSteeringWheel : v;
                if (typeof val !== 'string') return;
                if (/SKIP_RECHTS/.test(val)) { wheelDown = 1; return; }
                if (/SKIP_LINKS/.test(val)) { wheelDown = -1; return; }
                if (/KEINE_AKTION/.test(val) && wheelDown) {
                    const d = wheelDown; wheelDown = 0;
                    if (settings.get('wheel') !== false && S.playing()) S.skip(d > 0 ? 30 : -10);
                }
            }
            if (ctx.signals && ctx.signals.watch) {
                const h = {}; h[WHEEL_FIELD] = guard('wheel', onWheel);
                ctx.signals.watch(WHEEL_IFACE, '1', h, log).catch(() => {});
            }

            /* ---------- the service's status, once a second (twice while a film is on) ---------- */
            let lastPoll = 0;
            setInterval(guard('poll', () => {
                const t = Date.now();
                if (t - lastPoll < (S.active() ? 450 : 950)) return;
                lastPoll = t;
                S.poll().then(guard('after poll', audioSync));
            }), 250);
            S.poll().then(guard('after poll', audioSync));
            setTimeout(sendPrefs, 1500);

            /* ---------- the video file, named to the renderer ---------- */
            // named once the renderer can show video and the player has made the file, and again whenever the file is
            // another one: the service deletes it when a film ends and the next player makes a new one, and the
            // renderer keeps the file it opened (IPTV 0.2: a channel change left the last channel's picture up)
            let videoIno = null;
            function videoReady() {
                const g = ctx.display && ctx.display.gpu;
                if (!g || !g.ready || !g.native || !g.info || !g.info.video) return false;
                let ino = null;
                try { ino = fs.statSync(VIDEO_FILE).ino; } catch (e) { /* not made yet, or between two films */ }
                if (ino == null) return false;
                if (ino !== videoIno) {
                    g.video(VID, VIDEO_FILE); fv.video(VID, VIDEO_FILE); videoIno = ino;
                    log.info('video: ' + VIDEO_FILE + ' (inode ' + ino + ') named to the renderer');
                }
                return true;
            }

            /* ---------- touch: the progress bar takes a whole gesture, everything else is a tap or the kit's scroll ---------- */
            let scrub = null;
            const onDrag = guard('touch', (phase, x, y) => {
                const sb = ui2.scrub;
                if (phase === 1) scrub = S.page === 'player' && sb && x >= sb.x && x < sb.x + sb.w && y >= sb.y && y < sb.y + sb.h ? sb : null;
                if (!scrub) return false;
                const pos = Math.max(0, Math.min(scrub.dur - 5, (x - scrub.x0) / scrub.bw * scrub.dur));
                if (phase === 3) { scrub = null; S.seek(pos); }
                else { S.seekTo = { pos, at: Date.now() }; S.overlayUntil = Date.now() + 6000; }
                return true;
            });
            // over the full view, the kit's page (claimed first, under it) gets the touches: they go to the full view,
            // from the page's logical px to the screen's (as mgu-render places it) and on to the view's
            if (typeof ctx.onTouch === 'function') ctx.onTouch(guard('touch', (phase, x, y) => {
                const pl = ctx.display && ctx.display.place;
                if (!fv.shown() || !pl) return onDrag(phase, x, y);
                const sx = (pl.x || 0) + (pl.ox || 0) + x * pl.scale, sy = (pl.y || 0) + (pl.oy || 0) + y * pl.scale;
                fv.touch(phase, sx / fv.scale, sy / fv.scale);
                return true;
            }));
            // on the full view (fullview.js) the targets are its own; on the page, the kit's
            const btn = (cv, key, x, y, w, h, fn, r) => (cv.fv ? (cv.fv.push({ key, x: x - 4, y: y - 4, w: w + 8, h: h + 8, run: guard(key, fn) }), cv)
                : FS.button(cv, key, x, y, w, h, guard(key, fn), { r: r != null ? r : 16, slop: 4 }));

            /* ---------- the player over the whole screen (fullview.js) ---------- */
            // the controller there: press plays or pauses, a turn skips 10 s a click (sent once the knob rests),
            // pushed right 30 s on, left back to the page before
            let turned = 0, turnTimer = null;
            const fv = createFullView({ RenderClient, Recorder: record.Recorder, appId: 'clucraft_plex', log, W, off: 'MGU_EMU_CLOSED' in process.env,
                onTouch: onDrag,
                onCcu: guard('controller', (c) => {
                    S.overlayUntil = Date.now() + 6000;
                    if (c.press) S.pauseResume();
                    if (c.tilt === 'W') S.back();
                    else if (c.tilt === 'E') S.skip(30);
                    if (c.turn) {
                        turned += c.turn;
                        const p = S.pb();
                        if (p && p.duration) S.seekTo = { pos: Math.max(0, Math.min(p.duration - 5, S.position() + c.turn * 10)), at: Date.now() };
                        clearTimeout(turnTimer);
                        turnTimer = setTimeout(guard('turn', () => { turned = 0; if (S.seekTo) S.seek(S.seekTo.pos); }), 700);
                    }
                }) });
            const fvWanted = () => S.page === 'player' && ui.isVisible('MAIN') && !ui.isVisible('SETTINGS') && (!ui.hasFocus || ui.hasFocus('MAIN'));
            // while the full view is up the page's own layer is hidden: mgu-render puts a layer on top when its connection
            // makes it, and the page's reconnects put it back over the picture, black, with the kit's header; hidden, it
            // also claims no touch. The kit shows it again on its own events only, so it is shown again here once the
            // full view goes (as IPTV does, found in the car)
            let pageHidden = false;
            function syncFull() {
                fv.update(fvWanted());
                const g = ctx.display && ctx.display.gpu;
                if (!g) return;
                const hide = fv.shown();
                if (hide && g.visible) { g.show(false); pageHidden = true; }
                else if (!hide && pageHidden) {
                    pageHidden = false;
                    if (typeof ctx.display._syncVisible === 'function') ctx.display._syncVisible(); else g.show(true);
                }
            }
            ui.onVisible(guard('fullview', syncFull));
            setInterval(guard('fullview', syncFull), 500);

            /* ---------- the pages (ui.js) ---------- */
            const ui2 = createUi({ S, B, M, btn, env: {
                W, VID, version: VERSION, videoReady, pictureAllowed,
                parked: () => gate.parked(), parkedWhy: () => gate.why(), audio: () => audio.state(),
            } });

            /* ---------- the kit: its bar buttons (where it cannot run the screen), back, scrolling ---------- */
            FS.setup(ctx);
            ui.onClick('BTN_HOME', guard('home', () => { if (S.signedIn()) { S.top('home'); S.loadHome(false); } }));
            ui.onClick('BTN_NOW', guard('now', () => { if (S.active()) { S.go('player'); S.overlayUntil = Date.now() + 6000; } }));
            ui.onClick('BTN_PLAYPAUSE', guard('playpause', () => S.pauseResume()));
            ui.onClick('BTN_STOP', guard('stop', () => S.stop()));
            if (typeof ctx.onBack === 'function') ctx.onBack(guard('back', () => S.back()));
            if (typeof ctx.onScroll === 'function') ctx.onScroll(guard('scroll', (dy) => ui2.scroll(dy)));

            /* ---------- the frame ---------- */
            ctx.loop('MAIN', 10, guard('draw', async () => {
                const cv = ctx.canvas(W, H), A = FS.area(cv), fullH = H + (cv.extra || 0);
                if (cv.chrome) G.frame(cv, ctx.theme(), ['Drive-In'], 0, []);
                syncFull();
                // under the full view the page draws nothing: its layer stays clear, so the full view shows whichever of
                // the two the renderer puts in front
                if (S.page === 'player' && fv.shown()) {
                    fv.draw((rec, FH) => ui2.drawPlayer(rec, { x: 96, y: 24, right: W - 40, bottom: FH - 20, w: W - 136, h: FH - 44, own: true }, FH));
                } else if (S.page === 'player') ui2.drawPlayer(cv, A, fullH);
                else ui2.draw(cv, A, fullH, consentHandlers);
                await ui.image('MAIN_GFX', cv);
            }));
            log.info('started ' + VERSION + ', fonts ' + F_BOLD + '/' + F_MED + ', video while driving ' + (settings.get('motion') === true && consent.given() ? 'on (disclaimer accepted)' : 'off'));
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
