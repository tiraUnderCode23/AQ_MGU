'use strict';
/**
 * Gets a checkout ready to emulate and build (safe to run again):
 *
 *   1. patches/idrive7-apps/*.patch applied to the kit in vendor/idrive7-apps (the emulator on Windows,
 *      its diagnostics hook: the same patch as ECU Live Data's)
 *   2. app/ linked into the kit as apps/dpf_id7 (a junction on Windows), where its build and emulator
 *      look for apps
 *   3. an SDK placeholder in vendor/idrive7-apps/oap-sdk when there is no SDK: build.py stages every app
 *      with BMW's SDK, which isn't in git; the emulator never loads it. Car builds refuse the placeholder
 *      (tools/build-car.js): copy or extract the real SDK from your own head unit
 *
 *   node tools/setup.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');          // the collection: vendor/ and patches/ are shared by every app
const KIT = path.join(REPO, 'vendor', 'idrive7-apps');
const APP_ID = 'dpf_id7';
const APP_LINK = path.join(KIT, 'apps', APP_ID);
const SDK = path.join(KIT, 'oap-sdk');
const PLACEHOLDER_VERSION = '0.0.0-emulator-placeholder';

const step = (s) => console.log('setup: ' + s);
const git = (args, cwd) => execFileSync('git', args, { cwd: cwd || ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function patches() {
    const dir = path.join(REPO, 'patches', 'idrive7-apps');
    for (const p of fs.readdirSync(dir).filter((f) => f.endsWith('.patch')).sort()) {
        const file = path.join(dir, p);
        try { git(['apply', '--reverse', '--check', file], KIT); continue; } catch (e) { /* not applied yet */ }
        try { git(['apply', '--check', file], KIT); } catch (e) {
            throw new Error(p + ' does not apply to vendor/idrive7-apps:\n' + String(e.stderr || e.message));
        }
        git(['apply', file], KIT);
        step('applied ' + p);
    }
}

function linkApp() {
    const target = path.join(ROOT, 'app');
    let st = null;
    try { st = fs.lstatSync(APP_LINK); } catch (e) { /* none */ }
    if (st) {
        if (st.isSymbolicLink() && path.resolve(path.dirname(APP_LINK), fs.readlinkSync(APP_LINK)) === target) return;
        throw new Error(path.relative(ROOT, APP_LINK) + ' exists and is not a link to app/: move it away and run setup again');
    }
    fs.mkdirSync(path.dirname(APP_LINK), { recursive: true });
    fs.symlinkSync(target, APP_LINK, process.platform === 'win32' ? 'junction' : 'dir');
    step('linked app/ as vendor/idrive7-apps/apps/' + APP_ID);
}

function sdkPlaceholder() {
    if (fs.existsSync(path.join(SDK, 'index.js'))) return;
    fs.mkdirSync(SDK, { recursive: true });
    fs.writeFileSync(path.join(SDK, 'package.json'), JSON.stringify({
        name: 'oap-sdk', version: PLACEHOLDER_VERSION,
        description: "NOT BMW's SDK: an empty stand-in so build.py can stage apps for the emulator. Car builds need the real SDK from your own head unit.",
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(SDK, 'index.js'), "'use strict';\n// NOT BMW's SDK: an empty stand-in so build.py can stage apps for the emulator (hu-stub.js never loads it).\n" +
        "throw new Error('oap-sdk emulator placeholder: use the real SDK from your own head unit');\n");
    step('no SDK found: wrote the emulator placeholder (vendor/idrive7-apps/oap-sdk)');
}

function sdkIsPlaceholder() {
    try { return JSON.parse(fs.readFileSync(path.join(SDK, 'package.json'), 'utf8')).version === PLACEHOLDER_VERSION; } catch (e) { return true; }
}

function setup() {
    patches();
    linkApp();
    sdkPlaceholder();
}

module.exports = { setup, sdkIsPlaceholder, ROOT, KIT, APP_ID };

if (require.main === module) {
    try { setup(); step('ready'); } catch (e) { console.error('setup: ' + e.message); process.exit(1); }
}
