'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Display } = require('../display');

test('display cancellation clears pending targets and a canceled tab cannot activate on later up', () => {
    const display = Object.create(Display.prototype);
    let opened = 0;
    Object.assign(display, {
        own: () => false,
        tabs: [{i:0,x:0,y:0,w:100,h:100}],
        onTab: () => { opened++; },
        tabDown: -1,
        ownDown: 'tgt:save', downAt: {x:20,y:20}, lastY: 20, dragging: true,
    });
    display._touch(1,20,20);
    display._touch(4,21,21);
    assert.equal(display.tabDown,-1);
    assert.equal(display.ownDown,null);
    assert.equal(display.downAt,null);
    assert.equal(display.lastY,null);
    assert.equal(display.dragging,false);
    display._touch(3,21,21);
    assert.equal(opened,0);
});
