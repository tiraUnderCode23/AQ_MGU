'use strict';
// Node 8 compatible. The daemon queues local callers, then holds their turn
// until the socket closes. Idle app/proxy/ENET connections never take a turn.
const net = require('net');
const SOCKET = '/run/mgu-obd-adapter/tasu-lock.sock';
function acquire(options) {
    const o = options || {};
    let socket;
    const waiting = new Promise((resolve, reject) => {
        socket = net.createConnection(o.socket || SOCKET);
        let granted = false, released = false, text = '', rejectLost;
        const lost = new Promise((_, fail) => { rejectLost = fail; });
        lost.catch(() => {});
        const timer = setTimeout(() => {
            socket.destroy(); reject(new Error('Timed out waiting for diagnostic transport'));
        }, o.timeoutMs || 85000);
        socket.on('data', data => {
            text += data.toString('ascii');
            if (granted || text.length > 6 || text !== 'ready\n'.slice(0, text.length)) {
                socket.destroy(new Error('Invalid diagnostic transport grant')); return;
            }
            if (text !== 'ready\n') return;
            granted = true; clearTimeout(timer);
            resolve({ lost, release() { released = true; socket.destroy(); } });
        });
        socket.on('error', error => {
            clearTimeout(timer);
            if (!granted) reject(error); else if (!released) rejectLost(error);
        });
        socket.on('close', () => {
            clearTimeout(timer);
            const error = new Error('Diagnostic transport coordinator disconnected');
            if (!granted) reject(error); else if (!released) rejectLost(error);
        });
    });
    waiting.cancel = () => socket.destroy();
    return waiting;
}
module.exports = { acquire };
