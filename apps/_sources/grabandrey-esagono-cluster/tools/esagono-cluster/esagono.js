'use strict';
/*
 * Esagono cluster widget for BMW iDrive 8 (MGU), a root tool installed by MGU Store.
 *
 * Draws a supercar-style hexagon rev ring in the middle of the instrument cluster
 * through cluster-render (its `effect` layer on an iDrive 8 widget target). The whole
 * picture is one fragment shader (shader.js); this service only feeds it uniforms.
 *
 * Engine speed: read over SOME/IP from CDS 0xB513 event 0x8019 (statusEngineSpeed2,
 * u16 x 0.25 rpm) through an `hmictl serve` helper when one is installed on the head
 * unit (IterioDev's Overlays tool ships one). Esagono does not ship its own SOME/IP
 * client. Without one it shows 0 rpm, or a demo sweep when settings.demo is true.
 *
 * Settings: /var/opt/esagono-cluster/settings.json, changed by the Esagono Settings app
 * through the control socket /run/esagono-cluster/ctl.sock (JSON lines, below), or by
 * hand (reloaded within 2 s). Every value is checked here, whoever sends it.
 *
 *   -> {"op":"get"}                          <- {"ok":true,"settings":{...},"status":{...},"limits":{...}}
 *   -> {"op":"set","settings":{"mode":"track"}}   (only the keys in EDITABLE)
 *   -> {"op":"reset"}                        back to the defaults
 *
 * Node 8 compatible (the head unit's /usr/bin/node).
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { FS } = require('./shader');

const VERSION = '0.2.0';
const CLIENT = process.env.CLUSTER_RENDER_CLIENT || '/var/opt/cluster-render/current/cluster_render_client.js';
const DATA_DIR = process.env.ESAGONO_DATA || '/var/opt/esagono-cluster';
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CTL = process.env.ESAGONO_CTL || '/run/esagono-cluster/ctl.sock';
const HMICTL_CANDIDATES = [
    process.env.ESAGONO_HMICTL,
    '/var/opt/iteriodev-overlays/current/hmictl',
    '/var/opt/iteriodev-comfort/current/hmictl',
].filter(Boolean);

const RPM_SVC = 0xb513, RPM_EV = 0x8019;
const RPM_POLL = 'poll 0xb513 1 25 1 50 0x8019';
const STALE_MS = 3000;
const TICK_MS = 33;

const MODES = {
    comfort: { idx: 0, accent: [0.31, 0.85, 1.0] },
    sport:   { idx: 1, accent: [1.0, 0.77, 0.0] },
    track:   { idx: 2, accent: [1.0, 0.23, 0.12] },
};

/* the widget's safe rect on iDrive 8: the union of layout 4 (630x570@805,125) and
 * layout 5 (612x527@814,170), in the 2240x896 widget canvas (cluster-render README) */
const DEFAULTS = {
    mode: 'sport',
    rpmMax: 9000,
    redline: 7500,
    flashRpm: 7800,
    demo: false,
    backdrop: true,
    target: 'esagono',
    fallbackTarget: 'widget',
    x: 805, y: 125, w: 632, h: 572,
};
const EDITABLE = ['mode', 'rpmMax', 'redline', 'flashRpm', 'demo', 'backdrop'];
const LIMITS = { rpmMax: [4000, 10000], redline: [2000, 10000], flashRpm: [2000, 10000] };

function log(msg) { process.stdout.write(new Date().toISOString() + ' esagono: ' + msg + '\n'); }

/* every value checked and made consistent: rpmMax in whole thousands, redline and
 * flashRpm within the scale; anything wrong falls back to its default */
function normalize(raw) {
    const out = Object.assign({}, DEFAULTS, raw || {});
    if (!MODES[out.mode]) out.mode = DEFAULTS.mode;
    const n = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : d);
    out.rpmMax = Math.round(n(out.rpmMax, LIMITS.rpmMax[0], LIMITS.rpmMax[1], DEFAULTS.rpmMax) / 1000) * 1000;
    out.redline = Math.round(n(out.redline, LIMITS.redline[0], out.rpmMax, Math.min(DEFAULTS.redline, out.rpmMax)));
    out.flashRpm = Math.round(n(out.flashRpm, LIMITS.flashRpm[0], out.rpmMax, Math.min(out.redline + 300, out.rpmMax)));
    out.demo = out.demo === true;
    out.backdrop = out.backdrop !== false;
    ['x', 'y', 'w', 'h'].forEach((k) => { out[k] = Math.round(n(out[k], 0, 2240, DEFAULTS[k])); });
    if (typeof out.target !== 'string' || !/^[a-z0-9]+$/.test(out.target)) out.target = DEFAULTS.target;
    if (typeof out.fallbackTarget !== 'string' || !/^[a-z0-9]+$/.test(out.fallbackTarget)) out.fallbackTarget = DEFAULTS.fallbackTarget;
    return out;
}

function readRaw() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) {
        if (e.code !== 'ENOENT') log('settings.json unreadable, using defaults: ' + e.message);
        return {};
    }
}
function loadSettings() { return normalize(readRaw()); }

/* writes the editable keys (and keeps any hand-set layout keys), atomically */
function saveSettings(s) {
    const raw = readRaw();
    const keep = {};
    Object.keys(raw).forEach((k) => { if (EDITABLE.indexOf(k) < 0) keep[k] = raw[k]; });
    EDITABLE.forEach((k) => { keep[k] = s[k]; });
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    const tmp = SETTINGS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(keep, null, 2) + '\n');
    fs.renameSync(tmp, SETTINGS_FILE);
}

function writeDefaultSettings() {
    try { if (!fs.existsSync(SETTINGS_FILE)) saveSettings(normalize({})); } catch (e) { log('could not write default settings: ' + e.message); }
}

/* ---- engine speed source ---- */
function startRpmSource(onRpm) {
    const bin = HMICTL_CANDIDATES.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (e) { return false; } });
    if (!bin) { log('no hmictl found (' + HMICTL_CANDIDATES.join(', ') + '): no live rpm'); return null; }
    let child = null, buf = '';
    const start = () => {
        log('rpm source: ' + bin + ' serve');
        child = spawn(bin, ['serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
        child.on('error', (e) => log('hmictl: ' + e.message));
        child.stdin.on('error', (e) => log('hmictl stdin: ' + e.message));
        child.stdout.on('data', (d) => {
            buf += d;
            for (let n; (n = buf.indexOf('\n')) >= 0; buf = buf.slice(n + 1)) {
                const line = buf.slice(0, n).trim();
                if (line.indexOf('ev ') === 0) {
                    const w = line.split(/\s+/);
                    if (parseInt(w[1], 16) === RPM_SVC && parseInt(w[2], 16) === RPM_EV && w[3] && w[3].length >= 4) {
                        onRpm(parseInt(w[3].slice(0, 4), 16) * 0.25);
                    }
                } else if (/^error\b/.test(line)) log('hmictl: ' + line);
            }
        });
        child.on('exit', (c) => { log('hmictl exited ' + c + ', restarting in 5 s'); child = null; buf = ''; setTimeout(start, 5000); });
        child.stdin.write(RPM_POLL + '\n');
    };
    start();
    process.on('exit', () => { if (child) try { child.kill(); } catch (e) { /* exiting */ } });
    return bin;
}

/* ---- the control socket for the settings app ---- */
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

/* ---- the service ---- */
function main() {
    writeDefaultSettings();
    let S = loadSettings();
    const status = { version: VERSION, renderer: 'connecting', backend: '', target: S.target, layer: 'none', rpmSource: 'none', rpm: 0 };

    let ClusterRender;
    try { ClusterRender = require(CLIENT).ClusterRender; } catch (e) {
        log('cluster-render client not found at ' + CLIENT + ' (' + e.message + '); retrying in 30 s');
        status.renderer = 'not installed';
        setTimeout(main, 30000);
        return;
    }

    const cr = new ClusterRender('esagono-cluster', process.env.CLUSTER_RENDER_SOCKET);
    let layer = 0, target = S.target, triedFallback = false, last = {};

    function uni(name, values) {
        const key = values.map((v) => v.toFixed(3)).join(' ');
        if (last[name] === key || !layer) return;
        last[name] = key;
        cr.uniform(layer, name, values);
    }
    function pushStatic() {
        if (!layer) return;
        const M = MODES[S.mode];
        uni('u_size', [S.w, S.h]);
        uni('u_red', [S.redline / S.rpmMax]);
        uni('u_divs', [S.rpmMax / 1000]);
        uni('u_accent', M.accent);
        uni('u_mode', [M.idx]);
        uni('u_bg', [S.backdrop ? 1 : 0]);
    }
    function makeLayer() {
        layer = cr.effect({ target: target, klass: 'content', x: S.x, y: S.y, w: S.w, h: S.h, fs: FS, visible: 1 });
        status.target = target;
        if (!layer) { log('effect layer rejected by the client'); status.layer = 'rejected'; return; }
        log('layer ' + layer + ' on target ' + target);
        last = {};
        pushStatic();
    }
    function fallback(why) {
        if (triedFallback || target === S.fallbackTarget) return;
        triedFallback = true;
        log('target ' + target + ' unusable (' + why + '); falling back to ' + S.fallbackTarget);
        if (layer) cr.drop(layer);
        target = S.fallbackTarget;
        makeLayer();
    }
    function apply(next, why) {
        const geomChanged = ['x', 'y', 'w', 'h'].some((k) => next[k] !== S[k]);
        S = next;
        log('settings ' + why + ': ' + EDITABLE.map((k) => k + '=' + S[k]).join(' '));
        if (geomChanged && layer) cr.set(layer, { x: S.x, y: S.y, w: S.w, h: S.h });
        pushStatic();
    }

    fs.watchFile(SETTINGS_FILE, { interval: 2000 }, () => {
        const next = loadSettings();
        if (EDITABLE.concat(['x', 'y', 'w', 'h']).some((k) => next[k] !== S[k])) apply(next, 'reloaded');
    });

    cr.on('ready', () => {
        status.renderer = 'connected';
        status.backend = cr.backend || '';
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
        if (ref === layer && (op === 'layer' || op === 'effect')) fallback(reason);
    });
    cr.connect();
    makeLayer();

    /* rpm: live, demo or none */
    let rawRpm = 0, rawAt = 0, shown = 0;
    const src = startRpmSource((r) => { rawRpm = r; rawAt = Date.now(); });
    if (src) status.rpmSource = 'hmictl';
    const t0 = Date.now();

    startControl((req) => {
        if (req.op === 'set' || req.op === 'reset') {
            let next;
            if (req.op === 'reset') next = normalize(Object.assign({}, S, (() => { const d = {}; EDITABLE.forEach((k) => { d[k] = DEFAULTS[k]; }); return d; })()));
            else {
                const ask = req.settings || {};
                const merged = Object.assign({}, S);
                EDITABLE.forEach((k) => { if (Object.prototype.hasOwnProperty.call(ask, k)) merged[k] = ask[k]; });
                next = normalize(merged);
            }
            try { saveSettings(next); } catch (e) { return { ok: false, error: 'could not save: ' + e.message }; }
            apply(next, req.op === 'reset' ? 'reset by the app' : 'set by the app');
        } else if (req.op !== 'get') return { ok: false, error: 'unknown op' };
        const out = {};
        EDITABLE.forEach((k) => { out[k] = S[k]; });
        const live = Date.now() - rawAt < STALE_MS;
        status.rpm = Math.round(shown);
        status.rpmLive = live;
        return { ok: true, settings: out, status: status, limits: LIMITS };
    });

    setInterval(() => {
        const now = Date.now();
        let want;
        if (now - rawAt < STALE_MS) want = rawRpm;
        else if (S.demo) {
            const ph = ((now - t0) / 1000) % 7;
            want = ph < 5 ? 1000 + (S.rpmMax - 1200) * Math.pow(ph / 5, 1.4) : 1000 + (S.rpmMax - 1200) * (1 - (ph - 5) / 2);
        } else want = 0;
        shown += (want - shown) * 0.35;
        if (Math.abs(want - shown) < 5) shown = want;

        const flash = shown >= S.flashRpm && Math.floor(now / 80) % 2 === 0;
        const k = Math.max(0, Math.min(99, Math.round(shown / 100)));
        uni('u_rpm', [Math.max(0, Math.min(1, shown / S.rpmMax))]);
        uni('u_flash', [flash ? 1 : 0]);
        uni('u_num', [Math.floor(k / 10) % 10, k % 10, 1]);
    }, TICK_MS);

    process.on('SIGTERM', () => { try { cr.close(); } catch (e) { /* exiting */ } process.exit(0); });
}

if (require.main === module) main();
module.exports = { main, normalize, loadSettings, DEFAULTS, MODES, EDITABLE };
