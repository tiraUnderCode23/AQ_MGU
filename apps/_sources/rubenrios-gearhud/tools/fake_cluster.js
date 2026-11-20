'use strict';
/**
 * Un cluster-render de mentira: habla el protocolo real (PROTOCOL.md v1) por un socket Unix, recuerda las capas
 * y sus píxeles, y compone lo que se vería. Para probar overlay.js sin coche. No imita al cuadro real: el orden
 * de composición sobre los relojes y la transparencia solo se pueden comprobar en el coche.
 */
const net = require('net');
const EventEmitter = require('events');

class FakeCluster extends EventEmitter {
    constructor(path) { super(); this.path = path; this.layers = new Map(); this.ops = []; this.frames = []; this.frameBytes = 0; this.socks = new Set(); }
    listen() { return new Promise((res) => { this.srv = net.createServer((s) => this._client(s)); this.srv.listen(this.path, res); }); }
    close() { this.socks.forEach((s) => s.destroy()); return new Promise((res) => this.srv.close(res)); }
    _send(s, o) { const b = Buffer.from(JSON.stringify(o)); const m = Buffer.alloc(5 + b.length); m.writeUInt32LE(b.length + 1, 0); m[4] = 0x4a; b.copy(m, 5); s.write(m); }
    _client(s) {
        this.socks.add(s);
        let buf = Buffer.alloc(0);
        s.on('error', () => {});
        s.on('close', () => { this.socks.delete(s); this.layers.clear(); });
        s.on('data', (d) => {
            buf = Buffer.concat([buf, d]);
            while (buf.length >= 5) {
                const len = buf.readUInt32LE(0);
                if (buf.length < 4 + len) break;
                const type = buf[4], body = buf.slice(5, 4 + len);
                buf = buf.slice(4 + len);
                if (type === 0x4a) this._json(s, JSON.parse(body.toString()));
                else if (type === 0x46) this._frame(s, body);
            }
        });
    }
    _json(s, m) {
        this.ops.push(m);
        if (m.op === 'hello') this._send(s, { ev: 'hello', proto: 1, backend: 'id7', targets: 'map:1088x480,panel:1920x720,hud:800x480' });
        else if (m.op === 'layer') { this.layers.set(m.ref, Object.assign({ visible: 1, px: null }, m)); this._send(s, { ev: 'layer', ref: m.ref, state: 'stalled', reason: 'no content' }); }
        else if (m.op === 'set') Object.assign(this.layers.get(m.ref) || {}, m);
        else if (m.op === 'drop') this.layers.delete(m.ref);
        this.emit('op', m);
    }
    _frame(s, b) {
        const ref = b.readUInt32LE(0), n = b.readUInt16LE(12), px = b.slice(14 + n * 8);
        this.frames.push({ ref, bytes: px.length });
        this.frameBytes += px.length;
        const l = this.layers.get(ref);
        if (l) { l.px = Buffer.from(px); this._send(s, { ev: 'layer', ref, state: 'shown', reason: '' }); }
    }
    visible(target) { return Array.from(this.layers.values()).filter((l) => l.target === target && l.visible && l.px); }
    /** Compone las capas visibles (alfa directo) sobre rgba, de w x h; escala cada capa al vecino más próximo. */
    compose(target, rgba, w, h) {
        this.visible(target).sort((a, b) => (a.z || 0) - (b.z || 0)).forEach((l) => {
            const iw = l.iw, ih = l.ih;
            for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
                const dx = l.x + x, dy = l.y + y;
                if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
                const si = (Math.floor(y * ih / l.h) * iw + Math.floor(x * iw / l.w)) * 4, di = (dy * w + dx) * 4, a = l.px[si + 3] / 255;
                if (!a) continue;
                for (let c = 0; c < 3; c++) rgba[di + c] = Math.round(l.px[si + c] * a + rgba[di + c] * (1 - a));
                rgba[di + 3] = Math.round(255 * (a + (rgba[di + 3] / 255) * (1 - a)));
            }
        });
    }
}
module.exports = FakeCluster;
