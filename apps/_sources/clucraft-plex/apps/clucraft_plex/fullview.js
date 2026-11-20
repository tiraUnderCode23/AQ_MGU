'use strict';
/**
 * fullview.js - the player over the whole centre screen. The kit draws the app's page inside the HMI's box, under
 * the HMI's title bar and beside its left strip (the back arrow); the picture belongs over all of it. This is a
 * second connection to mgu-render (kit/renderd.js, mgu-render/1), a layer of its own placed over the full
 * 1920 x 720 output, on which the app records the player at its page's width (W, 1600: logical px scaled by
 * 1920 / W) so the same drawing serves both.
 * (amn_iptv's lib/fullview.js, M850i-amn/idrive7-apps, MIT: see NOTICE. Changed in one place, marked: the
 * controller's turns, press and pushes are told apart for the player's controls.)
 *
 * Touch on it is claimed and comes back in logical px: the app's targets (the rects its buttons drew, in order: the
 * first one under the finger takes a tap, as the kit does) and its drag regions. The controller is grabbed while it
 * shows; a press or a push of the knob shows the controls. HOME leaves the app: the page is no longer shown and
 * neither is this.
 *
 *   const fv = createFullView({ RenderClient, Recorder, appId, log, W, off });
 *   off: no second connection (the kit's emulator keeps one connection per app: the two would close each other)
 *   fv.update(want)           each frame and each second: true while the player should be over the whole screen
 *   fv.draw(fn)               fn(rec, H) records a frame; returns the targets the frame drew
 *   fv.shown()                true while the layer is up
 *   fv.video(id, file)        names the player's frame file on this connection (once it exists)
 *   o.onTouch(phase, x, y)    raw touch (true: the gesture is taken, a drag), else a tap goes to the targets
 *   o.onCcu({ turn, press, tilt })   the controller: turned by `turn` clicks, pressed, or pushed 'N' 'E' 'S' 'W'
 *   fv.touch(phase, x, y)     a touch in this view's logical px that came on another connection (the page's)
 *
 * Node 8.
 */
const SCREEN_W = 1920, SCREEN_H = 720;
const KEEPALIVE_MS = 800;   // mgu-render hides a layer that sends nothing for 3 s
// FrontCCU.frontRotaryEncoderDeflection, as kit/runtime/display.js reads it
const TILT = { 1: 'N', 2: 'N', 4: 'E', 5: 'E', 7: 'S', 8: 'S', 10: 'W', 11: 'W' };

function createFullView(o) {
    const log = o.log;
    const scale = SCREEN_W / o.W, H = Math.round(SCREEN_H / scale);
    if (o.off) return { H, scale, touch() {}, update() {}, shown: () => false, video() {}, draw: () => [] };
    const gpu = new o.RenderClient(o.appId, log, { native: true });
    const rec = new o.Recorder(o.W, H, { textScale: scale });
    let ready = false, want = false, shown = false, targets = [], lastFrame = 0, down = null, lastCcu = null;

    gpu.on('ready', () => {
        ready = !!(gpu.native && gpu.info && gpu.info.video);
        if (!ready) { log.warn('fullview: the renderer does not show video here'); return; }
        gpu.place({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H, scale, ox: 0, oy: 0 });
        gpu.claimed = null;   // a new connection holds no claim yet (renderd.js skips one it thinks it sent)
        if (shown) { gpu.claim([{ x: 0, y: 0, w: o.W, h: H }]); gpu.show(true); gpu.grab(true); }
    });
    gpu.on('close', () => { ready = false; });
    // touched outside the claim (it covers the screen, so: the renderer took the layer away)
    gpu.on('closed', () => { if (shown) log.info('fullview: hidden by the renderer'); shown = false; gpu.grab(false); });
    function touch(phase, x, y) {
        if (!shown) return;
        let took = false;
        try { took = o.onTouch && o.onTouch(phase, x, y) === true; } catch (e) { log.warn('fullview touch: ' + e.message); }
        if (took) { down = null; return; }
        const inside = (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
        if (phase === 1) down = targets.find(inside) || null;
        else if (phase === 3) {
            const t = down; down = null;
            if (t && inside(t)) { try { t.run(); } catch (e) { log.warn('fullview tap ' + t.key + ': ' + e.message); } }
        }
    }
    gpu.on('touch', touch);
    // (clucraft_plex: what the controller did is told, as the kit's display reads it: turned by d clicks, pressed, pushed)
    gpu.on('ccu', (c) => {
        const k = Number(c.frontRotaryEncoderOperation), pb = Number(c.frontRotaryEncoderPushButton), df = Number(c.frontRotaryEncoderDeflection);
        const L = lastCcu;
        lastCcu = { k, pb, df };
        if (!L || (pb === 15 && df === 15) || !o.onCcu) return;   // the first one only says where the knob stands
        let d = ((k - L.k + 32768) & 0xffff) - 32768;
        if (!isFinite(d) || Math.abs(d) > 64) d = 0;               // a counter reset
        const down = (x) => x === 1 || x === 2;
        const press = down(pb) && !down(L.pb);
        const tilt = TILT[df] && TILT[L.df] !== TILT[df] ? TILT[df] : null;
        if (d || press || tilt) o.onCcu({ turn: d, press, tilt });
    });
    gpu.connect();

    function apply(on) {
        if (on === shown) return;
        shown = on;
        log.info('fullview: ' + (on ? 'shown' : 'hidden'));
        if (!ready) return;
        if (on) { gpu.claim([{ x: 0, y: 0, w: o.W, h: H }]); gpu.show(true); gpu.grab(true); lastCcu = null; }
        else { gpu.grab(false); gpu.claim([]); gpu.show(false); down = null; }
    }
    return {
        H, scale,
        // a touch the page's connection got (mgu-render gives a gesture to the first connection whose claim holds it,
        // and the kit's page claims its box): in this view's logical px
        touch,
        update(w) { want = !!w; apply(want && ready); },
        shown: () => shown,
        // the player's frame file, named on this connection too (renderd.js names it again after a reconnect)
        video(id, file) { return gpu.video(id, file); },
        draw(fn) {
            if (!shown) return [];
            const now = Date.now();
            if (gpu.waiting && now - lastFrame < KEEPALIVE_MS) return targets;
            rec.reset();
            rec.fv = [];
            fn(rec, H);
            targets = rec.fv;
            gpu.frame(rec);
            lastFrame = now;
            return targets;
        },
    };
}

module.exports = { createFullView };
