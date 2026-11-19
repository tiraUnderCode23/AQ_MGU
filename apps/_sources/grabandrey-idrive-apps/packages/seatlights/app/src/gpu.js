'use strict';
/*
 * Light Logger: the app's connection to the head unit's GPU renderer (MGU Store's mgu-render, or a community
 * renderer on /run/mgu-renderd/renderd.sock), which draws the app's own screen over the HMI page.
 * The wire format is the renderd protocol as idrive7-apps' kit/runtime/renderd.js (MIT) speaks it, with
 * mgu-render's own dialect (mgu-render/1) asked for: the layer placement, touch in claimed rects, and
 * whether the renderer shows the app. Copied from packages/vitals/app/src/gpu.js (an app gets only its own folder on the car).
 *
 *   const gpu = new Gpu('ida_lightlog', log);
 *   gpu.on('ready', (screen, area) => gpu.place({ x, y, w, h, scale, ox, oy }));
 *   gpu.on('touch', (phase, x, y) => ...);       // 1 down, 2 move, 3 up; logical px
 *   gpu.on('closed', () => ...);                  // a touch outside our rects: the renderer hid us
 *   gpu.connect(); gpu.show(true); gpu.frame(recorder);
 *   gpu.picture(id, w, h, premultipliedRgba)    a colour picture, uploaded (IMAGE, 10: id, w, h, then the pixels) the
 *                                               first time a frame draws it (the recorder's op 18 lists it in rec.images)
 *
 * Messages: [type u32][length u32][payload, padded to 4 bytes], little endian.
 */
const net = require('net');
const fs = require('fs');
const EventEmitter = require('events');

const SOCKETS = ['/run/mgu-render/render.sock', '/run/mgu-renderd/renderd.sock'];
const M = { HELLO: 1, PLACE: 2, SHOW: 3, ATLAS: 4, FRAME: 7, CLAIM: 9, IMAGE: 10 };
const E = { READY: 101, TICK: 102, ERROR: 103, TOUCH: 105, CLOSED: 106 };
const X = { MODE: 0x4d520001, READY: 0x4d520101, STATE: 0x4d520102 };
const X_MODE_LAYER = 1;

function isSocket(p) { try { return fs.statSync(p).isSocket(); } catch (e) { return false; } }
function msg(type, payload) {
    const len = payload ? payload.length : 0;
    const b = Buffer.alloc(8 + len + ((4 - (len & 3)) & 3));
    b.writeUInt32LE(type, 0);
    b.writeUInt32LE(b.length - 8, 4);
    if (len) payload.copy(b, 8);
    return b;
}
function u32(type, arr) { const u = new Uint32Array(arr); return msg(type, Buffer.from(u.buffer)); }

class Gpu extends EventEmitter {
    constructor(appId, log, socketPaths) {
        super();
        this.appId = appId;
        this.log = log;
        this.paths = socketPaths || SOCKETS;
        this.sock = null;
        this.ready = false;
        this.closed = false;
        this.screen = null;
        this.area = null;           // where the HMI leaves room for apps (mgu-render/1), screen px
        this.native = false;
        this.placement = null;
        this.visible = false;
        this.claimed = null;
        this.sentAtlas = new Set();
        this.pictures = new Map();  // id -> { w, h, data }: pictures a frame may draw
        this.sentPictures = new Set();
        this.waiting = false;       // a frame is out, its tick not back yet
        this.sentAt = 0;
        this.inbuf = Buffer.alloc(0);
        this.retry = null;
        this.tries = 0;
    }

    /** a renderer is installed and running */
    static available(paths) { return (paths || SOCKETS).some(isSocket); }

    connect() {
        if (this.closed || this.sock) return this;
        const list = this.paths.filter(isSocket);
        if (!list.length) { this._again(10000); return this; }
        const path = list[this.tries % list.length];
        const s = net.createConnection(path);
        this.sock = s;
        s.on('connect', () => {
            this.inbuf = Buffer.alloc(0);
            this.sentAtlas.clear();
            this.sentPictures.clear();
            this.claimed = null;
            this.native = false;
            this.waiting = false;
            if (s.setNoDelay) s.setNoDelay(true);
            this._write(msg(M.HELLO, Buffer.concat([Buffer.from(this.appId), Buffer.from([0]), Buffer.from('proto=mgu-render/1')])));
        });
        s.on('data', (d) => this._data(d));
        s.on('error', (e) => { if (!this.ready) this.tries++; if (!this.errLogged) { this.errLogged = true; this.log.warn('renderer: ' + e.message); } });
        s.on('close', () => {
            const was = this.ready;
            this.sock = null;
            this.ready = false;
            this.waiting = false;
            if (was) { this.log.info('renderer: connection closed'); this.emit('lost'); }
            this._again(3000);
        });
        return this;
    }
    _again(ms) {
        if (this.closed || this.retry) return;
        this.retry = setTimeout(() => { this.retry = null; this.connect(); }, ms);
    }
    close() {
        this.closed = true;
        clearTimeout(this.retry);
        if (this.sock) this.sock.destroy();
    }
    _write(b) { return this.sock && !this.sock.destroyed ? this.sock.write(b) : false; }

    _data(d) {
        this.inbuf = this.inbuf.length ? Buffer.concat([this.inbuf, d]) : d;
        while (this.inbuf.length >= 8) {
            const type = this.inbuf.readUInt32LE(0), len = this.inbuf.readUInt32LE(4);
            if (this.inbuf.length < 8 + len) break;
            const p = this.inbuf.slice(8, 8 + len);
            this.inbuf = this.inbuf.slice(8 + len);
            if (type === X.READY && p.length >= 12) {
                this.native = true;
                this.area = p.length >= 44 ? { x: p.readInt32LE(28), y: p.readInt32LE(32), w: p.readInt32LE(36), h: p.readInt32LE(40) } : null;
            } else if (type === E.READY && p.length >= 12) {
                this.ready = true;
                this.errLogged = false;
                this.tries = 0;
                this.screen = { w: p.readUInt32LE(4), h: p.readUInt32LE(8) };
                if (this.native) this._write(u32(X.MODE, [X_MODE_LAYER]));
                this.log.info('renderer: screen ' + this.screen.w + 'x' + this.screen.h + (this.native ? ', mgu-render/1' : '') +
                    (this.area ? ', app area ' + JSON.stringify(this.area) : ''));
                this.emit('ready', this.screen, this.area);
                if (this.placement) this._sendPlace();
                if (this.visible) this._write(u32(M.SHOW, [1]));
            } else if (type === X.STATE && p.length >= 12) {
                this.emit('state', { onScreen: !!p.readUInt32LE(4), front: !!p.readUInt32LE(8) });
            } else if (type === E.TICK) {
                this.waiting = false;
                this.emit('tick');
            } else if (type === E.TOUCH && p.length >= 12) {
                this.emit('touch', p.readUInt32LE(0), p.readFloatLE(4), p.readFloatLE(8));
            } else if (type === E.CLOSED) {
                this.visible = false;
                this.emit('closed');
            } else if (type === E.ERROR) {
                this.log.warn('renderer error: ' + p.toString().replace(/\0+$/, ''));
            }
        }
    }

    /** x, y, w, h: the surface in screen px; logical content is drawn at logical * scale + (ox, oy) */
    place(pl) {
        const same = this.placement && ['x', 'y', 'w', 'h', 'scale', 'ox', 'oy'].every((k) => pl[k] === this.placement[k]);
        if (same) return;
        if (this.placement && (pl.w !== this.placement.w || pl.h !== this.placement.h)) { this.sentAtlas.clear(); this.sentPictures.clear(); }
        this.placement = Object.assign({}, pl);
        if (this.ready) this._sendPlace();
    }
    _sendPlace() {
        const p = this.placement, b = Buffer.alloc(28);
        b.writeInt32LE(p.x | 0, 0); b.writeInt32LE(p.y | 0, 4); b.writeInt32LE(p.w | 0, 8); b.writeInt32LE(p.h | 0, 12);
        b.writeFloatLE(p.scale, 16); b.writeFloatLE(p.ox || 0, 20); b.writeFloatLE(p.oy || 0, 24);
        this._write(msg(M.PLACE, b));
    }
    show(on) {
        on = !!on;
        if (on === this.visible) return;
        this.visible = on;
        if (this.ready) this._write(u32(M.SHOW, [on ? 1 : 0]));
    }
    /** touch in these rects (logical px) comes to us; elsewhere it is the HMI's */
    claim(rects) {
        if (!this.ready) return;
        const key = JSON.stringify(rects);
        if (key === this.claimed) return;
        const b = Buffer.alloc(4 + rects.length * 16);
        b.writeUInt32LE(rects.length, 0);
        rects.forEach((r, i) => ['x', 'y', 'w', 'h'].forEach((k, j) => b.writeFloatLE(r[k], 4 + i * 16 + j * 4)));
        this._write(msg(M.CLAIM, b));
        this.claimed = key;
    }
    /** a colour picture (premultiplied RGBA, rows top-down, at most 1024 a side) a frame may draw by its id */
    picture(id, w, h, data) {
        this.pictures.set(id, { w: w, h: h, data: data });
        this.sentPictures.delete(id);
    }

    /** a recording (ui.js Recorder): its glyph atlases and pictures go first, once per connection */
    frame(rec) {
        if (!this.ready || !this.placement) return false;
        rec.atlases.forEach((a) => {
            if (this.sentAtlas.has(a.id)) return;
            const head = Buffer.alloc(12);
            head.writeUInt32LE(a.id, 0); head.writeUInt32LE(a.w, 4); head.writeUInt32LE(a.h, 8);
            this._write(msg(M.ATLAS, Buffer.concat([head, a.alpha])));
            this.sentAtlas.add(a.id);
        });
        (rec.images || []).forEach((id) => {
            const p = this.pictures.get(id);
            if (!p || this.sentPictures.has(id)) return;
            const head = Buffer.alloc(12);
            head.writeUInt32LE(id, 0); head.writeUInt32LE(p.w, 4); head.writeUInt32LE(p.h, 8);
            this._write(msg(M.IMAGE, Buffer.concat([head, p.data])));
            this.sentPictures.add(id);
        });
        const w = rec.words();
        this.waiting = true;
        this.sentAt = Date.now();
        return this._write(msg(M.FRAME, Buffer.from(w.buffer, w.byteOffset, w.byteLength)));
    }
}

module.exports = { Gpu, SOCKETS };
