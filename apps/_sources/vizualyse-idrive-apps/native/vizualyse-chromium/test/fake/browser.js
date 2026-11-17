// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/* A stand-in for browser.js in the touch screen's test (test/touch_test.js):
 * no Chromium, no display. It starts at once, probes as SwiftShader does,
 * navigates by saying so, and notes what it is asked to do in
 * CHROMIUM_TEST_BROWSER_LOG, one line each. */
'use strict';
const EventEmitter = require('events');
const fs = require('fs');
const LOG = process.env.CHROMIUM_TEST_BROWSER_LOG;
function note(s) { if (LOG) fs.appendFileSync(LOG, s + '\n'); }

const PROBE = { webgl2: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    webgpu: 'google / swiftshader', webgpuFallback: true, webgpuCompute: 'ok', jspi: 'ok' };

class Browser extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.winston = false; this.url = ''; this.title = ''; note('new scale ' + opts.scale + (opts.game ? ' game' : '')); }
    start() { return new Promise((resolve) => setTimeout(() => resolve({ ev: 'ready' }), 100)); }
    probe() { return Promise.resolve(Object.assign({}, PROBE)); }
    navigate(url) {
        note('navigate ' + url);
        this.url = url;
        this.title = 'WebGL Report';
        setImmediate(() => this.emit('navigated', { url: this.url, title: this.title }));
        return Promise.resolve();
    }
    history(d) { note('history ' + d); return Promise.resolve(); }
    reload() { note('reload'); return Promise.resolve(); }
    refreshTitle() { return Promise.resolve(); }
    setScale(s) { note('scale ' + s); return Promise.resolve(); }
    send() { return Promise.resolve(); }
    touch() { return Promise.resolve(); }
    text() { return Promise.resolve(); }
    key() { return Promise.resolve(); }
    /* the display */
    show(file) { note('display show ' + file); }
    showWinston() { note('display winston'); }
    hide() { note('display hide'); }
    stop() { note('stop'); setImmediate(() => this.emit('exit', 0, null)); }
}

module.exports = { Browser, PROBE };
