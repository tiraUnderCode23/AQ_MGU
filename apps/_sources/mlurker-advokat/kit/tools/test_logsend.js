'use strict';

// The "Send log" upload: which files go, what each failure says, the cut of an oversized log. The POST is
// replaced by a stub; nothing leaves the machine:
//   node kit/tools/test_logsend.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LogSender, readTail, failText, leaseDns, MAX_BYTES } = require('../../apps/advokat_live_adjustments/logsend');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logsend-'));
const lines = [];
const log = { info: (m) => lines.push(m) };
const cfg = { url: 'https://example.invalid/api/upload', token: 'tok' };
const mk = (config) => ({ spec: { id: 'app', version: '1.2.3', config: config === undefined ? { logUpload: cfg } : config }, dataDir: dir, log });
const clean = () => fs.readdirSync(dir).forEach((f) => fs.unlinkSync(path.join(dir, f)));

(async () => {
    // no log file at all
    let s = new LogSender(mk(), async () => { throw new Error('must not send'); });
    let r = await s.send();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.text, 'No log to send');

    // not configured
    s = new LogSender(mk({}), async () => { throw new Error('must not send'); });
    assert.strictEqual((await s.send()).text, 'Upload is not set up');

    // both files: the previous one first, each as its own request, with the token and a device label
    fs.writeFileSync(path.join(dir, 'app.log.1'), 'old line\n');
    fs.writeFileSync(path.join(dir, 'app.log'), 'new line\n');
    const sent = [];
    s = new LogSender(mk(), async (c, device, body) => { sent.push([c.token, device, body.toString()]); return { status: 201 }; });
    r = await s.send();
    assert.deepStrictEqual(sent, [['tok', 'v1.2.3-prev', 'old line\n'], ['tok', 'v1.2.3-cur', 'new line\n']]);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.state, 'done');
    assert.ok(/^Sent 2 files/.test(r.text), r.text);
    assert.ok(lines.some((l) => l === 'log upload: ' + r.text));

    // only the current file
    fs.unlinkSync(path.join(dir, 'app.log.1'));
    sent.length = 0;
    r = await s.send();
    assert.strictEqual(sent.length, 1);
    assert.ok(/^Sent 1 file /.test(r.text), r.text);

    // every failure says why, and stops at the first one
    const fail = async (reply) => {
        let calls = 0;
        fs.writeFileSync(path.join(dir, 'app.log.1'), 'x');
        const f = new LogSender(mk(), async () => { calls++; if (reply.throws) throw reply.throws; return reply; });
        const out = await f.send();
        assert.strictEqual(out.ok, false);
        assert.strictEqual(calls, 1, 'stops after the first failed request');
        return out.text;
    };
    assert.strictEqual(await fail({ status: 401 }), 'Rejected · wrong token');
    assert.strictEqual(await fail({ status: 413 }), 'Too large for the server');
    assert.strictEqual(await fail({ status: 500 }), 'Server error (HTTP 500)');
    assert.strictEqual(await fail({ status: 404 }), 'Not sent (HTTP 404)');
    assert.strictEqual(await fail({ throws: { code: 'ENOTFOUND' } }), 'No internet');
    assert.strictEqual(await fail({ throws: { code: 'EAI_AGAIN' } }), 'No internet');
    assert.strictEqual(await fail({ throws: { code: 'ENETUNREACH' } }), 'No internet');
    assert.strictEqual(await fail({ throws: { code: 'TIMEOUT' } }), 'Timed out');
    assert.strictEqual(await fail({ throws: { code: 'EPROTO' } }), 'Not sent (EPROTO)');
    assert.strictEqual(failText(0, 'ECONNREFUSED'), 'No internet');

    // one press at a time
    let release, open = false;
    const slow = new LogSender(mk(), () => new Promise((res) => { release = () => { open = true; res({ status: 201 }); }; if (open) res({ status: 201 }); }));
    const first = slow.send();
    await new Promise(setImmediate);
    assert.strictEqual(slow.view().state, 'sending');
    assert.strictEqual(slow.view().text, 'Sending…');
    const second = await slow.send();                 // a press while sending: nothing new starts
    assert.strictEqual(second.state, 'sending');
    release();
    assert.strictEqual((await first).ok, true);

    // a log longer than the limit: its last MAX_BYTES go, and the status says so
    clean();
    const big = Buffer.alloc(MAX_BYTES + 10, 0x61);
    big.write('TAIL', big.length - 4);
    fs.writeFileSync(path.join(dir, 'app.log'), big);
    const t = readTail(path.join(dir, 'app.log'));
    assert.strictEqual(t.cut, true);
    assert.strictEqual(t.buf.length, MAX_BYTES);
    assert.strictEqual(t.buf.slice(-4).toString(), 'TAIL');
    sent.length = 0;
    r = await new LogSender(mk(), async (c, d, body) => { sent.push(body.length); return { status: 201 }; }).send();
    assert.deepStrictEqual(sent, [MAX_BYTES]);
    assert.ok(/older lines cut/.test(r.text), r.text);

    // an empty or missing file is no log
    assert.strictEqual(readTail(path.join(dir, 'nothing')), null);
    fs.writeFileSync(path.join(dir, 'empty'), '');
    assert.strictEqual(readTail(path.join(dir, 'empty')), null);

    // the uplink's DNS: the lease's servers go to the POST; no lease means the system resolver
    clean();
    fs.writeFileSync(path.join(dir, 'app.log'), 'line\n');
    const seen = [];
    const stub = async (c, d, b, servers) => { seen.push(servers); return { status: 201 }; };
    const hostLease = fs.existsSync('/run/mgu-uplink/lease.json');      // true only on the car
    if (!hostLease) {
        assert.strictEqual(leaseDns(dir), null);
        await new LogSender(mk(), stub).send();
        assert.deepStrictEqual(seen, [null]);
    }
    fs.writeFileSync(path.join(dir, 'uplink.json'), JSON.stringify({ interface: 'wlan0', dns: ['10.80.151.102'] }));
    assert.deepStrictEqual(leaseDns(dir), ['10.80.151.102']);
    seen.length = 0;
    await new LogSender(mk(), stub).send();
    assert.deepStrictEqual(seen, [['10.80.151.102']]);
    assert.ok(lines.some((l) => l === 'log upload: dns 10.80.151.102'));
    fs.writeFileSync(path.join(dir, 'uplink.json'), '{"dns": []}');
    if (!hostLease) assert.strictEqual(leaseDns(dir), null);

    clean();
    fs.rmdirSync(dir);
    console.log('Log upload checks passed (files and order / not set up / no log / every failure named / one at a time / cut to the last ' + MAX_BYTES + ' bytes).');
})().catch((e) => { console.error(e); process.exit(1); });
