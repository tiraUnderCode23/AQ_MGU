'use strict';
/**
 * sidepanel.js - the side view on the instrument cluster: one image layer in the cluster's centre (the
 * "map" target of the Store's Cluster renderer, 1088 x 480), shown while a turn signal is on, hidden as soon
 * as it stops. The speed, the gear and the warning lamps sit outside that area and are never covered.
 *
 * 0.1: the camera feed is not connected yet (nobody has found where the car's camera pictures can be read),
 * so the layer carries a panel that names the side and says so: it proves the trigger and the place on the
 * cluster in the car. A camera source, once found, becomes a video layer in the same rect (frames through
 * the client's video()/frame(), 4:2:0), with the same show / hide and the same fail-safe: no frame for
 * STALE_MS and the picture goes, it never freezes.
 *
 * The connection opens on the first show and stays (a show is then instant); the layer is made once and
 * only its visibility and, when the side changes, its pixels move. Node 8.
 */
const { loadClient } = require('./kit/cluster_render');

const TARGET = 'map', MAP_W = 1088, MAP_H = 480;
const PW = 760, PH = 420;                       // the panel, centred in the map area
// 0.3.0: over the camera picture, only a badge in its top corner on the signalled side
const BW = 230, BH = 64, BY = 52;
const PX = Math.round((MAP_W - PW) / 2), PY = Math.round((MAP_H - PH) / 2);
const KLASS = 'content', Z = 70;
const RECONNECT_MS = 8000, LOAD_RETRY_MS = 30000;

class SidePanel {
    /** o: log, app, draw(side) -> { w, h, d } RGBA (PW x PH) */
    constructor(o) {
        this.log = o.log; this.app = o.app; this.draw = o.draw;
        this.cr = null; this.ready = false; this.ref = 0; this.side = null; this.drawn = null;
        this.err = null; this.errAt = 0; this.downAt = 0; this.state = ''; this.reason = '';
        this.shows = 0;
    }
    /** What the screen's status row says: { kind: 'on'|'wait'|'off'|'error', text }. */
    view() {
        if (this.err) return { kind: 'error', text: this.err.text };
        if (!this.cr) return { kind: 'off', text: 'Waiting for a signal' };
        if (!this.ready) return { kind: 'wait', text: 'Connecting to the Cluster renderer' };
        if (this.state === 'error') return { kind: 'error', text: 'Layer refused' + (this.reason ? ': ' + this.reason : '') };
        return { kind: 'on', text: this.side ? 'Showing ' + this.side : 'Ready' };
    }

    /** side: 'left' | 'right' | null; badge: the camera picture shows, so only the small badge */
    show(side, badge) {
        badge = !!badge;
        if (side === this.side && badge === this.badge && (side === null || this.ref)) return;
        if (badge !== this.badge && this.ref) { try { this.cr.drop(this.ref); } catch (e) { /* gone */ } this.ref = 0; this.drawn = null; }
        this.badge = badge;
        this.side = side;
        if (!side) { this._visible(false); return; }
        if (!this.cr) this._connect();
        this._apply();
    }

    _connect() {
        const now = Date.now();
        if (this.err && now - this.errAt < LOAD_RETRY_MS) return;
        const c = loadClient({});
        if (c.error) {
            if (!this.err || this.err.error !== c.error) this.log.warn('cluster: ' + c.text + (c.detail ? ' (' + c.detail + ')' : ''));
            this.err = c; this.errAt = now;
            return;
        }
        this.err = null;
        let cr;
        try { cr = this.cr = new c.ClusterRender(this.app, c.sock); } catch (e) { this.err = { error: 'load', text: e.message }; this.errAt = now; this.cr = null; return; }
        cr.on('ready', () => { if (this.cr !== cr) return; this.ready = true; this.log.info('cluster: connected'); this.ref = 0; this.drawn = null; this._apply(); });
        cr.on('disconnected', () => { if (this.cr !== cr) return; this.ready = false; this.ref = 0; this.downAt = Date.now(); });
        cr.on('layer', (ref, state, reason) => {
            if (this.cr !== cr || ref !== this.ref) return;
            if (state !== this.state) this.log.info('cluster: layer ' + state + (reason ? ' (' + reason + ')' : ''));
            this.state = state || ''; this.reason = reason || '';
        });
        cr.on('refused', (op, ref, reason) => { if (this.cr === cr) this.log.warn('cluster: refused ' + (op || '?') + ': ' + (reason || '?')); });
        this.downAt = now;
        this.poll = setInterval(() => {
            if (this.cr === cr && !this.ready && this.side && Date.now() - this.downAt >= RECONNECT_MS) { this.log.info('cluster: reconnecting'); this.close(); this._connect(); this._apply(); }
        }, 1000);
        try { cr.connect(); } catch (e) { this.log.warn('cluster: connect ' + e.message); }
    }

    _apply() {
        if (!this.cr || !this.ready || !this.side) return;
        const g = this.badge ? { x: this.side === 'left' ? 24 : MAP_W - 24 - BW, y: BY, w: BW, h: BH } : { x: PX, y: PY, w: PW, h: PH };
        if (this.ref && this.badge && this.geomX !== g.x) { try { this.cr.drop(this.ref); } catch (e) { /* gone */ } this.ref = 0; this.drawn = null; }
        if (!this.ref) {
            const ref = this.cr.image({ target: TARGET, klass: KLASS, z: Z, exclusive: false, contend: true, visible: false,
                x: g.x, y: g.y, w: g.w, h: g.h, iw: g.w, ih: g.h, sampling: 'nearest', fps: 4 });
            this.geomX = g.x;
            if (!ref) { this.log.warn('cluster: image layer refused by the client'); return; }
            this.ref = ref; this.drawn = null;
            this.log.info('cluster: layer ' + g.w + 'x' + g.h + ' at ' + g.x + ',' + g.y + ' on ' + TARGET + (this.badge ? ' (badge)' : ''));
        }
        if (this.drawn !== this.side) {
            const img = this.draw(this.side, this.badge);
            try { this.cr.pixels(this.ref, null, img.d); } catch (e) { this.log.warn('cluster: pixels ' + e.message); return; }
            this.drawn = this.side;
        }
        this._visible(true);
        this.shows++;
    }
    _visible(v) {
        if (!this.cr || !this.ready || !this.ref) return;
        try { this.cr.set(this.ref, { visible: !!v }); } catch (e) { /* gone: made again on the next show */ }
    }
    close() {
        if (this.poll) { clearInterval(this.poll); this.poll = null; }
        if (this.cr) { try { if (this.ref) this.cr.drop(this.ref); } catch (e) { /* gone */ } try { this.cr.close(); } catch (e) { /* closing */ } }
        this.cr = null; this.ready = false; this.ref = 0; this.drawn = null;
    }
}

module.exports = { SidePanel, PW, PH, BW, BH, MAP_W, MAP_H };
