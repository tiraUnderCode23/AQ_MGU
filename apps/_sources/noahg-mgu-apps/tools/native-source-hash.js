'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function sourceHash(dir) {
  const hash = crypto.createHash('sha256');
  const files = [];
  function walk(relative = '') {
    for (const name of fs.readdirSync(path.join(dir, relative)).sort()) {
      if (name === 'prebuilt') continue;
      const file = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(path.join(dir, file));
      if (stat.isSymbolicLink()) throw new Error('Symlink is not allowed: ' + file);
      if (stat.isDirectory()) { walk(file); continue; }
      if (name === 'go.mod' || name === 'go.sum' || name.endsWith('.js') ||
          (name.endsWith('.go') && !name.endsWith('_test.go')) ||
          /\.(c|h|ld)$/.test(name)) files.push(file);
    }
  }
  walk();
  for (const file of files.sort()) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    hash.update(file + '\0'); hash.update(content); hash.update('\0');
  }
  return hash.digest('hex');
}
module.exports = { sourceHash };
