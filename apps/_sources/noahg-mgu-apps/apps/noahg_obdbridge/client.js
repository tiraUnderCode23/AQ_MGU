'use strict';
const http = require('http');
const SOCKET = '/run/mgu-obd-adapter/control.sock';
function request(method, endpoint, body) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? '' : JSON.stringify(body);
        const req = http.request({ socketPath: SOCKET, method, path: endpoint,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { text += chunk; if (text.length > 65536) req.destroy(new Error('oversized service response')); });
            res.on('error', reject);
            res.on('end', () => {
                try { const value = JSON.parse(text); if (res.statusCode !== 200) throw new Error(value.error || 'Service request failed'); resolve(value); } catch (e) { reject(e); }
            });
        });
        req.setTimeout(endpoint === '/probe' ? 95000 : 6000, () => {
            const error = new Error('Adapter service timeout');
            error.code = 'ETIMEDOUT';
            req.destroy(error);
        });
        req.on('error', reject);
        req.end(data);
    });
}
module.exports = { request };
