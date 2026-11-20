'use strict';
/*
 * Light Logger: the body controller's lamp outputs, the switched lights that aren't RGB ambient modules (and so
 * not in lin.js). Pure, tested on a desktop by tools/test_lightlog.js.
 *
 *   22 E3B9 (BDC_G05: G20 family, G87 likely) or 22 4500 (older BDC): one byte per lamp output, its state, as the
 *   MIT-licensed idrive7-apps kit reads it (apps/ambient_config/strobe.js, its "lamp outputs" status). Which output
 *   is which light isn't in any public table, so they are numbered: the one that goes dark with the logos is the
 *   one to pin.
 *
 * READ ONLY: only these status identifiers are read. The kit's write identifiers (E3B5 / 4501) are never sent.
 *
 * The same module shape serves the values the finder (finder.js) pins: { bus: VALUES, key 'd:<ecu>:<did>' }.
 */
const BDC = 0x40;
const DIDS = [[0xe3, 0xb9], [0x45, 0x00]];
const LAMPS = 2, VALUES = 3;                       // journal bus numbers after lin.js's 0 and 1

const hex = (n, w) => n.toString(16).toUpperCase().padStart(w || 2, '0');
const hexBytes = (b) => Array.prototype.map.call(b || [], (x) => hex(x)).join(' ');

/* 62 <did> b1 b2 ... -> [{ bus: LAMPS, nad, loc, name, lamp, value, on, raw, known, seat }], or null */
function parse(uds, did) {
    const b = Array.prototype.slice.call(uds || []);
    if (b[0] !== 0x62 || b[1] !== did[0] || b[2] !== did[1] || b.length < 4) return null;
    return b.slice(3).map((v, i) => ({
        bus: LAMPS, nad: i + 1, loc: i + 1, name: 'BDC lamp output ' + (i + 1), lamp: true, known: true, seat: false,
        value: v, on: v > 0, raw: hex(v), r: 0, g: 0, b: 0, white: 0, bright: v > 0 ? 100 : 0, fault: false,
    }));
}

/* a value the finder found, as a module: on = any byte not 0 */
function valueModule(ecu, did, bytes, name, nad) {
    const raw = hexBytes(bytes);
    return {
        bus: VALUES, nad: nad || 1, loc: did, key: 'd:' + hex(ecu) + ':' + hex(did, 4), name: name || unitName(ecu) + ' 0x' + hex(did, 4),
        did: true, known: true, seat: false, value: raw, on: Array.prototype.some.call(bytes || [], (x) => x !== 0), raw: raw,
        r: 0, g: 0, b: 0, white: 0, bright: 0, fault: false,
    };
}

const UNITS = { 0x40: 'BDC', 0x10: 'BDC gateway', 0x6d: 'Seat module 0x6D', 0x6e: 'Seat module 0x6E', 0x6f: 'Seat module 0x6F' };
function unitName(ecu) { return UNITS[ecu] || 'ECU 0x' + hex(ecu); }

module.exports = { BDC, DIDS, LAMPS, VALUES, UNITS, parse, valueModule, unitName, hex, hexBytes };
