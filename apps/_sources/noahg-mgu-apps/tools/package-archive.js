'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function inspectPackage(file, app) {
  const tar = zlib.gunzipSync(fs.readFileSync(file), { maxOutputLength: 128 * 1024 * 1024 });
  const files = new Map();
  let pax = {};
  let ended = false;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) { ended = true; break; }
    const text = (start, size) => header.subarray(start, start + size).toString('utf8').replace(/\0.*$/s, '');
    const checksum = parseInt(text(148, 8).trim(), 8);
    const sum = header.reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 32 : byte), 0);
    check(checksum === sum, 'Invalid package tar checksum');
    const size = parseInt(text(124, 12).trim(), 8);
    check(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length, 'Truncated package tar');
    const content = tar.subarray(offset + 512, offset + 512 + size);
    const type = text(156, 1);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pax = {};
      let at = 0;
      while (at < content.length) {
        const space = content.indexOf(32, at);
        const length = Number(content.subarray(at, space).toString());
        check(space > at && Number.isSafeInteger(length) && length > space - at + 1 && at + length <= content.length,
          'Invalid package PAX record');
        const record = content.subarray(space + 1, at + length - 1).toString('utf8');
        const equals = record.indexOf('=');
        check(equals > 0, 'Invalid package PAX field');
        pax[record.slice(0, equals)] = record.slice(equals + 1);
        at += length;
      }
      check(Object.keys(pax).every(key => ['path', 'mtime', 'atime', 'ctime'].includes(key)), 'Unsupported package PAX field');
      continue;
    }
    const prefix = text(345, 155);
    const name = (pax.path || (prefix ? prefix + '/' : '') + text(0, 100)).replace(/\/$/, '');
    pax = {};
    check(name === 'package' || name.startsWith('package/'), 'Package files must be under package/');
    check(!name.includes('\\') && !name.includes(':') && !name.includes('\0') &&
      name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe package path');
    check(!name.split('/').some(part => ['oap-sdk', 'donors', '__pycache__'].includes(part)), 'SDK/donor material in package');
    check(type === '5' || type === '0' || type === '', 'Package links and special files are not allowed');
    check(!files.has(name), 'Duplicate package path');
    files.set(name, type === '5' ? null : content);
  }
  check(ended, 'Missing package tar terminator');
  const json = name => {
    check(Buffer.isBuffer(files.get(name)), 'Missing package file: ' + name);
    return JSON.parse(files.get(name).toString('utf8'));
  };
  const pkg = json('package/package.json');
  check(pkg.name === app.id && pkg.version === app.version, 'Package id/version mismatch');
  check(JSON.stringify(pkg.mguHmi) === JSON.stringify(app.mguHmi), 'Package HMI mismatch');
  check(typeof pkg.main === 'string' && /^javascript\/[A-Za-z0-9_-]+\.js$/.test(pkg.main) &&
    Buffer.isBuffer(files.get('package/' + pkg.main)), 'Package entry point missing');
  const rhmi = json('package/rhmiData/application.json').application;
  check(rhmi && rhmi.name === app.id && rhmi.version === app.version, 'Package RHMI id/version mismatch');
  check(Array.isArray(rhmi.uiDescriptions) && rhmi.uiDescriptions.length > 0, 'Package RHMI UI missing');
  const supported = new Set();
  for (const ui of rhmi.uiDescriptions) {
    check(Array.isArray(ui.hmi), 'Package RHMI HMI missing');
    ui.hmi.forEach(hmi => supported.add(hmi));
    for (const field of ['applicationFilePath', 'uiDescriptionFilePath']) {
      check(typeof ui[field] === 'string' && Buffer.isBuffer(files.get('package/rhmiData/' + ui[field].replace(/^\.\//, ''))),
        'Package RHMI resource missing');
    }
  }
  check([...supported].sort().join(',') === app.mguHmi.slice().sort().join(','), 'Package RHMI HMI mismatch');
  if (Object.keys(app.signals || {}).length) {
    const manifest = json('package/manifest.json');
    for (const [iface, fields] of Object.entries(app.signals)) {
      const proxy = manifest.proxies && manifest.proxies[iface];
      check(proxy !== undefined, 'Package signal proxy missing: ' + iface);
      if (fields === '*') { check(proxy === '*', 'Package signal wildcard mismatch'); continue; }
      check(proxy && typeof proxy === 'object' && !Array.isArray(proxy), 'Package signal proxy must be an object');
      check(JSON.stringify(proxy.instances) === JSON.stringify(fields._instances === undefined ? '1' : fields._instances),
        'Package signal instances mismatch: ' + iface);
      for (const [key, source] of [['methods', '_methods'], ['broadcasts', '_broadcasts']]) {
        check(JSON.stringify(proxy[key] || []) === JSON.stringify(fields[source] || []), 'Package signal ' + key + ' mismatch: ' + iface);
      }
      const attributes = Object.fromEntries(Object.entries(fields).filter(([key]) => !key.startsWith('_')));
      check(JSON.stringify(proxy.attributes || {}) === JSON.stringify(attributes), 'Package signal attributes mismatch: ' + iface);
    }
  }
  return pkg;
}

module.exports = { inspectPackage };
