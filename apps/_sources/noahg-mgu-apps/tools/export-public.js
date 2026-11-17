'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { validate } = require('./validate');
const { prebuilt, digest } = require('./prebuilt');
const { publicReadme } = require('./public-readme');

// Read only explicitly selected regular files, including every path component.
function read(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') ||
      !relative.split('/').every(part => part && part !== '.' && part !== '..')) {
    throw new Error('Unsafe distribution input: ' + relative);
  }
  let file = root;
  for (const part of relative.split('/')) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Symlink is not allowed: ' + relative);
  }
  if (!fs.statSync(file).isFile()) throw new Error('Not a regular file: ' + relative);
  return fs.readFileSync(file);
}

// Deterministic tool kit: the deploy tool expects component.json, files/ and units/.
function toolArchive(root, entry, component) {
  const members = [];
  const add = (name, from, mode) => {
    members.push({ name, data: read(root, entry.path + '/' + from), mode });
  };
  const manifest = {};
  for (const key of ['id', 'kind', 'version', 'title', 'description', 'enable', 'recmgr', 'restart',
    'mguHmi', 'mguProvides', 'keepRunning', 'crashNames', 'postInstall', 'check', 'activate', 'deactivate', 'internet', 'uids']) {
    if (component[key] !== undefined) manifest[key] = component[key];
  }
  manifest.files = component.files.map(file => {
    add('files/' + file.path, file.from || file.path, parseInt(file.mode, 8));
    return { path: file.path, mode: file.mode, sha256: file.sha256 };
  });
  manifest.units = (component.units || []).map(unit => {
    add('units/' + unit.name, unit.from || unit.name, 0o644);
    return { name: unit.name };
  });
  if (component.dropins) manifest.dropins = component.dropins.map(dropin => {
    add(`dropins/${dropin.unit}.d/${dropin.name}`, dropin.from || dropin.name, 0o644);
    return { unit: dropin.unit, name: dropin.name };
  });
  members.push({ name: 'component.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), mode: 0o644 });
  const blocks = [];
  for (const member of members.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (!/^[A-Za-z0-9_./@-]+$/.test(member.name) || member.name.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Unsafe tool archive path: ' + member.name);
    }
    const header = Buffer.alloc(512);
    let name = member.name, prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const cut = name.lastIndexOf('/', 155);
      if (cut < 1) throw new Error('Tool archive path too long: ' + name);
      prefix = name.slice(0, cut);
      name = name.slice(cut + 1);
    }
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('Tool archive path too long');
    const octal = (value, offset, width) => {
      const text = value.toString(8);
      if (text.length >= width) throw new Error('Tool archive numeric field too large');
      header.write(text.padStart(width - 1, '0') + '\0', offset, width);
    };
    header.write(name, 0, 100);
    octal(member.mode, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(member.data.length, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(prefix, 345, 155);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(header, member.data, Buffer.alloc((512 - member.data.length % 512) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]), { level: 6 });
}

function writeDistribution(root, output) {
  validate(root);
  const repo = JSON.parse(read(root, 'mgu-repo.json'));
  const files = new Map([['apps/.gitkeep', Buffer.alloc(0)], ['tools/.gitkeep', Buffer.alloc(0)]]);
  const components = repo.components.map(entry => {
    let metadata, content;
    if (entry.kind === 'app') {
      if (!entry.build || entry.build.node !== 'tools/prebuilt.js') {
        throw new Error(entry.id + ': public exports require a locally prebuilt app');
      }
      metadata = JSON.parse(read(root, entry.path + '/app.json'));
      content = fs.readFileSync(prebuilt(root, entry.path, entry.id, metadata.version));
    } else {
      metadata = JSON.parse(read(root, entry.path + '/component.json'));
      content = toolArchive(root, entry, metadata);
    }
    const name = `${entry.id}@${metadata.version}.tgz`;
    const artifactPath = (entry.kind === 'tool' ? 'tools/' : 'apps/') + name;
    files.set(artifactPath, content);
    const component = { id: entry.id, kind: entry.kind, version: metadata.version,
      title: entry.title || metadata.title || entry.id, description: entry.description || metadata.description || '',
      mguHmi: entry.mguHmi || metadata.mguHmi, uninstallable: true,
      artifact: { name, url: artifactPath, size: content.length, sha256: digest(content) } };
    for (const key of ['requires', 'optional', 'uninstallable', 'mguProvides', 'mguNeeds', 'author', 'texts']) {
      const value = entry[key] === undefined ? metadata[key] : entry[key];
      if (value !== undefined) component[key] = value;
    }
    if (entry.kind === 'app') {
      const icon = 'apps/' + entry.id + '.png';
      const bytes = read(root, entry.path + '/icon.png');
      files.set(icon, bytes);
      component.icon = icon;
      component.iconSha256 = digest(bytes);
    }
    return component;
  });
  const notices = ['# Third-party notices', '', 'Runtime licenses are retained inside the app and tool packages.', ''];
  if (components.some(component => component.kind === 'app')) {
    for (const [from, to, label] of [
      ['kit/LICENSE.upstream', 'licenses/kit-MIT.txt', 'App runtime: upstream MIT license'],
      ['kit/runtime/fonts/UFL-Ubuntu.txt', 'licenses/UFL-Ubuntu.txt', 'Ubuntu font atlases'],
      ['kit/runtime/fonts/OFL-NotoSansSC.txt', 'licenses/OFL-NotoSansSC.txt', 'Noto Sans SC font atlas']
    ]) {
      files.set(to, read(root, from));
      notices.push(`- [${label}](${to})`);
    }
  }
  files.set('THIRD_PARTY_NOTICES.md', Buffer.from(notices.join('\n') + '\n'));
  files.set('README.md', Buffer.from(publicReadme(components)));
  files.set('.gitignore', Buffer.from('/*\n' +
    '!/.gitignore\n!/.gitattributes\n!/README.md\n!/THIRD_PARTY_NOTICES.md\n!/catalog.json\n' +
    '!/apps/\n/apps/*\n!/apps/*.tgz\n!/apps/*.png\n!/apps/.gitkeep\n!/tools/\n/tools/*\n!/tools/*.tgz\n!/tools/.gitkeep\n!/licenses/\n/licenses/*\n!/licenses/*.txt\n'));
  files.set('.gitattributes', Buffer.from('* text=auto eol=lf\n*.tgz binary\n*.png binary\n'));
  const catalog = { schema: 2, components };
  files.set('catalog.json', Buffer.from(JSON.stringify(catalog, null, 2) + '\n'));
  fs.mkdirSync(output, { recursive: true });
  if (fs.readdirSync(output).length) throw new Error('Distribution output must be empty: ' + output);
  for (const [relative, bytes] of files) {
    const file = path.join(output, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { flag: 'wx' });
  }
  return { output, catalog };
}

function exportPublic(root, outputParent) {
  if (!fs.existsSync(outputParent)) fs.mkdirSync(outputParent, { recursive: true });
  return writeDistribution(root, fs.mkdtempSync(path.join(outputParent, 'public-')));
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const result = exportPublic(root, path.join(root, 'dist'));
    console.log(`Public distribution: ${result.output}`);
    console.log(`Catalog: ${path.join(result.output, 'catalog.json')}`);
  } catch (error) {
    console.error('Public export failed: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { exportPublic, writeDistribution };
