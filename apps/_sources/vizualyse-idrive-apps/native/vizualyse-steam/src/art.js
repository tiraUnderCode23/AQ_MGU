// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * The games' pictures on the touch screen's cards: Steam's store picture
 * (capsule_616x353.jpg, else the store's header_image) when it could be
 * fetched, else the icon in the game's program on its plate colour, else
 * nothing (the plate alone, touch_view.js). Pictures are made at the exact
 * size the view draws (a library tile, the running game's thumb), in the
 * background one at a time, kept (the last few), and onReady() asks for a
 * redraw; until a picture is made the card shows without it.
 *
 *   const a = new Art({ dir, log, onReady, dns: () => server|null, uid, gid })
 *   a.picture(appId, w, h, { plate: 0xRRGGBB, exe, fade, dim })
 *                       { img, key } or null (not made yet, or nothing to show)
 *   a.want(appId)       fetch the store picture once (this start) if there is none
 *                       and the phone's DNS is there
 *   a.remove(appId)     its files and pictures gone (the game uninstalled)
 *
 * The fetch: a short Node child as the tool's uid through the phone's DNS
 * (root has no internet: steam.js storeName's way), the JPEG on its stdout,
 * at most 2 MB, written to <dir>/<appId>.jpg by us. A picture that doesn't
 * read (progressive, damaged) is remembered as such: the icon instead.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const jpeg = require('./jpeg.js');
const { exeIcon } = require('./ico.js');

const KEEP = 16;
const MAX_JPEG = 2 * 1024 * 1024;

/* the child that fetches: argv appId, the DNS server; the JPEG on stdout */
const FETCH = `
const dns = require('dns'), https = require('https'), url = require('url');
const id = process.argv[1], r = new dns.Resolver(); r.setServers([process.argv[2]]);
const lookup = (h, o, cb) => r.resolve4(h, (e, a) => (typeof o === 'function' ? o : cb)(e, a && a[0], 4));
function get(u, hops, cb) {
  const p = url.parse(u);
  https.get({ host: p.hostname, path: p.path, lookup: lookup, timeout: 15000 }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) { res.resume(); return get(url.resolve(u, res.headers.location), hops - 1, cb); }
    if (res.statusCode !== 200) { res.resume(); return cb(null); }
    const parts = []; let n = 0;
    res.on('data', (d) => { n += d.length; if (n > ${MAX_JPEG}) process.exit(1); parts.push(d); });
    res.on('end', () => cb(Buffer.concat(parts)));
  }).on('error', () => cb(null)).on('timeout', function () { this.abort(); });
}
const jpg = (b) => b && b.length > 4 && b[0] === 0xff && b[1] === 0xd8;
get('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' + id + '/capsule_616x353.jpg', 3, (b) => {
  if (jpg(b)) return process.stdout.write(b);
  get('https://store.steampowered.com/api/appdetails?filters=basic&appids=' + id, 2, (j) => {
    let u = null; try { const d = JSON.parse(String(j))[id]; u = d && d.success && d.data.header_image; } catch (e) { /* none */ }
    if (!u) return;
    get(u, 3, (h) => { if (jpg(h)) process.stdout.write(h); });
  });
});`;

/* ---- pixels --------------------------------------------------------------- */

/* the crop (sx, sy, sw, sh) of src scaled to dw x dh: area-averaged when
 * shrinking, bilinear when growing; alpha-weighted (no dark fringes) */
function scale(src, sx, sy, sw, sh, dw, dh) {
    const out = Buffer.alloc(dw * dh * 4), s = src.rgba, W = src.w, H = src.h;
    const kx = sw / dw, ky = sh / dh;
    for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            if (kx > 1 || ky > 1) {
                const x0 = sx + x * kx, x1 = x0 + kx, y0 = sy + y * ky, y1 = y0 + ky;
                for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
                    if (yy < 0 || yy >= H) continue;
                    for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
                        if (xx < 0 || xx >= W) continue;
                        const i = (yy * W + xx) * 4, al = s[i + 3];
                        r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; n++;
                    }
                }
            } else {
                const fx = Math.max(0, Math.min(W - 1, sx + (x + 0.5) * kx - 0.5)), fy = Math.max(0, Math.min(H - 1, sy + (y + 0.5) * ky - 0.5));
                const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
                [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]].forEach((p) => {
                    const i = (p[1] * W + p[0]) * 4, al = s[i + 3] * p[2];
                    r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; n += p[2];
                });
            }
            const o = (y * dw + x) * 4;
            if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
            out[o + 3] = n ? Math.round(a / n) : 0;
        }
    }
    return { w: dw, h: dh, rgba: out };
}

/* the poster filling w x h (cut to fit, centred) */
function cover(src, w, h) {
    const k = Math.max(w / src.w, h / src.h), cw = w / k, ch = h / k;
    return scale(src, (src.w - cw) / 2, (src.h - ch) / 2, cw, ch, w, h);
}

/* the icon, at most `side` px, on a plate of w x h, its top at `top` (centred when null) */
function onPlate(icon, w, h, plate, side, top) {
    const k = Math.min(side / icon.w, side / icon.h), iw = Math.max(1, Math.round(icon.w * k)), ih = Math.max(1, Math.round(icon.h * k));
    const im = scale(icon, 0, 0, icon.w, icon.h, iw, ih);
    const out = Buffer.alloc(w * h * 4), pr = (plate >> 16) & 255, pg = (plate >> 8) & 255, pb = plate & 255;
    for (let i = 0; i < w * h; i++) { out[i * 4] = pr; out[i * 4 + 1] = pg; out[i * 4 + 2] = pb; out[i * 4 + 3] = 255; }
    const ox = Math.round((w - iw) / 2), oy = top === null ? Math.round((h - ih) / 2) : top;
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
        const X = ox + x, Y = oy + y;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const s = (y * iw + x) * 4, d = (Y * w + X) * 4, a = im.rgba[s + 3] / 255;
        for (let c = 0; c < 3; c++) out[d + c] = Math.round(im.rgba[s + c] * a + out[d + c] * (1 - a));
    }
    return { w: w, h: h, rgba: out };
}

/* darker toward the bottom (the name drawn over it stays readable), and
 * dimmed all over for a game that can't be played now */
function finish(img, fade, dim) {
    /* the fade: from 28 % of the height, all of it by 56 % (a tile's name
     * starts at 53 %: touch_view.js), 86 % darker from there down */
    const p = img.rgba, w = img.w, h = img.h, from = h * 0.28, full = h * 0.56;
    for (let y = 0; y < h; y++) {
        const s = fade ? Math.max(0, Math.min(1, (y - from) / (full - from))) : 0;
        const t = s * s * (3 - 2 * s) * 0.86;
        const k = (1 - t) * (dim ? 0.42 : 1);
        if (k === 1) continue;
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            if (dim) { const l = (p[o] + p[o + 1] + p[o + 2]) / 3; for (let c = 0; c < 3; c++) p[o + c] = p[o + c] * 0.6 + l * 0.4; }
            for (let c = 0; c < 3; c++) p[o + c] = Math.round(p[o + c] * k);
            p[o + 3] = 255;
        }
    }
    img.opaque = true;
    return img;
}

class Art {
    constructor(o) {
        this.o = o;
        this.dir = o.dir;
        this.log = o.log || (() => {});
        this.made = new Map();      /* key -> img, the newest last */
        this.queue = [];
        this.queued = new Set();
        this.busy = false;
        this.tried = new Set();      /* store pictures asked for since the start */
        this.fetching = null;
        this.bad = new Set();        /* posters that don't read */
        this.noIcon = new Set();
        this.icons = new Map();      /* exe -> icon, a few */
    }

    poster(appId) { return path.join(this.dir, appId + '.jpg'); }

    picture(appId, w, h, opts) {
        opts = opts || {};
        let src = null, ver = 0;
        try { ver = fs.statSync(this.poster(appId)).mtime.getTime(); src = this.bad.has(appId + ':' + ver) ? null : 'poster'; } catch (e) { /* none */ }
        if (!src && opts.exe && !this.noIcon.has(opts.exe)) src = 'icon';
        if (!src) return null;
        const key = [appId, src, ver, w, h, opts.fade ? 1 : 0, opts.dim ? 1 : 0, src === 'icon' ? opts.plate : ''].join(':');
        const img = this.made.get(key);
        if (img) { this.made.delete(key); this.made.set(key, img); return { img: img, key: key }; }
        if (!this.queued.has(key)) {
            this.queued.add(key);
            this.queue.push({ key: key, appId: appId, src: src, ver: ver, w: w, h: h, opts: opts });
            this._next();
        }
        return null;
    }

    _next() {
        if (this.busy || !this.queue.length) return;
        this.busy = true;
        setImmediate(() => {
            const j = this.queue.shift();
            let img = null;
            try { img = this._make(j); } catch (e) { this.log('art: ' + j.appId + ': ' + e.message); }
            this.queued.delete(j.key);
            if (img) {
                this.made.set(j.key, img);
                while (this.made.size > KEEP) this.made.delete(this.made.keys().next().value);
            }
            this.busy = false;
            if (img && this.o.onReady) this.o.onReady();
            this._next();
        });
    }

    _make(j) {
        const o = j.opts;
        if (j.src === 'poster') {
            let src;
            try { src = jpeg.decode(fs.readFileSync(this.poster(j.appId))); } catch (e) {
                this.bad.add(j.appId + ':' + j.ver);
                this.log('art: ' + j.appId + '\'s store picture: ' + e.message + ' (its icon instead)');
                if (this.o.onReady) setImmediate(this.o.onReady);   /* asked again: the icon */
                return null;
            }
            return finish(cover(src, j.w, j.h), o.fade, o.dim);
        }
        let icon = this.icons.get(o.exe);
        if (icon === undefined) {
            icon = exeIcon(o.exe);
            this.icons.set(o.exe, icon);
            while (this.icons.size > 8) this.icons.delete(this.icons.keys().next().value);
        }
        if (!icon) { this.noIcon.add(o.exe); return null; }
        /* a tile: the icon in its upper part, above the name; a thumb: centred */
        const side = o.fade ? Math.min(96, j.h - 140) : Math.min(100, j.h - 24);
        return finish(onPlate(icon, j.w, j.h, o.plate || 0x2c3850, side, o.fade ? 20 : null), false, o.dim);
    }

    want(appId) {
        if (this.tried.has(appId)) return;
        if (fs.existsSync(this.poster(appId))) { this.tried.add(appId); return; }
        const server = this.o.dns && this.o.dns();
        if (!server) return;                      /* no phone yet: asked again later */
        this.tried.add(appId);
        this._fetches = (this._fetches || []).concat([[appId, server]]);
        this._fetchNext();
    }

    _fetchNext() {
        if (this.fetching || !this._fetches || !this._fetches.length) return;
        const [appId, server] = this._fetches.shift();
        this.fetching = appId;
        const parts = [];
        let n = 0, done = false;
        const end = () => {
            if (done) return;
            done = true;
            this.fetching = null;
            const b = Buffer.concat(parts);
            if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
                try {
                    try { fs.mkdirSync(this.dir, 0o755); } catch (e) { if (e.code !== 'EEXIST') throw e; }
                    fs.writeFileSync(this.poster(appId) + '.tmp', b, { mode: 0o644 });
                    fs.renameSync(this.poster(appId) + '.tmp', this.poster(appId));
                    this.log('art: ' + appId + '\'s store picture (' + Math.round(b.length / 1024) + ' KB)');
                    if (this.o.onReady) this.o.onReady();
                } catch (e) { this.log('art: ' + appId + ': ' + e.message); }
            } else this.log('art: no store picture for ' + appId);
            this._fetchNext();
        };
        try {
            const p = spawn(process.execPath, ['-e', FETCH, String(appId), server], { uid: this.o.uid, gid: this.o.gid, stdio: ['ignore', 'pipe', 'ignore'] });
            p.stdout.on('data', (d) => { n += d.length; if (n <= MAX_JPEG) parts.push(d); });
            p.on('exit', end);
            p.on('error', end);
            setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } }, 40000);
        } catch (e) { end(); }
    }

    remove(appId) {
        [this.poster(appId), this.poster(appId) + '.tmp'].forEach((f) => { try { fs.unlinkSync(f); } catch (e) { /* none */ } });
        Array.from(this.made.keys()).filter((k) => k.split(':')[0] === String(appId)).forEach((k) => this.made.delete(k));
        this.tried.delete(appId);
    }
}

module.exports = { Art, scale, cover, onPlate, finish };
