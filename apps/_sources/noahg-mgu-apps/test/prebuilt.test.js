'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { validate } = require('../tools/validate');
const { exportUsb } = require('../tools/export-usb');
const { exportPublic } = require('../tools/export-public');
const { prebuilt, digest } = require('../tools/prebuilt');
const { sourceHash } = require('../tools/app-source-hash');
const { inspectPackage } = require('../tools/package-archive');

function archive(files) {
  const blocks = [];
  for (const [name, value] of Object.entries(files)) {
    const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    const header = Buffer.alloc(512);
    header.write(name);
    header.write('0000644\0', 100);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mgu-prebuilt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value));
  };
  const dir = 'apps/test_app';
  const app = { id: 'test_app', version: '0.1.0', title: 'Test', loggingId: 'TEST', mguHmi: ['ID7'] };
  const entry = { id: app.id, kind: 'app', path: dir, manifest: 'app.json', mguHmi: app.mguHmi,
    build: { node: 'tools/prebuilt.js', args: ['{dir}', '{id}', '{version}'], output: '{dir}/prebuilt/{id}@{version}.tgz' } };
  write('mgu-repo.json', { schema: 1, components: [entry] });
  write(`${dir}/app.json`, app);
  write('tools/prebuilt.js', fs.readFileSync(path.resolve(__dirname, '../tools/prebuilt.js')));
  for (const name of ['kit/tools/build.py', 'kit/tools/pack_data.py', 'kit/tools/localize.py',
    'kit/tools/locale-revisions.json', 'kit/tools/oapgen/gen.js', 'kit/platform/permissions.json',
    'kit/runtime/mgu.js', `${dir}/main.js`, `${dir}/icon.png`]) write(name, 'fixture\n');
  for (const name of ['kit/LICENSE.upstream', 'kit/runtime/fonts/UFL-Ubuntu.txt', 'kit/runtime/fonts/OFL-NotoSansSC.txt']) {
    write(name, 'license fixture\n');
  }
  const files = {
    'package/package.json': { name: app.id, version: app.version, main: 'javascript/app.js', mguHmi: app.mguHmi },
    'package/javascript/app.js': '// synthetic app\n',
    'package/rhmiData/application.json': { application: { name: app.id, version: app.version,
      uiDescriptions: [{ hmi: ['ID7'], applicationFilePath: './ui.xml', uiDescriptionFilePath: './ui.json' }] } },
    'package/rhmiData/ui.xml': '<application/>',
    'package/rhmiData/ui.json': {}
  };
  const artifact = { schema: 1, id: app.id, version: app.version, mguHmi: app.mguHmi };
  const pack = () => {
    const content = archive(files);
    write(`${dir}/prebuilt/test_app@0.1.0.tgz`, content);
    artifact.sha256 = digest(content);
    artifact.sourceSha256 = sourceHash(root, dir);
    write(`${dir}/prebuilt/artifact.json`, artifact);
  };
  pack();
  return { root, dir, app, files, write, pack, artifact };
}

test('USB catalog carries the checked app without source, kit or build helper', t => {
  const f = fixture(t);
  assert.deepEqual(validate(f.root), { count: 1 });
  const output = exportUsb(f.root, path.join(f.root, 'dist'));
  const catalog = JSON.parse(fs.readFileSync(path.join(output.source, 'catalog.json')));
  const entry = catalog.components[0];
  const file = path.join(output.source, entry.artifact.url);
  assert.equal(entry.build, undefined);
  assert.equal(entry.artifact.url, 'apps/test_app@0.1.0.tgz');
  assert.equal(entry.icon, 'apps/test_app.png');
  assert.equal(digest(fs.readFileSync(file)), entry.artifact.sha256);
  assert.equal(fs.statSync(file).size, entry.artifact.size);
  assert.equal(inspectPackage(file, f.app).name, f.app.id);
  for (const name of [f.dir, 'kit', 'tools/prebuilt.js', 'docs', 'test', 'mgu-repo.json']) {
    assert.equal(fs.existsSync(path.join(output.source, name)), false, name);
  }
});

test('app and shared kit edits require a rebuilt prebuilt', t => {
  const f = fixture(t);
  f.write(`${f.dir}/main.js`, 'changed app\n');
  assert.throws(() => validate(f.root), /source changed/);
  f.pack();
  f.write('kit/runtime/mgu.js', 'changed runtime\n');
  assert.throws(() => validate(f.root), /source changed/);
  assert.throws(() => exportPublic(f.root, path.join(f.root, 'dist')), /source changed/);
});

test('artifact selection needs no kit or app implementation sources', t => {
  const f = fixture(t);
  const kit = path.resolve(f.root, 'kit');
  assert.ok(kit.startsWith(f.root + path.sep));
  fs.rmSync(kit, { recursive: true });
  fs.unlinkSync(path.join(f.root, f.dir, 'main.js'));
  assert.ok(fs.statSync(prebuilt(f.root, f.dir, f.app.id, f.app.version)).isFile());
});

test('public export preserves dependencies and licenses without development files', t => {
  const f = fixture(t);
  const repo = JSON.parse(fs.readFileSync(path.join(f.root, 'mgu-repo.json')));
  repo.components[0].requires = { companion: '1.2.3' };
  f.write('mgu-repo.json', repo);
  f.write('docs/private.md', 'PRIVATE DESIGN NOTE');
  f.write('test/private.test.js', 'PRIVATE TEST FIXTURE');
  f.write('native/private/main.go', 'PRIVATE SERVICE SOURCE');
  f.write('tools/private.js', 'PRIVATE TOOL');
  const result = exportPublic(f.root, path.join(f.root, 'dist'));
  assert.deepEqual(result.catalog.components[0].requires, { companion: '1.2.3' });
  assert.deepEqual(fs.readdirSync(result.output).sort(), [
    '.gitattributes', '.gitignore', 'README.md', 'THIRD_PARTY_NOTICES.md', 'apps', 'catalog.json', 'licenses', 'tools'
  ]);
  assert.deepEqual(fs.readdirSync(path.join(result.output, 'licenses')).sort(), ['OFL-NotoSansSC.txt', 'UFL-Ubuntu.txt', 'kit-MIT.txt']);
  const exported = fs.readFileSync(path.join(result.output, 'apps', 'test_app@0.1.0.tgz'));
  assert.deepEqual(exported, fs.readFileSync(path.join(f.root, f.dir, 'prebuilt', 'test_app@0.1.0.tgz')));
  assert.equal(JSON.stringify(result.catalog).includes('sourceSha256'), false);
});

test('source hashes survive Git line-ending conversion', t => {
  const f = fixture(t);
  f.write(`${f.dir}/main.js`, 'fixture\r\n');
  assert.deepEqual(validate(f.root), { count: 1 });
});

test('changed package bytes fail the artifact hash', t => {
  const f = fixture(t);
  f.write(`${f.dir}/prebuilt/test_app@0.1.0.tgz`, 'changed archive');
  assert.throws(() => validate(f.root), /package hash mismatch/);
});

test('package identity and supported HMI must match the source manifest', t => {
  const f = fixture(t);
  f.files['package/package.json'].version = '0.2.0';
  f.pack();
  assert.throws(() => validate(f.root), /Package id\/version mismatch/);
  f.files['package/package.json'].version = f.app.version;
  f.files['package/package.json'].mguHmi = ['ID8'];
  f.pack();
  assert.throws(() => validate(f.root), /Package HMI mismatch/);
});

test('SDK material and paths outside the package are rejected even with a matching hash', t => {
  const f = fixture(t);
  f.files['package/node_modules/oap-sdk/index.js'] = 'proprietary placeholder';
  f.pack();
  assert.throws(() => validate(f.root), /SDK\/donor/);
  delete f.files['package/node_modules/oap-sdk/index.js'];
  f.files['package/../escape.js'] = 'escape';
  f.pack();
  assert.throws(() => validate(f.root), /Unsafe package path/);
});

test('prebuilt support does not permit unregistered archives in the source tree', t => {
  const f = fixture(t);
  f.write(`${f.dir}/prebuilt/extra.tgz`, 'unexpected');
  assert.throws(() => validate(f.root), /Generated package/);
});

test('an id collision cannot silently install a prebuilt under another identity', t => {
  const f = fixture(t);
  assert.throws(() => prebuilt(f.root, f.dir, 'test_app2', f.app.version), /Invalid prebuilt app identity/);
});

test('raw SOME/IP metadata cannot be mistaken for signal attribute access flags', t => {
  const f = fixture(t);
  f.app.signals = { 'example.Interface': { instances: ['Inst1'], methods: ['send'], broadcasts: ['response'] } };
  f.write(`${f.dir}/app.json`, f.app);
  f.pack();
  assert.throws(() => validate(f.root), /use _instances, _methods and _broadcasts/);
});

test('prebuilt must retain the exact diagnostic instances, methods and broadcasts', t => {
  const f = fixture(t);
  const iface = 'example.Interface';
  f.app.signals = { [iface]: { _instances: 'Inst1', _methods: ['send'], _broadcasts: ['response'] } };
  f.write(`${f.dir}/app.json`, f.app);
  const proxy = { instances: 'Inst1', methods: ['send'], broadcasts: ['response'] };
  f.files['package/manifest.json'] = { proxies: { [iface]: proxy } };
  f.pack();
  assert.deepEqual(validate(f.root), { count: 1 });
  proxy.methods = [];
  f.pack();
  assert.throws(() => validate(f.root), /Package signal methods mismatch/);
});
