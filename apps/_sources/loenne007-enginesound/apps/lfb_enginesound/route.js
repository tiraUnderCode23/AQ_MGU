'use strict';
/**
 * route.js - the car's audio routing (GENIVI AudioManager over SOME/IP).
 *
 * A route = { name, source, sink, device, markAvailable }: our PCM goes into the SmartX ALSA endpoint `device`, and
 * the AudioManager source `source` is connected to the sink (1024: the main speakers). Two kinds:
 *
 *   exclusive  CarLifeMedia (287) -> 1024, plug:smartx:CarLifeMedia_CF_48_STEREO, exactly as Moonride
 *              (JustAnotherPU/moonride) does it on iDrive 7. CarLifeMedia is China-only, so free elsewhere; it is
 *              A_UNAVAILABLE without a CarLife phone and a connect to it stays CS_CONNECTING for ever, so it is
 *              marked available on the routing side while we play and unavailable again after. It replaces the
 *              music (the music pauses).
 *   mix        a prompt / overlay source -> the speakers, so the engine plays over the music as a navigation prompt
 *              does. Candidates are the sources in MIX_SOURCES that the car's AudioManager lists and that have a
 *              SmartX playback endpoint (the service's /dev/shm list); the car's prompt endpoints are 24 kHz mono
 *              (the synth converts). Default: OAPGenericOverlay (1048), BMW's overlay source for apps, whose audio
 *              enters through the endpoint Media_Overlay_Converter_Source. The others are China-only channels
 *              (Tencent, CarLife), free elsewhere; like CarLifeMedia they are marked available while we play.
 *              BMW's own navigation, speech, phone, CarPlay and Android Auto sources are never used.
 *
 *   start(leftover):  at the app's start, what a crash or a power-off left goes: every 287 connection (only ours can
 *                     exist), 287 marked unavailable, and the mix connection we had open (`leftover`, the state file)
 *   connect(route):   (mark available) + connect; a route that fails leaves nothing behind
 *   disconnect():     disconnect our connection (+ the 287 sweep and unavailable for the exclusive route)
 *   sources():        the AudioManager's main sources [{ id, name }] (getListMainSources), for the Audio page
 * One AudioManager call at a time, in order.
 */
const fs = require('fs');
const path = require('path');

const AM = 'org.genivi.am.commandinterface.CommandControl';
const AMR = 'org.genivi.am.routinginterface.RoutingControlObserver';
const SINK = 1024;        // MediaSink_Front: the front zone's speakers, where the car's own sources play
const MAIN_SINK = 1;      // MainSink: offered as a second sink for the mix sources
const EXCLUSIVE = Object.freeze({ kind: 'exclusive', name: 'CarLifeMedia', source: 287, sink: SINK,
    device: 'plug:smartx:CarLifeMedia_CF_48_STEREO', markAvailable: true });
/* The mix sources, best first: { name (the AudioManager's), source (its id where the list is unavailable), endpoint
 * (the SmartX endpoint's name where it is not the source's), mark (China-only: marked available while we play) }.
 * From a G20 head unit's audio report: the OAPGeneric / Dynamic sources have no endpoint of their own. */
const MIX_SOURCES = [
    { name: 'OAPGenericOverlay', source: 1048, endpoint: 'Media_Overlay_Converter_Source', mark: false },
    { name: 'TencentOverlay', source: 297, mark: true },
    { name: 'CarLifeNavigation', source: 288, mark: true },
    { name: 'TencentTTS', source: 294, mark: true },
    { name: 'CarLifeSpeech', source: 289, mark: true },
];
const MIX_DEFAULT = Object.freeze({ kind: 'mix', name: 'OAPGenericOverlay', source: 1048, sink: SINK,
    device: 'plug:smartx:Media_Overlay_Converter_Source_CF_24_MONO', markAvailable: false });
const mixSpec = (name) => MIX_SOURCES.find((x) => x.name.toLowerCase() === String(name || '').toLowerCase());

/* ---------------- choosing a route (pure, tested in test/core.test.js) ---------------- */

/**
 * The SmartX playback endpoint (from the service's SHM list, e.g. "TencentOverlay_CF_24_MONO") whose name starts
 * with `name`, case-insensitive, as an ALSA device ("plug:smartx:<endpoint>"); null if none. Best: "<name>_CF_48_STEREO",
 * then "<name>_..." (48 kHz, stereo preferred), then any other that starts with the name.
 */
function deviceFor(name, endpoints) {
    if (!name || !Array.isArray(endpoints)) return null;
    const n = String(name).toLowerCase();
    const score = (e) => {
        const l = String(e).toLowerCase();
        if (l.indexOf(n) !== 0) return -1;
        if (l === n + '_cf_48_stereo') return 100;
        return (l[n.length] === '_' ? 50 : 0) + (/_48_/.test(l) ? 10 : 0) + (/stereo/.test(l) ? 5 : 0);
    };
    const best = endpoints.map((e) => [score(e), e]).filter((x) => x[0] >= 0).sort((a, b) => b[0] - a[0])[0];
    return best ? 'plug:smartx:' + best[1] : null;
}

/** A mix source's device: its endpoint in the list; without a list, null. */
const mixDevice = (spec, endpoints) => deviceFor(spec.endpoint || spec.name, endpoints);

/**
 * The mix candidates for the Audio page: every MIX_SOURCES entry the AudioManager lists (its id from there) and that
 * has a SmartX endpoint, to the front speakers (1024) first, then the same ones to the MainSink (1). The default is
 * always the first, on its assumed device when it has no endpoint in the list.
 * sources = [{ id, name }] or null (list unavailable: the known ids); endpoints = [names] or null (unknown).
 */
function mixCandidates(sources, endpoints) {
    const base = [];
    MIX_SOURCES.forEach((spec, i) => {
        const listed = (sources || []).find((x) => x && typeof x.id === 'number' && String(x.name || '').toLowerCase() === spec.name.toLowerCase());
        const device = mixDevice(spec, endpoints);
        if (i === 0) return base.push(Object.assign({}, MIX_DEFAULT, { source: listed ? listed.id : MIX_DEFAULT.source, device: device || MIX_DEFAULT.device }));
        if (!device || (sources && !listed)) return null;
        return base.push({ kind: 'mix', name: spec.name, source: listed ? listed.id : spec.source, sink: SINK, device, markAvailable: spec.mark });
    });
    return base.concat(base.map((c) => Object.assign({}, c, { sink: MAIN_SINK })));
}

/**
 * The mix route: the saved choice ({ name, source, sink, device } or null = the default). With the SmartX list known
 * the device is looked up there (a choice whose endpoint is gone, or that is no mix source any more, falls back to
 * the default); without it the saved device is used. `note` says why when it is not what was asked for.
 */
function mixRoute(choice, endpoints) {
    const known = Array.isArray(endpoints);
    const spec = choice && typeof choice.source === 'number' ? mixSpec(choice.name) : null;
    if (spec) {
        const device = known ? mixDevice(spec, endpoints) : choice.device || (spec === MIX_SOURCES[0] ? MIX_DEFAULT.device : null);
        if (device || spec === MIX_SOURCES[0]) {
            return Object.assign({ kind: 'mix', name: spec.name, source: choice.source, sink: choice.sink || SINK, device: device || MIX_DEFAULT.device, markAvailable: spec.mark },
                device ? {} : { note: 'no SmartX endpoint ' + spec.endpoint + ': assumed ' + MIX_DEFAULT.device });
        }
    }
    if (choice && choice.name) {
        const r = mixRoute(null, endpoints);
        r.note = (spec ? 'no SmartX endpoint for ' : 'no mix source ') + choice.name + ': default used';
        return r;
    }
    const device = known ? mixDevice(MIX_SOURCES[0], endpoints) : null;
    return Object.assign({}, MIX_DEFAULT, { device: device || MIX_DEFAULT.device },
        known && !device ? { note: 'no SmartX endpoint ' + MIX_SOURCES[0].endpoint + ': assumed ' + MIX_DEFAULT.device } : {});
}

/** The route to play on: mix (setting "Play over music") or exclusive. */
function routeFor(mix, choice, endpoints) { return mix ? mixRoute(choice, endpoints) : Object.assign({}, EXCLUSIVE); }

const sameRoute = (a, b) => !!a && !!b && a.source === b.source && a.sink === b.sink;
const label = (r) => r.name + ' (' + r.source + ' -> ' + r.sink + ')';

/* ---------------- the AudioManager ---------------- */

const okReply = (r) => r && (r.amError === 'E_OK' || r.amError === 'E_ALREADY_EXISTS' || r.amError === 0);
const arrayIn = (r, key) => (r && Array.isArray(r[key]) ? r[key] : Array.isArray(r) ? r
    : (r && Object.keys(r).map((k) => r[k]).find(Array.isArray)) || []);
const listOf = (r) => (r && Array.isArray(r.listMainConnections) ? r.listMainConnections : arrayIn(r, 'listConnections'));
const STATES = { 0: 'CS_UNKNOWN', 1: 'CS_CONNECTING', 2: 'CS_CONNECTED', 3: 'CS_DISCONNECTING', 4: 'CS_DISCONNECTED', 5: 'CS_SUSPENDED' };
const stateName = (s) => STATES[s] || String(s);
const CHECK_MS = 1500;        // the connection's state is looked at this long after a connect
const MIX_SETTLE_MS = 6000;   // a mix connection not CS_CONNECTED by then is released (route failed)

/* a main sink / source as the AudioManager lists it (am_SinkType_s: sinkID, name, availability, volume, muteState,
 * sinkClassID), in short */
const availOf = (x) => { const a = x && x.availability; return a && typeof a === 'object' ? a.availability : a; };
const sinkOf = (x) => ({ id: x.sinkID, name: String(x.name || ''), volume: x.volume, mute: x.muteState, cls: x.sinkClassID, avail: availOf(x) });

class Route {
    /** dataDir: where our open mix connection is noted (route-state.json), so a start after a crash can remove it. */
    constructor(signals, log, dataDir) {
        this.signals = signals; this.log = log;
        this.file = dataDir ? path.join(dataDir, 'route-state.json') : null;
        this.p = null; this.r = null;
        this.route = null;           // the route connected (or connecting)
        this.id = null;              // its mainConnectionID (null: none known / not ours)
        this.marked = false;         // the route's source is marked available by us
        this.failed = null;          // the route that failed last (state failed)
        this.state = 'off';          // off | connecting | connected | failed
        this.error = null; this.connState = null;
        this.q = Promise.resolve();
        this.shape = false;
        this.gen = 0;                // bumped on every connect / disconnect (late checks of an old connect do nothing)
        this.checkMs = CHECK_MS; this.settleMs = MIX_SETTLE_MS;
    }

    _queue(fn) { const p = this.q.then(fn, fn); this.q = p.catch(() => {}); return p; }

    // a fresh proxy answers "Service unavailable" until the provider is found: wait for it (max 5 s)
    async _proxy(iface) {
        const p = await this.signals.proxy(iface, '1');
        await new Promise((res) => {
            const t = setTimeout(res, 5000);
            this.signals.onAvailable(p, (a) => { if (a) { clearTimeout(t); res(); } });
        });
        return p;
    }
    async _init() { if (!this.p) this.p = await this._proxy(AM); }
    _call(m, a, ms) { return this.signals.call(this.p, m, a || {}, ms || 5000); }

    /** Mark a source (un)available on the routing side; errors are logged, not thrown (as Moonride). */
    async _avail(source, on) {
        try {
            if (!this.r) this.r = await this._proxy(AMR);
            await this.signals.call(this.r, 'hookSourceAvailablityStatusChange',
                { sourceID: source, availability: { availability: on ? 'A_AVAILABLE' : 'A_UNAVAILABLE', availabilityReason: 0 } }, 5000);
            this.log.info('audio: source ' + source + (on ? ' available' : ' unavailable'));
        } catch (e) { this.log.warn('audio availability ' + source + ': ' + e); }
        this.marked = on;
    }

    async _connections() {
        const r = await this._call('getListMainConnections', {});
        if (!this.shape) { this.shape = true; this.log.info('audio: connections ' + JSON.stringify(r).slice(0, 800)); }
        return listOf(r);
    }

    async _disconnectId(id, why) {
        const r = await this._call('disconnect', { mainConnectionID: id });
        this.log.info('audio: ' + why + ' ' + id + ' disconnect ' + JSON.stringify(r));
    }

    /** Disconnect connections of `source` (-> `sink` if given; only `id` if given). */
    async _sweep(source, sink, id) {
        const list = (await this._connections()).filter((x) => x && x.sourceID === source && (sink === undefined || x.sinkID === sink)
            && (id === undefined || id === null || x.mainConnectionID === id));
        for (const c of list) await this._disconnectId(c.mainConnectionID, 'leftover');
    }

    /* the mix connection we hold, noted on disk until it is gone */
    _note(o) {
        if (!this.file) return;
        try { if (o) fs.writeFileSync(this.file, JSON.stringify(o)); else if (fs.existsSync(this.file)) fs.unlinkSync(this.file); } catch (e) { this.log.warn('audio: ' + e); }
    }
    _noted() { try { return this.file ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null; } catch (e) { return null; } }

    start() {
        return this._queue(async () => {
            try {
                await this._init();
                // the exclusive source: every connection is ours (CarLifeMedia is China-only)
                await this._sweep(EXCLUSIVE.source).catch((e) => this.log.warn('audio sweep: ' + e));
                await this._avail(EXCLUSIVE.source, false);
                // the mix source: only the connection we had open (a crash or a power-off while it played), and its
                // availability mark if we set one
                const n = this._noted();
                if (n && typeof n.source === 'number') {
                    await this._sweep(n.source, n.sink, n.id).catch((e) => this.log.warn('audio sweep: ' + e));
                    if (n.marked) await this._avail(n.source, false);
                    this._note(null);
                }
            } catch (e) { this.log.warn('audio start: ' + e); }
        });
    }

    /** Connect a route (any other one goes first). Resolves true when connected (or connecting), false when it failed. */
    connect(route) {
        return this._queue(async () => {
            if (sameRoute(route, this.route) && (this.state === 'connected' || this.state === 'connecting')) return true;
            if (this.route) await this._release();
            const gen = ++this.gen;
            this.route = route; this.failed = null; this.state = 'connecting'; this.error = null; this.connState = null; this.id = null;
            try {
                await this._init();
                if (route.markAvailable) await this._avail(route.source, true);
                const r = await this._call('connect', { sourceID: route.source, sinkID: route.sink });
                this.log.info('audio: connect ' + label(route) + ' ' + JSON.stringify(r));
                if (!okReply(r)) throw new Error('connect refused (' + (r && r.amError) + ')');
                // E_ALREADY_EXISTS: a connection that is not ours; we play into it and leave it alone
                this.id = r.amError !== 'E_ALREADY_EXISTS' && r.mainConnectionID !== undefined && r.mainConnectionID !== null ? r.mainConnectionID : null;
                if (route.kind === 'mix' && (r.amError !== 'E_ALREADY_EXISTS' || route.markAvailable)) this._note({ source: route.source, sink: route.sink, id: this.id, marked: !!route.markAvailable });
                this.state = 'connected';
                this._check(gen, this.checkMs);
                return true;
            } catch (e) {
                this.error = String(e && e.message || e);
                this.log.warn('audio: ' + label(route) + ' failed: ' + this.error);
                await this._release();
                this.state = 'failed'; this.failed = route;
                return false;
            }
        });
    }

    /** After a connect: the connection's state as the AudioManager lists it. A mix route still not CS_CONNECTED after
     *  settleMs (6 s) failed: it is released (shown as failed), so no pending connection is left behind. */
    _check(gen, ms, since) {
        since = since || 0;
        setTimeout(() => this._queue(async () => {
            if (gen !== this.gen || this.state !== 'connected') return;
            const route = this.route;
            const c = (await this._connections()).find((x) => x && x.sourceID === route.source && x.sinkID === route.sink);
            this.connState = c ? stateName(c.connectionState) : 'no connection';
            this.log.info('audio: ' + label(route) + ' ' + ms + ' ms after connect: ' + this.connState);
            if (route.kind !== 'mix' || this.connState === 'CS_CONNECTED') return;
            if (ms < this.settleMs) return this._check(gen, this.settleMs, ms);
            this.error = 'stays ' + this.connState;
            this.log.warn('audio: mix route ' + label(route) + ' ' + this.error + ': released');
            await this._release();
            this.state = 'failed'; this.failed = route;
        }).catch((e) => this.log.warn('audio check: ' + e)), ms - since);
    }

    /** Remove what the current route left: our connection, the exclusive source's sweep, the availability mark. */
    async _release() {
        const route = this.route, id = this.id;
        this.gen++;
        this.route = null; this.id = null; this.connState = null;
        if (!route) return;
        try {
            await this._init();
            if (id !== null) await this._disconnectId(id, 'our');
            if (route.kind === 'exclusive') await this._sweep(route.source);
        } catch (e) { this.log.warn('audio disconnect: ' + e); }
        if (route.kind === 'exclusive' || this.marked) await this._avail(route.source, false);
        if (route.kind === 'mix') this._note(null);
    }

    disconnect() {
        return this._queue(async () => {
            if (this.state === 'off') return;
            await this._release();
            this.state = 'off'; this.error = null; this.failed = null;
        });
    }

    /** Everything the AudioManager lists, for the Audio page's report: { sources, sinks, connections, errors }. */
    lists() {
        return this._queue(async () => {
            await this._init();
            const out = { sources: [], sinks: [], connections: [], errors: [] };
            const get = async (method, key, listKey, map) => {
                try { out[key] = arrayIn(await this._call(method, {}, 3000), listKey).map(map); } catch (e) { out.errors.push(method + ': ' + (e && e.message || e)); }
            };
            await get('getListMainSources', 'sources', 'listMainSources', (x) => ({ id: x.sourceID, name: String(x.name || ''), cls: x.sourceClassID, avail: availOf(x) }));
            await get('getListMainSinks', 'sinks', 'listMainSinks', sinkOf);
            await get('getListMainConnections', 'connections', 'listConnections',
                (x) => ({ id: x.mainConnectionID, source: x.sourceID, sink: x.sinkID, state: stateName(x.connectionState) }));
            return out;
        });
    }

    /** The AudioManager's main sinks with their volume and mute state, [{ id, name, volume, mute, cls }] (the Audio
     *  page shows the volumes: does the car's volume knob show up here?); throws when the list is unavailable. */
    sinks() {
        return this._queue(async () => {
            await this._init();
            return arrayIn(await this._call('getListMainSinks', {}, 3000), 'listMainSinks').map(sinkOf).filter((s) => typeof s.id === 'number');
        });
    }

    /** The AudioManager's main sources, [{ id, name }]; throws when the list is unavailable. */
    sources() {
        return this._queue(async () => {
            await this._init();
            const r = await this._call('getListMainSources', {}, 3000);
            return arrayIn(r, 'listMainSources').map((s) => ({ id: s.sourceID, name: String(s.name || '') }))
                .filter((s) => typeof s.id === 'number');
        });
    }
}

module.exports = { Route, EXCLUSIVE, MIX_DEFAULT, MIX_SOURCES, SINK, MAIN_SINK, deviceFor, mixCandidates, mixRoute, routeFor, sameRoute };
