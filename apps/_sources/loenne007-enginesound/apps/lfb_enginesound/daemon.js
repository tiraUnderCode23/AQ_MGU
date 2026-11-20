'use strict';
/**
 * daemon.js - the line protocol to the Engine Sound service (tool lfb-enginesound, esd.js) on its Unix socket.
 * Reconnects by itself; send() while disconnected drops the line, except the sticky ones (ENGINE / OUT / E / T / V / M and
 * the X line of every sound setting), which are sent again on every (re)connect so the service always has the app's
 * state.
 */
const net = require('net');
const EventEmitter = require('events');

const SOCK = process.env.ES_CTL_SOCK || '/run/lfb-enginesound/ctl.sock';
const STICKY = ['ENGINE', 'OUT', 'E', 'T', 'V', 'M'];   // (in this order: the engine before the device)

class Daemon extends EventEmitter {
    constructor(log, sock) {
        super();
        this.log = log; this.path = sock || SOCK;
        this.sock = null; this.connected = false; this.sticky = {}; this.status = null; this.shm = null;
        this.fails = 0;
        this._connect();
        setInterval(() => this.send('STATUS'), 5000);
    }

    _connect() {
        const s = net.connect(this.path);
        this.sock = s;
        let buf = '';
        s.on('connect', () => {
            this.connected = true; this.fails = 0;
            this.log.info('service: connected');
            STICKY.concat(Object.keys(this.sticky).filter((k) => k.charAt(0) === 'X')).forEach((k) => { if (this.sticky[k]) s.write(this.sticky[k] + '\n'); });
            s.write('STATUS\nSHM\n');
            this.emit('change');
        });
        s.on('data', (d) => {
            buf += d.toString();
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const l = buf.slice(0, i); buf = buf.slice(i + 1);
                let o = null;
                try { o = JSON.parse(l); } catch (e) { continue; }
                if (o.type === 'status') this.status = o;
                if (o.type === 'shm') this.shm = o;
                this.emit('change');
            }
        });
        s.on('error', (e) => { if (this.fails++ % 30 === 0) this.log.warn('service: ' + (e.code || e)); });
        s.on('close', () => {
            const was = this.connected;
            this.connected = false; this.sock = null;
            if (was) { this.log.warn('service: disconnected'); this.emit('change'); }
            setTimeout(() => this._connect(), 2000);
        });
    }

    send(line) {
        const w = line.split(' '), k = w[0] === 'X' ? 'X ' + w[1] : w[0];     // (a sound setting: kept per name)
        if (w[0] === 'X' || STICKY.indexOf(k) >= 0) this.sticky[k] = line;
        if (this.connected && this.sock) { try { this.sock.write(line + '\n'); } catch (e) { /* reconnects */ } }
    }
}

module.exports = { Daemon };
