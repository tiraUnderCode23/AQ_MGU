// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/* SteamStub taken off (src/steamstub.js), on programs made here: a small
 * PE (x86 and x64), then wrapped the SteamStub way by the packer below
 * (variants 3.1 and 3.0, encrypted or not, the code section's file size
 * shrunk or not), then unwrapped: the result must be the program before
 * wrapping, byte for byte. Also: a program without .bind, a .bind of a kind
 * we don't know, a .bind that can't go, truncated and garbled files, and
 * the in-place switch with an update putting the wrapped program back.
 * Node 8 (the unit's).   node test/steamstub_test.js */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stub = require('../src/steamstub.js');

const FA = 0x200, SA = 0x1000;
const al = (v, a) => Math.ceil(v / a) * a;

/* ---- a PE: sections [{ name, data, vs }], the entry point, x64 or not ----- */
function buildPe(o) {
    const n = o.sections.length, optSize = o.x64 ? 0xf0 : 0xe0;
    const headers = al(0x80 + 24 + optSize + 40 * n, FA);
    let va = SA, ptr = headers;
    const placed = o.sections.map((s) => {
        const raw = s.raw !== undefined ? s.raw : al(s.data.length, FA);
        const x = { s: s, va: va, ptr: raw ? ptr : 0, raw: raw, vs: s.vs || s.data.length };
        va += al(Math.max(x.vs, raw), SA);
        ptr += raw;
        return x;
    });
    const overlay = o.overlay || Buffer.alloc(0);
    const b = Buffer.alloc(ptr + overlay.length);
    b.writeUInt16LE(0x5a4d, 0);
    b.writeUInt32LE(0x80, 0x3c);
    b.writeUInt32LE(0x00004550, 0x80);
    b.writeUInt16LE(o.x64 ? 0x8664 : 0x14c, 0x84);
    b.writeUInt16LE(n, 0x86);
    b.writeUInt16LE(optSize, 0x94);
    b.writeUInt16LE(o.x64 ? 0x22 : 0x102, 0x96);
    const opt = 0x98;
    b.writeUInt16LE(o.x64 ? 0x20b : 0x10b, opt);
    b.writeUInt32LE(o.ep(placed), opt + 16);
    if (o.x64) { b.writeUInt32LE(0x40000000, opt + 24); b.writeUInt32LE(1, opt + 28); } else b.writeUInt32LE(0x400000, opt + 28);
    b.writeUInt32LE(SA, opt + 32);
    b.writeUInt32LE(FA, opt + 36);
    b.writeUInt16LE(6, opt + 40);
    b.writeUInt16LE(6, opt + 48);
    b.writeUInt32LE(va, opt + 56);
    b.writeUInt32LE(headers, opt + 60);
    b.writeUInt16LE(3, opt + 68);
    b.writeUInt32LE(16, opt + (o.x64 ? 108 : 92));
    const dirs = opt + (o.x64 ? 112 : 96);
    (o.dirs || []).forEach((d) => { b.writeUInt32LE(d.rva(placed), dirs + d.i * 8); b.writeUInt32LE(d.size, dirs + d.i * 8 + 4); });
    placed.forEach((x, i) => {
        const at = opt + optSize + i * 40;
        b.write(x.s.name, at, 'latin1');
        b.writeUInt32LE(x.vs, at + 8);
        b.writeUInt32LE(x.va, at + 12);
        b.writeUInt32LE(x.raw, at + 16);
        b.writeUInt32LE(x.ptr, at + 20);
        b.writeUInt32LE(x.s.chars || 0x60000020, at + 36);
        x.s.data.copy(b, x.ptr, 0, Math.min(x.s.data.length, x.raw));
    });
    overlay.copy(b, ptr);
    if (o.checksum) b.writeUInt32LE(stub.peChecksum(b, opt + 64), opt + 64);
    return { buffer: b, placed: placed };
}

/* ---- the packer: SteamStub's way, our own ----------------------------------- */
const LAYOUT = {
    '3.1': { size: 0xf0, w: 8, imageBase: 0x08, oep: 0x20, appId: 0x38, flags: 0x3c, bindVs: 0x40, codeVa: 0x48, codeRaw: 0x50, key: 0x58, iv: 0x78, stolen: 0x88 },
    '3.0x86': { size: 0xb0, w: 4, imageBase: 0x08, oep: 0x18, appId: 0x2c, flags: 0x30, bindVs: 0x34, codeVa: 0x3c, codeRaw: 0x40, key: 0x44, iv: 0x64, stolen: 0x74 },
    '3.0x64': { size: 0xd0, w: 8, imageBase: 0x08, oep: 0x20, appId: 0x38, flags: 0x3c, bindVs: 0x40, codeVa: 0x48, codeRaw: 0x50, key: 0x58, iv: 0x78, stolen: 0x88 },
};
function wr(h, at, w, v) { h.writeUInt32LE(v % 0x100000000, at); if (w === 8) h.writeUInt32LE(Math.floor(v / 0x100000000), at + 4); }
function xorEncode(plain) {
    const enc = Buffer.from(plain);
    for (let i = 4; i + 4 <= plain.length; i += 4) enc.writeUInt32LE((plain.readUInt32LE(i) ^ enc.readUInt32LE(i - 4)) >>> 0, i);
    return enc;
}
function cipher(mode, key, iv, data) { const c = crypto.createCipheriv(mode, key, iv); c.setAutoPadding(false); return Buffer.concat([c.update(data), c.final()]); }

/* the program before (orig) and after wrapping (packed) */
function make(o) {
    const text = crypto.randomBytes(o.codeLen), data = crypto.randomBytes(0x300);
    const base = o.x64 ? 0x140000000 : 0x400000;
    const oepOff = 0x10;
    const sections = (t, extra) => [{ name: '.text', data: t.data, vs: o.codeLen, raw: t.raw }, { name: '.data', data: data, chars: 0xc0000040 }].concat(extra || []);
    const orig = buildPe({ x64: o.x64, sections: sections({ data: text }), ep: (p) => p[0].va + oepOff, overlay: o.overlay, checksum: o.checksum, dirs: o.origDirs });
    const L = LAYOUT[o.layout], key = crypto.randomBytes(32), realIv = crypto.randomBytes(16);
    const enc = !(o.flags & stub.NO_ENCRYPTION);
    const ct = enc ? cipher('aes-256-cbc', key, realIv, text) : text;
    const textOut = enc ? { data: ct.slice(16), raw: o.shrink ? al(ct.length - 16, FA) : undefined } : { data: text };
    const h = Buffer.alloc(L.size);
    h.writeUInt32LE(crypto.randomBytes(4).readUInt32LE(0), 0);
    h.writeUInt32LE(stub.SIG, 4);
    wr(h, L.imageBase, L.w, base);
    const textVa = SA;
    wr(h, L.oep, L.w, o.oepAsVa ? base + textVa + oepOff : textVa + oepOff);
    h.writeUInt32LE(o.appId || 204360, L.appId);
    h.writeUInt32LE(o.flags || 0, L.flags);
    h.writeUInt32LE(0x2000, L.bindVs);
    wr(h, L.codeVa, L.w, textVa);
    wr(h, L.codeRaw, L.w, enc ? text.length - 16 : 0);
    key.copy(h, L.key);
    cipher('aes-256-ecb', key, Buffer.alloc(0), realIv).copy(h, L.iv);
    if (enc) ct.copy(h, L.stolen, 0, 16);
    const bindData = Buffer.concat([Buffer.alloc(0x40, 0xcc), xorEncode(h), Buffer.alloc(0x80, 0x90)]);
    const packed = buildPe({ x64: o.x64, sections: sections(textOut, [{ name: '.bind', data: bindData, chars: 0xe0000060 }]),
        ep: (p) => p[2].va + 0x40 + L.size, overlay: o.overlay, checksum: o.checksum, dirs: o.packedDirs });
    return { orig: orig.buffer, packed: packed.buffer, text: text };
}

/* ---- the packer for variants 1, 2.0 and 2.1 (all 32-bit), our own ---------- */
const PRO = Buffer.from([0x53, 0x51, 0x52, 0x56, 0x57, 0x55, 0x8b, 0xec, 0x81, 0xec, 0x00, 0x10, 0x00, 0x00]);
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; }
function movReg(reg, imm) { return Buffer.concat([Buffer.from([0xb8 + reg]), u32(imm)]); }      /* mov r32, imm32 */
function movMem(imm) { return Buffer.concat([Buffer.from([0xc7, 0x05, 0, 0, 0, 0]), u32(imm)]); } /* mov [disp32], imm32 */
/* the rolling XOR seeded with 0 (variant 2.0 header), its inverse of xorDecode */
function xorEncodeK(plain, key) { const e = Buffer.from(plain); for (let i = 0; i + 4 <= plain.length; i += 4) { const c = (plain.readUInt32LE(i) ^ key) >>> 0; e.writeUInt32LE(c, i); key = c; } return { out: e, key: key >>> 0 }; }

const XD = 0x9e3779b9;
function xteaEncBlock(v0, v1, key) {
    let sum = 0;
    for (let r = 0; r < 32; r++) {
        v0 = (v0 + (((((v1 << 4) ^ (v1 >>> 5)) >>> 0) + v1) >>> 0 ^ (sum + key[sum & 3])) >>> 0) >>> 0;
        sum = (sum + XD) >>> 0;
        v1 = (v1 + (((((v0 << 4) ^ (v0 >>> 5)) >>> 0) + v0) >>> 0 ^ (sum + key[(sum >>> 11) & 3])) >>> 0) >>> 0;
    }
    return [v0 >>> 0, v1 >>> 0];
}
function xteaEnc(buf, key) {
    const n = buf.length - (buf.length % 8), out = Buffer.alloc(n);
    let v1 = 0x55555555, v2 = 0x55555555;
    for (let o = 0; o + 8 <= n; o += 8) {
        const c = xteaEncBlock((buf.readUInt32LE(o) ^ v1) >>> 0, (buf.readUInt32LE(o + 4) ^ v2) >>> 0, key);
        out.writeUInt32LE(c[0], o); out.writeUInt32LE(c[1], o + 4);
        v1 = c[0]; v2 = c[1];
    }
    return out;
}

/* the sections (.text, .data, .bind) and the two programs */
function wrap2(o, buildBind) {
    const text = crypto.randomBytes(o.codeLen), data = crypto.randomBytes(0x300), base = 0x400000, oepOff = 0x10, textVa = SA;
    const t = buildBind.text ? buildBind.text(text) : { data: text, raw: al(text.length, FA) };
    const textRaw = t.raw;
    const bindVa = SA + al(Math.max(o.codeLen, textRaw), SA) + al(Math.max(0x300, 0x400), SA);
    const bindData = buildBind.bind({ base: base, textVa: textVa, oepOff: oepOff, bindVa: bindVa, text: text });
    const sections = (textPart, bind) => [{ name: '.text', data: textPart.data, vs: o.codeLen, raw: textPart.raw },
        { name: '.data', data: data, chars: 0xc0000040 }].concat(bind ? [{ name: '.bind', data: bindData, chars: 0xe0000060 }] : []);
    const orig = buildPe({ x64: false, sections: sections({ data: text, raw: al(text.length, FA) }), ep: () => textVa + oepOff, checksum: o.checksum });
    const packed = buildPe({ x64: false, sections: sections(t, true), ep: () => bindVa + buildBind.epAt, checksum: o.checksum });
    return { orig: orig.buffer, packed: packed.buffer, text: text };
}

/* variant 1: no code change; the header (byte x ^= x*x) and a trampoline in .bind */
function makeV1(o) {
    return wrap2(o, { epAt: 0, bind: (c) => {
        const ep = Buffer.concat([Buffer.from([0x60, 0x81, 0xec, 0x00, 0x10, 0x00, 0x00]), movReg(6, c.base + c.bindVa + 0x100), movReg(1, 0x6a)]);
        const tramp = Buffer.from([0x61, 0xb8].concat([0, 0, 0, 0], [0xff, 0xe0]));
        u32(c.base + c.textVa + c.oepOff).copy(tramp, 2);
        const h = Buffer.alloc(0x6a * 4);
        h.writeUInt32LE(c.base + c.bindVa, 8);                       /* BindFunction: base + the entry point */
        h.writeUInt32LE(o.appId || 204360, 0x14);
        const b = Buffer.alloc(al(0x100 + h.length, FA), 0x90);
        ep.copy(b, 0); tramp.copy(b, 0x40); stub.squareXor(h).copy(b, 0x100);
        return b;
    } });
}

/* variant 2.0: the code section rolling-XOR'd when the flags say so (0x4) */
function makeV20(o) {
    const enc = !!(o.flags & stub.NO_ENCRYPTION), codeXor = 0x9abcdef0 >>> 0, count = o.count || 221, size = count * 4;
    const L = { 214: { flags: 0x14, oep: 0x28, codeVa: 0x2c, codeSize: 0x30, codeXor: 0x34, appId: 0x38 },
        221: { flags: 0x18, oep: 0x2c, codeVa: 0x30, codeSize: 0x34, codeXor: 0x38, appId: 0x3c },
        238: { flags: 0x18, oep: 0x2c, codeVa: 0x30, codeSize: 0x34, codeXor: 0x38, appId: 0x3c } }[count];
    return wrap2(o, { epAt: 4,
        text: (text) => enc ? { data: xorEncodeK(text, codeXor).out, raw: al(text.length, FA) } : { data: text, raw: al(text.length, FA) },
        bind: (c) => {
            const h = Buffer.alloc(size);
            h.writeUInt32LE(o.flags || 0, L.flags);
            h.writeUInt32LE(c.base + c.textVa + c.oepOff, L.oep);
            h.writeUInt32LE(o.appId || 204360, L.appId);
            if (enc) { h.writeUInt32LE(c.base + c.textVa, L.codeVa); h.writeUInt32LE(o.codeLen, L.codeSize); h.writeUInt32LE(codeXor, L.codeXor); }
            const ep = Buffer.concat([PRO, movReg(6, c.base + c.bindVa + 0x100), movReg(1, count)]);
            const b = Buffer.alloc(al(0x100 + size, FA), 0x90);
            b.writeUInt32LE(stub.MARK2, 0); ep.copy(b, 4); xorEncode(h).copy(b, 0x100);
            return b;
        } });
}

/* variant 2.1: an XOR'd payload, an XTEA'd SteamDRMP.dll, the code AES-256-CBC */
function makeV21(o) {
    const enc = !(o.flags & stub.NO_ENCRYPTION), key = crypto.randomBytes(32), realIv = crypto.randomBytes(16);
    const count = 0x40, xorKey = 0x1234abcd >>> 0;
    const xkey = [0x11111111, 0x22222222, 0x33333333, 0x44444444];
    return wrap2(o, { epAt: 4,
        text: (text) => { const ct = enc ? cipher('aes-256-cbc', key, realIv, text) : text;
            return enc ? { data: ct.slice(16), raw: o.shrink ? al(ct.length - 16, FA) : al(ct.length - 16, FA) } : { data: text, raw: al(text.length, FA) }; },
        bind: (c) => {
            const ct = enc ? cipher('aes-256-cbc', key, realIv, c.text) : c.text;
            const DLL = 0x800, PAY = 0x400, HDR = 0x100;
            /* the payload: the SteamDRMP pointers and the real parameters */
            const payload = Buffer.alloc(0x100, 0);
            const pDllVa = 0x40, pDllSize = 0x44, pXtea = 0xd0;
            const pFlags = 0x80, pOep = 0x84, pCode = 0x88, pEnc = 0x8c, pKey = 0x90, pIv = 0xb0; /* stolen at pIv + 16 */
            /* SteamDRMP.dll's parameter block: load/store pairs (mov reg,[eax+off];
             * mov [abs],reg), then lea for the key and add eax,imm for the IV */
            const dll = Buffer.alloc(0x80, 0x90);
            const pair = (at, mod, off) => { dll[at] = 0x8b; dll[at + 1] = mod; dll.writeUInt32LE(off >>> 0, at + 2); dll[at + 6] = 0x89; dll[at + 7] = 0x15; dll.writeUInt32LE(0x10040000, at + 8); };
            pair(0, 0x88, pFlags); pair(12, 0x90, 0); pair(24, 0x90, pOep); pair(36, 0x90, pCode); pair(48, 0x90, pEnc);
            dll[60] = 0x8d; dll[61] = 0x90; dll.writeUInt32LE(pKey >>> 0, 62);   /* lea edx, [eax+pKey] */
            dll[66] = 0x05; dll.writeUInt32LE(pIv >>> 0, 67);                    /* add eax, pIv */
            const dllCt = xteaEnc(dll, xkey);
            payload.writeUInt32LE(c.base + c.bindVa + DLL, pDllVa);
            payload.writeUInt32LE(dllCt.length, pDllSize);
            xkey.forEach((k, i) => payload.writeUInt32LE(k, pXtea + i * 4));
            payload.writeUInt32LE(o.flags || 0, pFlags);
            payload.writeUInt32LE(c.base + c.textVa + c.oepOff, pOep);
            payload.writeUInt32LE(c.base + c.textVa, pCode);
            payload.writeUInt32LE(enc ? c.text.length - 16 : 0, pEnc);
            key.copy(payload, pKey);
            cipher('aes-256-ecb', key, Buffer.alloc(0), realIv).copy(payload, pIv);
            if (enc) ct.copy(payload, pIv + 16, 0, 16);              /* the stolen bytes */
            /* the header: pointers to the payload, SteamDRMP and the XTEA key */
            const h = Buffer.alloc(count * 4);
            h.writeUInt32LE(xorKey, 0x00);
            h.writeUInt32LE(c.base + c.bindVa + PAY, 0x24); h.writeUInt32LE(payload.length, 0x28);
            h.writeUInt32LE(o.appId || 204360, 0x2c);
            h.writeUInt32LE(pDllVa, 0x3c); h.writeUInt32LE(pDllSize, 0x40); h.writeUInt32LE(pXtea, 0x44);
            const he = xorEncodeK(h, xorKey);
            const pe = xorEncodeK(payload, he.key);
            const ep = Buffer.concat([PRO, movMem(c.base + c.bindVa + HDR), movMem(xorKey), movReg(0, count)]);
            const b = Buffer.alloc(al(DLL + dllCt.length + 0x10, FA), 0x90);
            b.writeUInt32LE(stub.MARK2, 0); ep.copy(b, 4); he.out.copy(b, HDR); pe.out.copy(b, PAY); dllCt.copy(b, DLL);
            return b;
        } });
}

let fails = 0;
function check(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

/* ---- unwrapped back to the program, byte for byte ---------------------------- */
const cases = [
    ['3.1 x86, encrypted, the code section\'s file size shrunk (it grows back)', { layout: '3.1', x64: false, codeLen: 0x210, shrink: true }],
    ['3.1 x86, encrypted, in place, the entry point as a VA', { layout: '3.1', x64: false, codeLen: 0x400, oepAsVa: true }],
    ['3.1 x64, encrypted', { layout: '3.1', x64: true, codeLen: 0x610, shrink: true }],
    ['3.0 x86, encrypted, the entry point as a VA', { layout: '3.0x86', x64: false, codeLen: 0x400, oepAsVa: true }],
    ['3.0 x64 (3.1\'s fields), encrypted', { layout: '3.0x64', x64: true, codeLen: 0x400 }],
    ['3.1 x86, NoEncryption', { layout: '3.1', x64: false, codeLen: 0x400, flags: stub.NO_ENCRYPTION }],
    ['3.1 x86, an overlay after the sections and a checksum', { layout: '3.1', x64: false, codeLen: 0x210, shrink: true, overlay: crypto.randomBytes(777), checksum: true }],
];
cases.forEach(([name, o]) => check(name, () => {
    const m = make(o);
    const d = stub.detectBuffer(m.packed);
    assert.ok(d && d.supported, 'detected: ' + JSON.stringify(d));
    assert.strictEqual(d.variant, o.layout.slice(0, 3));
    assert.strictEqual(d.arch, o.x64 ? 'x64' : 'x86');
    assert.strictEqual(d.appId, 204360);
    assert.strictEqual(d.encrypted, !(o.flags & stub.NO_ENCRYPTION));
    const r = stub.unpackBuffer(m.packed);
    assert.ok(r.info.bindRemoved, '.bind removed');
    assert.ok(r.buffer.equals(m.orig), 'the unwrapped program differs from the one before wrapping (' + r.buffer.length + ' vs ' + m.orig.length + ' bytes)');
    assert.strictEqual(stub.detectBuffer(r.buffer), null);
}));

/* ---- variants 1, 2.0 and 2.1 (all 32-bit) unwrapped back, byte for byte ------ */
const v12 = [
    ['1 x86, no code change', makeV1, { codeLen: 0x400 }, { variant: '1', encrypted: false }],
    ['2.0 x86, the code rolling-XOR encoded (884-byte header)', makeV20, { codeLen: 0x400, flags: 0x04 }, { variant: '2.0', encrypted: true }],
    ['2.0 x86, the 856-byte header', makeV20, { codeLen: 0x400, count: 214, flags: 0x04 }, { variant: '2.0', encrypted: true }],
    ['2.0 x86, the 952-byte header', makeV20, { codeLen: 0x200, count: 238, flags: 0x04 }, { variant: '2.0', encrypted: true }],
    ['2.0 x86, UseEncodedCodeSection clear (code left alone)', makeV20, { codeLen: 0x400, flags: 0 }, { variant: '2.0', encrypted: false }],
    ['2.1 x86, XOR payload + XTEA SteamDRMP.dll + AES code', makeV21, { codeLen: 0x400 }, { variant: '2.1', encrypted: true }],
    ['2.1 x86, the code file size shrunk (it grows back)', makeV21, { codeLen: 0x210, shrink: true }, { variant: '2.1', encrypted: true }],
    ['2.1 x86, NoEncryption', makeV21, { codeLen: 0x400, flags: stub.NO_ENCRYPTION }, { variant: '2.1', encrypted: false }],
    ['2.1 x86, a checksum made right again', makeV21, { codeLen: 0x210, shrink: true, checksum: true }, { variant: '2.1', encrypted: true }],
];
v12.forEach(([name, mk, o, exp]) => check(name, () => {
    const m = mk(o);
    const d = stub.detectBuffer(m.packed);
    assert.ok(d && d.supported, 'detected: ' + JSON.stringify(d));
    assert.strictEqual(d.variant, exp.variant);
    assert.strictEqual(d.arch, 'x86');
    assert.strictEqual(d.appId, 204360);
    assert.strictEqual(d.encrypted, exp.encrypted);
    const r = stub.unpackBuffer(m.packed);
    assert.ok(r.info.bindRemoved, '.bind removed');
    assert.ok(r.buffer.equals(m.orig), 'the unwrapped program differs from the one before wrapping (' + r.buffer.length + ' vs ' + m.orig.length + ' bytes)');
    assert.strictEqual(stub.detectBuffer(r.buffer), null);
}));

/* a .bind that a directory points into stays: the code and entry point still come back */
check('a .bind a directory points into stays; code and entry point restored', () => {
    const o = { layout: '3.1', x64: false, codeLen: 0x400, packedDirs: [{ i: 9, rva: (p) => p[2].va, size: 0x18 }] };
    const m = make(o);
    const r = stub.unpackBuffer(m.packed);
    assert.strictEqual(r.info.bindRemoved, false);
    const opt = 0x98, ep = r.buffer.readUInt32LE(opt + 16);
    assert.strictEqual(ep, SA + 0x10);
    const textPtr = r.buffer.readUInt32LE(opt + 0xe0 + 20);
    assert.ok(r.buffer.slice(textPtr, textPtr + 0x400).equals(m.text), 'the code section');
    assert.strictEqual(r.buffer.readUInt16LE(0x86), 3);
    /* unwrapped again: nothing to find at the entry point now */
    assert.strictEqual(stub.detectBuffer(r.buffer).supported, false);
});

/* ---- the ones we leave alone ----------------------------------------------- */
check('a program without .bind: null', () => {
    const m = make({ layout: '3.1', x64: false, codeLen: 0x400 });
    assert.strictEqual(stub.detectBuffer(m.orig), null);
    assert.throws(() => stub.unpackBuffer(m.orig), (e) => e instanceof stub.StubError && /no \.bind/.test(e.message));
});
check('a .bind with no header we know: found, not supported, said why', () => {
    const m = make({ layout: '3.1', x64: false, codeLen: 0x400 });
    const b = Buffer.from(m.packed), opt = 0x98, ep = b.readUInt32LE(opt + 16);
    const bindPtr = b.readUInt32LE(opt + 0xe0 + 2 * 40 + 20), bindVa = b.readUInt32LE(opt + 0xe0 + 2 * 40 + 12);
    b.fill(0x55, bindPtr, bindPtr + (ep - bindVa));
    const d = stub.detectBuffer(b);
    assert.ok(d && d.supported === false && /take off yet/.test(d.why), JSON.stringify(d));
    assert.throws(() => stub.unpackBuffer(b), (e) => e instanceof stub.StubError && /take off yet/.test(e.message));
});
check('a 3.1 header with a code size that isn\'t whole AES blocks: not taken', () => {
    const m = make({ layout: '3.1', x64: false, codeLen: 0x400 });
    const b = Buffer.from(m.packed), opt = 0x98, ep = b.readUInt32LE(opt + 16);
    const bindPtr = b.readUInt32LE(opt + 0xe0 + 2 * 40 + 20), bindVa = b.readUInt32LE(opt + 0xe0 + 2 * 40 + 12);
    const hAt = bindPtr + (ep - bindVa) - 0xf0;
    const h = stub.xorDecode(b.slice(hAt, hAt + 0xf0));
    h.writeUInt32LE(0x3f8, 0x50);
    xorEncode(h).copy(b, hAt);
    assert.strictEqual(stub.detectBuffer(b).supported, false);
});
check('truncated and garbled files: a clear error, never a crash', () => {
    const m = make({ layout: '3.1', x64: false, codeLen: 0x400 });
    [m.packed.slice(0, 0x30), m.packed.slice(0, 0x150), m.packed.slice(0, 0x600), crypto.randomBytes(4096)].forEach((b, i) => {
        let r;
        try { r = stub.unpackBuffer(b); } catch (e) {
            assert.ok(e instanceof stub.StubError, 'case ' + i + ': ' + (e && e.stack));
            return;
        }
        assert.fail('case ' + i + ' unwrapped: ' + r.buffer.length);
    });
    /* detect too: null or a StubError */
    [m.packed.slice(0, 0x150), crypto.randomBytes(4096)].forEach((b) => {
        try { stub.detectBuffer(b); } catch (e) { assert.ok(e instanceof stub.StubError, e && e.stack); }
    });
});

/* ---- in place: on, already on, an update, off --------------------------------- */
check('in place: unwrapped, Steam\'s kept, an update re-wrapped, off puts it back', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamstub-'));
    const f = path.join(dir, 'castle.exe');
    const m = make({ layout: '3.1', x64: false, codeLen: 0x210, shrink: true });
    fs.writeFileSync(f, m.packed);
    assert.ok(stub.detect(f).supported);
    let r = stub.unwrapExe(f, true);
    assert.strictEqual(r.done, 'unwrapped');
    assert.ok(fs.readFileSync(f).equals(m.orig));
    assert.ok(fs.readFileSync(f + stub.ORIG).equals(m.packed));
    assert.strictEqual(stub.unwrapExe(f, true).done, 'already');
    /* an update: a new wrapped program in its place */
    const m2 = make({ layout: '3.1', x64: false, codeLen: 0x400 });
    fs.writeFileSync(f, m2.packed);
    assert.strictEqual(stub.unwrapExe(f, true).done, 'unwrapped');
    assert.ok(fs.readFileSync(f).equals(m2.orig));
    assert.ok(fs.readFileSync(f + stub.ORIG).equals(m2.packed), 'the newer wrapped one kept');
    assert.strictEqual(stub.unwrapExe(f, false).done, 'restored');
    assert.ok(fs.readFileSync(f).equals(m2.packed));
    assert.ok(!fs.existsSync(f + stub.ORIG));
    assert.strictEqual(stub.unwrapExe(f, false).done, 'nothing');
    assert.ok(!fs.existsSync(f + '.vzs-tmp'));
    /* a plain program: refused */
    fs.writeFileSync(f, m.orig);
    assert.throws(() => stub.unwrapExe(f, true), /isn't on this program/);
    fs.readdirSync(dir).forEach((x) => fs.unlinkSync(path.join(dir, x)));
    fs.rmdirSync(dir);
});

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
