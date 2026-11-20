'use strict';
/**
 * client.js - the Xtream client, a child of service.js running as the tool's internet uid (component.json "uids":
 * mgu-uplink routes it, never root). It holds no file of its own: the account comes from the parent over IPC, and
 * everything it learns goes back the same way. From aurelm-tvhplayer's client.js (GPL-3.0-or-later), changed for
 * Xtream: an account has tens of thousands of channels, so nothing is listed whole unless asked (search).
 *
 *   parent -> { op: 'run', account } | { op: 'signin', id, server, user, password } | { op: 'signout' } | { op: 'stop' }
 *             | { op: 'play', channel } | { op: 'playback-stop' } | { op: 'prefs', prefs } | { op: 'refresh' }
 *             | { op: 'player', id, ev } (the player's events)
 *             | { op: 'film-play', film } | { op: 'film-seek', pos } | { op: 'film-pause' } | { op: 'film-resume' } (film.js)
 *             | { op: 'ask', id, what: 'channels', cat } | { what: 'search', q } | { what: 'now', ids } | { what: 'epg', sid }
 *             | { what: 'logo', icon } | { what: 'film-cats' } | { what: 'films', cat } | { what: 'film-info', vid }
 *             | { what: 'series-cats' } | { what: 'series', cat } | { what: 'series-info', vid } | { what: 'vod-search', kind, q }
 *   child  -> { ev: 'status', status } | { ev: 'signin', id, ok, account | error } | { ev: 'categories', at, categories }
 *             | { ev: 'playback', status } | { ev: 'player-start', id, env? } | { ev: 'player-ctl', id, line } | { ev: 'player-stop', id }
 *             | { ev: 'signed-out', why } | { ev: 'log', line } | { ev: 'ready', uid } | { ev: 'answer', id, ok, value | error }
 *
 * The channel's stream goes to the parent on fd 4 (the parent hands it to tvh-player's stdin), in frames: a stream
 * id (u32 LE), a length (u32 LE; 0xffffffff: that stream ended), the bytes (playback.js, unchanged).
 *
 * Connected: the account (every 10 minutes: its state and expiry) and the categories (every 30 minutes). A category's
 * channels are kept 10 minutes, what is on now per channel until its programme ends, every channel (search) 30 minutes.
 * A failure is tried again after 5 s, doubling to a minute.
 */
const net = require('net');
const { createNet } = require('./netx');
const { createXtream } = require('./xtream');
const { createPlayback, ascii } = require('./playback');
const { createFilm } = require('./film');
const LANGS = require('./langs');

const send = (m) => { try { if (process.connected) process.send(m); } catch (e) { /* the parent is gone */ } };
const log = (line) => send({ ev: 'log', line });

const nx = createNet({ leasePath: process.env.TVH_LEASE || undefined, systemDns: process.env.TVH_SYSTEM_DNS === '1' });
const xt = createXtream({ nx, log });

/* ---------- the stream to the parent (fd 4) ---------- */
let pipe = null;
try { pipe = new net.Socket({ fd: 4, readable: false, writable: true }); pipe.on('error', (e) => log('stream pipe: ' + e.message)); }
catch (e) { log('no stream pipe: ' + e.message); }
function frame(id, len) { const h = Buffer.alloc(8); h.writeUInt32LE(id >>> 0, 0); h.writeUInt32LE(len >>> 0, 4); return h; }
const sink = {
    start(id, env) { send(env ? { ev: 'player-start', id, env } : { ev: 'player-start', id }); },
    data(id, buf) { if (!pipe) return true; pipe.write(frame(id, buf.length)); return pipe.write(buf); },
    end(id) { if (pipe) pipe.write(frame(id, 0xffffffff)); },
    drain(id, fn) { if (pipe) pipe.once('drain', fn); else fn(); },
    ctl(id, line) { send({ ev: 'player-ctl', id, line }); },
    stop(id) { send({ ev: 'player-stop', id }); },
};

/* ---------- the account ---------- */
const INFO_MS = 10 * 60000, CATS_MS = 30 * 60000, LIST_MS = 10 * 60000, ALL_MS = 30 * 60000;
const RETRY_MIN = Number(process.env.TVH_RETRY_MS) || 5000;
const st = { state: 'signed-out', error: null, server: null, categories: 0, since: Date.now(), retries: 0 };
let running = false, timer = null, backoff = RETRY_MIN, catsAt = 0, infoAt = 0, cats = [];

const pb = createPlayback({ tvh: xt, log, sink, profiles: () => null, retryMs: process.env.TVH_STREAM_RETRY_MS != null ? Number(process.env.TVH_STREAM_RETRY_MS) : undefined,
    adaptUpMs: Number(process.env.TVH_ADAPT_UP_MS) || undefined, outageMs: Number(process.env.TVH_OUTAGE_MS) || undefined,
    dataMs: Number(process.env.TVH_STREAM_DATA_MS) || undefined });

// films and series (film.js): the player reads the film from the account itself, through 127.0.0.1
let lastPrefs = null;
const fm = createFilm({ xt, log, sink, prefs: () => lastPrefs, findAlt: (f, tried, progress) => hdVersionOf(f, tried, progress) });

function status() { send({ ev: 'status', status: JSON.parse(JSON.stringify(st)) }); }
function setState(state, error) { st.state = state; st.error = error || null; st.since = Date.now(); status(); }
let lastSent = '';
function playbackStatus() {
    const j = JSON.stringify(fm.active() ? fm.status() : pb.status());
    if (j !== lastSent) { lastSent = j; send({ ev: 'playback', status: JSON.parse(j) }); }
}
setInterval(playbackStatus, 1000);

/* ---------- what the app asks for (kept here, never on disk) ---------- */
const lists = new Map();      // cat id -> { at, channels }
const nowKept = new Map();    // stream id -> { until, value: { now, next } }
let all = null, allLoading = null;

async function refresh(force) {
    clearTimeout(timer);
    if (!running) return;
    try {
        if (st.state !== 'connected') setState('connecting');
        if (force || !st.server || Date.now() - infoAt > INFO_MS) { st.server = await xt.info(); infoAt = Date.now(); }
        if (force || !cats.length || Date.now() - catsAt > CATS_MS) {
            cats = (await xt.categories()).map((c) => ({ id: c.id, name: ascii(LANGS.latin(c.name)) }));
            catsAt = Date.now();
            st.categories = cats.length;
            log(cats.length + ' categories');
            send({ ev: 'categories', at: catsAt, categories: cats });
        }
        backoff = RETRY_MIN;
        st.retries = 0;
        // every channel for search, loaded quietly once connected (about 15 s on a large account): the first search is then instant
        if (st.state !== 'connected' && !all && !allLoading) setTimeout(() => { if (running && !all) everything().catch((e) => log('search list: ' + e.message)); }, 20000);
        if (st.state !== 'connected') setState('connected'); else status();
        timer = setTimeout(() => refresh(false), INFO_MS);
    } catch (e) {
        if (!running) return;
        st.retries++;
        setState(e.code === 'EAUTH' ? 'refused' : 'error', e.message);
        log('server: ' + e.message + ' (again in ' + Math.round(backoff / 1000) + ' s)');
        timer = setTimeout(() => refresh(true), backoff);
        backoff = Math.min(60000, backoff * 2);
    }
}
function forget() { cats = []; catsAt = 0; infoAt = 0; lists.clear(); nowKept.clear(); all = null; }
function run(account) {
    xt.use(account);
    running = true;
    st.server = null;
    forget();
    refresh(true);
}
function stop() { running = false; clearTimeout(timer); pb.stop(); fm.stop(); vodKept.clear(); Object.keys(vodIndex).forEach((k) => { delete vodIndex[k]; }); }

const view = (c) => ({ id: c.id, name: ascii(c.name), icon: c.icon, cat: c.cat, num: c.num, hevc: c.hevc });

async function channelsOf(cat) {
    const k = lists.get(cat);
    if (k && Date.now() - k.at < LIST_MS) return k.channels;
    const list = (await xt.channels(cat)).map(view);
    lists.set(cat, { at: Date.now(), channels: list });
    if (lists.size > 40) lists.delete(lists.keys().next().value);
    return list;
}
function everything() {
    if (all && Date.now() - all.at < ALL_MS) return Promise.resolve(all.channels);
    if (!allLoading) {
        log('loading every channel for search');
        allLoading = xt.allChannels().then((list) => {
            const chans = list.map(view);
            chans.forEach((c) => { c.key = c.name.toLowerCase(); });
            all = { at: Date.now(), channels: chans };
            log(chans.length + ' channels for search');
            allLoading = null;
            return chans;
        }, (e) => { allLoading = null; throw e; });
    }
    return allLoading;
}
async function search(q) {
    return rank(await everything(), q, 80).map(view);
}
/** list entries ({ key: lowercase ASCII name, name }) matching every word of q, best first, n at most */
function rank(list, q, n) {
    const words = ascii(q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    // whole words first ("rds" finds RDS before Thunderbirds), then a name that starts with them, then anywhere
    const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const whole = words.map((w) => new RegExp('(^|[^a-z0-9])' + esc(w) + '($|[^a-z0-9])'));
    const hits = [];
    for (let i = 0; i < list.length; i++) {
        const k = list[i].key;
        if (!words.every((w) => k.indexOf(w) >= 0)) continue;
        const rank = whole.every((re) => re.test(k)) ? (whole[0].test(k.replace(/^\s*[a-z]{2,4}\s+/, '').slice(0, words[0].length + 1)) ? 0 : 1) : 2;
        hits.push({ c: list[i], rank });
    }
    hits.sort((x, y) => x.rank - y.rank || x.c.name.length - y.c.name.length);
    return hits.slice(0, n).map((h) => h.c);
}
/* every film or every series of the account, for search: indexed category by category in the background (an
   account's whole list in one answer is tens of megabytes: on the car it took minutes and could pass ALL_MAX), two
   categories at a time; a search answers from what is indexed so far, with the progress, and the app asks again
   until it is complete. Kept 6 hours. Lean: the service, the client and the player share 256 MiB (the unit's
   MemoryLimit; 0.2.2 indexed all 207 categories of the owner's account, with a second copy for browsing, while a
   film played: the client was likely killed). So only what search shows is kept, nothing twice, and the indexing
   waits while something plays (memory and the car's internet are the film's). */
/** a film's or a series' title for the app (ASCII: the kit's fonts); one in Arabic script would be blank */
const titleOf = (n) => ascii(n).replace(/\s+/g, ' ').trim() || '(Arabic title)';
const vodIndex = {};   // '<movies|series>:<langs>' -> { items: Map id -> item, done, total, at, running, error }
const INDEX_MS = 6 * 3600000;
const INDEX_MAX = 60000;          // entries: about 15 MiB at most
const PLAYING_STATES = ['loading', 'playing', 'buffering'];
const playingNow = () => PLAYING_STATES.indexOf((fm.active() ? fm.status() : pb.status()).state) >= 0;
function indexOf(kind, langs) {
    const key = kind + ':' + langs;
    let ix = vodIndex[key];
    if (ix && (ix.running || (ix.at && Date.now() - ix.at < INDEX_MS) || (ix.error && Date.now() - ix.failedAt < 30000))) return ix;
    ix = vodIndex[key] = { items: new Map(), done: 0, total: 0, at: 0, running: true, error: null, failedAt: 0 };
    const cats = kind === 'series' ? xt.seriesCategories() : xt.filmCategories();
    cats.then(async (all) => {
        const list = all.filter((c) => LANGS.kept(c.name, langs));   // the owner's languages only (langs.js)
        ix.total = list.length;
        let next = 0;
        const worker = async () => {
            while (next < list.length && vodIndex[key] === ix) {
                while (playingNow() && vodIndex[key] === ix) await new Promise((r) => setTimeout(r, 3000));
                const c = list[next++];
                try {
                    const items = await (kind === 'series' ? xt.series(c.id) : xt.films(c.id));
                    items.forEach((x) => {
                        if (ix.items.size >= INDEX_MAX) return;
                        if (langs !== 'all' && LANGS.is3D(x.name)) return;   // a 3D release: two pictures side by side
                        const name = titleOf(x.name);
                        ix.items.set(x.id, { id: x.id, name, key: name.toLowerCase(), poster: x.poster, year: x.year, rating: x.rating, ext: x.ext, hevc: !!x.hevc });
                    });
                } catch (e) { log(kind + ' index: ' + c.id + ': ' + e.message); }
                ix.done++;
            }
        };
        await Promise.all([worker(), worker()]);
        ix.running = false; ix.at = Date.now();
        log(kind + ' index: ' + ix.items.size + ' in ' + ix.total + ' categories');
    }).catch((e) => { ix.running = false; ix.error = e.message; ix.failedAt = Date.now(); log(kind + ' index: ' + e.message); });
    return ix;
}
let lastLangs = 'all';   // 0.3.7: the languages the app last searched in (its setting): the HD-version search uses that index
/* 0.3.7: a 4K HDR film's other versions. A title as the account writes it ("EN The Hobbit An Unexpected Journey - 2012
 * [4K]") -> its language ("EN") and a key without the language, tags, quality words and year; the same key and year
 * in another entry is the same film. Best first: the same language, 1080p / FHD, 720p, then any; never a 4K / UHD /
 * HDR / 10-bit one, nor one already tried. Answers from the films index (search's), which it waits for (built with
 * nothing playing), at most 4 minutes. */
const UHD = /\b(4k|uhd|2160p?|hdr10\+?|hdr|dolby ?vision|dovi|10 ?bits?)\b/i;
const QWORDS = /\b(4k|uhd|2160p?|1080p?|720p?|480p?|fhd|hd|sd|hdr10\+?|hdr|dv|dolby ?vision|dovi|hevc|h ?26[45]|x26[45]|10 ?bits?|remux|bluray|web ?dl|webrip|multi ?subs?|multi|vostfr|subbed|dubbed|imax|extended|remastered)\b/g;
function langOf(name) { const m = /^\s*[\[|(]?\s*([A-Z]{2,3})\b/.exec(String(name || '')); return m ? m[1] : ''; }
function altKey(name) {
    let s = String(name || '').replace(/^\s*[\[|(]?\s*[A-Z]{2,3}\s*[\]|)]?\s*[-:|]?\s+/, '');
    s = s.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\b(19|20)\d\d\b/g, ' ').replace(/[._]/g, ' ');
    s = s.replace(QWORDS, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
    return s;
}
function bestAlt(items, film, tried) {
    const key = altKey(film.name), lang = langOf(film.name), year = (/\b(19|20)\d\d\b/.exec(film.name) || [])[0];
    if (!key) return null;
    let best = null, bestScore = -1;
    items.forEach((x) => {
        if (tried.indexOf(x.id) >= 0 || UHD.test(x.name) || altKey(x.name) !== key) return;
        if (year && x.year && String(x.year) !== year) return;
        const score = (langOf(x.name) === lang ? 10 : 0) + (/1080|fhd/i.test(x.name) ? 4 : /720/.test(x.name) ? 2 : 1) - (x.hevc ? 1 : 0);
        if (score > bestScore) { best = x; bestScore = score; }
    });
    return best;
}
async function hdVersionOf(film, tried, progress) {
    const t0 = Date.now();
    for (;;) {
        const ix = indexOf('movies', lastLangs);
        if (ix.error && !ix.items.size) throw new Error(ix.error);
        const items = Array.from(ix.items.values());
        const found = bestAlt(items, film, tried || []);
        if (found || !ix.running) return found;
        if (Date.now() - t0 > 240000) return found;
        if (progress) progress(ix.done + ' of ' + (ix.total || '?') + ' categories');
        await new Promise((r) => setTimeout(r, 2000));
    }
}
function vodSearch(kind, q, langs) {
    if (LANGS.SETS[langs]) lastLangs = langs;
    const ix = indexOf(kind === 'series' ? 'series' : 'movies', LANGS.SETS[langs] ? langs : 'all');
    if (ix.error && !ix.items.size) return Promise.reject(new Error(ix.error));
    const items = rank(Array.from(ix.items.values()), q, 60).map((x) => { const v = Object.assign({}, x); delete v.key; return v; });
    return Promise.resolve({ items, done: ix.done, total: ix.total, complete: !ix.running });
}
/** what is on now and next, per channel: asked 4 at a time, kept until the programme on now ends */
async function nowOf(ids) {
    const t = Date.now() / 1000, out = {};
    const todo = [];
    (Array.isArray(ids) ? ids : []).slice(0, 30).map(String).filter((id) => /^\d+$/.test(id)).forEach((id) => {
        const k = nowKept.get(id);
        if (k && k.until > t) out[id] = k.value; else todo.push(id);
    });
    const pick = (x) => (x ? { title: ascii(x.title), start: x.start, stop: x.stop, isNew: !!x.isNew } : null);
    for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map((id) => xt.shortEpg(id, 3).then((list) => {
            const cur = list.filter((x) => x.start <= t && x.stop > t)[0] || null;
            const next = list.filter((x) => (cur ? x.start >= cur.stop : x.start > t))[0] || null;
            const value = { now: pick(cur), next: pick(next) };
            nowKept.set(id, { until: cur ? cur.stop : t + 600, value });
            out[id] = value;
        }, () => { out[id] = { now: null, next: null, error: true }; })));
    }
    if (nowKept.size > 2000) nowKept.clear();
    return out;
}
async function guide(sid) {
    if (!/^\d+$/.test(sid)) throw new Error('not a channel');
    const list = await xt.shortEpg(sid, 24);
    return list.map((x) => ({ start: x.start, stop: x.stop, title: ascii(x.title), text: ascii(x.text), isNew: !!x.isNew }));
}
const vodKept = new Map();   // films and series lists and details, 10 minutes
function answer(m) {
    const reply = (p) => p.then((value) => send({ ev: 'answer', id: m.id, ok: true, value }), (e) => send({ ev: 'answer', id: m.id, ok: false, error: e.message }));
    if (!xt.account()) return reply(Promise.reject(new Error('not signed in')));
    if (m.what === 'channels') return reply(channelsOf(String(m.cat || '')));
    if (m.what === 'search') return reply(search(String(m.q || '')));
    if (m.what === 'now') return reply(nowOf(m.ids));
    if (m.what === 'epg') return reply(guide(String(m.sid || '')));
    if (m.what === 'logo') return reply(xt.logo(m.icon).then((b) => b.toString('base64')));
    // films and series: names, plots and titles in ASCII (the kit's fonts), lists kept 10 minutes
    const A = (x) => Object.assign({}, x, x.name != null ? { name: titleOf(x.name) } : {}, x.title != null ? { title: ascii(x.title) } : {},
        x.plot != null ? { plot: ascii(x.plot) } : {}, x.genre != null ? { genre: ascii(x.genre) } : {});
    const kept = (key, fn) => { const k = vodKept.get(key); if (k && Date.now() - k.at < 600000) return Promise.resolve(k.v);
        return fn().then((v) => { vodKept.set(key, { at: Date.now(), v }); if (vodKept.size > 200) vodKept.clear(); return v; }); };
    const cats = (l) => l.map((c) => ({ id: c.id, name: ascii(LANGS.latin(c.name)) }));
    if (m.what === 'vod-search') return reply(vodSearch(String(m.kind || ''), String(m.q || ''), String(m.langs || 'all')));
    if (m.what === 'film-cats') return reply(kept('fc', () => xt.filmCategories().then(cats)));
    if (m.what === 'films') return reply(kept('f:' + m.cat, () => xt.films(String(m.cat || '')).then((l) => l.map(A))));
    if (m.what === 'film-info') return reply(kept('fi:' + m.vid, () => xt.filmInfo(String(m.vid || '')).then(A)));
    if (m.what === 'series-cats') return reply(kept('sc', () => xt.seriesCategories().then(cats)));
    if (m.what === 'series') return reply(kept('s:' + m.cat, () => xt.series(String(m.cat || '')).then((l) => l.map(A))));
    if (m.what === 'series-info') return reply(kept('si:' + m.vid, () => xt.seriesInfo(String(m.vid || '')).then((v) =>
        Object.assign(A(v), { seasons: v.seasons.map((x) => ({ n: x.n, episodes: x.episodes.map(A) })) }))));
    return reply(Promise.reject(new Error('unknown question')));
}

process.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.op === 'run') run(m.account);
    else if (m.op === 'stop') stop();
    else if (m.op === 'refresh') refresh(true);
    else if (m.op === 'player') { if (fm.owns(m.id)) fm.onPlayer(m.id, m.ev); else pb.onPlayer(m.id, m.ev); if (m.ev && m.ev.ev !== 'tick') playbackStatus(); }
    else if (m.op === 'play') { fm.stop(); pb.play(m.channel); playbackStatus(); }
    else if (m.op === 'playback-stop') { fm.stop(); pb.stop(); playbackStatus(); }
    else if (m.op === 'prefs') { lastPrefs = m.prefs; pb.setPrefs(m.prefs); playbackStatus(); }
    else if (m.op === 'film-play' && m.film) { pb.stop(); fm.play(m.film); playbackStatus(); }
    else if (m.op === 'film-seek') { fm.seek(m.pos); playbackStatus(); }
    else if (m.op === 'film-pause') { fm.pause(); playbackStatus(); }
    else if (m.op === 'film-resume') { fm.resume(); playbackStatus(); }
    else if (m.op === 'ask') answer(m);
    else if (m.op === 'signout') { stop(); xt.use(null); forget(); setState('signed-out'); send({ ev: 'signed-out', why: 'signed out' }); }
    else if (m.op === 'signin') {
        xt.signIn(m.server, m.user, m.password)
            .then((account) => send({ ev: 'signin', id: m.id, ok: true, account }))
            .catch((e) => send({ ev: 'signin', id: m.id, ok: false, error: e.message }));
    }
});
// the parent went: so do we (a message sent as it went fails with EPIPE: nothing to report it to)
process.on('disconnect', () => { stop(); process.exit(0); });
process.on('error', () => { stop(); process.exit(0); });
send({ ev: 'ready', uid: process.getuid ? process.getuid() : null });
