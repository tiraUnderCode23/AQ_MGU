'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * client.js - the Jellyfin client, a child of service.js running as the tool's internet uid (component.json "uids":
 * mgu-uplink routes it, never root). It holds no file of its own: the account comes from the parent over IPC, and
 * everything it learns goes back the same way. Built as amn-iptv's client.js is (M850i-amn/idrive7-apps, from
 * aurelmarius' TVH Player; GPL-3.0-or-later): the same parent, pipe and player, with Jellyfin in place of Xtream.
 *
 *   parent -> { op: 'run', account: { url, token, userId }, device } | { op: 'signout' } | { op: 'refresh' }
 *             | { op: 'find', text, device }                         the server at the address the owner typed
 *             | { op: 'link-start', url, device } | { op: 'link-cancel' }          Quick Connect
 *             | { op: 'login', url, user, password, device }         a name and password, once
 *             | { op: 'play', key, offset, quality, audio, subtitle } | { op: 'pause' } | { op: 'resume' } | { op: 'seek', pos }
 *             | { op: 'playback-stop' } | { op: 'prefs', prefs } | { op: 'player', id, ev } (the player's events)
 *             | { op: 'ask', id, what, ... }: home | section | children | meta | search | art | watched
 *   child  -> { ev: 'status', status } | { ev: 'found', ok, server | error } | { ev: 'link', link } | { ev: 'login', error }
 *             | { ev: 'linked', url, token, userId, user, serverId }
 *             | { ev: 'playback', status } | { ev: 'player-start', id } | { ev: 'player-ctl', id, line } | { ev: 'player-stop', id }
 *             | { ev: 'log', line } | { ev: 'ready', uid } | { ev: 'answer', id, ok, value | error }
 *
 * The film's stream goes to the parent on fd 4 (the parent hands it to tvh-player's stdin), in frames: a stream id
 * (u32 LE), a length (u32 LE; 0xffffffff: that stream ended), the bytes.
 *
 * Signing in is Jellyfin's Quick Connect: the server gives six digits, the owner enters them in a Jellyfin they are
 * already signed in to (their phone's app, a browser), and the server hands this client a token of its own. No
 * password is typed in the car. Where a server has Quick Connect switched off, a name and password are asked
 * instead: they go to the server once, and nothing keeps or logs them.
 *
 * Plain Node 8.
 */
const net = require('net');
const { createNet } = require('./netx');
const { createJellyfin } = require('./jellyfin');
const { createSession } = require('./session');
const { cover } = require('./art');

const send = (m) => { try { if (process.connected) process.send(m); } catch (e) { /* the parent is gone */ } };
const log = (line) => send({ ev: 'log', line });

const nx = createNet({ leasePath: process.env.JFD_LEASE || undefined, systemDns: process.env.JFD_SYSTEM_DNS === '1' });
let jf = null;      // made once the parent has told the device's id (run / find / link-start / login)
let ps = null;

/* ---------- the stream to the parent (fd 4) ---------- */
let pipe = null;
try { pipe = new net.Socket({ fd: 4, readable: false, writable: true }); pipe.on('error', (e) => log('stream pipe: ' + e.message)); }
catch (e) { log('no stream pipe: ' + e.message); }
function frame(id, len) { const h = Buffer.alloc(8); h.writeUInt32LE(id >>> 0, 0); h.writeUInt32LE(len >>> 0, 4); return h; }
const sink = {
    start(id) { send({ ev: 'player-start', id }); },
    data(id, buf) { if (!pipe) return true; pipe.write(frame(id, buf.length)); return pipe.write(buf); },
    end(id) { if (pipe) pipe.write(frame(id, 0xffffffff)); },
    drain(id, fn) { if (pipe) pipe.once('drain', fn); else fn(); },
    ctl(id, line) { send({ ev: 'player-ctl', id, line }); },
    stop(id) { send({ ev: 'player-stop', id }); },
};

function device(d) {
    if (jf) return;
    jf = createJellyfin({ nx, log, device: d || {} });
    ps = createSession({ jf, nx, log, sink, retryForMs: Number(process.env.JFD_RETRY_FOR_MS) || undefined });
    if (lastPrefs) ps.setPrefs(lastPrefs);
}
const offline = (e) => (e && (e.code === 'EOFFLINE' || e.code === 'ENODNS') ? 'No internet: connect the head unit (MGU Store, Settings) and try again' : String(e && e.message || e));

/* ---------- the account and its server ---------- */
const RETRY_MIN = Number(process.env.JFD_RETRY_MS) || 5000;
const CHECK_MS = 10 * 60000;
const st = { state: 'signed-out', error: null, user: null, server: null, since: Date.now(), retries: 0 };
let account = null, running = false, timer = null, backoff = RETRY_MIN, lastPrefs = null;

function status() { send({ ev: 'status', status: JSON.parse(JSON.stringify(st)) }); }
function setState(state, error) { st.state = state; st.error = error || null; st.since = Date.now(); status(); }
let lastSent = '';
function playbackStatus() {
    if (!ps) return;
    const j = JSON.stringify(ps.status());
    if (j !== lastSent) { lastSent = j; send({ ev: 'playback', status: JSON.parse(j) }); }
}
setInterval(playbackStatus, 500);

/** the sign-in still holds (asked at the start, and every 10 minutes: a token taken back on the server is noticed) */
async function connect(force) {
    clearTimeout(timer);
    if (!running || !account) return;
    try {
        if (st.state !== 'connected') setState('connecting');
        st.user = (await jf.me()).name;
        if (force || !st.server) {
            const i = await jf.info();
            st.server = { id: i.id, name: i.name, version: i.version, host: (/^https?:\/\/([^/:]+|\[[^\]]+\])/.exec(account.url) || [])[1] || null, plain: /^http:/i.test(account.url) };
            log('server ' + i.name + ' (Jellyfin ' + i.version + ')' + (st.server.plain ? ', not encrypted (http)' : ''));
        }
        backoff = RETRY_MIN; st.retries = 0;
        if (st.state !== 'connected') setState('connected'); else status();
        timer = setTimeout(() => connect(false), CHECK_MS);
    } catch (e) {
        if (!running) return;
        st.retries++;
        if (e.code === 'EAUTH') { st.server = null; if (ps) ps.stop(); setState('refused', e.message); return; }   // sign in again: not tried again by itself
        setState('error', offline(e));
        log('jellyfin: ' + e.message + ' (again in ' + Math.round(backoff / 1000) + ' s)');
        timer = setTimeout(() => connect(true), backoff);
        backoff = Math.min(60000, backoff * 2);
    }
}
function run(a) {
    account = { url: String(a.url), token: String(a.token), userId: String(a.userId || '') };
    jf.use(account);
    running = true;
    st.user = null; st.server = null;
    connect(true);
}
function stopAll() {
    running = false; clearTimeout(timer);
    if (ps) ps.stop();
    if (jf) jf.use(null);
    account = null;
    st.user = null; st.server = null;
}

/* ---------- signing in ---------- */
/** the server at the address the owner typed (jellyfin.js: find) */
let finding = 0;
function find(text) {
    const mine = ++finding;
    jf.find(text).then((s) => {
        if (mine !== finding) return;
        log('sign-in: ' + s.name + ' (Jellyfin ' + s.version + ') at ' + s.url + (s.quick ? '' : ', Quick Connect is off'));
        send({ ev: 'found', ok: true, server: s });
    }, (e) => { if (mine === finding) { log('sign-in: no server: ' + e.message); send({ ev: 'found', ok: false, error: offline(e) }); } });
}

let link = null;   // { url, secret, code, expires, timer }: Quick Connect
function linkStatus(extra) { send({ ev: 'link', link: link ? Object.assign({ code: link.code, expires: link.expires, error: null }, extra || {}) : extra || null }); }
async function linkStart(url) {
    linkCancel(true);
    const mine = link = { url: String(url), secret: null, code: null, expires: 0, timer: null };
    const ranOut = () => { if (link === mine) { link = null; linkStatus({ error: 'the code ran out: ask for a new one' }); } };
    try {
        const p = await jf.quickStart(mine.url);
        if (link !== mine) return;
        mine.secret = p.secret; mine.code = p.code; mine.expires = p.expires;
        log('sign-in: a Quick Connect code, good for ' + Math.round((p.expires - Date.now()) / 60000) + ' min');
        linkStatus();
        const poll = async () => {
            if (link !== mine) return;
            if (Date.now() > mine.expires) return ranOut();
            let ok = false;
            try { ok = await jf.quickCheck(mine.url, mine.secret); } catch (e) { if (e.status === 404) return ranOut(); }
            if (link !== mine) return undefined;
            if (!ok) { mine.timer = setTimeout(poll, 2000); return undefined; }
            try {
                const a = await jf.quickAuth(mine.url, mine.secret);
                if (link !== mine) return undefined;
                link = null;
                log('sign-in: signed in as ' + a.user);
                send({ ev: 'linked', url: mine.url, token: a.token, userId: a.userId, user: a.user, serverId: a.serverId });
                linkStatus(null);
            } catch (e) {
                if (link !== mine) return undefined;
                link = null;
                log('sign-in: ' + e.message);
                linkStatus({ error: offline(e) });
            }
            return undefined;
        };
        mine.timer = setTimeout(poll, 2000);
    } catch (e) {
        if (link !== mine) return;
        link = null;
        log('sign-in: ' + e.message);
        linkStatus({ error: offline(e), off: e.code === 'ENOQUICK' });
    }
}
function linkCancel(quiet) { if (link) { clearTimeout(link.timer); link = null; if (!quiet) linkStatus(null); } }

/** a name and password: sent to the server once, kept and logged nowhere */
let logging = 0;
function login(m) {
    linkCancel(true);
    const mine = ++logging, url = String(m.url);
    jf.login(url, String(m.user || ''), String(m.password || '')).then((a) => {
        if (mine !== logging) return;
        log('sign-in: signed in as ' + a.user);
        send({ ev: 'linked', url, token: a.token, userId: a.userId, user: a.user, serverId: a.serverId });
        send({ ev: 'login', error: null });
    }, (e) => { if (mine === logging) { log('sign-in: ' + e.message); send({ ev: 'login', error: offline(e) }); } });
}

/* ---------- what the app asks ---------- */
const need = () => { if (!jf || !account || st.state !== 'connected') throw new Error(st.state === 'refused' ? 'sign in again' : st.error || 'not connected to the server yet'); };
let sectionsKept = null;
async function sections() {
    if (sectionsKept && Date.now() - sectionsKept.at < 5 * 60000) return sectionsKept.list;
    const l = await jf.sections();
    sectionsKept = { at: Date.now(), list: l };
    return l;
}
const soft = (p, what) => p.then((v) => v, (e) => { log(what + ': ' + e.message); return null; });

async function answer(m) {
    need();
    switch (m.what) {
    case 'home': {
        const r = await Promise.all([sections(), soft(jf.onDeck(24), 'continue watching'), soft(jf.recentlyAdded(48), 'recently added')]);
        return { sections: r[0], deck: r[1] || [], recent: r[2] || [] };
    }
    case 'section': return jf.sectionItems(m.key, { type: m.type, sort: m.sort, unwatched: !!m.unwatched, start: m.start, size: m.size });
    case 'children': return { key: String(m.key), items: await jf.children(m.key, m.of || null) };
    case 'meta': return { item: await jf.meta(m.key) };
    case 'search': return { q: String(m.q || ''), items: await jf.search(m.q, 24) };
    case 'art': {
        // the server scales it to about twice the size asked (the rest is done here, smoothly)
        const w = Math.max(16, Math.min(1024, Math.round(Number(m.w)) || 176)), h = Math.max(16, Math.min(1024, Math.round(Number(m.h)) || 264));
        const jpg = await jf.image(String(m.path || ''), Math.min(1280, w * 2), Math.min(1280, h * 2));
        return { w, h, img: cover(jpg, w, h).toString('base64') };
    }
    case 'watched': await jf.setPlayed(m.key, !!m.on); return { key: String(m.key), on: !!m.on };
    default: throw new Error('unknown question');
    }
}

process.on('message', (m) => {
    if (!m || typeof m.op !== 'string') return;
    switch (m.op) {
    case 'run': device(m.device); run(m.account); break;
    case 'find': device(m.device); find(m.text); break;
    case 'link-start': device(m.device); linkStart(m.url); break;
    case 'link-cancel': linkCancel(); break;
    case 'login': device(m.device); login(m); break;
    case 'signout': {
        linkCancel(true); finding++; logging++;
        // the server forgets this car's token too (asked before the token is dropped here)
        if (ps) ps.stop();
        const bye = jf && account ? jf.logout() : Promise.resolve(false);
        bye.then((ok) => { if (ok) log('sign-out: the server has dropped this car\'s sign-in'); });
        stopAll(); sectionsKept = null; setState('signed-out');
        break;
    }
    case 'refresh': sectionsKept = null; if (running) connect(true); break;
    case 'play': if (ps && st.state === 'connected') ps.play(m); break;
    case 'pause': if (ps) ps.pause(); break;
    case 'resume': if (ps) ps.resume(); break;
    case 'seek': if (ps) ps.seek(m.pos); break;
    case 'playback-stop': if (ps) ps.stop(); break;
    case 'prefs': lastPrefs = m.prefs || null; if (ps && lastPrefs) ps.setPrefs(lastPrefs); break;
    case 'player': if (ps) ps.onPlayer(m.id, m.ev); playbackStatus(); break;
    case 'ask':
        Promise.resolve().then(() => answer(m)).then((value) => send({ ev: 'answer', id: m.id, ok: true, value }),
            (e) => {
                // a refused sign-in found while asking: said in the status too, so the app shows the sign-in again
                if (e && e.code === 'EAUTH' && st.state === 'connected') { st.server = null; setState('refused', e.message); }
                send({ ev: 'answer', id: m.id, ok: false, error: String(e && e.message || e) });
            });
        break;
    default: break;
    }
});
process.on('disconnect', () => process.exit(0));
process.on('uncaughtException', (e) => { log('client: ' + (e && e.stack || e)); setTimeout(() => process.exit(1), 50); });

send({ ev: 'ready', uid: process.getuid ? process.getuid() : null });
status();
