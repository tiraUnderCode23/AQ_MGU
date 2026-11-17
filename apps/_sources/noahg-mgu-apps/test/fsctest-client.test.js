'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const http = require('node:http');

const source = fs.readFileSync(path.resolve(__dirname, '../apps/noahg_fscpatcher/client.js'), 'utf8');

function loadClient(httpClient) {
    const timers = new Map();
    let id = 0;
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module, Buffer, require: name => { assert.equal(name, 'http'); return httpClient; },
        setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; },
        clearTimeout(key) { timers.delete(key); },
    });
    return { request: module.exports.request, timers };
}

function fakeHttp() {
    let request, response, options;
    const client = loadClient({
        request(value, reply) {
            options = value;
            request = new EventEmitter();
            request.destroy = error => { request.emit('error', error); };
            request.end = () => {
                response = new EventEmitter();
                response.setEncoding = () => {};
                response.statusCode = 200;
                response.complete = false;
                reply(response);
            };
            return request;
        },
    });
    return { ...client, response: () => response, options: () => options };
}

test('client handles service errors and malformed, aborted, or oversized responses', async () => {
    for (const kind of ['error', 'malformed', 'null', 'aborted', 'closed', 'oversized']) {
        const client = fakeHttp();
        const operation = client.request('GET', '/status');
        const failure = assert.rejects(operation);
        const response = client.response();
        if (kind === 'error') {
            response.statusCode = 409;
            response.emit('data', '{"error":"Another operation is in progress"}');
            response.emit('end');
        } else if (kind === 'malformed' || kind === 'null') {
            response.emit('data', kind === 'null' ? 'null' : '{');
            response.emit('end');
        } else if (kind === 'aborted') response.emit('aborted');
        else if (kind === 'closed') response.emit('close');
        else response.emit('data', 'x'.repeat(65537));
        await failure;
        assert.equal(client.timers.size, 0, kind + ' left a timeout alive');
    }
});
test('client deadlines cover slow responses and give writes the service timeout budget', async () => {
    for (const [method, endpoint, limit] of [['GET', '/status', 6000], ['POST', '/patch', 65000]]) {
        const client = fakeHttp();
        const operation = client.request(method, endpoint);
        const failure = assert.rejects(operation, /timeout/);
        assert.equal(client.options().path, endpoint);
        assert.equal(client.options().method, method);
        const timeout = Array.from(client.timers.values())[0];
        assert.equal(timeout.ms, limit);
        client.response().emit('data', ' ');
        timeout.fn();
        await failure;
        assert.equal(client.timers.size, 0);
    }
});

test('client completes an HTTP exchange over a local control socket', async () => {
    const socket = process.platform === 'win32'
        ? '\\\\.\\pipe\\fsc-audit-' + process.pid + '-' + Date.now()
        : '/tmp/fsc-audit-' + process.pid + '-' + Date.now() + '.sock';
    const server = http.createServer((request, response) => {
        assert.equal(request.method, 'GET');
        assert.equal(request.url, '/status');
        response.setHeader('Content-Type', 'application/json');
        response.end('{"version":"0.1.4","binary":{"state":"stock"},"block":{"state":"absent"}}');
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
    const client = loadClient({ request: (options, reply) => http.request({ ...options, socketPath: socket }, reply) });
    try {
        const status = await client.request('GET', '/status');
        assert.equal(status.version, '0.1.4');
        assert.equal(status.block.state, 'absent');
        assert.equal(client.timers.size, 0);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
