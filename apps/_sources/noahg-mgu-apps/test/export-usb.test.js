'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportUsb } = require('../tools/export-usb');

test('USB export replaces its Store source and excludes stale or local build material', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mgu-usb-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'repo');
  fs.mkdirSync(path.join(root, 'apps'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mgu-repo.json'), '{"schema":1,"components":[]}');
  fs.writeFileSync(path.join(root, 'dist', 'private-build.tgz'), 'not source');
  fs.mkdirSync(path.join(root, 'node_modules', 'oap-sdk'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'oap-sdk', 'index.js'), 'not source');
  const first = exportUsb(root, temporary);
  fs.writeFileSync(path.join(first.source, 'stale-nav-bridge.tgz'), 'old source contents');
  const second = exportUsb(root, temporary);
  assert.equal(first.source, second.source);
  assert.equal(fs.existsSync(path.join(second.source, 'stale-nav-bridge.tgz')), false);
  assert.ok(first.source.endsWith(path.join('mgu-repo', 'noahg-apps')));
  assert.deepEqual(fs.readdirSync(first.source).sort(), ['.gitattributes', '.gitignore', 'README.md', 'THIRD_PARTY_NOTICES.md', 'apps', 'catalog.json', 'tools']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(first.source, 'catalog.json'))).components, []);
});
