'use strict';
/**
 * svc.js - the app's line to the IPTV service (native/amn-iptv, /run/amn-iptv.sock): one short connection per
 * question, one JSON line out, one back (the service answers questions on a connection in the order they finish,
 * so questions never share one). The socket is the app's own group's: no other app can use the service.
 *
 *   const svc = require('./svc');
 *   const s = await svc.ask({ cmd: 'status' });     // rejects with code ENOSVC when the service is not installed
 *
 * Node 8.
 */
const net = require('net');
const SOCK = process.env.AMN_IPTV_SOCK || '/run/amn-iptv.sock';

function ask(m, timeoutMs) {
    return new Promise((resolve, reject) => {
        // a number: a local TCP port (tests on a computer, whose socket paths are short); else the unit's socket
        const c = net.connect(/^\d+$/.test(SOCK) ? { port: Number(SOCK), host: '127.0.0.1' } : SOCK);
        let buf = '', done = false;
        const finish = (err, v) => { if (done) return; done = true; clearTimeout(t); try { c.destroy(); } catch (e) { /* gone */ } if (err) reject(err); else resolve(v); };
        const t = setTimeout(() => finish(Object.assign(new Error('the IPTV service did not answer'), { code: 'ETIMEDOUT' })), timeoutMs || 15000);
        c.setEncoding('utf8');
        c.on('connect', () => c.write(JSON.stringify(m) + '\n'));
        c.on('data', (d) => {
            buf += d;
            const i = buf.indexOf('\n');
            if (i < 0) return;
            let v;
            try { v = JSON.parse(buf.slice(0, i)); } catch (e) { return finish(new Error('the IPTV service answered something unreadable')); }
            finish(null, v);
        });
        c.on('error', (e) => {
            if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') return finish(Object.assign(new Error('the IPTV service is not installed'), { code: 'ENOSVC' }));
            if (e.code === 'EACCES') return finish(Object.assign(new Error('the IPTV service is not open to this app yet: restart the head unit once'), { code: 'EACCES' }));
            finish(e);
        });
    });
}

module.exports = { ask, SOCK };
