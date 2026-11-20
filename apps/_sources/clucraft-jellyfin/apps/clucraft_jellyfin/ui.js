'use strict';
/**
 * ui.js - the app's pages, drawn from the store (store.js) onto the kit's recorder: signing in (the server's address,
 * Quick Connect, a name and password), home, a library, a show, a film, search, the player, the passenger disclaimer. No head unit in here: main.js
 * gives it the fonts, a way to make a button, and what the car says (may the picture show; is the video there),
 * so the tests and tools/shots.js can draw every page on a PC.
 *
 *   const ui = createUi({ S, B, M, btn, env });
 *     B, M     text options of the bold and the medium font ({ font, literal: true })
 *     btn(cv, key, x, y, w, h, fn, r)   a touch target (and the controller's) over what was just drawn
 *     env      { W, VID, videoReady(), pictureAllowed(), parked(), parkedWhy(), audio(): { connected, taken, error }, version }
 *   ui.draw(cv, A, fullH)          every page but the player; sets cv.scroll where the page scrolls
 *   ui.drawPlayer(cv, A, fullH)    the player (on the page, or on the full view's recorder)
 *   ui.scroll(dy) -> bool          the page's list moved by dy px (the kit's ctx.onScroll)
 *   ui.scrub                       { x, y, w, h, dur } of the progress bar last drawn, or null (main.js: a finger on it)
 *
 * The page is 1600 logical px wide; A (kit/fullscreen.js area) is the part a finger can reach.
 *
 * Node 8 only: no ?. ?? object spread, class fields or optional catch binding.
 */
const { POSTER, SORTS, NEXT_S } = require('./store');
const { DISCLAIMER } = require('./drivegate');
const KB = require('./keyboard');
const qrcodegen = require('./qrcodegen');

const C = {
    bg: '#0b0b0e', card: '#17171c', pill: '#25252d', rail: '#121217', line: '#2c2c35', text: '#ffffff', grey: '#a3a3ad', dim: '#6c6c78',
    accent: '#aa5cc3', accentDim: '#2b1b36',     // (purple, where Drive-In for Plex is blue: the two are told apart at a glance)
    green: '#34c759', amber: '#ffb020', red: '#ff5247', black: '#000000',
};
const RAIL_W = 172;

const A_ = (c, a) => { const s = String(c).replace('#', '').slice(0, 6); return '#' + s + ('0' + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16)).slice(-2); };
/** 1:02:03 or 42:05 */
const hms = (t) => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, x = t % 60; return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + x).slice(-2); };
/** 1 h 42 min, or 42 min */
const dur = (t) => { const m = Math.max(1, Math.round((t || 0) / 60)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '') : m + ' min'; };
// the app's fonts have Latin-1 and a little punctuation: other letters lose their accents, the rest is left out
const KEEP = /[–—‘’“”•…™]/;
const MAP = { 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'œ': 'oe', 'Œ': 'OE', '„': '"', '‚': '\'', '−': '-', ' ': ' ' };
function clean(s) {
    s = String(s == null ? '' : s);
    if (/^[\x20-\x7e]*$/.test(s)) return s;
    let out = '';
    for (const ch of s) {
        const c = ch.codePointAt(0);
        if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || KEEP.test(ch)) out += ch;
        else if (MAP[ch] !== undefined) out += MAP[ch];
        else if (c === 9 || c === 10 || c === 13) out += ' ';
        else { const b = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); if (/^[\x20-\x7e]+$/.test(b)) out += b; }
    }
    return out;
}
/** S1 E4 of an episode */
const epTag = (it) => (it && it.parentIndex != null && it.index != null ? 'S' + it.parentIndex + ' E' + it.index : '');

function createUi(o) {
    const S = o.S, B = o.B, M = o.M, env = o.env, W = env.W || 1600;
    // a tap goes to the first target drawn under the finger: while a list to pick from is over the page, the page's own make none
    let mute = false;
    const btn = function (cv) { return mute ? cv : o.btn.apply(null, arguments); };
    const now = env.now || Date.now;
    const center = (opt) => Object.assign({ align: 'center' }, opt);
    const right = (opt) => Object.assign({ align: 'right' }, opt);
    const ui = { scrub: null, C };

    /* ---------- text ---------- */
    const fits = {};
    function fit(cv, s, size, w, opt) {
        s = clean(s);
        const k = s + '|' + size + '|' + Math.round(w) + '|' + (opt || M).font;
        if (fits[k] !== undefined) return fits[k];
        let out = s;
        if (cv.textWidth(s, size, opt || M) > w) {
            let lo = 0, hi = s.length;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cv.textWidth(s.slice(0, mid) + '...', size, opt || M) <= w) lo = mid; else hi = mid - 1; }
            out = s.slice(0, lo).replace(/\s+$/, '') + '...';
        }
        if (Object.keys(fits).length > 1500) Object.keys(fits).slice(0, 500).forEach((x) => { delete fits[x]; });
        fits[k] = out;
        return out;
    }
    const wraps = {};
    /** s in lines no wider than w, `max` at most (the last one cut with ...) */
    function wrap(cv, s, size, w, opt, max) {
        s = clean(s);
        const k = s.length + '|' + s.slice(0, 40) + '|' + size + '|' + Math.round(w) + '|' + max;
        if (wraps[k]) return wraps[k];
        const words = s.split(/\s+/).filter(Boolean), lines = [];
        let cur = '';
        for (let i = 0; i < words.length; i++) {
            const t = cur ? cur + ' ' + words[i] : words[i];
            if (cv.textWidth(t, size, opt) <= w) { cur = t; continue; }
            if (cur) lines.push(cur);
            cur = words[i];
            if (lines.length === max) break;
        }
        if (cur && lines.length < max) lines.push(cur);
        else if (lines.length === max && (cur || lines.join(' ').length < s.length)) lines[max - 1] = fit(cv, lines[max - 1] + ' ' + cur + ' ...', size, w, opt);
        if (Object.keys(wraps).length > 200) Object.keys(wraps).slice(0, 100).forEach((x) => { delete wraps[x]; });
        wraps[k] = lines;
        return lines;
    }

    /* ---------- pieces ---------- */
    function pill(cv, key, x, y, w, h, label, fn, opt) {
        const p = opt || {};
        cv.roundRect(x, y, w, h, h / 2, p.fill || (p.on ? C.accent : C.pill));
        cv.text(fit(cv, label, p.size || 19, w - 24, B), x + w / 2, y + h / 2 + (p.size || 19) * 0.36, p.size || 19, p.color || C.text, center(B));
        if (fn) btn(cv, key, x, y, w, h, fn, h / 2);
        return x + w;
    }
    const pillW = (cv, label, size) => Math.ceil(cv.textWidth(clean(label), size || 19, B)) + 44;
    /** a poster (or its placeholder while it is being made), a watched mark or how far it was watched */
    function poster(cv, it, x, y, size, opt) {
        const p = opt || {};
        const path = p.path || it.thumb || it.parentThumb || it.grandparentThumb;
        const id = S.art(path, size);
        if (id != null) cv.image(id, x, y, size[0], size[1]);
        else {
            cv.roundRect(x, y, size[0], size[1], 10, C.card);
            wrap(cv, it.title || '', 16, size[0] - 20, M, 3).forEach((l, i) => cv.text(l, x + size[0] / 2, y + size[1] / 2 - 10 + i * 20, 16, C.dim, center(M)));
        }
        const left = it.leafCount != null ? it.leafCount - (it.viewedLeafCount || 0) : null;
        if (it.viewOffset > 0 && it.duration) {
            const f = Math.max(0.03, Math.min(1, it.viewOffset / it.duration));
            cv.fillRect(x, y + size[1] - 6, size[0], 6, A_(C.black, 0.7));
            cv.fillRect(x, y + size[1] - 6, Math.round(size[0] * f), 6, C.accent);
        } else if (left === null ? it.viewCount > 0 : left === 0 && it.leafCount > 0) {
            cv.circle(x + size[0] - 18, y + 18, 12, A_(C.black, 0.72));
            cv.line(x + size[0] - 24, y + 18, x + size[0] - 20, y + 23, 3, C.green); cv.line(x + size[0] - 20, y + 23, x + size[0] - 12, y + 13, 3, C.green);
        } else if (left > 0 && it.type !== 'movie') {
            const t = String(left), tw = Math.max(26, cv.textWidth(t, 15, B) + 14);
            cv.roundRect(x + size[0] - tw - 6, y + 6, tw, 24, 12, C.accent);
            cv.text(t, x + size[0] - 6 - tw / 2, y + 23, 15, C.text, center(B));
        }
    }
    function back(cv, x, y, fn) {
        cv.roundRect(x, y, 52, 52, 26, C.pill);
        cv.line(x + 31, y + 15, x + 20, y + 26, 3.5, C.text); cv.line(x + 20, y + 26, x + 31, y + 37, 3.5, C.text);
        btn(cv, 'back', x, y, 52, 52, fn || (() => S.back()), 26);
    }
    function message(cv, x, y, w, head, sub, lines) {
        cv.text(fit(cv, head, 30, w, B), x + w / 2, y, 30, C.text, center(B));
        if (sub) wrap(cv, sub, 19, Math.min(w, 900), M, 3).forEach((l, i) => cv.text(l, x + w / 2, y + 40 + i * 27, 19, C.grey, center(M)));
        (lines || []).forEach((l, i) => cv.text(fit(cv, String(l), 14, w - 40, M), x + w / 2, y + 140 + i * 20, 14, C.dim, center(M)));
    }
    // (in twelve steps a second, not one for every frame the renderer can take: a frame that is the same as the last
    // is not sent, and the head unit has a film to decode)
    const spinner = (cv, cx, cy) => { const a = (Math.floor(now() / 80) * 24) % 360; cv.arc(cx, cy, 15, 20, a, a + 270, C.accent, { round: true }); };

    /* ---------- the rail ---------- */
    function rail(cv, A) {
        const x = A.x, w = RAIL_W;
        cv.roundRect(x, A.y, w, A.h, 22, C.rail);
        const secs = S.home.sections.slice(0, 5);
        const items = [{ k: 'home', label: 'Home', on: S.page === 'home', run: () => { S.top('home'); S.loadHome(false); } }]
            .concat(secs.map((s) => ({ k: 'lib' + s.key, label: s.title, on: (S.page === 'library' && S.lib && S.lib.key === s.key), run: () => S.openLibrary(s) })))
            .concat([{ k: 'search', label: 'Search', on: S.page === 'search', run: () => S.top('search') }]);
        const step = 56;
        items.forEach((it, i) => {
            const y = A.y + 12 + i * step;
            if (it.on) cv.roundRect(x + 8, y, w - 16, step - 8, 16, C.accentDim);
            cv.text(fit(cv, it.label, 20, w - 44, it.on ? B : M), x + 24, y + 31, 20, it.on ? C.accent : '#e6e6ec', it.on ? B : M);
            btn(cv, 'rail_' + it.k, x + 6, y - 2, w - 12, step - 4, it.run, 16);
        });
        // what plays, and whose library this is
        let by = A.y + A.h - 12;
        const cl = S.st && S.st.client, srv = cl && cl.server;
        if (srv) {
            by -= 50;
            cv.text(fit(cv, srv.name, 16, w - 36, B), x + 20, by + 20, 16, C.grey, B);
            cv.text(fit(cv, (S.st.account && S.st.account.user) || '', 14, w - 36, M), x + 20, by + 40, 14, C.dim, M);
        }
        if (S.active()) {
            by -= 58;
            const p = S.pb();
            cv.roundRect(x + 8, by, w - 16, 50, 16, C.pill);
            if (p.state === 'paused') { cv.fillRect(x + 24, by + 16, 5, 18, C.accent); cv.fillRect(x + 34, by + 16, 5, 18, C.accent); }
            else cv.quad([[x + 24, by + 14], [x + 24, by + 36], [x + 41, by + 25], [x + 41, by + 25]], C.accent);
            cv.text(fit(cv, p.item.title, 15, w - 80, B), x + 52, by + 22, 15, C.text, B);
            cv.text(hms(S.position()), x + 52, by + 40, 13, C.grey, M);
            btn(cv, 'rail_now', x + 8, by, w - 16, 50, () => { S.go('player'); S.overlayUntil = now() + 6000; }, 16);
        }
    }

    /* ---------- home ---------- */
    function connecting(cv, x0, A) {
        const w = A.right - x0, cl = S.st && S.st.client, y = A.y + 190;
        if (S.svcErr) return message(cv, x0, y, w, S.svcErrCode === 'ENOSVC' ? 'The Drivefin service is not installed' : 'Cannot reach the Drivefin service',
            S.svcErrCode === 'ENOSVC' ? 'In the MGU Store, install "Drivefin service" from this source, then restart the head unit once.' : S.svcErr);
        if (S.st && S.st.uplink && !S.st.uplink.online && (!cl || cl.state !== 'connected'))
            return message(cv, x0, y, w, 'No internet', 'The head unit is offline. Connect it in the MGU Store (Settings: Wi-Fi, a phone on USB, or an LTE stick), then come back.', cl && cl.error ? [cl.error] : null);
        if (cl && cl.state === 'error') return message(cv, x0, y, w, 'Cannot reach your Jellyfin server', cl.error || '', (S.st.log || []).slice(-3));
        spinner(cv, x0 + w / 2, y - 60);
        message(cv, x0, y, w, 'Connecting to your Jellyfin server...', cl && cl.server ? cl.server.name : '');
        return null;
    }
    function row(cv, key, label, list, x0, y, w, kind) {
        cv.text(label, x0, y + 20, 21, C.text, B);
        const sz = POSTER.card, gap = 16, n = Math.max(1, Math.floor((w + gap) / (sz[0] + gap)));
        list.slice(0, n).forEach((it, i) => {
            const x = x0 + i * (sz[0] + gap), py = y + 34;
            const ep = it.type === 'episode', se = it.type === 'season';
            poster(cv, it, x, py, sz, ep || se ? { path: it.grandparentThumb || it.parentThumb || it.thumb } : null);
            cv.text(fit(cv, ep ? it.grandparentTitle : se ? it.parentTitle : it.title, 15, sz[0], B), x, py + sz[1] + 20, 15, C.text, B);
            cv.text(fit(cv, ep ? epTag(it) + '  ' + it.title : se ? it.title : it.year ? String(it.year) : '', 13, sz[0], M), x, py + sz[1] + 38, 13, C.grey, M);
            // "continue watching": straight into the film where it was; elsewhere its page
            btn(cv, key + it.key, x, py, sz[0], sz[1] + 40, kind === 'deck' ? () => S.play(it, it.viewOffset || 0) : () => S.open(it), 10);
        });
    }
    function drawHome(cv, A, x0) {
        const w = A.right - x0, h = S.home;
        if (!S.connected()) return connecting(cv, x0, A);
        S.loadHome(false);
        if (!h.at && h.loading) { spinner(cv, x0 + w / 2, A.y + 150); return message(cv, x0, A.y + 220, w, 'Loading your library...', ''); }
        if (h.error && !h.sections.length) return message(cv, x0, A.y + 190, w, 'The library did not load', h.error, (S.st.log || []).slice(-3));
        let y = A.y + 4;
        if (h.deck.length) { row(cv, 'deck_', 'Continue watching', h.deck, x0, y, w, 'deck'); y += 256; }
        if (h.recent.length) row(cv, 'rec_', 'Recently added', h.recent, x0, y, w, 'recent');
        else if (!h.deck.length) message(cv, x0, A.y + 190, w, 'Nothing here yet', 'Choose a library on the left.');
        return null;
    }

    /* ---------- a library: a grid of posters ---------- */
    let scrollMax = 0, scrollOf = null;   // the list the page shows: { scroll } and how far it goes
    function drawLibrary(cv, A, x0) {
        const l = S.lib, w = A.right - x0;
        if (!l) return;
        if (!S.connected()) return connecting(cv, x0, A);
        // the bar: its name, how many, the order, unwatched only
        cv.text(fit(cv, l.title, 28, 420, B), x0, A.y + 34, 28, C.text, B);
        const tw = cv.textWidth(fit(cv, l.title, 28, 420, B), 28, B);
        if (l.total !== null) cv.text(String(l.total), x0 + tw + 16, A.y + 34, 20, C.dim, M);
        const sortLabel = (SORTS.filter((s) => s[0] === l.sort)[0] || SORTS[0])[1];
        const uw = pillW(cv, 'Unwatched'), sw = pillW(cv, 'Sort: ' + sortLabel);
        pill(cv, 'lib_unw', A.right - uw, A.y + 4, uw, 42, 'Unwatched', () => S.toggleUnwatched(), { on: l.unwatched });
        pill(cv, 'lib_sort', A.right - uw - 12 - sw, A.y + 4, sw, 42, 'Sort: ' + sortLabel, () => {
            S.picker = { title: 'Sort by', rows: SORTS.map((s) => ({ label: s[1], on: l.sort === s[0], run: () => { S.picker = null; S.setSort(s[0]); } })) };
        });
        const gy = A.y + 60, gh = A.bottom - gy;
        if (!l.items.length) {
            if (l.loading) { spinner(cv, x0 + w / 2, gy + 110); return; }
            return message(cv, x0, gy + 150, w, l.error ? 'This library did not load' : 'Nothing here', l.error || (l.unwatched ? 'Everything in it is watched.' : ''));
        }
        const sz = POSTER.grid, gap = 18, cols = Math.max(1, Math.floor((w + gap) / (sz[0] + gap))), rowH = sz[1] + 54;
        const rows = Math.ceil(l.items.length / cols);
        scrollMax = Math.max(0, rows * rowH - gh + 8); scrollOf = l;
        l.scroll = Math.max(0, Math.min(scrollMax, l.scroll));
        if (scrollMax > 0) cv.scroll = true;
        cv.clip(x0 - 4, gy, w + 8, gh);
        const r0 = Math.floor(l.scroll / rowH), r1 = Math.min(rows - 1, Math.floor((l.scroll + gh) / rowH));
        for (let r = r0; r <= r1; r++) {
            for (let c = 0; c < cols; c++) {
                const it = l.items[r * cols + c];
                if (!it) break;
                const x = x0 + c * (sz[0] + gap), y = gy + r * rowH - l.scroll;
                poster(cv, it, x, y, sz);
                cv.text(fit(cv, it.title, 16, sz[0], B), x, y + sz[1] + 22, 16, C.text, B);
                cv.text(it.year ? String(it.year) : '', x, y + sz[1] + 41, 14, C.grey, M);
                // (only what is whole on screen takes a tap: a row cut by the bar above would reach over it)
                if (y >= gy - 40 && y + sz[1] <= A.bottom + 60) btn(cv, 'li_' + it.key, x, Math.max(y, gy), sz[0], Math.min(sz[1] + 44, A.bottom - Math.max(y, gy)), () => S.open(it), 10);
            }
        }
        cv.noclip();
        // near its end: the next ones are asked for
        if (l.total !== null && l.items.length < l.total && l.scroll > scrollMax - rowH * 2) S.libMore();
        if (scrollMax > 0) {
            const th = Math.max(40, gh * gh / (rows * rowH));
            cv.roundRect(A.right + 2, gy + (gh - th) * (l.scroll / scrollMax), 4, th, 2, C.line);
        }
    }

    /* ---------- a show ---------- */
    function drawShow(cv, A, x0) {
        const sh = S.show, w = A.right - x0;
        if (!sh) return;
        back(cv, x0, A.y + 2);
        cv.text(fit(cv, sh.title, 28, w - 420, B), x0 + 68, A.y + 37, 28, C.text, B);
        if (sh.loading) { spinner(cv, x0 + w / 2, A.y + 200); return; }
        if (sh.error || !sh.seasons.length) return message(cv, x0, A.y + 220, w, sh.error ? 'This show did not load' : 'No seasons', sh.error || '');
        const se = sh.seasons[sh.sel], eps = sh.episodes[se.key] || { loading: true };
        // the season: a pill; a tap lists them all
        const label = se.title + (sh.seasons.length > 1 ? '   v' : ''), sw = pillW(cv, label);
        pill(cv, 'sh_season', A.right - sw, A.y + 6, sw, 42, label, sh.seasons.length > 1 ? () => {
            S.picker = { title: sh.title, rows: sh.seasons.map((x, i) => ({ label: x.title + '   (' + (x.leafCount || 0) + ')', on: i === sh.sel, run: () => { S.picker = null; S.selectSeason(i); } })) };
        } : null);
        // its poster on the left, the episodes on the right
        const sz = POSTER.detail, ly = A.y + 68;
        poster(cv, { title: sh.title, thumb: se.thumb || se.parentThumb }, x0, ly, [sz[0], Math.min(sz[1], A.bottom - ly)]);
        const lx = x0 + sz[0] + 28, lw = A.right - lx, gh = A.bottom - ly, rowH = 68;
        if (!eps.items) {
            if (eps.loading) spinner(cv, lx + lw / 2, ly + 120); else message(cv, lx, ly + 140, lw, 'The episodes did not load', eps.error || '');
            return;
        }
        scrollMax = Math.max(0, eps.items.length * rowH - gh); scrollOf = sh;
        sh.scroll = Math.max(0, Math.min(scrollMax, sh.scroll));
        if (scrollMax > 0) cv.scroll = true;
        cv.clip(lx - 4, ly, lw + 8, gh);
        eps.items.forEach((e, i) => {
            const y = ly + i * rowH - sh.scroll;
            if (y + rowH < ly || y > A.bottom) return;
            cv.roundRect(lx, y, lw, rowH - 8, 14, C.card);
            cv.text(String(e.index != null ? e.index : i + 1), lx + 34, y + 38, 22, C.grey, center(B));
            cv.text(fit(cv, e.title, 21, lw - 300, B), lx + 70, y + 28, 21, C.text, B);
            cv.text(fit(cv, e.summary || '', 15, lw - 300, M), lx + 70, y + 49, 15, C.dim, M);
            cv.text(e.duration ? dur(e.duration) : '', lx + lw - 70, y + 38, 17, C.grey, right(M));
            if (e.viewOffset > 0 && e.duration) {
                cv.roundRect(lx + lw - 210, y + 28, 70, 6, 3, C.line);
                cv.roundRect(lx + lw - 210, y + 28, Math.max(6, 70 * Math.min(1, e.viewOffset / e.duration)), 6, 3, C.accent);
            } else if (e.viewCount > 0) {
                cv.line(lx + lw - 44, y + 31, lx + lw - 38, y + 38, 3, C.green); cv.line(lx + lw - 38, y + 38, lx + lw - 26, y + 23, 3, C.green);
            }
            if (y >= ly - 20 && y + rowH - 8 <= A.bottom + 20) btn(cv, 'ep_' + e.key, lx, Math.max(y, ly), lw, rowH - 8, () => S.open(e), 14);
        });
        cv.noclip();
    }

    /* ---------- one film or episode ---------- */
    function drawDetail(cv, A, x0) {
        const d = S.detail, w = A.right - x0;
        if (!d) return;
        back(cv, x0, A.y + 2);
        if (!d.item) {
            if (d.loading) spinner(cv, x0 + w / 2, A.y + 200); else message(cv, x0, A.y + 220, w, 'This did not load', d.error || '');
            return;
        }
        const it = d.item, ep = it.type === 'episode', m = (it.media || [])[0] || null, sz = POSTER.detail, py = A.y + 68;
        poster(cv, it, x0, py, [sz[0], Math.min(sz[1], A.bottom - py)], ep ? { path: it.grandparentThumb || it.parentThumb || it.thumb } : null);
        const tx = x0 + sz[0] + 36, tw = A.right - tx;
        cv.text(fit(cv, ep ? it.grandparentTitle + '   ' + epTag(it) : it.genres && it.genres.length ? it.genres.join(', ') : '', 19, w - 80, M), x0 + 68, A.y + 36, 19, C.grey, M);
        let y = py + 34;
        cv.text(fit(cv, it.title, 38, tw, B), tx, y, 38, C.text, B);
        y += 34;
        const meta = [it.year, it.duration ? dur(it.duration) : null, it.contentRating, it.rating ? it.rating.toFixed(1) + ' / 10' : null,
            m ? (m.resolution ? (/^\d+$/.test(m.resolution) ? m.resolution + 'p' : m.resolution.toUpperCase()) : '') + (m.videoCodec ? ' ' + m.videoCodec.toUpperCase() : '') : null].filter(Boolean).join('    ');
        cv.text(fit(cv, meta, 19, tw, M), tx, y, 19, C.grey, M);
        y += 20;
        wrap(cv, it.summary || '', 18, tw, M, 4).forEach((ln) => { y += 26; cv.text(ln, tx, y, 18, '#d6d6de', M); });
        // play: where it was, or from the start
        y = Math.max(y + 30, py + 190);
        let bx = tx;
        const resume = it.viewOffset > 30 && (!it.duration || it.viewOffset < it.duration - 60);
        if (resume) {
            const lb = 'Resume  ' + hms(it.viewOffset), bw = pillW(cv, lb, 22) + 34;
            cv.roundRect(bx, y, bw, 58, 29, C.accent);
            cv.quad([[bx + 26, y + 18], [bx + 26, y + 40], [bx + 44, y + 29], [bx + 44, y + 29]], C.text);
            cv.text(lb, bx + 58, y + 37, 22, C.text, B);
            btn(cv, 'd_resume', bx, y, bw, 58, () => S.play(it, it.viewOffset), 29);
            bx += bw + 14;
            bx = pill(cv, 'd_start', bx, y, pillW(cv, 'From the start', 20), 58, 'From the start', () => S.play(it, 0), { size: 20 }) + 14;
        } else {
            const bw = 190;
            cv.roundRect(bx, y, bw, 58, 29, C.accent);
            cv.quad([[bx + 54, y + 18], [bx + 54, y + 40], [bx + 72, y + 29], [bx + 72, y + 29]], C.text);
            cv.text('Play', bx + 88, y + 37, 22, C.text, B);
            btn(cv, 'd_play', bx, y, bw, 58, () => S.play(it, 0), 29);
            bx += bw + 14;
        }
        const seen = it.viewCount > 0 && !resume;
        pill(cv, 'd_seen', bx, y, pillW(cv, seen ? 'Mark unwatched' : 'Mark watched', 20), 58, seen ? 'Mark unwatched' : 'Mark watched', () => S.markWatched(it, !seen), { size: 20 });
        // its tracks: the sound, the subtitles (burnt into the picture by the server)
        y += 78;
        if (m) {
            const a = m.audio.filter((s) => s.selected)[0] || m.audio[0], sub = m.subtitles.filter((s) => s.id === d.subtitle)[0];
            let px = tx;
            if (a) px = pill(cv, 'd_audio', px, y, Math.min(420, pillW(cv, 'Sound: ' + a.name, 17)), 44, 'Sound: ' + a.name, m.audio.length > 1 ? () => S.chooseAudio() : null, { size: 17, color: m.audio.length > 1 ? C.text : C.grey }) + 12;
            if (m.subtitles.length) pill(cv, 'd_subs', px, y, Math.min(420, pillW(cv, 'Subtitles: ' + (sub ? sub.name : 'Off'), 17)), 44, 'Subtitles: ' + (sub ? sub.name : 'Off'), () => S.chooseSubtitles(), { size: 17 });
        }
    }

    /* ---------- the on-screen keyboard, and a field it types into (search, signing in) ---------- */
    /** kb's keys in a block fw wide from (x0, ky), no lower than `bottom`; a tap runs press(id); enter: its own key's word */
    function keys(cv, kb, x0, ky, fw, bottom, press, enter) {
        const rows = kb.rows(), kh = Math.min(72, (bottom - ky) / rows.length - 8), unit = (fw - 9 * 8) / 10;
        rows.forEach((r, ri) => {
            const wide = (id) => (id === '#space' ? 4 : id.length > 1 ? 1.5 : 1);
            const total = r.reduce((a, id) => a + wide(id), 0), gapN = r.length - 1;
            let x = x0 + (fw - (total * unit + gapN * 8)) / 2;
            r.forEach((id) => {
                const kw = wide(id) * unit, y = ky + ri * (kh + 8);
                const label = id === '#shift' ? 'Shift' : id === '#back' ? 'Del' : id === '#layer' ? (kb.layer === '123' ? 'abc' : '123') : id === '#space' ? 'space' : id === '#enter' ? enter : id;
                cv.roundRect(x, y, kw, kh, 14, id === '#enter' ? C.accent : id === '#shift' && kb.layer === 'ABC' ? '#4c4c5a' : id[0] === '#' ? '#30303a' : C.card);
                cv.text(label, x + kw / 2, y + kh / 2 + 9, id.length > 1 ? 18 : 26, C.text, center(id.length > 1 ? B : M));
                btn(cv, 'k_' + ri + '_' + id, x, y, kw, kh, () => press(id), 14);
                x += kw + 8;
            });
        });
    }
    /** the end of s that fits into w (what is typed last is what shows) */
    function tail(cv, s, size, w) {
        s = clean(s);
        if (cv.textWidth(s, size, M) <= w) return s;
        let lo = 0, hi = s.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cv.textWidth('...' + s.slice(mid), size, M) <= w) hi = mid; else lo = mid + 1; }
        return '...' + s.slice(lo);
    }
    /** a text field: what was typed (a password as stars) or what to type; the caret while it is typed into; a tap runs tap */
    function field(cv, key, x, y, w, f, hint, on, tap) {
        // (one of several: the one typed into has a ring)
        if (on && tap) cv.roundRect(x - 3, y - 3, w + 6, 60, 30, C.accent);
        cv.roundRect(x, y, w, 54, 27, on ? '#32323d' : C.pill);
        const shown = tail(cv, KB.display(f), 24, w - 60);
        cv.text(shown || hint, x + 26, y + 36, 24, shown ? C.text : C.dim, M);
        if (on && Math.floor(now() / 500) % 2 === 0) cv.fillRect(x + 28 + (shown ? cv.textWidth(shown, 24, M) : 0), y + 12, 2, 30, C.accent);
        if (tap) btn(cv, key, x, y, w, 54, tap, 27);
    }

    /* ---------- search ---------- */
    function drawSearch(cv, A, x0) {
        const s = S.search, w = A.right - x0;
        if (!S.connected()) return connecting(cv, x0, A);
        const fw = 660;
        field(cv, 's_field', x0, A.y + 2, fw, s.field, 'Search films, shows, episodes', true, null);
        keys(cv, s.kb, x0, A.y + 74, fw, A.bottom, (id) => S.key(id), 'Find');
        // what was found
        const lx = x0 + fw + 30, lw = A.right - lx, ly = A.y + 2, gh = A.bottom - ly, rowH = 64;
        if (s.loading) { spinner(cv, lx + lw / 2, ly + 140); return null; }
        if (!s.results) { cv.text('Type a title, then Find.', lx + lw / 2, ly + 150, 20, C.dim, center(M)); return null; }
        if (!s.results.length) { message(cv, lx, ly + 150, lw, 'Nothing found', s.error || '"' + clean(s.q) + '"'); return null; }
        scrollMax = Math.max(0, s.results.length * rowH - gh); scrollOf = s;
        s.scroll = Math.max(0, Math.min(scrollMax, s.scroll));
        if (scrollMax > 0) cv.scroll = true;
        cv.clip(lx - 4, ly, lw + 8, gh);
        s.results.forEach((it, i) => {
            const y = ly + i * rowH - s.scroll;
            if (y + rowH < ly || y > A.bottom) return;
            cv.roundRect(lx, y, lw, rowH - 8, 14, C.card);
            cv.text(fit(cv, it.title, 21, lw - 40, B), lx + 20, y + 26, 21, C.text, B);
            const sub = it.type === 'episode' ? clean(it.grandparentTitle || '') + '   ' + epTag(it) : (it.type === 'show' ? 'Show' : 'Film') + (it.year ? '   ' + it.year : '');
            cv.text(fit(cv, sub, 15, lw - 40, M), lx + 20, y + 46, 15, C.grey, M);
            if (y >= ly - 20 && y + rowH - 8 <= A.bottom + 20) btn(cv, 'sr_' + it.key, lx, Math.max(y, ly), lw, rowH - 8, () => S.open(it), 14);
        });
        cv.noclip();
        return null;
    }

    /* ---------- signing in: the server's address, then Quick Connect (or a name and password) ---------- */
    let qrMemo = null;
    function qr(text) {
        if (!qrMemo || qrMemo.text !== text) qrMemo = { text, code: qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM) };
        return qrMemo.code;
    }
    const host = (u) => String(u || '').replace(/^https?:\/\//, '');
    const OFFLINE = 'The head unit is offline: connect it in the MGU Store (Settings) first.';
    function drawLink(cv, A) {
        const x0 = A.x + 20, w = A.w - 40, cl = S.st && S.st.client, si = S.st && S.st.signin;
        if (S.svcErr || !S.st || !si) {
            return message(cv, x0, A.y + 200, w, S.svcErrCode === 'ENOSVC' ? 'The Drivefin service is not installed' : S.svcErr ? 'Cannot reach the Drivefin service' : 'Starting...',
                S.svcErrCode === 'ENOSVC' ? 'In the MGU Store, install "Drivefin service" from this source, then restart the head unit once.' : S.svcErr || '');
        }
        const online = !S.st.uplink || S.st.uplink.online, step = S.signStep();
        if (step === 'server') drawServer(cv, A, x0, si, online);
        else if (step === 'password') drawPassword(cv, A, x0, si, cl, online);
        else drawQuick(cv, A, x0, si, cl, online);
        cv.text('Drivefin ' + (env.version || '') + '  -  an unofficial client, not affiliated with Jellyfin', A.right - 20, A.bottom - 8, 13, C.dim, right(M));
        return null;
    }
    /** step one: where the server is, typed here (the HMI gives an app no text field of its own) */
    function drawServer(cv, A, x0, si, online) {
        const g = S.sign, fw = 660;
        cv.text('Your Jellyfin server', x0, A.y + 46, 36, C.text, B);
        field(cv, 'sv_field', x0, A.y + 68, fw, g.addr, 'jellyfin.example.com', true, null);
        keys(cv, g.kb, x0, A.y + 138, fw, A.bottom, (id) => S.signKey(id), 'Connect');
        // what to type, and what came of it
        const lx = x0 + fw + 48, lw = A.right - lx - 20;
        cv.text('Type its address, as in a browser.', lx, A.y + 44, 23, C.text, B);
        [['jellyfin.example.com', 'https is tried first'], ['203.0.113.7:8096', 'a number, with its port'], ['example.com/jellyfin', 'a folder of a site']].forEach((e, i) => {
            const y = A.y + 66 + i * 52;
            cv.roundRect(lx, y, lw, 44, 12, C.card);
            cv.text(e[0], lx + 18, y + 29, 20, '#e6e6ec', M);
            cv.text(e[1], lx + lw - 18, y + 28, 15, C.dim, right(M));
        });
        wrap(cv, 'The car reaches the server over its internet connection: an address that only works on your home network will not answer on the road.', 16, lw, M, 3)
            .forEach((l, i) => cv.text(l, lx, A.y + 250 + i * 23, 16, C.grey, M));
        const y = A.y + 336;
        if (si.checking) { spinner(cv, lx + 22, y + 28); cv.text('Looking for a Jellyfin server there...', lx + 58, y + 35, 19, C.text, M); return; }
        pill(cv, 'sv_go', lx, y, 190, 58, 'Connect', () => S.serverFind(), { fill: C.accent, size: 22 });
        const note = si.error ? si.error : !online ? OFFLINE : '';
        if (note) wrap(cv, note, 17, lw, M, 3).forEach((l, i) => cv.text(l, lx, y + 90 + i * 24, 17, C.amber, M));
    }
    /** step two: Jellyfin's Quick Connect. Six digits here, entered in a Jellyfin that is signed in already */
    function drawQuick(cv, A, x0, si, cl, online) {
        const srv = si.server, refused = !!(cl && cl.state === 'refused');
        const qs = 250, qx = A.right - qs - 30, qy = A.y + 14, tw = qx - x0 - 40;
        cv.text(fit(cv, (refused ? 'Sign in again to ' : 'Sign in to ') + srv.name, 36, tw, B), x0, A.y + 46, 36, C.text, B);
        const where = fit(cv, 'Jellyfin' + (srv.version ? ' ' + srv.version : '') + '  at  ' + host(srv.url), 17, tw - 240, M);
        cv.text(where, x0, A.y + 76, 17, C.grey, M);
        if (srv.plain) cv.text('not encrypted (http)', x0 + cv.textWidth(where, 17, M) + 20, A.y + 76, 17, C.amber, M);
        ['1.   Open Jellyfin where you are signed in already: the app on your phone, or a browser.',
            '2.   There, open your user menu and choose  Quick Connect.',
            '3.   Enter the six digits shown here.'].forEach((l, i) => cv.text(fit(cv, l, 21, tw, M), x0, A.y + 122 + i * 34, 21, C.text, M));
        cv.text(fit(cv, 'No password is typed in the car. The sign-in is kept on this head unit only, and Sign out (Settings) deletes it.', 16, tw, M), x0, A.y + 230, 16, C.grey, M);
        // the code, a digit a box
        const cy = A.y + 256, code = si.code ? String(si.code) : '', n = Math.max(6, Math.min(8, code.length)), bw = 74, gap = 10;
        for (let i = 0; i < n; i++) {
            cv.roundRect(x0 + i * (bw + gap), cy, bw, 104, 16, code ? C.card : '#111116');
            if (code[i]) cv.text(code[i], x0 + i * (bw + gap) + bw / 2, cy + 73, 56, C.text, center(B));
        }
        const bx = x0 + n * (bw + gap) + 20;
        if (code) {
            const left = Math.max(0, Math.round((si.expires - now()) / 60000));
            cv.text('Waiting for you to enter it...', bx, cy + 36, 21, C.text, B);
            cv.text('The code is good for ' + left + ' more minute' + (left === 1 ? '' : 's') + '.', bx, cy + 63, 17, C.grey, M);
            pill(cv, 'ln_cancel', bx, cy + 72, 130, 40, 'Cancel', () => S.linkCancel(), { size: 17 });
        } else {
            const asking = si.asking && !si.error;
            pill(cv, 'ln_get', bx, cy + 21, 230, 62, asking ? 'Asking the server...' : 'Get a code', asking ? null : () => S.linkStart(), { fill: asking ? C.pill : C.accent, size: 23 });
        }
        const note = si.error ? si.error : code ? '' : !online ? OFFLINE : refused ? (cl.error || 'The server no longer accepts this car\'s sign-in.') : '';
        if (note) cv.text(fit(cv, note, 18, tw, M), x0, cy + 138, 18, C.amber, M);
        // the other ways
        const oy = A.bottom - 62;
        const px = pill(cv, 'ln_pass', x0, oy, pillW(cv, 'Use a name and password', 17), 44, 'Use a name and password', () => S.usePassword(true), { size: 17 }) + 12;
        pill(cv, 'ln_other', px, oy, pillW(cv, 'Other server', 17), 44, 'Other server', () => S.serverOther(), { size: 17 });
        // the server's own page as a QR code: Jellyfin in a phone's browser, for a phone without the app
        cv.roundRect(qx, qy, qs, qs, 20, '#ffffff');
        const q = qr(srv.url + '/web/'), qn = q.size + 6, mm = (qs - 16) / qn;
        for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.getModule(x, y)) cv.fillRect(qx + 8 + (x + 3) * mm, qy + 8 + (y + 3) * mm, mm + 0.6, mm + 0.6, '#000000');
        cv.text('Jellyfin in a phone\'s browser', qx + qs / 2, qy + qs + 30, 17, C.text, center(B));
        cv.text(fit(cv, host(srv.url), 15, qs + 50, M), qx + qs / 2, qy + qs + 52, 15, C.grey, center(M));
    }
    /** a name and password instead: where Quick Connect is switched off, or when the owner asks for it */
    function drawPassword(cv, A, x0, si, cl, online) {
        const g = S.sign, srv = si.server, fw = 660, refused = !!(cl && cl.state === 'refused');
        cv.text(fit(cv, (refused ? 'Sign in again to ' : 'Sign in to ') + srv.name, 36, fw, B), x0, A.y + 46, 36, C.text, B);
        field(cv, 'pw_user', x0, A.y + 64, fw, g.user, 'Your Jellyfin user name', g.focus !== 'pass', () => S.signFocus('user'));
        field(cv, 'pw_pass', x0, A.y + 128, fw, g.pass, 'Password', g.focus === 'pass', () => S.signFocus('pass'));
        keys(cv, g.kb, x0, A.y + 196, fw, A.bottom, (id) => S.signKey(id), g.focus === 'pass' ? 'Sign in' : 'Next');
        const lx = x0 + fw + 48, lw = A.right - lx - 20;
        let y = A.y + 44;
        wrap(cv, srv.quick === false ? 'Quick Connect is switched off on this server, so it asks for your name and password.' : 'Your Jellyfin name and password, in place of Quick Connect.', 21, lw, B, 2)
            .forEach((l) => { cv.text(l, lx, y, 21, C.text, B); y += 28; });
        y += 4;
        wrap(cv, 'They go to the server once, to get this car a sign-in of its own, and are not kept in the car.', 17, lw, M, 3).forEach((l) => { cv.text(l, lx, y, 17, C.grey, M); y += 24; });
        if (srv.plain) {
            y += 6;
            wrap(cv, 'This address is not encrypted (http): the password travels as it is. Use an https address if the server has one.', 17, lw, M, 3).forEach((l) => { cv.text(l, lx, y, 17, C.amber, M); y += 24; });
        }
        cv.text(fit(cv, 'Jellyfin' + (srv.version ? ' ' + srv.version : '') + '  at  ' + host(srv.url), 15, lw, M), lx, y + 8, 15, C.dim, M);
        const by = A.y + 300;
        if (si.busy) { spinner(cv, lx + 22, by + 28); cv.text('Signing in...', lx + 58, by + 35, 19, C.text, M); }
        else pill(cv, 'pw_go', lx, by, 190, 58, 'Sign in', () => S.login(), { fill: C.accent, size: 22 });
        const note = si.error ? si.error : !online ? OFFLINE : refused && !si.busy ? (cl.error || 'The server no longer accepts this car\'s sign-in.') : '';
        if (note) wrap(cv, note, 17, lw, M, 2).forEach((l, i) => cv.text(l, lx, by + 88 + i * 24, 17, C.amber, M));
        const oy = A.bottom - 62;
        let px = lx;
        if (srv.quick !== false) px = pill(cv, 'pw_quick', px, oy, pillW(cv, 'Use Quick Connect', 17), 44, 'Use Quick Connect', () => S.usePassword(false), { size: 17 }) + 12;
        pill(cv, 'pw_other', px, oy, pillW(cv, 'Other server', 17), 44, 'Other server', () => S.serverOther(), { size: 17 });
    }

    /* ---------- the passenger disclaimer (Settings: Video while driving) ---------- */
    function drawConsent(cv, A, h) {
        const x0 = A.x + 60, w = A.w - 120;
        cv.text('Video while driving', x0, A.y + 56, 38, C.text, B);
        DISCLAIMER.forEach((l, i) => cv.text(l, x0, A.y + 112 + i * 32 + (i > 0 ? 10 : 0) + (i > 3 ? 12 : 0), i === 0 ? 23 : 20, i === 0 ? C.amber : '#e2e2ea', i === 0 ? B : M));
        const parked = env.parked(), y = A.bottom - 96;
        if (!parked) cv.text('Park the car to change this (selector in P, standing still). Now: ' + env.parkedWhy() + '.', x0, y - 18, 17, C.amber, M);
        const lb = 'I understand: switch it on', bw = pillW(cv, lb, 22) + 20;
        pill(cv, 'c_yes', x0, y, bw, 62, lb, parked ? () => h.accept() : null, { fill: parked ? C.accent : C.pill, color: parked ? C.text : C.dim, size: 22 });
        pill(cv, 'c_no', x0 + bw + 18, y, 220, 62, 'Leave it off', () => h.decline(), { size: 22 });
        cv.text('Without this, the picture shows only while the car is parked. The sound always plays.', x0 + bw + 262, y + 38, 16, C.grey, M);
        return w;
    }

    /* ---------- a list to pick from, over the page ---------- */
    function drawPicker(cv, A, fullH) {
        const p = S.picker;
        cv.fillRect(0, 0, W, fullH, A_(C.black, 0.72));
        const rowH = 58, n = Math.min(p.rows.length, Math.floor((A.h - 110) / rowH)), pw = 620, ph = 84 + n * rowH + 16;
        const px = (W - pw) / 2, py = A.y + Math.max(0, (A.h - ph) / 2);
        cv.roundRect(px, py, pw, ph, 26, '#1d1d24');
        cv.text(fit(cv, p.title, 24, pw - 60, B), px + 30, py + 48, 24, C.text, B);
        p.rows.slice(0, n).forEach((r, i) => {
            const y = py + 76 + i * rowH;
            cv.roundRect(px + 14, y, pw - 28, rowH - 8, 14, r.on ? C.accentDim : '#26262f');
            cv.text(fit(cv, r.label, 20, pw - 110, r.on ? B : M), px + 36, y + 32, 20, r.on ? C.accent : C.text, r.on ? B : M);
            if (r.on) cv.circle(px + pw - 44, y + 25, 7, C.accent);
            btn(cv, 'pk_' + i, px + 14, y, pw - 28, rowH - 8, r.run, 14);
        });
        btn(cv, 'pk_out', 0, 0, W, fullH, () => { S.picker = null; }, 0);     // a tap beside it closes it (drawn last: the rows are asked first)
    }

    function toast(cv, A) {
        const t = S.toast;
        if (!t || now() >= t.until) return;
        const s = fit(cv, t.text, 19, 900, B), tw = cv.textWidth(s, 19, B) + 56;
        cv.roundRect((W - tw) / 2, A.bottom - 60, tw, 46, 23, A_('#2c2c34', 0.97));
        cv.text(s, W / 2, A.bottom - 30, 19, C.text, center(B));
    }

    /* ---------- every page but the player ---------- */
    ui.draw = function (cv, A, fullH, consent) {
        scrollOf = null; scrollMax = 0; ui.scrub = null;
        cv.fillRect(0, 0, W, fullH, C.bg);
        mute = !!S.picker;
        if (S.page === 'consent') drawConsent(cv, A, consent);
        else if (S.page === 'link' || !S.signedIn()) drawLink(cv, A);
        else {
            rail(cv, A);
            const x0 = A.x + RAIL_W + 24;
            if (S.page === 'library') drawLibrary(cv, A, x0);
            else if (S.page === 'show') drawShow(cv, A, x0);
            else if (S.page === 'detail') drawDetail(cv, A, x0);
            else if (S.page === 'search') drawSearch(cv, A, x0);
            else drawHome(cv, A, x0);
        }
        mute = false;
        if (S.picker) drawPicker(cv, A, fullH);
        toast(cv, A);
    };
    /** the page's list moved by dy px (a finger, or the controller turned on it); false at its end */
    ui.scroll = function (dy) {
        if (!scrollOf || S.picker) return false;
        const was = scrollOf.scroll;
        scrollOf.scroll = Math.max(0, Math.min(scrollMax, was + dy));
        return scrollOf.scroll !== was;
    };

    /* ---------- the player ---------- */
    function ctl(cv, key, cx, cy, r, draw, fn, fill) {
        cv.circle(cx, cy, r, fill || A_('#ffffff', 0.16));
        draw(cx, cy);
        btn(cv, key, cx - r, cy - r, r * 2, r * 2, fn, r);
    }
    ui.drawPlayer = function (cv, A, fullH) {
        ui.scrub = null;
        cv.fillRect(0, 0, W, fullH, C.black);
        const p = S.pb() || { state: 'idle' }, it = p.item, t = now();
        const allowed = env.pictureAllowed(), pic = env.videoReady() && typeof cv.video === 'function';
        const live = it && (p.state === 'playing' || p.state === 'buffering' || p.state === 'paused' || p.state === 'loading');
        if (live && pic && allowed) cv.video(env.VID, 0, 0, W, fullH);
        const mid = fullH / 2, title = it ? (it.type === 'episode' ? clean(it.grandparentTitle || '') + '   ' + epTag(it) + '   ' + clean(it.title) : clean(it.title)) : '';

        // what the picture cannot say
        let head = null, sub = null, lines = null;
        if (!it || p.state === 'idle') { head = 'Nothing playing'; sub = 'Choose a film or an episode.'; }
        else if (p.state === 'error') { head = 'This did not play'; sub = p.error || ''; lines = ((S.st && S.st.log) || []).slice(-4); }
        else if (p.state === 'loading') { head = 'Starting...'; sub = title; }
        else if (p.state === 'ended') { head = 'The end'; sub = title; }
        else if (!allowed) { head = 'The picture is off while driving'; sub = 'The sound plays on. The picture comes back when the car is parked. For a passenger: Settings, Video while driving.'; }
        else if (!pic) { head = 'Waiting for the picture...'; sub = 'This needs a GPU renderer that shows video (mgu-render, from the MGU Store).'; }
        else if (p.state === 'buffering') { head = 'Buffering...'; sub = ''; }
        if (head) {
            if (p.state === 'loading' || p.state === 'buffering') spinner(cv, W / 2, mid - 92);
            cv.text(head, W / 2, mid - 24, 34, C.text, center(B));
            if (sub) wrap(cv, sub, 19, 980, M, 2).forEach((l, i) => cv.text(l, W / 2, mid + 16 + i * 27, 19, C.grey, center(M)));
            (lines || []).forEach((l, i) => cv.text(fit(cv, String(l), 14, W - 300, M), W / 2, mid + 84 + i * 20, 14, '#8a8a94', center(M)));
        }
        // why a film that plays is silent or dark, said over it
        const au = env.audio();
        const trouble = p.state !== 'playing' ? null : p.audioError ? 'No sound: ' + p.audioError : au.taken ? 'No sound: another app has the car\'s speakers'
            : au.error ? 'No sound: ' + au.error : p.videoError && allowed ? 'No picture: ' + p.videoError : null;
        if (trouble) {
            const s = fit(cv, trouble, 18, W - 500, M), sw = cv.textWidth(s, 18, M) + 48;
            cv.roundRect((W - sw) / 2, A.y + 4, sw, 40, 20, A_(C.black, 0.72));
            cv.text(s, W / 2, A.y + 30, 18, C.amber, center(M));
        }

        const ended = p.state === 'ended', counting = ended && S.nextAt > t && p.next;
        const show = !!it && (t < S.overlayUntil || p.state === 'paused' || !allowed || ended || p.state === 'error');
        const toggle = () => btn(cv, 'p_pic', 0, 0, W, fullH, () => { S.overlayUntil = t < S.overlayUntil ? 0 : t + 6000; }, 0);
        if (!show) { if (!it) back(cv, A.x, A.y); toggle(); return; }

        // the top: back, what plays, how
        cv.gradientRect(0, 0, W, 150, [[0, A_(C.black, 0.72)], [1, A_(C.black, 0)]]);
        back(cv, A.x, A.y);
        cv.text(fit(cv, title, 24, A.right - A.x - 420, B), A.x + 70, A.y + 35, 24, C.text, B);
        const how = [p.video && p.video.h ? p.video.h + 'p' : null, p.how, p.subtitles ? 'subtitles' : null].filter(Boolean).join('  -  ');
        if (how) cv.text(how, A.right, A.y + 35, 16, C.grey, right(M));

        // the bottom: the bar, the times, the buttons
        const by = A.bottom - 150;
        cv.gradientRect(0, by - 70, W, fullH - by + 70, [[0, A_(C.black, 0)], [0.5, A_(C.black, 0.72)], [1, A_(C.black, 0.9)]]);
        // (whole seconds: the bar then changes once a second, and no frame is sent in between)
        const pos = Math.floor(S.position()), d = p.duration || 0;
        const bx = A.x + 96, bw = A.right - A.x - 192, bary = by + 14;
        cv.text(hms(pos), bx - 14, bary + 9, 18, C.text, right(B));
        cv.text(d ? hms(d) : '', bx + bw + 14, bary + 9, 18, C.grey, M);
        cv.roundRect(bx, bary - 3, bw, 8, 4, A_('#ffffff', 0.25));
        if (d) {
            const f = Math.max(0, Math.min(1, pos / d));
            cv.roundRect(bx, bary - 3, Math.max(8, bw * f), 8, 4, C.accent);
            cv.circle(bx + bw * f, bary + 1, 11, C.text);
            ui.scrub = { x: bx - 20, y: bary - 30, w: bw + 40, h: 62, x0: bx, bw, dur: d };
        }
        const cy = by + 86, cx = W / 2;
        if (counting) {
            const left = Math.ceil((S.nextAt - t) / 1000);
            cv.text(fit(cv, 'Next:  ' + epTag(p.next) + '   ' + clean(p.next.title), 22, 700, B), cx - 40, cy - 6, 22, C.text, right(B));
            cv.text('starts in ' + Math.min(NEXT_S, left) + ' s', cx - 40, cy + 22, 17, C.grey, right(M));
            pill(cv, 'p_nextnow', cx - 16, cy - 30, 170, 58, 'Play now', () => S.playNext(), { fill: C.accent, size: 21 });
            pill(cv, 'p_nextno', cx + 168, cy - 30, 150, 58, 'Cancel', () => S.cancelNext(), { size: 21 });
        } else {
            ctl(cv, 'p_back10', cx - 150, cy, 34, (x, y) => cv.text('-10', x, y + 8, 21, C.text, center(B)), () => S.skip(-10));
            ctl(cv, 'p_play', cx, cy, 44, (x, y) => {
                if (PLAYS.indexOf(p.state) >= 0) { cv.fillRect(x - 13, y - 17, 9, 34, C.black); cv.fillRect(x + 4, y - 17, 9, 34, C.black); }
                else cv.quad([[x - 11, y - 19], [x - 11, y + 19], [x + 19, y], [x + 19, y]], C.black);
            }, () => S.pauseResume(), C.text);
            ctl(cv, 'p_fwd30', cx + 150, cy, 34, (x, y) => cv.text('+30', x, y + 8, 21, C.text, center(B)), () => S.skip(30));
            if (p.next) {
                const lb = 'Next  ' + epTag(p.next), nw = pillW(cv, lb, 18);
                pill(cv, 'p_next', cx + 220, cy - 24, nw, 48, lb, () => S.playNext(), { fill: A_('#ffffff', 0.16), size: 18 });
            }
            pill(cv, 'p_stop', A.right - 120, cy - 24, 120, 48, 'Stop', () => S.stop(), { fill: A_('#ffffff', 0.16), size: 18 });
        }
        toggle();
    };
    const PLAYS = ['loading', 'playing', 'buffering'];

    return ui;
}

module.exports = { createUi, clean, hms, dur, epTag, C, RAIL_W };
