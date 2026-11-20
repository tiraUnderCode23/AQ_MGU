'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * session.js - the film or episode that plays: its transcode on the Plex server, read as HLS (hls.js) into the
 * player's stdin, the player's state, where the film is, and what the server is told about it (the timeline: the
 * server keeps the resume point and marks it watched near its end). Runs in the client (client.js, the internet uid); the player
 * (tvh-player, started by the root service) gets the stream through `sink`.
 *
 *   const ps = createSession({ px, nx, log, sink, now });
 *   ps.play({ key, offset, quality, subtitles })   another item, or the same one again, is a new stream and player
 *   ps.seek(seconds)  ps.pause()  ps.resume()  ps.stop()
 *   ps.setPrefs({ gain, even })
 *   ps.onPlayer(id, ev)     the player's events (open, decoder, audio, tick, end, error, exit), stream id first
 *   ps.status()             { state, error, item, pos, duration, quality, how, video, audioError, videoError, next, ... }
 *   sink: { start(id), data(id, buf) -> bool (false: wait for drain), end(id), drain(id, fn), ctl(id, line), stop(id) }
 *
 * States: idle, loading, playing, buffering, paused, ended, error.
 *
 * A skip is a new transcode at that second (the server seeks faster than a player could read up to it), with a new
 * player. Pause stops the player's clock; the server's transcode is kept alive with a ping, and let go after 15
 * minutes (resume then starts a new one where the film was). A stream that breaks (the road, the server) is started
 * again where the film was, 4 times in 3 minutes at most. The film's position is the stream's base (hls.js) plus what
 * the player has played of it.
 *
 * Plain Node 8.
 */
const crypto = require('crypto');
const { openHls } = require('./hls');
const { QUALITIES, DEFAULT_QUALITY } = require('./plex');

const RESTARTS = 4;
const RESTART_WINDOW_MS = 180000;
const TIMELINE_MS = 10000;
const PING_MS = 20000;
const PAUSE_KEEP_MS = 15 * 60000;
const END_MARGIN_S = 20;          // the stream ended this close to the film's end: it is over
const PLAYING = ['loading', 'playing', 'buffering'];

function createSession(o) {
    const px = o.px, log = o.log || (() => {}), sink = o.sink, now = o.now || Date.now;
    const prefs = { gain: 6, even: false };
    let ids = 0, cur = null;
    const st = { state: 'idle', error: null, at: now() };
    const set = (state, error) => { st.state = state; st.error = error || null; st.at = now(); };
    const uid = () => crypto.randomBytes(12).toString('hex');

    /* ---------- one stream: a transcode on the server, hls.js, a player ---------- */
    async function start(c, at) {
        closeStream(c);
        const gen = ++c.gen;
        const mine = () => cur === c && c.gen === gen;
        c.pos = Math.max(0, Math.min(at || 0, c.duration ? Math.max(0, c.duration - 5) : at || 0));
        c.base = c.pos; c.t = 0; c.played = false; c.hlsDone = false; c.playerEnded = false;
        c.audioError = null; c.videoError = null; c.lastError = null; c.video = null;
        c.session = uid();
        set('loading');
        const args = px.transcodeArgs({ key: c.item.key, offset: c.pos, quality: c.quality, subtitles: c.subtitles, session: c.session, sid: c.sid });
        try {
            const d = await px.decision(args);
            if (!mine()) return;
            if (!d.ok) return fail(c, d.text || 'the server cannot play this here (code ' + d.code + ')');
            c.how = d.video === 'copy' ? 'direct stream' : d.video ? 'transcode' : null;
        } catch (e) {
            if (!mine()) return;
            // the decision is advice: an old server without it still plays; a refused sign-in or no internet is said
            if (e.code === 'EAUTH' || e.code === 'EOFFLINE' || e.status === 403) return fail(c, e.message);
            log('decision: ' + e.message);
        }
        const id = ++ids;
        c.pid = id;
        const h = openHls({
            nx: o.nx, log, headers: () => px.headers(), url: px.masterUrl(args), offset: c.pos, duration: c.duration || 0, now,
            write: (buf) => (mine() ? sink.data(id, buf) : true),
            drain: (fn) => sink.drain(id, fn),
            retryForMs: o.retryForMs,
        });
        c.hls = h;
        h.on('info', (i) => {
            if (!mine()) return;
            c.base = i.base; c.pos = i.base;
            sink.start(id);
            sink.ctl(id, 'gain ' + prefs.gain);
            if (prefs.even) sink.ctl(id, 'even on');
            sink.ctl(id, 'subs off');   // (the player's own DVB subtitles: a film's are burnt in by the server when asked)
            if (st.state === 'paused') sink.ctl(id, 'pause');   // paused before its player was there
        });
        h.on('end', () => { if (mine()) { c.hlsDone = true; sink.end(id); } });
        h.on('error', (e) => {
            if (!mine()) return;
            log('stream: ' + e.message + (e.lost ? ' (the server let the session go)' : ''));
            if (e.code === 'EAUTH') return fail(c, e.message);
            again(c, e.message);
        });
        timeline(c, 'buffering');
    }
    /** the stream, its player and the server's transcode end; the item stays (cur) */
    function closeStream(c) {
        if (c.hls) { c.hls.stop(); c.hls = null; }
        if (c.pid) { sink.stop(c.pid); c.pid = 0; }
        if (c.session) { const s = c.session; c.session = null; px.stopTranscode(s); }
        clearTimeout(c.pauseTimer); c.pauseTimer = null;
    }
    function fail(c, why) {
        if (cur !== c) return;
        closeStream(c);
        c.gen++;
        log('playback: ' + why);
        set('error', why);
        timeline(c, 'stopped');
    }
    /** a stream that broke: again where the film was, a few times */
    function again(c, why) {
        const t = now();
        c.restarts = c.restarts.filter((x) => t - x < RESTART_WINDOW_MS);
        if (c.restarts.length >= RESTARTS) return fail(c, why || 'the film keeps stopping (the connection?)');
        c.restarts.push(t);
        log('playback: again from ' + Math.floor(c.pos) + ' s (' + (why || 'the stream ended early') + ')');
        start(c, c.pos);
    }

    /* ---------- the server's view of it ---------- */
    function timeline(c, state) {
        c.lastTimeline = now();
        return px.timeline({ key: c.item.key, state, time: c.pos, duration: c.duration || 0, sid: c.sid });
    }
    const beat = setInterval(() => {
        const c = cur;
        if (!c) return;
        const t = now();
        if (st.state === 'playing' && t - c.lastTimeline >= TIMELINE_MS) timeline(c, 'playing');
        if (st.state === 'paused' && c.session && t - (c.lastPing || 0) >= PING_MS) { c.lastPing = t; px.ping(c.session); timeline(c, 'paused'); }
    }, 1000);
    if (beat.unref) beat.unref();

    /** the episode after this one (the season's next, else the next season's first), for the app's "up next" */
    async function findNext(c) {
        const it = c.item;
        if (it.type !== 'episode' || !it.parentKey) return;
        try {
            const eps = (await px.children(it.parentKey)).filter((e) => e.type === 'episode');
            const i = eps.findIndex((e) => e.key === it.key);
            let nx2 = i >= 0 && i + 1 < eps.length ? eps[i + 1] : null;
            if (!nx2 && it.grandparentKey) {
                const seasons = (await px.children(it.grandparentKey)).filter((s) => s.type === 'season');
                const j = seasons.findIndex((s) => s.key === it.parentKey);
                if (j >= 0 && j + 1 < seasons.length) nx2 = (await px.children(seasons[j + 1].key)).filter((e) => e.type === 'episode')[0] || null;
            }
            if (cur === c && nx2) c.next = { key: nx2.key, title: nx2.title, index: nx2.index, parentIndex: nx2.parentIndex, thumb: nx2.thumb || null };
        } catch (e) { log('next episode: ' + e.message); }
    }

    /* ---------- what the app asks ---------- */
    async function play(p) {
        stop();
        const key = String(p && p.key || '');
        const c = {
            item: { key, type: '', title: '' }, duration: 0, pos: 0, base: 0, t: 0, gen: 0, pid: 0, hls: null, session: null,
            sid: uid(), restarts: [], quality: QUALITIES[p.quality] ? p.quality : DEFAULT_QUALITY, subtitles: !!p.subtitles,
            next: null, startedAt: now(), lastTimeline: 0,
        };
        cur = c;
        set('loading');
        let it;
        try { it = await px.meta(key); }
        catch (e) { if (cur === c) { set('error', e.message); } return; }
        if (cur !== c) return;
        if (it.type !== 'movie' && it.type !== 'episode') { set('error', 'this is not a film or an episode'); return; }
        c.item = { key: it.key, type: it.type, title: it.title, year: it.year, thumb: it.thumb || null, index: it.index, parentIndex: it.parentIndex,
            parentKey: it.parentKey || null, grandparentKey: it.grandparentKey || null, grandparentTitle: it.grandparentTitle || null,
            grandparentThumb: it.grandparentThumb || null };
        c.duration = it.duration || 0;
        // resume: where the app says, else from the start; never inside the last seconds
        let at = Number(p.offset);
        if (!isFinite(at) || at < 0) at = 0;
        if (c.duration && at > c.duration - 10) at = 0;
        log('play ' + it.type + ' ' + it.key + ' from ' + Math.floor(at) + ' s, ' + c.quality + (c.subtitles ? ', subtitles' : ''));
        findNext(c);
        start(c, at);
    }
    function seek(s) {
        const c = cur;
        let t = Number(s);
        if (!c || !isFinite(t) || !c.item.type) return;
        if (c.duration) t = Math.min(t, Math.max(0, c.duration - 5));
        start(c, Math.max(0, t));
    }
    function pause() {
        const c = cur;
        if (!c || PLAYING.indexOf(st.state) < 0) return;
        if (c.pid) sink.ctl(c.pid, 'pause');
        set('paused');
        c.lastPing = now();
        timeline(c, 'paused');
        clearTimeout(c.pauseTimer);
        c.pauseTimer = setTimeout(() => {
            // long paused: the server's transcode and the player are let go, the place is kept
            if (cur !== c || st.state !== 'paused') return;
            log('paused for ' + Math.round(PAUSE_KEEP_MS / 60000) + ' min: the stream is let go');
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
            timeline(c, 'playing');
        } else if (st.state === 'paused' || st.state === 'error') start(c, c.pos);
        else if (st.state === 'ended') start(c, 0);
    }
    function stop() {
        const c = cur;
        if (!c) return;
        cur = null;
        if (st.state !== 'ended' && st.state !== 'idle' && c.item.type) timeline(c, 'stopped');
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
                if (st.state !== 'playing') { set('playing'); timeline(c, 'playing'); }
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
                if (c.hls) { c.hls.stop(); c.hls = null; }
                if (c.duration) c.pos = c.duration;
                timeline(c, 'stopped');
                if (c.session) { px.stopTranscode(c.session); c.session = null; }
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
            quality: c ? c.quality : null, how: c ? c.how || null : null, subtitles: c ? c.subtitles : false,
            video: c && c.video ? c.video : null, audioError: c ? c.audioError : null, videoError: c ? c.videoError : null,
            next: c ? c.next : null, ahead: h ? Math.round(h.queuedSeconds) : 0, kbytes: h ? Math.round(h.bytes / 1024) : 0,
            gain: prefs.gain,
        };
    }

    return { play, seek, pause, resume, stop, setPrefs, onPlayer, status, active: () => !!cur, close: () => { stop(); clearInterval(beat); } };
}

module.exports = { createSession, PLAYING };
