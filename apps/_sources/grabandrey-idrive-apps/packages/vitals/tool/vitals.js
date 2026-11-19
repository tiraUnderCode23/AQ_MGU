'use strict';
/*
 * Vitals: an iDrive 8-style cluster widget with water, engine oil and gearbox oil temperature
 * bars and the four tyres' temperatures and pressures, for BMW iDrive 8 (MGU). A root tool installed
 * by MGU Store; it draws through cluster-render on an iDrive 8 widget target.
 *
 * What draws what:
 *   shader.js   every shape (bars, divider, tyres), from layout.js
 *   text.js     the numbers and labels into two r8 textures, with the glyphs in font.js
 *   view.js     settings + car data -> the shader's uniforms and the text
 *
 * Car data comes from the Vitals app (packages/vitals/app), which reads CDS, BasicDataSet and TPMS
 * through BMW's own SDK and sends them here. This service runs as root and has no SDK.
 *
 * Control socket /run/ida-vitals-cluster/ctl.sock, JSON lines, one reply per request:
 *   -> {"op":"get"}                                 <- {"ok":true,"settings":{...},"status":{...}}
 *   -> {"op":"set","settings":{"accent":"white"}}   (only the keys in EDITABLE; every value checked)
 *   -> {"op":"reset"}
 *   -> {"op":"data","data":{"coolant":91,"oil":104,"gearbox":80,"tyreT":{...},"tyreP":{...},"carTemp":"C","carPress":"BAR"}}
 *
 * Node 8 compatible (the head unit's /usr/bin/node).
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const L = require('./layout.js');
const view = require('./view.js');
const shader = require('./shader.js');
const FONT = require('./font.js');
const { TextCanvas } = require('./text.js');

const VERSION = '1.3.2';
const CLIENT = process.env.CLUSTER_RENDER_CLIENT || '/var/opt/cluster-render/current/cluster_render_client.js';
const DATA_DIR = process.env.VITALS_DATA || '/var/opt/ida-vitals-cluster';
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CTL = process.env.VITALS_CTL || '/run/ida-vitals-cluster/ctl.sock';
const TICK_MS = 250;

/* the widget's place in the 2240x896 widget canvas. iDrive 8's safe rects are layout 4, 630x570@805,125,
 * and layout 5, 612x527@814,170 (cluster-render README); placed at layout 5's top, everything drawn
 * (y 20..510 of the layer) is inside both, and on cars that clip to layout 5 the top is no longer cut off.
 * shiftY (the app's "Widget position") moves it from there, px, positive = lower; zoom ("Widget size", %)
 * scales it about its top centre, so it grows downwards. */
const DEFAULTS = {
    tempUnit: 'auto',      // auto (the car's), C, F
    pressUnit: 'auto',     // auto (the car's), bar, psi, kPa
    coolantWarn: 115,      // C
    oilWarn: 135,          // C
    gearboxWarn: 120,      // C
    accent: 'blue',        // blue, lightblue, white
    pressures: true,
    demo: false,
    target: 'vitals',
    fallbackTarget: 'widget',
    shiftY: 0,
    zoom: 100,
    x: 805, y: 170,
};
const EDITABLE = ['tempUnit', 'pressUnit', 'coolantWarn', 'oilWarn', 'gearboxWarn', 'accent', 'pressures', 'demo', 'shiftY', 'zoom'];
const CHOICES = {
    tempUnit: ['auto', 'C', 'F'],
    pressUnit: ['auto', 'bar', 'psi', 'kPa'],
    accent: ['blue', 'lightblue', 'white'],
};
const RANGES = { coolantWarn: [95, 130], oilWarn: [110, 150], gearboxWarn: [100, 140], shiftY: [-100, 200], zoom: [70, 150] };

function log(msg) { process.stdout.write(new Date().toISOString() + ' vitals: ' + msg + '\n'); }

/* every value checked: anything wrong falls back to its default */
function normalize(raw) {
    const out = Object.assign({}, DEFAULTS, raw || {});
    Object.keys(CHOICES).forEach((k) => { if (CHOICES[k].indexOf(out[k]) < 0) out[k] = DEFAULTS[k]; });
    Object.keys(RANGES).forEach((k) => {
        const v = out[k], r = RANGES[k];
        out[k] = typeof v === 'number' && isFinite(v) && v >= r[0] && v <= r[1] ? Math.round(v) : DEFAULTS[k];
    });
    ['pressures', 'demo'].forEach((k) => { out[k] = typeof out[k] === 'boolean' ? out[k] : DEFAULTS[k]; });
    ['x', 'y'].forEach((k) => { const v = out[k]; out[k] = typeof v === 'number' && v >= 0 && v <= 2240 ? Math.round(v) : DEFAULTS[k]; });
    ['target', 'fallbackTarget'].forEach((k) => { if (typeof out[k] !== 'string' || !/^[a-z0-9]+$/.test(out[k])) out[k] = DEFAULTS[k]; });
    return out;
}

/* car data from the app: numbers in range or null; the rest dropped */
function cleanData(d, now) {
    const t = (v, lo, hi) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : null);
    const four = (o, lo, hi) => {
        const r = {};
        ['FL', 'FR', 'RL', 'RR'].forEach((k) => { r[k] = o && typeof o === 'object' ? t(o[k], lo, hi) : null; });
        return r;
    };
    const out = {};
    if ('coolant' in d || 'oil' in d) { out.coolant = t(d.coolant, -40, 200); out.oil = t(d.oil, -40, 200); out.engineAt = now; }
    if ('gearbox' in d) { out.gearbox = t(d.gearbox, -40, 200); out.gearboxAt = now; }
    if ('tyreT' in d) { out.tyreT = four(d.tyreT, -40, 200); out.tyresAt = now; }
    if ('tyreP' in d) { out.tyreP = four(d.tyreP, 0, 10); out.tyresAt = now; }
    if (d.carTemp === 'C' || d.carTemp === 'F') out.carTemp = d.carTemp;
    if (['BAR', 'KPA', 'PSI'].indexOf(d.carPress) >= 0) out.carPress = d.carPress;
    return out;
}

function readRaw() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) {
        if (e.code !== 'ENOENT') log('settings.json unreadable, using defaults: ' + e.message);
        return {};
    }
}
function loadSettings() { return normalize(readRaw()); }
function saveSettings(s) {
    const raw = readRaw(), keep = {};
    Object.keys(raw).forEach((k) => { if (EDITABLE.indexOf(k) < 0) keep[k] = raw[k]; });
    EDITABLE.forEach((k) => { keep[k] = s[k]; });
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    const tmp = SETTINGS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(keep, null, 2) + '\n');
    fs.renameSync(tmp, SETTINGS_FILE);
}

function startControl(api) {
    const isPipe = /^\\\\/.test(CTL);
    if (!isPipe) { try { fs.unlinkSync(CTL); } catch (e) { /* none yet */ } }
    const srv = net.createServer((sock) => {
        let buf = '';
        sock.setEncoding('utf8');
        sock.on('error', () => { /* the app went */ });
        sock.on('data', (d) => {
            buf += d;
            if (buf.length > 65536) { sock.destroy(); return; }
            for (let n; (n = buf.indexOf('\n')) >= 0; buf = buf.slice(n + 1)) {
                let reply;
                try { reply = api(JSON.parse(buf.slice(0, n))); } catch (e) { reply = { ok: false, error: 'bad request: ' + e.message }; }
                sock.write(JSON.stringify(reply) + '\n');
            }
        });
    });
    srv.on('error', (e) => log('control socket: ' + e.message));
    srv.listen(CTL, () => {
        if (!isPipe) { try { fs.chmodSync(CTL, 0o666); } catch (e) { log('control socket chmod: ' + e.message); } }
        log('control socket ' + CTL);
    });
    return srv;
}

function main() {
    try { if (!fs.existsSync(SETTINGS_FILE)) saveSettings(normalize({})); } catch (e) { log('could not write default settings: ' + e.message); }
    let S = loadSettings();
    let car = {};
    const status = { version: VERSION, renderer: 'connecting', target: S.target, layer: 'none', engine: false, gearbox: false, tyres: false };

    let ClusterRender;
    try { ClusterRender = require(CLIENT).ClusterRender; } catch (e) {
        log('cluster-render client not found at ' + CLIENT + ' (' + e.message + '); retrying in 30 s');
        status.renderer = 'not installed';
        setTimeout(main, 30000);
        return;
    }

    const FS = shader.build();
    const cr = new ClusterRender('ida-vitals-cluster', process.env.CLUSTER_RENDER_SOCKET);
    let target = S.target, triedFallback = false;
    let layer = 0, tex = {}, canvases = {}, lastUni = {};

    function build() {
        canvases = { V: new TextCanvas(L.W, L.H, FONT), L: new TextCanvas(L.W, L.H, FONT) };
        tex = {};
        ['V', 'L'].forEach((k) => {
            tex[k] = cr.asset({ target: target, format: 'r8', w: L.W, h: L.H, sampling: 'bilinear', wrap: 'clamp' });
        });
        layer = cr.effect({ target: target, klass: 'content', x: S.x, y: S.y + S.shiftY, w: L.W, h: L.H, fs: FS, visible: 1,
            sx: S.zoom / 100, sy: S.zoom / 100, px: L.W / 2, py: 0 });
        status.target = target;
        if (!layer || !tex.V || !tex.L) { log('layer or texture rejected by the client'); status.layer = 'rejected'; return; }
        cr.bind(layer, 'u_texV', tex.V);
        cr.bind(layer, 'u_texL', tex.L);
        lastUni = {};
        log('layer ' + layer + ' on target ' + target);
        render(true);
    }
    function teardown() {
        if (layer) cr.drop(layer);
        ['V', 'L'].forEach((k) => { if (tex[k]) cr.drop(tex[k]); });
        layer = 0; tex = {};
    }
    function fallback(why) {
        if (triedFallback || target === S.fallbackTarget) return;
        triedFallback = true;
        log('target ' + target + ' unusable (' + why + '); falling back to ' + S.fallbackTarget);
        teardown();
        target = S.fallbackTarget;
        build();
    }

    function render(whole) {
        if (!layer) return;
        const v = view.compose(S, car, Date.now());
        status.engine = v.engineOk; status.gearbox = v.gearboxOk; status.tyres = v.tyresOk;
        Object.keys(v.uniforms).forEach((n) => {
            const vals = v.uniforms[n], key = vals.map((x) => x.toFixed(4)).join(' ');
            if (lastUni[n] === key) return;
            lastUni[n] = key;
            cr.uniform(layer, n, vals);
        });
        ['V', 'L'].forEach((k) => {
            const tc = canvases[k];
            const rects = tc.apply(v.fields.filter((f) => f.tex === k));
            if (whole) cr.pixels(tex[k], null, Buffer.from(tc.px.buffer, tc.px.byteOffset, tc.px.length));
            else if (rects.length) {
                const packed = tc.pack(rects);
                cr.pixels(tex[k], rects, Buffer.from(packed.buffer, packed.byteOffset, packed.length));
            }
        });
    }

    function apply(next, why) {
        const moved = next.x !== S.x || next.y + next.shiftY !== S.y + S.shiftY || next.zoom !== S.zoom;
        S = next;
        log('settings ' + why + ': ' + EDITABLE.map((k) => k + '=' + S[k]).join(' '));
        if (moved && layer) cr.set(layer, { x: S.x, y: S.y + S.shiftY, sx: S.zoom / 100, sy: S.zoom / 100, px: L.W / 2, py: 0 });
        render(false);
    }

    fs.watchFile(SETTINGS_FILE, { interval: 2000 }, () => {
        const next = loadSettings();
        if (EDITABLE.concat(['x', 'y']).some((k) => next[k] !== S[k])) apply(next, 'reloaded');
    });

    cr.on('ready', () => {
        status.renderer = 'connected';
        log('connected, backend ' + cr.backend + ', targets ' + JSON.stringify(cr.targets));
        if (cr.backend && cr.backend !== 'id8') log('warning: built for iDrive 8, this head unit is ' + cr.backend);
        if (Array.isArray(cr.targets) && cr.targets.indexOf(target) < 0) fallback('not offered by this renderer yet (restart the head unit once)');
    });
    cr.on('disconnected', () => { status.renderer = 'reconnecting'; log('renderer went away; the client reconnects'); });
    cr.on('layer', (ref, state, reason) => {
        if (ref !== layer) return;
        status.layer = state;
        log('layer ' + state + (reason ? ' (' + reason + ')' : ''));
        if (state === 'error') fallback(reason || 'error');
    });
    cr.on('target', (name, state, holder, reason) => {
        log('target ' + name + ' ' + state + (reason ? ' (' + reason + ')' : ''));
        if (name === target && state === 'unavailable') fallback(reason || 'unavailable');
    });
    cr.on('refused', (op, ref, reason) => {
        log('refused ' + op + ' ' + ref + ': ' + reason);
        if ((ref === layer || ref === tex.V || ref === tex.L) && (op === 'layer' || op === 'effect' || op === 'asset')) fallback(reason);
    });
    cr.connect();
    build();

    startControl((req) => {
        if (req.op === 'data') {
            if (!req.data || typeof req.data !== 'object') return { ok: false, error: 'no data' };
            Object.assign(car, cleanData(req.data, Date.now()));
            render(false);
            return { ok: true };
        }
        if (req.op === 'set' || req.op === 'reset') {
            let next;
            if (req.op === 'reset') {
                const d = Object.assign({}, S);
                EDITABLE.forEach((k) => { d[k] = DEFAULTS[k]; });
                next = normalize(d);
            } else {
                const ask = req.settings || {}, merged = Object.assign({}, S);
                EDITABLE.forEach((k) => { if (Object.prototype.hasOwnProperty.call(ask, k)) merged[k] = ask[k]; });
                next = normalize(merged);
            }
            try { saveSettings(next); } catch (e) { return { ok: false, error: 'could not save: ' + e.message }; }
            apply(next, req.op === 'reset' ? 'reset by the app' : 'set by the app');
        } else if (req.op !== 'get') return { ok: false, error: 'unknown op' };
        const out = {};
        EDITABLE.forEach((k) => { out[k] = S[k]; });
        return { ok: true, settings: out, status: status, choices: CHOICES, ranges: RANGES };
    });

    /* the demo moves, and data goes stale: look again a few times a second */
    setInterval(() => render(false), TICK_MS);
    process.on('SIGTERM', () => { try { cr.close(); } catch (e) { /* exiting */ } process.exit(0); });
}

if (require.main === module) main();
module.exports = { main, normalize, cleanData, DEFAULTS, EDITABLE, CHOICES, RANGES };
