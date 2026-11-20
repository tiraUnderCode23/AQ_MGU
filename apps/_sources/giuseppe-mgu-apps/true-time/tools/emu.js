'use strict';
/**
 * The live emulator (no car, no BMW SDK):
 *
 *   node tools/emu.js [--port 8077] [--no-touch]   ->  http://localhost:8077
 *
 * Runs the kit's emulator (vendor/idrive7-apps kit/tools/emu.js) on True Time. In the app's Settings,
 * "Demo drive: Always" plays a drive on a road with hills (speed and the DSC's acceleration from
 * app/sim.js); with the emulator's own signals (its Demo drive / Manual sliders) the road is level.
 * The app's data (settings, runs) is kept in vendor/idrive7-apps/preview/emu/true_time/.
 */
const path = require('path');
const { spawn } = require('child_process');
const { setup, KIT, APP_ID } = require('./setup');

setup();
const child = spawn(process.execPath, [path.join(KIT, 'kit', 'tools', 'emu.js'), APP_ID].concat(process.argv.slice(2)),
    { cwd: KIT, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code || 0));
process.on('SIGINT', () => { child.kill(); process.exit(0); });
