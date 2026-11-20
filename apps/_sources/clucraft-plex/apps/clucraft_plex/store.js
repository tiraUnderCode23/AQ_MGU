'use strict';
/**
 * store.js - what the app knows and does, without a screen: the service's status, the pages and where each one is,
 * the lists it has asked for (kept a few minutes), the posters, and the actions (sign in, open, play, skip...).
 * ui.js draws it; main.js wires it to the head unit. Nothing here needs the car: the tests drive it.
 *
 *   const S = createStore({ ask, setImage, settings, now, log });
 *     ask(m, timeoutMs)  -> Promise: one question to the Drive-In service (svc.js)
 *     setImage(id, w, h, rgba)  the kit's record.setImage (a poster's pixels under a picture id)
 *     settings.get(key)  the app's settings (quality, autoplay)
 *
 * Pages: link (sign in), home, library, show, detail, search, player, consent (the passenger disclaimer).
 * S.page is the one shown; S.back() goes to the one before it (true when it did).
 *
 * Node 8 only: no ?. ?? object spread, class fields or optional catch binding.
 */
const KB = require('./keyboard');

const PLAYING = ['loading', 'playing', 'buffering'];
const POSTER = { grid: [148, 222], detail: [208, 312], card: [112, 168] };
const SLOTS = 44, SLOT_ID0 = 200;     // mgu-render: 64 pictures per app at most, the kit's own among them
const HOME_MS = 3 * 60000, LIST_MS = 5 * 60000;
const PAGE_SIZE = 60;
const SORTS = [['title', 'A - Z'], ['added', 'Recently added'], ['year', 'Newest'], ['viewed', 'Last watched']];
const OVERLAY_MS = 6000;
const NEXT_S = 10;

function createStore(o) {
    const ask = o.ask, now = o.now || Date.now, log = o.log || { info() {}, warn() {} };
    const setImage = o.setImage || (() => {});
    const settings = o.settings || { get: () => undefined };

    const S = {
        st: null, svcErr: null, svcErrCode: null, statusAt: 0,
        page: 'link', stack: [], toast: null,
        home: { at: 0, loading: false, error: null, sections: [], deck: [], recent: [] },
        lib: null,          // { key, type, title, sort, unwatched, total, items, loading, error, scroll, at }
        show: null,         // { key, item, seasons, sel, episodes: { seasonKey: { items, loading, error } }, loading, error, scroll }
        detail: null,       // { key, item, loading, error, subtitle (stream id or null), busy }
        search: { field: KB.makeField('', { max: 60 }), kb: new KB.Keyboard('abc'), q: '', results: null, loading: false, error: null, scroll: 0, timer: null },
        picker: null,       // { title, rows: [{ label, on, run }] }
        overlayUntil: 0, seekTo: null, nextAt: 0, nextFor: null, playFrom: null,
        consentAsk: false,
    };

    /* ---------- the service ---------- */
    const pb = () => (S.st && S.st.playback) || null;
    const signedIn = () => !!(S.st && S.st.account);
    const clientState = () => (S.st && S.st.client && S.st.client.state) || null;
    const connected = () => signedIn() && clientState() === 'connected';
    const playing = () => { const p = pb(); return !!(p && PLAYING.indexOf(p.state) >= 0); };
    const active = () => { const p = pb(); return !!(p && p.state && p.state !== 'idle' && p.item); };
    const say = (text, ms) => { S.toast = { text: String(text), until: now() + (ms || 3000) }; };

    let polling = false;
    async function poll() {
        if (polling) return;
        polling = true;
        try {
            const was = connected(), wasState = pb() ? pb().state : null;
            S.st = await ask({ cmd: 'status' });
            S.statusAt = now();
            S.svcErr = null; S.svcErrCode = null;
            const p = pb();
            // signed out, or the sign-in refused: the sign-in page; signed in again: home
            if (!signedIn() || clientState() === 'refused') { if (S.page !== 'link') { S.page = 'link'; S.stack = []; } }
            else if (S.page === 'link') { S.page = 'home'; S.stack = []; say('Signed in' + (S.st.account.user ? ' as ' + S.st.account.user : '')); }
            if (connected() && !was) loadHome(true);
            if (S.seekTo !== null && p && (p.state === 'playing' || p.state === 'error' || p.state === 'idle') && Math.abs(p.pos - S.seekTo.pos) < 30) S.seekTo = null;
            if (S.seekTo !== null && now() - S.seekTo.at > 20000) S.seekTo = null;
            // the film ended: the next episode by itself after a count, when there is one and the owner wants it
            if (p && p.state === 'ended' && wasState && wasState !== 'ended') {
                invalidate();
                if (p.next && settings.get('autoplay') !== false) { S.nextAt = now() + NEXT_S * 1000; S.nextFor = p.next.key; }
                S.overlayUntil = now() + 3600000;
            }
            if (S.nextAt && p && p.state === 'ended' && p.next && p.next.key === S.nextFor && now() >= S.nextAt) { S.nextAt = 0; play({ key: p.next.key, type: 'episode' }, 0); }
            if (S.nextAt && (!p || p.state !== 'ended')) S.nextAt = 0;
        } catch (e) {
            S.svcErr = e.message; S.svcErrCode = e.code || null;
        }
        polling = false;
    }
    const send = (m, t) => ask(m, t).then((r) => { if (r && r.version) { S.st = r; S.statusAt = now(); } return r; });
    const quiet = (p) => p.then(() => {}, (e) => say(e.message));

    /* ---------- pages ---------- */
    function go(page) { if (S.page !== page) { if (S.page !== 'player' && S.page !== 'link' && S.page !== 'consent') S.stack.push(S.page); S.page = page; S.picker = null; } }
    function top(page) { S.stack = []; S.page = page; S.picker = null; }
    /** the page before this one; false when there is none (the HMI then closes the app's screen) */
    function back() {
        if (S.picker) { S.picker = null; return true; }
        if (S.page === 'consent') return true;      // answered with its own two buttons
        if (S.page === 'player') { S.page = S.stack.length ? S.stack[S.stack.length - 1] : 'home'; if (S.stack.length) S.stack.pop(); if (S.page === 'detail' && S.detail) loadDetail(S.detail.key, true); return true; }
        if (!S.stack.length) { if (S.page !== 'home' && S.page !== 'link') { S.page = 'home'; return true; } return false; }
        S.page = S.stack.pop();
        return true;
    }
    function invalidate() { S.home.at = 0; if (S.lib) S.lib.at = 0; }

    /* ---------- home ---------- */
    function loadHome(force) {
        const h = S.home;
        if (h.loading || !connected() || (!force && h.at && now() - h.at < HOME_MS)) return;
        h.loading = true;
        ask({ cmd: 'home' }, 45000).then((r) => {
            h.loading = false; h.at = now();
            h.error = r.error || null;
            if (!r.error || (r.sections && r.sections.length)) { h.sections = r.sections || []; h.deck = r.deck || []; h.recent = r.recent || []; }
        }, (e) => { h.loading = false; h.at = now() - HOME_MS + 15000; h.error = e.message; });
    }

    /* ---------- a library ---------- */
    function openLibrary(sec) {
        if (!S.lib || S.lib.key !== sec.key) S.lib = { key: sec.key, type: sec.type, title: sec.title, sort: 'title', unwatched: false, total: null, items: [], loading: false, error: null, scroll: 0, at: 0 };
        top('library');
        if (!S.lib.at || now() - S.lib.at > LIST_MS) reloadLibrary();
    }
    function reloadLibrary() { const l = S.lib; if (!l) return; l.items = []; l.total = null; l.scroll = 0; l.error = null; l.gen = (l.gen || 0) + 1; l.loading = false; libMore(); }
    function libMore() {
        const l = S.lib;
        if (!l || l.loading || (l.total !== null && l.items.length >= l.total)) return;
        l.loading = true;
        const gen = l.gen || 0;
        ask({ cmd: 'section', key: l.key, type: l.type, sort: l.sort, unwatched: l.unwatched, start: l.items.length, size: PAGE_SIZE }, 45000).then((r) => {
            if (S.lib !== l || (l.gen || 0) !== gen) return;
            l.loading = false; l.at = now();
            if (r.error) { l.error = r.error; if (l.total === null) l.total = l.items.length; return; }
            l.error = null;
            l.items = l.items.concat(r.items || []);
            l.total = Math.max(r.total || 0, l.items.length);
            if (!(r.items || []).length) l.total = l.items.length;
        }, (e) => { if (S.lib === l && (l.gen || 0) === gen) { l.loading = false; l.error = e.message; if (l.total === null) l.total = l.items.length; } });
    }
    function setSort(sort) { if (S.lib && S.lib.sort !== sort) { S.lib.sort = sort; reloadLibrary(); } }
    function toggleUnwatched() { if (S.lib) { S.lib.unwatched = !S.lib.unwatched; reloadLibrary(); } }

    /* ---------- a show: its seasons and their episodes ---------- */
    function openShow(key, title, seasonKey) {
        const sh = S.show = { key: String(key), title: title || '', seasons: [], sel: 0, episodes: {}, loading: true, error: null, scroll: 0, want: seasonKey || null };
        go('show');
        ask({ cmd: 'children', key: sh.key }, 45000).then((r) => {
            if (S.show !== sh) return;
            sh.loading = false;
            if (r.error) { sh.error = r.error; return; }
            sh.seasons = (r.items || []).filter((x) => x.type === 'season');
            if (!sh.title && sh.seasons[0]) sh.title = sh.seasons[0].parentTitle || '';
            // the season asked for, else the first with something left to watch, else the first
            let i = sh.want ? sh.seasons.findIndex((x) => x.key === sh.want) : -1;
            if (i < 0) i = sh.seasons.findIndex((x) => (x.viewedLeafCount || 0) < (x.leafCount || 0));
            selectSeason(Math.max(0, i));
        }, (e) => { if (S.show === sh) { sh.loading = false; sh.error = e.message; } });
    }
    function selectSeason(i) {
        const sh = S.show;
        if (!sh || !sh.seasons[i]) return;
        sh.sel = i; sh.scroll = 0;
        const sk = sh.seasons[i].key;
        const e = sh.episodes[sk];
        if (e && (e.loading || (e.items && now() - e.at < LIST_MS))) return;
        const slot = sh.episodes[sk] = { items: (e && e.items) || null, loading: true, error: null, at: 0 };
        ask({ cmd: 'children', key: sk }, 45000).then((r) => {
            slot.loading = false; slot.at = now();
            if (r.error) slot.error = r.error; else slot.items = (r.items || []).filter((x) => x.type === 'episode');
        }, (err) => { slot.loading = false; slot.error = err.message; });
    }

    /* ---------- one film or episode ---------- */
    function loadDetail(key, keep) {
        const d = keep && S.detail && S.detail.key === String(key) ? S.detail : (S.detail = { key: String(key), item: null, loading: true, error: null, subtitle: null, busy: false });
        d.loading = !d.item;
        ask({ cmd: 'meta', key: d.key }, 30000).then((r) => {
            if (S.detail !== d) return;
            d.loading = false;
            if (r.error || !r.item) { if (!d.item) d.error = r.error || 'not found'; return; }
            d.item = r.item; d.error = null;
            const m = (r.item.media || [])[0];
            const sel = m ? m.subtitles.filter((s) => s.selected)[0] : null;
            if (!keep) d.subtitle = sel ? sel.id : null;
        }, (e) => { if (S.detail === d) { d.loading = false; if (!d.item) d.error = e.message; } });
    }
    /** what a tap on a poster or a row opens */
    function open(it) {
        if (!it) return;
        if (it.type === 'show') openShow(it.key, it.title);
        else if (it.type === 'season') openShow(it.parentKey, it.parentTitle, it.key);
        else if (it.type === 'movie' || it.type === 'episode') { loadDetail(it.key); go('detail'); }
    }
    function markWatched(it, on) {
        if (!it) return;
        quiet(ask({ cmd: 'watched', key: it.key, on }, 20000).then((r) => {
            if (r && r.error) throw new Error(r.error);
            it.viewCount = on ? Math.max(1, it.viewCount || 0) : 0; it.viewOffset = 0;
            invalidate();
            say(on ? 'Marked as watched' : 'Marked as unwatched');
        }));
    }
    /** the tracks of the film on the detail page: asks the server, which keeps them for this account */
    function chooseAudio() {
        const d = S.detail, m = d && d.item && (d.item.media || [])[0];
        if (!m || !m.partId || m.audio.length < 2) return;
        S.picker = { title: 'Sound', rows: m.audio.map((a) => ({ label: a.name, on: a.selected, run: () => {
            S.picker = null;
            quiet(ask({ cmd: 'streams', part: m.partId, audio: a.id }, 20000).then((r) => { if (r && r.error) throw new Error(r.error); m.audio.forEach((x) => { x.selected = x.id === a.id; }); }));
        } })) };
    }
    function chooseSubtitles() {
        const d = S.detail, m = d && d.item && (d.item.media || [])[0];
        if (!m || !m.partId || !m.subtitles.length) return;
        const pick = (id) => () => {
            S.picker = null;
            quiet(ask({ cmd: 'streams', part: m.partId, subtitle: id === null ? '0' : id }, 20000).then((r) => { if (r && r.error) throw new Error(r.error); d.subtitle = id; }));
        };
        S.picker = { title: 'Subtitles', rows: [{ label: 'Off', on: d.subtitle === null, run: pick(null) }].concat(m.subtitles.map((s) => ({ label: s.name, on: d.subtitle === s.id, run: pick(s.id) }))) };
    }
    function chooseServer() {
        const list = (S.st && S.st.client && S.st.client.servers) || [], cur = S.st && S.st.client && S.st.client.server;
        if (list.length < 2) return;
        S.picker = { title: 'Plex server', rows: list.map((s) => ({ label: s.name + (s.owned ? '' : '  (shared with you)'), on: !!cur && cur.id === s.id, run: () => {
            S.picker = null; S.home.at = 0; S.home.sections = []; S.home.deck = []; S.home.recent = []; S.lib = null; S.show = null; S.detail = null;
            top('home');
            quiet(send({ cmd: 'server', id: s.id }));
        } })) };
    }

    /* ---------- playing ---------- */
    function play(it, offset) {
        if (!it) return;
        const d = S.detail && S.detail.key === String(it.key) ? S.detail : null;
        S.playFrom = S.page === 'player' ? S.playFrom : S.page;
        if (S.page !== 'player') { S.stack.push(S.page); S.page = 'player'; }
        S.picker = null; S.nextAt = 0; S.seekTo = null;
        S.overlayUntil = now() + OVERLAY_MS;
        quiet(send({ cmd: 'play', key: String(it.key), offset: Math.max(0, Number(offset) || 0), quality: String(settings.get('quality') || '720'), subtitles: !!(d && d.subtitle) }));
    }
    function pauseResume() {
        const p = pb();
        if (!p) return;
        S.overlayUntil = now() + OVERLAY_MS;
        if (p.state === 'paused' || p.state === 'error' || p.state === 'ended') { S.nextAt = 0; quiet(send({ cmd: 'resume' })); }
        else if (playing()) quiet(send({ cmd: 'pause' }));
    }
    /** where the film is, between two answers of the service (it moves on while it plays) */
    function position() {
        const p = pb();
        if (!p) return 0;
        if (S.seekTo !== null) return S.seekTo.pos;
        let t = p.pos || 0;
        if (p.state === 'playing') t += Math.min(2, (now() - S.statusAt) / 1000);
        return p.duration ? Math.min(p.duration, t) : t;
    }
    function seek(pos) {
        const p = pb();
        if (!p || !p.item || p.state === 'idle') return;
        const t = Math.max(0, Math.min(p.duration ? p.duration - 5 : pos, pos));
        S.seekTo = { pos: t, at: now() };
        S.overlayUntil = now() + OVERLAY_MS;
        S.nextAt = 0;
        quiet(send({ cmd: 'seek', pos: Math.floor(t) }));
    }
    const skip = (d) => seek(position() + d);
    function stop() {
        S.nextAt = 0; S.seekTo = null;
        quiet(send({ cmd: 'stop' }));
        invalidate();
        if (S.page === 'player') back();
    }
    function playNext() { const p = pb(); if (p && p.next) play({ key: p.next.key, type: 'episode' }, 0); }
    function cancelNext() { S.nextAt = 0; }

    /* ---------- search ---------- */
    function runSearch() {
        const s = S.search, q = s.field.value.trim();
        clearTimeout(s.timer); s.timer = null;
        if (q.length < 2) { s.results = null; s.q = ''; s.loading = false; return; }
        if (q === s.q && (s.results || s.loading)) return;
        s.q = q; s.loading = true; s.error = null; s.scroll = 0;
        ask({ cmd: 'search', q }, 45000).then((r) => {
            if (s.q !== q) return;
            s.loading = false;
            if (r.error) { s.error = r.error; s.results = []; } else s.results = r.items || [];
        }, (e) => { if (s.q === q) { s.loading = false; s.error = e.message; s.results = []; } });
    }
    /** a key of the on-screen keyboard: typed into the search field; the search runs a moment after the last one */
    function key(id) {
        const s = S.search;
        const r = s.kb.apply(id, s.field);
        if (r.action === 'enter') { runSearch(); return; }
        if (r.edited) { clearTimeout(s.timer); s.timer = setTimeout(runSearch, 900); if (s.timer.unref) s.timer.unref(); }
    }

    /* ---------- posters: made by the service, kept in the renderer's picture slots ---------- */
    const arts = {};           // key "path|w" -> { id, at } | { none } | { loading }
    const slotUse = [];        // slot -> key (the least recently drawn is reused)
    const artQueue = [];
    let artBusy = 0;
    /** the picture id of poster `path` at `size`, or null while it is being made (ask again next frame) */
    function art(path, size) {
        if (!path) return null;
        const k = path + '|' + size[0];
        const e = arts[k];
        if (e) { if (e.id != null) { e.at = now(); return e.id; } if (e.none && now() > e.until) delete arts[k]; return null; }
        arts[k] = { loading: true };
        artQueue.push({ path, size, k });
        pumpArt();
        return null;
    }
    function pumpArt() {
        while (artBusy < 2 && artQueue.length) {
            const q = artQueue.pop();           // the newest first: what is on screen now
            artBusy++;
            ask({ cmd: 'art', path: q.path, w: q.size[0], h: q.size[1] }, 40000).then((r) => {
                if (!r || !r.img || r.w !== q.size[0] || r.h !== q.size[1]) { arts[q.k] = { none: true, until: now() + 120000 }; return; }
                const rgba = Buffer.from(r.img, 'base64');
                if (rgba.length !== r.w * r.h * 4) { arts[q.k] = { none: true, until: now() + 120000 }; return; }
                let slot = slotUse.length < SLOTS ? slotUse.length : -1;
                if (slot < 0) {
                    let oldest = Infinity;
                    slotUse.forEach((kk, i) => { const e = arts[kk]; const at = (e && e.at) || 0; if (at < oldest) { oldest = at; slot = i; } });
                    delete arts[slotUse[slot]];
                }
                slotUse[slot] = q.k;
                setImage(SLOT_ID0 + slot, r.w, r.h, rgba);
                arts[q.k] = { id: SLOT_ID0 + slot, at: now() };
            }, () => { arts[q.k] = { none: true, until: now() + 30000 }; }).then(() => { artBusy--; pumpArt(); });
        }
        // what scrolled away before its turn is not worth making
        if (artQueue.length > 40) artQueue.splice(0, artQueue.length - 40).forEach((q) => { delete arts[q.k]; });
    }

    /* ---------- the account ---------- */
    function linkStart() { quiet(send({ cmd: 'link-start' })); }
    function linkCancel() { quiet(send({ cmd: 'link-cancel' })); }
    function signOut() {
        quiet(send({ cmd: 'stop' }).then(() => send({ cmd: 'signout' })).then(() => {
            S.home = { at: 0, loading: false, error: null, sections: [], deck: [], recent: [] };
            S.lib = null; S.show = null; S.detail = null; S.search.results = null; S.search.q = '';
            S.page = 'link'; S.stack = [];
            say('Signed out: the account is removed from this car');
        }));
    }

    return Object.assign(S, {
        poll, pb, signedIn, connected, clientState, playing, active, say,
        go, top, back, loadHome, openLibrary, libMore, reloadLibrary, setSort, toggleUnwatched, openShow, selectSeason, loadDetail, open,
        markWatched, chooseAudio, chooseSubtitles, chooseServer,
        play, pauseResume, position, seek, skip, stop, playNext, cancelNext,
        runSearch, key, art, linkStart, linkCancel, signOut,
    });
}

module.exports = { createStore, POSTER, SORTS, PLAYING, OVERLAY_MS, NEXT_S, SLOT_ID0, SLOTS, PAGE_SIZE };
