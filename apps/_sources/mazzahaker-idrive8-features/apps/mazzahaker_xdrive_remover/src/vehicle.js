// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const { nativeTick } = require('./tasu.js');

const SIGNAL_AGE_MS = 2000;
const POLL_MS = 1000;
const SELECTOR = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' };
const SELECTOR_DIAGNOSTIC = { N: 'N', R: 'R', P: 'P', NP: 'N or P', N_OR_P: 'N or P',
    1: 'N', 2: 'R', 3: 'P', 4: 'N or P' };
for (let gear = 1; gear <= 9; gear++) {
    SELECTOR_DIAGNOSTIC['_' + gear] = SELECTOR_DIAGNOSTIC[gear + 4] = 'Gear ' + gear;
}
const IGNITION = { PRUEFEN_ANALYSE_DIAGNOSE: 7, WOHNEN: 5, FAHREN: 10 };
const scaled = (raw, factor) => Number.isInteger(raw) && raw >= 0 && raw < 65535 ? raw * factor : null;

const CONDITIONS = [
    ['de.bmw.infotainment.vehicle.CDS', [
        ['statusEngineSpeed2', 'rpm', 'actualValueRPMEngineCrankshaft', (raw) => scaled(raw, 0.25), true],
        ['statusHandBrake', 'brake', 'statusContactHandBrake', (raw) => {
            if (raw === 'HANDBREMSE_ANGEZOGEN' || raw === 2) return true;
            if (raw === 'HANDBREMSE_GELOEST' || raw === 1) return false;
            return null;
        }, true]
    ]],
    ['de.bmw.infotainment.vehicle.Vehicle2', [
        ['statusCarSpeed2', 'speed', 'speedVehicleCentreOfGravity', (raw) => scaled(raw, 1 / 64), true]
    ]],
    ['de.bmw.infrastructure.VehicleInformation', [
        ['statusGearboxDrive', 'gear', 'statusActualStageDrive',
            (raw) => Object.prototype.hasOwnProperty.call(SELECTOR, raw) ? SELECTOR[raw] : null, false],
        ['DataPowerTrain2', 'gearDiagnostic', 'statusGearSelectionDrive',
            (raw) => Object.prototype.hasOwnProperty.call(SELECTOR_DIAGNOSTIC, raw) ?
                SELECTOR_DIAGNOSTIC[raw] : null, false]
    ]],
    ['de.bmw.infrastructure.VehicleCondition', [
        ['VehicleCondition', 'ignition', 'statusConditionVehicle', (raw) => {
            const code = typeof raw === 'number' ? raw : IGNITION[raw];
            return code === 5 || code === 7 || code === 10 ? code : null;
        }, false]
    ]]
];

const clock = () => {
    const [seconds, nanos] = process.hrtime();
    return seconds * 1000 + nanos / 1e6;
};

async function watchVehicle(transport, onSignal, onError, options) {
    const report = onError || (() => {});
    const pollMs = (options && options.pollMs) || POLL_MS;
    for (const [iface, fields] of CONDITIONS) {
        if (transport.closed) return;
        let proxy;
        try {
            proxy = await transport.proxy(iface, '1');
        } catch (error) {
            fields.forEach(([, name]) => report(name, error.message));
            continue;
        }

        const received = new Map();
        const eventSeq = new Map();   // signal -> number of events received; a read that started earlier must not win
        let providerAvailable;
        let availabilityVersion = 0;
        const reportMissing = (name, error) => {
            if (!transport.closed && !received.has(name)) report(name, error);
        };
        const receive = (field, data, source, at) => {
            const [, name, member, decode] = field;
            const raw = data && data[member];
            const value = typeof raw === 'number' || typeof raw === 'string' ? raw : null;
            received.set(name, source);
            onSignal(name, decode(value), value, source, at);
        };
        for (const field of fields) {
            if (transport.closed) return;
            const [name, signal] = field;
            try {
                await nativeTick(() => proxy.subscribe({
                    name,
                    onReceive: (data) => {
                        if (transport.closed || providerAvailable === false) return;
                        eventSeq.set(signal, (eventSeq.get(signal) || 0) + 1);
                        receive(field, data, 'event');
                    }
                }), name + ' subscription', 2000);
            } catch (error) {
                reportMissing(signal, error.message);
            }
        }

        const availability = async (available) => {
            if (transport.closed) return;
            const version = ++availabilityVersion;
            providerAvailable = Boolean(available);
            if (!providerAvailable) {
                received.clear();
                fields.forEach(([, name]) => report(name, 'Provider unavailable'));
                return;
            }
            if (typeof proxy.getValue !== 'function') return;
            for (const field of fields) {
                const [name, signal, , , readable] = field;
                if (transport.closed || version !== availabilityVersion) return;
                if (!readable || received.get(signal) === 'event') continue;
                const started = clock();
                const seq = eventSeq.get(signal) || 0;
                try {
                    const value = await nativeTick(() => proxy.getValue(name, 1500), name + ' read', 2000);
                    if (!transport.closed && version === availabilityVersion && received.get(signal) !== 'event' &&
                        (eventSeq.get(signal) || 0) === seq) {
                        receive(field, value, 'getter', started);
                    }
                } catch (error) {
                    if (version === availabilityVersion) reportMissing(signal, error.message);
                }
            }
        };
        if (transport.closed) return;
        if (typeof proxy.subscribeToAvailability === 'function') {
            try {
                await nativeTick(() => proxy.subscribeToAvailability(availability), iface + ' availability', 2000);
            } catch (error) {
                fields.forEach(([, name]) => reportMissing(name, error.message));
            }
        }
        if (!transport.closed && availabilityVersion === 0 && typeof proxy.isAvailable === 'function') {
            try {
                const offered = await nativeTick(() => proxy.isAvailable(), iface + ' status', 2000);
                if (offered && availabilityVersion === 0) await availability(true);
            } catch (error) {
                fields.forEach(([, name]) => reportMissing(name, error.message));
            }
        }

        // Readable signals are re-read about once a second, so an unchanged value (a stationary car) still
        // gets a new timestamp. If a read fails the last value keeps its old timestamp and goes stale.
        if (typeof proxy.getValue === 'function') {
            let polling = false;
            const timer = setInterval(async () => {
                if (transport.closed) {
                    clearInterval(timer);
                    return;
                }
                if (polling || providerAvailable !== true) return;
                polling = true;
                try {
                    for (const field of fields) {
                        const [name, signal, , , readable] = field;
                        if (!readable || transport.closed || providerAvailable !== true) continue;
                        // The answer counts only if it belongs to the same availability period of this
                        // provider and no event for the signal arrived while the read was in flight (the
                        // event is newer). Its timestamp is the moment the request started, not the answer.
                        const version = availabilityVersion;
                        const seq = eventSeq.get(signal) || 0;
                        const started = clock();
                        try {
                            const value = await nativeTick(() => proxy.getValue(name, 1500), name + ' read', 2000);
                            if (!transport.closed && providerAvailable === true && version === availabilityVersion &&
                                (eventSeq.get(signal) || 0) === seq) {
                                receive(field, value, 'getter', started);
                            }
                        } catch (error) {
                            // keep the last value; its age shows that it is stale
                        }
                    }
                } finally {
                    polling = false;
                }
            }, pollMs);
        }
    }
}

function signalManifest() {
    const proxies = {};
    for (const [iface, fields] of CONDITIONS) {
        const attributes = {};
        fields.forEach(([field, , , , readable]) => { attributes[field] = readable ? 'rs' : 's'; });
        proxies[iface] = { instances: ['1'], attributes };
    }
    return proxies;
}

function signalText(name, sample, now) {
    if (!sample) return 'Waiting for data';
    if (sample.error) return 'Unavailable · ' + sample.error;
    const age = Math.max(0, now - sample.at);
    const value = sample.value;
    let decoded = 'Unknown';
    if (value !== null) {
        if (name === 'ignition') decoded = { 5: 'Accessory mode', 7: 'Ignition on', 10: 'Drive-ready' }[value];
        else if (name === 'brake') decoded = value ? 'Applied' : 'Released';
        else if (name === 'rpm') decoded = value + ' rpm';
        else if (name === 'speed') decoded = value.toFixed(2) + ' km/h';
        else decoded = value;
    }
    const source = sample.source === 'getter' ? 'read' : 'event';
    return decoded + ' · raw ' + (sample.raw === null ? '—' : sample.raw) +
        ' · ' + source + ' ' + (age / 1000).toFixed(1) + ' s ago' +
        (age > SIGNAL_AGE_MS ? ' · No recent update' : '');
}

module.exports = { watchVehicle, signalManifest, signalText };
