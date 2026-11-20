'use strict';
/**
 * IPTV (amn_iptv): the live channels of your own Xtream Codes account on the centre screen, in the style of UHF.
 *
 * The IPTV service (native/amn-iptv, a root tool from the same repository) holds the account, talks to the provider
 * and plays a channel: tvh-player decodes it on the GPU into /dev/shm/mgu-video-amn-iptv and plays its sound into
 * SmartXbar's CarLife input. This app is the screen: it asks the service (lib/svc.js), draws the pages, shows the
 * video file through the kit's renderer connection (Recorder.video), routes the sound to the speakers
 * (lib/car_audio.js) and changes the channel on the steering wheel's skip (lib/wheel.js).
 *
 * Pages (a rail on the left, as UHF's tab bar turned on its side for the wide screen):
 *   home      the playlist pill and search, Favourites (logo plates, what is on now, a progress line), TV Guide rows
 *   live      every category on the left, its channels on the right
 *   search    an on-screen keyboard (lib/keyboard.js) and the results
 *   player    the picture full screen; a tap shows the channel, the programme, the next, and Guide / Channels /
 *             Favourite / Stop over it for 6 s
 *   signin    the QR code of the service's sign-in page (on the car Wi-Fi): the login goes from the phone to the
 *             head unit, never through this app
 *   movies, series  the account's films and series: posters by category, a detail page (play, resume, start over;
 *             a series' seasons and episodes); they play on the same player screen, with a film's own bar
 *
 * The picture shows while parked (lib/parkgate.js: under 1 km/h and in P); the setting "Video while driving" lets a
 * passenger watch. The sound plays either way. Favourites are kept in the app's data folder (favourites.json).
 *
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
const svc = require('./svc');
const park = require('./parkgate');
const { createCarAudio } = require('./car_audio');
const { createFullView } = require('./fullview');
const LANGS = require('./langs');
const { RenderClient } = require('./kit/renderd');
const WHEEL = require('./wheel');
const LOGO = require('./logos');
const KB = require('./keyboard');
const qrcodegen = require('./qrcodegen');

const VERSION = '0.4.2';
const W = 1600, H = 520;
const VID = 7, VIDEO_FILE = '/dev/shm/mgu-video-amn-iptv';
const C = {
    bg: '#000000', card: '#1c1c1e', pill: '#26262a', rail: '#161618', text: '#ffffff', grey: '#98989f', dim: '#636366',
    accent: '#2f7df6', accentDim: '#0f2340',      // 0.4.0: the apps' one accent, BMW M blue (was UHF's orange)
    navy: '#1e2c3e', navyText: '#bfcadb', green: '#30d158', amber: '#ff9f0a', red: '#ff453a',
};
const PLATE = { card: [236, 112], guide: [150, 70], player: [190, 104] };
const LOGO_SLOTS = 40, LOGO_ID0 = 200;   // mgu-render: 64 pictures per app at most, the kit's own among them
const POSTER = { grid: [176, 264], detail: [200, 300], player: [72, 108], result: [64, 96] };
/** 1:02:03 or 42:05 */
const hms = (t) => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, x = t % 60; return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + x).slice(-2); };
/** 1 h 42 min, or 42 min */
const dur = (t) => { const m = Math.round((t || 0) / 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
const PLAYING = ['loading', 'playing', 'buffering'];

const A_ = (c, a) => { const s = String(c).replace('#', '').slice(0, 6); return '#' + s + ('0' + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16)).slice(-2); };
const mix = (a, b, f) => {
    const p = (c) => [0, 2, 4].map((k) => parseInt(String(c).replace('#', '').slice(k, k + 2), 16));
    const x = p(a), y = p(b);
    return '#' + x.map((v, i) => ('0' + Math.round(v + (y[i] - v) * f).toString(16)).slice(-2)).join('');
};
const hhmm = (t) => { const d = new Date(t * 1000); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
/** a channel's name without the panel's country prefix ("CAF  TVA GATINEAU" -> "TVA GATINEAU") */
const short = (n) => String(n || '').replace(/^\s*[A-Z]{2,4}\s*[|:-]?\s+(?=\S)/, '').replace(/\s+/g, ' ').trim();
/** a category's name as shown ("CA  QUEBEC" -> "CA · QUEBEC") */
const catName = (n) => String(n || '').replace(/^\s*([A-Z]{2,4})\s*[|:\-]?\s+/, '$1 · ').replace(/\s+/g, ' ').trim();

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const guard = (name, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { log.error('error in ' + name + ': ' + (e && e.stack || e)); return undefined; }
        };
        try {
            /* ---------- fonts: Inter (OFL), as HUD Lyrics ---------- */
            let F_BOLD = 'bold', F_MED = 'label';
            try {
                const dirs = [path.join(__dirname, 'fonts'), path.join(__dirname, 'data', 'fonts')];
                const src = pack.open(fs.existsSync(dirs[0] + '.pack') || fs.existsSync(dirs[0]) ? dirs[0] : dirs[1]);
                if (fonts.register('cl_bold', src.json('cl_bold.json'))) F_BOLD = 'cl_bold';
                if (fonts.register('cl_med', src.json('cl_med.json'))) F_MED = 'cl_med';
            } catch (e) { log.warn('fonts: ' + e.message); }
            const B = { font: F_BOLD, literal: true }, M = { font: F_MED, literal: true };
            const fit = (cv, s, size, w, o) => {
                s = String(s || '');
                const opt = o || M;
                if (cv.textWidth(s, size, opt) <= w) return s;
                let lo = 0, hi = s.length;
                while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cv.textWidth(s.slice(0, mid) + '...', size, opt) <= w) lo = mid; else hi = mid - 1; }
                return s.slice(0, lo).replace(/\s+$/, '') + '...';
            };

            /* ---------- state ---------- */
            let st = null, svcErr = null, svcErrCode = null;        // the service's status, or why there is none
            let cats = [], catsAt = 0, catSel = null;
            const lists = {};                                       // cat id -> { at, channels } | { error }
            const now = {};                                         // stream id -> { now, next } (from the service)
            const wantNow = new Set();
            let page = 'home', toast = null, overlayUntil = 0, panel = null, guideFor = null;
            let playingCh = null, zapList = [];
            const scroll = { cats: 0, chans: 0, favs: 0, results: 0, guide: 0, vcats: 0, vgrid: 0, eps: 0 };
            // films and series (declared here: the first status poll already reads them)
            let detail = null, playingFilm = null;
            const isFilm = () => !!(st && st.playback && st.playback.kind === 'film');
            // where each film and episode stopped (resume), kept on the head unit with the app's data
            const RESUME_FILE = path.join(ctx.dataDir, 'resume.json');
            let resume = {}, resumeSaved = 0;
            try { resume = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8')) || {}; } catch (e) { /* none yet */ }
            const say = (text, ms) => { toast = { text, until: Date.now() + (ms || 3000) }; };
            const settingsGet = (k) => settings.get(k);
            // the languages the owner keeps (setting 'langs'): a category in another is not shown anywhere
            const langSet = () => settingsGet('langs') || 'efa';
            const langOK = (name) => LANGS.kept(name, langSet());

            /* favourites: the app's data folder */
            const FAV_FILE = path.join(ctx.dataDir, 'favourites.json');
            let favs = [];
            try { favs = JSON.parse(fs.readFileSync(FAV_FILE, 'utf8')).filter((c) => c && c.id); } catch (e) { favs = []; }
            const isFav = (id) => favs.some((c) => c.id === id);
            function toggleFav(c) {
                if (!c) return;
                if (isFav(c.id)) { favs = favs.filter((x) => x.id !== c.id); say('Removed from favourites'); }
                else { favs.push({ id: c.id, name: c.name, icon: c.icon || '', cat: c.cat || '' }); say('Added to favourites'); }
                try { fs.writeFileSync(FAV_FILE, JSON.stringify(favs)); } catch (e) { log.warn('favourites: ' + e.message); }
            }

            /* ---------- the service ---------- */
            const signedIn = () => !!(st && st.account);
            const playing = () => !!(st && st.playback && PLAYING.indexOf(st.playback.state) >= 0);
            let polling = false;
            async function poll() {
                if (polling) return;
                polling = true;
                try {
                    st = await svc.ask({ cmd: 'status' });
                    trackResume();
                    svcErr = null; svcErrCode = null;
                    if (signedIn() && st.client && st.client.state === 'connected' && (!cats.length || (st.categories && st.categories.at !== catsAt))) {
                        const r = await svc.ask({ cmd: 'categories' });
                        cats = r.categories || []; catsAt = r.at;
                        if (catSel === null && cats.length) { const o = orderedCats(); catSel = (favs.length ? o[0] : cats.filter((c) => /qu[eé]bec/i.test(c.name))[0] || o[0]).id; }
                    }
                    if (!signedIn() && page !== 'signin' && page !== 'soon') page = 'signin';
                    if (signedIn() && page === 'signin') { page = 'home'; say('Signed in'); }
                } catch (e) {
                    svcErr = e.message; svcErrCode = e.code || null;
                }
                polling = false;
                audioSync();
            }
            setInterval(guard('poll', poll), 1500);
            poll();
            // what the service plays: sound and picture settings
            const sendPrefs = () => svc.ask({ cmd: 'prefs', gain: Number(settingsGet('gain')) || 0, subs: true, even: false }).catch(() => {});
            setTimeout(sendPrefs, 1500);
            settings.onChange(guard('settings', (k) => {
                if (k === 'gain') sendPrefs();
                if (k === 'signout' && settingsGet('signout') === 'yes') {
                    settings.set('signout', 'no');
                    svc.ask({ cmd: 'stop' }).then(() => svc.ask({ cmd: 'signout' })).then(() => { cats = []; Object.keys(lists).forEach((k2) => { delete lists[k2]; }); page = 'signin'; say('Signed out: the login is deleted from this car'); }, () => {});
                }
            }));

            /** the categories your favourites come from first, then the provider's order */
            function orderedCats() {
                const mine = {};
                favs.forEach((f) => { mine[String(f.cat)] = true; });
                const shown = cats.filter((c) => langOK(c.name));
                return shown.filter((c) => mine[String(c.id)]).concat(shown.filter((c) => !mine[String(c.id)]));
            }
            let catsPlaced = false;
            function loadList(cat) {
                if (!cat || (lists[cat] && (lists[cat].loading || Date.now() - lists[cat].at < 10 * 60000))) return;
                lists[cat] = { loading: true, at: Date.now(), channels: (lists[cat] && lists[cat].channels) || [] };
                svc.ask({ cmd: 'channels', cat }, 40000).then((r) => {
                    lists[cat] = r.error ? { at: Date.now(), error: r.error, channels: [] } : { at: Date.now(), channels: r.channels || [] };
                }, (e) => { lists[cat] = { at: Date.now(), error: e.message, channels: [] }; });
            }
            const shownList = (list) => (settingsGet('hevc') !== false ? list : list.filter((c) => !c.hevc));
            // films and series: no 3D release (two pictures side by side) while the language filter is on
            const vodShown = (list) => (langSet() === 'all' ? list : list.filter((it) => !LANGS.is3D(it.name)));
            // what is on now: the ids drawn this frame, asked in one go every 1.5 s
            let nowBusy = false;
            setInterval(guard('now', () => {
                if (nowBusy || !signedIn()) return;
                const t = Date.now() / 1000;
                const ids = Array.from(wantNow).filter((id) => { const v = now[id]; return !v || (v.now && v.now.stop < t) || (!v.now && Date.now() - (v.at || 0) > 600000); }).slice(0, 24);
                wantNow.clear();
                if (!ids.length) return;
                nowBusy = true;
                svc.ask({ cmd: 'now', ids }, 40000).then((r) => {
                    ids.forEach((id) => { const v = (r.now || {})[id]; now[id] = Object.assign({ at: Date.now() }, v || { now: null, next: null }); });
                }, () => {}).then(() => { nowBusy = false; });
            }), 1500);
            const nowOf = (id) => { wantNow.add(id); return now[id] || null; };

            /* ---------- logos: fetched by the service, made into plates here ---------- */
            const logos = {};          // key "id|w" -> { slot, plate, at } | { none } | { loading }
            const slotUse = [];        // slot -> key (least recently drawn reused)
            const logoQueue = [];
            let logoBusy = 0;
            function logoOf(c, size) {
                if (!c) return null;
                const key = c.id + '|' + size[0];
                const e = logos[key];
                if (e) { if (e.slot != null) e.at = Date.now(); return e.slot != null ? e : null; }
                logos[key] = { loading: true };
                logoQueue.push({ c, size, key });
                pumpLogos();
                return null;
            }
            function pumpLogos() {
                while (logoBusy < 2 && logoQueue.length) {
                    const q = logoQueue.shift();
                    if (!q.c.icon) { logos[q.key] = { none: true }; continue; }
                    logoBusy++;
                    svc.ask({ cmd: 'logo', id: q.c.id, icon: q.c.icon }, 30000).then((r) => {
                        const pic = r && r.img ? (q.c.cover ? LOGO.poster : LOGO.make)(Buffer.from(r.img, 'base64'), q.size[0], q.size[1]) : null;
                        if (!pic) { logos[q.key] = { none: true }; return; }
                        // a slot: a free one, or the least recently drawn
                        let slot = slotUse.length < LOGO_SLOTS ? slotUse.length : -1;
                        if (slot < 0) {
                            let oldest = Infinity;
                            slotUse.forEach((k, i) => { const e = logos[k]; const at = e && e.at || 0; if (at < oldest) { oldest = at; slot = i; } });
                            const old = slotUse[slot]; if (old) delete logos[old];
                        }
                        slotUse[slot] = q.key;
                        record.setImage(LOGO_ID0 + slot, pic.w, pic.h, pic.rgba);
                        logos[q.key] = { slot, id: LOGO_ID0 + slot, plate: pic.plate, colour: pic.colour, at: Date.now() };
                    }, () => { logos[q.key] = { none: true }; }).then(() => { logoBusy--; pumpLogos(); });
                }
            }

            /* ---------- playing ---------- */
            const audio = createCarAudio(ctx.signals, log, path.join(ctx.dataDir, 'audio.json'));
            function audioSync() { audio.want(playing()); }
            process.once('exit', () => { try { audio.want(false); } catch (e) { /* ending */ } });
            function play(c, list) {
                if (!c) return;
                playingCh = { id: c.id, name: c.name, icon: c.icon || '', cat: c.cat || '' };
                playingFilm = null;
                if (list) zapList = list;
                page = 'player'; panel = null; overlayUntil = Date.now() + 6000;
                svc.ask({ cmd: 'play', id: c.id, name: c.name }).then(poll, (e) => say(e.message));
            }
            function stopPlay() {
                trackResume(); saveResume(true);
                svc.ask({ cmd: 'stop' }).then(poll, () => {});
                const wasFilm = !!playingFilm;
                playingCh = null; playingFilm = null;
                if (page === 'player') page = wasFilm && detail ? 'detail' : 'home';
            }
            function zap(dir) {
                if (isFilm()) { skip(dir * 30); return; }   // a film: the steering wheel's skip moves 30 s
                if (!playingCh || !zapList.length) return;
                const i = zapList.findIndex((c) => c.id === playingCh.id);
                const n = zapList[((i < 0 ? 0 : i) + dir + zapList.length) % zapList.length];
                if (n) { play(n, null); say((dir > 0 ? 'Next: ' : 'Previous: ') + short(n.name)); }
            }
            const wheel = WHEEL.createWheel({ zap: guard('zap', zap), active: () => !!settingsGet('wheel') && playing() });
            if (ctx.signals && ctx.signals.watch) {
                const h = {}; h[WHEEL.FIELD] = guard('wheel', (v) => wheel.onSwitch(v));
                ctx.signals.watch(WHEEL.IFACE, '1', h, log).catch(() => {});
            }
            try { park.start(ctx.signals, log); } catch (e) { log.warn('park: ' + e.message); }
            const pictureAllowed = () => !!settingsGet('motion') || park.isParked();
            // the video file named to the renderer once it can show video and the player has made the file, and named again
            // whenever the file is another one (renderd.js names it again after a reconnect). The renderer keeps the file
            // it opened: the service deletes the file when a channel ends (native/amn-iptv/player.js) and the next
            // channel's player makes a new one, so a channel change left the first channel's last picture on screen
            let videoIno = null;
            const gpuVideo = () => { const g = ctx.display && ctx.display.gpu; return !!(g && g.ready && g.native && g.info && g.info.video); };
            function videoReady() {
                const g = ctx.display && ctx.display.gpu;
                if (!g || !g.ready || !g.native || !g.info || !g.info.video) return false;
                let ino = null;
                try { ino = fs.statSync(VIDEO_FILE).ino; } catch (e) { /* not made yet, or between two channels */ }
                if (ino == null) return false;
                if (ino !== videoIno) {
                    g.video(VID, VIDEO_FILE); fv.video(VID, VIDEO_FILE); videoIno = ino;
                    log.info('video: ' + VIDEO_FILE + ' (inode ' + ino + ') named to the renderer');
                }
                return true;
            }

            /* ---------- scrolling (a finger dragged on a list) ---------- */
            let drag = null, dragged = 0, scrub = null;   // scrub: a finger on a film's progress bar { r, pos }
            const regions = [];          // drawn each frame: { key, x, y, w, h, max (px) }
            const onDrag = guard('touch', (phase, x, y) => {
                // a film's progress bar: the whole gesture is the bar's, the picture goes where the finger lifts
                if (scrub || phase === 1) {
                    const sr = scrub ? scrub.r : regions.filter((g) => g.seek && x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h)[0];
                    if (sr) {
                        const s = sr.seek, p = Math.max(0, Math.min(s.d - 5, (x - s.x) / s.w * s.d));
                        if (phase === 3) { scrub = null; filmCmd('film-seek', { pos: Math.floor(p) }); }
                        else scrub = { r: sr, pos: p };
                        overlayUntil = Date.now() + 6000;
                        return true;
                    }
                }
                if (phase === 1) {
                    const r = regions.filter((g) => !g.seek && x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h)[0];
                    drag = r ? { key: r.key, y0: y, s0: scroll[r.key], max: r.max, moved: false } : null;
                    return false;
                }
                if (!drag) return false;
                if (phase === 2) {
                    const dy = drag.y0 - y;
                    if (Math.abs(dy) > 12) drag.moved = true;
                    if (drag.moved) { scroll[drag.key] = Math.max(0, Math.min(drag.max, drag.s0 + dy)); dragged = Date.now(); }
                    return drag.moved;
                }
                const took = drag.moved;
                drag = null;
                return took;
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
            const tap = (fn) => () => { if (Date.now() - dragged < 250) return; fn(); };
            // on the full view (lib/fullview.js) the targets are its own; on the page, the kit's
            const btn = (cv, key, x, y, w, h, fn, r) => cv.fv ? (cv.fv.push({ key, x: x - 4, y: y - 4, w: w + 8, h: h + 8, run: guard(key, tap(fn)) }), cv)
                : FS.button(cv, key, x, y, w, h, guard(key, tap(fn)), { r: r != null ? r : 16, slop: 4 });

            /* ---------- the player over the whole screen (lib/fullview.js) ---------- */
            const fv = createFullView({ RenderClient, Recorder: record.Recorder, appId: 'amn_iptv', log, W, off: 'MGU_EMU_CLOSED' in process.env,
                onTouch: onDrag, onCcu: () => { overlayUntil = Date.now() + 6000; } });
            // the player page, the app's page shown and in front (not under Settings, not left with HOME)
            // full screen or the app's page: the player's toggle (its top bar), kept across runs
            const FULL_FILE = path.join(ctx.dataDir, 'fullscreen.json');
            let fullOn = true;
            try { fullOn = JSON.parse(fs.readFileSync(FULL_FILE, 'utf8')).on !== false; } catch (e) { /* first run: full screen */ }
            function setFull(on) { fullOn = !!on; try { fs.writeFileSync(FULL_FILE, JSON.stringify({ on: fullOn })); } catch (e) { /* kept for this run */ } }
            const fvWanted = () => fullOn && page === 'player' && ui.isVisible('MAIN') && !ui.isVisible('SETTINGS') && (!ui.hasFocus || ui.hasFocus('MAIN'));
            // while the full view is up the page's own layer is hidden: mgu-render puts a layer on top when its connection
            // makes it, and the page's reconnects (the kit app sent back and forth) put it back over the picture, black,
            // with the kit's header; hidden, it also claims no touch. The kit shows it again on its own events only, so
            // it is shown again here once the full view goes
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

            /* ---------- drawing pieces ---------- */
            function glass(cv, x, y, w, h, r, fill) { cv.roundRect(x, y, w, h, r, fill || C.card); }
            function plate(cv, c, x, y, size, r, corners) {
                const lg = logoOf(c, size);
                if (lg) {
                    cv.image(lg.id, x, y, size[0], size[1]);
                    // the kit draws pictures square: each corner given back to the page, then rounded in the plate's colour
                    const rr = r || 14, w = size[0], h = size[1];
                    const cs = corners === 'top' ? [[x, y, 270], [x + w - rr, y, 0]] : corners === 'all'
                        ? [[x, y, 270], [x + w - rr, y, 0], [x + w - rr, y + h - rr, 90], [x, y + h - rr, 180]] : [];
                    cs.forEach((k) => {
                        cv.fillRect(k[0], k[1], rr, rr, C.bg);
                        const cx = k[2] === 270 || k[2] === 180 ? k[0] + rr : k[0], cy = k[2] === 270 || k[2] === 0 ? k[1] + rr : k[1];
                        cv.arc(cx, cy, 0, rr, k[2], k[2] + 90, lg.plate);
                    });
                    return lg;
                }
                cv.roundRect(x, y, size[0], size[1], r || 14, '#2c2c30');
                cv.text(fit(cv, short(c.name), 18, size[0] - 20, B), x + size[0] / 2, y + size[1] / 2 + 7, 18, C.grey, Object.assign({ align: 'center' }, B));
                return null;
            }
            function progress(cv, x, y, w, n) {
                const t = Date.now() / 1000;
                if (!n || !n.now) return;
                const f = Math.max(0, Math.min(1, (t - n.now.start) / Math.max(1, n.now.stop - n.now.start)));
                cv.fillRect(x, y, w, 4, '#46464c');
                cv.fillRect(x, y, Math.round(w * f), 4, C.text);
            }
            /* ---------- films and series (the service's film.js plays them) ---------- */
            const vod = { movies: { cats: null, sel: null, lists: {}, err: null, errAt: 0, busy: false },
                series: { cats: null, sel: null, lists: {}, err: null, errAt: 0, busy: false } };
            function saveResume(force) {
                if (!force && Date.now() - resumeSaved < 10000) return;
                resumeSaved = Date.now();
                const keep = {};
                Object.keys(resume).sort((a, b) => resume[b].at - resume[a].at).slice(0, 200).forEach((k) => { keep[k] = resume[k]; });
                resume = keep;
                try { fs.writeFileSync(RESUME_FILE, JSON.stringify(resume)); } catch (e) { log.warn('resume: ' + e.message); }
            }
            function trackResume() {
                const pb = st && st.playback;
                if (!playingFilm || !pb || pb.kind !== 'film') return;
                const d = pb.duration || playingFilm.duration || 0;
                if (pb.state === 'ended' || (d && pb.pos > d - 60)) { if (resume[playingFilm.key]) { delete resume[playingFilm.key]; saveResume(true); } return; }
                if (pb.pos > 30 && (pb.state === 'playing' || pb.state === 'paused')) {
                    resume[playingFilm.key] = { pos: Math.floor(pb.pos), dur: Math.floor(d), at: Date.now() };
                    saveResume(pb.state === 'paused');
                }
            }
            const VC = { movies: ['film-cats', 'films'], series: ['series-cats', 'series'] };
            function loadVodCats(kind) {
                const v = vod[kind];
                if (v.cats || v.busy || (v.err && Date.now() - v.errAt < 15000)) return;
                v.busy = true;
                svc.ask({ cmd: VC[kind][0] }, 70000).then((r) => {
                    if (r.error && !(r.categories || []).length) { v.err = r.error; v.errAt = Date.now(); return; }
                    v.cats = r.categories || []; v.err = null;
                    const first = v.cats.filter((c) => langOK(c.name))[0];
                    if (v.sel === null && first) v.sel = first.id;
                }, (e) => { v.err = e.message; v.errAt = Date.now(); }).then(() => { v.busy = false; });
            }
            function loadVodList(kind, cat) {
                const v = vod[kind];
                if (cat == null) return null;
                const L = v.lists[cat];
                if (L && (L.loading || (!L.error && Date.now() - L.at < 600000) || (L.error && Date.now() - L.at < 15000))) return L;
                v.lists[cat] = { loading: true, at: Date.now(), items: L ? L.items : [] };
                svc.ask({ cmd: VC[kind][1], cat }, 130000).then((r) => { v.lists[cat] = { at: Date.now(), items: r[VC[kind][1]] || [], error: r.error || null }; },
                    (e) => { v.lists[cat] = { at: Date.now(), items: [], error: e.message }; });
                return v.lists[cat];
            }
            function openDetail(kind, item) {
                const d = detail = { kind, item, info: null, error: null, season: null };
                page = 'detail'; scroll.eps = 0;
                svc.ask({ cmd: kind === 'movies' ? 'film-info' : 'series-info', id: item.id }, 35000).then((r) => {
                    if (detail !== d) return;
                    if (r.error) d.error = r.error;
                    else { d.info = r.info; if (kind === 'series' && r.info.seasons && r.info.seasons.length) d.season = r.info.seasons[0].n; }
                }, (e) => { if (detail === d) d.error = e.message; });
            }
            function playFilm(f, start) {
                playingFilm = f; playingCh = null; panel = null;
                page = 'player'; overlayUntil = Date.now() + 6000;
                svc.ask({ cmd: 'film-play', kind: f.kind, id: f.id, ext: f.ext, name: f.name, start: Math.floor(start || 0), duration: f.duration || 0 }).then(poll, (e) => say(e.message));
            }
            function filmCmd(cmd, extra) { svc.ask(Object.assign({ cmd }, extra || {})).then(poll, (e) => say(e.message)); }
            function skip(dt) {
                const pb = st && st.playback;
                if (!isFilm() || !pb) return;
                const d = pb.duration || 0;
                let t = (pb.pos || 0) + dt;
                if (d) t = Math.min(t, d - 5);
                filmCmd('film-seek', { pos: Math.max(0, Math.floor(t)) });
            }
            function posterAt(cv, kind, it, x, y, size) {
                const lg = it.poster ? logoOf({ id: (kind === 'series' ? 's' : 'f') + it.id, icon: it.poster, cover: true }, size) : null;
                if (lg) { cv.image(lg.id, x, y, size[0], size[1]); return; }
                cv.roundRect(x, y, size[0], size[1], 10, '#2c2c30');
                cv.text(fit(cv, short(it.name || ''), 15, size[0] - 16, B), x + size[0] / 2, y + size[1] / 2 + 6, 15, C.grey, Object.assign({ align: 'center' }, B));
            }
            /** text cut into lines that fit w, at most n (the last one ends with ...) */
            function wrapText(cv, text, size, w, o, n) {
                const words = String(text || '').replace(/\s+/g, ' ').trim().split(' '), out = [];
                let line = '';
                for (let i = 0; i < words.length && out.length < n; i++) {
                    const t = line ? line + ' ' + words[i] : words[i];
                    if (cv.textWidth(t, size, o) <= w || !line) { line = t; continue; }
                    out.push(line); line = words[i];
                }
                if (line && out.length < n) out.push(line);
                else if (line && out.length) out[n - 1] = fit(cv, out[n - 1] + ' ' + line, size, w, o);
                return out.filter(Boolean);
            }
            function drawVod(cv, A, x0, kind) {
                const v = vod[kind];
                loadVodCats(kind);
                const colW = 260, rowH = 46, top = A.y + 64;
                cv.text(kind === 'movies' ? 'Movies' : 'Series', x0 + 8, A.y + 38, 32, C.text, B);
                const spx = x0 + colW + 18, spw = Math.min(460, A.right - spx);
                cv.roundRect(spx, A.y + 4, spw, 46, 23, C.pill);
                icon(cv, 'search', spx + 28, A.y + 27, C.grey);
                cv.text(kind === 'movies' ? 'Search movies' : 'Search series', spx + 54, A.y + 35, 20, '#7a7a82', M);
                btn(cv, 'vsearch_' + kind, spx, A.y + 4, spw, 46, () => { setSearchMode(kind); go('search'); }, 23);
                glass(cv, x0, top, colW, A.bottom - top, 18, C.rail);
                const cl = (v.cats || []).filter((c) => langOK(c.name)), visRows = Math.floor((A.bottom - top - 16) / rowH), maxC = Math.max(0, (cl.length - visRows) * rowH);
                scroll.vcats = Math.min(scroll.vcats, maxC);
                if (cl.length && !cl.some((c) => c.id === v.sel)) { v.sel = cl[0].id; scroll.vgrid = 0; }   // the languages changed
                regions.push({ key: 'vcats', x: x0, y: top, w: colW, h: A.bottom - top, max: maxC });
                cv.clip(x0, top + 6, colW, A.bottom - top - 12);
                if (!cl.length) cv.text(fit(cv, v.err ? 'Could not load: ' + v.err : 'Loading...', 17, colW - 40, M), x0 + 20, top + 40, 17, v.err ? C.red : C.grey, M);
                const first = Math.floor(scroll.vcats / rowH);
                cl.slice(first, first + visRows + 2).forEach((c, i) => {
                    const y = top + 8 + (first + i) * rowH - scroll.vcats, on = c.id === v.sel;
                    if (on) cv.roundRect(x0 + 8, y, colW - 16, rowH - 6, 12, C.accentDim);
                    cv.text(fit(cv, catName(c.name), 18, colW - 44, on ? B : M), x0 + 22, y + 28, 18, on ? C.accent : '#e8e8ec', on ? B : M);
                    btn(cv, 'vcat_' + c.id, x0 + 8, y, colW - 16, rowH - 6, () => { v.sel = c.id; scroll.vgrid = 0; }, 12);
                });
                cv.noclip();
                // the category's posters
                const gx = x0 + colW + 18, gw = A.right - gx, pw = POSTER.grid[0], ph = POSTER.grid[1];
                const L = loadVodList(kind, v.sel), items = L ? vodShown(L.items) : [];
                const cw = pw + 18, chH = ph + 58, cols = Math.max(1, Math.floor((gw + 18) / cw));
                const rowsV = Math.ceil((A.bottom - top) / chH) + 1, maxS = Math.max(0, Math.ceil(items.length / cols) * chH - (A.bottom - top));
                scroll.vgrid = Math.min(scroll.vgrid, maxS);
                regions.push({ key: 'vgrid', x: gx, y: top, w: gw, h: A.bottom - top, max: maxS });
                if (v.sel != null && (!L || (L.loading && !items.length))) cv.text('Loading...', gx, top + 40, 20, C.grey, M);
                else if (L && L.error && !items.length) cv.text(fit(cv, 'Could not load this category: ' + L.error, 18, gw, M), gx, top + 40, 18, C.red, M);
                else if (L && !items.length) cv.text('Nothing in this category.', gx, top + 40, 18, C.grey, M);
                cv.clip(gx, top, gw, A.bottom - top);
                const r0 = Math.floor(scroll.vgrid / chH);
                for (let r = r0; r < r0 + rowsV; r++) {
                    for (let k = 0; k < cols; k++) {
                        const it = items[r * cols + k];
                        if (!it) continue;
                        const x = gx + k * cw, y = top + r * chH - scroll.vgrid;
                        posterAt(cv, kind, it, x, y, POSTER.grid);
                        const rk = kind === 'movies' && resume['movie:' + it.id];
                        if (rk && rk.dur) { cv.fillRect(x, y + ph - 6, pw, 6, A_('#000000', 0.6)); cv.fillRect(x, y + ph - 6, Math.max(4, Math.round(pw * Math.min(1, rk.pos / rk.dur))), 6, C.accent); }
                        cv.text(fit(cv, it.name, 16, pw, B), x, y + ph + 24, 16, C.text, B);
                        const sub = [it.year, it.rating ? Number(it.rating).toFixed(1) : null, it.hevc ? '4K / HEVC' : null].filter(Boolean).join('  ·  ');
                        if (sub) cv.text(fit(cv, sub, 14, pw, M), x, y + ph + 44, 14, C.grey, M);
                        btn(cv, 'vod_' + it.id, x, y, pw, ph + 48, () => openDetail(kind, it), 10);
                    }
                }
                cv.noclip();
            }
            function drawDetail(cv, A, x0) {
                const d = detail;
                if (!d) { page = 'home'; return; }
                const it = d.item, info = d.info || {}, pw = POSTER.detail[0];
                cv.roundRect(x0, A.y, 56, 56, 28, A_('#ffffff', 0.12));
                cv.line(x0 + 33, A.y + 16, x0 + 21, A.y + 28, 3.5, C.text); cv.line(x0 + 21, A.y + 28, x0 + 33, A.y + 40, 3.5, C.text);
                btn(cv, 'd_back', x0, A.y, 56, 56, () => { page = d.kind; detail = null; }, 28);
                const py = A.y + 72;
                posterAt(cv, d.kind, { id: it.id, poster: it.poster || info.poster, name: it.name }, x0, py, POSTER.detail);
                const tx = x0 + pw + 36, tw = A.right - tx;
                cv.text(fit(cv, info.name || it.name, 34, tw, B), tx, A.y + 40, 34, C.text, B);
                const rating = info.rating || it.rating;
                const facts = [info.year || it.year, info.genre, info.duration ? dur(info.duration) : null, rating ? 'Rating ' + Number(rating).toFixed(1) : null].filter(Boolean).join('   ·   ');
                if (facts) cv.text(fit(cv, facts, 18, tw, M), tx, py + 20, 18, C.grey, M);
                if (d.error) { cv.text(fit(cv, 'Could not load the details: ' + d.error, 18, tw, M), tx, py + 62, 18, C.red, M); return; }
                if (!d.info) { cv.text('Loading...', tx, py + 62, 18, C.grey, M); return; }
                const lines = wrapText(cv, info.plot || '', 19, tw, M, d.kind === 'movies' ? 6 : 3);
                lines.forEach((l, i) => cv.text(l, tx, py + 60 + i * 28, 19, '#dcdce0', M));
                const by = py + 60 + lines.length * 28 + 10;
                if (d.kind === 'movies') {
                    drawPlayRow(cv, { kind: 'movie', id: it.id, ext: info.ext || it.ext, name: info.name || it.name, duration: info.duration || null,
                        key: 'movie:' + it.id, poster: it.poster || info.poster }, info.hevc || it.hevc, tx, by);
                } else drawEpisodes(cv, A, d, tx, by);
            }
            function drawPlayRow(cv, f, hevc, x, y) {
                // HEVC plays on the unit's HEVC decoder (IPTV service 0.3.0); a 10-bit (HDR) one may not: the player says so
                if (hevc) cv.text('4K / HEVC', x, y - 10, 16, C.amber, B);
                const r = resume[f.key];
                const list = r && r.pos > 30 ? [['Resume from ' + hms(r.pos), () => playFilm(f, r.pos), true], ['Start over', () => playFilm(f, 0), false]]
                    : [['Play', () => playFilm(f, 0), true]];
                let bx = x;
                list.forEach((b, i) => {
                    const w = cv.textWidth(b[0], 20, B) + 72;
                    cv.roundRect(bx, y, w, 56, 28, b[2] ? C.accent : A_('#ffffff', 0.16));
                    cv.text(b[0], bx + w / 2, y + 36, 20, C.text, Object.assign({ align: 'center' }, B));
                    btn(cv, 'playrow_' + i, bx, y, w, 56, b[1], 28);
                    bx += w + 16;
                });
            }
            function drawEpisodes(cv, A, d, x, y) {
                const seasons = d.info.seasons || [];
                if (!seasons.length) { cv.text('No episodes.', x, y + 24, 18, C.grey, M); return; }
                let sx = x;
                seasons.forEach((s) => {
                    const label = 'Season ' + s.n, w = cv.textWidth(label, 17, B) + 36, on = s.n === d.season;
                    if (sx + w > A.right) return;
                    cv.roundRect(sx, y, w, 40, 20, on ? C.accent : A_('#ffffff', 0.12));
                    cv.text(label, sx + w / 2, y + 27, 17, C.text, Object.assign({ align: 'center' }, B));
                    btn(cv, 'season_' + s.n, sx, y, w, 40, () => { d.season = s.n; scroll.eps = 0; }, 20);
                    sx += w + 10;
                });
                const season = seasons.filter((s) => s.n === d.season)[0] || seasons[0];
                const ly = y + 54, lh = A.bottom - ly, rowH = 66, w = A.right - x;
                const maxS = Math.max(0, season.episodes.length * rowH - lh);
                scroll.eps = Math.min(scroll.eps, maxS);
                regions.push({ key: 'eps', x, y: ly, w, h: lh, max: maxS });
                cv.clip(x, ly, w, lh);
                const f0 = Math.floor(scroll.eps / rowH), sname = d.info.name || d.item.name;
                season.episodes.slice(f0, f0 + Math.ceil(lh / rowH) + 1).forEach((e, i) => {
                    const yy = ly + (f0 + i) * rowH - scroll.eps, key = 'episode:' + e.id, r = resume[key], n = e.n != null ? e.n : f0 + i + 1;
                    cv.roundRect(x, yy, w, rowH - 8, 14, A_('#ffffff', 0.06));
                    cv.text(String(n), x + 34, yy + 36, 20, C.accent, Object.assign({ align: 'center' }, B));
                    cv.text(fit(cv, e.title || 'Episode ' + n, 19, w - 120, B), x + 70, yy + 26, 19, C.text, B);
                    const sub = [e.duration ? dur(e.duration) : null, e.hevc ? '4K / HEVC' : null, r && r.pos > 30 ? 'stopped at ' + hms(r.pos) : null].filter(Boolean).join('   ·   ');
                    if (sub) cv.text(fit(cv, sub, 15, w - 120, M), x + 70, yy + 48, 15, e.hevc ? C.amber : C.grey, M);
                    {
                        const f = { kind: 'series', id: e.id, ext: e.ext, name: sname + '  S' + season.n + ' E' + n, duration: e.duration || null, key, series: d.item.id, poster: d.item.poster };
                        btn(cv, 'ep_' + e.id, x, yy, w, rowH - 8, () => playFilm(f, r && r.pos > 30 ? r.pos : 0), 14);
                    }
                });
                cv.noclip();
            }
            /** a film's bar on the player: its title, the progress bar (a tap jumps there), the time, the buttons */
            function drawFilmBar(cv, A, fullH, film, pb) {
                const by = fullH - 200;
                cv.gradientRect(0, by - 60, W, fullH - by + 60, [[0, A_('#000000', 0)], [0.45, A_('#000000', 0.7)], [1, A_('#000000', 0.88)]]);
                let tx = A.x;
                if (film.poster) {
                    posterAt(cv, film.kind === 'series' ? 'series' : 'movies', { id: film.kind === 'series' ? film.series : film.id, poster: film.poster, name: film.name }, A.x, by - 4, POSTER.player);
                    tx = A.x + POSTER.player[0] + 22;
                }
                cv.text(fit(cv, film.name, 30, A.right - tx, B), tx, by + 28, 30, C.text, B);
                const d = pb.duration || film.duration || 0, pos = pb.pos || 0, bw = A.right - tx, barY = by + 56;
                cv.roundRect(tx, barY, bw, 8, 4, A_('#ffffff', 0.3));
                if (d) {
                    const at = scrub ? scrub.pos : pos, kx = tx + Math.round(bw * Math.min(1, at / d));
                    cv.roundRect(tx, barY, Math.max(8, kx - tx), 8, 4, C.accent);
                    cv.circle(kx, barY + 4, scrub ? 14 : 9, C.text);
                    if (scrub) {
                        const lw = cv.textWidth(hms(at), 22, B) + 28;
                        cv.roundRect(Math.max(tx, Math.min(A.right - lw, kx - lw / 2)), barY - 52, lw, 38, 19, A_('#000000', 0.8));
                        cv.text(hms(at), Math.max(tx + lw / 2, Math.min(A.right - lw / 2, kx)), barY - 26, 22, C.text, Object.assign({ align: 'center' }, B));
                    }
                    // a finger along it (onDrag: the region's seek), or a tap on one of 20 steps where the kit has no drag
                    regions.push({ key: 'seek', x: tx - 10, y: barY - 26, w: bw + 20, h: 60, max: 0, seek: { x: tx, w: bw, d } });
                    for (let i = 0; i < 20; i++) btn(cv, 'seek_' + i, tx + i * bw / 20, barY - 16, bw / 20, 40, () => filmCmd('film-seek', { pos: Math.floor(d * (i + 0.5) / 20) }), 0);
                    cv.text('-' + hms(Math.max(0, d - at)), A.right, barY + 32, 17, '#c8c8cc', Object.assign({ align: 'right' }, M));
                }
                cv.text(hms(scrub ? scrub.pos : pos), tx, barY + 32, 17, '#c8c8cc', M);
                const held = pb.state === 'paused' || pb.state === 'ended' || pb.state === 'error';
                const acts = [['-30', () => skip(-30)], ['-10', () => skip(-10)], [held ? 'Play' : 'Pause', () => filmCmd(held ? 'film-resume' : 'film-pause')],
                    ['+10', () => skip(10)], ['+30', () => skip(30)], ['Stop', () => stopPlay()]];
                const w = 116, gap = 14;
                let ax = tx;
                acts.forEach((a) => {
                    const main = a[0] === 'Play' || a[0] === 'Pause';
                    cv.roundRect(ax, by + 112, w, 50, 25, main ? C.accent : A_('#ffffff', 0.2));
                    cv.text(a[0], ax + w / 2, by + 144, 19, C.text, Object.assign({ align: 'center' }, B));
                    btn(cv, 'fact_' + a[0], ax, by + 112, w, 50, () => { a[1](); overlayUntil = Date.now() + 6000; }, 25);
                    ax += w + gap;
                });
            }
            function rail(cv, A) {
                const x = A.x, w = 108;
                cv.roundRect(x, A.y, w, A.h, 28, C.rail);
                const items = [['home', 'Home'], ['live', 'Live TV'], ['search', 'Search'], ['series', 'Series'], ['movies', 'Movies']];
                const step = Math.min(96, (A.h - 40) / items.length);
                items.forEach((it, i) => {
                    const cy = A.y + 24 + i * step + step / 2;
                    const on = page === it[0] || (page === 'detail' && detail && detail.kind === it[0]);
                    if (on) cv.roundRect(x + 8, cy - step / 2 + 6, w - 16, step - 12, 20, C.accentDim);
                    const col = on ? C.accent : '#e8e8ec';
                    icon(cv, it[0], x + w / 2, cy - 12, col);
                    cv.text(it[1], x + w / 2, cy + 26, 15, col, Object.assign({ align: 'center' }, on ? B : M));
                    btn(cv, 'rail_' + it[0], x + 6, cy - step / 2 + 4, w - 12, step - 8, () => go(it[0]), 20);
                });
            }
            let soonWhat = '';
            function go(p) {
                panel = null;
                if (p === 'series' || p === 'movies') loadVodCats(p);
                page = p;
                if (p === 'search') { search.kb = search.kb || new KB.Keyboard('abc'); }
            }
            function icon(cv, kind, cx, cy, col) {
                if (kind === 'home') {
                    cv.line(cx - 15, cy + 1, cx, cy - 13, 3.5, col); cv.line(cx, cy - 13, cx + 15, cy + 1, 3.5, col);
                    cv.strokeRoundRect(cx - 11, cy - 2, 22, 17, 3, 3.5, col); cv.fillRect(cx - 3, cy + 6, 6, 9, col);
                } else if (kind === 'live') {
                    cv.circle(cx, cy - 2, 3.5, col);
                    cv.arc(cx, cy - 2, 9, 12.5, 210, 330, col); cv.arc(cx, cy - 2, 16, 19.5, 210, 330, col);
                    cv.line(cx, cy + 2, cx, cy + 15, 3.5, col);
                } else if (kind === 'search') {
                    cv.arc(cx - 3, cy - 3, 9, 12.5, 0, 360, col); cv.line(cx + 5, cy + 5, cx + 14, cy + 14, 4, col);
                } else if (kind === 'series') {
                    cv.strokeRoundRect(cx - 16, cy - 12, 32, 21, 4, 3.5, col); cv.line(cx - 8, cy + 15, cx + 8, cy + 15, 3.5, col);
                } else if (kind === 'movies') {
                    cv.strokeRoundRect(cx - 16, cy - 13, 32, 27, 4, 3.5, col); cv.line(cx - 8, cy - 13, cx - 8, cy + 14, 3, col); cv.line(cx + 8, cy - 13, cx + 8, cy + 14, 3, col);
                }
            }
            function topBar(cv, A, x0) {
                const y = A.y, h = 52;
                // 0.4.0: no title pill (UHF's named the playlist; the car's header names the app): the search first
                const sx = x0, sw = Math.min(560, A.right - sx - 10);
                cv.roundRect(sx, y, sw, h, h / 2, C.pill);
                icon(cv, 'search', sx + 30, y + h / 2, C.grey);
                cv.text('Search channels', sx + 56, y + h / 2 + 8, 22, '#7a7a82', M);
                btn(cv, 'top_search', sx, y, sw, h, () => go('search'), h / 2);
                if (playing() && (playingCh || playingFilm) && page !== 'player') {
                    const bx = sx + sw + 18, bw = A.right - bx;
                    if (bw > 220) {
                        cv.roundRect(bx, y, bw, h, h / 2, C.accentDim);
                        cv.circle(bx + 24, y + h / 2, 6, C.accent);
                        cv.text(fit(cv, 'Now playing  ' + short((playingCh || playingFilm).name), 20, bw - 150, B), bx + 40, y + h / 2 + 7, 20, C.text, B);
                        cv.text('Watch', bx + bw - 24, y + h / 2 + 7, 20, C.accent, Object.assign({ align: 'right' }, B));
                        btn(cv, 'top_watch', bx, y, bw, h, () => { page = 'player'; overlayUntil = Date.now() + 6000; }, h / 2);
                    }
                }
            }
            function section(cv, x, y, title, right, more) {
                cv.text(title, x, y, 24, '#aeaeb4', B);
                if (more) { cv.text('view all', right, y, 19, C.text, Object.assign({ align: 'right' }, B)); btn(cv, 'more_' + title, right - 90, y - 24, 90, 32, more, 8); }
            }
            /** a channel card: the plate, a progress line, what is on now, the channel */
            function card(cv, c, x, y, list) {
                const [pw, ph] = PLATE.card, n = nowOf(c.id);
                glass(cv, x, y, pw, ph + 70, 18);
                plate(cv, c, x, y, PLATE.card, 18, 'top');
                cv.fillRect(x, y + ph - 8, pw, 8, C.card);
                progress(cv, x, y + ph - 4, pw, n);
                cv.text(fit(cv, n && n.now ? n.now.title : short(c.name), 19, pw - 30, B), x + 16, y + ph + 30, 19, C.text, B);
                cv.text(fit(cv, short(c.name), 16, pw - 30, M), x + 16, y + ph + 56, 16, C.grey, M);
                if (list !== favs && isFav(c.id)) { cv.circle(x + pw - 20, y + 20, 9, C.bg); cv.circle(x + pw - 20, y + 20, 6, C.accent); }
                btn(cv, 'card_' + c.id, x, y, pw, ph + 70, () => play(c, list), 18);
            }
            /** a TV guide row: the plate, the bar tinted by the logo's colour (what has played lighter), the next in navy */
            function guideRow(cv, c, x, y, w, list) {
                const [pw, ph] = PLATE.guide, n = nowOf(c.id), lg = plate(cv, c, x, y, PLATE.guide, 16, 'all');
                const col = lg && lg.colour ? lg.colour : '#5a5a62';
                const bar = mix(mix(col, '#5a5a60', 0.35), '#000000', 0.74), lit = mix(mix(col, '#5a5a60', 0.35), '#000000', 0.58);
                const bx = x + pw + 10, nextW = Math.min(360, Math.round(w * 0.28)), bw = w - pw - 10 - nextW - 10;
                cv.roundRect(bx, y, bw, ph, 16, bar);
                const t = Date.now() / 1000;
                if (n && n.now) {
                    const f = Math.max(0, Math.min(1, (t - n.now.start) / Math.max(1, n.now.stop - n.now.start)));
                    if (f > 0.02) cv.roundRect(bx, y, Math.max(32, Math.round(bw * f)), ph, 16, lit);
                }
                cv.text(fit(cv, short(c.name).toUpperCase() + (n && n.now ? '   ' + hhmm(n.now.start) : ''), 15, bw - 40, M), bx + 22, y + 26, 15, '#cdcdd2', M);
                cv.text(fit(cv, n && n.now ? n.now.title : (n ? 'No guide for this channel' : '...'), 22, bw - 90, B), bx + 22, y + 56, 22, C.text, B);
                if (n && n.now && n.now.isNew) cv.text('NEW', bx + bw - 18, y + 56, 13, '#e6e6ea', Object.assign({ align: 'right' }, B));
                const nx = bx + bw + 10;
                cv.roundRect(nx, y, nextW, ph, 16, C.navy);
                if (n && n.next) {
                    cv.text(hhmm(n.next.start), nx + 20, y + 26, 15, C.navyText, M);
                    cv.text(fit(cv, n.next.title, 20, nextW - 40, B), nx + 20, y + 56, 20, C.text, B);
                }
                btn(cv, 'row_' + c.id, x, y, w, ph, () => play(c, list), 16);
            }

            /* ---------- pages ---------- */
            function drawHome(cv, A, x0) {
                topBar(cv, A, x0);
                const right = A.right, y1 = A.y + 96;
                if (favs.length) {
                    section(cv, x0, y1, 'Favourites', right, null);
                    const cw = PLATE.card[0] + 18, fitN = Math.floor((right - x0 + 18) / cw);
                    const maxS = Math.max(0, (favs.length - fitN) * cw);
                    cv.clip(x0, y1 + 8, right - x0, PLATE.card[1] + 74);
                    const first = Math.floor(scroll.favs / cw);
                    favs.slice(first, first + fitN + 1).forEach((c, i) => card(cv, c, x0 + (first + i) * cw - scroll.favs, y1 + 12, favs));
                    cv.noclip();
                    if (favs.length > fitN) {
                        if (scroll.favs > 0) arrowBtn(cv, 'fav_l', x0 - 4, y1 + 60, -1, () => { scroll.favs = Math.max(0, scroll.favs - cw * (fitN - 1)); });
                        if (scroll.favs < maxS) arrowBtn(cv, 'fav_r', right - 44, y1 + 60, 1, () => { scroll.favs = Math.min(maxS, scroll.favs + cw * (fitN - 1)); });
                    }
                } else {
                    section(cv, x0, y1, 'Favourites', right, null);
                    glass(cv, x0, y1 + 12, right - x0, 120, 18);
                    cv.text('No favourites yet', x0 + 28, y1 + 60, 24, C.text, B);
                    cv.text('Play a channel, tap the picture, then Favourite. Your favourites and their TV guide show here.', x0 + 28, y1 + 96, 18, C.grey, M);
                }
                // the TV guide: the favourites, else the chosen category's first channels
                const gy = favs.length ? y1 + PLATE.card[1] + 120 : y1 + 182;
                const src = favs.length ? favs : shownList((lists[catSel] || { channels: [] }).channels);
                if (!favs.length) loadList(catSel);
                section(cv, x0, gy, 'TV Guide', right, () => go('live'));
                const rows = Math.max(1, Math.floor((A.bottom - gy - 12) / (PLATE.guide[1] + 10)));
                src.slice(0, rows).forEach((c, i) => guideRow(cv, c, x0, gy + 14 + i * (PLATE.guide[1] + 10), right - x0, src));
            }
            function arrowBtn(cv, key, x, y, dir, fn) {
                cv.circle(x + 22, y + 22, 22, A_('#000000', 0.7));
                cv.strokeRoundRect(x, y, 44, 44, 22, 1.5, A_('#ffffff', 0.3));
                const cx = x + 22, cy = y + 22;
                if (dir > 0) { cv.line(cx - 4, cy - 8, cx + 5, cy, 3, C.text); cv.line(cx + 5, cy, cx - 4, cy + 8, 3, C.text); }
                else { cv.line(cx + 4, cy - 8, cx - 5, cy, 3, C.text); cv.line(cx - 5, cy, cx + 4, cy + 8, 3, C.text); }
                btn(cv, key, x, y, 44, 44, fn, 22);
            }
            function drawLive(cv, A, x0) {
                topBar(cv, A, x0);
                const y0 = A.y + 70, colW = 340, rowH = 46;
                // categories
                glass(cv, x0, y0, colW, A.bottom - y0, 18, C.rail);
                const visRows = Math.floor((A.bottom - y0 - 16) / rowH);
                const oc = orderedCats();
                const maxC = Math.max(0, (oc.length - visRows) * rowH);
                if (!catsPlaced && oc.length) { catsPlaced = true; const i = oc.findIndex((c) => c.id === catSel); if (i >= visRows - 1) scroll.cats = (i - 1) * rowH; }
                scroll.cats = Math.min(scroll.cats, maxC);
                regions.push({ key: 'cats', x: x0, y: y0, w: colW, h: A.bottom - y0, max: maxC });
                cv.clip(x0, y0 + 6, colW, A.bottom - y0 - 12);
                const first = Math.floor(scroll.cats / rowH);
                if (!cats.length) cv.text(st && st.client && st.client.state !== 'connected' ? 'Connecting to your provider...' : 'Loading categories...', x0 + 20, y0 + 40, 18, C.grey, M);
                oc.slice(first, first + visRows + 2).forEach((c, i) => {
                    const y = y0 + 8 + (first + i) * rowH - scroll.cats, on = c.id === catSel;
                    if (on) cv.roundRect(x0 + 8, y, colW - 16, rowH - 6, 12, C.accentDim);
                    cv.text(fit(cv, catName(c.name), 18, colW - 44, on ? B : M), x0 + 22, y + 28, 18, on ? C.accent : '#e8e8ec', on ? B : M);
                    btn(cv, 'cat_' + c.id, x0 + 8, y, colW - 16, rowH - 6, () => { catSel = c.id; scroll.chans = 0; }, 12);
                });
                cv.noclip();
                // the category's channels: cards in a grid
                const gx = x0 + colW + 18, gw = A.right - gx;
                loadList(catSel);
                const L = lists[catSel], list = shownList(L ? L.channels : []);
                const cw = PLATE.card[0] + 16, chH = PLATE.card[1] + 70 + 16, cols = Math.max(1, Math.floor((gw + 16) / cw));
                const rowsV = Math.ceil((A.bottom - y0) / chH) + 1, maxS = Math.max(0, Math.ceil(list.length / cols) * chH - (A.bottom - y0));
                scroll.chans = Math.min(scroll.chans, maxS);
                regions.push({ key: 'chans', x: gx, y: y0, w: gw, h: A.bottom - y0, max: maxS });
                if (!L || L.loading && !list.length) cv.text('Loading the channels...', gx, y0 + 40, 20, C.grey, M);
                else if (L.error) cv.text(fit(cv, 'Could not load this category: ' + L.error, 18, gw, M), gx, y0 + 40, 18, C.red, M);
                else if (!list.length) cv.text('No channel the head unit can play in this category.', gx, y0 + 40, 18, C.grey, M);
                cv.clip(gx, y0, gw, A.bottom - y0);
                const r0 = Math.floor(scroll.chans / chH);
                for (let r = r0; r < r0 + rowsV; r++) {
                    for (let k = 0; k < cols; k++) {
                        const c = list[r * cols + k];
                        if (c) card(cv, c, gx + k * cw, y0 + r * chH - scroll.chans, list);
                    }
                }
                cv.noclip();
            }
            const search = { kb: null, field: { value: '', caret: 0, mask: false, max: 60 }, results: null, busy: false, at: 0, asked: '' };
            Object.defineProperty(search, 'text', { get: () => search.field.value });
            search.mode = 'channels';
            function setSearchMode(m) { if (search.mode === m) return; search.mode = m; search.results = null; search.asked = ''; search.at = 0; scroll.results = 0; }
            function runSearch() {
                const q = search.text.trim(), mode = search.mode;
                if (q.length < 2 || q === search.asked || search.busy) return;
                search.busy = true; search.asked = q; scroll.results = 0;
                const ask = mode === 'channels' ? svc.ask({ cmd: 'search', q }, 130000) : svc.ask({ cmd: 'vod-search', kind: mode, q, langs: langSet() }, 130000);
                ask.then((r) => {
                    search.busy = false;
                    if (search.text.trim() !== q || search.mode !== mode) { search.asked = ''; return; }
                    search.results = r.error ? { error: r.error, channels: [], items: [] } : { channels: r.channels || [], items: r.items || [],
                        progress: r.complete === false ? { done: r.done || 0, total: r.total || 0 } : null };
                    // films and series are indexed category by category: ask again until the index is complete
                    if (r.complete === false) { search.asked = ''; search.at = Date.now() + 800; }
                }, (e) => { search.busy = false; search.results = { error: e.message, channels: [], items: [] }; });
            }
            setInterval(guard('search', () => { if (page === 'search' && Date.now() - search.at > 700) runSearch(); }), 300);
            function drawSearch(cv, A, x0) {
                const kb = search.kb || (search.kb = new KB.Keyboard('abc'));
                const y = A.y, h = 52, right = A.right;
                // what is searched: channels, movies or series
                const modes = [['channels', 'Channels'], ['movies', 'Movies'], ['series', 'Series']], mw = 124;
                let mx = right - modes.length * (mw + 8) + 8;
                modes.forEach((md) => {
                    const on = search.mode === md[0];
                    cv.roundRect(mx, y, mw, h, h / 2, on ? C.accent : C.pill);
                    cv.text(md[1], mx + mw / 2, y + h / 2 + 7, 19, C.text, Object.assign({ align: 'center' }, on ? B : M));
                    btn(cv, 'smode_' + md[0], mx, y, mw, h, () => setSearchMode(md[0]), h / 2);
                    mx += mw + 8;
                });
                const fw = right - modes.length * (mw + 8) - 8 - x0;
                cv.roundRect(x0, y, fw, h, h / 2, C.pill);
                icon(cv, 'search', x0 + 30, y + h / 2, C.text);
                const hint = { channels: 'Type a channel name', movies: 'Type a movie title', series: 'Type a series title' }[search.mode];
                cv.text(search.text ? fit(cv, search.text, 24, fw - 120, B) + (Math.floor(Date.now() / 500) % 2 ? '|' : '') : hint, x0 + 56, y + h / 2 + 9, 24, search.text ? C.text : '#7a7a82', search.text ? B : M);
                // the results, beside the keyboard
                const kbW = Math.min(720, Math.round((right - x0) * 0.52)), rx = x0 + kbW + 20, rw = right - rx, ry = y + h + 18;
                const res = search.results, vodMode = search.mode !== 'channels';
                const catOK = (c) => { const k = cats.filter((x) => x.id === c.cat)[0]; return !k || langOK(k.name); };
                const list = res ? (vodMode ? vodShown(res.items) : shownList(res.channels).filter(catOK)) : [];
                const what = { channels: 'channel', movies: 'movie', series: 'series' }[search.mode];
                const prog = res && res.progress;
                if (search.busy && !(res && res.items && res.items.length)) cv.text(prog ? 'Searching...' : 'Searching every ' + what + '...', rx, ry + 30, 18, C.grey, M);
                else if (res && res.error) cv.text(fit(cv, res.error, 18, rw, M), rx, ry + 30, 18, C.red, M);
                else if (res && !list.length && !prog) cv.text('No ' + what + ' found.', rx, ry + 30, 18, C.grey, M);
                else if (res && !list.length) cv.text('Nothing yet...', rx, ry + 30, 18, C.grey, M);
                else if (!res) cv.text('Results show here as you type.', rx, ry + 30, 18, C.grey, M);
                if (vodMode) {
                    // the first search of a while indexes the account's categories: say how far, results come as they are found
                    if (prog && prog.total) {
                        cv.text(fit(cv, 'Looking through your ' + (search.mode === 'series' ? 'series' : 'movies') + ': ' + prog.done + ' of ' + prog.total + ' categories', 16, rw, M), rx, A.bottom - 6, 16, C.amber, M);
                    }
                    drawVodResults(cv, A, list, rx, list.length ? ry : ry + 50, rw, prog ? 26 : 0);
                    drawKeyboard(cv, A, kb, x0, ry, kbW);
                    return;
                }
                const rowH = PLATE.guide[1] + 10, vis = Math.floor((A.bottom - ry) / rowH);
                const maxS = Math.max(0, (list.length - vis) * rowH);
                scroll.results = Math.min(scroll.results, maxS);
                regions.push({ key: 'results', x: rx, y: ry, w: rw, h: A.bottom - ry, max: maxS });
                cv.clip(rx, ry, rw, A.bottom - ry);
                const f0 = Math.floor(scroll.results / rowH);
                list.slice(f0, f0 + vis + 2).forEach((c, i) => {
                    const yy = ry + (f0 + i) * rowH - scroll.results, n = nowOf(c.id);
                    plate(cv, c, rx, yy, PLATE.guide, 14, 'all');
                    glass(cv, rx + PLATE.guide[0] + 10, yy, rw - PLATE.guide[0] - 10, PLATE.guide[1], 14);
                    cv.text(fit(cv, short(c.name), 20, rw - PLATE.guide[0] - 50, B), rx + PLATE.guide[0] + 30, yy + 30, 20, C.text, B);
                    cv.text(fit(cv, n && n.now ? n.now.title : catName((cats.filter((k) => k.id === c.cat)[0] || {}).name || ''), 16, rw - PLATE.guide[0] - 50, M), rx + PLATE.guide[0] + 30, yy + 56, 16, C.grey, M);
                    btn(cv, 'res_' + c.id, rx, yy, rw, PLATE.guide[1], () => play(c, list), 14);
                });
                cv.noclip();
                drawKeyboard(cv, A, kb, x0, ry, kbW);
            }
            /** a film's or a series' search results: poster, title, year; a tap opens its page */
            function drawVodResults(cv, A, list, rx, ry, rw, foot) {
                const kind = search.mode, [pw, ph] = POSTER.result, rowH = ph + 12, bottom = A.bottom - (foot || 0), vis = Math.floor((bottom - ry) / rowH);
                const maxS = Math.max(0, (list.length - vis) * rowH);
                scroll.results = Math.min(scroll.results, maxS);
                regions.push({ key: 'results', x: rx, y: ry, w: rw, h: bottom - ry, max: maxS });
                cv.clip(rx, ry, rw, bottom - ry);
                const f0 = Math.floor(scroll.results / rowH);
                list.slice(f0, f0 + vis + 2).forEach((it, i) => {
                    const yy = ry + (f0 + i) * rowH - scroll.results;
                    posterAt(cv, kind, it, rx, yy, POSTER.result);
                    glass(cv, rx + pw + 10, yy, rw - pw - 10, ph, 14);
                    cv.text(fit(cv, it.name, 20, rw - pw - 50, B), rx + pw + 30, yy + 40, 20, C.text, B);
                    const sub = [it.year, it.rating ? Number(it.rating).toFixed(1) : null, it.hevc ? '4K / HEVC' : null].filter(Boolean).join('  ·  ');
                    if (sub) cv.text(sub, rx + pw + 30, yy + 68, 16, C.grey, M);
                    btn(cv, 'vres_' + it.id, rx, yy, rw, ph, () => openDetail(kind, it), 14);
                });
                cv.noclip();
            }
            function drawKeyboard(cv, A, kb, x0, ry, kbW) {
                const rows = kb.rows(), ky = ry, kh = Math.min(64, Math.floor((A.bottom - ky - 3 * 8) / 4)), gap = 8;
                rows.forEach((row, r) => {
                    const units = row.reduce((s, id) => s + (id === '#space' ? 4 : /^#/.test(id) ? 1.5 : 1), 0);
                    const kw = (kbW - gap * (row.length - 1)) / units;
                    let x = x0;
                    row.forEach((id) => {
                        const w = kw * (id === '#space' ? 4 : /^#/.test(id) ? 1.5 : 1), yy = ky + r * (kh + gap);
                        const label = { '#shift': kb.layer === 'ABC' ? 'abc' : 'ABC', '#layer': kb.layer === '123' ? 'abc' : '123', '#back': 'Del', '#space': 'Space', '#enter': 'Done', '#left': '<', '#right': '>', '#clear': 'Clear' }[id] || id;
                        cv.roundRect(x, yy, w - 0.5, kh, 12, /^#/.test(id) ? '#3a3a40' : C.pill);
                        cv.text(label, x + w / 2, yy + kh / 2 + 8, /^#/.test(id) ? 18 : 24, C.text, Object.assign({ align: 'center' }, /^#/.test(id) ? M : B));
                        btn(cv, 'key_' + r + '_' + id + '_' + x, x, yy, w, kh, () => {
                            const res2 = kb.apply(id, search.field);
                            if (res2 && res2.action === 'enter') { search.at = 0; runSearch(); } else search.at = Date.now();
                        }, 12);
                        x += w + gap;
                    });
                });
            }
            function drawPlayer(cv, A, fullH) {
                cv.fillRect(0, 0, W, fullH, '#000000');
                const pb = (st && st.playback) || {};
                const film = pb.kind === 'film' ? (playingFilm || { kind: 'movie', name: (pb.film && pb.film.name) || 'Film' }) : null;
                const ch = film ? null : playingCh, subject = film || ch;
                const pic = videoReady() && typeof cv.video === 'function';
                const allowed = pictureAllowed();
                if (subject && pic && allowed && pb.state !== 'idle') cv.video(VID, 0, 0, W, fullH);
                // what the picture cannot say: loading, an error, the park rule
                const mid = fullH / 2;
                let msg = null, sub = null;
                if (!subject || pb.state === 'idle') { msg = 'Nothing playing'; sub = 'Choose a channel, a film or a series.'; }
                else if (pb.state === 'error') { msg = film ? 'This one did not play' : 'This channel did not play'; sub = pb.error || ''; }
                // 0.3.8: a 4K HDR film the car cannot show: the service looks for its HD version in the account
                else if (pb.state === 'finding') { msg = 'Finding the HD version...'; sub = pb.note || '4K HDR does not play in this car.'; }
                else if (pb.state === 'loading') { msg = (film ? 'Starting ' : 'Tuning ') + short((pb.note && pb.film && pb.film.name) || subject.name) + '...'; sub = pb.error ? 'Reconnecting: ' + pb.error : pb.note || ''; }
                else if (pb.state === 'ended') { msg = 'The end'; sub = 'Play starts it again; the arrow goes back.'; }
                else if (!allowed) { msg = 'The picture shows while parked'; sub = 'The sound goes on. A passenger can watch while driving: Settings, Video while driving.'; }
                else if (!pic && gpuVideo()) { msg = 'Starting the picture...'; sub = ''; }
                else if (!pic) { msg = 'Waiting for the GPU renderer'; sub = 'Install a renderer from the Store (mgu-render), then restart the head unit.'; }
                if (msg && !panel) {
                    cv.text(msg, W / 2, mid - 10, 34, C.text, Object.assign({ align: 'center' }, B));
                    if (sub) cv.text(fit(cv, sub, 19, W - 200, M), W / 2, mid + 30, 19, C.grey, Object.assign({ align: 'center' }, M));
                    // nothing plays where something was asked for, or it failed: the service's last words (a photo of them says why)
                    if ((!subject || pb.state === 'idle' || pb.state === 'error') && st && Array.isArray(st.log) && (playingFilm || playingCh)) {
                        st.log.slice(-4).forEach((l, i) => cv.text(fit(cv, String(l), 15, W - 240, M), W / 2, mid + 70 + i * 22, 15, '#8a8a92', Object.assign({ align: 'center' }, M)));
                    }
                }
                // the controls (the arrow among them) only after a tap: the picture, or the message, stays clean otherwise
                const show = Date.now() < overlayUntil || panel;
                // why there is no sound, or no picture, said over the picture
                // 0.3.8: the HD version playing instead of the 4K one: said for 10 s at the top
                if (pb.note && pb.note !== noteSeen) { noteSeen = pb.note; noteUntil = Date.now() + 10000; }
                const snd = soundProblem(pb) || pictureProblem(pb) || (pb.note && Date.now() < noteUntil && pb.state === 'playing' ? pb.note : null);
                if (snd && !msg) {
                    // 0.3.3: up to three lines (the decoder's own error is long: it names each 10-bit try)
                    const rows = wrapText(cv, snd, 19, W - 400, M, 3);
                    const sw = Math.max.apply(null, rows.map((r) => cv.textWidth(r, 19, M))) + 52, sh = 18 + rows.length * 26;
                    cv.roundRect((W - sw) / 2, A.y + 6, sw, sh, Math.min(21, sh / 2), A_('#000000', 0.7));
                    rows.forEach((r, k) => cv.text(r, W / 2, A.y + 34 + k * 26, 19, C.amber, Object.assign({ align: 'center' }, M)));
                }
                // a tap anywhere else shows the controls (or hides them): drawn last, since the kit gives a tap to the
                // first target under the finger and this one, drawn first, took every tap (the back arrow, the actions)
                const picBtn = () => btn(cv, 'pic', 0, A.y, W, fullH - A.y, () => { if (Date.now() < overlayUntil && !panel) overlayUntil = 0; else overlayUntil = Date.now() + 6000; panel = null; }, 0);
                // the back arrow: a tap shows it on every screen, nothing playing included (0.2.2 in the car: a dead end)
                const backArrow = () => {
                    cv.roundRect(A.x, A.y, 56, 56, 28, A_('#ffffff', 0.18));
                    cv.line(A.x + 33, A.y + 16, A.x + 21, A.y + 28, 3.5, C.text); cv.line(A.x + 21, A.y + 28, A.x + 33, A.y + 40, 3.5, C.text);
                    btn(cv, 'p_back', A.x, A.y, 56, 56, () => { page = (film || playingFilm) && detail ? 'detail' : 'home'; panel = null; }, 28);
                };
                if (!show || !subject) { if (show) backArrow(); picBtn(); return; }
                // the top: back, LIVE
                cv.gradientRect(0, 0, W, 140, [[0, A_('#000000', 0.6)], [1, A_('#000000', 0)]]);
                backArrow();
                // LIVE, or a film's time
                const tag = film ? hms(pb.pos || 0) + (pb.duration ? ' / ' + hms(pb.duration) : '') : 'LIVE';
                const tw = film ? cv.textWidth(tag, 20, B) + 40 : 92;
                cv.roundRect(A.right - tw - 4, A.y + 6, tw, 42, 21, film ? A_('#ffffff', 0.18) : C.accent);
                cv.text(tag, A.right - 4 - tw / 2, A.y + 35, 20, C.text, Object.assign({ align: 'center' }, B));
                // full screen <-> the app's page: four corner marks, pointing out (go full) or in (leave it)
                const fx = A.right - tw - 4 - 16 - 56, fy = A.y;
                cv.roundRect(fx, fy, 56, 56, 28, A_('#ffffff', 0.18));
                const inward = fullOn, c0 = 17, c1 = 9;
                [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((d) => {
                    const cx = fx + 28 + d[0] * (inward ? c1 : c0), cy = fy + 28 + d[1] * (inward ? c1 : c0), k = inward ? 1 : -1;
                    cv.line(cx, cy, cx + d[0] * 7 * k, cy, 3, C.text);
                    cv.line(cx, cy, cx, cy + d[1] * 7 * k, 3, C.text);
                });
                btn(cv, 'p_full', fx, fy, 56, 56, () => { setFull(!fullOn); overlayUntil = Date.now() + 6000; }, 28);
                if (film) { drawFilmBar(cv, A, fullH, film, pb); picBtn(); return; }
                // the bottom: the channel, the programme, the next, the actions
                const by = fullH - 200;
                cv.gradientRect(0, by - 60, W, fullH - by + 60, [[0, A_('#000000', 0)], [0.45, A_('#000000', 0.7)], [1, A_('#000000', 0.88)]]);
                const n = nowOf(ch.id);
                plate(cv, ch, A.x, by, PLATE.player, 18);
                const tx = A.x + PLATE.player[0] + 26;
                cv.text(short(ch.name).toUpperCase(), tx, by + 26, 17, '#d2d2d6', B);
                cv.text(fit(cv, n && n.now ? n.now.title : short(ch.name), 36, 820, B), tx, by + 68, 36, C.text, B);
                if (n && n.now) cv.text(hhmm(n.now.start) + ' - ' + hhmm(n.now.stop), tx, by + 98, 18, '#c8c8cc', M);
                const pw = A.right - 4 * 150 - A.x - 30;
                cv.roundRect(A.x, by + 130, pw, 6, 3, A_('#ffffff', 0.3));
                if (n && n.now) {
                    const f = Math.max(0, Math.min(1, (Date.now() / 1000 - n.now.start) / Math.max(1, n.now.stop - n.now.start)));
                    cv.roundRect(A.x, by + 130, Math.max(6, Math.round(pw * f)), 6, 3, C.accent);
                }
                if (n && n.next) cv.text(fit(cv, 'Next   ' + hhmm(n.next.start) + '   ' + n.next.title, 19, pw, M), A.x, by + 172, 19, '#dcdce0', M);
                const acts = [['Stop', () => stopPlay(), false], ['Guide', () => { panel = panel === 'guide' ? null : 'guide'; loadGuide(ch.id); }, panel === 'guide'],
                    ['Channels', () => { panel = panel === 'channels' ? null : 'channels'; }, panel === 'channels'], ['Favourite', () => toggleFav(ch), isFav(ch.id)]];
                let ax = A.right;
                acts.forEach((a) => {
                    const w = 150; ax -= w;
                    cv.roundRect(ax, by + 112, w - 12, 50, 25, a[2] ? C.accent : A_('#ffffff', 0.2));
                    cv.text(a[0], ax + (w - 12) / 2, by + 144, 19, C.text, Object.assign({ align: 'center' }, B));
                    btn(cv, 'act_' + a[0], ax, by + 112, w - 12, 50, () => { a[1](); overlayUntil = Date.now() + 6000; }, 25);
                });
                if (panel === 'guide') drawGuidePanel(cv, A, ch, by);
                if (panel === 'channels') drawChannelsPanel(cv, A, by);
                picBtn();
            }
            // what keeps a playing film's picture away (sound playing): the decoder's refusal, or no picture decoded in 8 s
            let blindSince = 0, noteSeen = null, noteUntil = 0;
            function pictureProblem(pb) {
                if (!pb || pb.kind !== 'film' || pb.state !== 'playing') { blindSince = 0; return null; }
                const v = pb.video || {}, what = (v.codec || '?').toUpperCase() + ' ' + (v.w || '?') + 'x' + (v.h || '?');
                if (pb.shown > 0) { blindSince = 0; return null; }      // 0.3.3: a picture showing outranks an earlier start error
                if (pb.videoError) return 'No picture (' + what + '): ' + pb.videoError;
                if (!blindSince) blindSince = Date.now();
                return Date.now() - blindSince > 8000 ? 'No picture (' + what + '): nothing decoded, ' + (pb.decerr || 0) + ' decode errors' : null;
            }
            // what keeps a playing channel silent, or null
            let silentSince = 0;
            function soundProblem(pb) {
                if (!pb || pb.state !== 'playing') { silentSince = 0; return null; }
                const a = audio.state();
                if (pb.audioError) return 'No sound: ' + pb.audioError;
                if (a.taken) return 'No sound: another app (AirPlay, TVH Player) has the car\'s speakers';
                if (a.error) return 'No sound: ' + a.error;
                if (a.connected) { silentSince = 0; return null; }
                if (!silentSince) silentSince = Date.now();
                return Date.now() - silentSince > 6000 ? 'No sound: the speakers did not connect (car audio)' : null;
            }
            const guides = {};
            function loadGuide(id) {
                if (guides[id] && Date.now() - guides[id].at < 180000) return;
                guides[id] = { at: Date.now(), loading: true, events: [] };
                svc.ask({ cmd: 'epg', id }, 30000).then((r) => { guides[id] = { at: Date.now(), events: r.events || [], error: r.error }; }, (e) => { guides[id] = { at: Date.now(), events: [], error: e.message }; });
            }
            function drawGuidePanel(cv, A, ch, by) {
                const x = A.right - 620, y = A.y + 70, w = 616, h = by - y - 20;
                cv.roundRect(x, y, w, h, 22, A_('#111114', 0.94));
                cv.text('Guide  ·  ' + short(ch.name), x + 24, y + 38, 20, C.text, B);
                const g = guides[ch.id];
                if (!g || g.loading) { cv.text('Loading...', x + 24, y + 80, 18, C.grey, M); return; }
                if (!g.events.length) { cv.text(g.error || 'No guide for this channel.', x + 24, y + 80, 18, C.grey, M); return; }
                const rowH = 44, vis = Math.floor((h - 60) / rowH), maxS = Math.max(0, (g.events.length - vis) * rowH);
                scroll.guide = Math.min(scroll.guide, maxS);
                regions.push({ key: 'guide', x, y: y + 54, w, h: h - 54, max: maxS });
                cv.clip(x, y + 54, w, h - 60);
                const t = Date.now() / 1000;
                g.events.forEach((e, i) => {
                    const yy = y + 60 + i * rowH - scroll.guide;
                    if (yy < y + 30 || yy > y + h) return;
                    const on = e.start <= t && e.stop > t;
                    cv.text(hhmm(e.start), x + 24, yy + 24, 17, on ? C.accent : C.grey, on ? B : M);
                    cv.text(fit(cv, e.title, 19, w - 130, on ? B : M), x + 100, yy + 24, 19, C.text, on ? B : M);
                });
                cv.noclip();
            }
            function drawChannelsPanel(cv, A, by) {
                const x = A.right - 620, y = A.y + 70, w = 616, h = by - y - 20;
                cv.roundRect(x, y, w, h, 22, A_('#111114', 0.94));
                cv.text('Channels', x + 24, y + 38, 20, C.text, B);
                const list = zapList, rowH = PLATE.guide[1] / 1.4 + 10, ph = Math.round(PLATE.guide[1] / 1.4);
                const vis = Math.floor((h - 60) / rowH), maxS = Math.max(0, (list.length - vis) * rowH);
                scroll.guide = Math.min(scroll.guide, maxS);
                regions.push({ key: 'guide', x, y: y + 54, w, h: h - 54, max: maxS });
                cv.clip(x, y + 54, w, h - 60);
                const f0 = Math.floor(scroll.guide / rowH);
                list.slice(f0, f0 + vis + 2).forEach((c, i) => {
                    const yy = y + 60 + (f0 + i) * rowH - scroll.guide, on = playingCh && c.id === playingCh.id, n = nowOf(c.id);
                    if (on) cv.roundRect(x + 10, yy - 4, w - 20, ph + 8, 12, C.accentDim);
                    cv.text(fit(cv, short(c.name), 19, w - 60, B), x + 24, yy + 22, 19, on ? C.accent : C.text, B);
                    cv.text(fit(cv, n && n.now ? n.now.title : '', 15, w - 60, M), x + 24, yy + 44, 15, C.grey, M);
                    btn(cv, 'zap_' + c.id, x + 10, yy - 4, w - 20, ph + 8, () => { play(c, null); panel = 'channels'; }, 12);
                });
                cv.noclip();
            }
            function drawSignin(cv, A, x0) {
                const right = A.right, cx = x0 + (right - x0) / 2;
                if (svcErrCode === 'ENOSVC') {
                    cv.text('The IPTV service is not installed', cx, A.y + 150, 32, C.text, Object.assign({ align: 'center' }, B));
                    cv.text('In the Store, install "IPTV service" from this source, then restart the head unit once.', cx, A.y + 194, 20, C.grey, Object.assign({ align: 'center' }, M));
                    return;
                }
                if (svcErr) {
                    cv.text('Cannot reach the IPTV service', cx, A.y + 150, 32, C.text, Object.assign({ align: 'center' }, B));
                    cv.text(fit(cv, svcErr, 20, right - x0 - 80, M), cx, A.y + 194, 20, C.grey, Object.assign({ align: 'center' }, M));
                    return;
                }
                const pg = st && st.page;
                const lx = x0 + 20, tw = Math.round((right - x0) * 0.55);
                cv.text('Sign in to your IPTV', lx, A.y + 60, 36, C.text, B);
                const lines = ['Your login goes from your phone to this car only.',
                    'It is never stored in the app or sent anywhere else.', '',
                    '1.  Connect the iPhone to the car with wireless CarPlay (the car Wi-Fi).',
                    '2.  Tap Sign in, then scan the code with the phone\'s camera.',
                    '3.  Enter the server, the user name and the password your provider gave you.'];
                lines.forEach((l, i) => cv.text(fit(cv, l, 19, tw, M), lx, A.y + 110 + i * 32, 19, i < 2 ? C.grey : C.text, M));
                const by = A.y + 110 + lines.length * 32 + 20;
                cv.roundRect(lx, by, 220, 56, 28, C.accent);
                cv.text(pg && pg.open ? 'Code shown' : 'Sign in', lx + 110, by + 37, 22, C.text, Object.assign({ align: 'center' }, B));
                btn(cv, 'signin', lx, by, 220, 56, () => svc.ask({ cmd: 'signin-open' }).then(poll, (e) => say(e.message)), 28);
                if (st && st.client && st.client.state === 'refused') cv.text(fit(cv, st.client.error || '', 18, tw, M), lx + 240, by + 34, 18, C.red, M);
                // the QR code
                const qx = right - 360, qy = A.y + 20, qs = 320;
                cv.roundRect(qx, qy, qs, qs, 24, pg && pg.open && pg.url ? '#ffffff' : '#1c1c1e');
                if (pg && pg.open && pg.url) {
                    const qr = qrOf(pg.url), n = qr.size + 6, m = (qs - 24) / n;
                    for (let y = 0; y < qr.size; y++) {
                        for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) cv.fillRect(qx + 12 + (x + 3) * m, qy + 12 + (y + 3) * m, m + 0.6, m + 0.6, '#000000');
                    }
                    cv.text('Open with the phone\'s camera  ·  ' + Math.ceil((pg.left || 0) / 60) + ' min left', qx + qs / 2, qy + qs + 30, 16, C.grey, Object.assign({ align: 'center' }, M));
                } else if (pg && pg.open) {
                    cv.text('No car Wi-Fi yet', qx + qs / 2, qy + qs / 2 - 6, 22, C.text, Object.assign({ align: 'center' }, B));
                    cv.text('Connect wireless CarPlay', qx + qs / 2, qy + qs / 2 + 24, 17, C.grey, Object.assign({ align: 'center' }, M));
                } else {
                    cv.text('The code shows here', qx + qs / 2, qy + qs / 2 + 6, 20, C.grey, Object.assign({ align: 'center' }, M));
                }
            }
            let qrMemo = null;
            function qrOf(url) { if (!qrMemo || qrMemo.url !== url) qrMemo = { url, qr: qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.MEDIUM) }; return qrMemo.qr; }
            function drawSoon(cv, A, x0) {
                topBar(cv, A, x0);
                const cx = x0 + (A.right - x0) / 2;
                cv.text(soonWhat === 'series' ? 'Series' : 'Movies', cx, A.y + 200, 36, C.text, Object.assign({ align: 'center' }, B));
                cv.text('Coming in a later version: films and series need a player that opens their file types.', cx, A.y + 244, 20, C.grey, Object.assign({ align: 'center' }, M));
            }

            /* ---------- the frame ---------- */
            FS.setup(ctx);
            ui.onClick('BTN_HOME', guard('home', () => go('home')));
            ui.onClick('BTN_LIVE', guard('live', () => go('live')));
            ui.onClick('BTN_WATCH', guard('watch', () => { if (playingCh) { page = 'player'; overlayUntil = Date.now() + 6000; } }));
            ui.onClick('BTN_STOP', guard('stop', stopPlay));
            ui.onClick('BTN_SIGNIN', guard('signin', () => { go('signin'); svc.ask({ cmd: 'signin-open' }).then(poll, () => {}); }));
            ctx.loop('MAIN', 10, guard('draw', async () => {
                const cv = ctx.canvas(W, H), A = FS.area(cv), fullH = H + (cv.extra || 0);
                if (cv.chrome) G.frame(cv, ctx.theme(), ['IPTV'], 0, []);
                regions.length = 0;
                syncFull();
                // under the full view the page draws nothing: its layer stays clear, so the full view shows whichever of
                // the two the renderer puts in front (the newest shown is; on the car the page came back over it, black)
                if (!(page === 'player' && fv.shown())) cv.fillRect(0, 0, W, fullH, C.bg);
                if (page === 'player' && fv.shown()) {
                    fv.draw((rec, FH) => drawPlayer(rec, { x: 96, y: 24, right: W - 40, bottom: FH - 20, w: W - 136, h: FH - 44, own: true }, FH));
                } else if (page === 'player') drawPlayer(cv, A, fullH);
                else {
                    rail(cv, A);
                    const x0 = A.x + 128;
                    if (page === 'signin' || (!signedIn() && page !== 'soon')) drawSignin(cv, A, x0);
                    else if (page === 'home') drawHome(cv, A, x0);
                    else if (page === 'live') drawLive(cv, A, x0);
                    else if (page === 'search') drawSearch(cv, A, x0);
                    else if (page === 'movies' || page === 'series') drawVod(cv, A, x0, page);
                    else if (page === 'detail') drawDetail(cv, A, x0);
                    else drawSoon(cv, A, x0);
                }
                if (toast && Date.now() < toast.until) {
                    const s = fit(cv, toast.text, 19, 800, B), tw = cv.textWidth(s, 19, B) + 52;
                    cv.roundRect((W - tw) / 2, A.bottom - 64, tw, 46, 23, A_('#2c2c30', 0.96));
                    cv.text(s, W / 2, A.bottom - 34, 19, C.text, Object.assign({ align: 'center' }, B));
                }
                await ui.image('MAIN_GFX', cv);
            }));
            log.info('started ' + VERSION + ', fonts ' + F_BOLD + '/' + F_MED);
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
