'use strict';

/**
 * BMW ID7 GameStation: wiring. Drawing lives in ui.js, the running game in session.js,
 * files in library.js, the phone pads in controller_server.js (firewall: native/game-net).
 * All emulation is local to the MGU JavaScript process; phones are input devices only.
 * Emulation is strictly inhibited without a recent, valid speed of <= 0.5 km/h.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const kitCanvas = require('./kit/canvas');
const {setImage} = require('./kit/record');
const {ControllerServer} = require('./controller_server');
const {Library, title} = require('./library');
const {Session} = require('./session');
const {Pong} = require('./arcade');
const {NesGame} = require('./nes_core');
const {GameBoyGame} = require('./gb_core');
const {SnesGame} = require('./snes_core');
const {IDrivePad, padsForMode} = require('./idrive_pad');
const {makeUi, PAGE, PAGE_SIZE, PLATFORMS, IMAGE, W, H} = require('./ui');

const NOTICE_MS = {info: 5000, warn: 8000, error: 10000};
const MODE_ORDER = ['phones', 'phone', 'idrive', 'hybrid'];
const CORES = {nes: NesGame, snes: SnesGame, gb: GameBoyGame};
const SPEED_FRESH_MS = 5000, SPEED_MAX_KMH = 0.5;
const KEY_NAMES = {a: 'A', b: 'B', x: 'X', y: 'Y', l: 'L', r: 'R', start: 'START', select: 'SELECT'};

mgu.run({
    async start(ctx) {
        const log = ctx.log;
        const ui = makeUi(G, kitCanvas);
        const library = new Library(ctx.dataDir);
        const idrive = new IDrivePad();

        let page = PAGE.GAMES, platform = 0, deleting = false, armed = null, notice = null;
        const listPage = {};
        let session = null, running = false, grabbed = false, lastInputgateAt = 0;
        let counts = library.counts(), countsAt = Date.now();
        let fps = 0, fpsFrames = 0, fpsAt = Date.now(), lastBroadcast = 0;
        const lastGame = library.last();
        if (lastGame) platform = Math.max(0, PLATFORMS.findIndex(p => p.id === lastGame.kind));

        const mode = () => MODE_ORDER.indexOf(ctx.settings.get('controllerMode')) >= 0 ? ctx.settings.get('controllerMode') : 'phones';
        const useIDrive = () => mode() === 'idrive' || mode() === 'hybrid';
        const singlePlayer = () => mode() === 'idrive' || mode() === 'phone';
        function say(text, level) {
            level = level || 'info';
            notice = text ? {text: String(text), level, until: Date.now() + NOTICE_MS[level]} : null;
        }

        /* ---------------- safety: fresh speed <= 0.5 km/h, fail closed ---------------- */
        let speed = null, speedAt = 0;
        ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2: v => {
                const raw = v && v.speedVehicleCentreOfGravity;
                if (typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw !== 65535) {
                    speed = raw * 0.015625;
                    speedAt = Date.now();
                }
            },
        }, log, {pollMs: 2000}).then(s => {
            if (s && s.error) log.warn('[GameStation] speed subscription: ' + s.error);
        }).catch(e => log.warn('[GameStation] speed subscription: ' + e.message));
        const fresh = () => speed !== null && Date.now() - speedAt < SPEED_FRESH_MS;
        const parked = () => fresh() && speed <= SPEED_MAX_KMH;
        const lock = () => !fresh() ? 'nosignal' : speed > SPEED_MAX_KMH ? 'moving' : 'parked';
        const lockHint = () => lock() === 'nosignal' ? 'Waiting for a valid vehicle-speed signal. Games stay paused.' :
            lock() === 'moving' ? 'The car is moving. Games are paused until it stands still.' : '';

        /* ---------------- iDrive controller ---------------- */
        function configureIDrive() {
            idrive.configure({turnClockwise: ctx.settings.get('idriveClockwise'),
                turnCounterclockwise: ctx.settings.get('idriveCounterclockwise')});
        }
        configureIDrive();
        ctx.settings.onChange(key => {
            if (key === 'idriveClockwise' || key === 'idriveCounterclockwise' || key === null) configureIDrive();
        });
        if (ctx.controller && ctx.controller.onInput) ctx.controller.onInput(v => {
            lastInputgateAt = Date.now();
            idrive.raw(v);
        });
        // Fallback when inputgate is absent: BMW FrontCCU SOME/IP stream.
        // A recent inputgate event wins so a single click is not counted twice.
        ctx.signals.watch('de.bmw.infotainment.controlelements.FrontCCU', '1', {
            statusRotaryEncoderState: v => { if (Date.now() - lastInputgateAt > 1000) idrive.raw(v); },
        }, log).then(s => {
            if (s && s.error) log.warn('[GameStation] FrontCCU signal: ' + s.error);
        }).catch(e => log.warn('[GameStation] FrontCCU signal: ' + e.message));

        /* ---------------- the running game ---------------- */
        const sheetOpen = () => !!(ctx.display && ctx.display.sheet);
        const inFront = () => ctx.ui.isVisible('MAIN') && ctx.ui.hasFocus('MAIN') && !sheetOpen();
        const mayRun = () => !!session && page === PAGE.PLAY && parked() && inFront();
        function syncIDriveCapture() {
            const want = mayRun() && useIDrive() && !session.paused;
            if (want === grabbed) return;
            grabbed = want;
            idrive.setEnabled(want);
            if (ctx.controller) ctx.controller.grab(want);
            log.info('[GameStation] iDrive input ' + (want ? 'captured' : 'released') + ' mode=' + mode());
        }
        function quit() {
            if (!session) return;
            session.stop();
            log.info('[GameStation] stopped ' + session.kind + '/' + session.name);
            session = null; running = false;
            syncIDriveCapture();
        }
        function start(kind, name) {
            if (!parked()) { say(lockHint(), 'warn'); return; }
            if (session && session.kind === kind && session.name === name) { open(PAGE.PLAY); return; }
            quit();
            let game = null, next = null;
            try {
                if (kind === 'arcade') {
                    game = new Pong({cpuPlayer2: singlePlayer()});
                    next = new Session(game, kind, name, {log});
                } else if (CORES[kind]) {
                    const bytes = library.read(kind, name), save = library.loadSave(kind, name), holder = {s: null};
                    // the core paints into whichever session holds it (created right after the core)
                    game = new CORES[kind](bytes, (px, w, h) => { if (holder.s) holder.s.paint(px, w, h); }, {save});
                    next = holder.s = new Session(game, kind, name, {store: (k, n, b) => library.store(k, n, b), log});
                    if (save) say('In-game save loaded.');
                } else throw new Error('Unknown console');
            } catch (e) {
                if (game && game.stop) try { game.stop(); } catch (_) { /* half started */ }
                say('Could not start this game: ' + e.message, 'error');
                log.warn('[GameStation] start ' + kind + '/' + name + ': ' + e.message);
                return;
            }
            session = next;
            session.title = kind === 'arcade' ? 'Pong' : title(name);
            session.hasSave = typeof game.sram === 'function' && !!game.sram();
            idrive.setPong(kind === 'arcade');
            library.remember(kind, name);
            deleting = false; armed = null; fps = 0; fpsFrames = 0; fpsAt = Date.now();
            page = PAGE.PLAY;
            log.info('[GameStation] started ' + kind + '/' + name);
        }
        function togglePause() {
            if (!session) return;
            if (session.paused && !parked()) { say(lockHint(), 'warn'); return; }
            session.toggle();
        }

        /* ---------------- pages ---------------- */
        function open(next) {
            if (page === PAGE.PLAY && next !== PAGE.PLAY && session) session.save();
            if (next !== page) notice = null;
            if (next !== PAGE.GAMES) { deleting = false; armed = null; }
            page = next;
            if (next === PAGE.GAMES) refreshCounts();
        }
        function refreshCounts() { counts = library.counts(); countsAt = Date.now(); }
        function entries() {
            const spec = PLATFORMS[platform];
            if (spec.id === 'arcade') return [{kind: 'arcade', name: 'pong', title: 'Pong',
                detail: 'Two players, or one against the car'}];
            return library.list(spec.id).map(g => ({kind: g.kind, name: g.name, title: g.title,
                detail: (g.size >= 1048576 ? (g.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(g.size / 1024)) + ' KB') +
                    (g.saved ? '  ·  save kept' : '')}));
        }
        function listOf() {
            const all = entries(), pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
            const index = Math.max(0, Math.min(pages - 1, listPage[platform] || 0));
            listPage[platform] = index;
            return {items: all.slice(index * PAGE_SIZE, index * PAGE_SIZE + PAGE_SIZE), page: index, pages,
                start: index * PAGE_SIZE, total: all.length};
        }
        function remove(item) {
            const key = item.kind + '/' + item.name;
            if (!armed || armed.key !== key || Date.now() - armed.at > 5000) { armed = {key, at: Date.now()}; return; }
            armed = null;
            if (session && session.kind === item.kind && session.name === item.name) quit();
            try {
                library.remove(item.kind, item.name);
                say('Deleted ' + item.title + '.');
                log.info('[GameStation] deleted on the car: ' + key);
            } catch (e) { say('Could not delete: ' + e.message, 'error'); }
            refreshCounts();
            if (!counts[item.kind]) deleting = false;
        }
        const actions = {
            open,
            platform: i => { platform = i; deleting = false; armed = null; open(PAGE.GAMES); },
            turn: d => { listPage[platform] = (listPage[platform] || 0) + d; },
            play: item => start(item.kind, item.name),
            resumeLast: () => { const l = library.last(); if (l) start(l.kind, l.name); else say('The last game is no longer on the car.', 'warn'); },
            toggleDelete: () => { deleting = !deleting; armed = null; },
            remove,
            togglePause,
            quit: () => { quit(); open(PAGE.GAMES); },
            nextMode: () => {
                const next = MODE_ORDER[(MODE_ORDER.indexOf(mode()) + 1) % MODE_ORDER.length];
                ctx.settings.set('controllerMode', next);
            },
            drawArcade: (cv, x, y, w, h) => {
                if (!session || !session.arcade) return;
                const k = Math.min(w / session.game.width, h / session.game.height);
                const gw = session.game.width * k, gh = session.game.height * k;
                session.game.draw(cv, x + (w - gw) / 2, y + (h - gh) / 2, gw, gh);
            },
        };

        /* ---------------- phones ---------------- */
        function phoneState() {
            return {title: session ? session.title : '', kind: session ? session.kind : '',
                paused: !!(session && (session.paused || !mayRun())), moving: !parked()};
        }
        const server = new ControllerServer(ctx.dataDir, {
            upload: (kind, name) => { refreshCounts(); say('Game added from a phone: ' + name); },
            removing: (kind, name) => { if (session && session.kind === kind && session.name === name) quit(); },
            removed: (kind, name) => { refreshCounts(); say('Deleted from a phone: ' + name); },
            command: (player, msg) => {
                if (!session) return;
                if (msg.type === 'pause' && !session.paused) session.pause('user');
                else if (msg.type === 'resume' && session.paused) togglePause();
            },
            state: phoneState,
        }, log, {library});
        try { server.start(); }
        catch (e) { server.error = e.message; log.warn('[GameStation] phone server: ' + e.message); }

        /* ---------------- the HMI's bar, the header's tabs ---------------- */
        ctx.ui.onClick('BTN_PLATFORM', () => actions.platform((platform + 1) % PLATFORMS.length));
        ctx.ui.onClick('BTN_ACTION', () => {
            if (page === PAGE.PLAY && session) return togglePause();
            const list = listOf();
            if (session) return open(PAGE.PLAY);
            const last = library.last();
            if (last) return start(last.kind, last.name);
            if (list.items[0]) return start(list.items[0].kind, list.items[0].name);
            say('No games yet. Open Controllers to add one from a phone.');
        });
        ctx.ui.onClick('BTN_PAIR', () => open(page === PAGE.PADS ? (session ? PAGE.PLAY : PAGE.GAMES) : PAGE.PADS));
        if (typeof ctx.onTab === 'function') ctx.onTab(i => open(i));
        if (ctx.ui.onFocus) ctx.ui.onFocus(syncIDriveCapture);
        ctx.ui.onVisible((name, visible) => { if (name === 'MAIN' && !visible && session) session.save(); });

        let exited = false;
        process.on('exit', () => {
            if (exited) return;
            exited = true;
            if (grabbed && ctx.controller) ctx.controller.grab(false);
            if (session) session.stop();
            server.stop();
        });

        /* ---------------- what the pages show ---------------- */
        function players() {
            const phone = server.status();
            const live = idrive.live();
            const knob = {label: 'iDrive controller', ok: live, wait: !live, state: live ? 'Ready' : 'Turn or press the knob'};
            const phoneRow = i => ({label: 'Phone (player ' + (i + 1) + ')', ok: phone[i], wait: !phone[i],
                state: phone[i] ? 'Connected' : 'Scan the code in Controllers'});
            const cpu = session && session.arcade ? {label: 'The car (CPU)', ok: true, state: 'Plays the right paddle'} :
                {label: 'Not used', ok: true, state: 'Single player setup'};
            const m = mode();
            return [m === 'idrive' || m === 'hybrid' ? knob : phoneRow(0), m === 'phones' || m === 'hybrid' ? phoneRow(1) : cpu];
        }
        function help() {
            if (!useIDrive()) return session && session.arcade ? 'Phones: up / down move the paddle.' : '';
            const cw = KEY_NAMES[idrive.turnClockwise] || 'B', ccw = KEY_NAMES[idrive.turnCounterclockwise] || 'X';
            return session && session.arcade ? 'iDrive: turn or push up / down to move the paddle.' :
                'iDrive: push = D-pad · press = A · hold = SELECT · double press = START · turn right = ' + cw + ' · turn left = ' + ccw + '.';
        }
        function pads() {
            const net = server.net, listening = !!server.listening, m = mode(), phone = server.status();
            const ready = net.ready && listening;
            const blocked = server.error ? 'Phone server: ' + server.error :
                !listening ? 'The phone server is starting.' :
                !net.known ? 'Install "GameStation Phone Port" (mgu-game-net) from MGU Store, or phones cannot reach the car.' :
                !net.ready ? 'Opening the Wi-Fi port for the phones' + (net.error ? ': ' + net.error : '...') : '';
            const link = i => listening ? server.url(i + 1) : null;
            const idriveP1 = m === 'idrive' || m === 'hybrid', p2Used = m === 'phones' || m === 'hybrid';
            const slots = [
                idriveP1 ? {role: 'iDrive plays. This phone code only adds games.', link: link(0), locked: blocked,
                    ok: idrive.live(), wait: !idrive.live(), state: idrive.live() ? 'iDrive ready' : 'iDrive: turn or press the knob'} :
                    {role: 'Controller and adding games', link: link(0), locked: blocked, ok: phone[0], wait: !phone[0],
                        state: phone[0] ? 'Phone connected' : 'Waiting for a phone'},
                p2Used ? {role: 'Controller and adding games', link: link(1), locked: blocked, ok: phone[1], wait: !phone[1],
                    state: phone[1] ? 'Phone connected' : 'Waiting for a phone'} :
                    {role: 'Not a controller in this setup. Adds games.', link: link(1), locked: blocked, ok: true,
                        state: m === 'idrive' || m === 'phone' ? 'CPU in Pong' : ''},
            ];
            const rows = [
                {name: 'Wi-Fi port', state: net.ready ? 'ok' : net.known ? 'wait' : 'bad',
                    value: net.ready ? 'Open (mgu-game-net)' : net.known ? (net.error || 'Opening...') : 'mgu-game-net not installed'},
                {name: 'Phone server', state: listening ? 'ok' : server.error ? 'bad' : 'wait',
                    value: listening ? server.address + ':' + server.port : server.error || 'Starting'},
                {name: 'iDrive', state: !useIDrive() ? 'off' : idrive.live() ? 'ok' : 'wait',
                    value: !useIDrive() ? 'Not used in this setup' : idrive.live() ? 'Knob events received' : 'No knob events yet'},
                {name: 'Vehicle', state: parked() ? 'ok' : lock() === 'moving' ? 'bad' : 'wait',
                    value: parked() ? 'Parked, games allowed' : lockHint()},
                {name: 'Game', state: session ? 'ok' : 'off', value: session ? session.title + (session.paused ? ' (paused)' : '') : 'None running'},
            ];
            return {mode: m, slots, rows, ready, blocked};
        }
        function viewModel() {
            if (notice && Date.now() > notice.until) notice = null;
            if (armed && Date.now() - armed.at > 5000) armed = null;
            if (Date.now() - countsAt > 10000) refreshCounts();
            const last = library.last();
            const m = {page, allowed: parked(), lock: lock(), lockHint: lockHint(), notice,
                platform, deleting, armed: armed && armed.key,
                running: session ? {kind: session.kind, name: session.name} : null,
                last: last && !(session && session.kind === last.kind && session.name === last.name) ? last : null,
                platforms: PLATFORMS.map(p => Object.assign({count: counts[p.id] || 0}, p)),
                game: null};
            if (session) {
                const f = session.frame, spec = PLATFORMS.find(p => p.id === session.kind) || PLATFORMS[3];
                m.game = {title: session.title, platform: spec.title.toUpperCase(), paused: session.paused,
                    reason: session.reason, detail: session.detail || '', focus: inFront(), arcade: session.arcade,
                    width: f ? f.width : 0, height: f ? f.height : 0, players: players(), help: help(),
                    saved: !!session.hasSave,
                    fps: running ? fps : undefined};
            }
            if (page === PAGE.GAMES) m.list = listOf();
            if (page === PAGE.PADS) m.pads = pads();
            return m;
        }

        ctx.loop('MAIN', 30, () => {
            const now = Date.now();
            server.poll();
            syncIDriveCapture();
            const go = mayRun();
            if (session) {
                if (running && !go) session.save();          // the car moved, the screen went away
                running = go && !session.paused;
                if (session.arcade) session.game.cpuPlayer2 = singlePlayer();
                const ran = session.step(padsForMode(mode(), idrive.buttons(), server.pads()), go);
                fpsFrames += ran;
                const pic = session.take();
                if (pic) setImage(IMAGE, pic.width, pic.height, pic.pixels);
            } else running = false;
            if (now - fpsAt >= 1000) { fps = Math.round(fpsFrames * 1000 / (now - fpsAt)); fpsFrames = 0; fpsAt = now; }
            if (now - lastBroadcast >= 1000) { lastBroadcast = now; server.broadcast(phoneState()); }
            const cv = ui.draw(ctx.canvas(W, H), ctx.theme(), viewModel(), actions);
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
