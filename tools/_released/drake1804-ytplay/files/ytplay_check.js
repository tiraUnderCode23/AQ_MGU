'use strict';
/*
 * mgu-deploy runs this after an install (component.json "check"): the player answers on its socket, or the install rolls
 * back by itself. Node 8.
 */
const net = require('net');

const SOCKET = process.argv[2] || '/run/drake1804-ytplay/ctl.sock';
const WAIT_MS = 15000;
const TRY_MS = 500;
const started = Date.now();

function fail(why) {
    console.error(`ytplay check: ${why}`);
    process.exit(1);
}

function attempt() {
    const s = net.connect(SOCKET);
    let buf = '';
    const again = (why) => {
        s.destroy();
        if (Date.now() - started > WAIT_MS) fail(why);
        setTimeout(attempt, TRY_MS);
    };
    s.setTimeout(3000, () => again('no answer'));
    s.on('error', (e) => again(e.message));
    s.on('connect', () => s.write('status\n'));
    s.on('data', (d) => {
        buf += d;
        const i = buf.indexOf('\n');
        if (i < 0) return;
        let answer;
        try {
            answer = JSON.parse(buf.slice(0, i));
        } catch (e) {
            return fail(`not JSON: ${buf.slice(0, 80)}`);
        }
        if (answer.ok !== true || typeof answer.state !== 'string') return fail(`bad answer: ${buf.slice(0, 80)}`);
        console.log(`ytplay check: ok (${answer.state})`);
        s.destroy();
        process.exit(0);
    });
}

attempt();
