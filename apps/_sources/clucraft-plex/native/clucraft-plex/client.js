'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * client.js - the Plex client, a child of service.js running as the tool's internet uid (component.json "uids":
 * mgu-uplink routes it, never root). It holds no file of its own: the account comes from the parent over IPC, and
 * everything it learns goes back the same way. Built as amn-iptv's client.js is (M850i-amn/idrive7-apps, from
 * aurelmarius' TVH Player; GPL-3.0-or-later): the same parent, pipe and player, with Plex in place of Xtream.
 *
 *   parent -> { op: 'run', account: { token, serverId }, device } | { op: 'link-start', device } | { op: 'link-cancel' }
 *             | { op: 'signout' } | { op: 'server', id } | { op: 'refresh' }
 *             | { op: 'play', key, offset, quality, subtitles } | { op: 'pause' } | { op: 'resume' } | { op: 'seek', pos }
 *             | { op: 'playback-stop' } | { op: 'prefs', prefs } | { op: 'player', id, ev } (the player's events)
 *             | { op: 'ask', id, what, ... }: home | section | children | meta | search | art | watched | streams
 *   child  -> { ev: 'status', status } | { ev: 'link', link } | { ev: 'linked', token, user } | { ev: 'server', id }
 *             | { ev: 'playback', status } | { ev: 'player-start', id } | { ev: 'player-ctl', id, line } | { ev: 'player-stop', id }
 *             | { ev: 'log', line } | { ev: 'ready', uid } | { ev: 'answer', id, ok, value | error }
 *
 * The film's stream goes to the parent on fd 4 (the parent hands it to tvh-player's stdin), in frames: a stream id
 * (u32 LE), a length (u32 LE; 0xffffffff: that stream ended), the bytes.
 *
 * Signing in is Plex's own link code: plex.tv gives four characters, the owner types them at plex.tv/link on any
 * phone or computer, and plex.tv hands this client the account's token. No password is ever typed in the car.
 *
 * Plain Node 8.
 */
const net = require('net');
const { createNet } = require('./netx');
const { createPlex } = require('./plex');
const { createSession } = require('./session');
const { cover } = require('./art');

const send = (m) => { try { if (process.connected) process.send(m); } catch (e) { /* the parent is gone */ } };
const log = (line) => send({ ev: 'log', line });

const nx = createNet({ leasePath: process.env.PLEXD_LEASE || undefined, systemDns: process.env.PLEXD_SYSTEM_DNS === '1' });
let px = null;      // made once the parent has told the device's id (run / link-start)
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
    if (px) return;
    px = createPlex({ nx, log, device: d || {}, tv: process.env.PLEXD_TV || undefined });
    ps = createSession({ px, nx, log, sink, retryForMs: Number(process.env.PLEXD_RETRY_FOR_MS) || undefined });
    if (lastPrefs) ps.setPrefs(lastPrefs);
}

/* ---------- the account and its server ---------- */
const RETRY_MIN = Number(process.env.PLEXD_RETRY_MS) || 5000;
const CHECK_MS = 10 * 60000;
const st = { state: 'signed-out', error: null, user: null, server: null, servers: [], since: Date.now(), retries: 0 };
let account = null, running = false, timer = null, backoff = RETRY_MIN, list = [], lastPrefs = null;

function status() { send({ ev: 'status', status: JSON.parse(JSON.stringify(st)) }); }
function setState(state, error) { st.state = state; st.error = error || null; st.since = Date.now(); status(); }
let lastSent = '';
function playbackStatus() {
    if (!ps) return;
    const j = JSON.stringify(ps.status());
    if (j !== lastSent) { lastSent = j; send({ ev: 'playback', status: JSON.parse(j) }); }
}
setInterval(playbackStatus, 500);

/** the server this account uses: the one chosen before, else its own first, else the first shared with it */
function choose() {
    if (!list.length) return null;
    return list.filter((s) => s.id === account.serverId)[0] || list.filter((s) => s.owned && s.online)[0] || list.filter((s) => s.online)[0] || list[0];
}
async function connect(force) {
    clearTimeout(timer);
    if (!running || !account) return;
    try {
        if (st.state !== 'connected') setState('connecting');
        if (!st.user) st.user = (await px.user(account.token)).name;
        if (force || !list.length) {
            list = await px.servers(account.token);
            st.servers = list.map((s) => ({ id: s.id, name: s.name, owned: s.owned, online: s.online }));
        }
        const s = choose();
        if (!s) throw Object.assign(new Error('this Plex account has no server'), { code: 'ENOSERVER' });
        if (force || !st.server || st.server.id !== s.id) {
            const c = await px.reach(s);
            px.use({ uri: c.uri, token: s.token });
            st.server = { id: s.id, name: s.name, owned: s.owned, relay: !!c.relay, local: !!c.local, host: (/^https?:\/\/([^/:]+)/.exec(c.uri) || [])[1] || null };
            log('server ' + s.name + (c.relay ? ' through Plex\'s relay (slow: 1-2 Mbit/s)' : c.local ? ' at its local address' : ' at its own address'));
        }
        backoff = RETRY_MIN; st.retries = 0;
        if (st.state !== 'connected') setState('connected'); else status();
        timer = setTimeout(() => connect(false), CHECK_MS);
    } catch (e) {
        if (!running) return;
        st.retries++;
        if (e.code === 'EAUTH') { st.server = null; setState('refused', e.message); return; }   // sign in again: not tried again by itself
        setState('error', e.message);
        log('plex: ' + e.message + ' (again in ' + Math.round(backoff / 1000) + ' s)');
        timer = setTimeout(() => connect(true), backoff);
        backoff = Math.min(60000, backoff * 2);
    }
}
function run(a) {
    account = { token: String(a.token), serverId: a.serverId || null };
    running = true;
    st.user = null; st.server = null; st.servers = []; list = [];
    connect(true);
}
function stopAll() {
    running = false; clearTimeout(timer);
    if (ps) ps.stop();
    account = null; list = [];
    st.user = null; st.server = null; st.servers = [];
}

/* ---------- signing in: plex.tv/link ---------- */
let link = null;   // { id, code, expires, timer }
function linkStatus(extra) { send({ ev: 'link', link: link ? Object.assign({ code: link.code, expires: link.expires, error: null }, extra || {}) : extra || null }); }
async function linkStart() {
    linkCancel(true);
    const mine = link = { id: null, code: null, expires: 0, timer: null };
    try {
        const p = await px.pinCreate();
        if (link !== mine) return;
        mine.id = p.id; mine.code = p.code; mine.expires = p.expires;
        log('sign-in: a code from plex.tv, good for ' + Math.round((p.expires - Date.now()) / 60000) + ' min');
        linkStatus();
        const poll = async () => {
            if (link !== mine) return;
            if (Date.now() > mine.expires) { link = null; linkStatus({ error: 'the code ran out: ask for a new one' }); return; }
            let token = null;
            try { token = await px.pinCheck(mine.id); } catch (e) { if (e.status === 404) { if (link === mine) { link = null; linkStatus({ error: 'the code ran out: ask for a new one' }); } return; } }
            if (link !== mine) return;
            if (!token) { mine.timer = setTimeout(poll, 2000); return; }
            link = null;
            let name = null;
            try { name = (await px.user(token)).name; } catch (e) { /* asked again on connecting */ }
            log('sign-in: linked' + (name ? ' as ' + name : ''));
            send({ ev: 'linked', token, user: name });
            linkStatus(null);
        };
        mine.timer = setTimeout(poll, 2000);
    } catch (e) {
        if (link !== mine) return;
        link = null;
        log('sign-in: ' + e.message);
        linkStatus({ error: e.code === 'EOFFLINE' || e.code === 'ENODNS' ? 'No internet: connect the head unit (MGU Store, Settings) and try again' : e.message });
    }
}
function linkCancel(quiet) { if (link) { clearTimeout(link.timer); link = null; if (!quiet) linkStatus(null); } }

/* ---------- what the app asks ---------- */
const need = () => { if (!px || !account || st.state !== 'connected') throw new Error(st.state === 'refused' ? 'sign in again' : st.error || 'not connected to the server yet'); };
let sectionsKept = null;
async function sections() {
    if (sectionsKept && Date.now() - sectionsKept.at < 5 * 60000) return sectionsKept.list;
    const l = await px.sections();
    sectionsKept = { at: Date.now(), list: l };
    return l;
}
const soft = (p, what) => p.then((v) => v, (e) => { log(what + ': ' + e.message); return null; });

async function answer(m) {
    need();
    switch (m.what) {
    case 'home': {
        const r = await Promise.all([sections(), soft(px.onDeck(24), 'on deck'), soft(px.recentlyAdded(48), 'recently added')]);
        return { sections: r[0], deck: r[1] || [], recent: r[2] || [] };
    }
    case 'section': return px.sectionItems(m.key, { type: m.type, sort: m.sort, unwatched: !!m.unwatched, start: m.start, size: m.size });
    case 'children': return { key: String(m.key), items: await px.children(m.key) };
    case 'meta': return { item: await px.meta(m.key) };
    case 'search': return { q: String(m.q || ''), items: await px.search(m.q, 24) };
    case 'art': {
        // the server scales it to about twice the size asked (its smaller side at least), the rest is done here
        const w = Math.max(16, Math.min(1024, Math.round(Number(m.w)) || 176)), h = Math.max(16, Math.min(1024, Math.round(Number(m.h)) || 264));
        const jpg = await px.image(String(m.path || ''), Math.min(1280, w * 2), Math.min(1280, h * 2));
        return { w, h, img: cover(jpg, w, h).toString('base64') };
    }
    case 'watched': await px.scrobble(m.key, !!m.on); return { key: String(m.key), on: !!m.on };
    case 'streams': await px.setStreams(m.part, { audio: m.audio, subtitle: m.subtitle }); return { ok: true };
    default: throw new Error('unknown question');
    }
}

process.on('message', (m) => {
    if (!m || typeof m.op !== 'string') return;
    switch (m.op) {
    case 'run': device(m.device); run(m.account); break;
    case 'link-start': device(m.device); linkStart(); break;
    case 'link-cancel': linkCancel(); break;
    case 'signout': linkCancel(true); stopAll(); sectionsKept = null; setState('signed-out'); break;
    case 'server':
        if (account && list.some((s) => s.id === m.id)) {
            if (ps) ps.stop();
            account.serverId = m.id; sectionsKept = null; st.server = null;
            send({ ev: 'server', id: m.id });
            connect(true);
        }
        break;
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
