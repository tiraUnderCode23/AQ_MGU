'use strict';
/**
 * stage.js - the Drivefin app's pages drawn on a PC, for tools/shots.js and the tests: the real store and ui (and
 * the kit's own recorder, fonts and software canvas), the real service against the mock Jellyfin server
 * (tools/mock-jellyfin.js) with the stand-in player (test/fake-player.js), and a stand-in for what main.js gets from
 * the head unit (the page's place on the 1920 x 720 screen, the drive gate, the car's speakers).
 *
 *   const st = await createStage({ linked, server, offline, filmSeconds, mock: {...} });
 *     linked    the mock approves a Quick Connect code at once (else st.mock.link() does)
 *     server    the service already knows the mock's address, so signing in starts at Quick Connect (the default);
 *               false: it starts at the page that asks for the address (st.address is what to type there)
 *     offline   the head unit has no internet (mgu-uplink's lease is missing)
 *   st.S, st.ui, st.mock, st.svc, st.car { parked, motion, consent, video, audio }
 *   st.frame()               draws the page as main.js does; returns { cv, targets, player }
 *   st.tap(key)              runs the target `key` of the last frame (throws when there is none)
 *   st.png()                 the last frame as a 1920 x 720 PNG (Buffer): the page where the kit puts it, under a
 *                            stand-in for the HMI's title strip and back column
 *   st.settle(ms)            lets the service answer (polls its status as main.js does) and the posters arrive
 *   st.close()
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'clucraft_jellyfin');
const KIT = path.join(ROOT, 'kit', 'runtime');
const record = require(path.join(KIT, 'record'));
const fonts = require(path.join(KIT, 'fonts'));
const { Canvas } = require(path.join(KIT, 'canvas'));
const FS = require(path.join(KIT, 'fullscreen'));
const { createMock } = require('./mock-jellyfin');
const { createService } = require(path.join(ROOT, 'native', 'clucraft-jellyfin', 'service'));
const { createStore } = require(path.join(APP, 'store'));
const { createUi } = require(path.join(APP, 'ui'));
const DG = require(path.join(APP, 'drivegate'));

const W = 1600, H = 520, VID = 7;
// the full-screen layout on the 1920 x 720 display, as kit/runtime/display.js places a page with no bar under it
const PLACE = { x: 0, y: 0, w: 1920, h: 720, full: true, scale: 1.165, ox: 70, oy: 51, extra: 49 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fontsDone = false;
function registerFonts() {
    if (fontsDone) return;
    fontsDone = true;
    ['cl_bold', 'cl_med'].forEach((n) => fonts.register(n, JSON.parse(fs.readFileSync(path.join(APP, 'data', 'fonts', n + '.json'), 'utf8'))));
}

async function createStage(opts) {
    const o = Object.assign({ linked: true, server: true, offline: false, filmSeconds: 0, speed: 20 }, opts || {});
    registerFonts();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drivefin-'));
    const mock = await createMock(Object.assign({ linked: o.linked, filmSeconds: o.filmSeconds }, o.mock || {}));
    // (the head unit "is online": the service reads mgu-uplink's lease for its status)
    if (!o.offline) fs.writeFileSync(path.join(tmp, 'lease.json'), JSON.stringify({ interface: 'stage', ip: '127.0.0.1', dns: [] }));
    fs.mkdirSync(path.join(tmp, 'state'));
    if (o.server) fs.writeFileSync(path.join(tmp, 'state', 'server.json'), JSON.stringify({ url: mock.url, id: null, name: 'Jupiter', version: (o.mock || {}).legacy ? '10.8.13' : '10.11.0', quick: (o.mock || {}).quick !== false }));
    const svc = createService(Object.assign({
        stateDir: path.join(tmp, 'state'), uid: null, exit: false, leasePath: path.join(tmp, 'lease.json'),
        childEnv: { JFD_SYSTEM_DNS: '1', JFD_RETRY_MS: '200', JFD_RETRY_FOR_MS: String(o.retryForMs || 3000) },
        playerBin: process.execPath, playerArgs: [path.join(ROOT, 'test', 'fake-player.js')], playerCwd: tmp, videoPath: path.join(tmp, 'video'),
        playerEnv: Object.assign({ FAKE_SPEED: String(o.speed) }, o.playerEnv || {}),
    }, o.service || {}));
    svc.start();

    const values = Object.assign({ motion: false, quality: '720', autoplay: true, wheel: true, gain: '6' }, o.settings || {});
    const settings = { get: (k) => values[k], set: (k, v) => { values[k] = v; } };
    const images = new Map();
    const S = createStore({ ask: (m) => svc.command(m), settings, setImage: (id, w, h, d) => { images.set(id, { w, h }); record.setImage(id, w, h, d); } });

    // the car, as the test says it is
    const gate = DG.createGate();
    const car = {
        parked: true, video: true, audio: { on: false, connected: true, taken: false, error: null },
        consent: DG.createConsent(path.join(tmp, 'passenger.json')),
        feed() { gate.speed({ speedVehicleCentreOfGravity: car.parked ? 0 : 64 * 62 }); gate.stage(car.parked ? 'P' : 'D'); },
    };
    const B = { font: 'cl_bold', literal: true }, M = { font: 'cl_med', literal: true };
    const btn = (cv, key, x, y, w, h, fn, r) => FS.button(cv, key, x, y, w, h, fn, { r: r != null ? r : 16, slop: 4 });
    const ui = createUi({ S, B, M, btn, env: {
        W, VID, version: 'test', videoReady: () => car.video,
        pictureAllowed: () => { car.feed(); return DG.pictureAllowed(gate, values.motion === true, car.consent); },
        parked: () => { car.feed(); return gate.parked(); }, parkedWhy: () => { car.feed(); return gate.why(); }, audio: () => car.audio,
    } });
    const consentHandlers = {
        accept() { car.feed(); if (!gate.parked()) { S.say('Park the car first (selector in P)'); return; } car.consent.accept(); S.page = 'home'; },
        decline() { car.consent.clear(); values.motion = false; S.page = 'home'; },
    };

    let last = null;
    function frame() {
        const cv = new record.Recorder(W, H, { textScale: PLACE.scale });
        cv.place = PLACE; cv.own = true; cv.extra = PLACE.extra; cv.chrome = null; cv.pictures = 'blend';
        // the software path draws no video: a stand-in where the film's picture would be, so a screenshot shows the
        // player's controls over something (and says what it is)
        cv.video = function (id, x, y, w, h) {
            this.gradientRect(x, y, w, h, [[0, '#0f2a52'], [0.55, '#3b2a63'], [1, '#7a3b4f']]);
            this.circle(x + w * 0.72, y + h * 0.42, h * 0.16, '#f3c98b');
            this.fillRect(x, y + h * 0.7, w, h * 0.3, '#141a2c');
            this.text('the film\'s picture (a stand-in: a PC draws no video)', x + w / 2, y + h * 0.56, 16, '#8f9bc0', { font: 'cl_med', literal: true, align: 'center' });
            return this;
        };
        const A = FS.area(cv), fullH = H + cv.extra;
        const player = S.page === 'player';
        if (player) ui.drawPlayer(cv, A, fullH); else ui.draw(cv, A, fullH, consentHandlers);
        last = { cv, targets: cv.targets.slice(), player, A, fullH };
        return last;
    }
    function tap(key) {
        const t = (last || frame()).targets.filter((x) => x.key === String(key))[0];
        if (!t) throw new Error('no target "' + key + '" on page ' + S.page + ' (there: ' + last.targets.map((x) => x.key).join(' ') + ')');
        return t.run();
    }
    /** the last frame on the 1920 x 720 screen */
    function png() {
        const f = last || frame();
        const page = new Canvas(Math.round(W * PLACE.scale), Math.round(f.fullH * PLACE.scale));
        page.clear('#000000');
        record.play(f.cv.words(), page, PLACE.scale);
        const out = new Canvas(1920, 720);
        out.clear('#000000');
        out.drawImage(page.d, page.w, page.h, PLACE.ox, PLACE.oy, page.w, page.h);
        // the HMI's own parts over it, as a reminder of what is not the app's: the title strip and the back column
        if (!f.player) {
            out.fillRect(0, 0, 1920, 80, '#000000');
            out.fillRect(0, 78, 1920, 2, [255, 255, 255, 56]);
            out.fillRect(0, 80, 84, 640, '#000000');
            const t = new record.Recorder(1920, 80, { textScale: 1 });
            t.text('Drivefin', 104, 54, 40, '#ffffff', B);
            t.line(52, 372, 36, 392, 4, '#ffffff'); t.line(36, 392, 52, 412, 4, '#ffffff');
            record.play(t.words(), out, 1);
        }
        return Buffer.from(out.png());
    }
    async function settle(ms) {
        const until = Date.now() + (ms || 400);
        while (Date.now() < until) { await S.poll(); frame(); await sleep(40); }
    }
    async function until(fn, ms, what) {
        const t0 = Date.now();
        for (;;) {
            await S.poll(); frame();
            const v = fn();
            if (v) return v;
            if (Date.now() - t0 > (ms || 8000)) throw new Error('timeout waiting for ' + what + ' (page ' + S.page + ', client ' + S.clientState() + ', playback ' + JSON.stringify(S.pb() && S.pb().state) + ')');
            await sleep(40);
        }
    }
    async function close() { svc.stop(0); await mock.close(); await sleep(120); }
    return { S, ui, mock, svc, car, values, settings, images, gate, tmp, frame, tap, png, settle, until, close, PLACE, address: '127.0.0.1:' + mock.port };
}

module.exports = { createStage, sleep, ROOT, APP, KIT, W, H, PLACE };
