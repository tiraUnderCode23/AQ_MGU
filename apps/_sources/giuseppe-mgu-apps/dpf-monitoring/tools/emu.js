'use strict';
/**
 * The live emulator (no car, no BMW SDK):
 *
 *   node tools/emu.js [--port 8077] [--no-touch]   ->  http://localhost:8077
 *
 * Runs the kit's emulator (the collection's vendor/idrive7-apps kit/tools/emu.js) on DPF Monitoring.
 * Without a DDE to answer, the app shows its demo values (app/demo.js).
 * The app's data (settings, regeneration history) is kept in vendor/idrive7-apps/preview/emu/dpf_id7/.
 */
const path = require('path');
const { spawn } = require('child_process');
const { setup, KIT, APP_ID } = require('./setup');

setup();
const child = spawn(process.execPath, [path.join(KIT, 'kit', 'tools', 'emu.js'), APP_ID].concat(process.argv.slice(2)),
    { cwd: KIT, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code || 0));
process.on('SIGINT', () => { child.kill(); process.exit(0); });
