'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * plex.js - what the Drive-In service asks plex.tv and a Plex Media Server, over HTTP(S) with JSON answers.
 *
 *   const px = createPlex({ nx, log, device: { id, name, version } });
 *
 * plex.tv (the account):
 *   px.pinCreate()            -> { id, code, expires }      the four characters typed at plex.tv/link
 *   px.pinCheck(id)           -> the account token once linked, else null
 *   px.user(token)            -> { name, id }
 *   px.servers(token)         -> [{ id, name, owned, token, connections: [{ uri, local, relay }] }]
 *   px.reach(server)          -> { uri, relay, local } of the first connection that answers (direct before relay)
 *
 * The server (after px.use({ uri, token })):
 *   px.sections()                                 -> [{ key, title, type }]   (movie and show libraries)
 *   px.onDeck(n) / px.recentlyAdded(n)            -> [item]
 *   px.sectionItems(key, { type, sort, unwatched, start, size }) -> { total, start, items }
 *   px.children(key)                              -> [item]  (a show's seasons, a season's episodes)
 *   px.meta(key)                                  -> item with its media (versions, parts, sound and subtitle tracks)
 *   px.search(q, n)                               -> [item]
 *   px.image(path, w, h)                          -> Buffer (JPEG)
 *   px.scrobble(key, watched)                     -> marks it watched / unwatched
 *   px.setStreams(partId, { audio, subtitle })    -> the tracks the server uses for this account from now on
 *   px.transcodeArgs(o) / px.decision(args) / px.masterUrl(args) / px.stopTranscode(session) / px.ping(session)
 *   px.timeline({ key, state, time, duration, session })
 *   px.headers()                                  -> the request headers of the server in use (for hls.js)
 *
 * An item, as the app gets it (seconds, not Plex's milliseconds): { key, type, title, year, thumb, art, duration,
 * viewOffset, viewCount, leafCount, viewedLeafCount, index, parentIndex, parentKey, parentTitle, grandparentKey,
 * grandparentTitle, summary, rating, contentRating, addedAt, childCount }.
 *
 * Errors carry .code: EAUTH (the token is refused: sign in again), EOFFLINE (no internet), EHTTP (.status).
 * The token goes in a request header only, never in an address, and nothing here logs it.
 *
 * Plain Node 8: no ?. ?? object spread or optional catch binding.
 */
const qs = require('querystring');

const PLEX_TV = 'https://plex.tv';
const PRODUCT = 'Drive-In for iDrive';
const TYPE_NUM = { movie: 1, show: 2, season: 3, episode: 4 };
const SORTS = { title: 'titleSort', added: 'addedAt:desc', year: 'year:desc', viewed: 'lastViewedAt:desc' };
/** what plays here (tvh-player): H.264, 8 bits, in an MPEG-TS, with AAC stereo; the server makes everything else into it */
const PROFILE_EXTRA = [
    'add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264&audioCodec=aac&replace=true)',
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.bitDepth&value=8&replace=true)',
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.level&value=51&replace=true)',
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.width&value=1920&replace=true)',
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.height&value=1080&replace=true)',
    'add-limitation(scope=videoAudioCodec&scopeName=aac&type=upperBound&name=audio.channels&value=2&replace=true)',
].join('+');
/** the picture the server is asked for: [label, width x height, kbit/s]; original: the film's own H.264 where it fits */
const QUALITIES = {
    original: { label: 'Original', res: '1920x1080', kbps: 20000 },
    '1080': { label: '1080p, 8 Mbit/s', res: '1920x1080', kbps: 8000 },
    '720': { label: '720p, 4 Mbit/s', res: '1280x720', kbps: 4000 },
    '720low': { label: '720p, 2 Mbit/s', res: '1280x720', kbps: 2000 },
    '480': { label: '480p, 1.5 Mbit/s', res: '854x480', kbps: 1500 },
    '360': { label: '360p, 0.7 Mbit/s', res: '640x360', kbps: 720 },
};
const DEFAULT_QUALITY = '720';

const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };
const secs = (ms) => { const n = num(ms); return n === null ? null : Math.round(n / 100) / 10; };

/** a library item for the app */
function view(m) {
    if (!m || m.ratingKey == null) return null;
    const it = {
        key: String(m.ratingKey), type: String(m.type || ''), title: String(m.title || ''),
        year: num(m.year) || (m.originallyAvailableAt ? num(String(m.originallyAvailableAt).slice(0, 4)) : null),
        thumb: m.thumb || null, art: m.art || null,
        duration: secs(m.duration), viewOffset: secs(m.viewOffset) || 0, viewCount: num(m.viewCount) || 0,
        addedAt: num(m.addedAt),
    };
    if (m.leafCount != null) { it.leafCount = num(m.leafCount) || 0; it.viewedLeafCount = num(m.viewedLeafCount) || 0; }
    if (m.childCount != null) it.childCount = num(m.childCount);
    if (m.index != null) it.index = num(m.index);
    if (m.parentIndex != null) it.parentIndex = num(m.parentIndex);
    if (m.parentRatingKey != null) { it.parentKey = String(m.parentRatingKey); it.parentTitle = String(m.parentTitle || ''); }
    if (m.grandparentRatingKey != null) { it.grandparentKey = String(m.grandparentRatingKey); it.grandparentTitle = String(m.grandparentTitle || ''); }
    if (m.parentThumb) it.parentThumb = m.parentThumb;
    if (m.grandparentThumb) it.grandparentThumb = m.grandparentThumb;
    if (m.summary) it.summary = String(m.summary).slice(0, 1200);
    if (m.contentRating) it.contentRating = String(m.contentRating);
    const r = num(m.audienceRating != null ? m.audienceRating : m.rating);
    if (r !== null) it.rating = Math.round(r * 10) / 10;
    if (m.librarySectionID != null) it.section = String(m.librarySectionID);
    return it;
}
const TRACK_NAME = (s) => String(s.extendedDisplayTitle || s.displayTitle || s.title || s.language || s.codec || '?').slice(0, 60);
/** an item's versions and tracks, for the detail page: what the server would play and what can be chosen */
function mediaOf(m) {
    return (m.Media || []).map((md) => {
        const part = (md.Part || [])[0] || {};
        const streams = part.Stream || [];
        const pick = (type) => streams.filter((s) => num(s.streamType) === type).map((s) => ({
            id: String(s.id), name: TRACK_NAME(s), codec: String(s.codec || ''), selected: !!s.selected, lang: String(s.languageCode || s.language || ''),
        }));
        const v = streams.filter((s) => num(s.streamType) === 1)[0] || {};
        return {
            id: String(md.id), partId: part.id != null ? String(part.id) : null,
            resolution: String(md.videoResolution || ''), videoCodec: String(md.videoCodec || ''), audioCodec: String(md.audioCodec || ''),
            container: String(md.container || part.container || ''), kbps: num(md.bitrate), width: num(md.width), height: num(md.height),
            bitDepth: num(v.bitDepth), channels: num(md.audioChannels),
            audio: pick(2), subtitles: pick(3),
        };
    });
}

function createPlex(o) {
    const nx = o.nx, log = o.log || (() => {});
    const dev = Object.assign({ id: 'drive-in', name: 'BMW iDrive 7', version: '0.0.0' }, o.device || {});
    let srv = null;   // { uri, token }
    const TV = String(o.tv || PLEX_TV).replace(/\/+$/, '');   // (o.tv: the tests' stand-in for plex.tv)

    const base = () => ({
        Accept: 'application/json',
        'X-Plex-Client-Identifier': dev.id,
        'X-Plex-Product': PRODUCT,
        'X-Plex-Version': dev.version,
        'X-Plex-Platform': 'Generic',
        'X-Plex-Platform-Version': '7',
        'X-Plex-Device': 'BMW iDrive 7',
        'X-Plex-Device-Name': dev.name,
        'X-Plex-Model': 'MGU',
        'X-Plex-Provides': 'player',
        'X-Plex-Language': 'en',
    });
    const headers = (token) => { const h = base(); if (token) h['X-Plex-Token'] = token; return h; };

    function fail(status, where, text) {
        const e = new Error(status === 401 ? 'Plex refused the sign-in (401): sign in again'
            : status === 403 ? 'the server refused this (403)' + (text ? ': ' + text : '')
                : status === 404 ? 'not found on the server (404)'
                    : 'HTTP ' + status + ' from ' + where + (text ? ': ' + text : ''));
        e.code = status === 401 ? 'EAUTH' : 'EHTTP';
        e.status = status;
        return e;
    }
    /** a short reason out of an error answer (Plex answers JSON, XML or a line of text), with nothing secret in it */
    function reason(body) {
        const s = body ? body.toString('utf8', 0, 600) : '';
        const m = /"(?:message|error)"\s*:\s*"([^"]{1,160})"/.exec(s) || /<h1>([^<]{1,160})<\/h1>/.exec(s) || /status="[^"]*"[^>]*>([^<]{1,160})</.exec(s);
        return m ? m[1] : '';
    }
    async function call(method, target, token, timeoutMs, maxBytes) {
        const where = target.indexOf(TV + '/api/') === 0 ? 'plex.tv' : 'the server';
        const r = await nx.request({ method, url: target, headers: headers(token), timeoutMs: timeoutMs || 15000, maxBytes });
        if (r.status < 200 || r.status >= 300) throw fail(r.status, where, reason(r.body));
        return r;
    }
    async function json(method, target, token, timeoutMs) {
        const r = await call(method, target, token, timeoutMs);
        if (!r.body.length) return {};
        try { return JSON.parse(r.body.toString('utf8')); }
        catch (e) { throw Object.assign(new Error('an answer that is not JSON'), { code: 'EFORMAT' }); }
    }

    /* ---------- plex.tv ---------- */
    async function pinCreate() {
        const j = await json('POST', TV + '/api/v2/pins', null);
        if (!j || j.id == null || !j.code) throw new Error('plex.tv gave no code');
        const exp = j.expiresAt ? Date.parse(j.expiresAt) : NaN;
        return { id: String(j.id), code: String(j.code).toUpperCase(), expires: isFinite(exp) ? exp : Date.now() + 15 * 60000 };
    }
    async function pinCheck(id) {
        if (!/^\d{1,20}$/.test(String(id))) throw new Error('not a code id');
        const j = await json('GET', TV + '/api/v2/pins/' + id, null);
        return j && j.authToken ? String(j.authToken) : null;
    }
    async function user(token) {
        const j = await json('GET', TV + '/api/v2/user', token);
        return { name: String(j.friendlyName || j.title || j.username || j.email || 'Plex account').slice(0, 60), id: j.id != null ? String(j.id) : null };
    }
    async function servers(token) {
        const list = await json('GET', TV + '/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=0', token);
        return (Array.isArray(list) ? list : []).filter((r) => String(r.provides || '').split(',').indexOf('server') >= 0).map((r) => ({
            id: String(r.clientIdentifier), name: String(r.name || 'Plex Media Server').slice(0, 60), owned: !!r.owned,
            // a server shared with this account has a token of its own
            token: String(r.accessToken || token), online: r.presence !== false,
            connections: (r.connections || []).filter((c) => c && /^https?:\/\//.test(String(c.uri || ''))).map((c) => ({ uri: String(c.uri).replace(/\/+$/, ''), local: !!c.local, relay: !!c.relay })),
        }));
    }
    /**
     * The connection to use: every address is asked for /identity at once (a car is never on the server's own network,
     * but its address may still answer through a VPN); the first that answers wins within its kind: a direct address
     * before Plex's relay (which is slow: 1-2 Mbit/s). Rejects when none answers.
     */
    function reach(server, timeoutMs) {
        const cons = (server.connections || []).slice(0, 12);
        if (!cons.length) return Promise.reject(new Error('plex.tv lists no address for ' + server.name));
        const rank = (c) => (c.relay ? 2 : c.local ? 1 : 0);
        return new Promise((resolve, reject) => {
            const ok = [];
            let left = cons.length, done = false, lastErr = null, timer = null;
            const settle = () => {
                if (done) return;
                if (ok.length && (left === 0 || ok.some((c) => rank(c) === 0))) {
                    done = true; clearTimeout(timer);
                    ok.sort((a, b) => rank(a) - rank(b));
                    resolve(ok[0]);
                } else if (left === 0) { done = true; clearTimeout(timer); reject(lastErr || new Error('the server did not answer')); }
            };
            // a relay that answered is taken once the direct addresses had 2.5 s
            timer = setTimeout(() => { if (!done && ok.length) { done = true; ok.sort((a, b) => rank(a) - rank(b)); resolve(ok[0]); } }, 2500);
            cons.forEach((c) => {
                nx.request({ url: c.uri + '/identity', headers: headers(null), timeoutMs: timeoutMs || 8000, maxBytes: 65536 }).then((r) => {
                    if (r.status === 200) ok.push(c); else lastErr = fail(r.status, 'the server');
                }, (e) => { lastErr = e; }).then(() => { left--; settle(); });
            });
        });
    }

    /* ---------- the server ---------- */
    function use(s) { srv = s && s.uri ? { uri: String(s.uri).replace(/\/+$/, ''), token: String(s.token || '') } : null; }
    const need = () => { if (!srv) throw Object.assign(new Error('no server chosen'), { code: 'ENOSERVER' }); return srv; };
    const at = (p, params) => need().uri + p + (params ? (p.indexOf('?') >= 0 ? '&' : '?') + qs.stringify(params) : '');
    async function mc(p, params, timeoutMs) {
        const j = await json('GET', at(p, params), need().token, timeoutMs);
        return (j && j.MediaContainer) || {};
    }
    const items = (c) => (c.Metadata || []).map(view).filter(Boolean);

    async function sections() {
        const c = await mc('/library/sections');
        return (c.Directory || []).filter((d) => d.type === 'movie' || d.type === 'show')
            .map((d) => ({ key: String(d.key), title: String(d.title || ''), type: d.type }));
    }
    async function onDeck(n) { return items(await mc('/library/onDeck', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': n || 24 })); }
    async function recentlyAdded(n) {
        const c = await mc('/library/recentlyAdded', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': n || 40 });
        return items(c).filter((it) => ['movie', 'show', 'season', 'episode'].indexOf(it.type) >= 0);
    }
    async function sectionItems(key, q) {
        if (!/^\d{1,9}$/.test(String(key))) throw new Error('not a library');
        const o2 = q || {};
        const type = TYPE_NUM[o2.type] || 1;
        const p = { type, sort: SORTS[o2.sort] || SORTS.title, 'X-Plex-Container-Start': Math.max(0, num(o2.start) || 0), 'X-Plex-Container-Size': Math.max(1, Math.min(120, num(o2.size) || 60)) };
        if (o2.unwatched) p[type === 2 ? 'unwatchedLeaves' : 'unwatched'] = 1;
        const c = await mc('/library/sections/' + key + '/all', p, 30000);
        const list = items(c);
        return { total: num(c.totalSize) != null ? num(c.totalSize) : (num(c.size) || list.length), start: p['X-Plex-Container-Start'], items: list };
    }
    const isKey = (k) => /^\d{1,12}$/.test(String(k));
    async function children(key) {
        if (!isKey(key)) throw new Error('not an item');
        return items(await mc('/library/metadata/' + key + '/children', null, 30000));
    }
    async function meta(key) {
        if (!isKey(key)) throw new Error('not an item');
        const c = await mc('/library/metadata/' + key);
        const m = (c.Metadata || [])[0];
        if (!m) throw fail(404, 'the server');
        const it = view(m);
        it.media = mediaOf(m);
        it.genres = (m.Genre || []).map((g) => String(g.tag)).slice(0, 4);
        if (m.studio) it.studio = String(m.studio);
        return it;
    }
    async function search(q, n) {
        const c = await mc('/hubs/search', { query: String(q || '').slice(0, 80), limit: n || 16, includeCollections: 0 }, 30000);
        const out = [];
        (c.Hub || []).forEach((h) => {
            if (['movie', 'show', 'episode'].indexOf(h.type) < 0) return;
            (h.Metadata || []).forEach((m) => { const it = view(m); if (it) out.push(it); });
        });
        return out;
    }
    /** a poster or a backdrop, scaled by the server (its photo transcoder answers JPEG) */
    async function image(p, w, h) {
        if (typeof p !== 'string' || p[0] !== '/' || p.length > 400) throw new Error('not a picture');
        const r = await call('GET', at('/photo/:/transcode', { width: Math.round(w), height: Math.round(h), minSize: 1, upscale: 1, url: p }), need().token, 20000, 2 * 1024 * 1024);
        if (!r.body.length) throw new Error('an empty picture');
        return r.body;
    }
    async function scrobble(key, watched) {
        if (!isKey(key)) throw new Error('not an item');
        await call('GET', at(watched ? '/:/scrobble' : '/:/unscrobble', { key, identifier: 'com.plexapp.plugins.library' }), need().token);
    }
    async function setStreams(partId, sel) {
        if (!isKey(partId)) throw new Error('not a part');
        const p = { allParts: 1 };
        if (sel && sel.audio != null && isKey(sel.audio)) p.audioStreamID = sel.audio;
        if (sel && sel.subtitle != null && (isKey(sel.subtitle) || String(sel.subtitle) === '0')) p.subtitleStreamID = sel.subtitle;
        await call('PUT', at('/library/parts/' + partId, p), need().token);
    }

    /* ---------- playing: the server's universal transcoder, as HLS ---------- */
    function transcodeArgs(a) {
        const q = QUALITIES[a.quality] || QUALITIES[DEFAULT_QUALITY];
        return {
            hasMDE: 1, path: '/library/metadata/' + a.key, mediaIndex: a.mediaIndex || 0, partIndex: 0, protocol: 'hls', fastSeek: 1,
            // directStream: a picture that already fits (H.264, 8 bits, within the size and bitrate asked) is passed on as it is
            directPlay: 0, directStream: 1, directStreamAudio: 0,
            videoResolution: q.res, maxVideoBitrate: q.kbps, videoQuality: 100, audioBoost: 100,
            subtitles: a.subtitles ? 'burn' : 'none', subtitleSize: 100, copyts: 1, offset: Math.max(0, Math.floor(a.offset || 0)),
            location: 'wan', session: a.session, 'X-Plex-Session-Identifier': a.sid,
            'X-Plex-Client-Profile-Name': 'generic', 'X-Plex-Client-Profile-Extra': PROFILE_EXTRA,
        };
    }
    /** the server's word on playing this: resolves { ok, text, video, audio } (direct stream / transcode per track) */
    async function decision(args) {
        const c = await mc('/video/:/transcode/universal/decision', args, 30000);
        const code = num(c.generalDecisionCode), tcode = num(c.transcodeDecisionCode);
        const text = String(c.transcodeDecisionText || c.generalDecisionText || c.mdeDecisionText || '');
        const media = (((c.Metadata || [])[0] || {}).Media || [])[0] || {};
        const streams = ((media.Part || [])[0] || {}).Stream || [];
        const how = (t) => { const s = streams.filter((x) => num(x.streamType) === t)[0]; return s ? String(s.decision || '') : ''; };
        // 1000: plays as it is, 1001: the server converts it; anything else is the server's refusal, in its words
        const ok = (code === 1000 || code === 1001 || code === null) && (tcode === null || tcode === 1000 || tcode === 1001);
        return { ok, code, text, video: how(1), audio: how(2) };
    }
    const masterUrl = (args) => at('/video/:/transcode/universal/start.m3u8', args);
    function stopTranscode(session) { return call('GET', at('/video/:/transcode/universal/stop', { session }), need().token, 8000).then(() => true, () => false); }
    function ping(session) { return call('GET', at('/video/:/transcode/universal/ping', { session }), need().token, 8000).then(() => true, () => false); }
    /** where the film is, told to the server: it keeps the resume point and marks the film watched near its end */
    function timeline(t) {
        const p = {
            ratingKey: t.key, key: '/library/metadata/' + t.key, identifier: 'com.plexapp.plugins.library', state: t.state, hasMDE: 1,
            time: Math.max(0, Math.round((t.time || 0) * 1000)), duration: Math.max(0, Math.round((t.duration || 0) * 1000)),
            'X-Plex-Session-Identifier': t.sid,
        };
        return call('GET', at('/:/timeline', p), need().token, 8000).then(() => true, (e) => { log('timeline: ' + e.message); return false; });
    }

    return {
        pinCreate, pinCheck, user, servers, reach, use, server: () => (srv ? { uri: srv.uri } : null),
        headers: () => headers(need().token),
        sections, onDeck, recentlyAdded, sectionItems, children, meta, search, image, scrobble, setStreams,
        transcodeArgs, decision, masterUrl, stopTranscode, ping, timeline,
    };
}

module.exports = { createPlex, view, mediaOf, QUALITIES, DEFAULT_QUALITY, PROFILE_EXTRA, PRODUCT };
