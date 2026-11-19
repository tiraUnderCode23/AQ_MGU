'use strict';
/**
 * Where the car is. The head unit's navigation GPS when the unit offers it,
 * otherwise a test drive toward a Warsaw camera (Settings: Camera test).
 */
const CAMS = require('./cameras');

const IFACES = [
    {
        iface: 'de.bmw.infotainment.navigation.positioning.Positioning',
        inst: 'Main_Instance',
        fields: ['position', 'gnssPosition', 'mapMatchedPosition'],
    },
];

function bearing(a, b) {
    const p1 = a.lat * Math.PI / 180;
    const p2 = b.lat * Math.PI / 180;
    const dl = (b.lon - a.lon) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function metres(a, b) {
    const R = 6371000;
    const p1 = a.lat * Math.PI / 180;
    const p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180;
    const dl = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function startGps(ctx) {
    const pos = { lat: null, lon: null, course: null, src: 'none' };
    let last = null;
    let sim = null;
    let simAt = 0;

    function accept(lat, lon, src) {
        if (typeof lat !== 'number' || typeof lon !== 'number') return;
        if (!(lat > 49 && lat < 56 && lon > 14 && lon < 25)) return;
        const here = { lat: lat, lon: lon };
        if (last) {
            const moved = metres(last, here);
            if (moved > 4 && moved < 400) pos.course = bearing(last, here);
        }
        last = here;
        pos.lat = lat;
        pos.lon = lon;
        pos.src = src;
    }

    function dig(v, depth) {
        if (!v || depth > 5) return;
        if (typeof v.latitude === 'number' && typeof v.longitude === 'number') accept(v.latitude, v.longitude, 'car');
        else if (typeof v.lat === 'number' && (typeof v.lon === 'number' || typeof v.lng === 'number')) accept(v.lat, v.lon || v.lng, 'car');
        if (Array.isArray(v)) {
            for (let i = 0; i < v.length && i < 8; i++) dig(v[i], depth + 1);
            return;
        }
        if (typeof v === 'object') {
            const keys = Object.keys(v);
            for (let i = 0; i < keys.length; i++) dig(v[keys[i]], depth + 1);
        }
    }

    if (ctx.signals && ctx.signals.watch) {
        IFACES.forEach((S) => {
            const handlers = {};
            S.fields.forEach((f) => { handlers[f] = (v) => dig(v, 0); });
            ctx.signals.watch(S.iface, S.inst, handlers, ctx.log).catch(() => {});
        });
    }

    return {
        pos: pos,
        step(speedKmh, now) {
            if (!ctx.settings || ctx.settings.get('camTest') !== 'approach' || !CAMS.length) {
                sim = null;
                return;
            }
            const target = CAMS[0];
            if (!sim) {
                sim = { lat: target.lat - 450 / 111320, lon: target.lon };
                simAt = now;
            }
            const dt = Math.min(500, Math.max(0, now - simAt));
            simAt = now;
            const stepM = Math.max(0, speedKmh || 0) * (dt / 1000) / 3.6;
            const left = metres(sim, target);
            if (left < 20) {
                sim = null;
                return;
            }
            const br = bearing(sim, target);
            const rad = br * Math.PI / 180;
            sim.lat += (stepM * Math.cos(rad)) / 111320;
            sim.lon += (stepM * Math.sin(rad)) / (111320 * Math.cos(sim.lat * Math.PI / 180));
            pos.lat = sim.lat;
            pos.lon = sim.lon;
            pos.course = br;
            pos.src = 'test';
        },
    };
}

module.exports = { startGps };
