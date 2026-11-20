'use strict';

const VEHICLE2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const MEMBER = 'statusVehiclePartType';
const TYPES = Object.freeze({
    4: { detected: 'petrol', propulsion: 'combustion' },
    5: { detected: 'petrol', propulsion: 'combustion' },
    6: { detected: 'diesel', propulsion: 'combustion' },
    7: { detected: 'diesel', propulsion: 'combustion' },
    // Numeric 8/9 mappings are unverified and may encode hybrid/electric variants.
    8: { detected: null, propulsion: 'unknown' },
    9: { detected: null, propulsion: 'unknown' },
    BENZIN_DIREKTEINSPRITZUNG: { detected: 'petrol', propulsion: 'combustion' },
    BENZIN_KONVENTIONELL: { detected: 'petrol', propulsion: 'combustion' },
    DIESEL_DIREKTEINSPRITZUNG: { detected: 'diesel', propulsion: 'combustion' },
    DIESEL_KONVENTIONELL: { detected: 'diesel', propulsion: 'combustion' },
    HYBRIDMOTOR: { detected: null, propulsion: 'hybrid' },
    ELEKTROMOTOR: { detected: null, propulsion: 'electric' }
});
const PROFILES = new Set(['unknown', 'petrol', 'diesel']);

function create(options) {
    const opts = options || {};
    if (!Number.isFinite(opts.ttlMs) || opts.ttlMs <= 0) throw new TypeError('ttlMs must be a positive finite number');
    let record = null;
    let expired = false;
    let manualOverride = null;

    function expire(now) {
        if (!Number.isFinite(now)) throw new TypeError('now must be a finite timestamp');
        if (record && now - record.observedAt >= opts.ttlMs) {
            record = null;
            expired = true;
            return true;
        }
        return false;
    }
    function snapshot(now) {
        expire(now);
        const detected = record ? record.detected : null;
        const propulsion = record ? record.propulsion : 'unknown';
        return {
            detected,
            propulsion,
            source: record ? { interface: VEHICLE2, member: MEMBER } : null,
            observedAt: record ? record.observedAt : null,
            expired,
            manualOverride,
            profile: manualOverride || detected || 'unknown'
        };
    }
    return Object.freeze({
        observe(event, now) {
            if (!Number.isFinite(now)) return { accepted: false, reason: 'invalid-time' };
            expire(now);
            if (!event || !event.provenance || event.provenance.interface !== VEHICLE2 || event.provenance.member !== MEMBER) {
                return { accepted: false, reason: 'provenance' };
            }
            if (event.cached === true || event.cache === true) return { accepted: false, reason: 'cached' };
            const at = event.observedAt;
            if (!Number.isFinite(at) || at < 0) return { accepted: false, reason: 'invalid-time' };
            if (at > now) return { accepted: false, reason: 'future' };
            if (now - at >= opts.ttlMs) return { accepted: false, reason: 'stale' };
            if (record && at < record.observedAt) return { accepted: false, reason: 'out-of-order' };
            const raw = event.value && typeof event.value === 'object' ? event.value.typeEngine : undefined;
            let classification;
            if (raw === 0 || raw === '0') classification = { detected: null, propulsion: 'unknown' };
            else if (Object.prototype.hasOwnProperty.call(TYPES, raw)) classification = TYPES[raw];
            else return { accepted: false, reason: 'invalid' };
            record = { detected: classification.detected, propulsion: classification.propulsion, observedAt: at };
            expired = false;
            return { accepted: true, detected: record.detected, propulsion: record.propulsion };
        },
        expire,
        snapshot,
        setManualOverride(profile) {
            if (profile !== null && !PROFILES.has(profile)) throw new TypeError('manual override must be unknown, petrol, diesel, or null');
            manualOverride = profile === 'unknown' ? null : profile;
            return manualOverride;
        }
    });
}

module.exports = { create, VEHICLE2, MEMBER };
