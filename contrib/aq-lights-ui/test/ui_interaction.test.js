'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ui = require('../javascript/ui_interaction');

test('painted selection window and hit test share exact geometry', () => {
    assert.deepEqual(ui.listWindow(0, 0), { start: 0, selected: -1, count: 0 });
    assert.deepEqual(ui.listWindow(10, 8), { start: 4, selected: 8, count: 6 });
    assert.deepEqual(ui.listWindow(2, 0), { start: 0, selected: 0, count: 2 });
    assert.deepEqual(ui.hitTest(40, 99, 10, 8), { type: 'row', index: 4 });
    assert.deepEqual(ui.hitTest(100, 99 + 5 * 54, 10, 8), { type: 'row', index: 9 });
    assert.equal(ui.hitTest(100, 99 + 6 * 54, 10, 8), null);
    assert.equal(ui.hitTest(100, 98 + 46, 10, 8), null, 'card gap is not clickable');
    assert.equal(ui.hitTest(20, 100, 10, 8), null, 'outside visible list bounds');
    assert.equal(ui.hitTest(200, 98, 0, 0), null, 'empty page has no row target');
    assert.deepEqual(ui.hitTest(1101, 17, 0, 0), { type: 'previous' });
    assert.deepEqual(ui.hitTest(1550, 17, 0, 0), { type: 'next' });
    assert.equal(ui.hitTest(NaN, 98, 10, 8), null);
});

test('only a positive 0x22 F150 response admits a discovered module', () => {
    assert.equal(ui.positiveModuleReply([0x62, 0xF1, 0x50, 0x01]), true);
    assert.equal(ui.positiveModuleReply(Buffer.from([0x62, 0xF1, 0x50, 0x99])), true);
    for (const reply of [null, [], [0x62, 0xF1, 0x50], [0x7F, 0x22, 0x33],
        [0x7F, 0x22, 0x78], [0x62, 0xF1, 0x90, 0x01], [0x59, 0xF1, 0x50, 0x01]]) {
        assert.equal(ui.positiveModuleReply(reply), false);
    }
});

test('controller emits one action per pressed edge; normalizes tilts and wheel wrap', () => {
    const events = [];
    const input = ui.createController(
        (direction) => events.push(['row', direction]),
        (direction) => events.push(['page', direction]),
        () => events.push(['push']),
    );
    input.receive({ frontRotaryEncoderOperation: 65534 });
    input.receive({ frontRotaryEncoderOperation: 0 });
    input.receive({ frontRotaryEncoderOperation: 30000 }); // stale counter rejected
    input.receive({ frontRotaryEncoderPushButton: 1 });
    input.receive({ frontRotaryEncoderPushButton: 1 });
    input.receive({ frontRotaryEncoderPushButton: 1, frontSequenceNumberOperatingElement: 99 });
    input.receive({ frontRotaryEncoderPushButton: 0 });
    input.receive({ frontRotaryEncoderPushButton: 'DREHGEBER_KURZ_GEDRUECKT' });
    input.receive({ frontRotaryEncoderPushButton: 'DREHGEBER_LANG_GEDRUECKT' });
    input.receive({ frontRotaryEncoderDeflection: 'OST_KURZ_GEDRUECKT' });
    input.receive({ frontRotaryEncoderDeflection: 'OST_LANG_GEDRUECKT' });
    input.receive({ frontRotaryEncoderDeflection: 0 });
    input.receive({ frontRotaryEncoderDeflection: 'WEST_LANG_GEDRUECKT' });
    assert.deepEqual(events, [['row', 1], ['push'], ['push'], ['page', 1], ['page', -1]]);
    input.reset();
    input.receive({ frontRotaryEncoderPushButton: 2 });
    assert.equal(events.filter((event) => event[0] === 'push').length, 3);
});

test('touch hook requires negotiated compatible kit; ignores covered or invalid taps', () => {
    assert.equal(ui.registerTouch({}, () => { throw new Error('unexpected'); }, () => true), null);
    let callback;
    let removed = false;
    let visible = true;
    const hits = [];
    const remove = ui.registerTouch({
        onTap(fn) { callback = fn; return () => { removed = true; }; },
    }, (x, y) => hits.push([x, y]), () => visible);
    callback(40, 120);
    visible = false;
    callback(60, 120);
    visible = true;
    callback(Infinity, 120);
    assert.deepEqual(hits, [[40, 120]]);
    remove();
    assert.equal(removed, true);
});
