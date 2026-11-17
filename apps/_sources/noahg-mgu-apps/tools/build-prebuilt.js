'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validate } = require('./validate');
const { digest } = require('./prebuilt');
const { sourceHash } = require('./app-source-hash');
const { inspectPackage } = require('./package-archive');

function buildPrebuilt(root, ids = [], python = process.env.PYTHON || 'python3') {
  validate(root, { artifacts: false });
  const repo = JSON.parse(fs.readFileSync(path.join(root, 'mgu-repo.json'), 'utf8'));
  const entries = repo.components.filter(entry => entry.kind === 'app' && entry.build && entry.build.node === 'tools/prebuilt.js');
  for (const id of ids) {
    if (!entries.some(entry => entry.id === id)) throw new Error('Unknown prebuilt app: ' + id);
  }
  for (const entry of entries.filter(entry => !ids.length || ids.includes(entry.id))) {
    const app = JSON.parse(fs.readFileSync(path.join(root, entry.path, 'app.json'), 'utf8'));
    const result = spawnSync(python, ['kit/tools/build.py', '--no-sdk', entry.id], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('App build failed: ' + entry.id);
    const file = path.join(root, 'dist', `${entry.id}@${app.version}.tgz`);
    inspectPackage(file, app);
    const dir = path.join(root, entry.path, 'prebuilt');
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(entry.id + '@') && /^.*@\d+\.\d+\.\d+\.tgz$/.test(name) && name !== path.basename(file)) {
        fs.unlinkSync(path.join(dir, name));
      }
    }
    fs.copyFileSync(file, path.join(dir, path.basename(file)));
    const artifact = { schema: 1, id: app.id, version: app.version, mguHmi: app.mguHmi,
      sha256: digest(fs.readFileSync(file)), sourceSha256: sourceHash(root, entry.path) };
    fs.writeFileSync(path.join(dir, 'artifact.json'), JSON.stringify(artifact, null, 2) + '\n');
    console.log('Prepared prebuilt ' + entry.id + '@' + app.version);
  }
  validate(root);
}

if (require.main === module) {
  try {
    buildPrebuilt(path.resolve(__dirname, '..'), process.argv.slice(2));
  } catch (error) {
    console.error('Prebuilt build failed: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildPrebuilt };
