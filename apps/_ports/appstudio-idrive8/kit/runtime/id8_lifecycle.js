'use strict';
/* AQ derived ID8 adaptation of the MIT-licensed Perea kit lifecycle:
 * alexpereap/pereaperformance-idrive7-apps @ 5b758fad17761b8696989e2a4ffbfbfab4926b6f,
 * kit/runtime/mgu.js (entry setup and foreground initialization).
 * No SDK code, target paths or fixed applet/UID allocations are included. */
const FOREGROUND = ['ENTRY_POINT', 'LUM', 'BOOKMARK', 'START_WIDGET', 'TRIGGER_HMI', 'SPEECH_COMMAND'];

function truth(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
}

function foreground(app) {
    let visibility;
    try { visibility = typeof app.getVisibilityData === 'function' ? app.getVisibilityData() : null; } catch (e) { /* optional SDK method */ }
    return FOREGROUND.indexOf(String((visibility && visibility.reason) || app.startReason)) >= 0;
}

async function entryPoints(app, rhmi, mainState, fallbackIds, log) {
    if (!mainState) throw new Error('ID8 main state is absent');
    // As in the donor, a missing HMI reply must not block initialized forever.
    async function attempt(label, operation) {
        let timer;
        try {
            await Promise.race([
                Promise.resolve().then(operation),
                new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('no HMI reply after 4 s')), 4000); })
            ]);
            return true;
        } catch (e) {
            if (log && log.warn) log.warn('ID8 entry ' + label + ': ' + (e && e.message || e));
            return false;
        } finally { clearTimeout(timer); }
    }
    if (typeof mainState.updateResources === 'function') await attempt('resources', () => mainState.updateResources());
    const description = app.appDescription && app.appDescription.application;
    const described = description && Array.isArray(description.entryPoints) ? description.entryPoints : [];
    const ids = (described.length ? described.map((entry) => entry.uuid) : fallbackIds || []).filter(Boolean);
    const entries = typeof app.getEntryPoints === 'function' ? app.getEntryPoints() || [] : [];
    const handled = {};
    for (const entry of entries) {
        let d;
        try { d = typeof entry.getDescription === 'function' ? entry.getDescription() : null; } catch (e) { continue; }
        if (!d || ids.indexOf(d.uuid) < 0) continue;
        handled[d.uuid] = true;
        if (typeof entry.init === 'function') await attempt('init', () => entry.init());
        await attempt('mapping', () => rhmi.mapEntryState(d.uuid, mainState));
        try {
            if (entry.entryPoint && typeof entry.entryPoint.setText === 'function') await attempt('text', () => entry.entryPoint.setText(d.textId));
            if (d.icon && entry.entryPoint && typeof entry.entryPoint.setIcon === 'function') await attempt('icon', () => entry.entryPoint.setIcon(d.icon));
        } catch (e) { if (log && log.warn) log.warn('ID8 entry appearance: ' + e.message); }
        if (typeof entry.setAvailability === 'function') await attempt('availability', () => entry.setAvailability('ENABLED'));
    }
    // SDKs that provide descriptions without wrapper objects can still map the
    // known entry IDs; no new UUID or numeric applet ID is invented here.
    for (const id of ids) if (!handled[id]) await attempt('mapping', () => rhmi.mapEntryState(id, mainState));
    return ids;
}

module.exports = { truth, foreground, entryPoints };
