'use strict';
// AQ source-port guard. No vehicle requests: checks only decoded local state.
// ID8 reads are held until both providers and their required fields are current.
module.exports = function readState(car, now, maxAgeMs) {
    const missing = reason => ({ok:false, reason});
    if (!car || typeof car.data !== 'function') return missing('vehicle state source unavailable');
    const data = car.data(), age = maxAgeMs == null ? 5000 : maxAgeMs;
    if (!data || data.demo) return missing('live vehicle state unavailable');
    const providers = ['de.bmw.infotainment.vehicle.CDS', 'de.bmw.infrastructure.VehicleCondition'];
    if (!providers.every(iface => (car.subs || []).some(sub => sub.iface === iface && sub.available && !sub.error)))
        return missing('required vehicle-state provider unavailable');
    const times = data._freshAt || {};
    if (!['rpm', 'condition'].every(key => Number.isFinite(times[key]) && now >= times[key] && now - times[key] <= age))
        return missing('required vehicle state is unknown or stale');
    if ([1,2,3,5,7,10].indexOf(data.condition) < 0 || !Number.isFinite(data.rpm) || data.rpm < 0)
        return missing('vehicle state is unknown or transitioning');
    if (data.rpm > 0 && data.rpm < 450) return missing('engine state is transitioning');
    return {ok:true};
};
