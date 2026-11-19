'use strict';
/*
 * Vitals: what each settings row shows and what a press changes. Pure functions, no SDK:
 * tested on a desktop by tools/test_model.js.
 *
 * A press cycles a row to its next value; the service (ida-vitals-cluster) checks and saves it
 * and answers with the settings it now uses, which the screen then shows.
 */
const TEMP_UNITS = ['auto', 'C', 'F'];
const PRESS_UNITS = ['auto', 'bar', 'psi', 'kPa'];
const ACCENTS = ['blue', 'lightblue', 'white'];
const NAMES = {
    auto: 'Car setting', C: '°C', F: '°F', bar: 'bar', psi: 'psi', kPa: 'kPa',
    blue: 'Blue', lightblue: 'Light blue', white: 'White',
};
const COOLANT_WARN = [95, 100, 105, 110, 115, 120, 125, 130];
const OIL_WARN = [110, 115, 120, 125, 130, 135, 140, 145, 150];
const GEARBOX_WARN = [100, 105, 110, 115, 120, 125, 130, 135, 140];
const SHIFT = { min: -100, max: 200, step: 10 };   // px, positive = lower (the service's range)
const ZOOM = { min: 70, max: 150, step: 5 };       // %

function next(list, v) { return list[(list.indexOf(v) + 1) % list.length]; }
function onOff(v) { return v ? 'On' : 'Off'; }
function clamp(v, r) { return Math.max(r.min, Math.min(r.max, v)); }
function shift(v) { return !v ? 'Default' : v > 0 ? v + ' px lower' : -v + ' px higher'; }
function deg(c, s) { return s.tempUnit === 'F' ? Math.round(c * 9 / 5 + 32) + ' °F' : c + ' °C'; }

const ROWS = [
    { name: 'vtTempUnit', label: 'Temperature unit', value: (s) => NAMES[s.tempUnit], press: (s) => ({ tempUnit: next(TEMP_UNITS, s.tempUnit) }) },
    { name: 'vtPressUnit', label: 'Pressure unit', value: (s) => NAMES[s.pressUnit], press: (s) => ({ pressUnit: next(PRESS_UNITS, s.pressUnit) }) },
    { name: 'vtCoolantWarn', label: 'Water warning', value: (s) => deg(s.coolantWarn, s), press: (s) => ({ coolantWarn: next(COOLANT_WARN, s.coolantWarn) }) },
    { name: 'vtOilWarn', label: 'Engine oil warning', value: (s) => deg(s.oilWarn, s), press: (s) => ({ oilWarn: next(OIL_WARN, s.oilWarn) }) },
    { name: 'vtGearboxWarn', label: 'Gearbox oil warning', value: (s) => deg(s.gearboxWarn, s), press: (s) => ({ gearboxWarn: next(GEARBOX_WARN, s.gearboxWarn) }) },
    { name: 'vtAccent', label: 'Gauge colour', value: (s) => NAMES[s.accent], press: (s) => ({ accent: next(ACCENTS, s.accent) }) },
    { name: 'vtPressures', label: 'Tyre pressures', value: (s) => (s.pressures ? 'Shown' : 'Hidden'), press: (s) => ({ pressures: !s.pressures }) },
    { name: 'vtUp', label: 'Move widget up', value: (s) => shift(s.shiftY), press: (s) => ({ shiftY: clamp((s.shiftY || 0) - SHIFT.step, SHIFT) }) },
    { name: 'vtDown', label: 'Move widget down', value: (s) => shift(s.shiftY), press: (s) => ({ shiftY: clamp((s.shiftY || 0) + SHIFT.step, SHIFT) }) },
    { name: 'vtZoomIn', label: 'Widget bigger', value: (s) => (s.zoom || 100) + ' %', press: (s) => ({ zoom: clamp((s.zoom || 100) + ZOOM.step, ZOOM) }) },
    { name: 'vtZoomOut', label: 'Widget smaller', value: (s) => (s.zoom || 100) + ' %', press: (s) => ({ zoom: clamp((s.zoom || 100) - ZOOM.step, ZOOM) }) },
    { name: 'vtDemo', label: 'Demo values', value: (s) => onOff(s.demo), press: (s) => ({ demo: !s.demo }) },
    { name: 'vtReset', label: 'Reset to defaults', value: () => '', press: () => 'reset' },
];

/* the status line under the title */
function statusText(reply, connected, car) {
    if (!connected) return 'Vitals widget service not running. Install "Vitals Cluster" and restart the head unit.';
    if (!reply || !reply.status) return 'Connecting to the widget...';
    const st = reply.status;
    const parts = ['Widget: ' + (st.renderer === 'connected' ? 'on (' + st.target + ')' : st.renderer)];
    if (reply.settings && reply.settings.demo) parts.push('demo values');
    else {
        parts.push('Engine: ' + (st.engine ? 'live' : car && car.engine ? 'waiting' : 'no data yet'));
        parts.push('Gearbox: ' + (st.gearbox ? 'live' : car && car.gearbox ? 'waiting' : 'no data yet'));
        parts.push('Tyres: ' + (st.tyres ? 'live' : 'no data yet'));
    }
    return parts.join('  |  ');
}

module.exports = { ROWS, TEMP_UNITS, PRESS_UNITS, ACCENTS, COOLANT_WARN, OIL_WARN, GEARBOX_WARN, SHIFT, ZOOM, next, statusText };
