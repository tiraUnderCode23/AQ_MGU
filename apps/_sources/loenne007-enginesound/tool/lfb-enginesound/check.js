'use strict';
// Store health check after an install: every sound engine's synth binary runs on this unit (its --info answers).
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const bins = fs.readdirSync(__dirname).filter((f) => /^es-synth-[a-z0-9_]+$/.test(f));
if (!bins.length) { console.error('no es-synth-* binary'); process.exit(1); }
for (const b of bins) {
    try {
        JSON.parse(execFileSync(path.join(__dirname, b), ['--info'], { timeout: 10000 }).toString());
        console.log(b + ' ok');
    } catch (e) {
        console.error(b + ' --info failed: ' + (e && e.message || e));
        process.exit(1);
    }
}
