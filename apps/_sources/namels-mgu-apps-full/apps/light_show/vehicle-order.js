'use strict';
// Vehicle order (FA, "Fahrzeugauftrag") from the gateway, 22 3F 06. Layout as documented in
// BimmerLight's plain-text engine contract: 6-bit characters (value + 0x20), a 24-character
// header, 4 bits of padding, then the option codes (SA) with 3 characters each.
// The header is shown in blocks of four; their meaning is not verified on a car.

const HEADLAMP_HINTS = Object.freeze({
    '5AZ': 'BMW Laserlight',
    '552': 'Adaptive LED headlights',
    '5AC': 'High-beam assistant',
});

function chars(bytes) {
    const out = [];
    let acc = 0, bits = 0;
    for (const b of bytes) {
        acc = ((acc << 8) | b) & 0xFFFFFF; bits += 8;
        while (bits >= 6) { bits -= 6; out.push(((acc >> bits) & 0x3F) + 0x20); }
    }
    return out;
}

/** reply: full UDS answer (62 3F 06 ...). -> {header, blocks[], codes[], hints[]} or throws */
function decode(reply) {
    if (!Array.isArray(reply) || reply[0] !== 0x62 || reply[1] !== 0x3F || reply[2] !== 0x06 || reply.length < 22)
        throw new Error('No vehicle order in the reply');
    const data = reply.slice(3);
    const head = chars(data).slice(0, 24).map((c) => String.fromCharCode(c)).join('');
    // after 24 chars (144 bits) and 4 padding bits = bit 148
    const bitsAll = [];
    data.forEach((b) => { for (let i = 7; i >= 0; i--) bitsAll.push((b >> i) & 1); });
    const codes = [];
    for (let p = 148; p + 18 <= bitsAll.length; p += 18) {
        let s = '';
        for (let k = 0; k < 3; k++) {
            let v = 0;
            for (let i = 0; i < 6; i++) v = (v << 1) | bitsAll[p + k * 6 + i];
            s += String.fromCharCode(v + 0x20);
        }
        if (!/^[0-9A-Z]{3}$/.test(s)) break;
        codes.push(s);
    }
    const blocks = [];
    for (let i = 0; i < 24; i += 4) blocks.push(head.slice(i, i + 4).trim());
    const hints = codes.filter((c) => HEADLAMP_HINTS[c]).map((c) => c + ' ' + HEADLAMP_HINTS[c]);
    return { header: head, blocks, codes, hints };
}

/** Inverse for tests. */
function encode(header, codes) {
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
    header.padEnd(24, ' ').slice(0, 24).split('').forEach((c) => put(c.charCodeAt(0) - 0x20, 6));
    put(0, 4);
    codes.forEach((code) => code.split('').forEach((c) => put(c.charCodeAt(0) - 0x20, 6)));
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    return [0x62, 0x3F, 0x06].concat(out);
}

module.exports = { decode, encode, HEADLAMP_HINTS };
