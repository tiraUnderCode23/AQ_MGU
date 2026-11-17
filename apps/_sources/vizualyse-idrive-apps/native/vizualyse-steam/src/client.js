// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/**
 * Steam's own Windows client in the prefix: the "Steam client" setting.
 * Off (the lightweight mode, as ever): a game starts by itself through
 * Proton's steam.exe shim, Run without Steam (gbe_fork) and Remove Steam
 * DRM (steamstub.js) as each game is set. On: a game starts in Valve's
 * client (Steam.exe -silent -applaunch <id>), signed in once with the
 * owner's account (its QR code on the car's screen): the other way to a
 * game with Steam's DRM (Remove Steam DRM takes SteamStub 1 / 2 / 3 off
 * instead; CoD: World at War runs either way), and to a game that wants
 * Steam itself. The bench
 * (test/run_steam_client.sh, 2026-11-16) found what it takes:
 *
 *  - The client in C:\SteamClient (not Proton's C:\Program Files (x86)\Steam),
 *    started straight (no shim, no "steam.exe=b") with
 *    PROTON_DISABLE_LSTEAMCLIENT=1: Proton's loader swaps every
 *    steamclient(64).dll for its bridge to a Linux client otherwise
 *    (clientEnv()), for the client and for the games it starts.
 *  - Public root certificates in the prefix: Wine takes its roots from the
 *    host's /etc/ssl/certs, which on the unit holds only BMW's, so every
 *    HTTPS through Windows' TLS failed ("http error 0"). The runtime's bundle
 *    written into the prefix's registry Root store (importRoots(), Wine
 *    keeps them: it never prunes that store).
 *  - A game must be in the client's library to start: started from its
 *    folder, the DRM stub hands it to Steam, which offers to install it, and
 *    exits 53. register(): steamapps/common/vzs-<id> a link to the game's
 *    folder, and an appmanifest whose InstalledDepots are DepotDownloader's
 *    manifests (its .DepotDownloader/<depot>_<manifest>.manifest), so Steam
 *    takes the game as installed and up to date: written without them, it
 *    downloaded all of CoD's 7 GB again.
 *  - Its web UI (steamwebhelper, Chromium) is most of its memory (1.9 GB
 *    signed in): frozen (SIGSTOP) once the game runs, it is left alone and
 *    its pages go to swap under the cgroup's cap (freeze()).
 *  - Steam restarts itself after an update: the process we started exits
 *    while the client goes on (alive()).
 *
 * All of the client's files are Valve's, downloaded from Valve
 * (SteamSetup.exe, then the client's own update) through the phone, as the
 * tool's uid; the account's sign-in stays the client's (config/, the
 * prefix's registry).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const WIN_DIR = 'C:\\SteamClient';
const EXE = 'Steam.exe';
const INSTALLER_URL = 'https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe';
const MAX_INSTALLER = 16 * 1024 * 1024;
/* the client's switches: its web UI drawn by the CPU (our GPU path is for games),
 * Chromium's sandbox off (it doesn't work under Wine) */
const BASE_ARGS = ['-no-cef-sandbox', '-cef-disable-gpu', '-cef-disable-gpu-compositing'];
/* Steamworks Common Redistributables' depots: installed by the client into its
 * own "Steamworks Shared" app, never a game's own */
const SHARED_DEPOTS = [228980, 229010];

function dirOf(prefix) { return path.join(prefix, 'pfx', 'drive_c', 'SteamClient'); }
/* the client's program as it is on the disk: the installer writes Steam.exe, the
 * client's first update steam.exe (Wine doesn't mind; the path we start does) */
function exeOf(prefix) {
    try { return fs.readdirSync(dirOf(prefix)).filter((n) => n.toLowerCase() === 'steam.exe')[0] || null; } catch (e) { return null; }
}
function installed(prefix) { return !!exeOf(prefix); }

/* ---- the environment ---------------------------------------------------------- */

/* Wine's environment for the client (from env.wineEnv's for a game): no shim
 * override, no lsteamclient, no app id of ours (the client sets the game's) */
function clientEnv(e) {
    const out = Object.assign({}, e);
    out.WINEDLLOVERRIDES = String(out.WINEDLLOVERRIDES || '').split(';').filter((o) => o && !/^steam\.exe=/i.test(o)).join(';');
    out.PROTON_DISABLE_LSTEAMCLIENT = '1';
    ['SteamGameId', 'SteamAppId', 'STEAM_COMPAT_APP_ID'].forEach((k) => { delete out[k]; });
    return out;
}

/* Steam.exe's arguments: a game (its own options after the app id), or the sign-in */
function playArgs(appId, gameArgs) { return ['-silent'].concat(BASE_ARGS, ['-applaunch', String(appId)], gameArgs || []); }
function signInArgs() { return BASE_ARGS.slice(); }

/* ---- the account --------------------------------------------------------------- */

/* the signed-in account the client will sign in with again: config/loginusers.vdf's
 * entry with RememberPassword 1 (the newest), { name, persona } or null */
function account(prefix) {
    let t;
    try { t = fs.readFileSync(path.join(dirOf(prefix), 'config', 'loginusers.vdf'), 'utf8'); } catch (e) { return null; }
    const users = [];
    const re = /"(\d{17})"\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(t))) {
        const f = {};
        m[2].replace(/"([^"]+)"\s+"([^"]*)"/g, (all, k, v) => { f[k] = v; return all; });
        users.push(f);
    }
    const ok = users.filter((u) => u.RememberPassword === '1' && u.AccountName);
    const u = ok.filter((x) => x.MostRecent === '1')[0] || ok[0];
    return u ? { name: u.AccountName, persona: u.PersonaName || u.AccountName } : null;
}

/* A value set in one key of a Wine registry file (user.reg, system.reg), the
 * key made when missing; value: the file's own text for it ("text" quoted,
 * dword:00000001). Only while no Wine runs in the prefix. true: changed. */
function regSet(file, key, name, value) {
    const st = fs.statSync(file), lines = fs.readFileSync(file, 'latin1').split('\n');
    const head = '[' + key + ']', line = '"' + name + '"=' + value;
    let at = lines.findIndex((l) => l.indexOf(head + ' ') === 0 || l === head);
    if (at < 0) { lines.push('', head + ' ' + Math.floor(Date.now() / 1000), line); }
    else {
        let i = at + 1;
        for (; i < lines.length && lines[i].trim() !== '' && lines[i][0] !== '['; i++) {
            if (lines[i].indexOf('"' + name + '"=') === 0) {
                if (lines[i] === line) return false;
                lines[i] = line;
                i = -1;
                break;
            }
        }
        if (i >= 0) lines.splice(i, 0, line);
    }
    fs.writeFileSync(file + '.vzs-tmp', lines.join('\n'), { mode: st.mode & 0o777 });
    fs.chownSync(file + '.vzs-tmp', st.uid, st.gid);
    fs.renameSync(file + '.vzs-tmp', file);
    return true;
}

/* The remembered account signed in by itself: Steam's "Remember me" is the
 * account in loginusers.vdf and AutoLoginUser in the registry; an installer
 * run over the client took the second away (the bench, 2026-11-16) and the
 * client asked to sign in again though its token was kept. Put back, before a
 * start (no Wine running). Returns the account's name when it set it. */
function autoLogin(prefix) {
    let a;
    try { a = fs.readFileSync(path.join(dirOf(prefix), 'config', 'loginusers.vdf'), 'utf8'); } catch (e) { return null; }
    const acct = account(prefix);
    if (!acct || !a) return null;
    const changed = regSet(path.join(prefix, 'pfx', 'user.reg'), 'Software\\\\Valve\\\\Steam', 'AutoLoginUser', '"' + acct.name.replace(/["\\]/g, '') + '"');
    regSet(path.join(prefix, 'pfx', 'user.reg'), 'Software\\\\Valve\\\\Steam', 'RememberPassword', 'dword:00000001');
    return changed ? acct.name : null;
}

/* the connection log's size now, and whether "Logged On" was written after it */
function logSize(prefix) { try { return fs.statSync(path.join(dirOf(prefix), 'logs', 'connection_log.txt')).size; } catch (e) { return 0; } }
function loggedOnSince(prefix, from) {
    const f = path.join(dirOf(prefix), 'logs', 'connection_log.txt');
    let fd;
    try {
        const size = fs.statSync(f).size;
        if (size <= from) return false;
        fd = fs.openSync(f, 'r');
        const b = Buffer.alloc(Math.min(size - from, 1024 * 1024));
        fs.readSync(fd, b, 0, b.length, from);
        return /\[Logged On,/.test(b.toString('latin1'));
    } catch (e) { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/* ---- the library ----------------------------------------------------------------- */

/* DepotDownloader's manifests in a game's folder: { depot: manifest } (the newest
 * for each depot; Steamworks' shared depots left out) */
function depotManifests(dir) {
    const d = path.join(dir, '.DepotDownloader'), out = {}, at = {};
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) { return out; }
    names.forEach((n) => {
        const m = /^(\d+)_(\d+)\.manifest$/.exec(n);
        if (!m) return;
        const depot = Number(m[1]);
        if (depot >= SHARED_DEPOTS[0] && depot <= SHARED_DEPOTS[1]) return;
        let t = 0;
        try { t = fs.statSync(path.join(d, n)).mtime.getTime(); } catch (e) { /* 0 */ }
        if (at[depot] === undefined || t > at[depot]) { at[depot] = t; out[depot] = m[2]; }
    });
    return out;
}

/* an appmanifest's InstalledDepots: { depot: manifest } */
function acfDepots(text) {
    const out = {}, i = text.indexOf('"InstalledDepots"'), open = i < 0 ? -1 : text.indexOf('{', i);
    if (open < 0) return out;
    /* the block, to its matching brace */
    let depth = 0, end = text.length;
    for (let k = open; k < text.length; k++) {
        if (text[k] === '{') depth++;
        else if (text[k] === '}' && --depth === 0) { end = k; break; }
    }
    const re = /"(\d+)"\s*\{[^{}]*?"manifest"\s+"(\d+)"/g, block = text.slice(open + 1, end);
    let m;
    while ((m = re.exec(block))) out[m[1]] = m[2];
    return out;
}

function acf(appId, name, installdir, depots) {
    const q = (s) => '"' + String(s).replace(/["\\]/g, '') + '"';
    const lines = ['"AppState"', '{', '\t"appid"\t\t' + q(appId), '\t"Universe"\t\t"1"', '\t"name"\t\t' + q(name),
        '\t"StateFlags"\t\t' + q(Object.keys(depots).length ? 4 : 1026), '\t"installdir"\t\t' + q(installdir), '\t"buildid"\t\t"0"', '\t"InstalledDepots"', '\t{'];
    Object.keys(depots).forEach((d) => { lines.push('\t\t' + q(d), '\t\t{', '\t\t\t"manifest"\t\t' + q(depots[d]), '\t\t}'); });
    lines.push('\t}', '}', '');
    return lines.join('\n');
}

/* The game in the client's library: its folder linked in, and an appmanifest
 * (written again only when DepotDownloader has a newer install than the one
 * it names: the client's own after its updates is kept). Returns what it did. */
function register(prefix, appId, name, gameDir, uid, gid) {
    const apps = path.join(dirOf(prefix), 'steamapps'), common = path.join(apps, 'common');
    const installdir = 'vzs-' + appId, link = path.join(common, installdir), f = path.join(apps, 'appmanifest_' + appId + '.acf');
    [apps, common].forEach((d) => { try { fs.mkdirSync(d, 0o755); fs.chownSync(d, uid, gid); } catch (e) { if (e.code !== 'EEXIST') throw e; } });
    let linked = null;
    try { linked = fs.readlinkSync(link); } catch (e) { /* none */ }
    if (linked !== gameDir) {
        try { fs.unlinkSync(link); } catch (e) { /* none */ }
        fs.symlinkSync(gameDir, link);
    }
    const dd = depotManifests(gameDir);
    let old = null, oldAt = 0;
    try { old = fs.readFileSync(f, 'utf8'); oldAt = fs.statSync(f).mtime.getTime(); } catch (e) { /* none */ }
    let ddAt = 0;
    try { ddAt = fs.statSync(path.join(gameDir, '.DepotDownloader')).mtime.getTime(); } catch (e) { /* none */ }
    const same = old && JSON.stringify(acfDepots(old)) === JSON.stringify(dd) && old.indexOf('"' + installdir + '"') >= 0;
    if (old && (same || (old.indexOf('"' + installdir + '"') >= 0 && ddAt <= oldAt))) return linked === gameDir ? 'kept' : 'linked';
    fs.writeFileSync(f + '.tmp', acf(appId, name, installdir, dd), { mode: 0o644 });
    fs.chownSync(f + '.tmp', uid, gid);
    fs.renameSync(f + '.tmp', f);
    return Object.keys(dd).length ? 'registered' : 'registered (no DepotDownloader manifests: the client will download it)';
}

/* ---- the root certificates ------------------------------------------------------------ */

/* PEM certificates (a CA bundle) as DER buffers */
function pemCerts(text) {
    const out = [], re = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;
    let m;
    while ((m = re.exec(text))) out.push(Buffer.from(m[1].replace(/\s+/g, ''), 'base64'));
    return out;
}

/* one Root store entry as Wine keeps it in system.reg: the key named by the
 * SHA-1, a Blob of two properties (3: the SHA-1, 32: the certificate) */
function rootEntry(der, now) {
    const sha = crypto.createHash('sha1').update(der).digest();
    const prop = (id, data) => { const h = Buffer.alloc(12); h.writeUInt32LE(id, 0); h.writeUInt32LE(1, 4); h.writeUInt32LE(data.length, 8); return Buffer.concat([h, data]); };
    const blob = Buffer.concat([prop(3, sha), prop(32, der)]);
    const hex = [];
    for (let i = 0; i < blob.length; i++) hex.push(('0' + blob[i].toString(16)).slice(-2));
    const rows = [];
    for (let i = 0; i < hex.length; i += 24) rows.push(hex.slice(i, i + 24).join(','));
    const key = 'Software\\\\Microsoft\\\\SystemCertificates\\\\Root\\\\Certificates\\\\' + sha.toString('hex').toUpperCase();
    return { key: key, text: '[' + key + '] ' + now + '\n"Blob"=hex:' + rows.join(',\\\n  ') + '\n' };
}

/* Wine's lists of the roots it took from the host (one per registry view, 64
 * and 32-bit): a root on a list that the host no longer has is deleted at the
 * next start (crypt32 rootstore.c, sync_trusted_roots_from_known_locations);
 * with no list at all, every root there is put on it first. */
const IMPORTED = ['Software\\\\Wine\\\\HostImportedCertificates', 'Software\\\\Wow6432Node\\\\Wine\\\\HostImportedCertificates'];

/* The bundle's certificates in the prefix's Root store (system.reg) to stay:
 * those not there added, and none of them on Wine's lists (each list made
 * when missing), so Wine never deletes them for not being on the unit, whose
 * /etc/ssl/certs has only BMW's (it did: 156 roots to 8 on the bench,
 * 2026-11-16). Only while no Wine runs in the prefix (wineserver writes the
 * file back when it ends). Returns how many roots were added. */
function importRoots(prefix, bundle) {
    const reg = path.join(prefix, 'pfx', 'system.reg');
    const text = fs.readFileSync(reg, 'latin1');
    const now = Math.floor(Date.now() / 1000);
    const entries = pemCerts(fs.readFileSync(bundle, 'utf8')).map((d) => rootEntry(d, now));
    const ours = new Set(entries.map((e) => e.key.split('\\\\').pop()));
    let lines = text.split('\n'), changed = false;
    IMPORTED.forEach((key) => {
        const at = lines.findIndex((l) => l.indexOf('[' + key + ']') === 0);
        if (at < 0) { lines.push('', '[' + key + '] ' + now); changed = true; return; }
        for (let i = at + 1; i < lines.length && lines[i].trim() !== '' && lines[i][0] !== '['; i++) {
            const m = /^"([0-9A-F]{40})"=/.exec(lines[i]);
            if (m && ours.has(m[1])) { lines.splice(i, 1); i--; changed = true; }
        }
    });
    const add = entries.filter((e) => text.indexOf('[' + e.key + ']') < 0);
    if (!add.length && !changed) return 0;
    let out = lines.join('\n');
    if (add.length) out += (out.endsWith('\n') ? '' : '\n') + '\n' + add.map((e) => e.text).join('\n');
    const st = fs.statSync(reg);
    fs.writeFileSync(reg + '.vzs-tmp', out, { mode: st.mode & 0o777 });
    fs.chownSync(reg + '.vzs-tmp', st.uid, st.gid);
    fs.renameSync(reg + '.vzs-tmp', reg);
    return add.length;
}

/* ---- the installer ---------------------------------------------------------------- */

/* SteamSetup.exe from Valve, as the tool's uid through the phone's DNS (root
 * has no internet: steam.js storeName's way), to dest; cb(error|null) */
const FETCH = `
const dns = require('dns'), https = require('https'), url = require('url'), fs = require('fs');
const r = new dns.Resolver(); r.setServers([process.argv[2]]);
const lookup = (h, o, cb) => r.resolve4(h, (e, a) => (typeof o === 'function' ? o : cb)(e, a && a[0], 4));
function get(u, hops) {
  const p = url.parse(u);
  https.get({ host: p.hostname, path: p.path, lookup: lookup, timeout: 20000 }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) { res.resume(); return get(url.resolve(u, res.headers.location), hops - 1); }
    if (res.statusCode !== 200) { console.error('HTTP ' + res.statusCode); process.exit(2); }
    const out = fs.createWriteStream(process.argv[3]); let n = 0;
    res.on('data', (d) => { n += d.length; if (n > ${MAX_INSTALLER}) { console.error('too big'); process.exit(3); } });
    res.pipe(out); out.on('finish', () => process.exit(0));
  }).on('error', (e) => { console.error(e.message); process.exit(4); }).on('timeout', function () { this.abort(); });
}
get(process.argv[1], 3);`;
function fetchInstaller(dns, uid, gid, dest, cb) {
    let err = '', done = false;
    const end = (e) => { if (!done) { done = true; cb(e); } };
    let p;
    try { p = spawn(process.execPath, ['-e', FETCH, INSTALLER_URL, dns, dest], { uid: uid, gid: gid, stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { return end(e.message); }
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => end(e.message));
    p.on('exit', (code) => {
        if (code !== 0) return end('the download failed' + (err.trim() ? ': ' + err.trim().slice(0, 200) : ''));
        try {
            const b = Buffer.alloc(2), fd = fs.openSync(dest, 'r');
            fs.readSync(fd, b, 0, 2, 0); fs.closeSync(fd);
            if (b.readUInt16LE(0) !== 0x5a4d) return end('the download is not a Windows program');
        } catch (e) { return end(e.message); }
        end(null);
    });
    setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } }, 5 * 60000);
}

/* ---- the session's processes ---------------------------------------------------------- */

/* the processes of the session: its cgroup's, else the uid's; [{ pid, prog }] (prog: the
 * Windows program's file name, lower case: Wine's argv[0] is its path) */
function procs(cgroupDir, uid) {
    let pids;
    if (cgroupDir) {
        try { pids = fs.readFileSync(path.join(cgroupDir, 'cgroup.procs'), 'utf8').split('\n').filter(Boolean); } catch (e) { pids = null; }
    }
    if (!pids) {
        pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)).filter((p) => {
            try { return Number((/^Uid:\s+(\d+)/m.exec(fs.readFileSync('/proc/' + p + '/status', 'utf8')) || [])[1]) === uid; } catch (e) { return false; }
        });
    }
    const out = [];
    pids.forEach((p) => {
        try {
            const a0 = fs.readFileSync('/proc/' + p + '/cmdline', 'latin1').split('\0')[0];
            out.push({ pid: Number(p), prog: a0.split(/[\\/]/).pop().toLowerCase(), path: a0.toLowerCase() });
        } catch (e) { /* gone */ }
    });
    return out;
}

function alive(cgroupDir, uid) { return procs(cgroupDir, uid).some((p) => p.prog === 'steam.exe'); }
function running(cgroupDir, uid, exe) { const want = path.basename(String(exe).split('\\').join('/')).toLowerCase(); return procs(cgroupDir, uid).some((p) => p.prog === want); }

/* the web UI stopped (SIGSTOP) or let go on (SIGCONT): how many processes */
function signalUi(cgroupDir, uid, sig) {
    const ps = procs(cgroupDir, uid).filter((p) => p.prog === 'steamwebhelper.exe');
    ps.forEach((p) => { try { process.kill(p.pid, sig); } catch (e) { /* gone */ } });
    return ps.length;
}
function freeze(cgroupDir, uid) { return signalUi(cgroupDir, uid, 'SIGSTOP'); }
function thaw(cgroupDir, uid) { return signalUi(cgroupDir, uid, 'SIGCONT'); }

module.exports = {
    WIN_DIR, EXE, INSTALLER_URL, BASE_ARGS, dirOf, exeOf, installed, clientEnv, playArgs, signInArgs, account, regSet, autoLogin, logSize, loggedOnSince,
    depotManifests, acfDepots, acf, register, pemCerts, rootEntry, importRoots, fetchInstaller, procs, alive, running, freeze, thaw,
};
