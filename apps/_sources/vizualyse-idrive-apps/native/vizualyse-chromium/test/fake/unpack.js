// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/* A stand-in for unpack.js in the touch screen's test (test/touch_test.js):
 * the bundle is always there already. */
'use strict';
const fs = require('fs');
const path = require('path');

function mkdirp(d, mode) {
    if (fs.existsSync(d)) return;
    mkdirp(path.dirname(d), mode);
    fs.mkdirSync(d, mode);
}
function rmrf() { /* nothing to remove */ }
function ensure(archive, log, cb) { setImmediate(() => cb(null, { unpacked: false, sha: 'test' })); }

module.exports = { ensure, mkdirp, rmrf };
