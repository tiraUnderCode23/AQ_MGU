'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * jellyfin.js - what the Drivefin service asks a Jellyfin server, over HTTP(S) with JSON answers.
 *
 *   const jf = createJellyfin({ nx, log, device: { id, name, version } });
 *
 * Before a sign-in (no token):
 *   jf.find(text)                  -> { url, id, name, version, quick }   the server at the address the owner typed
 *   jf.quickStart(url)             -> { secret, code, expires }           Quick Connect: six digits to enter in Jellyfin
 *   jf.quickCheck(url, secret)     -> true once the owner has entered them
 *   jf.quickAuth(url, secret)      -> { token, userId, user, serverId }
 *   jf.login(url, name, password)  -> the same (the password is sent once and kept nowhere)
 *
 * The server (after jf.use({ url, token, userId })):
 *   jf.me()                                       -> { name, id }
 *   jf.info()                                     -> { id, name, version }
 *   jf.logout()                                   -> the server forgets this sign-in's token
 *   jf.sections()                                 -> [{ key, title, type }]   (movie, show and mixed libraries)
 *   jf.onDeck(n) / jf.recentlyAdded(n)            -> [item]
 *   jf.sectionItems(key, { type, sort, unwatched, start, size }) -> { total, start, items }
 *   jf.children(key, of)                          -> [item]  (a show's seasons; with `of` = the show: a season's episodes)
 *   jf.nextEpisode(showKey, episodeKey)           -> item or null
 *   jf.meta(key)                                  -> item with its media (versions, sound and subtitle tracks)
 *   jf.search(q, n)                               -> [item]
 *   jf.image(path, w, h)                          -> Buffer (JPEG)
 *   jf.setPlayed(key, watched)                    -> marks it watched / unwatched
 *   jf.playback({ key, sourceId, offset, quality, audio, subtitle }) -> { ok, text, url, session, sourceId, how }
 *   jf.report(kind, { key, sourceId, session, time, paused, audio, subtitle })   kind: start | progress | stopped
 *   jf.ping(session) / jf.stopEncoding(session)
 *   jf.headers()                                  -> the request headers of the server in use (for hls.js)
 *   jf.cleanUrl(url)                              -> the address without a token in it
 *
 * An item, as the app gets it (seconds, not Jellyfin's ticks): { key, type (movie | show | season | episode), title,
 * year, thumb, art, duration, viewOffset, viewCount, leafCount, viewedLeafCount, index, parentIndex, parentKey,
 * parentTitle, grandparentKey, grandparentTitle, summary, rating, contentRating, addedAt, childCount }. thumb and art
 * are what jf.image takes: /Items/<id>/Images/<kind>?tag=<tag>.
 *
 * The addresses are those of Jellyfin's API as its OpenAPI description has them (10.9 and later). Four of them had
 * another address before (a user's views, resume list, latest items and played mark): a server that answers 404 to
 * the new one is asked at the old one, once, and from then on.
 *
 * Errors carry .code: EAUTH (the token is refused: sign in again), ELOGIN (a wrong name or password), EOFFLINE (no
 * internet), ECERT (the server's certificate is not trusted), EHTTP (.status).
 * The token goes in the Authorization header only, never in an address, and nothing here logs it.
 *
 * Plain Node 8: no ?. ?? object spread or optional catch binding.
 */
const qs = require('querystring');

const CLIENT = 'Drivefin';
const TICKS = 10000000;         // Jellyfin counts time in 100 ns
const QUICK_MS = 10 * 60000;    // a Quick Connect code's life on the server
const TYPES = { Movie: 'movie', Series: 'show', Season: 'season', Episode: 'episode' };
const SORTS = {
    title: ['SortName', 'Ascending'],
    added: ['DateCreated,SortName', 'Descending,Ascending'],
    year: ['ProductionYear,SortName', 'Descending,Ascending'],
    viewed: ['DatePlayed,SortName', 'Descending,Ascending'],
};
/** the picture the server is asked for: the largest size and the whole stream's bitrate; original: the film's own H.264 where it fits */
const QUALITIES = {
    original: { label: 'Original', w: 1920, h: 1080, kbps: 20000 },
    '1080': { label: '1080p, 8 Mbit/s', w: 1920, h: 1080, kbps: 8000 },
    '720': { label: '720p, 4 Mbit/s', w: 1280, h: 720, kbps: 4000 },
    '720low': { label: '720p, 2 Mbit/s', w: 1280, h: 720, kbps: 2000 },
    '480': { label: '480p, 1.5 Mbit/s', w: 854, h: 480, kbps: 1500 },
    '360': { label: '360p, 0.7 Mbit/s', w: 640, h: 360, kbps: 720 },
};
const DEFAULT_QUALITY = '720';
const LIST_FIELDS = 'DateCreated,ChildCount,RecursiveItemCount';
const KEY = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const IMAGE = /^\/Items\/([0-9a-f-]{32,36})\/Images\/(Primary|Backdrop|Thumb)(?:\?tag=([A-Za-z0-9]{1,64}))?$/;
/** why a film is converted, where it means its picture is made anew (any other reason: the picture is passed on as it is) */
const PICTURE_REASON = /^(Video|RefFrames|Anamorphic|Interlaced|Subtitle|ContainerBitrate|UnknownVideo|StreamCount)/;

const num = (v) => { const n = Number(v); return v != null && isFinite(n) ? n : null; };
const secs = (ticks) => { const n = num(ticks); return n === null ? null : Math.round(n / (TICKS / 10)) / 10; };
const isKey = (k) => KEY.test(String(k));
const img = (id, kind, tag) => (id && tag && /^[A-Za-z0-9]{1,64}$/.test(String(tag)) ? '/Items/' + id + '/Images/' + kind + '?tag=' + tag : null);
const plain = (s) => String(s == null ? '' : s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]{1,80}>/g, '').replace(/\s+/g, ' ').trim();

/** a library item for the app */
function view(m) {
    if (!m || !m.Id || !TYPES[m.Type]) return null;
    const ud = m.UserData || {};
    const it = {
        key: String(m.Id), type: TYPES[m.Type], title: String(m.Name || ''),
        year: num(m.ProductionYear) || (m.PremiereDate ? num(String(m.PremiereDate).slice(0, 4)) : null),
        thumb: img(m.Id, 'Primary', m.ImageTags && m.ImageTags.Primary),
        art: (m.BackdropImageTags || []).length ? img(m.Id, 'Backdrop', m.BackdropImageTags[0])
            : (m.ParentBackdropImageTags || []).length ? img(m.ParentBackdropItemId, 'Backdrop', m.ParentBackdropImageTags[0]) : null,
        duration: secs(m.RunTimeTicks), viewOffset: secs(ud.PlaybackPositionTicks) || 0,
        viewCount: ud.Played ? Math.max(1, num(ud.PlayCount) || 0) : 0,
        addedAt: m.DateCreated && isFinite(Date.parse(m.DateCreated)) ? Math.floor(Date.parse(m.DateCreated) / 1000) : null,
    };
    if (m.Type === 'Series' || m.Type === 'Season') {
        // how many episodes, and how many of them are watched (the server counts those not watched)
        const left = num(ud.UnplayedItemCount) || 0;
        const all = num(m.RecursiveItemCount) !== null ? num(m.RecursiveItemCount) : m.Type === 'Season' && num(m.ChildCount) !== null ? num(m.ChildCount) : left + (ud.Played ? 1 : 0);
        it.leafCount = Math.max(all, left); it.viewedLeafCount = it.leafCount - left;
        if (m.Type === 'Series' && num(m.ChildCount) !== null) it.childCount = num(m.ChildCount);
    }
    if (m.IndexNumber != null) it.index = num(m.IndexNumber);
    if (m.ParentIndexNumber != null) it.parentIndex = num(m.ParentIndexNumber);
    if (m.Type === 'Episode') {
        if (m.SeasonId) { it.parentKey = String(m.SeasonId); it.parentTitle = String(m.SeasonName || ''); }
        if (m.SeriesId) {
            it.grandparentKey = String(m.SeriesId); it.grandparentTitle = String(m.SeriesName || '');
            const t = img(m.SeriesId, 'Primary', m.SeriesPrimaryImageTag);
            if (t) it.grandparentThumb = t;
        }
    } else if (m.Type === 'Season' && m.SeriesId) {
        it.parentKey = String(m.SeriesId); it.parentTitle = String(m.SeriesName || '');
        const t = img(m.SeriesId, 'Primary', m.SeriesPrimaryImageTag);
        if (t) it.parentThumb = t;
    }
    if (m.Overview) it.summary = plain(m.Overview).slice(0, 1200);
    if (m.OfficialRating) it.contentRating = String(m.OfficialRating);
    const r = num(m.CommunityRating);
    if (r !== null) it.rating = Math.round(r * 10) / 10;
    return it;
}
const TRACK_NAME = (s) => String(s.DisplayTitle || s.Title || s.Language || s.Codec || '?').slice(0, 60);
/** 1080, 720, 4k ... of a picture, by its width (a wide film is less high than its name says) */
function resolution(w, h) {
    if (!w || !h) return '';
    return w >= 3800 ? '4k' : w >= 2500 ? '1440' : w >= 1900 ? '1080' : w >= 1260 ? '720' : w >= 840 ? '480' : String(h);
}
/** an item's versions and tracks, for the detail page: what the server would play and what can be chosen. A track's
 *  id is its number in the file, which is what the server is told when the film starts. */
function mediaOf(m) {
    return (m.MediaSources || []).map((src) => {
        const streams = src.MediaStreams || [];
        const of = (type) => streams.filter((s) => s.Type === type && num(s.Index) !== null);
        const v = of('Video')[0] || {}, sounds = of('Audio');
        const defA = num(src.DefaultAudioStreamIndex) !== null && sounds.some((s) => s.Index === src.DefaultAudioStreamIndex) ? src.DefaultAudioStreamIndex : (sounds[0] || {}).Index;
        const defS = num(src.DefaultSubtitleStreamIndex);
        const pick = (list, def) => list.map((s) => ({ id: String(s.Index), name: TRACK_NAME(s), codec: String(s.Codec || ''), selected: s.Index === def, lang: String(s.Language || '') }));
        const a = sounds.filter((s) => s.Index === defA)[0] || {};
        return {
            id: String(src.Id || ''), resolution: resolution(num(v.Width), num(v.Height)), videoCodec: String(v.Codec || ''), audioCodec: String(a.Codec || ''),
            container: String(src.Container || ''), kbps: num(src.Bitrate) !== null ? Math.round(src.Bitrate / 1000) : null, width: num(v.Width), height: num(v.Height),
            bitDepth: num(v.BitDepth), channels: num(a.Channels),
            audio: pick(sounds, defA), subtitles: pick(of('Subtitle'), defS),
        };
    });
}

/** the addresses to try for what the owner typed: as typed when it names http or https; else https before http, and
 *  Jellyfin's own port 8096 where none is given. [] when it is no address. */
function candidates(text) {
    const s = String(text || '').trim().replace(/\s+/g, '').replace(/\/+$/, '');
    if (!s || s.length > 200) return [];
    const m = /^(?:(https?):\/\/)?(\[[0-9a-f:]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?(\/[A-Za-z0-9._~\/-]*)?$/i.exec(s);
    if (!m || (m[4] && (Number(m[4]) < 1 || Number(m[4]) > 65535))) return [];
    const host = m[2].toLowerCase(), port = m[4] || '', path = m[5] || '';
    const at = (scheme, p) => scheme + '://' + host + (p ? ':' + p : '') + path;
    if (m[1]) return [at(m[1].toLowerCase(), port)];
    if (port) return port === '443' || port === '8920' ? [at('https', port), at('http', port)] : [at('http', port), at('https', port)];
    // a bare number is a server at home, which has no certificate for it
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host[0] === '[') return [at('http', '8096'), at('https', ''), at('http', '')];
    return [at('https', ''), at('http', '8096'), at('http', '')];
}

function createJellyfin(o) {
    const nx = o.nx, log = o.log || (() => {});
    const dev = Object.assign({ id: 'drivefin', name: 'BMW iDrive 7', version: '0.0.0' }, o.device || {});
    let srv = null;           // { url, token, userId }
    const older = {};         // an address this server only knows in its older form

    const word = (s) => String(s).replace(/[^\x20-\x7e]|["\\,]/g, '').slice(0, 60);
    const headers = (token) => ({
        Accept: 'application/json',
        Authorization: 'MediaBrowser Client="' + CLIENT + '", Device="' + word(dev.name) + '", DeviceId="' + word(dev.id) + '", Version="' + word(dev.version) + '"' +
            (token ? ', Token="' + String(token).replace(/[^\x21-\x7e]|["\\,]/g, '') + '"' : ''),
    });

    function fail(status, text) {
        const e = new Error(status === 401 ? 'the Jellyfin server refused the sign-in (401): sign in again'
            : status === 403 ? 'the server does not allow this (403)' + (text ? ': ' + text : '')
                : status === 404 ? 'not found on the server (404)'
                    : status === 503 ? 'the server is starting or not ready (503)'
                        : 'HTTP ' + status + ' from the server' + (text ? ': ' + text : ''));
        e.code = status === 401 ? 'EAUTH' : 'EHTTP';
        e.status = status;
        return e;
    }
    /** a short reason out of an error answer (JSON, a line of text or a page), with nothing secret in it */
    function reason(body) {
        const s = body ? body.toString('utf8', 0, 600) : '';
        const m = /"(?:title|detail|message|error)"\s*:\s*"([^"]{1,160})"/i.exec(s) || /<h1>([^<]{1,160})<\/h1>/.exec(s);
        if (m) return m[1];
        return /^[\x20-\x7e]{1,160}$/.test(s.trim()) && s.trim()[0] !== '{' && s.trim()[0] !== '<' ? s.trim() : '';
    }
    /** a connection that failed, in words the page can show */
    function wire(e) {
        if (!e || e.status) return e;
        const c = String(e.code || '');
        if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/.test(c)) return Object.assign(new Error('the server\'s certificate is not trusted (' + c.toLowerCase().replace(/_/g, ' ') + '): use one from a public authority, or http'), { code: 'ECERT' });
        if (c === 'ECONNREFUSED') return Object.assign(new Error('nothing answers at that address and port'), { code: c });
        if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return Object.assign(new Error('that name is not known (check the spelling)'), { code: c });
        if (c === 'EHOSTUNREACH' || c === 'ENETUNREACH') return Object.assign(new Error('that address cannot be reached from here'), { code: c });
        return e;
    }
    async function call(method, target, token, body, timeoutMs, maxBytes) {
        let r;
        try { r = await nx.request({ method, url: target, headers: headers(token), body, timeoutMs: timeoutMs || 15000, maxBytes }); }
        catch (e) { throw wire(e); }
        if (r.status < 200 || r.status >= 300) throw fail(r.status, reason(r.body));
        return r;
    }
    async function json(method, target, token, body, timeoutMs) {
        const r = await call(method, target, token, body, timeoutMs);
        if (!r.body.length) return {};
        try { return JSON.parse(r.body.toString('utf8')); }
        catch (e) { throw Object.assign(new Error('an answer that is not JSON'), { code: 'EFORMAT' }); }
    }

    /* ---------- before the sign-in: the server, Quick Connect, a name and password ---------- */
    /** the Jellyfin server at this address: { url, id, name, version }; a redirect to the same question elsewhere
     *  (http to https, another host) is followed once, and the address it leads to is the server's */
    async function probe(base, hop) {
        let r;
        // (3: netx follows no redirect, so the address the server wants is seen here)
        try { r = await nx.request({ url: base + '/System/Info/Public', headers: headers(null), timeoutMs: 8000, maxBytes: 65536 }, 3); }
        catch (e) { throw wire(e); }
        const loc = String(r.headers && r.headers.location || '');
        if (r.status >= 300 && r.status < 400 && !hop && /^https?:\/\/[^/]+.*\/System\/Info\/Public$/i.test(loc)) return probe(loc.replace(/\/System\/Info\/Public$/i, ''), 1);
        if (r.status !== 200) throw fail(r.status, reason(r.body));
        let j = null;
        try { j = JSON.parse(r.body.toString('utf8')); } catch (e) { /* not a Jellyfin server */ }
        if (!j || !j.Id || !j.Version) throw Object.assign(new Error('something answers there, but it is not a Jellyfin server'), { code: 'ENOTJF' });
        return { url: base, id: String(j.Id), name: String(j.ServerName || 'Jellyfin').slice(0, 60), version: String(j.Version).slice(0, 20) };
    }
    /**
     * The server for what the owner typed. Every address it may mean (candidates) is asked at once; the first in
     * their order that answers as a Jellyfin server wins, and one further down is taken once those before it failed
     * or had 3 s. Rejects with the first address's reason when none answers.
     */
    function find(text) {
        const list = candidates(text);
        if (!list.length) return Promise.reject(Object.assign(new Error('that is not an address: type it as in a browser, like jellyfin.example.com or 203.0.113.7:8096'), { code: 'EADDR' }));
        return new Promise((resolve, reject) => {
            const got = list.map(() => null);     // { ok } | { err }
            let done = false, timer = null, patient = true;
            const settle = () => {
                if (done) return;
                for (let i = 0; i < list.length; i++) {
                    if (got[i] && got[i].ok) { done = true; clearTimeout(timer); return quick(got[i].ok.url).then((q) => resolve(Object.assign({ quick: q }, got[i].ok)), reject); }
                    if (!got[i] && patient) return undefined;
                }
                if (got.every(Boolean)) { done = true; clearTimeout(timer); reject((got.filter((g) => g.err && g.err.code === 'ECERT')[0] || got[0]).err); }
                return undefined;
            };
            timer = setTimeout(() => { patient = false; settle(); }, 3000);
            list.forEach((u, i) => probe(u).then((ok) => { got[i] = { ok }; }, (err) => { got[i] = { err }; }).then(settle));
        });
    }
    /** is Quick Connect switched on there (a server that cannot say has none) */
    function quick(base) {
        return nx.request({ url: base + '/QuickConnect/Enabled', headers: headers(null), timeoutMs: 8000, maxBytes: 4096 })
            .then((r) => r.status === 200 && /^\s*true\s*$/i.test(r.body.toString('utf8')), () => false);
    }
    async function quickStart(base) {
        let j;
        try { j = await json('POST', base + '/QuickConnect/Initiate', null); }
        catch (e) {
            // before 10.9 this was a GET
            if (e.status === 405 || e.status === 404) j = await json('GET', base + '/QuickConnect/Initiate', null);
            else if (e.status === 401) throw Object.assign(new Error('Quick Connect is switched off on this server'), { code: 'ENOQUICK', status: 401 });
            else throw e;
        }
        if (!j || !j.Secret || !j.Code) throw new Error('the server gave no code');
        const at = j.DateAdded ? Date.parse(j.DateAdded) : NaN, now = Date.now();
        return { secret: String(j.Secret), code: String(j.Code), expires: isFinite(at) && Math.abs(at - now) < 5 * 60000 ? at + QUICK_MS : now + QUICK_MS };
    }
    /** (the secret is one of this request's own, made for it a moment ago; it is not the account's token) */
    async function quickCheck(base, secret) {
        const j = await json('GET', base + '/QuickConnect/Connect?' + qs.stringify({ secret: String(secret) }), null);
        return !!(j && j.Authenticated === true);
    }
    function signedIn(j) {
        if (!j || !j.AccessToken || !j.User || !j.User.Id) throw new Error('the server gave no sign-in');
        return { token: String(j.AccessToken), userId: String(j.User.Id), user: String(j.User.Name || 'Jellyfin user').slice(0, 60), serverId: j.ServerId ? String(j.ServerId) : null };
    }
    async function quickAuth(base, secret) { return signedIn(await json('POST', base + '/Users/AuthenticateWithQuickConnect', null, { Secret: String(secret) })); }
    async function login(base, name, password) {
        try { return signedIn(await json('POST', base + '/Users/AuthenticateByName', null, { Username: String(name), Pw: String(password) }, 20000)); }
        catch (e) {
            if (e.status === 401 || e.status === 403) throw Object.assign(new Error(e.status === 403 ? 'this user may not sign in here (disabled, or locked out)' : 'wrong name or password'), { code: 'ELOGIN', status: e.status });
            throw e;
        }
    }

    /* ---------- the server ---------- */
    function use(s) { srv = s && s.url && s.token ? { url: String(s.url).replace(/\/+$/, ''), token: String(s.token), userId: String(s.userId || '') } : null; for (const k in older) delete older[k]; }
    const need = () => { if (!srv) throw Object.assign(new Error('no server chosen'), { code: 'ENOSERVER' }); return srv; };
    const at = (p, params) => {
        const q = {};
        Object.keys(params || {}).forEach((k) => { if (params[k] !== undefined && params[k] !== null && params[k] !== '') q[k] = params[k]; });
        return need().url + p + (Object.keys(q).length ? (p.indexOf('?') >= 0 ? '&' : '?') + qs.stringify(q) : '');
    };
    const get = (p, params, timeoutMs) => json('GET', at(p, params), need().token, undefined, timeoutMs);
    /** asks at the address of today; a server that does not know it (404, 405) is asked at the one before, from then on */
    async function either(name, ask) {
        if (older[name]) return ask(true);
        try { return await ask(false); }
        catch (e) {
            if (e.status !== 404 && e.status !== 405) throw e;
            const v = await ask(true);
            older[name] = true;
            return v;
        }
    }
    const items = (c) => ((c && c.Items) || (Array.isArray(c) ? c : [])).map(view).filter(Boolean);
    const lists = (fields) => ({ Fields: fields, EnableImageTypes: 'Primary,Backdrop', ImageTypeLimit: 1, EnableUserData: true });

    async function me() {
        const j = await get('/Users/Me');
        return { name: String(j.Name || 'Jellyfin user').slice(0, 60), id: j.Id ? String(j.Id) : null };
    }
    async function info() {
        const j = await get('/System/Info/Public');
        return { id: String(j.Id || ''), name: String(j.ServerName || 'Jellyfin').slice(0, 60), version: String(j.Version || '').slice(0, 20) };
    }
    function logout() { return call('POST', at('/Sessions/Logout'), need().token, undefined, 8000).then(() => true, () => false); }

    async function sections() {
        const u = need().userId;
        const c = await either('views', (old) => (old ? get('/Users/' + u + '/Views') : get('/UserViews', { userId: u })));
        return ((c && c.Items) || []).map((d) => {
            const t = String(d.CollectionType || '').toLowerCase();
            const type = t === 'movies' ? 'movie' : t === 'tvshows' ? 'show' : (t === '' || t === 'unknown' || t === 'mixed') && d.Type === 'CollectionFolder' ? 'mixed' : null;
            return type && d.Id ? { key: String(d.Id), title: String(d.Name || ''), type } : null;
        }).filter(Boolean);
    }
    /** "continue watching": what was begun, then each show's next episode (a show once) */
    async function onDeck(n) {
        const u = need().userId, size = n || 24;
        const p = Object.assign({ Limit: size, MediaTypes: 'Video', EnableTotalRecordCount: false }, lists('DateCreated'));
        const r = await Promise.all([
            either('resume', (old) => (old ? get('/Users/' + u + '/Items/Resume', p) : get('/UserItems/Resume', Object.assign({ userId: u }, p)))),
            get('/Shows/NextUp', Object.assign({ userId: u, Limit: size, EnableTotalRecordCount: false, EnableResumable: false, EnableRewatching: false }, lists('DateCreated')))
                .then((v) => v, (e) => { log('next up: ' + e.message); return null; }),
        ]);
        const out = items(r[0]).filter((it) => it.type === 'movie' || it.type === 'episode');
        const shows = {};
        out.forEach((it) => { if (it.grandparentKey) shows[it.grandparentKey] = true; });
        items(r[1]).forEach((it) => { if (it.type === 'episode' && !shows[it.grandparentKey] && out.length < size) { shows[it.grandparentKey] = true; out.push(it); } });
        return out;
    }
    async function recentlyAdded(n) {
        const u = need().userId;
        const p = Object.assign({ Limit: n || 40, IncludeItemTypes: 'Movie,Episode', GroupItems: true }, lists(LIST_FIELDS));
        return items(await either('latest', (old) => (old ? get('/Users/' + u + '/Items/Latest', p) : get('/Items/Latest', Object.assign({ userId: u }, p)))));
    }
    async function sectionItems(key, q) {
        if (!isKey(key)) throw new Error('not a library');
        const o2 = q || {}, sort = SORTS[o2.sort] || SORTS.title;
        const p = Object.assign({
            userId: need().userId, ParentId: key, Recursive: true, IncludeItemTypes: o2.type === 'show' ? 'Series' : o2.type === 'mixed' ? 'Movie,Series' : 'Movie',
            SortBy: sort[0], SortOrder: sort[1], StartIndex: Math.max(0, num(o2.start) || 0), Limit: Math.max(1, Math.min(120, num(o2.size) || 60)),
            EnableTotalRecordCount: true, Filters: o2.unwatched ? 'IsUnplayed' : undefined,
        }, lists(o2.type === 'movie' ? 'DateCreated' : LIST_FIELDS));
        const c = await get('/Items', p, 30000);
        const list = items(c);
        return { total: num(c.TotalRecordCount) !== null ? num(c.TotalRecordCount) : p.StartIndex + list.length, start: p.StartIndex, items: list };
    }
    /** a show's seasons; with `of` (the show's key), the episodes of season `key`. Only what has a file. */
    async function children(key, of) {
        if (!isKey(key) || (of != null && !isKey(of))) throw new Error('not an item');
        const u = need().userId;
        if (of == null) return items(await get('/Shows/' + key + '/Seasons', Object.assign({ userId: u, isMissing: false }, lists(LIST_FIELDS)), 30000));
        return items(await get('/Shows/' + of + '/Episodes', Object.assign({ userId: u, seasonId: key, isMissing: false }, lists('Overview,DateCreated')), 30000));
    }
    /** the episode after this one, in the show's own order (the next season's first after a season's last) */
    async function nextEpisode(showKey, episodeKey) {
        if (!isKey(showKey) || !isKey(episodeKey)) return null;
        const list = items(await get('/Shows/' + showKey + '/Episodes', Object.assign({ userId: need().userId, startItemId: episodeKey, limit: 2, isMissing: false }, lists('DateCreated')), 30000));
        return list.length > 1 && list[0].key === String(episodeKey) ? list[1] : null;
    }
    async function meta(key) {
        if (!isKey(key)) throw new Error('not an item');
        const c = await get('/Items', Object.assign({ userId: need().userId, ids: key }, lists('Overview,Genres,Studios,MediaSources,' + LIST_FIELDS)));
        const m = ((c && c.Items) || [])[0];
        const it = view(m);
        if (!it) throw fail(404);
        it.media = mediaOf(m);
        it.genres = (m.Genres || []).map(String).slice(0, 4);
        if ((m.Studios || []).length && m.Studios[0].Name) it.studio = String(m.Studios[0].Name);
        return it;
    }
    async function search(q, n) {
        const p = Object.assign({ userId: need().userId, searchTerm: String(q || '').slice(0, 80), Recursive: true, IncludeItemTypes: 'Movie,Series,Episode', Limit: n || 24, EnableTotalRecordCount: false },
            lists('DateCreated'));
        const order = ['movie', 'show', 'episode'];
        // films, then shows, then episodes, each as the server ranked them
        return items(await get('/Items', p, 30000)).map((it, i) => ({ it, i })).sort((a, b) => (order.indexOf(a.it.type) - order.indexOf(b.it.type)) || (a.i - b.i)).map((x) => x.it);
    }
    /** a poster or a backdrop as a JPEG, scaled by the server to cover w x h at least (it does not make a small one larger) */
    async function image(p, w, h) {
        const m = IMAGE.exec(String(p || ''));
        if (!m) throw new Error('not a picture');
        const r = await call('GET', at('/Items/' + m[1] + '/Images/' + m[2], { fillWidth: Math.round(w), fillHeight: Math.round(h), quality: 90, format: 'Jpg', tag: m[3] }), need().token, undefined, 20000, 3 * 1024 * 1024);
        if (!r.body.length) throw new Error('an empty picture');
        return r.body;
    }
    async function setPlayed(key, watched) {
        if (!isKey(key)) throw new Error('not an item');
        const u = need().userId;
        await either('played', (old) => call(watched ? 'POST' : 'DELETE', old ? at('/Users/' + u + '/PlayedItems/' + key) : at('/UserPlayedItems/' + key, { userId: u }), need().token));
    }

    /* ---------- playing: the server's own choice of stream (PlaybackInfo), as HLS ---------- */
    /** what plays here (tvh-player): H.264, 8 bits, in MPEG-TS segments, with stereo AAC; the server makes everything else into it */
    function profile(q) {
        const max = (name, value) => ({ Condition: 'LessThanEqual', Property: name, Value: String(value), IsRequired: false });
        return {
            Name: CLIENT + ' (BMW iDrive 7)', MaxStreamingBitrate: q.kbps * 1000, MaxStaticBitrate: q.kbps * 1000,
            DirectPlayProfiles: [],              // no file plays here as it is
            TranscodingProfiles: [{ Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '2', MinSegments: 1,
                BreakOnNonKeyFrames: false, EnableSubtitlesInManifest: false }],
            CodecProfiles: [
                { Type: 'Video', Codec: 'h264', Conditions: [max('VideoBitDepth', 8), max('VideoLevel', 51), max('Width', q.w), max('Height', q.h),
                    { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'high|main|baseline|constrained baseline', IsRequired: false },
                    { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: 'SDR', IsRequired: false },
                    { Condition: 'NotEquals', Property: 'IsInterlaced', Value: 'true', IsRequired: false }] },
                { Type: 'VideoAudio', Codec: 'aac', Conditions: [max('AudioChannels', 2)] },
            ],
            ContainerProfiles: [],
            SubtitleProfiles: [],                // none can be shown beside the picture: a chosen one is drawn into it by the server
        };
    }
    const cleanUrl = (u) => {
        const s = String(u), i = s.indexOf('?');
        if (i < 0) return s;
        const kept = s.slice(i + 1).split('&').filter((p) => !/^(api_key|apikey|x-emby-token|token)=/i.test(p));
        return s.slice(0, i) + (kept.length ? '?' + kept.join('&') : '');
    };
    const REFUSED = { NotAllowed: 'this user may not play this (the server\'s playback permissions)', NoCompatibleStream: 'the server has no stream of this that plays here',
        RateLimitExceeded: 'the server is at its limit of streams: try again later' };
    /**
     * The server's word on playing this, and the stream it offers: resolves { ok, text } when it refuses, else
     * { ok, url (the HLS playlist, without a token), session, sourceId, how }. audio / subtitle: a track's number;
     * subtitle -1: none; left out: the server's own choice for this user.
     */
    async function playback(a) {
        if (!isKey(a.key)) throw new Error('not an item');
        const q = QUALITIES[a.quality] || QUALITIES[DEFAULT_QUALITY], s = need();
        const body = {
            UserId: s.userId, DeviceProfile: profile(q), MaxStreamingBitrate: q.kbps * 1000, StartTimeTicks: Math.max(0, Math.floor(a.offset || 0)) * TICKS,
            EnableDirectPlay: false, EnableDirectStream: false, EnableTranscoding: true, AllowVideoStreamCopy: true, AllowAudioStreamCopy: true,
            AutoOpenLiveStream: false, AlwaysBurnInSubtitleWhenTranscoding: true,
        };
        if (a.sourceId) body.MediaSourceId = String(a.sourceId);
        if (num(a.audio) !== null) body.AudioStreamIndex = num(a.audio);
        if (num(a.subtitle) !== null) body.SubtitleStreamIndex = num(a.subtitle);
        const j = await json('POST', at('/Items/' + a.key + '/PlaybackInfo', { userId: s.userId }), s.token, body, 30000);
        if (j.ErrorCode) return { ok: false, code: String(j.ErrorCode), text: REFUSED[j.ErrorCode] || 'the server cannot play this here (' + j.ErrorCode + ')' };
        const src = (j.MediaSources || []).filter((m) => m && m.TranscodingUrl)[0];
        if (!src) return { ok: false, code: 'NoStream', text: 'the server offers no converted stream of this (is transcoding allowed for this user?)' };
        const path = String(src.TranscodingUrl);
        if (String(src.TranscodingSubProtocol || '').toLowerCase() !== 'hls' && !/\.m3u8(\?|$)/i.test(path)) return { ok: false, code: 'NoHls', text: 'the server offers this only as a single file, not as HLS' };
        const why = (/[?&]TranscodeReasons=([^&]*)/i.exec(path) || [])[1];
        const reasons = why ? decodeURIComponent(why).split(',').filter(Boolean) : [];
        return {
            ok: true, url: cleanUrl(/^https?:\/\//i.test(path) ? path : s.url + (path[0] === '/' ? '' : '/') + path),
            session: j.PlaySessionId ? String(j.PlaySessionId) : null, sourceId: src.Id ? String(src.Id) : null,
            how: reasons.length && !reasons.some((r) => PICTURE_REASON.test(r)) ? 'direct stream' : 'transcode', reasons,
        };
    }
    /** where the film is, told to the server: it keeps the resume point and marks the film watched near its end, and
     *  keeps the conversion going while it hears of it. kind: start | progress | stopped */
    function report(kind, t) {
        const body = { ItemId: t.key, PositionTicks: Math.max(0, Math.round((t.time || 0) * TICKS)) };
        if (t.sourceId) body.MediaSourceId = t.sourceId;
        if (t.session) body.PlaySessionId = t.session;
        if (kind !== 'stopped') {
            Object.assign(body, { CanSeek: true, IsPaused: !!t.paused, IsMuted: false, PlayMethod: 'Transcode' });
            if (num(t.audio) !== null) body.AudioStreamIndex = num(t.audio);
            if (num(t.subtitle) !== null) body.SubtitleStreamIndex = num(t.subtitle);
        }
        const p = kind === 'start' ? '/Sessions/Playing' : kind === 'stopped' ? '/Sessions/Playing/Stopped' : '/Sessions/Playing/Progress';
        return call('POST', at(p), need().token, body, 8000).then(() => true, (e) => { log('report (' + kind + '): ' + e.message); return false; });
    }
    function ping(session) { return call('POST', at('/Sessions/Playing/Ping', { playSessionId: session }), need().token, undefined, 8000).then(() => true, () => false); }
    /** ends a conversion that is no longer read (a server without this address lets it go by itself after a minute) */
    function stopEncoding(session) {
        if (!session || !srv) return Promise.resolve(false);
        return call('DELETE', at('/Videos/ActiveEncodings', { deviceId: dev.id, playSessionId: session }), srv.token, undefined, 8000).then(() => true, () => false);
    }

    return {
        find, quickStart, quickCheck, quickAuth, login, use, server: () => (srv ? { url: srv.url } : null),
        headers: () => headers(need().token), cleanUrl,
        me, info, logout, sections, onDeck, recentlyAdded, sectionItems, children, nextEpisode, meta, search, image, setPlayed,
        profile, playback, report, ping, stopEncoding,
    };
}

module.exports = { createJellyfin, view, mediaOf, candidates, isKey, QUALITIES, DEFAULT_QUALITY, CLIENT, TICKS };
