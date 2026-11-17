'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validate } = require('../tools/validate');

function fixture(t, populated = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mgu-apps-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  fs.mkdirSync(path.join(root, 'apps'));
  const entry = { id: 'test_app', kind: 'app', path: 'apps/test_app', build: 'unit' };
  const repo = { schema: 1, components: populated ? [entry] : [] };
  const base = 'apps/test_app';
  const staged = `${base}/test_app@0.1.0`;
  const app = { schema: 1, id: 'test_app', version: '0.1.0', title: 'Test', mguHmi: ['ID7'],
    tree: 'test_app@0.1.0', modules: ['src/main.js'], sdk: [] };
  write('mgu-repo.json', repo);
  if (populated) {
    write(`${base}/mgu-app.json`, app);
    write(`${base}/src/main.js`, '// Synthetic fixture; no SDK or runtime code.\n');
    write(`${staged}/package.json`, { name: app.id, version: app.version, main: 'javascript/runner.js', mguHmi: ['ID7'] });
    write(`${staged}/rhmiData/application.json`, { application: { name: app.id, version: app.version,
      uiDescriptions: [{ hmi: ['ID7'], applicationFilePath: './uiDescriptions/ID7/application.xml',
        uiDescriptionFilePath: './uiDescriptions/ID7/uiDescription.json' }] } });
    write(`${staged}/rhmiData/uiDescriptions/ID7/application.xml`, '<application/>');
    write(`${staged}/rhmiData/uiDescriptions/ID7/uiDescription.json`, {});
  }
  return { root, write, app, repo, base, staged };
}

test('empty source is valid', t => {
  assert.deepEqual(validate(fixture(t).root), { count: 0 });
});

test('complete synthetic source package passes structural checks', t => {
  assert.deepEqual(validate(fixture(t, true).root), { count: 1 });
});

test('duplicate ids fail', t => {
  const f = fixture(t, true);
  f.repo.components.push(f.repo.components[0]);
  f.write('mgu-repo.json', f.repo);
  assert.throws(() => validate(f.root), /unique/);
});

test('source modules cannot escape the app tree', t => {
  const f = fixture(t, true);
  f.app.modules = ['../../secret.js'];
  f.write(`${f.base}/mgu-app.json`, f.app);
  assert.throws(() => validate(f.root), /Unsafe relative path/);
});

test('missing modules fail', t => {
  const f = fixture(t, true);
  fs.unlinkSync(path.join(f.root, f.base, 'src/main.js'));
  assert.throws(() => validate(f.root), /ENOENT/);
});

test('package versions must match the app manifest', t => {
  const f = fixture(t, true);
  f.write(`${f.staged}/package.json`, { name: f.app.id, version: '0.2.0' });
  assert.throws(() => validate(f.root), /id\/version mismatch/);
});

test('declared HMIs must agree with staged package', t => {
  const f = fixture(t, true);
  f.app.mguHmi = ['ID8'];
  f.write(`${f.base}/mgu-app.json`, f.app);
  assert.throws(() => validate(f.root), /mguHmi mismatch/);
});

test('generated bundles fail even when ignored by git', t => {
  const f = fixture(t, true);
  f.write(`${f.staged}/javascript/app.js`, '// generated');
  assert.throws(() => validate(f.root), /Generated package/);
});

test('SDK directories and unregistered app folders fail', t => {
  const f = fixture(t);
  f.write('oap-sdk/index.js', '// proprietary placeholder');
  assert.throws(() => validate(f.root), /SDK\/donor/);
  fs.rmSync(path.join(f.root, 'oap-sdk'), { recursive: true });
  f.write('apps/unregistered/README.md', 'Unfinished');
  assert.throws(() => validate(f.root), /Unregistered app folder/);
});

function scriptedFixture(t) {
  const f = fixture(t);
  const entry = { id: 'test_app', kind: 'app', path: 'apps/test_app', manifest: 'app.json',
    mguHmi: ['ID7'], build: { python: 'kit/tools/build.py', args: ['{id}'],
      sdk: 'oap-sdk', output: 'dist/{id}@{version}.tgz' } };
  f.repo.components = [entry];
  f.write('mgu-repo.json', f.repo);
  f.app.loggingId = 'TEST';
  f.write(`${f.base}/app.json`, f.app);
  for (const name of ['kit/tools/build.py', 'kit/tools/pack_data.py', 'kit/tools/localize.py',
    'kit/tools/locale-revisions.json', 'kit/tools/oapgen/gen.js', 'kit/platform/permissions.json',
    'kit/runtime/mgu.js', `${f.base}/main.js`, `${f.base}/icon.png`]) f.write(name, 'fixture');
  return { ...f, entry };
}

test('vendored Python kit build is accepted without an SDK in the repo', t => {
  const f = scriptedFixture(t);
  assert.deepEqual(validate(f.root), { count: 1 });
});

test('custom build does not accept arbitrary scripts or network access', t => {
  const f = scriptedFixture(t);
  f.entry.build.network = true;
  f.write('mgu-repo.json', f.repo);
  assert.throws(() => validate(f.root), /vendored Python app kit contract/);
});

test('missing vendored kit files fail', t => {
  const f = scriptedFixture(t);
  fs.unlinkSync(path.join(f.root, 'kit/platform/permissions.json'));
  assert.throws(() => validate(f.root), /ENOENT/);
});

test('ID8 cannot be advertised by the ID7-only kit builder', t => {
  const f = scriptedFixture(t);
  f.app.mguHmi = ['ID8'];
  f.entry.mguHmi = ['ID8'];
  f.write(`${f.base}/app.json`, f.app);
  f.write('mgu-repo.json', f.repo);
  assert.throws(() => validate(f.root), /ID7 resources only/);
});

test('ignored output directories do not invalidate a source checkout', t => {
  const f = scriptedFixture(t);
  f.write('dist/test_app@0.1.0.tgz', 'local output');
  assert.deepEqual(validate(f.root), { count: 1 });
});
