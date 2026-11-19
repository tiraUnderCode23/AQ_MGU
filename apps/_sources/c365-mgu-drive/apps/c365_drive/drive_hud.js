'use strict';
/**
 * The style chosen on the centre screen, drawn on the windshield.
 * Cluster renderer (robertnisipeanu/idrive-apps, ID7 and ID8) owns the glass.
 * This file only sends it one transparent picture. Dark pixels stay see-through.
 */
const { Canvas } = require('./kit/canvas');
const { HudClaim } = require('./kit/hud_claim');
let ClusterRender = null;
try { ClusterRender = require('./cluster_render_client').ClusterRender; } catch (e) { /* client missing */ }

function sceneOf(targets) {
    const m = /(?:^|,)\s*hud:(\d+)x(\d+)/.exec(String(targets || ''));
    if (!m) return { w: 800, h: 480, box: { x: 140, y: 96, w: 480, h: 168 } };
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w <= 420) return { w: w, h: h, box: { x: 6, y: 4, w: Math.max(40, w - 12), h: Math.max(40, h - 8) } };
    return { w: w, h: h, box: { x: 140, y: 96, w: 480, h: 168 } };
}

function startHud(log, draw) {
    const state = { live: false, note: 'Glass: install Cluster renderer' };
    if (!ClusterRender) return { hold() {}, update() {}, status: () => state.note };

    let cr = null;
    let layer = 0;
    let scene = sceneOf('');
    let claim = null;
    let last = '';
    let paused = false;
    try { claim = new HudClaim('c365_drive', log); } catch (e) { /* claim file unavailable */ }

    function paint(style, snap) {
        if (!layer || !cr) return;
        const cv = new Canvas(scene.w, scene.h);
        const b = scene.box;
        draw(cv, {
            nx: b.x,
            ny: b.y,
            nw: b.w,
            nh: b.h,
        }, style, snap, true);
        cr.pixels(layer, null, Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length));
    }

    function arm() {
        scene = sceneOf(cr.targets);
        layer = cr.image({
            target: 'hud',
            klass: 'overlay',
            z: 0,
            x: 0,
            y: 0,
            w: scene.w,
            h: scene.h,
            fps: 10,
            sampling: 'bilinear',
        });
        if (!layer) {
            state.live = false;
            state.note = 'Glass: HUD layer refused';
            return;
        }
        state.live = true;
        state.note = 'Glass: on the projection';
        if (claim) claim.hold(true);
        last = '';
        if (log) log.info('hud: ' + scene.w + 'x' + scene.h);
    }

    try {
        cr = new ClusterRender('c365_drive');
        cr.on('ready', () => {
            try { arm(); } catch (e) { if (log) log.warn('hud: ' + e.message); }
        });
        cr.on('disconnected', () => {
            layer = 0;
            state.live = false;
            state.note = 'Glass: Cluster renderer stopped';
            if (claim) claim.hold(false);
        });
        cr.connect();
    } catch (e) {
        state.note = 'Glass: ' + e.message;
        if (log) log.warn('hud: ' + e.message);
    }

    return {
        hold(on) {
            paused = !on;
            if (on) {
                if (cr && cr.ready && !layer) {
                    try { arm(); } catch (e) { if (log) log.warn('hud: ' + e.message); }
                }
                return;
            }
            if (layer && cr) {
                try { cr.drop(layer); } catch (e) { /* renderer already gone */ }
            }
            layer = 0;
            last = '';
            state.live = false;
            state.note = 'Glass: paused';
            if (claim) claim.hold(false);
        },
        update(style, snap) {
            if (paused || !layer) return;
            const beat = style.ask >= 3 ? Math.floor(Date.now() / 160) : 0;
            const key = [style.ask || 0, beat, style.id, style.accent, style.text, style.red, style.font, style.size, style.height,
                style.redline, style.blink ? 1 : 0, style.cam || '', snap.speed, snap.gear, snap.rpm].join('|');
            if (key === last) return;
            last = key;
            try { paint(style, snap); } catch (e) { if (log) log.warn('hud paint: ' + e.message); }
        },
        status() { return state.note; },
    };
}

function sizeOf(targets, name) {
    const m = new RegExp('(?:^|,)\\s*' + name + ':(\\d+)x(\\d+)').exec(String(targets || ''));
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/* iDrive 8 has no panel. The cluster middle (where the map sits) is popup,
 * and the side gauges stay the car's. iDrive 7 still has the whole panel. */
function sceneOfCluster(targets) {
    const list = String(targets || '');
    if (sizeOf(list, 'popup') || sizeOf(list, 'widget')) {
        const scene = sizeOf(list, 'popup') || sizeOf(list, 'widget');
        const iw = 960;
        const ih = 450;
        return {
            target: sizeOf(list, 'popup') ? 'popup' : 'widget',
            klass: 'content',
            x: 400,
            y: 140,
            w: Math.min(1320, scene.w - 400),
            h: Math.min(620, scene.h - 140),
            iw: iw,
            ih: ih,
            note: 'Cluster: middle of the dials',
        };
    }
    const scene = sizeOf(list, 'panel') || { w: 1920, h: 720 };
    return {
        target: 'panel',
        klass: 'overlay',
        x: 0,
        y: 0,
        w: scene.w,
        h: scene.h,
        iw: Math.max(320, Math.min(960, scene.w)),
        ih: Math.max(120, Math.min(360, scene.h)),
        note: 'Cluster: on the dials',
    };
}

function startCluster(log, draw) {
    const state = { live: false, note: 'Cluster: install Cluster renderer' };
    if (!ClusterRender) return { hold() {}, update() {}, status: () => state.note };

    let cr = null;
    let layer = 0;
    let scene = sceneOfCluster('');
    let shown = false;
    let last = '';
    let paused = false;

    function paint(id, look, snap) {
        if (!layer || !cr) return;
        const cv = new Canvas(scene.iw, scene.ih);
        draw(cv, { nx: 0, ny: 0, nw: scene.iw, nh: scene.ih }, id, snap, look);
        cr.pixels(layer, null, Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length));
    }

    function arm(id) {
        if (!cr || !cr.ready) return;
        if (!layer) {
            scene = sceneOfCluster(cr.targets);
            if (!sizeOf(cr.targets, scene.target)) {
                state.live = false;
                state.note = 'Cluster: dials refused';
                return;
            }
            layer = cr.image({
                target: scene.target,
                klass: scene.klass,
                z: 0,
                x: scene.x,
                y: scene.y,
                w: scene.w,
                h: scene.h,
                iw: scene.iw,
                ih: scene.ih,
                fps: 8,
                sampling: 'bilinear',
            });
        }
        if (!layer) {
            state.live = false;
            state.note = 'Cluster: dials refused';
            return;
        }
        const on = id && id !== 'off';
        if (on !== shown) {
            cr.set(layer, { visible: on });
            shown = on;
        }
        state.live = on;
        state.note = on ? scene.note : 'Cluster: stock dials';
    }

    try {
        cr = new ClusterRender('c365_drive_cluster');
        cr.on('ready', () => {
            shown = false;
            last = '';
        });
        cr.on('disconnected', () => {
            layer = 0;
            shown = false;
            state.live = false;
            state.note = 'Cluster: Cluster renderer stopped';
        });
        cr.connect();
    } catch (e) {
        state.note = 'Cluster: ' + e.message;
        if (log) log.warn('cluster: ' + e.message);
    }

    return {
        hold(on) {
            paused = !on;
            if (on) return;
            if (layer && cr) {
                try { cr.drop(layer); } catch (e) { /* renderer already gone */ }
            }
            layer = 0;
            shown = false;
            last = '';
            state.live = false;
            state.note = 'Cluster: paused';
        },
        update(id, look, snap) {
            if (paused) return;
            const on = id && id !== 'off';
            if (!cr || !cr.ready) {
                state.note = on ? 'Cluster: install Cluster renderer' : 'Cluster: stock dials';
                return;
            }
            try { arm(id); } catch (e) { if (log) log.warn('cluster: ' + e.message); return; }
            if (!on || !layer) return;
            const rpmStep = Math.round((snap.rpmN || 0) / 50);
            const frame = Math.floor(Date.now() / 140);
            const key = [id, look.ask || 0, look.shift || 0, scene.target, look.redline, look.blink ? 1 : 0, snap.speed, snap.gear, rpmStep, snap.unit, frame].join('|');
            if (key === last) return;
            last = key;
            try { paint(id, look, snap); } catch (e) { if (log) log.warn('cluster paint: ' + e.message); }
        },
        status() { return state.note; },
    };
}

module.exports = { startHud, startCluster };
