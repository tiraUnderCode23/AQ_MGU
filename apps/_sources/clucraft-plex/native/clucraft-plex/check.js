'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// The deploy tool's check after an install: the service answers on its control socket (exit 0).
// (As amn-iptv's check.js, M850i-amn/idrive7-apps, GPL-3.0-or-later.)
const net = require('net');
const sockPath = process.argv[2] || '/run/clucraft-plex.sock';
let tries = 0;
function attempt() {
    const c = net.connect(sockPath);
    let buf = '';
    const t = setTimeout(() => { c.destroy(); retry('no answer'); }, 3000);
    c.on('connect', () => c.write('{"cmd":"status"}\n'));
    c.on('data', (d) => {
        buf += d;
        if (buf.indexOf('\n') < 0) return;
        clearTimeout(t);
        c.destroy();
        try {
            const s = JSON.parse(buf.slice(0, buf.indexOf('\n')));
            console.log('clucraft-plex ' + s.version + ' answers: ' + ((s.client && s.client.state) || '?'));
            process.exit(0);
        } catch (e) { retry('bad answer'); }
    });
    c.on('error', (e) => { clearTimeout(t); retry(e.code || e.message); });
}
function retry(why) {
    if (++tries >= 10) { console.error('clucraft-plex: ' + why); process.exit(1); }
    setTimeout(attempt, 1000);
}
attempt();
