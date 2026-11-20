'use strict';
/**
 * What the apps ask the engine unit (DME) and how its answers read.
 *
 * DIDS: BMW ReadDataByIdentifier (22) values of the G-series DME8FF_R
 * (B58 / B48 / B38) with their scaling, from cauliflowermossgrape/idrive7-apps
 * (MIT, apps/live_data/builtin/DME8FF_R.json, made from the public EdiabasX
 * SGBD reference). The G87 M2's S58 DME is a DME8FF_R too (SGBD index
 * 0F26E8) and answers all of them (docs/g87-s58.md). value = raw * k + o,
 * big-endian; a raw value equal to bad is no value.
 *
 * OBD: SAE J1979 service 01 PIDs with their standard formulas.
 *
 * DME_INDEX: SGBD index (22 F1 50) -> unit type for diagnostic address 0x12,
 * from the same project's sgbd_index.json.
 */

const DIDS = [
    { id: 0x4807, name: 'Drehzahl', t: 's16', k: 0.5, o: 0, u: 'U/min', d: 0 },
    { id: 0x5891, name: 'Drehmoment Kupplung', t: 's16', k: 0.5, o: 0, u: 'Nm', d: 0 },
    { id: 0x582F, name: 'Abgas nach Kat', t: 's16', k: 0.1, o: -273.14, u: '°C', d: 0 },
    { id: 0x5896, name: 'Abgas hinter Hauptkat', t: 's16', k: 0.1, o: -273.14, u: '°C', d: 0 },
    { id: 0x4402, name: 'Öl nach Filter', t: 'u16', k: 0.75, o: -48, u: '°C', d: 0 },
    { id: 0x5822, name: 'Öltemperatur', t: 'u8', k: 1, o: -60, u: '°C', d: 0 },
    { id: 0x4425, name: 'Öl im Sumpf', t: 's16', k: 0.1, o: 0, u: '°C', d: 0 },
    { id: 0x580F, name: 'Ansaugluft', t: 'u8', k: 0.75, o: -48, u: '°C', d: 0 },
    { id: 0x59D4, name: 'Ladeluft vor DK', t: 'u16', k: 0.0234375, o: -273.15, u: '°C', d: 0 },
    { id: 0x4300, name: 'Kühlmittel', t: 's16', k: 0.1, o: -273.14, u: '°C', d: 0 },
    { id: 0x4205, name: 'Ladedruck abs.', t: 'u16', k: 0.078125 / 1000, o: 0, u: 'bar', d: 2 },
    { id: 0x57C1, name: 'Ladedruck abs. (2)', t: 'u16', k: 0.078125 / 1000, o: 0, u: 'bar', d: 2 },
    { id: 0x4AB0, name: 'Ladedruck Soll', t: 'u16', k: 0.0390625 / 1000, o: 0, u: 'bar', d: 2 },
    { id: 0x4201, name: 'Umgebungsdruck', t: 'u16', k: 0.0390625, o: 0, u: 'hPa', d: 0 },
    { id: 0x4A2D, name: 'Saugrohrdruck', t: 'u16', k: 0.078125 / 1000, o: 0, u: 'bar', d: 2 },
    { id: 0x4436, name: 'Öldruck abs.', t: 'u16', k: 0.001, o: 0, u: 'bar', d: 2 },
    { id: 0x586F, name: 'Öldruck', t: 's16', k: 0.001, o: 0, u: 'bar', d: 2 },
    { id: 0x5811, name: 'Ölstand über Min.', t: 'u8', k: 0.01, o: 0, u: 'l', d: 2, bad: 0xFF },
    // what the engine does, for the recordings (read over ENET on the G87, docs/g87-s58.md)
    { id: 0x5889, name: 'Lambda', t: 'u16', k: 0.000244140625, o: 0, u: '', d: 3, bad: 0xFFFF },
    { id: 0x5816, name: 'Lambda Soll', t: 'u16', k: 0.000244140625, o: 0, u: '', d: 3, bad: 0xFFFF },
    { id: 0x5658, name: 'Raildruck', t: 'u16', k: 0.02, o: 0, u: 'bar', d: 0 },
    { id: 0x56C1, name: 'Raildruck Soll', t: 'u16', k: 0.02, o: 0, u: 'bar', d: 0 },
    { id: 0x58F3, name: 'Kraftstoff-Niederdruck abs.', t: 'u16', k: 0.001, o: 0, u: 'bar', d: 2 },
    { id: 0x554C, name: 'Klopfregelung Spätverstellung', t: 's8', k: 0.375, o: 0, u: '°KW', d: 1 },
    { id: 0x59FA, name: 'Zündwinkel', t: 's8', k: 0.75, o: 0, u: '°KW', d: 1 },
    { id: 0x480B, name: 'Fahrpedal', t: 's16', k: 0.01220703, o: 0, u: '%', d: 0 },
    { id: 0x5813, name: 'Last', t: 'u8', k: 0.75, o: 0, u: '%', d: 0 },
    { id: 0x4ABC, name: 'Luftmasse', t: 'u16', k: 0.1, o: 0, u: 'kg/h', d: 0 },
    { id: 0x4600, name: 'Drosselklappe', t: 's16', k: 0.0078125, o: 0, u: '%', d: 0 },
    { id: 0x4521, name: 'Kraftstoffmasse', t: 'u16', k: 0.1, o: 0, u: 'kg/h', d: 1 },
    { id: 0x4AD5, name: 'Kraftstofftemperatur', t: 'u8', k: 0.75, o: -48, u: '°C', d: 0 },
    // the battery's charge as the energy management reckons it (read over ENET on the G87: 65 %; the battery
    // sensor's own values 5852-5854 and 56F0 the DME refuses there)
    { id: 0x5425, name: 'Batterie Ladezustand', t: 's8', k: 1, o: 0, u: '%', d: 0 },
    // the cooling: what the DME aims for and drives (to see what MHD's Max Cooling changes); the pumps' speeds as
    // the DME gives them (one byte, its own steps)
    { id: 0x4310, name: 'Kühlmittel Soll', t: 's16', k: 0.01, o: 0, u: '°C', d: 0 },
    { id: 0x587F, name: 'Lüfter Ansteuerung', t: 's16', k: 0.01220703, o: 0, u: '%', d: 0 },
    { id: 0x594F, name: 'Lüfter Drehzahl', t: 'u8', k: 20, o: 0, u: 'U/min', d: 0 },
    { id: 0x4A74, name: 'Kennfeldthermostat', t: 's16', k: 0.1, o: 0, u: '%', d: 0 },
    { id: 0x5910, name: 'Wasserpumpe Soll', t: 'u8', k: 1, o: 0, u: '', d: 0 },
    { id: 0x58EA, name: 'Wasserpumpe Ist', t: 'u8', k: 1, o: 0, u: '', d: 0 },
    { id: 0x5912, name: 'Pumpe Ladeluftkühlung Soll', t: 'u8', k: 1, o: 0, u: '', d: 0 },
    { id: 0x5594, name: 'Lüfter Sollwert', t: 's16', k: 0.01, o: 0, u: '%', d: 0 },
    // the ignition angle of each cylinder (the knock control takes it back per cylinder; the DME reports only the
    // mean of that, 0x554C): cylinders 1-6, 0x4A4B is not one of them
    { id: 0x4A49, name: 'Zündwinkel Zyl. 1', t: 's16', k: 0.1, o: 0, u: '°KW', d: 1 },
    { id: 0x4A4A, name: 'Zündwinkel Zyl. 2', t: 's16', k: 0.1, o: 0, u: '°KW', d: 1 },
    { id: 0x4A4C, name: 'Zündwinkel Zyl. 3', t: 's16', k: 0.1, o: 0, u: '°KW', d: 1 },
    { id: 0x4A4D, name: 'Zündwinkel Zyl. 4', t: 's16', k: 0.1, o: 0, u: '°KW', d: 1 },
    { id: 0x4A4E, name: 'Zündwinkel Zyl. 5', t: 's16', k: 0.1, o: 0, u: '°KW', d: 1 },
    { id: 0x4A4F, name: 'Zündwinkel Zyl. 6', t: 's16', k: 0.1, o: 0, u: '°KW', d: 1 }
];

/* The gearbox unit's (EGS, 0x18; ZF 8HP, SGBD GSZFBCE on the G87): transmission oil, as
 * cauliflowermossgrape/idrive7-apps (MIT) apps/zf8hp/catalog.js reads it. */
const EGS_DIDS = [
    { id: 0x6000, name: 'Getriebeöl', t: 'u8', k: 1, o: -40, u: '°C', d: 0 }
];

const OBD = [
    { pid: 0x05, name: 'Kühlmittel', n: 1, f: (b) => b[0] - 40, u: '°C', d: 0 },
    { pid: 0x0F, name: 'Ansaugluft', n: 1, f: (b) => b[0] - 40, u: '°C', d: 0 },
    { pid: 0x5C, name: 'Öltemperatur', n: 1, f: (b) => b[0] - 40, u: '°C', d: 0 },
    { pid: 0x0B, name: 'Saugrohrdruck', n: 1, f: (b) => b[0] / 100, u: 'bar', d: 2 },
    { pid: 0x33, name: 'Barometer', n: 1, f: (b) => b[0] * 10, u: 'hPa', d: 0 },
    { pid: 0x46, name: 'Außentemperatur', n: 1, f: (b) => b[0] - 40, u: '°C', d: 0 },
    { pid: 0x42, name: 'Bordspannung', n: 2, f: (b) => ((b[0] << 8) | b[1]) / 1000, u: 'V', d: 2 },
    { pid: 0x0C, name: 'Drehzahl', n: 2, f: (b) => ((b[0] << 8) | b[1]) / 4, u: 'U/min', d: 0 },
    { pid: 0x04, name: 'Last', n: 1, f: (b) => b[0] * 100 / 255, u: '%', d: 0 },
    { pid: 0x11, name: 'Drosselklappe', n: 1, f: (b) => b[0] * 100 / 255, u: '%', d: 0 },
    { pid: 0x2F, name: 'Tankfüllung', n: 1, f: (b) => b[0] * 100 / 255, u: '%', d: 0 },
    { pid: 0x3C, name: 'Kat-Temperatur 1', n: 2, f: (b) => ((b[0] << 8) | b[1]) / 10 - 40, u: '°C', d: 0 },
    { pid: 0x3D, name: 'Kat-Temperatur 2', n: 2, f: (b) => ((b[0] << 8) | b[1]) / 10 - 40, u: '°C', d: 0 }
];

const DME_INDEX = {"0F1090":"MSD85L6","0F10A0":"D73N57A0","0F1370":"MSD87","0F1380":"MSD87_R0","0F13E0":"MSV90","0F13F0":"MEVD172","0F1740":"D72N47A0","0F1780":"MSD85YL6","0F17B0":"D73N57E0","0F17B4":"D73N57E0","0F17B8":"D73N57E0","0F17BC":"D73N57E0","0F17F0":"MEVD1725","0F1810":"MEVD1724","0F18A0":"D72N47A0","0F1910":"MEVD172Y","0F1920":"D72N47A0","0F19E0":"EDMEI1","0F1A10":"S63TU_R0","0F1A20":"N63TU_R0","0F1D20":"DME_BX8","0F1D22":"DME_BX8","0F1D24":"DME_BX8","0F1D26":"DME_BX8","0F1EA0":"S55","0F1EF0":"D73N57E0","0F1F70":"D75BX7A0","0F1F80":"D75BX7A0","0F1F90":"D70BX7A0","0F1FA0":"D70BX7A0","0F1FE8":"D83BX7C0","0F1FF0":"D83BX7C0","0F1FF4":"D83BX7C0","0F1FF8":"D83BX7C0","0F2220":"N55_ALP","0F2422":"DME8FF_R","0F2424":"DME8FF_R","0F2426":"DME8FF_R","0F2427":"DME8FF_R","0F2428":"DME8FF_R","0F2429":"DME8FF_R","0F242A":"DME8FF_R","0F242C":"DME8FF_R","0F242E":"DME8FF_R","0F2460":"DME8FF_R","0F25A0":"DME8FF_R","0F25A2":"DME8FF_R","0F2670":"D83BX7C0","0F2674":"D83BX7C0","0F2678":"D83BX7C0","0F267C":"D83BX7C0","0F26B4":"DME8FF_R","0F26B8":"DME8FF_R","0F26BC":"DME8FF_R","0F26E0":"DME8FF_R","0F26E4":"DME8FF_R","0F26E8":"DME8FF_R","0F28E0":"DME9FF_R","0F2930":"DME8FF_R","0F2C80":"D94BX7A0","0F2E00":"DME98_R"};

/* UDS negative response codes, as the screen names them. */
const NRC = {
    0x10: 'abgelehnt', 0x11: 'Dienst nicht unterstützt', 0x12: 'nicht unterstützt', 0x13: 'falsche Länge',
    0x21: 'beschäftigt', 0x22: 'Bedingungen nicht erfüllt', 0x31: 'gibt es nicht', 0x33: 'gesperrt',
    0x7E: 'nicht in dieser Sitzung', 0x7F: 'nicht in dieser Sitzung'
};

const hex = (n, w) => n.toString(16).toUpperCase().padStart(w || 2, '0');
const hexBytes = (b) => b.map((x) => hex(x)).join(' ');

function num(b, t) {
    if (t === 'u8' || t === 's8') {
        return b.length >= 1 ? (t === 's8' && b[0] & 0x80 ? b[0] - 0x100 : b[0]) : null;
    }
    if (b.length < 2) {
        return null;
    }
    const v = (b[0] << 8) | b[1];
    return t === 's16' && v & 0x8000 ? v - 0x10000 : v;
}

const show = (v, u, d) => `${v.toFixed(d)} ${u}`;

/* The value of a positive 22 reply for did (in its unit), or null. */
function didNumber(did, uds) {
    if (!uds || uds[0] !== 0x62 || uds[1] !== (did.id >> 8) || uds[2] !== (did.id & 0xFF)) {
        return null;
    }
    const raw = num(uds.slice(3), did.t);
    return raw === null || raw === did.bad ? null : raw * did.k + did.o;
}

/* The value of a positive 01 reply for pid, or null. */
function obdNumber(pid, uds) {
    if (!uds || uds[0] !== 0x41 || uds[1] !== pid.pid || uds.length < 2 + pid.n) {
        return null;
    }
    return pid.f(uds.slice(2));
}

const didById = (id) => DIDS.concat(EGS_DIDS).find((d) => d.id === id);
const pidById = (id) => OBD.find((p) => p.pid === id);
const SIZE = { u8: 1, s8: 1, u16: 2, s16: 2 };

/* A reply to one 22 request for several identifiers (62 id1 data1 id2 data2 ...): { id: value or null },
 * or null when it is not a positive reply. The reply names each identifier before its data, which is as
 * long as its type; one the DME left out is simply missing; an identifier not asked for ends the walk. */
function didNumbers(dids, uds) {
    if (!uds || uds[0] !== 0x62) {
        return null;
    }
    const out = {};
    let i = 1;
    while (i + 2 <= uds.length) {
        const id = (uds[i] << 8) | uds[i + 1];
        const did = dids.find((d) => d.id === id);
        if (!did) {
            break;
        }
        const n = SIZE[did.t];
        out[id] = didNumber(did, [0x62].concat(uds.slice(i, i + 2 + n)));
        i += 2 + n;
    }
    return Object.keys(out).length ? out : null;
}

/* A 22 reply for did: "<value>", "nein: <nrc>", or null when it is not ours. */
function didValue(did, uds) {
    if (uds[0] === 0x7F && uds[1] === 0x22) {
        return `nein: ${NRC[uds[2]] || hex(uds[2])}`;
    }
    if (uds[0] !== 0x62 || uds[1] !== (did.id >> 8) || uds[2] !== (did.id & 0xFF)) {
        return null;
    }
    const raw = num(uds.slice(3), did.t);
    if (raw !== null && raw === did.bad) {
        return 'ungültig';
    }
    return raw === null ? `kurz: ${hexBytes(uds)}` : show(raw * did.k + did.o, did.u, did.d);
}

/* A 01 reply for pid: the value, "nein: <nrc>", or null when it is not ours. */
function obdValue(pid, uds) {
    if (uds[0] === 0x7F && uds[1] === 0x01) {
        return `nein: ${NRC[uds[2]] || hex(uds[2])}`;
    }
    if (uds[0] !== 0x41 || uds[1] !== pid.pid) {
        return null;
    }
    const b = uds.slice(2);
    return b.length < pid.n ? `kurz: ${hexBytes(uds)}` : show(pid.f(b), pid.u, pid.d);
}

/* The PIDs a 01 00/20/40/60 reply says are supported: [pid]. */
function supported(base, uds) {
    if (uds[0] !== 0x41 || uds[1] !== base || uds.length < 6) {
        return null;
    }
    const out = [];
    for (let i = 0; i < 32; i++) {
        if (uds[2 + (i >> 3)] & (0x80 >> (i & 7))) {
            out.push(base + i + 1);
        }
    }
    return out;
}

/* The SGBD index in a 62 F1 50 reply and the unit type it names. */
function dmeType(uds) {
    if (uds[0] !== 0x62 || uds[1] !== 0xF1 || uds[2] !== 0x50 || uds.length < 6) {
        return null;
    }
    const index = hex(((uds[3] << 16) | (uds[4] << 8) | uds[5]) >>> 0, 6);
    return { index, type: DME_INDEX[index] || null };
}

module.exports = { DIDS, EGS_DIDS, OBD, DME_INDEX, NRC, hex, hexBytes, didValue, obdValue, didNumber, didNumbers, obdNumber, didById, pidById,
    supported, dmeType };
