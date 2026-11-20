'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * netx.js - connections to plex.tv and the Plex Media Server through mgu-uplink.
 *
 * clucraft-plex's copy of amn-iptv's netx.js (M850i-amn/idrive7-apps, itself from aurelm-emby's, aurelmarius/bmw-apps;
 * GPL-3.0-or-later), with a request's redirects followed and the answer's size limit a parameter.
 *
 * mgu-uplink routes only listed uids (this tool's client runs as one, component.json "uids"), and the unit's own
 * resolver does not resolve internet names: names go to the uplink's DNS servers (/run/mgu-uplink/lease.json, present
 * while online). The firmware has no public CA bundle and its Node 8's own one is old: TLS is checked against
 * cacert.pem (Mozilla's list, via certifi).
 *
 *   const nx = createNet({ leasePath, caPath, systemDns });
 *   nx.request({ method, url, headers, body, timeoutMs, maxBytes }) -> Promise<{ status, headers, body (Buffer) }>
 *   nx.stream({ url, headers, timeoutMs })                           -> Promise<{ status, headers, res, abort }>
 *   nx.online()                                                      -> the lease, or null
 *
 * Plain Node 8.
 */
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const http = require('http');
const path = require('path');
const url = require('url');

const LEASE = '/run/mgu-uplink/lease.json';

function createNet(o) {
    const opts = o || {};
    const leasePath = opts.leasePath || LEASE;
    let ca = null;
    const caList = () => {
        if (ca === null) {
            try {
                const pem = fs.readFileSync(opts.caPath || path.join(__dirname, 'cacert.pem'), 'utf8');
                ca = pem.split(/(?=-----BEGIN CERTIFICATE-----)/).filter((c) => c.indexOf('BEGIN CERTIFICATE') >= 0);
            } catch (e) { ca = []; }
        }
        return ca;
    };

    function online() {
        if (opts.systemDns) return { ip: 'system', dns: [] };
        try { const l = JSON.parse(fs.readFileSync(leasePath, 'utf8')); return l && l.ip ? l : null; } catch (e) { return null; }
    }

    /** host -> IPv4 address: a literal as it is; otherwise the uplink's DNS (or the system's, opts.systemDns) */
    function lookup(host, options, cb0) {
        if (typeof options === 'function') { cb0 = options; options = {}; }
        // newer Node asks for every address ({ all: true }, an array); the car's Node 8 for one
        const cb = options && options.all ? (err, a, f) => cb0(err, err ? undefined : [{ address: a, family: f || 4 }]) : cb0;
        if (net.isIP(host)) return cb(null, host, net.isIP(host));
        if (opts.systemDns) return dns.lookup(host, { family: 4 }, cb);
        const lease = online();
        const servers = (lease && lease.dns || []).filter((s) => net.isIPv4(s));
        if (!servers.length) {
            const e = new Error(lease ? 'the uplink has no DNS server' : 'no internet: mgu-uplink is not online');
            e.code = lease ? 'ENODNS' : 'EOFFLINE';
            return cb(e);
        }
        const r = new dns.Resolver();
        r.setServers(servers);
        r.resolve4(host, (err, addrs) => {
            if (err || !addrs || !addrs.length) return cb(err || Object.assign(new Error('no address for ' + host), { code: 'ENOTFOUND' }));
            cb(null, addrs[0], 4);
        });
    }

    function socket(s) {
        const base = { host: s.host, port: s.port, lookup };
        if (!s.tls) return net.connect(base);
        return tls.connect(Object.assign(base, { servername: net.isIP(s.host) ? undefined : s.host, ca: caList(), rejectUnauthorized: true }));
    }

    function open(method, target, headers, onRes) {
        const u = url.parse(target);
        const isTls = u.protocol === 'https:';
        const port = Number(u.port) || (isTls ? 443 : 80);
        return http.request({
            method, host: u.hostname, port, path: u.path, headers,
            // the socket is ours: the uplink's DNS and our certificates
            createConnection: () => socket({ host: u.hostname, port, tls: isTls }),
        }, onRes);
    }

    /** one HTTP(S) request; the body is JSON-encoded when an object; a redirect of a GET is followed (3 at most) */
    function request(r, hops) {
        return new Promise((resolve, reject) => {
            let body = r.body;
            const headers = Object.assign({}, r.headers || {});
            if (body !== undefined && body !== null && !Buffer.isBuffer(body) && typeof body !== 'string') {
                body = JSON.stringify(body);
                headers['Content-Type'] = headers['Content-Type'] || 'application/json';
            }
            if (body !== undefined && body !== null) headers['Content-Length'] = Buffer.byteLength(body);
            let done = false;
            const fail = (e) => { if (!done) { done = true; reject(e); } };
            const method = r.method || 'GET';
            const req = open(method, r.url, headers, (res) => {
                const loc = res.headers.location;
                if (method === 'GET' && res.statusCode >= 300 && res.statusCode < 400 && loc && (hops || 0) < 3) {
                    res.resume(); done = true;
                    return request(Object.assign({}, r, { url: url.resolve(r.url, loc) }), (hops || 0) + 1).then(resolve, reject);
                }
                const chunks = [];
                let size = 0;
                res.on('data', (d) => {
                    size += d.length;
                    if (size > (r.maxBytes || 8 * 1024 * 1024)) { req.abort(); fail(new Error('answer too large')); return; }
                    chunks.push(d);
                });
                res.on('end', () => { if (!done) { done = true; resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); } });
                res.on('error', fail);
            });
            req.setTimeout(r.timeoutMs || 15000, () => { req.abort(); fail(Object.assign(new Error('the server did not answer in time'), { code: 'ETIMEDOUT' })); });
            req.on('error', fail);
            if (body !== undefined && body !== null) req.write(body);
            req.end();
        });
    }

    /**
     * A long download: resolves with { status, headers, res, abort } once the answer's head came; the body is res's to
     * read (paused while the reader is behind: TCP holds the server back). A redirect is followed (3 at most).
     * timeoutMs: the head's wait (the body has none: the reader judges a silence).
     */
    function stream(r, hops) {
        return new Promise((resolve, reject) => {
            let done = false;
            const fail = (e) => { if (!done) { done = true; reject(e); } };
            const req = open('GET', r.url, r.headers || {}, (res) => {
                const loc = res.headers.location;
                if (res.statusCode >= 300 && res.statusCode < 400 && loc && (hops || 0) < 3) {
                    res.resume(); done = true;
                    return stream(Object.assign({}, r, { url: url.resolve(r.url, loc) }), (hops || 0) + 1).then(resolve, reject);
                }
                done = true;
                req.setTimeout(0);
                resolve({ status: res.statusCode, headers: res.headers, res, abort: () => { try { req.abort(); } catch (e) { /* gone */ } } });
            });
            req.setTimeout(r.timeoutMs || 30000, () => {
                const e = Object.assign(new Error('the server did not answer in time'), { code: 'ETIMEDOUT' });
                if (!done) fail(e);
                req.abort();
            });
            req.on('error', fail);
            req.end();
        });
    }

    return { socket, request, stream, online, lookup };
}

module.exports = { createNet, LEASE };
