'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * service.js - a Plex account's films and series on the head unit, for the app "Drive-In" (apps/clucraft_plex).
 * Root, the unit's /usr/bin/node. Built as amn-iptv's service.js is (M850i-amn/idrive7-apps, from aurelmarius' TVH
 * Player service; GPL-3.0-or-later): socket activation, a client running as the tool's internet uid, the player
 * started here; the Plex parts are this project's own.
 *
 * Started by the app's first connection to /run/clucraft-plex.sock (socket activation), never at boot; ends 10
 * minutes after the app's last request while nothing plays.
 *
 *   client.js     the Plex client, a child running as the tool's internet uid (mgu-uplink routes it, never root)
 *   tvh-player    the film (player.js): started here as root for its frame file, it runs as nobody with the groups
 *                 video and mgu_alsa; the stream comes from the client through this process
 *   state         /var/opt/clucraft-plex/state: account.json (the account's token; 0600, root's), device.json (this
 *                 head unit's id for Plex), prefs.json, art/ (posters already made, 48 MiB at most)
 *
 * Privacy: the token lives only here, on the head unit. The app never receives it (its status shows the account's
 * name and the server's), no address carries it and nothing logs it. Sign out deletes it.
 *
 * Control: one JSON object per line, the reply one line:
 *   {"cmd":"status"}  {"cmd":"link-start"}  {"cmd":"link-cancel"}  {"cmd":"signout"}  {"cmd":"refresh"}  {"cmd":"exit"}
 *   {"cmd":"server","id":".."}                               the account's other server           -> the status
 *   {"cmd":"home"}                                           -> { sections, deck, recent } or { error }
 *   {"cmd":"section","key":"2","type":"movie","sort":"title","unwatched":false,"start":0,"size":60} -> { total, start, items }
 *   {"cmd":"children","key":".."}                            -> { key, items } (a show's seasons, a season's episodes)
 *   {"cmd":"meta","key":".."}                                -> { item } (with its media: versions, sound, subtitles)
 *   {"cmd":"search","q":".."}                                -> { q, items }
 *   {"cmd":"art","path":"/library/metadata/1/thumb/2","w":176,"h":264} -> { w, h, img: base64 RGBA } or { none: true, why }
 *   {"cmd":"watched","key":"..","on":true}                   -> { key, on }
 *   {"cmd":"streams","part":"..","audio":"..","subtitle":".."} -> { ok } (the tracks the server plays from now on)
 *   {"cmd":"play","key":"..","offset":<s>,"quality":"720","subtitles":false}
 *   {"cmd":"pause"} {"cmd":"resume"} {"cmd":"seek","pos":<s>} {"cmd":"stop"} {"cmd":"prefs","gain":6,"even":false} -> the status
 *
 * The app's watch: while a film plays, the app asks every second; 90 s without a request (the app was closed, or
 * crashed) and the film stops.
 *
 * Plain Node 8.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');
const { createPlayer } = require('./player');

const VERSION = '0.1.0';
const IDLE_MS = 10 * 60 * 1000;
const WATCH_MS = 90 * 1000;
const NET_UID = 13271;    // component.json "uids": the only uid of this tool mgu-uplink routes
const LOG_LINES = 60;
const PLAYING = ['loading', 'playing', 'buffering'];
const ART_BYTES = 48 * 1024 * 1024;
const ART_NONE_MS = 10 * 60 * 1000;
const QUALITY = ['original', '1080', '720', '720low', '480', '360'];

function createService(opts) {
    const o = Object.assign({
        stateDir: process.env.PLEXD_STATE || '/var/opt/clucraft-plex/state',
        uid: process.env.PLEXD_UID === '' ? null : Number(process.env.PLEXD_UID || NET_UID),
        leasePath: process.env.PLEXD_LEASE || '/run/mgu-uplink/lease.json',
        now: Date.now,
        childEnv: {},
        playerBin: process.env.PLEXD_PLAYER || path.join(__dirname, 'tvh-player'),
        playerEnv: {},
        playerArgs: undefined, playerCwd: undefined,
        videoPath: undefined,
        watchMs: WATCH_MS,
        deviceName: 'BMW iDrive 7',
    }, opts || {});
    const now = o.now;
    const lines = [];
    function log(s) {
        const t = new Date(now()).toISOString().slice(11, 19);
        lines.push(t + ' ' + s);
        if (lines.length > LOG_LINES) lines.shift();
        console.log(s);
    }

    /* ---------- state ---------- */
    const mkdir = (d) => { try { fs.mkdirSync(d, 0o700); } catch (e) { /* there */ } try { fs.chmodSync(d, 0o700); } catch (e) { /* not ours to change */ } };
    mkdir(o.stateDir);
    const file = (n) => path.join(o.stateDir, n);
    const readJson = (n) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch (e) { return null; } };
    function writeJson(n, v) {
        const tmp = file(n + '.tmp');
        fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 });
        fs.chmodSync(tmp, 0o600);
        fs.renameSync(tmp, file(n));
    }
    let account = readJson('account.json');
    if (account && !account.token) account = null;
    let prefs = readJson('prefs.json') || null;
    // this head unit, as Plex lists it among the account's devices: made once, kept
    let dev = readJson('device.json');
    if (!dev || !/^[0-9a-f-]{16,64}$/.test(String(dev.id))) {
        dev = { id: 'drivein-' + crypto.randomBytes(12).toString('hex') };
        try { writeJson('device.json', dev); } catch (e) { log('device id: ' + e.message); }
    }
    const device = () => ({ id: dev.id, name: o.deviceName, version: VERSION });

    const st = { version: VERSION, client: { state: account ? 'starting' : 'signed-out' }, link: null, error: null, playback: null };

    /* ---------- questions for the client (the internet) ---------- */
    const asks = {};
    function ask(what, extra, timeoutMs) {
        startChild();
        if (!child || !account) return Promise.reject(new Error(account ? 'the Plex client did not start' : 'not signed in'));
        return new Promise((res, rej) => {
            const id = crypto.randomBytes(6).toString('hex');
            const t = setTimeout(() => { if (asks[id]) { delete asks[id]; rej(new Error('the server did not answer in time')); } }, timeoutMs || 30000);
            asks[id] = (m) => { clearTimeout(t); if (m.ok) res(m.value); else rej(new Error(m.error)); };
            toChild(Object.assign({ op: 'ask', id, what }, extra || {}));
        });
    }
    const isKey = (v) => /^\d{1,12}$/.test(String(v));

    /* ---------- posters (state/art/<hash>.rgba: 8 bytes w, h then RGBA; made by the client, kept by their address) ---------- */
    const artDir = file('art');
    const artNone = {}, artBusy = {};
    const artStats = { made: 0, kept: 0, failed: 0, last: null };
    function artPrune() {
        let list;
        try { list = fs.readdirSync(artDir).map((n) => { const s = fs.statSync(path.join(artDir, n)); return { n, size: s.size, at: s.mtimeMs || +s.mtime }; }); } catch (e) { return; }
        let total = list.reduce((a, f) => a + f.size, 0);
        if (total <= ART_BYTES) return;
        list.sort((a, b) => a.at - b.at);
        for (let i = 0; i < list.length && total > ART_BYTES * 0.8; i++) { try { fs.unlinkSync(path.join(artDir, list[i].n)); total -= list[i].size; } catch (e) { /* gone */ } }
    }
    function art(p, w, h) {
        p = String(p || ''); w = Math.round(Number(w)); h = Math.round(Number(h));
        if (p[0] !== '/' || p.length > 400 || !(w >= 16 && w <= 1024 && h >= 16 && h <= 1024)) return Promise.resolve({ none: true, why: 'not a picture' });
        const srvId = (st.client && st.client.server && st.client.server.id) || '';
        const key = crypto.createHash('sha1').update(srvId + '|' + p + '|' + w + 'x' + h).digest('hex');
        const f = path.join(artDir, key + '.rgba');
        try {
            const b = fs.readFileSync(f);
            if (b.length === 8 + b.readUInt32LE(0) * b.readUInt32LE(4) * 4) { artStats.kept++; return Promise.resolve({ w: b.readUInt32LE(0), h: b.readUInt32LE(4), img: b.slice(8).toString('base64') }); }
        } catch (e) { /* not kept */ }
        if (artNone[key] && artNone[key].until > now()) return Promise.resolve({ none: true, why: artNone[key].why });
        if (artBusy[key]) return artBusy[key];
        const done = (v) => { delete artBusy[key]; return v; };
        artBusy[key] = ask('art', { path: p, w, h }, 30000).then((v) => {
            if (!v || v.w !== w || v.h !== h || typeof v.img !== 'string') throw new Error('a picture of another size');
            artStats.made++;
            try {
                mkdir(artDir);
                const head = Buffer.alloc(8); head.writeUInt32LE(w, 0); head.writeUInt32LE(h, 4);
                fs.writeFileSync(f, Buffer.concat([head, Buffer.from(v.img, 'base64')]), { mode: 0o600 });
                if (artStats.made % 40 === 0) artPrune();
            } catch (e) { log('art: ' + e.message); }
            return done({ w, h, img: v.img });
        }, (e) => {
            artStats.failed++;
            if (artStats.last !== e.message) log('art: ' + e.message);
            artStats.last = e.message;
            artNone[key] = { until: now() + ART_NONE_MS, why: e.message };
            return done({ none: true, why: e.message });
        });
        return artBusy[key];
    }

    /* ---------- the player (root: its frame file; it runs as nobody) ---------- */
    const player = createPlayer({ bin: o.playerBin, args: o.playerArgs, cwd: o.playerCwd, uid: o.uid, env: o.playerEnv, videoPath: o.videoPath, log,
        onEvent: (id, ev) => toChild({ op: 'player', id, ev }) });

    /* ---------- the client (internet uid) ---------- */
    let child = null, childStarts = 0;
    function startChild() {
        if (child) return;
        childStarts++;
        const env = Object.assign({ PATH: process.env.PATH || '/usr/bin:/bin', PLEXD_LEASE: o.leasePath }, o.childEnv);
        // fd 4: the film's stream, from the client to the player (player.js)
        const fopts = { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc', 'pipe'] };
        if (o.uid !== null) { fopts.uid = o.uid; fopts.gid = o.uid; }
        let c;
        try { c = fork(path.join(__dirname, 'client.js'), [], fopts); }
        catch (e) { st.error = 'the Plex client did not start: ' + e.message; log(st.error); return; }
        child = c;
        if (c.stdio[4]) player.attach(c.stdio[4]);
        if (prefs) setTimeout(() => toChild({ op: 'prefs', prefs }), 0);
        c.on('message', onChild);
        c.on('error', (e) => log('client: ' + e.message));
        c.on('exit', (code, sig) => {
            if (child !== c) return;
            child = null;
            Object.keys(asks).forEach((id) => { asks[id]({ ok: false, error: 'the Plex client ended' }); delete asks[id]; });
            player.stopAll();
            st.playback = null; st.link = null;
            if (stopping) return;
            log('client ended (' + (sig || code) + ')' + (childStarts < 20 ? ', starting it again in 5 s' : ''));
            st.client = { state: account ? 'error' : 'signed-out', error: account ? 'the Plex client ended' : null };
            if (childStarts < 20) setTimeout(() => { startChild(); if (account) toChild({ op: 'run', account, device: device() }); }, 5000);
        });
    }
    const toChild = (m) => { if (child && child.connected) { try { child.send(m); } catch (e) { /* ending */ } } };
    function onChild(m) {
        if (!m) return;
        if (m.ev === 'log') log(m.line);
        else if (m.ev === 'status') st.client = m.status;
        else if (m.ev === 'ready') log('client running as uid ' + m.uid);
        else if (m.ev === 'playback') st.playback = m.status;
        else if (m.ev === 'answer' && asks[m.id]) { asks[m.id](m); delete asks[m.id]; }
        else if (m.ev === 'player-start') player.start(m.id);
        else if (m.ev === 'player-ctl') player.ctl(m.id, m.line);
        else if (m.ev === 'player-stop') player.stop(m.id);
        else if (m.ev === 'link') st.link = m.link;
        else if (m.ev === 'linked' && typeof m.token === 'string' && m.token) {
            account = { token: m.token, user: m.user || null, serverId: null, at: now() };
            try { writeJson('account.json', account); } catch (e) { log('account: ' + e.message); }
            st.link = null;
            toChild({ op: 'run', account: { token: account.token, serverId: null }, device: device() });
        } else if (m.ev === 'server' && account && typeof m.id === 'string') {
            account.serverId = m.id;
            try { writeJson('account.json', account); } catch (e) { log('account: ' + e.message); }
        }
    }

    /* ---------- control ---------- */
    let lastReq = now(), idleTimer = null, stopping = false;
    function bump() { lastReq = now(); }
    function uplink() {
        try { const l = JSON.parse(fs.readFileSync(o.leasePath, 'utf8')); return l && l.ip ? { online: true, iface: l.interface || null } : { online: false }; }
        catch (e) { return { online: false }; }
    }
    const playing = () => !!(st.playback && PLAYING.indexOf(st.playback.state) >= 0);
    const linking = () => !!(st.link && st.link.code);
    function status() {
        const ps = player.state();
        return {
            version: VERSION, now: now(), uplink: uplink(), error: st.error,
            account: account ? { user: (st.client && st.client.user) || account.user || null } : null,
            client: st.client, link: st.link, playback: st.playback, prefs,
            player: { running: ps.running, error: ps.error, decoder: ps.decoder, audio: ps.audio, videoPath: ps.videoPath, exits: ps.exits },
            art: artStats, log: lines.slice(-16),
        };
    }
    const wrap = (p, shape) => p.then((v) => v, (e) => Object.assign({ error: e.message }, shape || {}));
    async function command(m) {
        bump();
        const cmd = m && m.cmd;
        if (cmd === 'link-start') {
            startChild();
            st.link = { code: null, expires: 0, error: null, asking: true };
            toChild({ op: 'link-start', device: device() });
        } else if (cmd === 'link-cancel') {
            st.link = null;
            toChild({ op: 'link-cancel' });
        } else if (cmd === 'signout') {
            if (account) {
                log('signing out (the account\'s token is deleted from this head unit)');
                toChild({ op: 'playback-stop' });
                toChild({ op: 'signout' });
                account = null;
                try { fs.unlinkSync(file('account.json')); } catch (e) { /* none */ }
                // another account's posters are not this one's
                try { fs.readdirSync(artDir).forEach((n) => fs.unlinkSync(path.join(artDir, n))); } catch (e) { /* none */ }
                st.playback = null;
                st.client = { state: 'signed-out' };
            }
        } else if (cmd === 'server') {
            toChild({ op: 'server', id: String(m.id || '') });
        } else if (cmd === 'home') {
            return wrap(ask('home', {}, 40000), { sections: [], deck: [], recent: [] });
        } else if (cmd === 'section') {
            const q = { key: String(m.key || ''), type: m.type === 'show' ? 'show' : 'movie', sort: String(m.sort || 'title'), unwatched: m.unwatched === true,
                start: Math.max(0, Number(m.start) || 0), size: Math.max(1, Math.min(120, Number(m.size) || 60)) };
            return wrap(ask('section', q, 40000), { total: 0, start: q.start, items: [] });
        } else if (cmd === 'children' && isKey(m.key)) {
            return wrap(ask('children', { key: String(m.key) }, 40000), { key: String(m.key), items: [] });
        } else if (cmd === 'meta' && isKey(m.key)) {
            return wrap(ask('meta', { key: String(m.key) }, 30000), { item: null });
        } else if (cmd === 'search') {
            const q = String(m.q || '').slice(0, 80);
            return wrap(ask('search', { q }, 40000), { q, items: [] });
        } else if (cmd === 'art') {
            return art(m.path, m.w, m.h);
        } else if (cmd === 'watched' && isKey(m.key)) {
            return wrap(ask('watched', { key: String(m.key), on: m.on !== false }, 20000));
        } else if (cmd === 'streams' && isKey(m.part)) {
            return wrap(ask('streams', { part: String(m.part), audio: m.audio != null ? String(m.audio) : null, subtitle: m.subtitle != null ? String(m.subtitle) : null }, 20000));
        } else if (cmd === 'play' && isKey(m.key)) {
            const p = { op: 'play', key: String(m.key), offset: Math.max(0, Number(m.offset) || 0),
                quality: QUALITY.indexOf(String(m.quality)) >= 0 ? String(m.quality) : '720', subtitles: m.subtitles === true };
            log('play ' + p.key + ' from ' + Math.floor(p.offset) + ' s (' + p.quality + ')');
            toChild(p);
        } else if (cmd === 'seek') {
            toChild({ op: 'seek', pos: Math.max(0, Number(m.pos) || 0) });
        } else if (cmd === 'pause' || cmd === 'resume') {
            toChild({ op: cmd });
        } else if (cmd === 'stop') {
            toChild({ op: 'playback-stop' });
        } else if (cmd === 'refresh') {
            toChild({ op: 'refresh' });
        } else if (cmd === 'prefs') {
            const g = Number(m.gain);
            const p = { gain: isFinite(g) ? Math.max(0, Math.min(15, g)) : 6, even: m.even === true };
            if (!prefs || p.gain !== prefs.gain || p.even !== prefs.even) {
                prefs = p;
                try { writeJson('prefs.json', prefs); } catch (e) { log('prefs: ' + e.message); }
                toChild({ op: 'prefs', prefs });
            }
        } else if (cmd === 'exit') { setTimeout(() => stop(0), 100); }
        return status();
    }
    function serve(server) {
        server.on('connection', (c) => {
            let buf = '';
            c.setEncoding('utf8');
            c.on('error', () => {});
            c.on('data', (d) => {
                buf += d;
                let i;
                while ((i = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, i); buf = buf.slice(i + 1);
                    let m = null;
                    try { m = JSON.parse(line); } catch (e) { m = { cmd: 'status' }; }
                    command(m).then((s) => { try { c.write(JSON.stringify(s) + '\n'); } catch (e) { /* gone */ } })
                        .catch((e) => { try { c.write(JSON.stringify({ version: VERSION, error: e.message }) + '\n'); } catch (x) { /* gone */ } });
                }
                if (buf.length > 65536) c.destroy();
            });
        });
    }

    function start() {
        log('clucraft-plex ' + VERSION);
        startChild();
        if (account) toChild({ op: 'run', account: { token: account.token, serverId: account.serverId || null }, device: device() });
        idleTimer = setInterval(() => {
            // a film nobody asks about (the app closed or crashed): stopped
            if (st.playback && st.playback.state !== 'idle' && now() - lastReq > o.watchMs) {
                log('the app has not asked for ' + Math.round(o.watchMs / 1000) + ' s: stopping the film');
                toChild({ op: 'playback-stop' });
            }
            if (linking() && now() - lastReq > o.watchMs) { st.link = null; toChild({ op: 'link-cancel' }); }
            if (!playing() && !linking() && now() - lastReq > IDLE_MS) { log('idle: ending'); stop(0); }
        }, Math.min(30000, Math.max(1000, Math.round(o.watchMs / 3))));
    }
    function stop(code) {
        if (stopping) return;
        stopping = true;
        clearInterval(idleTimer);
        toChild({ op: 'playback-stop' });
        player.killSync();
        // (the client tells the server the film stopped before it goes)
        setTimeout(() => { if (child) { try { child.kill('SIGTERM'); } catch (e) { /* gone */ } } }, o.exit === false ? 50 : 1200);
        if (o.exit !== false) setTimeout(() => process.exit(code || 0), 1500);
    }
    return { start, stop, serve, command, status };
}

if (require.main === module) {
    const svc = createService();
    const server = net.createServer();
    svc.serve(server);
    // systemd passes the socket as fd 3 (LISTEN_FDS); outside it, PLEXD_SOCK
    if (process.env.LISTEN_FDS && Number(process.env.LISTEN_FDS) >= 1) server.listen({ fd: 3 });
    else {
        const p = process.env.PLEXD_SOCK || '/run/clucraft-plex.sock';
        try { fs.unlinkSync(p); } catch (e) { /* none */ }
        server.listen(p);
    }
    try { const g = require('./sockgroup').apply(process.env.PLEXD_SOCK || '/run/clucraft-plex.sock'); console.log('control socket: ' + (g === null ? 'root only' : 'group ' + g)); }
    catch (e) { console.log('control socket mode: ' + e.message); }
    svc.start();
    process.on('SIGTERM', () => svc.stop(0));
    process.on('SIGINT', () => svc.stop(0));
}

module.exports = { createService, VERSION, NET_UID };
