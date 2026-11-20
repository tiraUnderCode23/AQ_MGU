'use strict';
/**
 * The live emulator with a DME behind the head unit (no car, no BMW SDK):
 *
 *   node tools/emu.js [--port 8077] [--no-touch] [--obd-only]   ->  http://localhost:8077
 *
 * Runs the kit's emulator (vendor/idrive7-apps kit/tools/emu.js) on the app, with emu/fakeDme.ts
 * answering its diagnostic requests (--diag), and tools/bundle.js --watch beside it: a save in
 * core/, vendor/boostline or app/ rebuilds the bundle, and the emulator rebuilds and restarts the app.
 *
 * The fake DME's data pack (invented DIDs) goes into the emulator's data folder as the app's
 * bmw-dme-data.json, so the BMW-data path (curated channels, 2C 01 block reads) runs as with real
 * imported data. --obd-only removes it: the app then reads the standard OBD-II channels only.
 *
 * --diesel [file]: the fake DME answers as a G-series DDE (d83bx7c0: B47 / B57): the diesel pages
 * (Turbo, DPF), the DDE's channel names and its thousands of values, as on the car. The DDE's data is
 * BMW's, so it isn't in this repository: it comes from your own BMW DME data, the bmw-dme-data.json
 * Boostline's desktop app imports (Settings > BMW DME data). Give its path, or set BOOSTLINE_DME_DATA,
 * or put it in this folder as bmw-dme-data.json.
 *   npm run emu:diesel -- <path to your bmw-dme-data.json>
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { setup, ROOT, KIT } = require('./setup');

const args = process.argv.slice(2);
const obdOnly = args.indexOf('--obd-only') >= 0;
const di = args.indexOf('--diesel');
const diesel = di >= 0;
// the file after --diesel, unless it's another option
const dieselFrom = diesel && args[di + 1] && !/^--/.test(args[di + 1]) ? args[di + 1] : null;
const pass = args.filter((a, i) => a !== '--obd-only' && a !== '--diesel' && !(dieselFrom && i === di + 1));
const DDE_SGBD = 'd83bx7c0';

/** The DDE (d83bx7c0) out of the user's own BMW DME data, as a pack with that one entry. */
function ddePack() {
    const from = [dieselFrom, process.env.BOOSTLINE_DME_DATA, path.join(ROOT, 'bmw-dme-data.json')].filter(Boolean);
    const file = from.find((f) => fs.existsSync(f));
    if (!file) {
        console.error('emu: --diesel needs your BMW DME data (BMW\'s, not in this repository): import it in Boostline\'s desktop app\n' +
            '(Settings > BMW DME data), then give the path of its bmw-dme-data.json:\n' +
            '  npm run emu:diesel -- <path to bmw-dme-data.json>\n' +
            'or set BOOSTLINE_DME_DATA, or copy it here as bmw-dme-data.json.');
        process.exit(1);
    }
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    const dde = (pack.dmes || []).find((d) => d.sgbd === DDE_SGBD);
    if (!dde) { console.error('emu: ' + file + ' has no ' + DDE_SGBD + ' (DDE 8.x): import the full BMW DME data in Boostline'); process.exit(1); }
    console.log('emu: the DDE ' + DDE_SGBD + ' from ' + file);
    return Object.assign({}, pack, { dmes: [dde] });
}

setup();

// the emulator keeps each app's settings and files in preview/emu/<id>/ (its ctx.dataDir)
const dataDir = path.join(KIT, 'preview', 'emu', 'boostline');
fs.mkdirSync(dataDir, { recursive: true });
const pack = path.join(dataDir, 'bmw-dme-data.json');
if (obdOnly) {
    fs.rmSync(pack, { force: true });
} else if (diesel) {
    fs.writeFileSync(pack, JSON.stringify(ddePack()));
} else {
    // (a fresh copy each start: it must match build/fake-dme.js)
    delete require.cache[require.resolve(path.join(ROOT, 'build', 'fake-dme.js'))];
    fs.writeFileSync(pack, JSON.stringify(require(path.join(ROOT, 'build', 'fake-dme.js')).dataPack(), null, 1));
}
console.log('emu: app data (logs, settings) in ' + path.relative(ROOT, dataDir) + (obdOnly ? ' - OBD-II only' : diesel ? ' - diesel (B47 DDE)' : ''));
const env = Object.assign({}, process.env, diesel ? { FAKE_DDE_PACK: pack } : {});

const children = [
    spawn(process.execPath, [path.join(__dirname, 'bundle.js'), '--watch'], { cwd: ROOT, stdio: 'inherit' }),
    spawn(process.execPath, [path.join(KIT, 'kit', 'tools', 'emu.js'), 'boostline', '--diag', path.join(ROOT, 'build', 'fake-dme.js')].concat(pass), { cwd: KIT, stdio: 'inherit', env }),
];
const stop = (code) => { children.forEach((c) => { try { c.kill(); } catch (e) { /* gone */ } }); process.exit(code || 0); };
children.forEach((c) => c.on('exit', (code) => stop(code)));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
