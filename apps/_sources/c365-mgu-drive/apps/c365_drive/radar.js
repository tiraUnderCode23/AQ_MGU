'use strict';
/**
 * Warsaw camera approach warning.
 * From 300 m ahead the alert beeps. Closer is faster and louder.
 * The first warning keeps beeping for at least 5 seconds.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const CAMS = require('./cameras');

const WARN_M = 300;
const PASS_M = 80;
const CLEAR_M = 380;

function dist(a, b) {
    const R = 6371000;
    const p1 = a.lat * Math.PI / 180;
    const p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180;
    const dl = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearing(a, b) {
    const p1 = a.lat * Math.PI / 180;
    const p2 = b.lat * Math.PI / 180;
    const dl = (b.lon - a.lon) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function turn(a, b) {
    let d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    return d;
}

function nearest(pos) {
    let best = null;
    for (let i = 0; i < CAMS.length; i++) {
        const c = CAMS[i];
        const m = dist(pos, c);
        if (!best || m < best.m) best = { i: i, m: m, c: c, bear: bearing(pos, c) };
    }
    return best;
}

function ahead(pos, near) {
    if (!near || near.m > WARN_M) return null;
    if (near.m < 40 || pos.course == null) return near;
    if (turn(pos.course, near.bear) <= 55) return near;
    return null;
}

function wav(freq, ms, gain) {
    const rate = 22050;
    const n = Math.floor(rate * ms / 1000);
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
        const env = Math.min(1, i / 70, (n - i) / 90);
        const s = Math.sin(2 * Math.PI * freq * i / rate) * gain * env;
        data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), i * 2);
    }
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0);
    hdr.writeUInt32LE(36 + data.length, 4);
    hdr.write('WAVE', 8);
    hdr.write('fmt ', 12);
    hdr.writeUInt32LE(16, 16);
    hdr.writeUInt16LE(1, 20);
    hdr.writeUInt16LE(1, 22);
    hdr.writeUInt32LE(rate, 24);
    hdr.writeUInt32LE(rate * 2, 28);
    hdr.writeUInt16LE(2, 32);
    hdr.writeUInt16LE(16, 34);
    hdr.write('data', 36);
    hdr.writeUInt32LE(data.length, 40);
    return Buffer.concat([hdr, data]);
}

function player() {
    const list = process.platform === 'darwin'
        ? ['/usr/bin/afplay', 'afplay']
        : ['/usr/bin/paplay', '/usr/bin/aplay', '/usr/bin/pw-play', 'paplay', 'aplay'];
    for (let i = 0; i < list.length; i++) {
        if (list[i].indexOf('/') === 0 && fs.existsSync(list[i])) return list[i];
        if (list[i].indexOf('/') !== 0) return list[i];
    }
    return null;
}

let playing = false;
let wavPath = null;
const PLAY = player();

function beep(freq, gain) {
    if (playing || !PLAY) return;
    try {
        if (!wavPath) wavPath = path.join(os.tmpdir(), 'c365-beep.wav');
        fs.writeFileSync(wavPath, wav(freq, 85, gain));
        playing = true;
        const p = spawn(PLAY, [wavPath], { stdio: 'ignore' });
        const done = () => { playing = false; };
        p.on('exit', done);
        p.on('error', done);
    } catch (e) {
        playing = false;
    }
}

const state = {
    id: -1,
    dist: null,
    passed: -1,
    holdUntil: 0,
    lastBeep: 0,
    lastDist: null,
};

/**
 * pos = { lat, lon, course } or null. speed in km/h. sound true to beep.
 * Returns { on, dist, road, kind, gps }.
 */
function tick(pos, speed, sound, now) {
    const out = { on: false, dist: null, road: '', kind: '', n: CAMS.length, gps: !!(pos && pos.lat != null) };
    if (!pos || pos.lat == null) return out;
    const near = nearest(pos);
    if (!near) return out;
    out.dist = Math.round(near.m);
    out.road = near.c.road || '';
    out.kind = near.c.kind || 'speed';
    if (state.passed === near.i && near.m < CLEAR_M) {
        state.lastDist = near.m;
        return out;
    }
    if (near.m > CLEAR_M) state.passed = -1;
    const hit = ahead(pos, near);
    const inside = !!(hit && hit.i !== state.passed);
    if (inside && state.id !== hit.i) {
        state.id = hit.i;
        state.holdUntil = now + 5000;
    }
    if (!inside && now > state.holdUntil) state.id = -1;
    const alerting = state.id === (hit ? hit.i : state.id) && (inside || now < state.holdUntil) && state.id >= 0 && near.i === state.id;
    if (alerting && state.lastDist != null && near.m > state.lastDist + 12 && near.m < PASS_M) {
        state.passed = state.id;
        state.id = -1;
        state.holdUntil = 0;
        state.lastDist = near.m;
        return out;
    }
    state.lastDist = near.m;
    if (!alerting) return out;
    out.on = true;
    out.dist = Math.round(near.m);
    const moving = speed == null || speed >= 8 || now < state.holdUntil;
    if (sound && moving) {
        const t = Math.max(0, Math.min(1, near.m / WARN_M));
        const gap = 90 + t * 720;
        if (now - state.lastBeep >= gap) {
            state.lastBeep = now;
            beep(1500 + (1 - t) * 1400, 0.28 + (1 - t) * 0.7);
        }
    }
    return out;
}

module.exports = { tick, CAMS, dist };
