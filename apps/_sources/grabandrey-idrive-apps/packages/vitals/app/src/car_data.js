'use strict';
/*
 * Vitals: reads the car's temperatures (engine, gearbox) and tyre data through BMW's SDK (typed SOME/IP
 * proxies, as manifest.json declares them) and emits them as metric numbers.
 *
 *   const car = new CarData(logger); car.on('data', (partial) => ...); car.start();
 *
 * Each interface is set up one after another, in its own tick, the way the SDK's own code
 * does; a missing interface or field is logged and the rest carry on. TPMS is also read
 * every 5 s: some cars answer reads but never notify it.
 */
const EventEmitter = require('events');
const someipBuilders = require('oap-sdk/src/someip/someipBuilders');
const decode = require('./decode.js');

const IF_CDS = 'de.bmw.infotainment.vehicle.CDS';
const IF_TPMS = 'de.bmw.infotainment.vehicle.TPMS';
const IF_VEHICLE = 'de.bmw.infotainment.vehicle.Vehicle';
const IF_BASIC = 'de.bmw.infrastructure.analytics.BasicDataSet';
const TPMS_POLL_MS = 5000;
const STUCK_RISE = 25;              // C of engine oil warming with a gearbox value that never moved

const tick = () => new Promise((resolve) => setImmediate(resolve));

class CarData extends EventEmitter {
    constructor(log) {
        super();
        this.log = log;
        this.units = { carTemp: null, carPress: null };
        this.raw = { tyreT: null, tyreP: null };
        this.proxies = {};
        this.timers = [];
        this.available = { engine: false, gearbox: false, tyres: false };
        this.diag = {};                     // per interface: { state, updates, at, error }
        this.stopped = false;
        this.gearbox = { first: null, oilAtFirst: null, moved: false, stuck: false, logged: 0 };
        this.oil = null;                    // the latest engine oil temperature, C
    }

    start() {
        let chain = Promise.resolve();
        const step = (fn) => { chain = chain.then(tick).then(fn).catch((err) => this.log.warn('car data: ' + (err && err.message))); };
        step(() => this._watch(IF_VEHICLE, '1', {
            statusNewCurrentUnitsStatusExt: (v) => {
                const u = decode.units(v);
                if (u.carTemp === this.units.carTemp && u.carPress === this.units.carPress) return;
                this.units = u;
                this.log.info('car units: temperature ' + (u.carTemp || '?') + ', pressure ' + (u.carPress || '?'));
                this._tyres();                          // the raw tyre values read again in the new units
                this.emit('data', { carTemp: u.carTemp, carPress: u.carPress });
            },
        }));
        step(() => this._watch(IF_CDS, '1', {
            statusEngineTemperature: (v) => {
                this.available.engine = true;
                const e = decode.engine(v);
                if (e.oil !== null) this.oil = e.oil;
                this.emit('data', e);
            },
        }));
        // basicDataSet is notify-only (no getter): subscribed, never read
        step(() => this._watch(IF_BASIC, '1', {
            basicDataSet: (v) => this._gearbox(v),
        }, 0, ['basicDataSet']));
        step(() => this._watch(IF_TPMS, '1', {
            statusTyreTemperature: (v) => { this.raw.tyreT = v; this._tyres(); },
            statusTyrePressure: (v) => { this.raw.tyreP = v; this._tyres(); },
        }, TPMS_POLL_MS));
        return chain;
    }

    stop() {
        this.stopped = true;
        this.timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
        Object.keys(this.proxies).forEach((k) => {
            const p = this.proxies[k];
            try { if (p && p.shutdown) p.shutdown(); } catch (e) { /* stopping anyway */ }
        });
    }

    /* gearbox oil: shown at once when the value is plausible. Some cars never fill the field in and send
     * one fixed number: a value that has not moved once while the engine oil warmed by STUCK_RISE C is
     * taken for that, and hidden. Raw values go to the log (the first few, then each change). */
    _gearbox(v) {
        const g = this.gearbox;
        const raw = v && v.valueTemperatureTransmissionOil;
        if (g.logged < 5 || (typeof raw === 'number' && raw !== g.last)) {
            if (g.logged < 40) { g.logged++; this.log.info('gearbox oil raw ' + raw + (g.logged === 1 ? ' (fields: ' + Object.keys(v || {}).join(',') + ')' : '')); }
        }
        g.last = raw;
        const c = decode.gearbox(v);
        if (c === null || c < -40 || c > 160 || g.stuck) return;
        if (g.first === null) { g.first = raw; g.oilAtFirst = this.oil; }
        if (raw !== g.first) g.moved = true;
        if (!g.moved && g.oilAtFirst !== null && this.oil !== null && this.oil - g.oilAtFirst >= STUCK_RISE) {
            g.stuck = true;
            this.available.gearbox = false;
            this.log.info('gearbox oil stuck at raw ' + raw + ' while the engine oil warmed: this car does not send it');
            this.emit('data', { gearbox: null });
            return;
        }
        this.available.gearbox = true;
        this.emit('data', { gearbox: c });
    }

    _tyres() {
        const out = {};
        if (this.raw.tyreT) out.tyreT = decode.tyreTemps(this.raw.tyreT, this.units.carTemp);
        if (this.raw.tyreP) out.tyreP = decode.tyrePressures(this.raw.tyreP, this.units.carPress);
        if (out.tyreT || out.tyreP) { this.available.tyres = true; this.emit('data', out); }
    }

    /*
     * One interface, on its own: the proxy is built and set up in turn with the others (the SDK's native
     * binding wants one at a time), then each field is subscribed, and read (except noRead's notify-only
     * ones) once the car's side is there, and every pollMs. Nothing waits on another interface, and a
     * step that fails is tried again: an interface whose provider comes up late (or restarts) still gets
     * its data. this.diag[name] says how far it got and what came, for the app's screen and its log.
     */
    _watch(iface, instance, handlers, pollMs, noRead) {
        const name = iface.split('.').pop();
        const dg = this.diag[name] || (this.diag[name] = { state: 'starting', updates: 0, at: 0, error: null });
        const fields = Object.keys(handlers);
        const subscribed = {};
        let proxy = null;
        const wrap = (f) => (v) => {
            dg.updates++; dg.at = Date.now();
            if (dg.state !== 'live') { dg.state = 'live'; this.log.info(name + '.' + f + ': first update'); }
            try { handlers[f](v); } catch (e) { this.log.warn(name + '.' + f + ': ' + e.message); }
        };
        const subscribeAll = () => {
            let chain = Promise.resolve();
            fields.forEach((f) => {
                if (subscribed[f]) return;
                chain = chain.then(tick).then(() => {
                    const field = proxy && proxy[f];
                    if (!field || !field.subscribe) { dg.error = 'no field ' + f; this.log.warn(name + ': no field ' + f); return undefined; }
                    return Promise.resolve(field.subscribe(wrap(f)))
                        .then(() => { subscribed[f] = true; this.log.info(name + '.' + f + ' subscribed'); })
                        .catch((err) => { dg.error = 'subscribe: ' + (err && err.message); });
                });
            });
            return chain;
        };
        const read = () => fields.filter((f) => !noRead || noRead.indexOf(f) < 0).forEach((f) => {
            const field = proxy && proxy[f];
            if (!field || !field.getValue) return;
            Promise.resolve(field.getValue()).then((v) => { if (v !== undefined && v !== null) wrap(f)(v); })
                .catch((err) => { dg.error = 'read: ' + (err && err.message); });
        });
        /* waits for the car's side, 15 s at a time, for as long as it takes */
        const waitForCar = () => {
            if (this.stopped) return;
            Promise.resolve(proxy.waitUntilAvailable(15000)).then(() => {
                if (dg.state !== 'live') dg.state = 'available';
                this.log.info(iface + ' available');
                return subscribeAll().then(() => {
                    read();
                    if (pollMs) this.timers.push(setInterval(read, pollMs));
                });
            }, () => {
                if (dg.state === 'set up') this.log.info(iface + ': not available yet, waiting');
                if (dg.state !== 'live') dg.state = 'waiting for the car';
                setTimeout(waitForCar, 1000);
            });
        };
        return someipBuilders.buildTypedProxy(iface, instance)
            .then((p) => { proxy = p; this.proxies[iface] = p; return proxy.init(); })
            .then(() => {
                dg.state = 'set up';
                // subscribed at once as well: some providers send without answering availability first
                subscribeAll().catch(() => { /* again once available */ });
                setImmediate(waitForCar);
            })
            .catch((err) => {
                dg.state = 'error';
                dg.error = (err && err.message) || String(err);
                this.log.warn(iface + ' unavailable: ' + dg.error + '; trying again in 30 s');
                if (!this.stopped) setTimeout(() => this._watch(iface, instance, handlers, pollMs, noRead), 30000);
            });
    }

    /* one line on what the car sends for gearbox oil, for the screen */
    gearboxText() {
        const dg = this.diag.BasicDataSet, g = this.gearbox;
        if (!dg) return 'gearbox oil: not set up yet';
        if (g.stuck) return 'gearbox oil: the car sends a fixed ' + g.first + ' (raw); it does not fill this value';
        if (dg.updates && g.last === undefined) return 'gearbox oil: the car sends its data set, but without a gearbox oil value';
        const raw = typeof g.last === 'number' ? ', last raw ' + g.last + (g.last === 255 ? ' (= no value)' : '') : '';
        return 'gearbox oil (BasicDataSet): ' + dg.state + ', ' + dg.updates + ' updates' + raw + (dg.error ? ', ' + dg.error : '');
    }
}

module.exports = { CarData };
