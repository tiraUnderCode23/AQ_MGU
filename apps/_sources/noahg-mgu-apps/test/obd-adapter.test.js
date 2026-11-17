'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { validate } = require('../tools/validate');
const { exportUsb } = require('../tools/export-usb');
const { pack, matches } = require('../native/hu-obd-adapter/tasu-worker');
const lease = require('../kit/runtime/diag-lease');

function toolFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hu-obd-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'native', 'test', 'prebuilt');
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.join(root, 'apps'));
  const binary = Buffer.from('synthetic service fixture');
  fs.writeFileSync(path.join(dir, 'service'), binary);
  fs.writeFileSync(path.join(dir, 'test.service'), '[Service]\nExecStart=/var/opt/test/current/service\n');
  const component = { id: 'test', kind: 'tool', version: '0.1.0', title: 'Test', mguHmi: ['ID7'],
    files: [{ path: 'service', mode: '0755', sha256: crypto.createHash('sha256').update(binary).digest('hex') }],
    units: [{ name: 'test.service' }], enable: [{ unit: 'test.service', target: 'oapcontroller.service' }],
    restart: ['test.service'], recmgr: ['test'] };
  fs.writeFileSync(path.join(dir, 'component.json'), JSON.stringify(component));
  fs.writeFileSync(path.join(root, 'mgu-repo.json'), JSON.stringify({ schema: 1, components: [{ id: 'test', kind: 'tool', path: 'native/test/prebuilt' }] }));
  return { root, dir, component };
}

test('Store companion tool and USB source retain the unit and hashed program', t => {
  const f = toolFixture(t);
  assert.deepEqual(validate(f.root), { count: 1 });
  const output = exportUsb(f.root, path.join(f.root, 'dist'));
  const catalog = JSON.parse(fs.readFileSync(path.join(output.source, 'catalog.json')));
  const artifact = catalog.components[0].artifact;
  assert.equal(artifact.url, 'tools/test@0.1.0.tgz');
  const bytes = fs.readFileSync(path.join(output.source, artifact.url));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
  const tar = zlib.gunzipSync(bytes);
  const members = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString(), 8);
    members.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.deepEqual([...members.keys()].sort(), ['component.json', 'files/service', 'units/test.service']);
  assert.deepEqual(members.get('files/service'), fs.readFileSync(path.join(f.dir, 'service')));
  assert.deepEqual(members.get('units/test.service'), fs.readFileSync(path.join(f.dir, 'test.service')));
  const manifest = JSON.parse(members.get('component.json'));
  assert.deepEqual(manifest.units, [{ name: 'test.service' }]);
  assert.equal(manifest.sourceSha256, undefined);
  assert.equal(fs.existsSync(path.join(output.source, 'native')), false);
});

test('altered tool binary is rejected until rebuilt', t => {
  const f = toolFixture(t);
  fs.appendFileSync(path.join(f.dir, 'service'), 'tampered');
  assert.throws(() => validate(f.root), /hash mismatch/);
});

test('tool paths cannot escape their source folder', t => {
  const f = toolFixture(t);
  f.component.files[0].from = '../../../package.json';
  fs.writeFileSync(path.join(f.dir, 'component.json'), JSON.stringify(f.component));
  assert.throws(() => validate(f.root), /Unsafe relative path/);
});

test('tool enablement cannot name an unmanaged unit', t => {
  const f = toolFixture(t);
  f.component.enable[0].unit = 'unrelated.service';
  fs.writeFileSync(path.join(f.dir, 'component.json'), JSON.stringify(f.component));
  assert.throws(() => validate(f.root), /enable tool/);
});

test('TASU reply matching separates pending errors, DIDs and services', () => {
  assert.equal(matches([0x62, 0xf1, 0x90, 1], [0x22, 0xf1, 0x90]), true);
  assert.equal(matches([0x62, 0xf1, 0x95, 1], [0x22, 0xf1, 0x90]), false);
  assert.equal(matches([0x7f, 0x22, 0x78], [0x22, 0xf1, 0x90]), true);
  assert.equal(matches([0x7f, 0x19, 0x78], [0x22, 0xf1, 0x90]), false);
  assert.equal(matches([0x59, 2, 0], [0x19, 2]), true);
  assert.equal(matches([0x59, 4, 0], [0x19, 2]), false);
  assert.equal(matches([0x41, 0x0c, 1, 2], [0x01, 0x0c]), true);
  assert.equal(matches([0x41, 0x0d, 1], [0x01, 0x0c]), false);
  assert.equal(pack(2, Buffer.from([0xf4, 0x12, 0x22])).toString('hex'), '000000030002f41222');
});

test('cooperating HU diagnostic apps yield to an active wireless TASU lease', () => {
  assert.throws(() => lease.check(() => '{"expiresAt":6000}', 2000), /owned by OBD Bridge/);
  assert.doesNotThrow(() => lease.check(() => '{"expiresAt":1000}', 2000));
  assert.doesNotThrow(() => lease.check(() => '{"expiresAt":99999999}', 2000));
  assert.doesNotThrow(() => lease.check(() => 'invalid', 2000));
  assert.doesNotThrow(() => lease.check(() => { throw new Error('missing'); }, 2000));
  assert.doesNotThrow(() => lease.check(() => '{"expiresAt":6000,"coordinated":true}', 2000));
});

test('installed service is tied to OAP lifecycle without a network management port', () => {
  const component = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../native/hu-obd-adapter/prebuilt/component.json')));
  const unit = fs.readFileSync(path.resolve(__dirname, '../native/hu-obd-adapter/prebuilt/units/mgu-obd-adapter.service'), 'utf8');
  assert.equal(component.optional, true);
  assert.equal(component.uninstallable, true);
  assert.match(unit, /^BindsTo=oapcontroller\.service$/m);
  assert.match(unit, /^PartOf=oapcontroller\.service$/m);
  assert.match(unit, /^WantedBy=oapcontroller\.service$/m);
  assert.match(unit, /^RuntimeDirectory=mgu-obd-adapter$/m);
  assert.match(unit, /^ExecStopPost=\/var\/opt\/mgu-obd-adapter\/current\/hu-obd-adapter --cleanup-firewall$/m);
  assert.match(unit, /^TimeoutStopSec=15s$/m);
  assert.match(unit, /^TimeoutStartSec=15s$/m);
  assert.match(unit, /^KillMode=control-group$/m);
  assert.match(unit, /^SendSIGKILL=yes$/m);
  assert.match(unit, /^NoNewPrivileges=yes$/m);
});
