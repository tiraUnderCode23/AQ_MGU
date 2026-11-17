'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sourceHash } = require('./native-source-hash');
const { sourceHash: appSourceHash } = require('./app-source-hash');
const { prebuilt } = require('./prebuilt');
const { inspectPackage } = require('./package-archive');

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

// Check each path component before reading: source files must stay in the repo.
function inside(root, relative) {
  check(typeof relative === 'string' && relative.length > 0 &&
    !relative.includes('\\') && !relative.includes(':') &&
    relative.split('/').every(part => part && part !== '.' && part !== '..'),
  `Unsafe relative path: ${relative}`);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    check(!fs.lstatSync(current).isSymbolicLink(), `Symlink is not allowed: ${relative}`);
  }
  return current;
}

function json(root, relative) {
  return JSON.parse(fs.readFileSync(inside(root, relative), 'utf8'));
}

function hmis(value, label) {
  check(Array.isArray(value) && value.length > 0 &&
    value.every(hmi => hmi === 'ID7' || hmi === 'ID8') &&
    new Set(value).size === value.length, `${label}: declare ID7 and/or ID8 in mguHmi`);
  return value.slice().sort().join(',');
}

function scan(root, relative = '', packages = new Set(), pending = new Set()) {
  for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(item.name) ||
      (!relative && ['dist', 'build', 'coverage', 'preview'].includes(item.name))) continue;
    const name = relative ? `${relative}/${item.name}` : item.name;
    check(!item.isSymbolicLink(), `Symlink is not allowed: ${name}`);
    check(!['oap-sdk', 'donors'].includes(item.name), `Keep SDK/donor material outside the repo: ${name}`);
    const allowed = packages.has(name) || (pending.has(path.posix.dirname(name)) && /^[a-z0-9_-]+@\d+\.\d+\.\d+\.tgz$/.test(item.name));
    check(!/(^|\/)javascript\/(app|build)\.(js|json)$/.test(name) &&
      (!/\.(tgz|mgu)$/.test(name) || allowed), `Generated package must stay outside the source tree: ${name}`);
    if (item.isDirectory()) scan(root, name, packages, pending);
  }
}

function validateTool(root, entry) {
  check(typeof entry.path === 'string' && entry.path.startsWith('native/') && entry.build === undefined,
    `${entry.id}: tool must use a native folder without a build step`);
  const tool = json(root, `${entry.path}/component.json`);
  check(tool.kind === 'tool' && tool.id === entry.id && VERSION.test(tool.version), `${entry.id}: tool id/version mismatch`);
  hmis(tool.mguHmi, entry.id);
  check(typeof tool.title === 'string' && tool.title.trim(), `${entry.id}: tool title required`);
  check(Array.isArray(tool.files) && tool.files.length > 0, `${entry.id}: tool files required`);
  const files = new Set();
  for (const file of tool.files) {
    check(file && typeof file.path === 'string' && !files.has(file.path) && /^(0644|0755)$/.test(file.mode), `${entry.id}: invalid tool file`);
    files.add(file.path);
    inside(root, `${entry.path}/${file.path}`);
    const content = fs.readFileSync(inside(root, `${entry.path}/${file.from || file.path}`));
    check(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256) &&
      crypto.createHash('sha256').update(content).digest('hex') === file.sha256, `${entry.id}: tool file hash mismatch; rebuild the service`);
  }
  const units = new Set();
  check(Array.isArray(tool.units) && tool.units.length > 0, `${entry.id}: tool units required`);
  for (const unit of tool.units) {
    check(unit && /^[a-z0-9][a-z0-9_.-]+\.service$/.test(unit.name) && !units.has(unit.name), `${entry.id}: invalid tool unit`);
    units.add(unit.name);
    check(fs.statSync(inside(root, `${entry.path}/${unit.from || unit.name}`)).isFile(), `${entry.id}: unit file missing`);
  }
  check(Array.isArray(tool.enable) && tool.enable.every(item => units.has(item.unit) && item.target === 'oapcontroller.service'),
    `${entry.id}: enable tool for oapcontroller.service`);
  check(Array.isArray(tool.restart) && tool.restart.every(name => units.has(name)), `${entry.id}: unknown restart unit`);
  check(Array.isArray(tool.recmgr) && tool.recmgr.includes(entry.id), `${entry.id}: recmgr entry required`);
  if (tool.sourceSha256 !== undefined) {
    check(entry.path.endsWith('/prebuilt') && tool.sourceSha256 === sourceHash(inside(root, entry.path.slice(0, -'/prebuilt'.length))),
      `${entry.id}: source changed; rebuild the service`);
  }
}

function validate(root, { artifacts = true } = {}) {
  const repo = json(root, 'mgu-repo.json');
  check(repo.schema === 1 && Array.isArray(repo.components),
    'mgu-repo.json must have schema 1 and a components array');
  check(repo.apps === undefined && repo.tools === undefined,
    'This validator supports explicit component entries only');
  const packages = new Set();
  const pending = new Set();
  const ids = new Set();
  const registered = new Set();
  for (const entry of repo.components) {
    check(entry && ID.test(entry.id) && !ids.has(entry.id), 'App ids must be valid and unique');
    ids.add(entry.id);
    if (entry.kind === 'tool') {
      validateTool(root, entry);
      continue;
    }
    const scripted = entry.build && typeof entry.build === 'object' && !Array.isArray(entry.build);
    check(entry.kind === 'app' && (entry.build === 'unit' || scripted), `${entry.id}: use kind app and a supported build`);
    check(entry.path === `apps/${entry.id}`, `${entry.id}: path must be apps/${entry.id}`);
    check(entry.manifest === undefined || (scripted && entry.manifest === 'app.json'), `${entry.id}: manifest overrides are unsupported`);
    const base = entry.path;
    const app = json(root, `${base}/${scripted ? 'app.json' : 'mgu-app.json'}`);
    check((scripted || app.schema === 1) && app.id === entry.id && VERSION.test(app.version),
      `${entry.id}: manifest needs ${scripted ? '' : 'schema 1, '}matching id and x.y.z version`);
    check(typeof app.title === 'string' && app.title.trim(), `${entry.id}: title is required`);
    for (const [iface, fields] of Object.entries(app.signals || {})) {
      if (fields === '*') continue;
      check(fields && typeof fields === 'object' && !Array.isArray(fields), `${entry.id}: invalid signal interface ${iface}`);
      for (const [name, value] of Object.entries(fields)) {
        if (name.startsWith('_')) {
          check(['_instances', '_methods', '_broadcasts', '_optional'].includes(name), `${entry.id}: unknown signal metadata ${name}`);
        } else {
          check(typeof value === 'string' && /^[rsw]+$/.test(value),
            `${entry.id}: signal attribute ${name} needs access flags; use _instances, _methods and _broadcasts for interface metadata`);
        }
      }
      for (const name of ['_methods', '_broadcasts']) {
        if (fields[name] !== undefined) check(Array.isArray(fields[name]) && fields[name].every(value => typeof value === 'string' && value.length > 0),
          `${entry.id}: ${name} must list interface member names`);
      }
    }
    const target = hmis(app.mguHmi, entry.id);
    if (entry.mguHmi !== undefined) {
      check(hmis(entry.mguHmi, entry.id) === target, `${entry.id}: index mguHmi differs from manifest`);
    }
    const requirements = entry.requires === undefined ? app.requires : entry.requires;
    if (requirements !== undefined) {
      check(requirements && typeof requirements === 'object' && !Array.isArray(requirements) &&
        Object.entries(requirements).every(([id, version]) => ID.test(id) && id !== entry.id && VERSION.test(version)),
      `${entry.id}: requires must map other component ids to x.y.z versions`);
    }
    check(app.internet === undefined || typeof app.internet === 'boolean', `${entry.id}: internet must be boolean`);
    if (scripted) {
      const build = entry.build;
      const isPrebuilt = build.node === 'tools/prebuilt.js';
      if (isPrebuilt) {
        check(Object.keys(build).every(key => ['node', 'args', 'output'].includes(key)) &&
          JSON.stringify(build.args) === '["{dir}","{id}","{version}"]' &&
          build.output === '{dir}/prebuilt/{id}@{version}.tgz', `${entry.id}: unsupported prebuilt build contract`);
        inside(root, 'tools/prebuilt.js');
        packages.add(`${base}/prebuilt/${app.id}@${app.version}.tgz`);
        if (artifacts) {
          inspectPackage(prebuilt(root, base, app.id, app.version), app);
          const artifact = json(root, `${base}/prebuilt/artifact.json`);
          check(appSourceHash(root, base) === artifact.sourceSha256, 'App or kit source changed; rebuild the app');
        }
        else pending.add(`${base}/prebuilt`);
      } else {
        check(Object.keys(build).every(key => ['python', 'args', 'sdk', 'output'].includes(key)) &&
          build.python === 'kit/tools/build.py' && build.sdk === 'oap-sdk' &&
          JSON.stringify(build.args) === '["{id}"]' &&
          build.output === 'dist/{id}@{version}.tgz',
        `${entry.id}: custom build must use the vendored Python app kit contract`);
      }
      for (const file of ['kit/tools/build.py', 'kit/tools/pack_data.py', 'kit/tools/localize.py',
        'kit/tools/locale-revisions.json', 'kit/tools/oapgen/gen.js', 'kit/platform/permissions.json',
        'kit/runtime/mgu.js', `${base}/main.js`, `${base}/icon.png`]) {
        check(fs.statSync(inside(root, file)).isFile(), `${file}: required kit file missing`);
      }
      check(typeof app.loggingId === 'string' && /^[A-Z0-9]{4}$/.test(app.loggingId), `${entry.id}: loggingId must be four uppercase letters/digits`);
      check(target === 'ID7', `${entry.id}: this builder generates ID7 resources only`);
      registered.add(entry.id);
      continue;
    }
    check(app.tree === `${entry.id}@${app.version}`, `${entry.id}: tree must be <id>@<version>`);
    check(Array.isArray(app.modules) && app.modules.length > 0 &&
      new Set(app.modules).size === app.modules.length, `${entry.id}: list unique source modules, entry first`);
    for (const module of app.modules) {
      check(typeof module === 'string' && module.endsWith('.js'), `${entry.id}: modules must be JavaScript paths`);
      check(fs.statSync(inside(root, `${base}/${module}`)).isFile(), `${module}: module must be a file`);
    }
    check(Array.isArray(app.sdk) && new Set(app.sdk).size === app.sdk.length &&
      app.sdk.every(name => typeof name === 'string' && /^oap-sdk\/[A-Za-z0-9_/-]+(?:\.js)?$/.test(name)),
    `${entry.id}: sdk must list unique oap-sdk module names`);
    const staged = `${base}/${app.tree}`;
    const pkg = json(root, `${staged}/package.json`);
    check(pkg.name === app.id && pkg.version === app.version, `${entry.id}: staged package id/version mismatch`);
    check(typeof pkg.main === 'string' && /^javascript\/[A-Za-z0-9_-]+\.js$/.test(pkg.main) && pkg.main !== 'javascript/app.js',
      `${entry.id}: package main must name a JavaScript runner in javascript/`);
    check(hmis(pkg.mguHmi, entry.id) === target, `${entry.id}: staged package mguHmi mismatch`);
    const rhmi = json(root, `${staged}/rhmiData/application.json`).application;
    check(rhmi && rhmi.name === app.id && rhmi.version === app.version,
      `${entry.id}: RHMI application id/version mismatch`);
    check(Array.isArray(rhmi.uiDescriptions) && rhmi.uiDescriptions.length > 0, `${entry.id}: RHMI UI descriptions required`);
    const supported = new Set();
    for (const ui of rhmi.uiDescriptions) {
      hmis(ui.hmi, `${entry.id} UI description`);
      ui.hmi.forEach(hmi => supported.add(hmi));
      for (const field of ['applicationFilePath', 'uiDescriptionFilePath']) {
        check(typeof ui[field] === 'string', `${entry.id}: RHMI ${field} required`);
        const resource = ui[field].replace(/^\.\//, '');
        check(fs.statSync(inside(root, `${staged}/rhmiData/${resource}`)).isFile(), `${resource}: RHMI resource must be a file`);
      }
    }
    check([...supported].sort().join(',') === target, `${entry.id}: RHMI HMI support differs from manifest`);
    registered.add(entry.id);
  }
  scan(root, '', packages, pending);
  for (const item of fs.readdirSync(inside(root, 'apps'), { withFileTypes: true })) {
    if (item.isDirectory()) check(registered.has(item.name), `Unregistered app folder: apps/${item.name}`);
  }
  return { count: ids.size };
}

if (require.main === module) {
  try {
    const result = validate(path.resolve(__dirname, '..'));
    console.log(`Source valid: ${result.count} component(s).`);
  } catch (error) {
    console.error(`Validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { validate };
