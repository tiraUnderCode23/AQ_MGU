'use strict';
/* node apps/esagono_settings/tools/test_model.js: the rows' values and presses */
const assert = require('assert');
const path = require('path');
const m = require('../src/settings_model.js');
const { normalize } = require(path.join(__dirname, '../../../tools/esagono-cluster/esagono.js'));

const row = (name) => m.ROWS.find((r) => r.name === name);
let s = normalize({});

// every row press, applied through the service's own checks, gives a valid setting
function press(name) {
    const change = row(name).press(s);
    s = change === 'reset' ? normalize({}) : normalize(Object.assign({}, s, change));
    return s;
}

assert.strictEqual(row('esgMode').value(s), 'Sport');
assert.strictEqual(press('esgMode').mode, 'track');
assert.strictEqual(press('esgMode').mode, 'comfort');
assert.strictEqual(press('esgMode').mode, 'sport');

assert.strictEqual(row('esgRedline').value(s), '7 500 rpm');
assert.strictEqual(press('esgRedline').redline, 7750);
for (let i = 0; i < 10; i++) press('esgRedline');
assert.ok(s.redline >= 4000 && s.redline <= s.rpmMax, 'redline wraps within the scale');

s = normalize({});
assert.strictEqual(press('esgFlash').flashRpm, 7900);

// scale changes keep redline and flash on the new scale
s = normalize({ redline: 8500, flashRpm: 8800 });
assert.strictEqual(press('esgScale').rpmMax, 10000);
assert.strictEqual(press('esgScale').rpmMax, 6000);
assert.ok(s.redline <= 5500 && s.flashRpm <= 6000 && s.flashRpm >= s.redline, JSON.stringify(s));
assert.strictEqual(row('esgScale').value(s), '0 - 6 000 rpm');

s = normalize({});
assert.strictEqual(press('esgBackdrop').backdrop, false);
assert.strictEqual(row('esgBackdrop').value(s), 'Off');
assert.strictEqual(press('esgDemo').demo, true);
assert.strictEqual(press('esgReset').demo, false);
assert.strictEqual(s.backdrop, true);

// the service refuses nonsense
const bad = normalize({ mode: 'warp', rpmMax: 99999, redline: -5, flashRpm: 'x', demo: 'yes', backdrop: 0, target: '../x' });
assert.deepStrictEqual([bad.mode, bad.rpmMax, bad.redline, bad.flashRpm, bad.demo, bad.backdrop, bad.target],
    ['sport', 9000, 7500, 7800, false, true, 'esagono']);

assert.ok(/not running/.test(m.statusText(null, false)));
assert.ok(/demo/.test(m.statusText({ settings: { demo: true }, status: { renderer: 'connected', target: 'esagono', rpmSource: 'none' } }, true)));
console.log('settings model: ok');
