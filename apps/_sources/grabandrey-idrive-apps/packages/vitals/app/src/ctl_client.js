'use strict';
/*
 * The Vitals widget service's control socket (packages/vitals/tool/vitals.js): JSON lines,
 * one reply per request, in order. Reconnects every 3 s while the service is away.
 *
 *   const c = new CtlClient(path); c.on('state', (reply) => ...); c.on('down', () => ...);
 *   c.connect(); c.request({ op: 'set', settings: { mode: 'track' } });
 */
const net = require('net');
const EventEmitter = require('events');

const DEFAULT_PATH = '/run/ida-vitals-cluster/ctl.sock';

class CtlClient extends EventEmitter {
    constructor(socketPath) {
        super();
        this.path = socketPath || process.env.VITALS_CTL || DEFAULT_PATH;
        this.sock = null;
        this.connected = false;
        this.closed = true;
        this.buf = '';
        this.timer = null;
        this.poll = null;
    }
    connect() {
        this.closed = false;
        this._open();
    }
    close() {
        this.closed = true;
        clearTimeout(this.timer);
        clearInterval(this.poll);
        if (this.sock) this.sock.destroy();
    }
    request(obj) {
        if (!this.connected) return false;
        this.sock.write(JSON.stringify(obj) + '\n');
        return true;
    }
    /* asks for the state every `ms` while connected (the status line's live rpm) */
    watch(ms) {
        clearInterval(this.poll);
        this.poll = ms ? setInterval(() => this.request({ op: 'get' }), ms) : null;
    }
    _open() {
        if (this.closed || this.sock) return;
        const sock = net.connect(this.path);
        this.sock = sock;
        sock.setEncoding('utf8');
        sock.on('connect', () => {
            this.connected = true;
            this.emit('up');
            this.request({ op: 'get' });
        });
        sock.on('data', (d) => {
            this.buf += d;
            for (let n; (n = this.buf.indexOf('\n')) >= 0; this.buf = this.buf.slice(n + 1)) {
                let reply = null;
                try { reply = JSON.parse(this.buf.slice(0, n)); } catch (e) { continue; }
                if (reply.ok && reply.settings) this.emit('state', reply);
                else if (reply.ok) continue;
                else this.emit('refused', reply.error || 'refused');
            }
        });
        sock.on('error', () => { /* 'close' follows */ });
        sock.on('close', () => {
            const was = this.connected;
            this.sock = null;
            this.connected = false;
            this.buf = '';
            if (was || !this._downOnce) { this._downOnce = true; this.emit('down'); }
            if (!this.closed) this.timer = setTimeout(() => this._open(), 3000);
        });
    }
}

module.exports = { CtlClient, DEFAULT_PATH };
