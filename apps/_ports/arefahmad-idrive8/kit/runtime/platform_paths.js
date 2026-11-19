'use strict';
// Read-only platform path selection. Never mix MainApp and MainApp21 content.
const fs = require('fs');
const path = require('path');
const FAMILIES = { ID7: 'oap-mainapp', ID8: 'oap-mainapp21' };
function mainAppRoot(root, hmi, files) {
    files = files || fs;
    const candidates = Object.keys(FAMILIES).map((family) => ({
        hmi: family, path: path.join(root || '/', 'usr/lib', FAMILIES[family]),
    }));
    const exists = (p) => { try { return files.statSync(p).isDirectory(); } catch (e) { return false; } };
    if (hmi) {
        if (!Object.prototype.hasOwnProperty.call(FAMILIES, hmi)) throw new Error('Unknown HMI family: ' + hmi);
        const selected = candidates.find((candidate) => candidate.hmi === hmi);
        if (!exists(selected.path)) throw new Error(hmi + ' MainApp folder is unavailable');
        return selected.path;
    }
    const present = candidates.filter((candidate) => exists(candidate.path));
    if (present.length !== 1) throw new Error('MainApp family is unknown or ambiguous');
    return present[0].path;
}
module.exports = { mainAppRoot };
