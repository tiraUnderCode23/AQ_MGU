'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeDistribution } = require('./export-public');

function exportUsb(root, outputParent) {
  // outputParent may be a removable-drive root, where recursive mkdir is not
  // supported on Windows. Refresh only this repository source so other Store
  // sources on the same drive remain untouched.
  if (!fs.existsSync(outputParent)) fs.mkdirSync(outputParent, { recursive: true });
  const repositoryRoot = path.join(outputParent, 'mgu-repo');
  if (fs.existsSync(repositoryRoot) && fs.lstatSync(repositoryRoot).isSymbolicLink()) {
    throw new Error('USB repository folder cannot be a symbolic link: ' + repositoryRoot);
  }
  fs.mkdirSync(repositoryRoot, { recursive: true });
  const source = path.join(repositoryRoot, 'noahg-apps');
  if (fs.existsSync(source)) {
    const info = fs.lstatSync(source);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('USB source path must be a regular directory: ' + source);
    }
  }
  const staged = fs.mkdtempSync(path.join(repositoryRoot, '.noahg-apps-'));
  try {
    writeDistribution(root, staged);
    fs.rmSync(source, { recursive: true, force: true });
    // Copy instead of renaming so this also works on removable Windows
    // volumes and sandboxed temporary filesystems.
    fs.cpSync(staged, source, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(staged, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(staged, { recursive: true, force: true });
    throw error;
  }
  return { output: outputParent, source };
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist', 'usb-source');
    const result = exportUsb(root, destination);
    console.log(`USB Store source refreshed at ${result.source}.`);
    if (!process.argv[2]) console.log(`Copy the mgu-repo folder from ${result.output} to your USB stick's root.`);
    console.log('In the Store, select the noahg-apps USB source and install the desired app and its companion service.');
  } catch (error) {
    console.error(`USB export failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { exportUsb };
