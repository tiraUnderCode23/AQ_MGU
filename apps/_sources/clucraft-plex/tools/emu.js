'use strict';
/**
 * Drive-In in the idrive7-apps kit's live emulator: the app as the head unit runs it, drawn in a browser by the
 * car's draw engine. No car, no BMW software and no Plex account.
 *
 *   node tools/emu.js [--port 8077] [--backend-port 8078] [--kit <an idrive7-apps checkout>] [--no-touch] [--bg shot.png]
 *                                                                                 ->  http://localhost:8077
 *
 * What runs:
 *   the app      apps/clucraft_plex, staged by this repository's kit (kit/, the one the car build uses) and run by
 *                the emulator's stubbed head unit. Saving a file under apps/clucraft_plex/ builds and restarts it.
 *   the service  native/clucraft-plex, the real one, on a local port against a stand-in plex.tv and Plex server
 *                with an invented library (tools/dev-backend.js). "Get a code" is linked at once.
 *   the player   a stand-in (test/fake-player.js): it keeps the film's time and plays nothing. The emulator's
 *                renderer shows no video either, so the player page says it is waiting for the picture.
 *
 * On the page: mouse = touch, the wheel or [ ] turn the controller, Enter presses it, Backspace is BACK. The
 * panel's Manual signals have the speed and the gear selector: the picture's driving gate and the disclaimer
 * follow them (P and 0 km/h is parked).
 *
 * The emulator itself is not in this repository. It is the kit's, from
 * https://github.com/cauliflowermossgrape/idrive7-apps (kit/tools/emu.js, kit/tools/hu-stub.js, kit/emu), fetched
 * once into vendor/idrive7-apps at the commit below, or taken from --kit / IDRIVE7_APPS. This repository's kit is
 * another branch of that kit (kit/UPSTREAM.json), so the two are put together in .cache/emu and the emulator's
 * stubbed head unit is taught three things this kit has (ADAPT below). Nothing in vendor/ is changed.
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP_ID = 'clucraft_plex';
const EMU_URL = process.env.IDRIVE7_APPS_URL || 'https://github.com/cauliflowermossgrape/idrive7-apps';
const EMU_COMMIT = '5555ef3bd2195aae15a8cec6803beeb40ca16456';
const VENDOR = path.join(ROOT, 'vendor', 'idrive7-apps');
const WS = path.join(ROOT, '.cache', 'emu');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const say = (s) => console.log('emu: ' + s);

/** [file, what it is for, the kit's text, ours]: each must be found exactly once (another kit commit: say so) */
const ADAPT = [
    ['kit/tools/hu-stub.js', 'the staged settings and screens (this kit\'s build names them amn-spec.json)',
        "const spec = JSON.parse(fs.readFileSync(path.join(kitDir, 'app-spec.json'), 'utf8'));",
        "const spec = JSON.parse(fs.readFileSync(path.join(kitDir, fs.existsSync(path.join(kitDir, 'app-spec.json')) ? 'app-spec.json' : 'amn-spec.json'), 'utf8'));"],
    ['kit/tools/hu-stub.js', 'the settings sheet\'s log row (this kit has none)',
        "require(path.join(kitDir, 'qrlog')).qrLogSheet,",
        "(() => { try { return require(path.join(kitDir, 'qrlog')).qrLogSheet; } catch (e) { return null; } })(),"],
    ['kit/tools/hu-stub.js', 'ctx.onTouch and ctx.onBack, as this kit\'s mgu.js gives them to an app',
        '        onScroll(fn) { display.onScroll = fn; },',
        '        onScroll(fn) { display.onScroll = fn; },\n        onTouch(fn) { display.onTouch = fn; },\n        onBack(fn) { display.onBack = fn; },'],
    // Windows: a named pipe for the renderer's socket, and Python as "python" (as clucraft/swarm-idrive's patch)
    ['kit/tools/emu.js', 'the renderer socket on Windows',
        "const SOCK = path.join(os.tmpdir(), 'mgu-emu-' + process.pid + '.sock');",
        "const SOCK = process.platform === 'win32' ? '\\\\\\\\.\\\\pipe\\\\mgu-emu-' + process.pid : path.join(os.tmpdir(), 'mgu-emu-' + process.pid + '.sock');"],
    ['kit/tools/emu.js', 'Python on Windows',
        "spawn('python3', [path.join(ROOT, 'kit', 'tools', 'build.py'), id], { cwd: ROOT })",
        "spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [path.join(ROOT, 'kit', 'tools', 'build.py'), id], { cwd: ROOT })"],
    ['kit/runtime/renderd.js', 'the renderer socket on Windows (a named pipe is not a socket file)',
        'const isSocket = (p) => { try { return fs.statSync(p).isSocket(); } catch (e) { return false; } };',
        'const isSocket = (p) => { if (/^\\\\\\\\[.?]\\\\pipe\\\\/.test(p)) return true; try { return fs.statSync(p).isSocket(); } catch (e) { return false; } };'],
];

function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        if (e.name === '__pycache__') continue;
        const a = path.join(from, e.name), b = path.join(to, e.name);
        if (e.isDirectory()) copyDir(a, b); else if (e.isFile()) fs.copyFileSync(a, b);
    }
}
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

/** the idrive7-apps checkout the emulator comes from */
function emulatorKit() {
    const given = opt('--kit', process.env.IDRIVE7_APPS || null);
    const has = (d) => fs.existsSync(path.join(d, 'kit', 'tools', 'emu.js')) && fs.existsSync(path.join(d, 'kit', 'emu', 'web', 'index.html'));
    if (given) {
        const d = path.resolve(given);
        if (!has(d)) throw new Error(d + ' is not an idrive7-apps checkout with the emulator (kit/tools/emu.js, kit/emu/web)');
        return d;
    }
    if (has(VENDOR)) return VENDOR;
    say('fetching the kit\'s emulator once: ' + EMU_URL + ' at ' + EMU_COMMIT.slice(0, 7) + ' -> vendor/idrive7-apps');
    fs.mkdirSync(VENDOR, { recursive: true });
    const git = (a) => execFileSync('git', a, { cwd: VENDOR, stdio: ['ignore', 'inherit', 'inherit'] });
    try {
        git(['init', '-q']);
        git(['fetch', '-q', '--depth', '1', EMU_URL, EMU_COMMIT]);
        git(['checkout', '-q', 'FETCH_HEAD']);
    } catch (e) {
        rm(VENDOR);
        throw new Error('could not fetch it (' + (e.message || e).split('\n')[0] + '). Clone ' + EMU_URL + ' yourself and pass --kit <folder>');
    }
    if (!has(VENDOR)) { rm(VENDOR); throw new Error('that commit has no emulator'); }
    return VENDOR;
}

/** .cache/emu: this repository's kit and app, the emulator beside them (rebuilt on every start; preview/ is kept) */
function workspace(emuKit) {
    for (const d of ['kit', 'apps', 'oap-sdk', 'dist']) rm(path.join(WS, d));
    for (const d of ['runtime', 'platform', 'tools']) copyDir(path.join(ROOT, 'kit', d), path.join(WS, 'kit', d));
    for (const f of ['emu.js', 'hu-stub.js']) fs.copyFileSync(path.join(emuKit, 'kit', 'tools', f), path.join(WS, 'kit', 'tools', f));
    copyDir(path.join(emuKit, 'kit', 'emu'), path.join(WS, 'kit', 'emu'));
    for (const [file, what, from, to] of ADAPT) {
        const p = path.join(WS, file), s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
        if (s.split(from).length !== 2) throw new Error(file + ' is not as expected (' + what + '): another commit of the kit? This was made for ' + EMU_COMMIT.slice(0, 7));
        fs.writeFileSync(p, s.replace(from, () => to));
    }
    fs.mkdirSync(path.join(WS, 'apps'), { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'apps', APP_ID), path.join(WS, 'apps', APP_ID), process.platform === 'win32' ? 'junction' : 'dir');
    // the kit's build stages every app with BMW's SDK; the emulator never loads it
    fs.mkdirSync(path.join(WS, 'oap-sdk'), { recursive: true });
    fs.writeFileSync(path.join(WS, 'oap-sdk', 'package.json'), JSON.stringify({
        name: 'oap-sdk', version: '0.0.0-emulator-placeholder',
        description: "NOT BMW's SDK: an empty stand-in so the kit's build can stage the app for the emulator.",
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(WS, 'oap-sdk', 'index.js'), "'use strict';\n// NOT BMW's SDK: an empty stand-in for the emulator (which never loads it).\nthrow new Error('oap-sdk emulator placeholder');\n");
}

function main() {
    const port = opt('--port', '8077'), backendPort = opt('--backend-port', '8078');
    const emuKit = emulatorKit();
    workspace(emuKit);
    say('the emulator from ' + path.relative(ROOT, emuKit) + ', put together in .cache/emu (settings: .cache/emu/preview/emu/' + APP_ID + ')');
    const kids = [];
    const stop = (code) => { kids.forEach((k) => { try { k.kill(); } catch (e) { /* gone */ } }); setTimeout(() => process.exit(code || 0), 400); };
    const backend = spawn(process.execPath, [path.join(__dirname, 'dev-backend.js'), backendPort], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    kids.push(backend);
    let started = false;
    backend.stdout.on('data', (d) => {
        process.stdout.write(d);
        if (started || !/dev-backend: the Drive-In service/.test(String(d))) return;
        started = true;
        const emu = spawn(process.execPath, [path.join(WS, 'kit', 'tools', 'emu.js'), APP_ID, '--port', port].concat(args),
            { cwd: WS, stdio: 'inherit', env: Object.assign({}, process.env, { PLEXD_SOCK: backendPort }) });
        kids.push(emu);
        emu.on('exit', (code) => stop(code));
    });
    backend.on('exit', (code) => { if (!started) { console.error('emu: the service did not start'); stop(code || 1); } });
    process.on('SIGINT', () => stop(0));
    process.on('SIGTERM', () => stop(0));
}

if (require.main === module) {
    try { main(); } catch (e) { console.error('emu: ' + e.message); process.exit(1); }
}

module.exports = { ADAPT, EMU_COMMIT, EMU_URL, workspace, WS, APP_ID };
