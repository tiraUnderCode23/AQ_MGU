// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/* Steam's DRM wrapper (SteamStub) taken off a game's program, on the car.
 * Our own code, written from the format's public description (not from any
 * other unpacker's source).
 *
 * A wrapped program has a .bind section holding the stub; its entry point is
 * in .bind. We find the stub's header, undo what the stub would have done,
 * restore the original entry point, drop .bind when nothing else points into
 * it, and fix the sizes, file offsets and checksum. Four layouts are known:
 *
 *   variant 3 (3.1 x86/x64, 3.0 x86; 3.0 x64 guessed) - the header lies just
 *     before the entry point, each dword XORed with the one before it (the
 *     first is the key), starting with the key then the signature 0xC0DEC0DF.
 *     It carries the original entry point, the code section and (unless the
 *     flags say NoEncryption, 0x4) an AES-256 key and IV: the code section
 *     was AES-256-CBC encrypted with the IV that AES-256-ECB-decrypting the
 *     header's IV gives, its first 16 bytes moved into the header.
 *   variant 2.1 - the entry point moves the header's address and a non-zero
 *     XOR key as immediates; 0xC0DEC0DE sits just before it. The header
 *     (rolling-XOR with that key) points at an XOR'd payload; the payload
 *     holds an XTEA-encrypted SteamDRMP.dll whose code gives the offsets, in
 *     the payload, of the flags, original entry point, code section and an
 *     AES-256 key/IV (the code section AES-256-CBC as in variant 3).
 *   variant 2.0 - the entry point moves the header's address and dword count
 *     as immediates; 0xC0DEC0DE sits just before it. The header (rolling-XOR,
 *     key 0) carries the original entry point and, when the flags say so
 *     (0x4), a rolling-XOR key for the code section.
 *   variant 1.0 - no code encryption. A per-byte XOR header (byte x ^= x*x)
 *     gives the stub's address (a sanity check); the original entry point is
 *     the target of the stub's exit jump (popad; mov eax, OEP; jmp eax).
 *
 * Reading the few immediates at the entry point (variants 1, 2.0, 2.1) is
 * done by recognising just the instruction forms the stubs use (mov reg/mem,
 * imm32, direct or ebp-relative), not with a full disassembler. The payload and SteamDRMP.dll are decoded in memory and
 * never written to disk (the car only needs the clean program). Node 8 (the
 * unit's): no BigInt; XTEA and the XORs are plain 32-bit.
 *
 * Every layout is checked against the program before anything is written:
 * the code section where the header says, the entry point inside the image,
 * the AES block size, the payload and DLL within the file.
 *
 *   detect(file)          null (no .bind), or { variant, arch, appId,
 *                         flags, encrypted, supported, why, guessed }
 *   unpack(in, out)       writes the unwrapped program; returns detect()'s
 *   unwrapExe(file, on)   on: the program unwrapped in place, Steam's kept
 *                         as <file>.vzs-orig; off: Steam's put back */
'use strict';
const fs = require('fs');
const crypto = require('crypto');

const SIG = 0xc0dec0df;          /* variant 3 header signature (2nd dword) */
const MARK2 = 0xc0dec0de;        /* variant 2.x marker just before the entry point */
const NO_ENCRYPTION = 0x4;
const ORIG = '.vzs-orig';

/* the variant 3 headers: [offset, bytes] of the fields we use */
const WIDE = { imageBase: [0x08, 8], oep: [0x20, 8], appId: [0x38, 4], flags: [0x3c, 4], bindVs: [0x40, 4],
    codeVa: [0x48, 8], codeRaw: [0x50, 8], key: 0x58, iv: 0x78, stolen: 0x88 };
const NARROW = { imageBase: [0x08, 4], oep: [0x18, 4], appId: [0x2c, 4], flags: [0x30, 4], bindVs: [0x34, 4],
    codeVa: [0x3c, 4], codeRaw: [0x40, 4], key: 0x44, iv: 0x64, stolen: 0x74 };
const LAYOUTS = [
    { variant: '3.1', size: 0xf0, f: WIDE },
    { variant: '3.0', size: 0xb0, arch: 'x86', f: NARROW },
    { variant: '3.0', size: 0xd0, arch: 'x64', f: WIDE, guessed: true },
];

/* the variant 2.0 header (dwords), by its size in bytes. The 856-byte build
 * has one fewer import slot before the flags, so its fields sit 4 earlier. */
const V20 = {
    856: { flags: 0x14, oep: 0x28, codeVa: 0x2c, codeSize: 0x30, codeXor: 0x34, appId: 0x38 },
    884: { flags: 0x18, oep: 0x2c, codeVa: 0x30, codeSize: 0x34, codeXor: 0x38, appId: 0x3c },
    952: { flags: 0x18, oep: 0x2c, codeVa: 0x30, codeSize: 0x34, codeXor: 0x38, appId: 0x3c },
};

/* the variant 2.1 header (dwords). SteamAppIDString is char[8] (8 bytes, at
 * 0x34), then the three *Off fields, which are offsets into the decoded
 * payload (not direct values). The D0 build (0xD0 dwords) drops LoadLibraryW,
 * so its fields from BindSectionVirtualAddress on sit 4 earlier. */
const V21 = {
    std: { payloadVa: 0x24, payloadSize: 0x28, appId: 0x2c, dllVaOff: 0x3c, dllSizeOff: 0x40, xteaOff: 0x44 },
    d0: { payloadVa: 0x20, payloadSize: 0x24, appId: 0x28, dllVaOff: 0x38, dllSizeOff: 0x3c, xteaOff: 0x40 },
};

/* The parameter block inside SteamDRMP.dll's code: a run of load/store pairs
 * that copy dwords out of the payload (mov reg, [eax+disp32]; mov [abs], reg),
 * ending in a lea for the AES key and an add eax, imm32 for the IV. The anchor
 * matches the first two loads and the store between them; each parameter's
 * offset into the payload is the disp32 at a fixed position after the match.
 * Confirmed against Call of Duty: World at War's SteamDRMP.dll (2026-11-16). */
const DLL_ANCHOR = [0x8b, null, null, null, null, null, 0x89, null, null, null, null, null, 0x8b, null];
const DLL_POS = {
    normal: { flags: 2, appId: 14, oep: 26, codeVa: 38, encSize: 50, aesKey: 62, aesIv: 67 },
    fallback: { flags: 2, appId: 14, oep: 25, codeVa: 36, encSize: 47, aesKey: 61, aesIv: 72 },
};

class StubError extends Error {}
function fail(msg) { throw new StubError(msg); }

function u64(b, o) { return b.readUInt32LE(o) + b.readUInt32LE(o + 4) * 0x100000000; }
function field(b, f) { return f[1] === 8 ? u64(b, f[0]) : b.readUInt32LE(f[0]); }
function align(v, a) { return a ? Math.ceil(v / a) * a : v; }

/* ---- the PE ------------------------------------------------------------------ */

/* the headers we need, from a Buffer holding at least the file's headers */
function parsePe(b) {
    if (b.length < 0x40 || b.readUInt16LE(0) !== 0x5a4d) fail('not a Windows program (no MZ)');
    const pe = b.readUInt32LE(0x3c);
    if (pe + 24 > b.length || b.readUInt32LE(pe) !== 0x00004550) fail('not a Windows program (no PE header)');
    const machine = b.readUInt16LE(pe + 4), count = b.readUInt16LE(pe + 6), optSize = b.readUInt16LE(pe + 20);
    const opt = pe + 24;
    if (opt + optSize > b.length || optSize < 96) fail('a truncated PE header');
    const magic = b.readUInt16LE(opt), wide = magic === 0x20b;
    if (magic !== 0x10b && !wide) fail('an unknown optional header (0x' + magic.toString(16) + ')');
    const dirAt = opt + (wide ? 112 : 96), dirCount = Math.min(b.readUInt32LE(opt + (wide ? 108 : 92)), 16);
    const dirs = [];
    for (let i = 0; i < dirCount && dirAt + i * 8 + 8 <= opt + optSize; i++) dirs.push({ rva: b.readUInt32LE(dirAt + i * 8), size: b.readUInt32LE(dirAt + i * 8 + 4) });
    const table = opt + optSize;
    if (table + count * 40 > b.length) fail('a truncated section table');
    const sections = [];
    for (let i = 0; i < count; i++) {
        const at = table + i * 40;
        sections.push({ index: i, at: at, name: b.toString('latin1', at, at + 8).replace(/\0+$/, ''),
            vs: b.readUInt32LE(at + 8), va: b.readUInt32LE(at + 12), raw: b.readUInt32LE(at + 16), ptr: b.readUInt32LE(at + 20) });
    }
    return { pe: pe, opt: opt, optSize: optSize, wide: wide, table: table, dirAt: dirAt, dirs: dirs, sections: sections,
        arch: machine === 0x8664 ? 'x64' : machine === 0x14c ? 'x86' : null,
        ep: b.readUInt32LE(opt + 16), baseOfCode: b.readUInt32LE(opt + 20),
        imageBase: wide ? u64(b, opt + 24) : b.readUInt32LE(opt + 28),
        sectAlign: b.readUInt32LE(opt + 32), fileAlign: b.readUInt32LE(opt + 36), sizeOfImage: b.readUInt32LE(opt + 56),
        sizeOfHeaders: b.readUInt32LE(opt + 60), checksumAt: opt + 64 };
}

function sectionAt(p, rva) {
    return p.sections.filter((s) => rva >= s.va && rva < s.va + Math.max(s.vs, s.raw))[0] || null;
}
function rvaToOff(p, rva) {
    const s = sectionAt(p, rva);
    if (!s || rva - s.va >= s.raw) return null;
    return s.ptr + (rva - s.va);
}

/* ---- the decodings ----------------------------------------------------------- */

/* a rolling XOR over dwords: each plain dword is the cipher dword XORed with
 * the previous cipher dword (the given key seeds the first). Returns the
 * decoded bytes and the final key, so a following block can keep the chain. */
function steamXor(enc, key) {
    const out = Buffer.from(enc);
    for (let i = 0; i + 4 <= enc.length; i += 4) {
        const v = enc.readUInt32LE(i);
        out.writeUInt32LE((v ^ key) >>> 0, i);
        key = v >>> 0;
    }
    return { out: out, key: key >>> 0 };
}
/* variant 3 / 2.0 headers: the rolling XOR seeded with 0 (the first dword kept) */
function xorDecode(enc) { return steamXor(enc, 0).out; }

/* variant 1's header: each byte XORed with (its index squared) */
function squareXor(enc) {
    const out = Buffer.from(enc);
    for (let x = 0; x < out.length; x++) out[x] ^= (x * x) & 0xff;
    return out;
}

/* an address the header gives: an RVA, or a VA (the image base added) */
function toRva(v, p, base) {
    if (v < p.sizeOfImage) return v;
    if (base && v >= base && v - base < p.sizeOfImage) return v - base;
    if (v >= p.imageBase && v - p.imageBase < p.sizeOfImage) return v - p.imageBase;
    return null;
}

/* an address that is a VA or an RVA, resolved to the RVA that lands in a
 * section. A big image makes some VAs smaller than SizeOfImage, so the image
 * base is subtracted first when that is what hits a section (variant 2.1's
 * code and entry point are stored as VAs). */
function resolveAddr(v, p) {
    v = v >>> 0;
    if (v >= p.imageBase) { const r = (v - p.imageBase) >>> 0; if (r < p.sizeOfImage && sectionAt(p, r)) return r; }
    if (v < p.sizeOfImage && sectionAt(p, v)) return v;
    return null;
}

/* ---- reading the stub's bytes ------------------------------------------------ */

/* the offset of a byte signature (null = any byte) in a buffer, or -1 */
function findSig(buf, sig, from) {
    for (let i = from || 0; i + sig.length <= buf.length; i++) {
        let ok = true;
        for (let j = 0; j < sig.length; j++) if (sig[j] !== null && buf[i + j] !== sig[j]) { ok = false; break; }
        if (ok) return i;
    }
    return -1;
}

/* the length of a one-byte opcode that carries a ModR/M (no immediate) */
function modrmLen(code, i) {
    if (i + 1 >= code.length) return 1;
    const modrm = code[i + 1], mod = modrm >> 6, rm = modrm & 7;
    let len = 2;
    if (mod !== 3 && rm === 4) { len += 1; if (i + 2 < code.length && mod === 0 && (code[i + 2] & 7) === 5) len += 4; }
    if (mod === 1) len += 1;
    else if (mod === 2) len += 4;
    else if (mod === 0 && rm === 5) len += 4;
    return len;
}

/* the immediate operands of the mov instructions at the entry point, in order:
 * { kind: 'reg'|'mem', imm }. Only the forms the stubs use are decoded; any
 * other byte is stepped over so a later mov is still reached. */
function readImms(code, max) {
    const out = [], end = Math.min(code.length, max || 0x1000);
    let i = 0;
    while (i < end) {
        const op = code[i];
        if (op >= 0xb8 && op <= 0xbf) {                               /* mov r32, imm32 */
            if (i + 5 > end) break;
            out.push({ kind: 'reg', reg: op - 0xb8, imm: code.readUInt32LE(i + 1) >>> 0 });
            i += 5; continue;
        }
        if (op === 0xc7) {                                           /* mov r/m32, imm32 */
            const l = modrmLen(code, i);
            if (i + l + 4 > end) break;
            out.push({ kind: (code[i + 1] >> 6) === 3 ? 'reg' : 'mem', imm: code.readUInt32LE(i + l) >>> 0 });
            i += l + 4; continue;
        }
        if (op === 0x81) { i += modrmLen(code, i) + 4; continue; }    /* grp1 r/m32, imm32 (sub esp,..) */
        if (op === 0x83) { i += modrmLen(code, i) + 1; continue; }    /* grp1 r/m32, imm8 */
        if (op === 0x88 || op === 0x89 || op === 0x8a || op === 0x8b ||
            op === 0x01 || op === 0x03 || op === 0x29 || op === 0x2b ||
            op === 0x31 || op === 0x33 || op === 0x39 || op === 0x3b ||
            op === 0x8d || op === 0xff) { i += modrmLen(code, i); continue; }
        if (op === 0xa1 || op === 0xa3) { i += 5; continue; }         /* mov eax,[disp32] / mov [disp32],eax */
        if (op === 0xe8 || op === 0xe9 || op === 0x68) { i += 5; continue; } /* call/jmp rel32, push imm32 */
        if (op === 0xeb || op === 0x6a) { i += 2; continue; }         /* jmp rel8, push imm8 */
        i += 1;                                                       /* push/pop, nop, prologue bytes, etc. */
    }
    return out;
}

/* ---- XTEA (variant 2.1's SteamDRMP.dll) -------------------------------------- */

const XTEA_DELTA = 0x9e3779b9;
function xteaBlock(v0, v1, key) {
    let sum = 0xc6ef3720 >>> 0;                                        /* delta * 32 */
    for (let r = 0; r < 32; r++) {
        const t1 = (sum + key[(sum >>> 11) & 3]) >>> 0;
        v1 = (v1 - (((((v0 << 4) ^ (v0 >>> 5)) >>> 0) + v0) >>> 0 ^ t1)) >>> 0;
        sum = (sum - XTEA_DELTA) >>> 0;
        const t0 = (sum + key[sum & 3]) >>> 0;
        v0 = (v0 - (((((v1 << 4) ^ (v1 >>> 5)) >>> 0) + v1) >>> 0 ^ t0)) >>> 0;
    }
    return [v0 >>> 0, v1 >>> 0];
}
/* XTEA decrypt, each plain block XORed with the previous cipher block
 * (0x55555555 seeds both halves) */
function xteaDecrypt(buf, key) {
    const n = buf.length - (buf.length % 8), out = Buffer.alloc(n);
    let v1 = 0x55555555, v2 = 0x55555555;
    for (let o = 0; o + 8 <= n; o += 8) {
        const d1 = buf.readUInt32LE(o), d2 = buf.readUInt32LE(o + 4);
        const p = xteaBlock(d1, d2, key);
        out.writeUInt32LE((p[0] ^ v1) >>> 0, o);
        out.writeUInt32LE((p[1] ^ v2) >>> 0, o + 4);
        v1 = d1; v2 = d2;
    }
    return out;
}

/* ---- AES (variants 3 and 2.1) ------------------------------------------------ */

function aes(mode, key, iv, data) {
    const d = crypto.createDecipheriv(mode, key, iv);
    d.setAutoPadding(false);
    return Buffer.concat([d.update(data), d.final()]);
}
/* the code section put back: the 16 stolen bytes in front, AES-256-CBC with
 * the IV that one AES-256-ECB block of the header IV gives */
function aesDecode(key, iv, stolen, b, ptr, size) {
    const realIv = aes('aes-256-ecb', key, Buffer.alloc(0), iv);
    return aes('aes-256-cbc', key, realIv, Buffer.concat([stolen, b.slice(ptr, ptr + size)]));
}

/* ---- finding the header (one per variant) ----------------------------------- */

/* variant 3: the header lies just before the entry point */
function findV3(p, read) {
    const epOff = rvaToOff(p, p.ep);
    if (epOff === null) return null;
    for (const L of LAYOUTS) {
        if (L.arch && L.arch !== p.arch) continue;
        if (epOff < L.size) continue;
        const enc = read(epOff - L.size, L.size);
        if (enc.length < L.size) continue;
        const h = xorDecode(enc);
        if (h.readUInt32LE(4) !== SIG) continue;
        const f = L.f, base = field(h, f.imageBase);
        const oep = toRva(field(h, f.oep), p, base), codeVa = toRva(field(h, f.codeVa), p, base);
        const code = codeVa === null ? null : p.sections.filter((s) => s.va === codeVa)[0];
        const codeRaw = field(h, f.codeRaw), flags = h.readUInt32LE(f.flags[0]);
        const encrypted = !(flags & NO_ENCRYPTION);
        if (oep === null || !sectionAt(p, oep) || sectionAt(p, oep).name === '.bind') continue;
        if (encrypted && (!code || codeRaw === 0 || codeRaw % 16 !== 0 || codeRaw > code.raw)) continue;
        const key = h.slice(f.key, f.key + 32), iv = h.slice(f.iv, f.iv + 16), stolen = h.slice(f.stolen, f.stolen + 16);
        return { variant: L.variant, guessed: !!L.guessed, oep: oep, code: code, codeRaw: codeRaw, flags: flags, encrypted: encrypted,
            appId: h.readUInt32LE(f.appId[0]), decode: (b) => aesDecode(key, iv, stolen, b, code.ptr, codeRaw) };
    }
    return null;
}

/* the entry point's code and the 0xC0DEC0DE marker just before it (variants
 * 2.0 and 2.1), or null */
function entryCode(p, read) {
    const epOff = rvaToOff(p, p.ep);
    if (epOff === null || epOff < 4) return null;
    if (read(epOff - 4, 4).readUInt32LE(0) !== MARK2) return null;
    return read(epOff, 0x1000);
}

/* variant 2.0 */
function findV20(p, read, bind, bindBytes) {
    const PRO = [0x53, 0x51, 0x52, 0x56, 0x57, 0x55, 0x8b, 0xec, 0x81, 0xec, 0x00, 0x10, 0x00, 0x00, 0xbe];
    if (findSig(bindBytes, PRO) < 0) return null;
    const win = entryCode(p, read);
    if (!win) return null;
    const regs = readImms(win).filter((m) => m.kind === 'reg');
    if (regs.length < 2) fail('variant 2.0: the header address and count not found at the entry point');
    const hRva = toRva(regs[0].imm, p);
    const size = (regs[1].imm & 0xffff) * 4;                           /* dword count (low word) */
    if (hRva === null) fail('variant 2.0: the header is not inside the program');
    if (size !== 856 && size !== 884 && size !== 952) fail('variant 2.0: an unknown header size (' + size + ' bytes)');
    const off = rvaToOff(p, hRva);
    if (off === null) fail('variant 2.0: the header is not in a section with data');
    const h = xorDecode(read(off, size));
    const L = V20[size], flags = h.readUInt32LE(L.flags), encrypted = !!(flags & NO_ENCRYPTION);
    const oep = toRva(h.readUInt32LE(L.oep), p);
    if (oep === null || !sectionAt(p, oep) || sectionAt(p, oep).name === '.bind') fail('variant 2.0: the original entry point is not in the program');
    let code = null, codeSize = 0, codeXor = 0;
    if (encrypted) {
        const codeVa = toRva(h.readUInt32LE(L.codeVa), p);
        code = (codeVa !== null && p.sections.filter((s) => s.va === codeVa)[0]) || sectionAt(p, p.baseOfCode);
        if (!code || !code.raw) fail('variant 2.0: the code section was not found');
        codeSize = Math.min(h.readUInt32LE(L.codeSize), code.raw) & ~3;
        codeXor = h.readUInt32LE(L.codeXor);
    }
    return { variant: '2.0', guessed: false, oep: oep, appId: h.readUInt32LE(L.appId), flags: flags, encrypted: encrypted,
        code: code, codeRaw: codeSize,
        decode: (b) => steamXor(b.slice(code.ptr, code.ptr + codeSize), codeXor).out };
}

/* variant 2.1 */
function findV21(p, read, bind, bindBytes) {
    const PRO = [0x53, 0x51, 0x52, 0x56, 0x57, 0x55, 0x8b, 0xec, 0x81, 0xec, 0x00, 0x10, 0x00, 0x00, 0xc7];
    if (findSig(bindBytes, PRO) < 0) return null;
    const win = entryCode(p, read);
    if (!win) return null;
    const imms = readImms(win), mem = imms.filter((m) => m.kind === 'mem'), reg = imms.filter((m) => m.kind === 'reg');
    if (mem.length < 2 || reg.length < 1) fail('variant 2.1: the header address, key and count not found at the entry point');
    const hRva = toRva(mem[0].imm, p), xorKey = mem[1].imm >>> 0, count = reg[0].imm & 0xffff;
    if (hRva === null) fail('variant 2.1: the header is not inside the program');
    if (!xorKey) fail('variant 2.1: a zero header key');
    const off = rvaToOff(p, hRva);
    if (off === null) fail('variant 2.1: the header is not in a section with data');
    const L = count === 0xd0 ? V21.d0 : V21.std;
    const dec = steamXor(read(off, count * 4), xorKey);
    const h = dec.out;

    /* the payload: XOR'd with the chain continued from the header's last key */
    const payVa = toRva(h.readUInt32LE(L.payloadVa), p), paySize = h.readUInt32LE(L.payloadSize);
    const payOff = payVa === null ? null : rvaToOff(p, payVa);
    if (payOff === null || !paySize) fail('variant 2.1: the payload is not in the program');
    const payload = steamXor(read(payOff, paySize), dec.key).out;
    if (payload.length < paySize) fail('variant 2.1: the payload runs past the end of the file');

    /* SteamDRMP.dll: its RVA, size and the XTEA key are dwords in the payload,
     * at offsets the header gives; the DLL is then XTEA-decrypted */
    const inPayload = (o, n) => o >= 0 && o + n <= payload.length;
    const dllVaOff = h.readUInt32LE(L.dllVaOff), dllSizeOff = h.readUInt32LE(L.dllSizeOff), xteaOff = h.readUInt32LE(L.xteaOff);
    if (!inPayload(dllVaOff, 4) || !inPayload(dllSizeOff, 4) || !inPayload(xteaOff, 16)) fail('variant 2.1: a header offset points outside the payload');
    const dllVa = toRva(payload.readUInt32LE(dllVaOff), p), dllSize = payload.readUInt32LE(dllSizeOff);
    const dllOff = dllVa === null ? null : rvaToOff(p, dllVa);
    if (dllOff === null || !dllSize) fail('variant 2.1: SteamDRMP.dll is not in the program');
    const xkey = [payload.readUInt32LE(xteaOff), payload.readUInt32LE(xteaOff + 4), payload.readUInt32LE(xteaOff + 8), payload.readUInt32LE(xteaOff + 12)];
    const dll = xteaDecrypt(read(dllOff, dllSize), xkey);

    /* the parameter offsets inside the DLL's code, then the values in the payload */
    const params = dllParams(dll, payload, p);
    const oep = resolveAddr(params.oep, p);
    if (oep === null || sectionAt(p, oep).name === '.bind') fail('variant 2.1: the original entry point is not in the program');
    const encrypted = !(params.flags & NO_ENCRYPTION);
    let code = null;
    if (encrypted) {
        const codeRva = resolveAddr(params.codeVa, p);
        code = codeRva === null ? null : sectionAt(p, codeRva);
        if (!code || !params.encSize || params.encSize % 16 !== 0 || params.encSize > code.raw) fail('variant 2.1: the code section or its size is wrong');
    }
    return { variant: '2.1', guessed: false, oep: oep, appId: h.readUInt32LE(L.appId), flags: params.flags, encrypted: encrypted,
        code: code, codeRaw: params.encSize || 0,
        decode: (b) => aesDecode(params.key, params.iv, params.stolen, b, code.ptr, params.encSize) };
}

/* the parameters SteamDRMP.dll's code points at, read from the payload. The
 * anchor is common, so every match is tried and the one whose values make
 * sense (a real code section, whole AES blocks, a small flags word) is taken. */
function dllParams(dll, payload, p) {
    for (let from = 0; ;) {
        const m = findSig(dll, DLL_ANCHOR, from);
        if (m < 0) break;
        from = m + 1;
        for (const posName of ['normal', 'fallback']) {
            const pos = DLL_POS[posName];
            if (m + pos.aesIv + 4 > dll.length) continue;
            const at = (k) => dll.readUInt32LE(m + pos[k]);
            const o = { flags: at('flags'), oep: at('oep'), codeVa: at('codeVa'), encSize: at('encSize'), key: at('aesKey'), iv: at('aesIv') };
            const dword = (x) => x >= 0 && x + 4 <= payload.length;
            if (![o.flags, o.oep, o.codeVa, o.encSize].every(dword) || o.key < 0 || o.key + 32 > payload.length || o.iv < 0 || o.iv + 32 > payload.length) continue;
            const flags = payload.readUInt32LE(o.flags), encSize = payload.readUInt32LE(o.encSize);
            const codeRva = resolveAddr(payload.readUInt32LE(o.codeVa), p), oepRva = resolveAddr(payload.readUInt32LE(o.oep), p);
            if (flags > 0xff || encSize % 16 !== 0 || codeRva === null || oepRva === null) continue;   /* not the real block */
            return { flags: flags, oep: payload.readUInt32LE(o.oep), codeVa: payload.readUInt32LE(o.codeVa), encSize: encSize,
                key: payload.slice(o.key, o.key + 32), iv: payload.slice(o.iv, o.iv + 16), stolen: payload.slice(o.iv + 16, o.iv + 32) };
        }
    }
    fail('variant 2.1: the parameter block was not found in SteamDRMP.dll');
}

/* variant 1.0 */
function findV1(p, read, bind, bindBytes) {
    const PRO = [0x60, 0x81, 0xec, 0x00, 0x10, 0x00, 0x00, 0xbe, null, null, null, null, 0xb9, 0x6a];
    const m = findSig(bindBytes, PRO);
    if (m < 0) return null;
    const hRva = toRva(bindBytes.readUInt32LE(m + 8), p), size = (bindBytes.readUInt32LE(m + 13) & 0xffff) * 4;
    if (hRva === null || !size) fail('variant 1: the header is not inside the program');
    const off = rvaToOff(p, hRva);
    if (off === null) fail('variant 1: the header is not in a section with data');
    const h = squareXor(read(off, size));
    if (((h.readUInt32LE(8) - p.imageBase) >>> 0) !== p.ep) fail('variant 1: the header does not describe this entry point');
    const tramp = findSig(bindBytes, [0x61, 0xb8, null, null, null, null, 0xff, 0xe0]);
    if (tramp < 0) fail('variant 1: the exit jump (the original entry point) was not found');
    const oep = toRva(bindBytes.readUInt32LE(tramp + 2), p);
    if (oep === null || !sectionAt(p, oep) || sectionAt(p, oep).name === '.bind') fail('variant 1: the original entry point is not in the program');
    return { variant: '1', guessed: false, oep: oep, appId: h.readUInt32LE(0x14), flags: 0, encrypted: false,
        code: null, codeRaw: 0, decode: () => null };
}

/* the header of whichever variant wraps the program, checked against it */
function findHeader(p, read) {
    const v3 = findV3(p, read);
    if (v3) return v3;
    const bind = p.sections.filter((s) => s.name === '.bind')[0];
    if (!bind || !bind.raw) return null;
    const bindBytes = read(bind.ptr, bind.raw);
    if (bindBytes.length < bind.raw) return null;
    return findV21(p, read, bind, bindBytes) || findV20(p, read, bind, bindBytes) || findV1(p, read, bind, bindBytes);
}

function describe(p, h) {
    if (!h) {
        return { variant: null, arch: p.arch, appId: null, flags: null, encrypted: null, supported: false, guessed: false,
            why: 'Steam\'s DRM wrapper of a kind we can\'t take off yet (an unknown variant)' };
    }
    return { variant: h.variant, arch: p.arch, appId: h.appId, flags: h.flags, encrypted: h.encrypted, supported: true, guessed: h.guessed, why: null };
}

function wrapErr(e) {
    if (e instanceof StubError) return e;
    if (e instanceof RangeError) return new StubError('a truncated or damaged program (' + e.message + ')');
    return e;
}

/* ---- detect ------------------------------------------------------------------ */

function detectBuffer(b) {
    try {
        const p = parsePe(b);
        if (!p.sections.some((s) => s.name === '.bind')) return null;
        return describe(p, findHeader(p, (off, len) => b.slice(off, off + len)));
    } catch (e) { throw wrapErr(e); }
}

function detect(file) {
    const fd = fs.openSync(file, 'r');
    try {
        const read = (off, len) => { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, off); return b.slice(0, n); };
        const head = read(0, 65536);
        try {
            const p = parsePe(head);
            if (!p.sections.some((s) => s.name === '.bind')) return null;
            return describe(p, findHeader(p, read));
        } catch (e) { throw wrapErr(e); }
    } finally { fs.closeSync(fd); }
}

/* ---- unpack ------------------------------------------------------------------ */

/* the standard PE checksum (the field itself counted as zero) */
function peChecksum(b, at) {
    let sum = 0;
    for (let i = 0; i < b.length; i += 2) {
        if (i === at || i === at + 2) continue;
        sum += i + 1 < b.length ? b.readUInt16LE(i) : b[i];
        sum = (sum & 0xffff) + (sum >>> 16);
    }
    sum = (sum & 0xffff) + (sum >>> 16);
    return (sum + b.length) >>> 0;
}

/* the unwrapped program as a new Buffer */
function unpackBuffer(b) {
    try { return unpackInner(b); } catch (e) { throw wrapErr(e); }
}

function unpackInner(b) {
    const p = parsePe(b);
    const bind = p.sections.filter((s) => s.name === '.bind')[0];
    if (!bind) fail('no .bind section: not wrapped by Steam\'s DRM');
    const h = findHeader(p, (off, len) => b.slice(off, off + len));
    if (!h) fail(describe(p, null).why);

    /* the code section's bytes as they were (null when the variant leaves it) */
    let code = null;
    if (h.code && h.encrypted) {
        if (h.code.ptr + h.codeRaw > b.length) fail('the code section runs past the end of the file');
        code = h.decode(b, p);
        if (!code) fail('the code section could not be decoded');
        const next = p.sections.filter((s) => s.va > h.code.va).sort((x, y) => x.va - y.va)[0];
        if (next && h.code.va + code.length > next.va) fail('the decoded code section would run into ' + next.name);
    }

    /* .bind goes when it is the last section (in the table, in memory and in
     * the file) and no directory nor the entry point points into it */
    const inBind = (rva) => rva >= bind.va && rva < bind.va + Math.max(bind.vs, bind.raw);
    const last = p.sections[p.sections.length - 1] === bind &&
        p.sections.every((s) => s === bind || (s.va < bind.va && (!s.raw || s.ptr < bind.ptr || !bind.raw)));
    const dropBind = last && !p.dirs.some((d) => d.size && inBind(d.rva)) && !inBind(h.oep);

    /* new file offsets: the code section may grow, .bind's bytes may go */
    const withRaw = p.sections.filter((s) => s.raw).sort((x, y) => x.ptr - y.ptr);
    const rawEnd = withRaw.reduce((m, s) => Math.max(m, s.ptr + s.raw), p.sizeOfHeaders);
    const plan = [];
    let shift = 0;
    withRaw.forEach((s) => {
        const ptr = s.ptr + shift;
        let size = s.raw;
        if (s === bind && dropBind) { size = 0; } else if (code && s === h.code && code.length > s.raw) size = align(code.length, p.fileAlign);
        plan.push({ s: s, ptr: s === bind && dropBind ? 0 : ptr, size: size });
        shift += size - s.raw;
    });
    const mapOff = (off) => {
        for (const x of plan) if (off >= x.s.ptr && off < x.s.ptr + x.s.raw) return x.size ? x.ptr + (off - x.s.ptr) : null;
        return off >= rawEnd ? off + shift : off;
    };

    const out = Buffer.alloc(b.length + shift);
    b.copy(out, 0, 0, Math.min(b.length, withRaw.length ? withRaw[0].ptr : p.sizeOfHeaders));
    plan.forEach((x) => {
        if (!x.size) return;
        b.copy(out, x.ptr, x.s.ptr, x.s.ptr + Math.min(x.s.raw, x.size));
        if (code && x.s === h.code) code.copy(out, x.ptr);
    });
    if (rawEnd < b.length) b.copy(out, rawEnd + shift, rawEnd);

    /* the headers */
    out.writeUInt32LE(h.oep, p.opt + 16);
    plan.forEach((x) => {
        out.writeUInt32LE(x.size, x.s.at + 16);
        out.writeUInt32LE(x.size ? x.ptr : 0, x.s.at + 20);
    });
    if (code && code.length > h.code.vs) out.writeUInt32LE(code.length, h.code.at + 8);
    if (dropBind) {
        out.fill(0, bind.at, bind.at + 40);
        out.writeUInt16LE(p.sections.length - 1, p.pe + 6);
        const kept = p.sections.filter((s) => s !== bind);
        out.writeUInt32LE(kept.reduce((m, s) => Math.max(m, s.va + align(Math.max(code && s === h.code ? code.length : 0, s.vs || s.raw), p.sectAlign)), align(p.sizeOfHeaders, p.sectAlign)), p.opt + 56);
    }
    /* file offsets in the directories: the certificates (4), the debug data (6) */
    const sec = p.dirs[4];
    if (sec && sec.size && sec.rva) out.writeUInt32LE(mapOff(sec.rva) || 0, p.dirAt + 4 * 8);
    const dbg = p.dirs[6];
    if (dbg && dbg.size) {
        const at = rvaToOff(p, dbg.rva);
        if (at !== null) {
            const nat = mapOff(at);
            for (let i = 0; nat !== null && i + 28 <= dbg.size; i += 28) {
                const old = out.readUInt32LE(nat + i + 24);
                if (old) out.writeUInt32LE(mapOff(old) || 0, nat + i + 24);
            }
        }
    }
    /* a checksum that was there is made right again; none stays none */
    if (out.readUInt32LE(p.checksumAt)) out.writeUInt32LE(peChecksum(out, p.checksumAt), p.checksumAt);
    return { buffer: out, info: Object.assign(describe(p, h), { bindRemoved: dropBind }) };
}

function unpack(input, output) {
    const r = unpackBuffer(fs.readFileSync(input));
    fs.writeFileSync(output, r.buffer);
    return r.info;
}

/* ---- in place, for the tool ------------------------------------------------- */

/* on: the program unwrapped where it is, Steam's kept as <file>.vzs-orig (a
 * new wrapped one, from an update, replaces the kept one); off: Steam's put
 * back. Returns what happened: 'unwrapped' (with info), 'already',
 * 'restored', 'nothing'. Throws (StubError) when it can't. */
function unwrapExe(file, on) {
    const orig = file + ORIG, tmp = file + '.vzs-tmp';
    if (!on) {
        if (!fs.existsSync(orig)) return { done: 'nothing' };
        fs.unlinkSync(file);
        fs.renameSync(orig, file);
        return { done: 'restored' };
    }
    const now = detect(file);
    if (now && now.supported) {
        const info = unpack(file, tmp);
        try {
            if (fs.existsSync(orig)) fs.unlinkSync(orig);
            fs.renameSync(file, orig);
            fs.renameSync(tmp, file);
        } catch (e) {
            try { fs.unlinkSync(tmp); } catch (e2) { /* gone */ }
            throw e;
        }
        return { done: 'unwrapped', info: info };
    }
    if (fs.existsSync(orig)) return { done: 'already' };
    if (now) fail(now.why);
    fail('Steam\'s DRM wrapper isn\'t on this program');
}

module.exports = { detect, detectBuffer, unpack, unpackBuffer, unwrapExe, peChecksum, xorDecode, steamXor, squareXor, xteaDecrypt, StubError, SIG, MARK2, NO_ENCRYPTION, ORIG };
