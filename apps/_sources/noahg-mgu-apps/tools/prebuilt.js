'use strict';

// Checks artifact identity and bytes without reading development sources.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function digest(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function prebuilt(root, dir, id, version) {
  check(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) && dir === 'apps/' + id &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'Invalid prebuilt app identity');
  ['apps', dir, dir + '/prebuilt'].forEach(relative => {
    check(fs.lstatSync(path.join(root, relative)).isDirectory() &&
      !fs.lstatSync(path.join(root, relative)).isSymbolicLink(), 'Invalid prebuilt directory');
  });
  const name = id + '@' + version + '.tgz';
  const file = path.join(root, dir, 'prebuilt', name);
  const metadata = path.join(root, dir, 'prebuilt', 'artifact.json');
  [file, metadata, path.join(root, dir, 'app.json')].forEach(item => {
    const stat = fs.lstatSync(item);
    check(stat.isFile() && !stat.isSymbolicLink(), 'Prebuilt must be a regular file: ' + item);
  });
  const app = JSON.parse(fs.readFileSync(path.join(root, dir, 'app.json'), 'utf8'));
  const artifact = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  check(artifact.schema === 1 && artifact.id === id && artifact.version === version &&
    app.id === id && app.version === version, 'Prebuilt id/version mismatch; rebuild the app');
  check(JSON.stringify(artifact.mguHmi) === JSON.stringify(app.mguHmi), 'Prebuilt HMI mismatch; rebuild the app');
  check(digest(fs.readFileSync(file)) === artifact.sha256, 'Prebuilt package hash mismatch; rebuild the app');
  return file;
}

if (require.main === module) {
  try {
    check(process.argv.length === 5, 'Usage: node tools/prebuilt.js <dir> <id> <version>');
    console.log(prebuilt(path.resolve(__dirname, '..'), process.argv[2], process.argv[3], process.argv[4]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prebuilt, digest };
