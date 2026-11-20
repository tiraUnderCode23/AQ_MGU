'use strict';
/*
 * Light Logger: the car's SOME/IP interfaces through BMW's SDK (typed proxies, as manifest.json declares them).
 *
 *   const link = new SomeipLink(log);
 *   link.open(iface, instance, { fields: { name: fn }, broadcasts: { name: fn }, pollMs })   -> Promise
 *   link.call(iface, method, params, timeoutMs)                                            -> Promise(result)
 *
 * The SDK's native binding wants one proxy call at a time, each in a fresh tick (as the SDK's own code and the
 * Vitals app do it), so every native call goes through one queue. A method call or broadcast subscription goes to
 * the native proxy under the typed one (callMethod / subscribe({ name, onReceive })) when the SDK has one, else
 * to the typed proxy's own member; which way was taken is logged once, for the first car runs.
 */
const someipBuilders = require('oap-sdk/src/someip/someipBuilders');

const RETRY_MS = 30000;

let queue = Promise.resolve();
function native(fn) {
    const run = () => new Promise((resolve, reject) => setImmediate(() => {
        try { Promise.resolve(fn()).then(resolve, reject); } catch (e) { reject(e); }
    }));
    const p = queue.then(run, run);
    queue = p.catch(() => null);
    return p;
}

function rawOf(p) {
    const cands = [p && p._someIpProxy, p && p._proxy, p && p.proxy, p];
    return cands.find((c) => c && typeof c.callMethod === 'function') || null;
}
function rawSubscriber(p) {
    const cands = [p && p._someIpProxy, p && p._proxy, p && p.proxy];
    return cands.find((c) => c && typeof c.subscribe === 'function') || null;
}

class SomeipLink {
    constructor(log) {
        this.log = log;
        this.proxies = {};
        this.available = {};
        this.timers = [];
        this.stopped = false;
        this._said = {};
    }

    _once(key, text) { if (!this._said[key]) { this._said[key] = true; this.log.info(text); } }

    /* builds the proxy, subscribes, reads the fields once the car's side is there (and every pollMs). Resolves
     * when subscribed; a failure is retried every 30 s in the background and rejects the first promise. */
    open(iface, instance, opts) {
        const o = opts || {};
        const name = iface.split('.').pop();
        let proxy;
        return native(() => someipBuilders.buildTypedProxy(iface, instance))
            .then((p) => { proxy = p; return native(() => p.init()); })
            .then(() => {
                this.proxies[iface] = proxy;
                let chain = Promise.resolve();
                Object.keys(o.broadcasts || {}).forEach((b) => {
                    chain = chain.then(() => this._subscribe(proxy, name, b, o.broadcasts[b], true));
                });
                Object.keys(o.fields || {}).forEach((f) => {
                    chain = chain.then(() => this._subscribe(proxy, name, f, o.fields[f], false));
                });
                return chain;
            })
            .then(() => {
                this._watchAvailable(iface, proxy, o);
                this.log.info(name + ' set up');
            })
            .catch((e) => {
                this.log.warn(name + ' unavailable: ' + ((e && e.message) || e) + '; trying again in 30 s');
                if (!this.stopped) this.timers.push(setTimeout(() => this.open(iface, instance, opts).catch(() => null), RETRY_MS));
                throw e;
            });
    }

    _subscribe(proxy, name, member, fn, isBroadcast) {
        const safe = (v) => { try { fn(v); } catch (e) { this.log.warn(name + '.' + member + ': ' + e.message); } };
        const typed = proxy[member];
        const raw = rawSubscriber(proxy);
        if (isBroadcast && raw) {
            this._once(name + member, name + '.' + member + ': subscribed on the native proxy');
            return native(() => raw.subscribe({ name: member, onReceive: safe }));
        }
        if (typed && typeof typed.subscribe === 'function') {
            this._once(name + member, name + '.' + member + ': subscribed on the typed proxy');
            return native(() => typed.subscribe(safe));
        }
        if (raw) return native(() => raw.subscribe({ name: member, onReceive: safe }));
        return Promise.reject(new Error('no ' + member + ' on ' + name));
    }

    _watchAvailable(iface, proxy, o) {
        const fields = Object.keys(o.fields || {});
        const read = () => fields.forEach((f) => {
            const field = proxy[f];
            if (!field || typeof field.getValue !== 'function') return;
            native(() => field.getValue()).then((v) => { if (v !== undefined && v !== null) o.fields[f](v); }).catch(() => null);
        });
        const wait = () => {
            if (this.stopped) return;
            if (typeof proxy.waitUntilAvailable !== 'function') { this.available[iface] = true; read(); return; }
            Promise.resolve(proxy.waitUntilAvailable(15000)).then(() => {
                this.available[iface] = true;
                read();
                if (o.pollMs) this.timers.push(setInterval(read, o.pollMs));
            }, () => { this.timers.push(setTimeout(wait, 1000)); });
        };
        wait();
    }

    call(iface, method, params, timeoutMs) {
        const proxy = this.proxies[iface];
        if (!proxy) return Promise.reject(new Error(iface.split('.').pop() + ' not set up'));
        const raw = rawOf(proxy);
        if (raw) {
            this._once('call' + method, method + ': called on the native proxy');
            return native(() => raw.callMethod(method, params, timeoutMs || 5000));
        }
        if (typeof proxy[method] === 'function') {
            this._once('call' + method, method + ': called on the typed proxy');
            return native(() => proxy[method](params));
        }
        return Promise.reject(new Error('no method ' + method));
    }

    stop() {
        this.stopped = true;
        this.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
        Object.keys(this.proxies).forEach((k) => {
            try { if (this.proxies[k].shutdown) this.proxies[k].shutdown(); } catch (e) { /* stopping anyway */ }
        });
    }
}

module.exports = { SomeipLink };
