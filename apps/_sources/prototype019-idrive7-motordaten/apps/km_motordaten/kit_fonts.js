'use strict';
/**
 * The fonts API kit_record.js and kit_canvas.js draw text with (get,
 * measure, glyph), over Motordaten's own glyph atlases: Barlow and Barlow
 * Semi Condensed (SIL OFL 1.1, shared/OFL-Barlow.txt), baked by
 * tools/fonts/bake.py.
 *
 *   label  Barlow Medium: words and units
 *   scale  Barlow Semi Condensed Medium: scales, peaks, small values
 *   num    Barlow Semi Condensed SemiBold: the big values (digits , . - only)
 *
 * The kit's other family names map onto these. Each atlas carries a key of
 * its own (kmmd-<face>@<size>-<content hash>), so the renderer's shared glyph texture never
 * mixes them up with another app's.
 */
const zlib = require('zlib');

const FACES = { label: require('./font_label.js'), scale: require('./font_scale.js'), num: require('./font_num.js') };
const FAMILY = { label: 'label', light: 'label', bold: 'label', scale: 'scale', num: 'num', gear: 'num' };
const families = Object.create(null);

/* An atlas; its pixels inflated when first asked for. */
function atlas(s) {
    const f = { size: s.size, ascent: s.ascent, descent: s.descent, atlasW: s.atlasW, atlasH: s.atlasH,
        glyphs: s.glyphs, key: s.key, _alpha: s.alpha, _pixels: null };
    Object.defineProperty(f, 'alpha', {
        get() { return this._pixels || (this._pixels = zlib.inflateSync(Buffer.from(this._alpha, 'base64'))); }
    });
    return f;
}

function family(name) {
    const face = FAMILY[name] || 'label';
    if (!families[face]) {
        families[face] = FACES[face].sizes.map(atlas);
    }
    return families[face];
}

/* Smallest baked size >= requested (downscaling looks better), else largest. */
function pick(fam, size) {
    let best = null;
    for (const f of fam) {
        if (f.size >= size && (!best || f.size < best.size)) {
            best = f;
        }
    }
    return best || fam.reduce((a, f) => (f.size > a.size ? f : a));
}

/** The atlas for text in family name at size. */
function get(name, size) {
    return pick(family(name), size);
}

/** The glyph for ch in atlas f, else "?" (or a space where "?" is not baked). */
function glyph(f, ch) {
    return f.glyphs[ch.codePointAt(0)] || f.glyphs[63] || f.glyphs[32];
}

function measure(f, s) {
    let w = 0;
    for (const ch of s) {
        const g = glyph(f, ch);
        if (g) {
            w += g[6];
        }
    }
    return w;
}

module.exports = { get, measure, glyph };
