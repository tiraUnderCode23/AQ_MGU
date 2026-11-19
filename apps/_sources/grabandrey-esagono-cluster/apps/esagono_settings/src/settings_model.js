'use strict';
/*
 * Esagono Settings: what each row shows and what a press changes. Pure functions,
 * no SDK: tested on a desktop by tools/test_model.js.
 *
 * A press cycles a row to its next value; the service (esagono-cluster) checks and
 * saves it and answers with the settings it now uses, which the screen then shows.
 */
const MODES = ['comfort', 'sport', 'track'];
const MODE_NAMES = { comfort: 'Comfort', sport: 'Sport', track: 'Track' };
const SCALES = [6000, 7000, 8000, 9000, 10000];

function rpm(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' rpm'; }
function onOff(v) { return v ? 'On' : 'Off'; }

/* the next value in a list, wrapping; a value not in the list goes to the first */
function next(list, v) {
    const i = list.indexOf(v);
    return list[(i + 1) % list.length];
}

/* redline choices: 250 rpm steps from 4 000 to the scale's top */
function redlines(rpmMax) {
    const out = [];
    for (let r = 4000; r <= rpmMax; r += 250) out.push(r);
    return out;
}
/* shift flash choices: from 500 under the redline to the scale's top, 100 rpm steps */
function flashes(redline, rpmMax) {
    const out = [];
    for (let r = Math.max(2000, redline - 500); r <= rpmMax; r += 100) out.push(r);
    return out;
}

/* the rows, in screen order: name (the uiDescription component), label, value text, and
 * the change a press asks for (a partial settings object, or 'reset') */
const ROWS = [
    { name: 'esgMode', label: 'Drive mode', value: (s) => MODE_NAMES[s.mode] || s.mode,
        press: (s) => ({ mode: next(MODES, s.mode) }) },
    { name: 'esgRedline', label: 'Redline', value: (s) => rpm(s.redline),
        press: (s) => ({ redline: next(redlines(s.rpmMax), s.redline) }) },
    { name: 'esgFlash', label: 'Shift flash', value: (s) => rpm(s.flashRpm),
        press: (s) => ({ flashRpm: next(flashes(s.redline, s.rpmMax), s.flashRpm) }) },
    { name: 'esgScale', label: 'Scale', value: (s) => '0 - ' + rpm(s.rpmMax),
        press: (s) => {
            const rpmMax = next(SCALES, s.rpmMax);
            // keep the redline and flash on the new scale, a little under its top
            const redline = Math.min(s.redline, rpmMax - 500);
            return { rpmMax: rpmMax, redline: redline, flashRpm: Math.min(Math.max(s.flashRpm, redline), rpmMax) };
        } },
    { name: 'esgBackdrop', label: 'Dark backdrop', value: (s) => onOff(s.backdrop),
        press: (s) => ({ backdrop: !s.backdrop }) },
    { name: 'esgDemo', label: 'Demo sweep (no live rpm)', value: (s) => onOff(s.demo),
        press: (s) => ({ demo: !s.demo }) },
    { name: 'esgReset', label: 'Reset to defaults', value: () => '', press: () => 'reset' },
];

/* the status line under the title */
function statusText(reply, connected) {
    if (!connected) return 'Esagono service not running. Install "Esagono Cluster" and restart the head unit.';
    if (!reply || !reply.status) return 'Connecting to the Esagono service...';
    const st = reply.status;
    const parts = [];
    parts.push('Renderer: ' + st.renderer + (st.target ? ' (' + st.target + ')' : ''));
    if (st.rpmSource === 'hmictl') parts.push(st.rpmLive ? 'Live rpm: ' + st.rpm : 'Live rpm: waiting for the engine');
    else parts.push(reply.settings && reply.settings.demo ? 'No live rpm: demo sweep' : 'No live rpm (needs IterioDev Overlays)');
    return parts.join('  |  ');
}

module.exports = { ROWS, MODES, SCALES, next, redlines, flashes, statusText, rpm };
