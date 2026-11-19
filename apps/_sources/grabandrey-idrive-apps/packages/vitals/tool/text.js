/*
 * Vitals: text into an 8-bit coverage image (an r8 asset the shader samples), from the
 * glyphs scripts/bake_font.py baked into font.js. Keeps each named field's last box, so a
 * changed field costs one small rectangle upload, not the whole texture.
 *
 *   const tc = new TextCanvas(632, 572, FONT);
 *   const rects = tc.apply(fields);          // fields from view.js, only this canvas's
 *   const packed = tc.pack(rects);           // the rects' rows, one after another
 *
 * Works in Node (module.exports) and in a browser (window.VITALS_TEXT).
 */
(function (root) {
    function decode(b64) {
        if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
        var s = atob(b64), out = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    }

    function TextCanvas(w, h, font) {
        this.w = w; this.h = h; this.font = font;
        this.px = new Uint8Array(w * h);
        this.boxes = {};       // field id -> last drawn box
        this.texts = {};       // field id -> last spec key
        this.cache = {};       // style + char -> decoded bitmap
    }

    TextCanvas.prototype.glyph = function (style, ch) {
        var st = this.font[style];
        var g = st.glyphs[ch] || st.glyphs['?'];
        var k = style + '\u0000' + ch;
        if (!this.cache[k]) this.cache[k] = { adv: g[0], x: g[1], y: g[2], w: g[3], h: g[4], a: g[5] ? decode(g[5]) : null };
        return this.cache[k];
    };

    TextCanvas.prototype.measure = function (style, text, spacing) {
        var w = 0;
        for (var i = 0; i < text.length; i++) w += this.glyph(style, text[i]).adv + (i < text.length - 1 ? spacing || 0 : 0);
        return w;
    };

    /* draws text with its baseline at y, and after it the optional suffix ({ style, text, gap, dim }:
     * a unit in a smaller style, aligned as one with the text; dim < 1 draws it fainter, so it reads grey); returns the box it touched (clipped) or null */
    TextCanvas.prototype.draw = function (style, x, y, text, align, spacing, suffix) {
        if (!text) return null;
        var runs = [{ style: style, text: text, spacing: spacing || 0, before: 0, dim: 1 }];
        if (suffix && suffix.text) runs.push({ style: suffix.style, text: suffix.text, spacing: 0, before: suffix.gap || 0, dim: suffix.dim || 1 });
        var self = this, width = 0;
        runs.forEach(function (r) { width += r.before + self.measure(r.style, r.text, r.spacing); });
        var pen = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
        var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (var n = 0; n < runs.length; n++) {
            var run = runs[n];
            pen += run.before;
            for (var i = 0; i < run.text.length; i++) {
                var g = this.glyph(run.style, run.text[i]);
                if (g.a) {
                    var gx = Math.round(pen + g.x), gy = Math.round(y + g.y);
                    for (var r = 0; r < g.h; r++) {
                        var yy = gy + r;
                        if (yy < 0 || yy >= this.h) continue;
                        for (var c = 0; c < g.w; c++) {
                            var xx = gx + c;
                            if (xx < 0 || xx >= this.w) continue;
                            var v = Math.round(g.a[r * g.w + c] * run.dim), o = yy * this.w + xx;
                            if (v > this.px[o]) this.px[o] = v;
                        }
                    }
                    x0 = Math.min(x0, gx); y0 = Math.min(y0, gy); x1 = Math.max(x1, gx + g.w); y1 = Math.max(y1, gy + g.h);
                }
                pen += g.adv + (i < run.text.length - 1 ? run.spacing : 0);
            }
        }
        if (x1 < x0) return null;
        return clip({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, this.w, this.h);
    };

    TextCanvas.prototype.clear = function (b) {
        for (var r = 0; r < b.h; r++) this.px.fill(0, (b.y + r) * this.w + b.x, (b.y + r) * this.w + b.x + b.w);
    };

    /* draws the fields that changed; returns the rects to upload */
    TextCanvas.prototype.apply = function (fields) {
        var self = this, dirty = [];
        fields.forEach(function (f) {
            var sf = f.suffix;
            var key = [f.style, f.x, f.y, f.align, f.spacing, f.text, sf ? sf.style + '/' + sf.gap + '/' + sf.dim + '/' + sf.text : ''].join('|');
            if (self.texts[f.id] === key) return;
            self.texts[f.id] = key;
            var old = self.boxes[f.id];
            if (old) self.clear(old);
            var box = self.draw(f.style, f.x, f.y, f.text, f.align, f.spacing, f.suffix);
            self.boxes[f.id] = box;
            var u = union(old, box);
            if (u) dirty.push(u);
        });
        /* a cleared box may have held part of a neighbour: draw the neighbours again (rare) */
        if (dirty.length) {
            fields.forEach(function (f) {
                var b = self.boxes[f.id];
                if (b && dirty.some(function (d) { return overlap(d, b); })) self.draw(f.style, f.x, f.y, f.text, f.align, f.spacing, f.suffix);
            });
        }
        return dirty;
    };

    TextCanvas.prototype.pack = function (rects) {
        var n = 0;
        rects.forEach(function (r) { n += r.w * r.h; });
        var out = new Uint8Array(n), off = 0, px = this.px, w = this.w;
        rects.forEach(function (r) {
            for (var y = 0; y < r.h; y++) {
                out.set(px.subarray((r.y + y) * w + r.x, (r.y + y) * w + r.x + r.w), off);
                off += r.w;
            }
        });
        return out;
    };

    function clip(b, w, h) {
        var x0 = Math.max(0, b.x), y0 = Math.max(0, b.y), x1 = Math.min(w, b.x + b.w), y1 = Math.min(h, b.y + b.h);
        return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    }
    function union(a, b) {
        if (!a) return b; if (!b) return a;
        var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
    }
    function overlap(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }

    var API = { TextCanvas: TextCanvas };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    else root.VITALS_TEXT = API;
})(this);
