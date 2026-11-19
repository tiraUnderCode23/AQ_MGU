'use strict';
/*
 * Light Logger: the ambient light modules on the body controller's (BDC, address 0x40) two LIN buses, as the
 * public BDC_G05 description has them (INNENLICHT_FI_LIN_1_LAYERING / _2_LAYERING). Pure: a reply in, the
 * modules out. Tested on a desktop by tools/test_lightlog.js.
 *
 *   read   22 DA5F (bus 1) / 22 E3D1 (bus 2). The BDC first asks its LIN modules (7F 22 78, the reply comes
 *          seconds later): 26 records of 10 bytes each: location, blue, green, red, brightness, white, short
 *          circuit, over-temperature, open load, internal fault. An empty record has location FF.
 *
 * This app only READS these identifiers. It never writes to the body controller.
 *
 * The location names follow the MIT-licensed idrive7-apps kit (github.com/cauliflowermossgrape/idrive7-apps,
 * apps/ambient_config/lin.js). A location this table doesn't know is logged as "Light 0x.." with its raw bytes:
 * the G87's seat logos may sit under any code, and that is what the log is for.
 */
const BDC = 0x40;
const BUSES = [
    { name: 'LIN 1', did: [0xda, 0x5f] },
    { name: 'LIN 2', did: [0xe3, 0xd1] },
];
const RECORD = 10, RECORDS = 26;

const NAMES = {
    0x01: 'Footwell driver front', 0x02: 'Footwell driver rear', 0x03: 'Footwell passenger front', 0x04: 'Footwell passenger rear',
    0x05: 'Driver front door line', 0x06: 'Driver front door decor', 0x07: 'Driver front door handle', 0x08: 'Driver front door pocket',
    0x09: 'Driver rear door line', 0x0a: 'Driver rear door decor', 0x0b: 'Driver rear door pocket',
    0x0c: 'Passenger front door line', 0x0d: 'Passenger front door decor', 0x0e: 'Passenger front door handle',
    0x0f: 'Passenger front door pocket', 0x10: 'Passenger rear door line', 0x11: 'Passenger rear door decor',
    0x12: 'Passenger rear door pocket', 0x13: 'Dash line driver', 0x14: 'Dash decor driver', 0x15: 'Dash line centre',
    0x16: 'Dash decor centre', 0x17: 'Dash line passenger', 0x18: 'Dash decor passenger', 0x19: 'B-pillar driver',
    0x1a: 'B-pillar passenger', 0x1b: 'Driver seat back', 0x1c: 'Passenger seat back', 0x1d: 'Centre stack tray',
    0x1e: 'Console tray', 0x1f: 'Gear selector left', 0x20: 'Gear selector right', 0x21: 'Driver rear door handle',
    0x22: 'Passenger rear door handle', 0x2b: 'Console line driver front', 0x2c: 'Console line driver rear',
    0x2d: 'Console line passenger front', 0x2e: 'Console line passenger rear', 0x2f: 'Console decor driver front',
    0x30: 'Console decor driver rear', 0x31: 'Console decor passenger front', 0x32: 'Console decor passenger rear',
    0x33: 'Driver seat back, 2nd row', 0x34: 'Passenger seat back, 2nd row', 0x35: 'Sunroof front left',
    0x36: 'Sunroof front left rear', 0x37: 'Sunroof front right', 0x38: 'Sunroof front right rear', 0x39: 'Sunroof rear left',
    0x3a: 'Sunroof rear left rear', 0x3b: 'Sunroof rear right', 0x3c: 'Sunroof rear right rear', 0x3d: 'Light blade left',
    0x3e: 'Light blade right', 0x4b: 'Cupholder front', 0x4c: 'Cupholder rear', 0x62: 'Driver front door line 2',
    0x63: 'Driver rear door line 2', 0x64: 'Passenger front door line 2', 0x65: 'Passenger rear door line 2',
};
[0x3f, 0x40, 0x41, 0x42].forEach((c) => { NAMES[c] = 'Driver door backlit decor'; });
[0x43, 0x44, 0x45, 0x46].forEach((c) => { NAMES[c] = 'Passenger door backlit decor'; });
[0x47, 0x48, 0x49, 0x4a].forEach((c) => { NAMES[c] = 'Console backlit decor'; });
/* the locations that sit in or on a seat: the ones to watch for the headrest logos */
const SEAT = [0x1b, 0x1c, 0x33, 0x34];

const hex = (n, w) => n.toString(16).toUpperCase().padStart(w || 2, '0');
const hexBytes = (b) => Array.prototype.map.call(b || [], (x) => hex(x)).join(' ');

function nameOf(loc) { return NAMES[loc] || 'Light 0x' + hex(loc); }

/* the request bytes after the service id (22) for bus 0 / 1 */
function readRequest(bus) { return BUSES[bus].did.slice(); }

/* A status reply (62 <DID> records...) -> [{ bus, nad, loc, name, seat, known, r, g, b, white, bright, on, fault, raw }],
 * or null when it isn't this bus's reply. */
function parseStatus(bus, uds) {
    const b = Array.prototype.slice.call(uds || []);
    const did = BUSES[bus].did;
    if (b[0] !== 0x62 || b[1] !== did[0] || b[2] !== did[1]) return null;
    const out = [];
    for (let i = 0; i < RECORDS; i++) {
        const r = b.slice(3 + i * RECORD, 3 + (i + 1) * RECORD);
        if (r.length < RECORD || r[0] === 0xff) continue;
        out.push({
            bus: bus, nad: i + 1, loc: r[0], name: nameOf(r[0]), seat: SEAT.indexOf(r[0]) >= 0, known: !!NAMES[r[0]],
            r: r[3], g: r[2], b: r[1], white: r[5], bright: r[4], on: r[4] > 0 || r[5] > 0,
            fault: !!(r[6] || r[7] || r[8] || r[9]), raw: hexBytes(r),
        });
    }
    return out;
}

/* one module, short: "Driver seat back (LIN 1 #3, 0x1B): on 80% rgb 255,255,255" */
function describe(m) {
    if (m.lamp || m.did) return m.name + ': ' + (m.on ? 'on' : 'off') + ' (' + m.raw + ')';
    const where = BUSES[m.bus].name + ' #' + m.nad + ', 0x' + hex(m.loc);
    const state = m.on ? 'on ' + m.bright + '% rgb ' + m.r + ',' + m.g + ',' + m.b + (m.white ? ' white ' + m.white : '') : 'off';
    return m.name + ' (' + where + '): ' + state + (m.fault ? ' FAULT' : '');
}

module.exports = { BDC, BUSES, NAMES, SEAT, hex, hexBytes, nameOf, readRequest, parseStatus, describe };
