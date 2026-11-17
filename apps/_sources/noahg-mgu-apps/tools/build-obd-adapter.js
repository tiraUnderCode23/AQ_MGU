'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { sourceHash } = require('./native-source-hash');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'native', 'hu-obd-adapter');
const output = path.join(dir, 'prebuilt', 'hu-obd-adapter');
const env = { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0', GOTOOLCHAIN: 'local' };
const result = spawnSync('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid=', '-o', output, '.'], { cwd: dir, env, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const manifest = path.join(dir, 'prebuilt', 'component.json');
const component = JSON.parse(fs.readFileSync(manifest));
for (const file of component.files) {
  file.sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'prebuilt', file.from || file.path))).digest('hex');
}
component.sourceSha256 = sourceHash(dir);
fs.writeFileSync(manifest, JSON.stringify(component, null, 2) + '\n');
console.log('Built Linux amd64 HU OBD service ' + component.version);
