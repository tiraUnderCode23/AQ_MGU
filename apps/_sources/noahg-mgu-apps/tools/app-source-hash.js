'use strict';

// Development-only freshness check; distribution packages need no source tree.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sourceHash(root, dir) {
  const hash = crypto.createHash('sha256');
  function walk(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      if (name === 'prebuilt' || name === '__pycache__' || name.endsWith('.pyc')) continue;
      const file = relative + '/' + name;
      const stat = fs.lstatSync(path.join(root, file));
      if (stat.isSymbolicLink()) throw new Error('Symlink is not allowed: ' + file);
      if (stat.isDirectory()) { walk(file); continue; }
      if (!stat.isFile()) throw new Error('Not a regular file: ' + file);
      let content = fs.readFileSync(path.join(root, file));
      if (/\.(js|json|py|md|txt|xml|tsv|yml|upstream)$/.test(name)) {
        content = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'));
      }
      hash.update(file + '\0');
      hash.update(content);
      hash.update('\0');
    }
  }
  walk(dir);
  walk('kit');
  return hash.digest('hex');
}

module.exports = { sourceHash };
