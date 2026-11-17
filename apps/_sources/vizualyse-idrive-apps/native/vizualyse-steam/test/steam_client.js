// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * The Windows Steam client in the tool's Wine, off the car (test/run_steam_client.sh
 * starts it): is a real client in the prefix a usable way to run games whose
 * program is wrapped by Steam's DRM (it wants a running, signed-in client),
 * and what does it cost? First of all, memory.
 *
 * In the head unit's root filesystem, as test/play_main.js, on a COPY of the
 * play bench's /var/opt (its own Docker volume): the runtime, Proton, the
 * prefix. wl-sink and Wine started as src/game.js starts them (the unit's
 * EGL on the bench's stand-in GPU), but a program run straight, not through
 * Proton's steam.exe shim (launch.json's argv), and without "steam.exe=b":
 * that override would load Wine's built-in shim in place of Valve's
 * steam.exe.
 *
 *   node steam_client.js /t
 *
 * Then, by files in /tmp (run_steam_client.sh writes them):
 *   /tmp/sc.cmd   lines: "run C:\path\prog.exe [args...]" (another Wine
 *                 program in the same wineserver), "sink d|m|u X Y" (the
 *                 pointer, the picture's pixels), "mark TEXT" (a line in the
 *                 memory log, to tell phases apart)
 *   /tmp/sc-mem.log  every 10 s: each process of the tool's uid by name,
 *                 PSS and RSS (smaps_rollup), and the total; MemAvailable
 *                 against the start
 * The picture is the frame file play_input.js shot reads.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const T = process.argv[2] || '/t';
const UID = 12996, GID = 44;
const W = Number(process.env.SC_W) || 1280, H = Number(process.env.SC_H) || 800;

/* the bench's stand-in GPU, as play_main.js (GPU=stub), Wine's sync as on the car */
const extra = { LD_PRELOAD: '/g/stub/libintel_noop_drm_shim.so', INTEL_STUB_GPU_PLATFORM: 'bxt', WINEFSYNC: '0', WINENTSYNC: '0' };
if (fs.existsSync('/vkt/bench/kernel414.so')) extra.LD_PRELOAD = '/vkt/bench/kernel414.so:' + extra.LD_PRELOAD;
process.env.STEAM_EXTRA_ENV = JSON.stringify(extra);

const env = require(T + '/src/env.js');
const screen = require(T + '/src/screen.js');

const DISPLAY = 'wayland-vzs';
const MEM_LOG = '/tmp/sc-mem.log';
const CMD = '/tmp/sc.cmd';
const launch = JSON.parse(fs.readFileSync(T + '/build/launch.json', 'utf8'));

function log(s) { console.log(new Date().toISOString() + ' ' + s); }
function memLine(s) { fs.appendFileSync(MEM_LOG, new Date().toISOString() + ' ' + s + '\n'); }

/* the runtime's resolver reads env.DNS_FILE, not /etc/resolv.conf (server.js
 * writes it from the phone's lease on the car): the container's own servers */
fs.writeFileSync(env.DNS_FILE, fs.readFileSync('/etc/resolv.conf', 'utf8').split('\n').filter((l) => /^nameserver\s/.test(l)).join('\n') + '\n', { mode: 0o644 });

/* Wine's trusted roots (crypt32) come from fixed places, first
 * /etc/ssl/certs/ca-certificates.crt; the unit's /etc/ssl/certs has only
 * BMW's own (no public CA), so every HTTPS through Windows' TLS failed: the
 * client's updater, "http error 0" (2026-11-16). The runtime's bundle there,
 * bind-mounted (the container's root; the tool would need a mount namespace
 * of its own for Wine on the car). SC_CA=0: as the unit is. */
const CA = '/etc/ssl/certs/ca-certificates.crt';
if (process.env.SC_CA !== '0' && !fs.existsSync(CA)) {
    fs.writeFileSync(CA, '');
    require('child_process').execFileSync('mount', ['--bind', env.RUNTIME + '/etc/ssl/certs/ca-certificates.crt', CA]);
    console.log('steam_client: the runtime\'s CA bundle at ' + CA);
}

/* Every Wine program in a memory cgroup of its own (/sys/fs/cgroup/client),
 * so what the client uses can be pushed out to swap ("reclaim"). Docker
 * gives cgroup v2, which charges memory where it was first used: a process
 * moved later keeps its pages charged to the old group, so the client must
 * start in it. (The car's 4.14 has cgroup v1 and move_charge_at_immigrate.) */
const CG = '/sys/fs/cgroup', CLIENT_CG = CG + '/client';
let cgroup = false;
try {
    require('child_process').execFileSync('mount', ['-o', 'remount,rw', CG]);
    [CG + '/rest', CLIENT_CG].forEach((d) => { try { fs.mkdirSync(d); } catch (e) { /* there */ } });
    fs.readFileSync(CG + '/cgroup.procs', 'utf8').split('\n').filter(Boolean).forEach((p) => { try { fs.writeFileSync(CG + '/rest/cgroup.procs', p); } catch (e) { /* gone */ } });
    fs.writeFileSync(CG + '/cgroup.subtree_control', '+memory');
    cgroup = true;
} catch (e) { console.log('steam_client: no memory cgroup (' + e.message + ')'); }
const cgMb = (f) => { try { return Math.round(Number(fs.readFileSync(CLIENT_CG + '/' + f, 'utf8')) / 1048576); } catch (e) { return null; } };

/* the processes of a Windows program by name: Wine's argv[0] is the program's
 * path (comm won't do: Chromium renames its own, CrBrowserMain ...) */
function pidsOf(prog) {
    const want = prog.toLowerCase();
    return fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)).filter((p) => {
        try { return fs.readFileSync('/proc/' + p + '/cmdline', 'latin1').split('\0')[0].split(/[\\/]/).pop().toLowerCase() === want; } catch (e) { return false; }
    });
}
function signal(prog, sig) {
    const ps = pidsOf(prog);
    ps.forEach((p) => { try { process.kill(Number(p), sig); } catch (e) { /* gone */ } });
    return ps;
}

/* ---- wl-sink, as game.js starts it -------------------------------------------- */
env.userDirs(UID, GID);
[DISPLAY, DISPLAY + '.lock'].forEach((n) => { try { fs.unlinkSync(path.join(env.XDG_DIR, n)); } catch (e) { /* none */ } });
screen.frameFile(W, H);
const sink = spawn(env.RUNTIME + '/wl-sink', ['--socket', DISPLAY, '--frame', screen.FILE, '--fps', '30', '--device', env.RENDER_NODE,
    '--uid', String(UID), '--gid', String(GID), '--input'], { env: env.sinkEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
sink.stdin.on('error', () => { /* gone */ });
let ready = false;
const lines = (tag, fn) => {
    let rest = '';
    return (d) => {
        rest += d;
        let i;
        while ((i = rest.indexOf('\n')) >= 0) { const l = rest.slice(0, i).trim(); rest = rest.slice(i + 1); if (l) fn(l); }
    };
};
sink.stdout.setEncoding('utf8');
sink.stdout.on('data', lines('wl-sink', (l) => {
    let e;
    try { e = JSON.parse(l); } catch (x) { log('wl-sink: ' + l.slice(0, 200)); return; }
    if (e.ev === 'ready' && !ready) { ready = true; log('wl-sink: ready ' + e.size.join('x')); first(); }
    else if (e.ev === 'toplevel') log('window: "' + String(e.title || '').slice(0, 80) + '"');
    else if (e.ev === 'fit') log('wl-sink: fit ' + JSON.stringify(e));
    else if (e.ev === 'error') log('wl-sink: ' + e.error);
}));
sink.stderr.on('data', lines('wl-sink', (l) => log('wl-sink: ' + l.slice(0, 200))));
sink.on('exit', (c, s) => { log('wl-sink exited (' + (s || c) + ')'); process.exit(1); });

/* ---- Wine programs, straight (no shim) ------------------------------------------ */
function wineEnv() {
    const e = env.wineEnv(launch, 0, DISPLAY, false, 'normal', false, null);
    e.WINEDLLOVERRIDES = e.WINEDLLOVERRIDES.split(';').filter((o) => !/^steam\.exe=/.test(o)).join(';');
    delete e.SteamGameId; delete e.SteamAppId; delete e.STEAM_COMPAT_APP_ID;
    /* Proton's loader swaps any steamclient(64).dll for lsteamclient, its bridge to a
     * Linux client (dlls/ntdll/loader.c): the Windows client's own must load, for it
     * and for the games that talk to it ("unable to load native steamclient library"
     * without end, 2026-11-16) */
    e.PROTON_DISABLE_LSTEAMCLIENT = '1';
    return e;
}
function run(prog, args) {
    const e = wineEnv(), libs = e.LD_LIBRARY_PATH;
    delete e.LD_LIBRARY_PATH;
    const argv = launch.argv.slice(0, 2).concat([prog]).concat(args);
    log('run: ' + prog + ' ' + args.join(' '));
    /* a program by its Z: path (a game in /var/opt/...) runs in its own folder, as game.js runs one */
    const cwd = /^Z:\\/i.test(prog) ? path.dirname(prog.slice(2).split('\\').join('/')) : env.PREFIX + '/pfx/drive_c';
    const p = spawn('/bin/sh', ['-c', 'LD_LIBRARY_PATH=' + libs + ' exec "$0" "$@"'].concat(argv),
        { env: e, cwd: cwd, uid: UID, gid: GID, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    /* into the client's cgroup by us (root): the uid can't write cgroup.procs; at
     * once, before the shell has exec'd Wine and Wine forked anything */
    if (cgroup) { try { fs.writeFileSync(CLIENT_CG + '/cgroup.procs', String(p.pid)); } catch (x) { log('cgroup: ' + x.message); } }
    const out = lines('wine', (l) => { if (!/:fixme:/.test(l)) log('wine: ' + l.slice(0, 300)); });
    p.stdout.on('data', out); p.stderr.on('data', out);
    p.on('exit', (c, s) => log('run: ' + prog + ' exited (' + (s || c) + ')'));
}

function first() {
    const a = (process.env.SC_RUN || '').trim();
    if (a) { const w = a.split(/\s+/); run(w[0], w.slice(1)); }
}

/* ---- commands --------------------------------------------------------------- */
try { fs.unlinkSync(CMD); } catch (e) { /* none */ }
fs.writeFileSync(CMD, '');
let done = 0;
setInterval(() => {
    let all;
    try { all = fs.readFileSync(CMD, 'utf8'); } catch (e) { return; }
    const ls = all.split('\n');
    for (; done < ls.length - 1; done++) {
        const l = ls[done].trim();
        if (!l) continue;
        const m = /^(\S+)\s*(.*)$/.exec(l);
        if (m[1] === 'run') { const w = m[2].match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, '')); run(w[0], w.slice(1)); }
        else if (m[1] === 'sink') { try { sink.stdin.write(m[2] + '\n'); } catch (e) { /* gone */ } }
        else if (m[1] === 'mark') { memLine('mark: ' + m[2]); log('mark: ' + m[2]); }
        /* "freeze PROG.exe" / "thaw PROG.exe" / "kill PROG.exe": SIGSTOP / SIGCONT / SIGKILL by name */
        else if (m[1] === 'freeze' || m[1] === 'thaw' || m[1] === 'kill') {
            const ps = signal(m[2], { freeze: 'SIGSTOP', thaw: 'SIGCONT', kill: 'SIGKILL' }[m[1]]);
            memLine(m[1] + ' ' + m[2] + ': ' + ps.length + ' processes'); log(m[1] + ' ' + m[2] + ': ' + ps.join(' '));
        }
        /* "reclaim MB": the client's cgroup asked to give back that much (to swap) */
        else if (m[1] === 'reclaim') {
            const before = cgMb('memory.current'), t0 = Date.now();
            try { fs.writeFileSync(CLIENT_CG + '/memory.reclaim', m[2] + 'M'); } catch (e) { /* EAGAIN: less than asked */ }
            memLine('reclaim ' + m[2] + ' MB: ' + before + ' -> ' + cgMb('memory.current') + ' MB in RAM, ' + cgMb('memory.swap.current') + ' MB in swap (' + (Date.now() - t0) + ' ms)');
        }
        else log('cmd: unknown "' + l + '"');
    }
}, 300);

/* ---- memory --------------------------------------------------------------- */
function meminfo(k) {
    const m = new RegExp('^' + k + ':\\s+(\\d+)', 'm').exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    return m ? Number(m[1]) : 0;
}
function name(pid) {
    let c = '';
    try { c = fs.readFileSync('/proc/' + pid + '/cmdline', 'latin1').split('\0').filter(Boolean); } catch (e) { return null; }
    /* Wine's processes: the Windows program (argv[0] is its path), the rest by their file */
    const a = c[0] || '';
    return (a.split(/[\\/]/).pop() || a).slice(0, 40);
}
const base = meminfo('MemAvailable');
fs.writeFileSync(MEM_LOG, '');
memLine('start: MemAvailable ' + Math.round(base / 1024) + ' MB');
setInterval(() => {
    const by = {};
    let pss = 0, rss = 0, n = 0;
    fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)).forEach((pid) => {
        let st, sm;
        try { st = fs.readFileSync('/proc/' + pid + '/status', 'utf8'); } catch (e) { return; }
        const u = /^Uid:\s+(\d+)/m.exec(st);
        if (!u || Number(u[1]) !== UID) return;
        try { sm = fs.readFileSync('/proc/' + pid + '/smaps_rollup', 'utf8'); } catch (e) { return; }
        const P = Number((/^Pss:\s+(\d+)/m.exec(sm) || [0, 0])[1]), R = Number((/^Rss:\s+(\d+)/m.exec(sm) || [0, 0])[1]);
        const k = name(pid) || pid;
        by[k] = by[k] || { n: 0, pss: 0, rss: 0 };
        by[k].n++; by[k].pss += P; by[k].rss += R;
        pss += P; rss += R; n++;
    });
    if (!n) return;
    const mb = (k) => Math.round(k / 1024);
    const top = Object.keys(by).sort((a, b) => by[b].pss - by[a].pss)
        .map((k) => k + (by[k].n > 1 ? ' x' + by[k].n : '') + ' ' + mb(by[k].pss));
    memLine('total PSS ' + mb(pss) + ' MB (RSS ' + mb(rss) + ') over ' + n + ' processes; MemAvailable -' + mb(base - meminfo('MemAvailable')) + ' MB' +
        (cgroup ? '; cgroup ' + cgMb('memory.current') + ' MB in RAM, ' + cgMb('memory.swap.current') + ' MB swapped' : '') + '; ' + top.join(', '));
}, 10000);

['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, () => { try { sink.kill('SIGTERM'); } catch (e) { /* gone */ } process.exit(0); }));
log('steam_client: ' + W + 'x' + H + ', prefix ' + env.PREFIX);
