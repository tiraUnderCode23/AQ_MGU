'use strict';
/* AQ adaptation of the MIT Perea public lifecycle implementation at
 * 5b758fad17761b8696989e2a4ffbfbfab4926b6f/kit/runtime/mgu.js.
 * This helper uses the SDK supplied by the target; it contains no SDK code. */
const FOREGROUND = ['ENTRY_POINT', 'LUM', 'BOOKMARK', 'START_WIDGET', 'TRIGGER_HMI', 'SPEECH_COMMAND'];
const truth = (v) => v === true || v === 1 || v === '1' || v === 'true';
function foreground(app) {
    let visibility;
    try { visibility = typeof app.getVisibilityData === 'function' ? app.getVisibilityData() : null; } catch (e) { /* optional SDK API */ }
    return FOREGROUND.indexOf(String((visibility && visibility.reason) || app.startReason)) >= 0;
}
function within(promise, milliseconds, label) {
    let timer;
    return Promise.race([Promise.resolve(promise), new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out')), milliseconds);
    })]).then((value) => { clearTimeout(timer); return value; }, (error) => { clearTimeout(timer); throw error; });
}
async function entryPoints(app, rhmi, mainState, fallbackIds) {
    if (!mainState || !rhmi) throw new Error('ID8 main state is not ready');
    if (typeof mainState.updateResources === 'function') await within(mainState.updateResources(), 4000, 'ID8 main resources');
    const desc = app.appDescription && app.appDescription.application;
    const described = desc && Array.isArray(desc.entryPoints) ? desc.entryPoints : [];
    const ids = described.length ? described.map((entry) => entry.uuid) : fallbackIds;
    const entries = typeof app.getEntryPoints === 'function' ? app.getEntryPoints() || [] : [];
    await within((async () => {
        for (const id of ids) {
            const ep = entries.find((entry) => {
                try { return typeof entry.getDescription === 'function' && entry.getDescription().uuid === id; } catch (e) { return false; }
            });
            if (ep && typeof ep.init === 'function') await ep.init();
            await rhmi.mapEntryState(id, mainState);
            if (ep) {
                const d = ep.getDescription();
                if (ep.entryPoint && typeof ep.entryPoint.setText === 'function') await ep.entryPoint.setText(d.textId);
                if (d.icon && ep.entryPoint && typeof ep.entryPoint.setIcon === 'function') await ep.entryPoint.setIcon(d.icon);
                if (typeof ep.setAvailability === 'function') await ep.setAvailability('ENABLED');
            }
        }
    })(), 8000, 'ID8 entry points');
    return ids;
}
module.exports = { truth, foreground, within, entryPoints };
