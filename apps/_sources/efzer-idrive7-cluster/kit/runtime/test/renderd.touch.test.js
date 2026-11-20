'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RenderClient } = require('../renderd');

test('renderer client forwards a canceled touch phase without converting it to up', () => {
    const gpu = new RenderClient('test', {info(){},warn(){}});
    gpu.claimed = '[]';
    const delivered = [];
    gpu.on('touch', (...args) => delivered.push(args));
    const payload = Buffer.alloc(12);
    payload.writeUInt32LE(4,0); payload.writeFloatLE(12.5,4); payload.writeFloatLE(27.25,8);
    const wire = Buffer.alloc(20);
    wire.writeUInt32LE(105,0); wire.writeUInt32LE(12,4); payload.copy(wire,8);
    gpu._data(wire);
    assert.deepEqual(delivered,[[4,12.5,27.25]]);
    gpu.close();
});
