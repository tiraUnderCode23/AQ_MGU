'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * session.js - the film or episode that plays: the stream the Jellyfin server offers for it (jellyfin.js: playback),
 * read as HLS (hls.js) into the player's stdin, the player's state, where the film is, and what the server is told
 * about it (it keeps the resume point and marks the film watched near its end). Runs in the client (client.js, the
 * internet uid); the player (tvh-player, started by the root service) gets the stream through `sink`.
 *
 *   const ps = createSession({ jf, nx, log, sink, now });
 *   ps.play({ key, offset, quality, audio, subtitle })   another item, or the same one again, is a new stream and player
 *   ps.seek(seconds)  ps.pause()  ps.resume()  ps.stop()
 *   ps.setPrefs({ gain, even })
 *   ps.onPlayer(id, ev)     the player's events (open, decoder, audio, tick, end, error, exit), stream id first
 *   ps.status()             { state, error, item, pos, duration, quality, how, video, audioError, videoError, next, ... }
 *   sink: { start(id), data(id, buf) -> bool (false: wait for drain), end(id), drain(id, fn), ctl(id, line), stop(id) }
 *
 * States: idle, loading, playing, buffering, paused, ended, error.
 *
 * The tracks. audio / subtitle are a track's number in the file (subtitle -1: none), as the film's page lists them.
 * Left out, an episode takes the languages chosen for an earlier episode of its show while this service runs (the
 * next episode by itself keeps the sound and the subtitles), else the server's own choice for this user. A subtitle
 * is drawn into the picture by the server.
 *
 * A skip. The server's playlist lists the whole film, and the server converts from whichever segment is asked for:
 * a skip reads the same stream from the segment that holds the second wanted, with a new player. A stream that
 * breaks (the road, the server) is asked for anew where the film was, 4 times in 3 minutes at most. Pause stops the
 * player's clock; the server hears of it every 20 s, which keeps its conversion; after 15 minutes the stream is let
 * go and the server told the film stopped (resume then asks for a new one where the film was). The film's position
 * is the stream's base (hls.js) plus what the player has played of it.
 *
 * Plain Node 8.
 */
const { openHls } = require('./hls');
const { QUALITIES, DEFAULT_QUALITY } = require('./jellyfin');

const RESTARTS = 4;
const RESTART_WINDOW_MS = 180000;
const REPORT_MS = 10000;
const PING_MS = 20000;
const PAUSE_KEEP_MS = 15 * 60000;
const END_MARGIN_S = 20;          // the stream ended this close to the film's end: it is over
const PLAYING = ['loading', 'playing', 'buffering'];

const num = (v) => { const n = Number(v); return v != null && v !== '' && isFinite(n) ? n : null; };

function createSession(o) {
    const jf = o.jf, log = o.log || (() => {}), sink = o.sink, now = o.now || Date.now;
    const prefs = { gain: 6, even: false };
    let ids = 0, cur = null;
    let sticky = null;      // { show, audio, subtitle }: the languages chosen for an episode of a show ('' : no subtitles)
    const st = { state: 'idle', error: null, at: now() };
    const set = (state, error) => { st.state = state; st.error = error || null; st.at = now(); };

    /* ---------- one stream: the server's offer (a conversion there), hls.js, a player ---------- */
    /** fresh: ask the server anew (the first start, a stream that broke); else the stream it gave is read from another place */
    async function start(c, at, fresh) {
        const kept = !fresh && c.stream && c.stream.whole ? c.stream : null;
        closeStream(c, !!kept);
        const gen = ++c.gen;
        const mine = () => cur === c && c.gen === gen;
        c.pos = Math.max(0, Math.min(at || 0, c.duration ? Math.max(0, c.duration - 5) : at || 0));
        c.base = c.pos; c.t = 0; c.played = false; c.hlsDone = false; c.playerEnded = false;
        c.audioError = null; c.videoError = null; c.lastError = null; c.video = null;
        set('loading');
        let s = kept;
        if (!s) {
            let d;
            try { d = await jf.playback({ key: c.item.key, sourceId: c.sourceId, offset: c.pos, quality: c.quality, audio: c.audio, subtitle: c.subtitle }); }
            catch (e) {
                if (!mine()) return undefined;
                // a refused sign-in, no internet, a film that is gone: said; anything else may pass (the server was busy)
                if (e.code === 'EAUTH' || e.code === 'EOFFLINE' || e.status === 403 || e.status === 404) return fail(c, e.message);
                return again(c, e.message);
            }
            if (!mine()) return undefined;
            if (!d.ok) return fail(c, d.text);
            s = c.stream = { url: d.url, session: d.session, how: d.how, whole: false };
            if (d.sourceId) c.sourceId = d.sourceId;
        }
        c.how = s.how || null;
        const id = ++ids;
        c.pid = id;
        const h = openHls({
            nx: o.nx, log, headers: () => jf.headers(), clean: jf.cleanUrl, url: s.url, offset: c.pos, duration: c.duration || 0, now,
            write: (buf) => (mine() ? sink.data(id, buf) : true),
            drain: (fn) => sink.drain(id, fn),
            retryForMs: o.retryForMs,
        });
        c.hls = h;
        h.on('info', (i) => {
            if (!mine()) return;
            // a list of the whole film can be read from any place; one that only has what follows the start cannot
            s.whole = !!(i.endlist && c.duration > 0 && i.seconds >= c.duration - END_MARGIN_S);
            c.base = i.base; c.pos = i.base;
            sink.start(id);
            sink.ctl(id, 'gain ' + prefs.gain);
            if (prefs.even) sink.ctl(id, 'even on');
            sink.ctl(id, 'subs off');   // (the player's own DVB subtitles: a film's are drawn into the picture by the server)
            if (st.state === 'paused') sink.ctl(id, 'pause');   // paused before its player was there
        });
        h.on('end', () => { if (mine()) { c.hlsDone = true; sink.end(id); } });
        h.on('error', (e) => {
            if (!mine()) return;
            log('stream: ' + e.message + (e.lost ? ' (the server let the stream go)' : ''));
            if (e.code === 'EAUTH') return fail(c, e.message);
            again(c, e.message);
        });
        return tell(c, 'buffering');
    }
    /** the stream's reader and its player end, and (unless kept) the server's conversion; the item stays (cur) */
    function closeStream(c, keep) {
        if (c.hls) { c.hls.stop(); c.hls = null; }
        if (c.pid) { sink.stop(c.pid); c.pid = 0; }
        if (!keep && c.stream) { const s = c.stream; c.stream = null; if (s.session) jf.stopEncoding(s.session); }
        clearTimeout(c.pauseTimer); c.pauseTimer = null;
    }
    function fail(c, why) {
        if (cur !== c) return;
        tell(c, 'stopped');
        closeStream(c);
        c.gen++;
        log('playback: ' + why);
        set('error', why);
    }
    /** a stream that broke: asked for anew where the film was, a few times */
    function again(c, why) {
        const t = now();
        c.restarts = c.restarts.filter((x) => t - x < RESTART_WINDOW_MS);
        if (c.restarts.length >= RESTARTS) return fail(c, why || 'the film keeps stopping (the connection?)');
        c.restarts.push(t);
        log('playback: again from ' + Math.floor(c.pos) + ' s (' + (why || 'the stream ended early') + ')');
        return start(c, c.pos, true);
    }

    /* ---------- the server's view of it ---------- */
    /** state: buffering | playing | paused | stopped. The first of a film is its start; "stopped" is told once. */
    function tell(c, state) {
        c.lastTold = now();
        if (c.stream && c.stream.session) c.session = c.stream.session;
        const t = { key: c.item.key, sourceId: c.sourceId, session: c.session, time: c.pos, paused: state === 'paused', audio: c.audio, subtitle: c.subtitle };
        if (state === 'stopped') {
            if (!c.told) return Promise.resolve(false);
            c.told = false;
            return jf.report('stopped', t);
        }
        if (!c.told) { c.told = true; return jf.report('start', t); }
        return jf.report('progress', t);
    }
    const beat = setInterval(() => {
        const c = cur;
        if (!c) return;
        const t = now();
        if (st.state === 'playing' && t - c.lastTold >= REPORT_MS) tell(c, 'playing');
        if (st.state === 'paused' && c.stream && t - (c.lastPing || 0) >= PING_MS) { c.lastPing = t; if (c.stream.session) jf.ping(c.stream.session); tell(c, 'paused'); }
    }, 1000);
    if (beat.unref) beat.unref();

    /** the episode after this one (the next season's first after a season's last), for the app's "up next" */
    async function findNext(c) {
        const it = c.item;
        if (it.type !== 'episode' || !it.grandparentKey) return;
        try {
            const n = await jf.nextEpisode(it.grandparentKey, it.key);
            if (cur === c && n) c.next = { key: n.key, title: n.title, index: n.index, parentIndex: n.parentIndex, thumb: n.thumb || null };
        } catch (e) { log('next episode: ' + e.message); }
    }

    /** which sound and subtitles (see the header); sets c.sourceId, c.audio, c.subtitle */
    function tracks(c, it, p) {
        const m = (it.media || [])[0];
        if (!m) return;
        c.sourceId = m.id || null;
        const show = it.type === 'episode' ? it.grandparentKey || null : null;
        const byId = (list, id) => list.filter((x) => x.id === String(id))[0] || null;
        const byLang = (list, lang) => list.filter((x) => x.lang && x.lang === lang)[0] || null;
        let a = num(p.audio) !== null ? byId(m.audio, p.audio) : null;
        let s = num(p.subtitle) === null ? null : num(p.subtitle) < 0 ? false : byId(m.subtitles, p.subtitle);   // a track, false (none), null (no say)
        if (a || s !== null) {
            if (show) sticky = { show, audio: a ? a.lang || null : null, subtitle: s === null ? null : s === false ? '' : s.lang || null };
        } else if (show && sticky && sticky.show === show) {
            if (sticky.audio) a = byLang(m.audio, sticky.audio);
            if (sticky.subtitle !== null) s = sticky.subtitle === '' ? false : byLang(m.subtitles, sticky.subtitle);
        }
        const defA = m.audio.filter((x) => x.selected)[0] || null, defS = m.subtitles.filter((x) => x.selected)[0] || null;
        a = a || defA;
        c.audio = a ? Number(a.id) : null;
        c.subtitle = s === false ? -1 : s ? Number(s.id) : defS ? Number(defS.id) : -1;
    }

    /* ---------- what the app asks ---------- */
    async function play(p) {
        stop();
        const key = String(p && p.key || '');
        const c = {
            item: { key, type: '', title: '' }, duration: 0, pos: 0, base: 0, t: 0, gen: 0, pid: 0, hls: null, stream: null, session: null, sourceId: null,
            audio: null, subtitle: -1, told: false, restarts: [], quality: QUALITIES[p.quality] ? p.quality : DEFAULT_QUALITY,
            next: null, startedAt: now(), lastTold: 0,
        };
        cur = c;
        set('loading');
        let it;
        try { it = await jf.meta(key); }
        catch (e) { if (cur === c) { set('error', e.message); } return; }
        if (cur !== c) return;
        if (it.type !== 'movie' && it.type !== 'episode') { set('error', 'this is not a film or an episode'); return; }
        c.item = { key: it.key, type: it.type, title: it.title, year: it.year, thumb: it.thumb || null, index: it.index, parentIndex: it.parentIndex,
            parentKey: it.parentKey || null, grandparentKey: it.grandparentKey || null, grandparentTitle: it.grandparentTitle || null,
            grandparentThumb: it.grandparentThumb || null };
        c.duration = it.duration || 0;
        tracks(c, it, p || {});
        // resume: where the app says, else from the start; never inside the last seconds
        let at = Number(p.offset);
        if (!isFinite(at) || at < 0) at = 0;
        if (c.duration && at > c.duration - 10) at = 0;
        log('play ' + it.type + ' ' + it.key + ' from ' + Math.floor(at) + ' s, ' + c.quality + (c.audio !== null ? ', sound ' + c.audio : '') + (c.subtitle >= 0 ? ', subtitles ' + c.subtitle : ''));
        findNext(c);
        start(c, at, true);
    }
    function seek(s) {
        const c = cur;
        let t = Number(s);
        if (!c || !isFinite(t) || !c.item.type) return;
        if (c.duration) t = Math.min(t, Math.max(0, c.duration - 5));
        start(c, Math.max(0, t), false);
    }
    function pause() {
        const c = cur;
        if (!c || PLAYING.indexOf(st.state) < 0) return;
        if (c.pid) sink.ctl(c.pid, 'pause');
        set('paused');
        c.lastPing = now();
        tell(c, 'paused');
        clearTimeout(c.pauseTimer);
        c.pauseTimer = setTimeout(() => {
            // long paused: the server is told the film stopped (it keeps the place and ends its conversion), the player goes
            if (cur !== c || st.state !== 'paused') return;
            log('paused for ' + Math.round((o.pauseKeepMs || PAUSE_KEEP_MS) / 60000) + ' min: the stream is let go');
            tell(c, 'stopped');
            closeStream(c); c.gen++;
        }, o.pauseKeepMs || PAUSE_KEEP_MS);
    }
    function resume() {
        const c = cur;
        if (!c) return;
        if (st.state === 'paused' && c.pid && c.hls) {
            clearTimeout(c.pauseTimer); c.pauseTimer = null;
            sink.ctl(c.pid, 'resume');
            set(c.played ? 'playing' : 'loading');
            tell(c, 'playing');
        } else if (st.state === 'paused' || st.state === 'error') start(c, c.pos, true);
        else if (st.state === 'ended') start(c, 0, true);
    }
    function stop() {
        const c = cur;
        if (!c) return;
        cur = null;
        if (st.state !== 'ended' && st.state !== 'idle' && c.item.type) tell(c, 'stopped');
        closeStream(c);
        c.gen++;
        set('idle');
    }
    function setPrefs(p) {
        const g = Number(p && p.gain);
        if (isFinite(g)) prefs.gain = Math.max(0, Math.min(15, g));
        if (p && p.even !== undefined) prefs.even = !!p.even;
        if (cur && cur.pid) { sink.ctl(cur.pid, 'gain ' + prefs.gain); sink.ctl(cur.pid, prefs.even ? 'even on' : 'even off'); }
    }

    function onPlayer(id, ev) {
        const c = cur;
        if (!c || id !== c.pid || !ev) return;
        if (ev.ev === 'open') {
            c.video = ev.video || null;
        } else if (ev.ev === 'tick') {
            if (typeof ev.t === 'number' && ev.t >= 0) { c.t = ev.t; c.pos = c.base + ev.t; }
            if (st.state === 'paused') return;
            if (ev.state === 'playing') {
                if (st.state !== 'playing') { set('playing'); tell(c, 'playing'); }
                c.played = true;
            } else if (ev.state === 'buffering' && st.state === 'playing') set('buffering');
        } else if (ev.ev === 'decoder' && ev.ok === false) {
            c.videoError = ev.error || 'the decoder did not start';
        } else if (ev.ev === 'audio' && ev.ok === false) {
            c.audioError = ev.error || 'this sound does not play here';
        } else if (ev.ev === 'error') {
            c.lastError = ev.error || 'the player failed';
        } else if (ev.ev === 'end' || ev.ev === 'exit') {
            if (c.playerEnded) return;
            c.playerEnded = true;
            c.pid = 0;
            const over = c.hlsDone || (c.duration && c.pos >= c.duration - END_MARGIN_S);
            if (over) {
                if (c.duration) c.pos = c.duration;
                tell(c, 'stopped');
                closeStream(c);
                set('ended');
                return;
            }
            if (st.state === 'paused' && !c.hls) return;   // let go while paused (above)
            again(c, c.lastError || (ev.ev === 'exit' ? 'the player ended (' + (ev.signal || 'code ' + ev.code) + ')' : 'the stream ended early'));
        }
    }

    function status() {
        const c = cur;
        const h = c && c.hls ? c.hls.state() : null;
        return {
            state: st.state, error: st.error, at: st.at,
            item: c ? c.item : null, pos: c ? Math.round(c.pos * 10) / 10 : 0, duration: c ? c.duration : 0,
            quality: c ? c.quality : null, how: c ? c.how || null : null, subtitles: c ? c.subtitle >= 0 : false,
            audio: c ? c.audio : null, subtitle: c ? c.subtitle : -1,
            video: c && c.video ? c.video : null, audioError: c ? c.audioError : null, videoError: c ? c.videoError : null,
            next: c ? c.next : null, ahead: h ? Math.round(h.queuedSeconds) : 0, kbytes: h ? Math.round(h.bytes / 1024) : 0,
            gain: prefs.gain,
        };
    }

    return { play, seek, pause, resume, stop, setPrefs, onPlayer, status, active: () => !!cur, close: () => { stop(); clearInterval(beat); } };
}

module.exports = { createSession, PLAYING };
