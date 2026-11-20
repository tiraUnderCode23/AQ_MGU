'use strict';
/**
 * service.js - an Xtream Codes IPTV account on the head unit, for the app "IPTV" (apps/amn_iptv). Root, the unit's
 * /usr/bin/node. From aurelm-tvhplayer's service.js (aurelmarius/bmw-apps, GPL-3.0-or-later), changed for Xtream:
 * categories, a category's channels, search, what is on now for the channels on screen, a channel's guide.
 *
 * Started by the app's first connection to /run/amn-iptv.sock (socket activation), never at boot; ends 10 minutes
 * after the app's last request while nothing plays.
 *
 *   client.js     the Xtream client, a child running as the tool's internet uid (mgu-uplink routes it, never root)
 *   tvh-player    the channel (player.js): started here as root for its frame file, it runs as nobody with the
 *                 groups video and mgu_alsa; the stream comes from the client through this process
 *   sign-in page  while the app asks for it (10 minutes): an HTTP page on the car Wi-Fi (the phone opens it from the
 *                 QR code), and one accept rule per chain for its port on the car Wi-Fi's interfaces (nft.js)
 *   state         /var/opt/amn-iptv/state: account.json (server, user, password; 0600, root's), prefs.json,
 *                 logos/<stream id>.img (fetched once per address)
 *
 * Privacy: the account lives only here, on the head unit. The app never sees the password (status shows the server's
 * host and the user name only), and nothing logs it.
 *
 * Control: one JSON object per line, the reply one line:
 *   {"cmd":"status"} {"cmd":"signin-open"} {"cmd":"signin-close"} {"cmd":"signout"} {"cmd":"refresh"} {"cmd":"exit"}
 *   {"cmd":"play","id":<stream id>,"name":...} {"cmd":"stop"} {"cmd":"prefs","subs":..,"gain":..,"even":..}  -> the status
 *   {"cmd":"categories"}                      -> { at, categories: [{ id, name }] }
 *   {"cmd":"channels","cat":<id>}             -> { cat, channels: [{ id, name, icon, cat, num, hevc }] } or { error }
 *   {"cmd":"search","q":"tva"}                -> { q, channels: [...] } (80 at most; the first search loads every channel)
 *   {"cmd":"now","ids":[...]}                 -> { now: { <id>: { now, next } } } (30 ids at most)
 *   {"cmd":"epg","id":<stream id>}            -> { id, events: [{ start, stop, title, text, isNew }] } or { id, error }
 *   {"cmd":"logo","id":<stream id>,"icon":url}-> { id, img: base64 (PNG or JPEG) } or { id, none: true, why }
 *                                             (a poster: id "f<film id>" or "s<series id>")
 *   {"cmd":"film-cats"} {"cmd":"series-cats"} -> { categories: [{ id, name }] } or { error }
 *   {"cmd":"films","cat":<id>}                -> { cat, films: [{ id, name, poster, cat, rating, year, ext, added, hevc }] } or { error }
 *   {"cmd":"series","cat":<id>}               -> { cat, series: [{ id, name, poster, cat, rating, year }] } or { error }
 *   {"cmd":"film-info","id":<id>}             -> { id, info: { name, poster, plot, genre, year, rating, duration, ext, codec, hevc } } or { error }
 *   {"cmd":"series-info","id":<id>}           -> { id, info: { name, poster, plot, genre, year, seasons: [{ n, episodes: [...] }] } } or { error }
 *   {"cmd":"vod-search","kind":"movies"|"series","q":"..","langs":"efa"|"ef"|"all"} -> { kind, q, items: [...], done, total, complete } (60 at most,
 *                                             from the categories indexed so far: ask again until complete)
 *   {"cmd":"film-play","kind":"movie"|"series","id":<id>,"ext":"mp4","name":..,"start":<s>,"duration":<s>}
 *   {"cmd":"film-seek","pos":<s>} {"cmd":"film-pause"} {"cmd":"film-resume"}  -> the status (its playback: film.js's)
 *
 * The app's watch: while a channel plays, the app asks every second or two; 90 s without a request (the app was
 * closed, or crashed) and the channel stops.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const qs = require('querystring');
const { fork } = require('child_process');
const nftm = require('./nft');
const pagem = require('./page');
const { createPlayer } = require('./player');

const VERSION = '0.3.7';
const PAGE_PORT = 8493;   // aurelm: Emby 8490, TVH (bmw-test-apps) 8491, TVH Player 8492: all may be open at once
const PAGE_MINUTES = 10;
const IDLE_MS = 10 * 60 * 1000;
const WATCH_MS = 90 * 1000;
const NET_UID = 13161;    // component.json "uids": the only uid of this tool mgu-uplink routes
const LOG_LINES = 40;
const PLAYING = ['loading', 'playing', 'buffering'];
const LOGO_NONE_MS = 30 * 60 * 1000;

function createService(opts) {
    const o = Object.assign({
        stateDir: process.env.TVH_STATE || '/var/opt/amn-iptv/state',
        nft: process.env.TVH_NFT === 'off' ? null : (process.env.TVH_NFT || 'nft'),
        uid: process.env.TVH_UID === '' ? null : Number(process.env.TVH_UID || NET_UID),
        pagePort: Number(process.env.TVH_PAGE_PORT || PAGE_PORT),
        pageIfaces: process.env.TVH_PAGE_IFACES ? process.env.TVH_PAGE_IFACES.split(',') : null,
        leasePath: process.env.TVH_LEASE || '/run/mgu-uplink/lease.json',
        now: Date.now,
        childEnv: {},
        playerBin: process.env.TVH_PLAYER || path.join(__dirname, 'tvh-player'),
        playerEnv: {},
        videoPath: undefined,
        watchMs: WATCH_MS,
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
    try { fs.mkdirSync(o.stateDir, 0o700); } catch (e) { /* there */ }
    try { fs.chmodSync(o.stateDir, 0o700); } catch (e) { /* not ours to change */ }
    const file = (n) => path.join(o.stateDir, n);
    const readJson = (n) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch (e) { return null; } };
    function writeJson(n, v) {
        const tmp = file(n + '.tmp');
        fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 });
        fs.chmodSync(tmp, 0o600);
        fs.renameSync(tmp, file(n));
    }
    let account = readJson('account.json');
    if (account && (!account.server || !account.user)) account = null;
    let prefs = readJson('prefs.json') || null;

    const st = { version: VERSION, client: { state: account ? 'starting' : 'signed-out' }, page: { open: false }, lastSignIn: null, error: null, playback: null };
    let cats = { at: null, categories: [] };

    /* ---------- questions for the client (the internet) ---------- */
    const asks = {};
    function ask(what, extra, timeoutMs) {
        startChild();
        if (!child || !account) return Promise.reject(new Error(account ? 'the client did not start' : 'not signed in'));
        return new Promise((res, rej) => {
            const id = crypto.randomBytes(6).toString('hex');
            const t = setTimeout(() => { if (asks[id]) { delete asks[id]; rej(new Error('the server did not answer in time')); } }, timeoutMs || 30000);
            asks[id] = (m) => { clearTimeout(t); if (m.ok) res(m.value); else rej(new Error(m.error)); };
            toChild(Object.assign({ op: 'ask', id, what }, extra || {}));
        });
    }
    const isId = (v) => /^\d{1,10}$/.test(String(v));
    const isLogoId = (v) => /^[fs]?\d{1,10}$/.test(String(v));     // a channel's, or a film's (f) or a series' (s) poster

    /* ---------- a channel's guide, kept 3 minutes ---------- */
    const epgKept = {};
    function epg(id) {
        if (!isId(id)) return Promise.resolve({ id, error: 'not a channel' });
        const k = epgKept[id];
        if (k && now() - k.at < 3 * 60000) return Promise.resolve({ id, events: k.events });
        return ask('epg', { sid: String(id) }, 25000).then((events) => { epgKept[id] = { at: now(), events }; return { id, events }; },
            (e) => ({ id, error: e.message }));
    }

    /* ---------- the channels' logos (state/logos/<stream id>.img, kept by their address) ---------- */
    const logoDir = file('logos');
    const logoNone = {};
    const logoStats = { fetched: 0, failed: 0, last: null };
    function logo(id, icon) {
        if (!isLogoId(id)) return Promise.resolve({ id, none: true, why: 'not a channel' });
        icon = String(icon || '');
        if (!/^https?:\/\//i.test(icon)) return Promise.resolve({ id, none: true, quiet: true, why: 'no logo' });
        const f = path.join(logoDir, id + '.img'), fu = path.join(logoDir, id + '.url');
        const kept = () => { try { return fs.readFileSync(f).toString('base64'); } catch (e) { return null; } };
        let keptUrl = null;
        try { keptUrl = fs.readFileSync(fu, 'utf8'); } catch (e) { /* none kept */ }
        if (keptUrl === icon) { const img = kept(); if (img) return Promise.resolve({ id, img }); }
        const key = id + '|' + icon;
        const none = (why) => {
            const old = kept();
            if (old) return { id, img: old, stale: true };
            logoNone[key] = { until: now() + LOGO_NONE_MS, why };
            return { id, none: true, why };
        };
        if (logoNone[key] && logoNone[key].until > now()) return Promise.resolve(none(logoNone[key].why));
        return ask('logo', { icon }, 20000).then((img) => {
            logoStats.fetched++;
            try { fs.mkdirSync(logoDir, 0o700); } catch (e) { /* there */ }
            try { fs.writeFileSync(f, Buffer.from(img, 'base64'), { mode: 0o600 }); fs.writeFileSync(fu, icon, { mode: 0o600 }); } catch (e) { log('logo: ' + e.message); }
            return { id, img };
        }, (e) => {
            logoStats.failed++;
            if (logoStats.last !== e.message) log('logo ' + id + ': ' + e.message);
            logoStats.last = e.message;
            return none(e.message);
        });
    }

    /* ---------- the player (root: its frame file; it runs as nobody) ---------- */
    const player = createPlayer({ bin: o.playerBin, uid: o.uid, env: o.playerEnv, videoPath: o.videoPath, log,
        onEvent: (id, ev) => toChild({ op: 'player', id, ev }) });

    /* a film's player: its address on 127.0.0.1 (film.js: a random port and 128-bit path) and its start, nothing else */
    function filmEnv(e) {
        if (!e) return null;
        const url = String(e.MGU_INPUT_URL || ''), start = String(e.MGU_START_S || '0');
        if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/[0-9a-f]{32}\/film$/.test(url) || !/^\d{1,6}$/.test(start)) { log('a film address refused'); return null; }
        return { MGU_INPUT_URL: url, MGU_START_S: start };
    }

    /* ---------- the client (internet uid) ---------- */
    let child = null, childStarts = 0, signinWait = {};
    function startChild() {
        if (child) return;
        childStarts++;
        const env = Object.assign({ PATH: process.env.PATH || '/usr/bin:/bin', TVH_LEASE: o.leasePath }, o.childEnv);
        // fd 4: the channel's stream, from the client to the player (player.js)
        const fopts = { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc', 'pipe'] };
        if (o.uid !== null) { fopts.uid = o.uid; fopts.gid = o.uid; }
        let c;
        try { c = fork(path.join(__dirname, 'client.js'), [], fopts); }
        catch (e) { st.error = 'the Xtream client did not start: ' + e.message; log(st.error); return; }
        child = c;
        if (c.stdio[4]) player.attach(c.stdio[4]);
        if (prefs) setTimeout(() => toChild({ op: 'prefs', prefs }), 0);
        c.on('message', onChild);
        c.on('error', (e) => log('client: ' + e.message));
        c.on('exit', (code, sig) => {
            if (child !== c) return;
            child = null;
            Object.keys(signinWait).forEach((id) => { signinWait[id]({ ok: false, error: 'the Xtream client ended' }); delete signinWait[id]; });
            player.stopAll();
            st.playback = null;
            if (stopping) return;
            log('client ended (' + (sig || code) + ')' + (childStarts < 20 ? ', starting it again in 5 s' : ''));
            st.client = { state: 'error', error: 'the Xtream client ended' };
            if (childStarts < 20) setTimeout(() => { startChild(); if (account) toChild({ op: 'run', account }); }, 5000);
        });
    }
    const toChild = (m) => { if (child && child.connected) child.send(m); };
    function onChild(m) {
        if (!m) return;
        if (m.ev === 'log') log(m.line);
        else if (m.ev === 'status') st.client = m.status;
        else if (m.ev === 'ready') log('client running as uid ' + m.uid);
        else if (m.ev === 'playback') st.playback = m.status;
        else if (m.ev === 'categories') cats = { at: m.at, categories: m.categories || [] };
        else if (m.ev === 'answer' && asks[m.id]) { asks[m.id](m); delete asks[m.id]; }
        else if (m.ev === 'player-start') player.start(m.id, filmEnv(m.env));
        else if (m.ev === 'player-ctl') player.ctl(m.id, m.line);
        else if (m.ev === 'player-stop') player.stop(m.id);
        else if (m.ev === 'signed-out') st.client = { state: 'signed-out' };
        else if (m.ev === 'signin' && signinWait[m.id]) { signinWait[m.id](m); delete signinWait[m.id]; }
    }
    function signIn(server, user, password) {
        return new Promise((res) => {
            startChild();
            if (!child) return res({ ok: false, error: st.error || 'the Xtream client did not start' });
            const id = crypto.randomBytes(6).toString('hex');
            const t = setTimeout(() => { if (signinWait[id]) { delete signinWait[id]; res({ ok: false, error: 'the server did not answer in time' }); } }, 45000);
            signinWait[id] = (r) => { clearTimeout(t); res(r); };
            toChild({ op: 'signin', id, server, user, password });
        });
    }

    /* ---------- the sign-in page ---------- */
    let pageSrv = null, pageToken = null, pageTimer = null, fwTimer = null;
    /** the car Wi-Fi: the interfaces the phone reaches us on (wireless CarPlay), with their IPv4 address */
    function carWifi() {
        const all = os.networkInterfaces();
        const out = [];
        Object.keys(all).forEach((name) => (all[name] || []).forEach((a) => {
            if (a.family !== 'IPv4' || a.internal) return;
            const want = o.pageIfaces ? o.pageIfaces.indexOf(name) >= 0
                : /^(wlan|uap|ap|wl)/.test(name) && name !== 'vethuplink' || /^172\.16\.222\./.test(a.address);
            if (want) out.push({ name, ip: a.address });
        }));
        out.sort((a, b) => (b.name === 'wlan_bridge') - (a.name === 'wlan_bridge'));
        return out;
    }
    function firewall() {
        if (!o.nft) return;
        const names = carWifi().map((i) => i.name);
        try {
            const r = nftm.apply(names, o.pagePort, { nft: o.nft });
            const bad = r.filter((x) => !x.ok);
            st.page.firewall = bad.length ? 'failed: ' + bad[0].chain + ': ' + bad[0].error : r.length + ' chains open for tcp ' + o.pagePort;
            if (r.some((x) => x.changed)) log('firewall: ' + st.page.firewall + ' on ' + (names.join(', ') || 'no interface'));
        } catch (e) { st.page.firewall = 'failed: ' + e.message; }
    }
    function pageUrl() {
        const ifs = carWifi();
        return ifs.length ? 'http://' + ifs[0].ip + ':' + o.pagePort + '/' + pageToken : null;
    }
    function openPage() {
        bump();
        if (pageSrv) { st.page.until = now() + PAGE_MINUTES * 60000; armPageTimer(); return Promise.resolve(); }
        pageToken = crypto.randomBytes(6).toString('hex');
        return new Promise((res) => {
            const srv = http.createServer(onPage);
            srv.on('error', (e) => { st.page = { open: false, error: 'the sign-in page did not open: ' + e.message }; log(st.page.error); pageSrv = null; res(); });
            srv.listen(o.pagePort, '0.0.0.0', () => {
                pageSrv = srv;
                st.page = { open: true, until: now() + PAGE_MINUTES * 60000, url: pageUrl(), error: null };
                firewall();
                fwTimer = setInterval(() => { firewall(); st.page.url = pageUrl(); }, 5000);
                armPageTimer();
                log('sign-in page open: ' + (st.page.url || 'no car Wi-Fi yet (connect the iPhone with wireless CarPlay)'));
                res();
            });
        });
    }
    function armPageTimer() { clearTimeout(pageTimer); pageTimer = setTimeout(() => closePage('10 minutes passed'), Math.max(1000, st.page.until - now())); }
    function closePage(why) {
        clearTimeout(pageTimer); clearInterval(fwTimer);
        if (pageSrv) { try { pageSrv.close(); } catch (e) { /* closed */ } pageSrv = null; log('sign-in page closed' + (why ? ' (' + why + ')' : '')); }
        if (o.nft) { try { nftm.remove({ nft: o.nft }); } catch (e) { /* best effort */ } }
        st.page = { open: false };
        pageToken = null;
    }
    function onPage(req, res) {
        const send = (code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); };
        const p = (req.url || '').split('?')[0];
        if (!pageToken || p !== '/' + pageToken) return send(404, pagem.closed());
        const action = '/' + pageToken;
        const last = account ? account.server : (st.lastSignIn && st.lastSignIn.server);
        if (req.method === 'GET') return send(200, pagem.form({ action, server: last, user: account ? account.user : '' }));
        if (req.method !== 'POST') return send(405, pagem.closed());
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (d) => { body += d; if (body.length > 8192) req.destroy(); });
        req.on('end', () => {
            const f = qs.parse(body);
            const server = String(f.server || '').trim(), user = String(f.user || '').trim();
            log('sign-in at ' + ((/^(?:https?:\/\/)?([^/:]+)/i.exec(server) || [])[1] || '?'));
            signIn(server, user, String(f.password || '')).then((r) => {
                st.lastSignIn = { at: now(), ok: r.ok, server, error: r.ok ? null : r.error };
                if (!r.ok) { log('sign-in failed: ' + r.error); return send(200, pagem.form({ action, server, user, error: r.error })); }
                account = r.account;
                writeJson('account.json', account);
                toChild({ op: 'run', account });
                send(200, pagem.done({ serverName: account.serverName, user: account.user, expires: account.expires }));
                setTimeout(() => closePage('signed in'), 2000);
            });
        });
    }

    /* ---------- control ---------- */
    let lastReq = now(), idleTimer = null, stopping = false;
    function bump() { lastReq = now(); }
    function uplink() {
        try { const l = JSON.parse(fs.readFileSync(o.leasePath, 'utf8')); return l && l.ip ? { online: true, iface: l.interface, ip: l.ip, dns: l.dns || [] } : { online: false }; }
        catch (e) { return { online: false }; }
    }
    const playing = () => !!(st.playback && PLAYING.indexOf(st.playback.state) >= 0);
    function status() {
        return Object.assign({}, st, {
            now: now(), uplink: uplink(), player: player.state(), prefs,
            account: account ? { host: (/^https?:\/\/([^/]+)/i.exec(account.server) || [])[1] || null, user: account.user, serverName: account.serverName,
                expires: account.expires || null, maxConnections: account.maxConnections || null } : null,
            categories: { at: cats.at, count: cats.categories.length },
            logos: logoStats,
            page: Object.assign({}, st.page, st.page.open ? { url: pageUrl(), left: Math.max(0, Math.round((st.page.until - now()) / 1000)) } : {}),
            log: lines.slice(-14),
        });
    }
    async function command(m) {
        bump();
        const cmd = m && m.cmd;
        if (cmd === 'signin-open') await openPage();
        else if (cmd === 'signin-close') closePage('closed from the app');
        else if (cmd === 'signout') {
            if (account) {
                log('signing out (the login is deleted from this head unit)');
                toChild({ op: 'signout' });
                account = null;
                try { fs.unlinkSync(file('account.json')); } catch (e) { /* none */ }
                Object.keys(epgKept).forEach((k) => { delete epgKept[k]; });
                // another server's channels have other logos
                try { fs.readdirSync(logoDir).forEach((n) => fs.unlinkSync(path.join(logoDir, n))); } catch (e) { /* none */ }
                st.playback = null;
                cats = { at: null, categories: [] };
                st.client = { state: 'signed-out' };
            }
        } else if (cmd === 'categories') {
            return { at: cats.at, categories: cats.categories };
        } else if (cmd === 'channels') {
            const cat = String(m.cat || '');
            return ask('channels', { cat }).then((channels) => ({ cat, channels }), (e) => ({ cat, error: e.message }));
        } else if (cmd === 'search') {
            const q = String(m.q || '').slice(0, 60);
            return ask('search', { q }, 120000).then((channels) => ({ q, channels }), (e) => ({ q, error: e.message }));
        } else if (cmd === 'now') {
            const ids = (Array.isArray(m.ids) ? m.ids : []).filter(isId).slice(0, 30).map(String);
            return ask('now', { ids }, 30000).then((v) => ({ now: v }), (e) => ({ now: {}, error: e.message }));
        } else if (cmd === 'epg') {
            return epg(String(m.id || ''));
        } else if (cmd === 'logo') {
            return logo(String(m.id || ''), m.icon);
        } else if (cmd === 'film-cats' || cmd === 'series-cats') {
            return ask(cmd, {}, 60000).then((categories) => ({ categories }), (e) => ({ categories: [], error: e.message }));
        } else if (cmd === 'films' || cmd === 'series') {
            const cat = String(m.cat || '');
            return ask(cmd, { cat }, 120000).then((list) => ({ cat, [cmd]: list }), (e) => ({ cat, [cmd]: [], error: e.message }));
        } else if ((cmd === 'film-info' || cmd === 'series-info') && isId(m.id)) {
            return ask(cmd, { vid: String(m.id) }, 30000).then((info) => ({ id: String(m.id), info }), (e) => ({ id: String(m.id), error: e.message }));
        } else if (cmd === 'vod-search') {
            const kind = m.kind === 'series' ? 'series' : 'movies', q = String(m.q || '').slice(0, 60);
            const langs = ['efa', 'ef', 'all'].indexOf(m.langs) >= 0 ? m.langs : 'all';
            return ask('vod-search', { kind, q, langs }, 20000).then((r) => Object.assign({ kind, q }, r), (e) => ({ kind, q, items: [], error: e.message }));
        } else if (cmd === 'film-play' && isId(m.id)) {
            const f = { kind: m.kind === 'series' ? 'series' : 'movie', id: Number(m.id), ext: /^[a-z0-9]{2,5}$/i.test(String(m.ext || '')) ? String(m.ext) : 'mp4',
                name: String(m.name || '?').slice(0, 120), start: Math.max(0, Number(m.start) || 0), duration: Number(m.duration) || null };
            log('film ' + f.kind + ' ' + f.id + ' ' + f.name);
            toChild({ op: 'film-play', film: f });
        } else if (cmd === 'film-seek') {
            toChild({ op: 'film-seek', pos: Math.max(0, Number(m.pos) || 0) });
        } else if (cmd === 'film-pause' || cmd === 'film-resume') {
            toChild({ op: cmd });
        } else if (cmd === 'play' && isId(m.id)) {
            const ch = { uuid: String(m.id), name: String(m.name || '?').slice(0, 80), number: null };
            log('play ' + ch.uuid + ' ' + ch.name);
            toChild({ op: 'play', channel: ch });
        } else if (cmd === 'stop') {
            toChild({ op: 'playback-stop' });
        } else if (cmd === 'refresh') {
            toChild({ op: 'refresh' });
        } else if (cmd === 'prefs') {
            const g = Number(m.gain);
            const p = { profile: 'ts', adaptive: false, subs: m.subs !== false,
                gain: isFinite(g) ? Math.max(0, Math.min(15, g)) : 9, even: m.even === true };
            if (!prefs || p.profile !== prefs.profile || p.adaptive !== prefs.adaptive || p.subs !== prefs.subs || p.gain !== prefs.gain || p.even !== prefs.even) {
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
        if (o.nft) { const n = nftm.remove({ nft: o.nft }); if (n) log('firewall: removed ' + n + ' old rules'); }
        log('amn-iptv ' + VERSION + ' (Xtream)');
        startChild();
        if (account) toChild({ op: 'run', account });
        idleTimer = setInterval(() => {
            // a channel nobody asks about (the app closed or crashed): stopped
            if (playing() && now() - lastReq > o.watchMs) { log('the app has not asked for ' + Math.round(o.watchMs / 1000) + ' s: stopping the channel'); toChild({ op: 'playback-stop' }); }
            if (!playing() && !pageSrv && now() - lastReq > IDLE_MS) { log('idle: ending'); stop(0); }
        }, Math.min(30000, Math.max(1000, Math.round(o.watchMs / 3))));
    }
    function stop(code) {
        if (stopping) return;
        stopping = true;
        clearInterval(idleTimer);
        closePage();
        player.killSync();
        if (child) { try { child.kill('SIGTERM'); } catch (e) { /* gone */ } }
        if (o.exit !== false) setTimeout(() => process.exit(code || 0), 200);
    }
    return { start, stop, serve, command, status, signIn, carWifi };
}

if (require.main === module) {
    const svc = createService();
    const server = net.createServer();
    svc.serve(server);
    // systemd passes the socket as fd 3 (LISTEN_FDS); outside it, TVH_SOCK
    if (process.env.LISTEN_FDS && Number(process.env.LISTEN_FDS) >= 1) server.listen({ fd: 3 });
    else {
        const p = process.env.TVH_SOCK || '/run/amn-iptv.sock';
        try { fs.unlinkSync(p); } catch (e) { /* none */ }
        server.listen(p);
    }
    try { const g = require('./sockgroup').apply(process.env.TVH_SOCK || '/run/amn-iptv.sock'); console.log('control socket: ' + (g === null ? 'root only' : 'group ' + g)); }
    catch (e) { console.log('control socket mode: ' + e.message); }
    svc.start();
    process.on('SIGTERM', () => svc.stop(0));
    process.on('SIGINT', () => svc.stop(0));
}

module.exports = { createService, VERSION, PAGE_PORT, NET_UID };
