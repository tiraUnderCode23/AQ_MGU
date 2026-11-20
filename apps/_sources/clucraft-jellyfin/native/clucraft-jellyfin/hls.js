'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * hls.js - one HLS stream (the Jellyfin server's conversion of a film) read into MPEG-TS for the player's stdin.
 *
 * tvh-player takes MPEG-TS on its stdin and has no HLS, TLS or account of its own, so this module (in the client,
 * the internet uid) reads the playlist and its segments from the server and hands their bytes on, one whole segment
 * at a time: a segment that failed half way is fetched again and never reaches the player in pieces.
 *
 *   const h = openHls({ nx, log, headers, clean, url, offset, duration, write(buf) -> bool, drain(fn), now });
 *     clean(url) -> url     every address read from a playlist goes through it (the session takes a token out of it)
 *   h.on('info', (i) => ...)    once: { mode, base, segments, seconds, endlist }
 *   h.on('end', () => ...)      every segment was handed on
 *   h.on('error', (e) => ...)   e.lost: the server no longer has the session (start a new one where the film was)
 *   h.stop()
 *   h.state()                   { index, segments, base, queuedBytes, queuedSeconds, bytes, done }
 *
 * Where the film starts. What the server's playlist lists is one of two things, and both are handled: every segment
 * of the film from its first second (a complete list, which is what Jellyfin sends: then reading starts at the
 * segment that holds `offset`, and `base` is that segment's own start), or only what follows `offset` (then reading
 * starts at the first one and `base` is `offset`). The film's position is `base` plus what the player has played.
 *
 * Read ahead: up to 24 MiB or 90 s are kept here for the player, so a weak patch of road is bridged without a pause.
 * A segment or playlist that fails is tried again (0.5 s, then doubling, for 60 s); 404 / 410 means the session is gone.
 *
 * Plain Node 8.
 */
const url = require('url');
const EventEmitter = require('events');

const AHEAD_BYTES = 24 * 1024 * 1024;
const AHEAD_SECONDS = 90;
const RETRY_FOR_MS = 60000;
const LIVE_STALL_MS = 90000;

/** an m3u8's text -> { master: [uri], segments: [{ uri, dur }], endlist, target, sequence } */
function parsePlaylist(text) {
    const out = { master: [], segments: [], endlist: false, target: 0, sequence: 0 };
    const lines = String(text || '').split(/\r?\n/);
    let dur = null, variant = false;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l) continue;
        if (l[0] === '#') {
            if (l.indexOf('#EXTINF:') === 0) dur = parseFloat(l.slice(8)) || 0;
            else if (l.indexOf('#EXT-X-STREAM-INF') === 0) variant = true;
            else if (l.indexOf('#EXT-X-ENDLIST') === 0) out.endlist = true;
            else if (l.indexOf('#EXT-X-TARGETDURATION:') === 0) out.target = parseFloat(l.slice(22)) || 0;
            else if (l.indexOf('#EXT-X-MEDIA-SEQUENCE:') === 0) out.sequence = parseInt(l.slice(22), 10) || 0;
            continue;
        }
        if (variant) { out.master.push(l); variant = false; }
        else if (dur !== null) { out.segments.push({ uri: l, dur }); dur = null; }
    }
    return out;
}

/** where reading starts: { index, base, mode } (see the header) */
function startAt(segments, offset, duration) {
    let total = 0;
    for (let i = 0; i < segments.length; i++) total += segments[i].dur;
    // the whole film, or only what follows the offset? whichever length the list's own is nearer to
    const whole = offset > 0 && duration > 0 && total >= duration - 20 && Math.abs(total - duration) < Math.abs(total - (duration - offset));
    if (!whole) return { index: 0, base: Math.max(0, offset || 0), mode: 'offset', seconds: total };
    let t = 0;
    for (let i = 0; i < segments.length; i++) {
        if (t + segments[i].dur > offset) return { index: i, base: t, mode: 'seek', seconds: total };
        t += segments[i].dur;
    }
    return { index: Math.max(0, segments.length - 1), base: Math.max(0, t - (segments.length ? segments[segments.length - 1].dur : 0)), mode: 'seek', seconds: total };
}

function openHls(o) {
    const ev = new EventEmitter();
    const nx = o.nx, log = o.log || (() => {}), now = o.now || Date.now;
    const hdr = () => Object.assign({}, typeof o.headers === 'function' ? o.headers() : (o.headers || {}), { Accept: '*/*' });
    const retryFor = o.retryForMs || RETRY_FOR_MS;
    const clean = typeof o.clean === 'function' ? o.clean : (u) => u;
    const st = { index: 0, segments: 0, base: 0, mode: null, queuedBytes: 0, queuedSeconds: 0, bytes: 0, done: false, endlist: false };
    let stopped = false, listUrl = null, segs = [], seq0 = 0, next = 0, target = 4;
    const queue = [];       // { buf, dur } fetched, not yet handed on
    let blocked = false, fetching = false, ended = false, timer = null;

    const wait = (ms) => new Promise((res) => { timer = setTimeout(res, ms); });
    function fail(e, lost) { if (stopped) return; stopped = true; clearTimeout(timer); if (lost) e.lost = true; ev.emit('error', e); }

    /** GET with retries: resolves the answer's body; 404 / 410 (after one more try) rejects with .lost */
    async function get(target2, what, maxBytes, timeoutMs) {
        const t0 = now();
        let delay = 500, gone = 0;
        for (;;) {
            if (stopped) throw Object.assign(new Error('stopped'), { stopped: true });
            let err = null;
            try {
                const r = await nx.request({ url: target2, headers: hdr(), timeoutMs: timeoutMs || 20000, maxBytes });
                if (r.status === 200) return r.body;
                err = Object.assign(new Error(what + ': HTTP ' + r.status), { status: r.status });
                if (r.status === 401 || r.status === 403) { err.code = 'EAUTH'; throw err; }
                if (r.status === 404 || r.status === 410 || r.status === 400) { if (++gone >= 2) { err.lost = true; throw err; } }
            } catch (e) {
                if (e.lost || e.code === 'EAUTH' || e.stopped) throw e;
                err = e;
            }
            if (now() - t0 > retryFor) throw err;
            log('hls: ' + err.message + ', again in ' + delay / 1000 + ' s');
            await wait(delay);
            delay = Math.min(8000, delay * 2);
        }
    }

    function add(list, sequence) {
        // a growing list: only what follows the last one known (by its sequence number)
        const from = Math.max(0, seq0 + segs.length - sequence);
        for (let i = from; i < list.length; i++) segs.push({ url: clean(url.resolve(listUrl, list[i].uri)), dur: list[i].dur });
        st.segments = segs.length;
    }

    /** hands what is queued to the player, as far as its pipe takes it */
    function pump() {
        while (!stopped && !blocked && queue.length) {
            const q = queue.shift();
            st.queuedBytes -= q.buf.length; st.queuedSeconds -= q.dur;
            if (!o.write(q.buf)) { blocked = true; o.drain(() => { blocked = false; pump(); }); }
        }
        if (stopped) return;
        if (ended && !queue.length && !blocked) { if (!st.done) { st.done = true; ev.emit('end'); } return; }
        // (only with room for more: fill ends by calling this, and with the queue full each would call the other for ever)
        if (!fetching && room()) fill();
    }
    const room = () => st.queuedBytes < AHEAD_BYTES && st.queuedSeconds < AHEAD_SECONDS;

    /** reads segments ahead of the player until enough is queued (pump starts it again as the queue empties) */
    async function fill() {
        if (fetching || stopped || ended) return;
        fetching = true;
        try {
            let lastNew = now();
            while (!stopped && room()) {
                if (next >= segs.length) {
                    if (st.endlist) { ended = true; break; }
                    // a list that still grows: read it again
                    await wait(Math.max(1000, Math.min(4000, target * 500)));
                    if (stopped) break;
                    const p = parsePlaylist((await get(listUrl, 'playlist', 4 * 1024 * 1024)).toString('utf8'));
                    const had = segs.length;
                    add(p.segments, p.sequence);
                    st.endlist = p.endlist;
                    if (segs.length > had) lastNew = now();
                    else if (now() - lastNew > LIVE_STALL_MS) throw new Error('the server stopped sending the film');
                    continue;
                }
                const s = segs[next];
                const buf = await get(s.url, 'segment ' + next, 96 * 1024 * 1024, 30000);
                if (stopped) break;
                next++; st.index = next;
                st.bytes += buf.length;
                queue.push({ buf, dur: s.dur });
                st.queuedBytes += buf.length; st.queuedSeconds += s.dur;
                lastNew = now();
                pump();   // (fetching is set: pump does not start a second reader)
            }
        } catch (e) {
            fetching = false;
            if (!e.stopped) fail(e, !!e.lost);
            return;
        }
        fetching = false;
        if (!stopped) pump();
    }

    (async () => {
        try {
            let text = (await get(o.url, 'the stream', 1024 * 1024, 45000)).toString('utf8');
            let p = parsePlaylist(text);
            listUrl = o.url;
            if (p.master.length) {
                listUrl = clean(url.resolve(o.url, p.master[0]));
                text = (await get(listUrl, 'playlist', 4 * 1024 * 1024, 45000)).toString('utf8');
                p = parsePlaylist(text);
            }
            if (stopped) return;
            if (!p.segments.length && p.endlist) throw new Error('the server sent an empty playlist');
            seq0 = p.sequence; target = p.target || 4;
            add(p.segments, p.sequence);
            st.endlist = p.endlist;
            const s = startAt(p.segments, o.offset || 0, o.duration || 0);
            next = s.index; st.index = next; st.base = s.base; st.mode = s.mode;
            log('hls: ' + p.segments.length + ' segments, ' + Math.round(s.seconds) + ' s' + (p.endlist ? ', complete' : ', growing') + ': ' +
                (s.mode === 'seek' ? 'from segment ' + s.index + ' (' + Math.round(s.base) + ' s)' : 'from its first (the film\'s ' + Math.round(s.base) + ' s)'));
            ev.emit('info', { mode: s.mode, base: s.base, segments: p.segments.length, seconds: s.seconds, endlist: p.endlist });
            fill();
        } catch (e) { if (!e.stopped) fail(e, !!e.lost); }
    })();

    ev.stop = () => { stopped = true; clearTimeout(timer); queue.length = 0; st.queuedBytes = 0; st.queuedSeconds = 0; };
    ev.state = () => Object.assign({}, st);
    return ev;
}

module.exports = { openHls, parsePlaylist, startAt, AHEAD_BYTES, AHEAD_SECONDS };
