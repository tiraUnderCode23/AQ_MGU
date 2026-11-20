'use strict';
/**
 * esd.js - the Engine Sound service (runs on the head unit's own Node 8, /usr/bin/node).
 *
 * It owns the synthesizer process and a control socket for the app. Each sound engine is its own synthesizer binary
 * beside this file, es-synth-<engine> (synth/<engine>/ in the repository: simulate, enhance, and the legacy waveguide, replica), all with the same
 * command line and control lines (synth/PROTOCOL.md); the app picks one with ENGINE <engine>.
 *
 *   /run/lfb-enginesound/ctl.sock   (0660, group tm_oap_app: the OAP apps' group)
 *
 * The app sends newline-terminated lines. Lines the service handles itself:
 *   ENGINE <engine>          the sound engine (es-synth-<engine>; the ids before 1.0, a / b / c / d, are mapped);
 *                            the synth restarts with it
 *   OUT <alsa device>|none   play into that ALSA device (the synth is started / restarted on it); none stops it
 *   TONE <alsa device>       routing test: 10 s of beeps into that device (the synth is paused meanwhile); what its
 *                            synth says is in STATUS as lastTone
 *   STATUS                   one JSON status line back (alsa: what the synth said about its device: format,
 *                            dropouts, the queue's range)
 *   SHM                      the SmartX endpoints found in /dev/shm, as JSON
 * Every other line (P / E / T / V / M / S / X, see synth/PROTOCOL.md) goes to the synth's stdin as it is. The last
 * E / T / V / M line and the last X line of every sound setting are replayed when the synth starts again, so a
 * restart keeps the preset, turbo, volume, mute state and the sound settings. Replies are single JSON lines
 * starting with '{'.
 *
 * Runs as nobody with the groups mgu_alsa (SmartX shared memory) and tm_oap_app (the socket), see the unit file.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const VERSION = '1.2.2';
const RUN_DIR = process.env.ES_RUN_DIR || '/run/lfb-enginesound';
const SOCK = path.join(RUN_DIR, 'ctl.sock');
const SYNTH_DIR = process.env.ES_SYNTH_DIR || __dirname;
/** The sound engines installed: es-synth-<engine> files beside this one. */
function engines() {
    try { return fs.readdirSync(SYNTH_DIR).map((f) => /^es-synth-([a-z0-9_]+)$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(); } catch (e) { return []; }
}
const DEFAULT_ENGINE = 'simulate';
// sound engine ids of earlier versions (an app not yet updated may still send them)
const LEGACY = { a: 'waveguide', b: 'replica', c: 'simulate', d: 'enhance', pulse: 'simulate', bass: 'enhance' };
/** The chosen engine's binary, else the default, else the first one there. */
function synthPath() {
    if (process.env.ES_SYNTH) return process.env.ES_SYNTH;
    const all = engines();
    const e = all.indexOf(state.engine) >= 0 ? state.engine : all.indexOf(DEFAULT_ENGINE) >= 0 ? DEFAULT_ENGINE : all[0];
    return path.join(SYNTH_DIR, 'es-synth-' + (e || 'missing'));
}
const SHM = process.env.ES_SHM || '/dev/shm';
const STICKY = ['E', 'T', 'V', 'M'];
/** The key a line is kept under for the replay: E / T / V / M, "X <name>" per sound setting; null: not kept. */
function stickyKey(line) {
    const w = line.split(/\s+/);
    if (w[0] === 'X') return /^[a-z0-9_]+$/.test(w[1] || '') ? 'X ' + w[1] : null;
    return STICKY.indexOf(w[0]) >= 0 ? w[0] : null;
}

const log = (m) => process.stderr.write(new Date().toISOString().slice(11, 19) + ' esd: ' + m + '\n');

/* ---------------- the synth process ---------------- */
const state = { engine: null, device: null, tone: null, lastTone: null, alsa: null, sticky: {}, recent: [], starts: 0, lastStart: 0, child: null, retryT: null };
const remember = (line) => { state.recent.push(line); if (state.recent.length > 30) state.recent.shift(); };
/** What the playing synth says about its device, kept for STATUS (the last lines scroll away): the format and
 *  buffer it opened ({ dev, format }), its dropouts ("3 (0 underruns, 3 times the queue was empty)") and how far
 *  its queue went down ("1024 to 1536 of 1536 frames"). */
function alsaSays(line) {
    let m = /^alsa: connected (\S+) \((.*)\)$/.exec(line);
    if (m) { state.alsa = { dev: m[1], format: m[2], dropouts: null, queue: null }; return; }
    if (!state.alsa) return;
    if ((m = /^alsa: dropouts (.*)$/.exec(line))) state.alsa.dropouts = m[1];
    else if ((m = /^alsa: queue (.*)$/.exec(line))) state.alsa.queue = m[1];
}

function startSynth() {
    if (state.child || !state.device || state.tone) return;
    const now = Date.now();
    // a synth that keeps dying: back off up to 10 s
    const wait = now - state.lastStart < 3000 ? Math.min(10000, 1000 * Math.pow(2, Math.min(state.starts, 4))) : 0;
    if (wait) {
        if (!state.retryT) state.retryT = setTimeout(() => { state.retryT = null; startSynth(); }, wait);
        return;
    }
    state.starts = now - state.lastStart < 3000 ? state.starts + 1 : 0;
    state.lastStart = now;
    const args = ['--out', 'alsa:' + state.device], bin = synthPath();
    log('start ' + path.basename(bin) + ' ' + args.join(' '));
    let child;
    try { child = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] }); } catch (e) { log('spawn: ' + e); return; }
    state.child = child;
    // (a spawn that fails, ENOENT / EACCES, gives 'error' and no 'exit')
    child.on('error', (e) => {
        log('synth: ' + e.message); remember('synth: ' + e.message);
        if (state.child === child) { state.child = null; startSynth(); }
    });
    child.stdin.on('error', () => {});
    let buf = '';
    child.stderr.on('data', (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l) { remember(l); alsaSays(l); log('synth: ' + l); } }
        if (buf.length > 4096) buf = '';
    });
    child.on('exit', (code, sig) => {
        log('synth exited ' + (sig || code));
        remember('exited ' + (sig || code));
        if (state.child === child) state.child = null;
        startSynth();
    });
    // the kept lines: E / T / V / M in this order, then the sound settings
    STICKY.concat(Object.keys(state.sticky).filter((k) => k.charAt(0) === 'X')).forEach((k) => { if (state.sticky[k]) toSynth(state.sticky[k]); });
}

function stopSynth(cb) {
    const child = state.child;
    if (!child) { if (cb) cb(); return; }
    state.child = null;
    let done = false;
    const fin = () => { if (!done) { done = true; if (cb) cb(); } };
    child.removeAllListeners('exit');
    child.on('exit', fin);
    try { child.stdin.write('Q\n'); } catch (e) { /* gone */ }
    setTimeout(() => { try { child.kill('SIGTERM'); } catch (e) {} }, 600);
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} fin(); }, 1500);
}

function toSynth(line) {
    if (!state.child) return;
    try { state.child.stdin.write(line + '\n'); } catch (e) { /* restarts on exit */ }
}

/** A restart we asked for is no crash: it starts at once (no back-off). */
function restartNow() {
    state.lastStart = 0; state.starts = 0;
    if (state.retryT) { clearTimeout(state.retryT); state.retryT = null; }
}

function setDevice(dev) {
    const d = dev && dev !== 'none' ? dev : null;
    if (d === state.device) return;
    state.device = d;
    restartNow();
    stopSynth(() => startSynth());
}

function setEngine(e) {
    if (Object.prototype.hasOwnProperty.call(LEGACY, e)) e = LEGACY[e];
    if (!/^[a-z0-9_]+$/.test(e) || e === state.engine) return;
    state.engine = e;
    log('engine ' + e + (engines().indexOf(e) < 0 ? ' (not installed: ' + path.basename(synthPath()) + ')' : ''));
    restartNow();
    if (state.child) stopSynth(() => startSynth());
    else startSynth();
}

function tone(dev) {
    if (state.tone) return;
    stopSynth(() => {
        log('tone ' + dev);
        state.lastTone = { dev, lines: [] };     // what this test's synth said (does the device take the sound?)
        const said = (l) => { remember('tone: ' + l); if (state.lastTone.lines.length < 12) state.lastTone.lines.push(l); };
        let child;
        try { child = spawn(synthPath(), ['--tone', 'alsa:' + dev], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { log('tone: ' + e); startSynth(); return; }
        state.tone = { dev, child };
        child.on('error', (e) => said(e.message));
        child.stderr.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(said));
        const end = () => { if (state.tone && state.tone.child === child) { state.tone = null; startSynth(); } };
        child.on('exit', end);
        setTimeout(() => { try { child.kill('SIGTERM'); } catch (e) {} }, 12000);
    });
}

/* ---------------- SmartX endpoints ---------------- */
// SmartX keeps two shared-memory files per ALSA endpoint, smartx_<endpoint>_<p|c>_connection and ..._ringbuffer
// (p: a playback endpoint, we write into it; c: a capture endpoint), e.g. smartx_CarLifeMedia_CF_48_STEREO_p_connection.
/** The playback endpoint a /dev/shm file belongs to, or null. */
function endpointOf(file) {
    const m = /^smartx_(.+?_CF_\d+_[A-Za-z0-9_]+?)_([pc])_(?:connection|ringbuffer)$/.exec(file)
        || /^(?:smartx_)?()([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*?_CF_\d+_[A-Z_]+?)(?:_connection|_ringbuffer)?$/.exec(file);   // no direction mark
    if (!m) return null;
    return m[2] === 'c' ? null : m[2] === 'p' ? m[1] : m[2];
}
function shmEndpoints() {
    let names = [];
    try { names = fs.readdirSync(SHM); } catch (e) { return { error: String(e.code || e), endpoints: [] }; }
    const seen = {};
    names.forEach((n) => { const e = endpointOf(n); if (e) seen[e] = true; });
    // every file with its mode and group, for the app's audio report (which ones may we open?)
    const all = names.slice(0, 200).map((n) => {
        try { const st = fs.statSync(path.join(SHM, n)); return n + ' ' + (st.mode & 0o777).toString(8) + ' ' + st.uid + ':' + st.gid; } catch (e) { return n; }
    });
    return { endpoints: Object.keys(seen).sort(), files: names.filter((n) => /_CF_|smartx/i.test(n)).slice(0, 120), all,
        ids: (process.getuid ? process.getuid() : '') + ':' + (process.getgroups ? process.getgroups().join(',') : '') };
}

function status() {
    return {
        type: 'status', version: VERSION, device: state.device, synth: state.child ? 'running' : state.device ? 'starting' : 'stopped',
        tone: state.tone ? state.tone.dev : null, lastTone: state.lastTone, alsa: state.alsa, sticky: state.sticky, log: state.recent.slice(-16),
        engine: path.basename(synthPath()).replace(/^es-synth-/, ''), engines: engines(), synthFile: fs.existsSync(synthPath()),
    };
}

/* ---------------- control socket ---------------- */
function handle(line, reply) {
    line = line.trim();
    if (!line) return;
    const sp = line.indexOf(' '), cmd = sp < 0 ? line : line.slice(0, sp), arg = sp < 0 ? '' : line.slice(sp + 1).trim();
    if (cmd === 'ENGINE') return setEngine(arg);
    if (cmd === 'OUT') return setDevice(arg);
    if (cmd === 'TONE') return arg && tone(arg);
    if (cmd === 'STATUS') return reply(status());
    if (cmd === 'SHM') return reply(Object.assign({ type: 'shm' }, shmEndpoints()));
    if (!/^[PETVMSX]$/.test(cmd)) return;
    const k = stickyKey(line);
    if (cmd === 'X' && !k) return;      // (no sound setting's name)
    if (k) state.sticky[k] = line;
    toSynth(line);
}

function listen() {
    try { fs.mkdirSync(RUN_DIR); } catch (e) { /* there (RuntimeDirectory) */ }
    try { fs.unlinkSync(SOCK); } catch (e) { /* none */ }
    const server = net.createServer((c) => {
        let buf = '';
        const reply = (o) => { try { c.write(JSON.stringify(o) + '\n'); } catch (e) {} };
        c.on('data', (d) => {
            buf += d.toString();
            let i;
            while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { handle(l, reply); } catch (e) { log('line: ' + e); } }
            if (buf.length > 65536) buf = '';
        });
        c.on('error', () => {});
        // the app gone: the synth fades out by itself once no P line comes (stale data)
    });
    server.on('error', (e) => { log('socket: ' + e); setTimeout(listen, 3000); });
    server.listen(SOCK, () => {
        try { fs.chmodSync(SOCK, 0o660); } catch (e) { log('chmod: ' + e); }
        log('listening on ' + SOCK + ' (version ' + VERSION + ')');
    });
}

function quit() {
    log('stopping');
    if (state.tone) { try { state.tone.child.kill('SIGTERM'); } catch (e) {} }
    stopSynth(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', quit);
process.on('SIGINT', quit);
process.on('uncaughtException', (e) => log('uncaught: ' + (e && e.stack || e)));

if (require.main === module) listen();
module.exports = { handle, endpointOf, shmEndpoints, status, state };
