// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/* Steam's own client (src/client.js), what can be checked without it:
 * DepotDownloader's manifests read from a game's folder (the newest per
 * depot, Steamworks' shared depots left out); the appmanifest written from
 * them, read back, kept once the client has its own, written again when
 * DepotDownloader installs a newer build; the game linked into the
 * client's library; the bundle's root certificates as Wine keeps them in
 * system.reg (each once, the existing ones left); the remembered account;
 * the client's environment and arguments. Node 8.   node test/client_test.js */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const client = require('../src/client.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'client-'));
const prefix = path.join(tmp, 'prefix'), cdir = client.dirOf(prefix);
const uid = process.getuid ? process.getuid() : 0, gid = process.getgid ? process.getgid() : 0;
function mkdirp(d) { d.split(path.sep).reduce((a, p) => { const x = a ? path.join(a, p) : p || path.sep; if (x && !fs.existsSync(x)) fs.mkdirSync(x); return x; }, ''); }
function rmrf(p) { if (!fs.existsSync(p) && !isLink(p)) return; if (!isLink(p) && fs.statSync(p).isDirectory()) { fs.readdirSync(p).forEach((n) => rmrf(path.join(p, n))); fs.rmdirSync(p); } else fs.unlinkSync(p); }
function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch (e) { return false; } }
function touch(f, t) { mkdirp(path.dirname(f)); fs.writeFileSync(f, 'x'); fs.utimesSync(f, t / 1000, t / 1000); }

let fails = 0;
function check(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const game = path.join(tmp, 'games', '10090'), dd = path.join(game, '.DepotDownloader');
const T0 = Date.parse('2026-11-01T00:00:00Z');
touch(path.join(dd, '10091_1111.manifest'), T0);
touch(path.join(dd, '10091_5566849738478017518.manifest'), T0 + 1000);
touch(path.join(dd, '10091_5566849738478017518.manifest.sha'), T0 + 1000);
touch(path.join(dd, '10092_3607600095703252129.manifest'), T0);
touch(path.join(dd, '228990_1829726630299308803.manifest'), T0);
touch(path.join(game, 'CoDWaW.exe'), T0);

check('DepotDownloader\'s manifests: the newest per depot, no shared depots', () => {
    assert.deepStrictEqual(client.depotManifests(game), { 10091: '5566849738478017518', 10092: '3607600095703252129' });
    assert.deepStrictEqual(client.depotManifests(path.join(tmp, 'nowhere')), {});
});

check('the appmanifest: installed, its depots, read back', () => {
    const t = client.acf(10090, 'Call of Duty: World at War', 'vzs-10090', client.depotManifests(game));
    assert.ok(/"StateFlags"\t\t"4"/.test(t) && /"installdir"\t\t"vzs-10090"/.test(t), t);
    assert.deepStrictEqual(client.acfDepots(t), { 10091: '5566849738478017518', 10092: '3607600095703252129' });
    assert.ok(/"StateFlags"\t\t"1026"/.test(client.acf(5, 'x', 'vzs-5', {})), 'none: an update (the client downloads it)');
    /* the client's own, with SharedDepots after the block: only InstalledDepots read */
    const steams = '"AppState"\n{\n\t"appid"\t\t"204360"\n\t"InstalledDepots"\n\t{\n\t\t"204361"\n\t\t{\n\t\t\t"manifest"\t\t"3901319341942020487"\n\t\t\t"size"\t\t"125194873"\n\t\t}\n\t}\n\t"SharedDepots"\n\t{\n\t\t"228990"\t\t"228980"\n\t}\n}\n';
    assert.deepStrictEqual(client.acfDepots(steams), { 204361: '3901319341942020487' });
});

check('register: linked into the library, the appmanifest written, then kept', () => {
    mkdirp(cdir);   /* the client installed */
    assert.strictEqual(client.register(prefix, 10090, 'Call of Duty: World at War', game, uid, gid), 'registered');
    const link = path.join(cdir, 'steamapps', 'common', 'vzs-10090'), f = path.join(cdir, 'steamapps', 'appmanifest_10090.acf');
    assert.strictEqual(fs.readlinkSync(link), game);
    assert.deepStrictEqual(client.acfDepots(fs.readFileSync(f, 'utf8')), { 10091: '5566849738478017518', 10092: '3607600095703252129' });
    assert.strictEqual(client.register(prefix, 10090, 'Call of Duty: World at War', game, uid, gid), 'kept');
    /* the client's own after its update (another manifest, newer than DepotDownloader's): kept */
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('3607600095703252129', '999').replace('"buildid"\t\t"0"', '"buildid"\t\t"24095717"'));
    fs.utimesSync(dd, T0 / 1000, T0 / 1000);
    assert.strictEqual(client.register(prefix, 10090, 'Call of Duty: World at War', game, uid, gid), 'kept');
    assert.ok(/"999"/.test(fs.readFileSync(f, 'utf8')));
    /* DepotDownloader installed a newer build since: written again from its manifests */
    touch(path.join(dd, '10092_4444.manifest'), Date.now() + 60000);
    fs.utimesSync(dd, (Date.now() + 60000) / 1000, (Date.now() + 60000) / 1000);
    assert.strictEqual(client.register(prefix, 10090, 'Call of Duty: World at War', game, uid, gid), 'registered');
    assert.strictEqual(client.acfDepots(fs.readFileSync(f, 'utf8'))[10092], '4444');
    /* the game moved (a USB stick, say): linked again */
    const moved = path.join(tmp, 'usb', '10090');
    mkdirp(moved);
    client.register(prefix, 10090, 'Call of Duty: World at War', moved, uid, gid);
    assert.strictEqual(fs.readlinkSync(link), moved);
});

/* a self-signed certificate made here (openssl where there is one), else a fixed DER */
function aCert() {
    const der = Buffer.from('3082010a0201', 'hex');
    return Buffer.concat([der, crypto.randomBytes(200)]);
}
check('root certificates: as Wine keeps them, each once, the rest left', () => {
    const certs = [aCert(), aCert()];
    const pem = certs.map((d) => '-----BEGIN CERTIFICATE-----\n' + d.toString('base64').replace(/(.{64})/g, '$1\n') + '\n-----END CERTIFICATE-----\n').join('');
    assert.strictEqual(client.pemCerts(pem).length, 2);
    assert.ok(client.pemCerts(pem)[0].equals(certs[0]));
    const bundle = path.join(tmp, 'ca.crt');
    fs.writeFileSync(bundle, pem);
    const reg = path.join(prefix, 'pfx', 'system.reg');
    mkdirp(path.dirname(reg));
    const first = client.rootEntry(certs[0], 1);
    fs.writeFileSync(reg, 'WINE REGISTRY Version 2\n;; All keys relative to \\\\Machine\n\n[Software\\\\Wine] 1\n"x"="y"\n\n' + first.text);
    assert.strictEqual(client.importRoots(prefix, bundle), 1, 'only the one not there');
    assert.strictEqual(client.importRoots(prefix, bundle), 0, 'none twice');
    const text = fs.readFileSync(reg, 'latin1');
    assert.ok(text.indexOf('[Software\\\\Wine] 1\n"x"="y"') > 0, 'the rest left');
    /* the entry: the key by the SHA-1, the Blob's two properties, as Wine writes them */
    const e = client.rootEntry(certs[1], 7), sha = crypto.createHash('sha1').update(certs[1]).digest('hex').toUpperCase();
    assert.ok(e.text.indexOf('[Software\\\\Microsoft\\\\SystemCertificates\\\\Root\\\\Certificates\\\\' + sha + '] 7\n"Blob"=hex:03,00,00,00,01,00,00,00,14,00,00,00,') === 0, e.text.slice(0, 160));
    const hex = e.text.slice(e.text.indexOf('hex:') + 4).replace(/,\\\n {2}/g, ',').trim().split(',').map((h) => parseInt(h, 16));
    const blob = Buffer.from(hex);
    assert.strictEqual(blob.readUInt32LE(32), 32);
    assert.strictEqual(blob.readUInt32LE(40), certs[1].length);
    assert.ok(blob.slice(44).equals(certs[1]));
    assert.ok(text.indexOf(sha) > 0);
});

check('the account the client signs in with again', () => {
    assert.strictEqual(client.account(prefix), null);
    const f = path.join(cdir, 'config', 'loginusers.vdf');
    mkdirp(path.dirname(f));
    fs.writeFileSync(f, '"users"\n{\n\t"76561198000000001"\n\t{\n\t\t"AccountName"\t\t"old"\n\t\t"PersonaName"\t\t"Old"\n\t\t"RememberPassword"\t\t"0"\n\t\t"MostRecent"\t\t"0"\n\t}\n' +
        '\t"76561198063176641"\n\t{\n\t\t"AccountName"\t\t"vzs"\n\t\t"PersonaName"\t\t"Vizualyse"\n\t\t"RememberPassword"\t\t"1"\n\t\t"MostRecent"\t\t"1"\n\t}\n}\n');
    assert.deepStrictEqual(client.account(prefix), { name: 'vzs', persona: 'Vizualyse' });
    const log = path.join(cdir, 'logs', 'connection_log.txt');
    mkdirp(path.dirname(log));
    fs.writeFileSync(log, '[2026-11-16 15:10:36] [Logging On, 4, 7] ...\n');
    const from = client.logSize(prefix);
    assert.strictEqual(client.loggedOnSince(prefix, from), false);
    fs.appendFileSync(log, '[2026-11-16 16:10:39] [Logged On, 4, 7] [U:1:102910913] RecvMsgClientLogOnResponse() : processing complete\n');
    assert.strictEqual(client.loggedOnSince(prefix, from), true);
});

check('the environment and the arguments', () => {
    const e = client.clientEnv({ WINEDLLOVERRIDES: 'steam.exe=b;dotnetfx35.exe=b;xinput1_4=n', SteamAppId: '10090', SteamGameId: '10090', STEAM_COMPAT_APP_ID: '10090', X: '1' });
    assert.strictEqual(e.WINEDLLOVERRIDES, 'dotnetfx35.exe=b;xinput1_4=n');
    assert.strictEqual(e.PROTON_DISABLE_LSTEAMCLIENT, '1');
    assert.ok(!('SteamAppId' in e) && !('SteamGameId' in e) && !('STEAM_COMPAT_APP_ID' in e) && e.X === '1');
    assert.deepStrictEqual(client.playArgs(10090, ['+set', 'r_mode', '3']).slice(-5), ['-applaunch', '10090', '+set', 'r_mode', '3']);
    assert.strictEqual(client.playArgs(1)[0], '-silent');
    assert.ok(client.signInArgs().indexOf('-silent') < 0 && client.signInArgs().indexOf('-no-cef-sandbox') >= 0);
});

check('installed: Steam.exe in C:\\SteamClient', () => {
    assert.strictEqual(client.installed(prefix), false);
    touch(path.join(cdir, 'Steam.exe'), T0);
    assert.strictEqual(client.installed(prefix), true);
});

rmrf(tmp);
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
