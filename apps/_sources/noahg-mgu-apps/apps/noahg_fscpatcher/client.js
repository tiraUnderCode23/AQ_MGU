'use strict';
const http = require('http');
const SOCKET = '/run/mgu-fscpatch/control.sock';

function request(method, endpoint, body) {
    return new Promise((resolve, reject) => {
        let settled = false, timer;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error); else resolve(value);
        };
        const data = body === undefined ? '' : JSON.stringify(body);
        const req = http.request({
            socketPath: SOCKET, method, path: endpoint,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        }, res => {
            let text = '', bytes = 0;
            res.setEncoding('utf8');
            res.on('data', chunk => {
                bytes += Buffer.byteLength(chunk);
                if (bytes > 65536) {
                    const error = new Error('Oversized service response');
                    finish(error);
                    req.destroy(error);
                    return;
                }
                text += chunk;
            });
            res.on('error', error => finish(error));
            res.on('aborted', () => finish(new Error('Service response was interrupted')));
            res.on('close', () => {
                if (!res.complete) finish(new Error('Service response was interrupted'));
            });
            res.on('end', () => {
                try {
                    const value = JSON.parse(text);
                    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid service response');
                    if (res.statusCode !== 200) throw new Error(value.error || 'Service request failed (HTTP ' + res.statusCode + ')');
                    finish(null, value);
                } catch (error) {
                    finish(error);
                }
            });
        });
        timer = setTimeout(() => {
            const error = new Error('FSC patch service timeout');
            finish(error);
            req.destroy(error);
        }, endpoint === '/status' ? 6000 : 65000);
        req.on('error', error => finish(error));
        req.end(data);
    });
}
module.exports = { request };
