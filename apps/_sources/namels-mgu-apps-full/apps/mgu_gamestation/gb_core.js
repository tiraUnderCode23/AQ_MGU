'use strict';

// Serverboy.js (GPL-2.0), Game Boy / Game Boy Color, executes on Node 8.
const GameBoy = require('./gb_vendor');
const {quiet} = require('./quiet');
const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'select', 'start'];

class GameBoyGame {
    /** options.save: earlier cartridge RAM (Buffer) for battery-backed cartridges. */
    constructor(bytes, output, options) {
        this.title = 'Game Boy / Color'; this.width = 160; this.height = 144;
        this.gb = new GameBoy();
        quiet(() => this.gb.loadRom(bytes));
        this.output = output;
        this.rgba = Buffer.alloc(160 * 144 * 4);
        const save = options && options.save, core = this.core();
        if (core && core.cBATT && save && core.MBCRam && save.length === core.MBCRam.length) core.MBCRam.set(save);
    }
    /** serverboy keeps its GameBoyCore under a per-process private key. */
    core() {
        if (!this.gb) return null;
        const key = Object.keys(this.gb).find(k => this.gb[k] && this.gb[k].gameboy);
        return key ? this.gb[key].gameboy : null;
    }
    tick(pads) {
        const p = pads[0] || {};
        this.gb.pressKeys(BUTTONS.filter(k => !!p[k]));
        const pixels = quiet(() => this.gb.doFrame());
        if (!pixels || pixels.length !== this.rgba.length) throw new Error('Invalid Game Boy video frame');
        for (let i = 0; i < pixels.length; i++) this.rgba[i] = pixels[i];
        this.output(this.rgba, 160, 144);
    }
    /** Battery RAM to keep (a copy), or null when the cartridge has none. */
    sram() {
        const core = this.core();
        if (!core || !core.cBATT || !core.MBCRam || !core.MBCRam.length) return null;
        return Buffer.from(core.MBCRam);
    }
    stop() { this.gb = null; }
}

module.exports = {GameBoyGame};
