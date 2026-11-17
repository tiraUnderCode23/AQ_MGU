'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { sourceHash } = require('./native-source-hash');
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'native/mgu-fscpatch'), out = path.join(dir, 'prebuilt');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result = spawnSync('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid=', '-o', path.join(out, 'mgu-fscpatch'), '.'], {
    cwd: dir, env: { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0', GOTOOLCHAIN: 'local' }, stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status) process.exit(result.status);
const names = ['mgu-fscpatch', 'LICENSE-Go.txt'];
const component = { id: 'mgu-fscpatch', kind: 'tool', version: '1.0.0', title: 'FSC patch service',
    description: 'FSC verifier patch service.',
    mguHmi: ['ID7'], optional: true, uninstallable: true,
    requires: { 'mgu-deploy': '0.3.2' },
    files: names.map(name => ({ path: name, mode: name === 'mgu-fscpatch' ? '0755' : '0644', sha256: hash(path.join(out, name)) })),
    units: [{ name: 'mgu-fscpatch.service', from: 'units/mgu-fscpatch.service' }],
    dropins: [{ unit: 'autosaronlinux.service', name: '90-mgu-fscpatch.conf', from: 'units/90-mgu-fscpatch.conf' }],
    enable: [{ unit: 'mgu-fscpatch.service', target: 'oapcontroller.service' }], restart: ['mgu-fscpatch.service'], recmgr: ['mgu-fscpatch'],
    sourceSha256: sourceHash(dir),
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'component.json'), JSON.stringify(component, null, 2) + '\n');
console.log('Built FSC patch Linux amd64 service');
