'use strict';
/**
 * The fault memory as the screen shows it: the units' replies to 19 02
 * <mask> (ReadDTCInformation by status mask, ISO 14229) turned into entries
 * { ecu, unit, code, status, state }, and German names for the units.
 *
 * Unit names by diagnostic address, for the units a G-series car has (the
 * G87's 28 answer, docs/g87-s58.md); their types from the SGBD index of
 * cauliflowermossgrape/idrive7-apps (MIT). Others show as "Steuergerät 0x..".
 */

const UNITS = {
    0x01: 'Airbag', 0x06: 'Kameras', 0x08: 'Radar hinten rechts', 0x0F: 'Differenzial', 0x10: 'Gateway',
    0x12: 'Motor (DME)', 0x13: 'Motor 2', 0x18: 'Getriebe (EGS)', 0x20: 'Radar vorn rechts', 0x21: 'Frontradar',
    0x28: 'Radar vorn links', 0x29: 'Stabilität (DSC)', 0x2A: 'Radar hinten links', 0x2C: 'Parksensoren',
    0x30: 'Lenkung (EPS)', 0x37: 'Audio-Verstärker', 0x38: 'Allrad', 0x39: 'Bremskraftverstärker',
    0x40: 'Karosserie (BDC)', 0x43: 'Scheinwerfer links', 0x44: 'Scheinwerfer rechts', 0x56: 'Dachfunktionen',
    0x5D: 'Fahrerassistenz-Kamera', 0x5E: 'Wählhebel', 0x60: 'Kombiinstrument', 0x61: 'Telematik',
    0x63: 'Headunit', 0x64: 'Parkassistent', 0x67: 'iDrive-Controller', 0x6D: 'Sitz Fahrer',
    0x6E: 'Sitz Beifahrer', 0x76: 'Dämpfer', 0x78: 'Klimaanlage'
};

/* The units a G87 answers the fault memory with (ENET, docs/g87-s58.md), asked one by one. */
const KNOWN = [0x01, 0x06, 0x08, 0x0F, 0x10, 0x12, 0x18, 0x21, 0x29, 0x2A, 0x2C, 0x30, 0x37, 0x39, 0x40, 0x43, 0x44,
    0x56, 0x5D, 0x5E, 0x60, 0x61, 0x63, 0x67, 0x6D, 0x6E, 0x76, 0x78];

const hex = (n, w) => n.toString(16).toUpperCase().padStart(w || 2, '0');

function unitName(addr) {
    return UNITS[addr] || `Steuergerät 0x${hex(addr)}`;
}

/* The status byte in words: active (failing now), stored (confirmed), pending (this or the last cycle). */
function stateOf(status) {
    if (status & 0x01) {
        return 'aktiv';
    }
    if (status & 0x08) {
        return 'gespeichert';
    }
    if (status & 0x04) {
        return 'vorläufig';
    }
    return 'Historie';
}

/**
 * Map(address -> reply) to { units: how many answered, entries: [...] }, the active entries first,
 * then by unit. A refusal (7F) counts as an answer without entries.
 */
function parse(replies) {
    const entries = [];
    replies.forEach((u, ecu) => {
        if (!u || u[0] !== 0x59 || u[1] !== 0x02) {
            return;
        }
        for (let i = 3; i + 4 <= u.length; i += 4) {
            const code = ((u[i] << 16) | (u[i + 1] << 8) | u[i + 2]) >>> 0;
            const status = u[i + 3];
            entries.push({ ecu, unit: unitName(ecu), code: hex(code, 6), status, state: stateOf(status) });
        }
    });
    entries.sort((a, b) => ((b.status & 1) - (a.status & 1)) || (a.ecu - b.ecu) || a.code.localeCompare(b.code));
    return { units: replies.size, entries };
}

/* The units asked: the G87's own (the others named above don't answer in it). */
function addresses() {
    return KNOWN.slice();
}

module.exports = { parse, unitName, stateOf, addresses, UNITS };
