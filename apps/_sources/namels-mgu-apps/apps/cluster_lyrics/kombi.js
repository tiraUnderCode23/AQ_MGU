'use strict';
/*
 * Lyrics in the instrument cluster's map window (cluster-render target `map`,
 * 1088x480 on iDrive 7).
 *
 * Four image layers of class `overlay`: an opaque, exclusive background that
 * hides whatever is drawn below it in the map window (the Waze map of
 * waze-on-cluster is class `content`), a header, the current line and the next
 * line. Only text that changed is uploaded. Hiding the layers releases the
 * map window, so Waze or BMW's own map comes back by itself.
 *
 * guide_hold is 0: BMW's turn box stays visible while lyrics are shown.
 * Nothing is drawn on the `panel` target (speedometer, warnings).
 */
const lrc = require('./lrc.js');
const font = require('./lyric_font.js');

const MAP_W = 1088, MAP_H = 480;
const MARGIN = 16, TEXT_W = MAP_W - 2 * MARGIN;
const HEAD = { y: 30, h: 40 }, CUR = { y: 140, h: 156 }, NEXT = { y: 338, h: 46 };
const CUR_SIZES = [56, 48, 40, 34], LINE_GAP = 1.22;
const MIN_REDRAW_MS = 350;
const COLORS = { white: '#f4f7fa', green: '#3ddc84', amber: '#ffb347', blue: '#6cb8ff' };
const DIM = '#93a1b0', HEAD_COLOR = '#b8c4d0';

function backgroundPixels() {
    // 16x16, stretched bilinearly over the whole map window: a soft vertical gradient.
    const d = Buffer.alloc(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4, k = y / 15;
        d[i] = Math.round(13 - 7 * k); d[i + 1] = Math.round(19 - 9 * k); d[i + 2] = Math.round(27 - 12 * k); d[i + 3] = 255;
    }
    return d;
}
/** Current line(s), centred in the CUR band. -> { surface, rows: [y0, y1) } */
function renderCurrent(text, color, gap) {
    const s = font.surface(TEXT_W, CUR.h);
    if (gap || !text) {
        font.draw(s, 'bold', '♪', TEXT_W / 2, CUR.h / 2 + 18, 48, DIM, { align: 'center' });
        return { surface: s, rows: [Math.floor(CUR.h / 2 - 30), Math.ceil(CUR.h / 2 + 34)] };
    }
    const fitted = lrc.fit(text, TEXT_W - 24, 2, CUR_SIZES, (str, size) => font.measure('bold', str, size));
    const size = fitted.size, step = size * LINE_GAP, n = Math.max(1, fitted.lines.length);
    const block = (n - 1) * step + size;
    const first = (CUR.h - block) / 2 + size * 0.80;
    fitted.lines.forEach((line, i) => font.draw(s, 'bold', line, TEXT_W / 2, first + i * step, size, color, { align: 'center' }));
    return { surface: s, rows: [Math.max(0, Math.floor(first - size)), Math.min(CUR.h, Math.ceil(first + (n - 1) * step + size * 0.36))] };
}
function renderSingle(text, h, sizes, color, face) {
    const s = font.surface(TEXT_W, h);
    if (text) {
        const fitted = lrc.fit(text, TEXT_W - 24, 1, sizes, (str, size) => font.measure(face, str, size));
        if (fitted.lines.length)
            font.draw(s, face, fitted.lines[0], TEXT_W / 2, h * 0.72, fitted.size, color, { align: 'center' });
    }
    return s;
}
function headText(title, artist) {
    return artist ? title + '  \u2013  ' + artist : title;
}
/** Header "Title - Artist": a long title is shortened first, so the artist stays readable. */
function renderHead(title, artist) {
    const sizes = [26, 23, 20], small = sizes[sizes.length - 1], max = TEXT_W - 24;
    let text = headText(title, artist);
    if (artist && font.measure('regular', text, small) > max) {
        const tail = '\u2026  \u2013  ' + artist;
        const room = max - font.measure('regular', tail, small);
        if (room > 200) {
            let cut = title;
            while (cut.length > 1 && font.measure('regular', cut, small) > room) cut = cut.slice(0, -1).trim();
            text = cut + tail;
        }
    }
    return renderSingle(text, HEAD.h, sizes, HEAD_COLOR, 'regular');
}

class KombiLyrics {
    constructor(log, options) {
        options = options || {};
        this.log = log || console;
        this.now = options.now || Date.now;
        const Client = options.ClusterRender || require('./cluster_render_client.js').ClusterRender;
        this.cr = new Client('cluster_lyrics', options.socketPath);
        this.trace = options.trace || (() => {});
        this.options = { accent: 'white', showNext: true, takeOverBmwMap: false };
        this.refs = null;            // { bg, head, cur, next }
        this.visible = false;
        this.wanted = null;          // content asked for by show()
        this.drawn = { head: null, cur: null, next: null, color: null };
        this.curRows = null;
        this.lastRedrawAt = 0;
        this.mapTarget = { state: 'idle', holder: '', reason: '' };
        this.layerStates = {};
        this.lastRefused = '';
        this.budget = '';
        this.uploadedBytes = 0;
        this.hideReason = 'not started';
        this.started = false;
        this.cr.on('ready', () => { this._trace('renderer ready backend=' + this.cr.backend + ' targets=' + this.cr.targets); this._apply(); });
        this.cr.on('disconnected', () => this._trace('renderer disconnected'));
        this.cr.on('layer', (ref, state, reason) => {
            const name = this._name(ref);
            if (!name) return;
            const text = state + (reason ? ' (' + reason + ')' : '');
            if (this.layerStates[name] !== text) { this.layerStates[name] = text; this._trace('layer ' + name + ': ' + text); }
        });
        this.cr.on('target', (target, state, holder, reason) => {
            if (target !== 'map') return;
            const next = { state: state || '', holder: holder || '', reason: reason || '' };
            if (next.state !== this.mapTarget.state || next.holder !== this.mapTarget.holder || next.reason !== this.mapTarget.reason)
                this._trace('map window: ' + next.state + (next.holder ? ' holder=' + next.holder : '') + (next.reason ? ' (' + next.reason + ')' : ''));
            this.mapTarget = next;
        });
        this.cr.on('refused', (op, ref, reason) => {
            this.lastRefused = String(op || '') + ': ' + String(reason || '');
            this._trace('renderer refused ' + this.lastRefused);
        });
        this.cr.on('budget', (cap, max, reason) => { this.budget = cap + '/' + max + ' KB/s' + (reason ? ' ' + reason : ''); });
    }
    _trace(message) { try { this.trace(message); } catch (_) {} }
    _name(ref) {
        if (!this.refs) return null;
        return Object.keys(this.refs).find(k => this.refs[k] === ref) || null;
    }
    start() { if (!this.started) { this.started = true; this.cr.connect(); } }
    close() { this.release('closing'); this.started = false; this.cr.close(); }

    /** The map window's size from the service's hello, or null. */
    mapSize() {
        const m = /(?:^|,)map:(\d+)x(\d+)/.exec(String(this.cr.targets || ''));
        return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
    }
    supported() {
        const size = this.mapSize();
        return !!this.cr.ready && !!size && size.w === MAP_W && size.h === MAP_H;
    }
    configure(options) {
        const before = this.options;
        this.options = Object.assign({}, before, options);
        if (this.refs && before.takeOverBmwMap !== this.options.takeOverBmwMap)
            Object.keys(this.refs).forEach(k => this.cr.set(this.refs[k], { contend: !!this.options.takeOverBmwMap }));
        this._apply();
    }
    /** content: { title, artist, current, next, gap } */
    show(content) {
        this.wanted = content;
        this.hideReason = '';
        this._apply();
    }
    /** Hide the lyrics; the map window is given back. */
    hide(reason) {
        this.wanted = null;
        if (this.refs && this.visible) {
            Object.keys(this.refs).forEach(k => this.cr.set(this.refs[k], { visible: false }));
            this._trace('hidden: ' + (reason || 'no reason given'));
        }
        this.visible = false;
        if (reason) this.hideReason = reason;
    }
    /** Drop every layer: nothing of this app is left on the cluster. */
    release(reason) {
        this.hide(reason);
        if (this.refs) {
            Object.keys(this.refs).forEach(k => this.cr.drop(this.refs[k]));
            this._trace('layers dropped' + (reason ? ': ' + reason : ''));
        }
        this.refs = null; this.layerStates = {};
        this.drawn = { head: null, cur: null, next: null, color: null };
        this.curRows = null;
    }
    _make() {
        const common = { target: 'map', klass: 'overlay', visible: false, guide_hold: false,
            contend: !!this.options.takeOverBmwMap };
        const image = (extra) => this.cr.image(Object.assign({}, common, extra));
        const refs = {
            bg: image({ x: 0, y: 0, w: MAP_W, h: MAP_H, z: 0, iw: 16, ih: 16, sampling: 'bilinear', exclusive: true }),
            head: image({ x: MARGIN, y: HEAD.y, w: TEXT_W, h: HEAD.h, z: 1 }),
            cur: image({ x: MARGIN, y: CUR.y, w: TEXT_W, h: CUR.h, z: 2 }),
            next: image({ x: MARGIN, y: NEXT.y, w: TEXT_W, h: NEXT.h, z: 3 }),
        };
        if (!refs.bg || !refs.head || !refs.cur || !refs.next) {
            Object.keys(refs).forEach(k => { if (refs[k]) this.cr.drop(refs[k]); });
            this._trace('layers refused by the client');
            return false;
        }
        this.refs = refs;
        this.cr.pixels(refs.bg, null, backgroundPixels());
        this._trace('layers created (map window, overlay, exclusive background)');
        return true;
    }
    _upload(ref, surface, rows) {
        let ok;
        if (rows) {
            const y0 = rows[0], y1 = rows[1];
            const px = surface.d.slice(y0 * surface.w * 4, y1 * surface.w * 4);
            ok = this.cr.pixels(ref, [{ x: 0, y: y0, w: surface.w, h: y1 - y0 }], px);
            if (ok) this.uploadedBytes += px.length;
        } else {
            ok = this.cr.pixels(ref, null, surface.d);
            if (ok) this.uploadedBytes += surface.d.length;
        }
        if (!ok) this._trace('pixel update refused by the client');
        return ok;
    }
    _apply() {
        const c = this.wanted;
        if (!c || !this.started) return;
        if (!this.supported()) {
            if (this.cr.ready && this.hideReason !== 'unsupported map window') {
                this.hideReason = 'unsupported map window';
                this._trace('not shown: map window is ' + JSON.stringify(this.mapSize()) + ', expected 1088x480');
            }
            return;
        }
        if (!this.refs && !this._make()) return;
        const color = COLORS[this.options.accent] || COLORS.white;
        const head = headText(c.title || '', c.artist || '');
        const next = this.options.showNext ? (c.next || '') : '';
        const cur = c.gap ? '\u0000gap' : (c.current || '');
        const first = !this.visible;
        const now = this.now();
        // Fast passages: do not redraw more often than the eye can use.
        if (!first && now - this.lastRedrawAt < MIN_REDRAW_MS && head === this.drawn.head) return;
        let changed = false;
        if (head !== this.drawn.head) {
            this._upload(this.refs.head, renderHead(c.title || '', c.artist || ''));
            this.drawn.head = head; changed = true;
        }
        if (cur !== this.drawn.cur || color !== this.drawn.color) {
            const r = renderCurrent(c.current || '', color, !!c.gap);
            // Send only the rows the old or the new text touches.
            const rows = this.curRows ? [Math.min(this.curRows[0], r.rows[0]), Math.max(this.curRows[1], r.rows[1])] : null;
            this._upload(this.refs.cur, r.surface, rows);
            this.curRows = r.rows; this.drawn.cur = cur; this.drawn.color = color; changed = true;
        }
        if (next !== this.drawn.next) {
            this._upload(this.refs.next, renderSingle(next, NEXT.h, [30, 26, 22], DIM, 'regular'));
            this.drawn.next = next; changed = true;
        }
        if (changed) this.lastRedrawAt = now;
        if (first) {
            Object.keys(this.refs).forEach(k => this.cr.set(this.refs[k], { visible: true }));
            this.visible = true;
            this._trace('visibility requested (takeOverBmwMap=' + !!this.options.takeOverBmwMap + ')');
        }
    }
    status() {
        return { ready: !!this.cr.ready, backend: this.cr.backend || '', mapSize: this.mapSize(), supported: this.supported(),
            visible: this.visible, layers: !!this.refs, map: this.mapTarget, layerStates: this.layerStates,
            lastRefused: this.lastRefused, budget: this.budget, uploadedKb: Math.round(this.uploadedBytes / 1024),
            hideReason: this.hideReason };
    }
}

module.exports = { KombiLyrics, renderCurrent, renderSingle, renderHead, headText, backgroundPixels,
    MAP_W, MAP_H, MARGIN, TEXT_W, HEAD, CUR, NEXT, COLORS };
