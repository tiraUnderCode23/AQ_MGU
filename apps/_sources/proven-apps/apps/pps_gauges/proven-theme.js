'use strict';
/**
 * proven-theme.js - the Proven colour themes, added to the kit's theme table when the app starts
 * (kit/runtime/themes.js stays untouched, so the kit can be updated from upstream).
 *
 * The colours are the logo's: white lettering on black with the light blue, dark blue and red of
 * its stripes and roundel (sampled from the logo file).
 *
 * Keys are the kit's: bg, track, tick, text, dim, accent, accent2, ok / warn / crit / cold, stripes
 * (the short bar on top of every panel), oil (oil temperature), bar (bar gauges), hang (peak hold),
 * sel / selText (selected tab), needle, ramp (bars low -> high), hotRamp (dial arc and "hot" bars:
 * calm -> red at the limit).
 */
const { THEMES } = require('./kit/themes');

const WHITE = '#ffffff', SKY = '#50a8e0', BLUE = '#085898', RED = '#e02028';

const BASE = {
    bg: '#040506', panelTop: '#15171b', panelBottom: '#0b0c0e', panelEdge: '#272a30',
    tab: '#f2f2f2', track: '#1d2026', tick: '#59606b', text: WHITE, dim: '#8b93a0',
    warn: '#ffb81a', crit: '#ff2a2a', cold: '#7fc8ff', marker: WHITE,
};

const PROVEN = {
    // the logo's colours: white on black, stripes light blue / dark blue / red, a red needle
    proven: Object.assign({}, BASE, {
        name: 'Proven',
        accent: WHITE, accent2: SKY, ok: WHITE, oil: RED, glow: '#ffffff40',
        stripes: [SKY, BLUE, RED], bar: '#b8141e', hang: RED, sel: RED, selText: WHITE, needle: RED,
        ramp: ['#7d8694', '#c9d0da', WHITE],
        hotRamp: [BLUE, SKY, SKY, WHITE, RED],
    }),
    // red only: for those who want it plainer
    proven_red: Object.assign({}, BASE, {
        name: 'Proven Red',
        accent: RED, accent2: '#ff7a80', ok: RED, oil: RED, glow: RED + '55',
        stripes: [RED], bar: '#c8161f', hang: WHITE, sel: RED, selText: WHITE, needle: RED,
        ramp: ['#6e0a10', RED, '#ff7a80'],
        hotRamp: ['#6e7a8a', '#d5dbe3', '#ff8a8f', RED, '#ff2a2a'],
    }),
    // light blue: easy on the eyes at night
    proven_blue: Object.assign({}, BASE, {
        name: 'Proven Blue',
        accent: SKY, accent2: '#b5dcf5', ok: SKY, oil: SKY, glow: SKY + '55',
        stripes: [SKY, BLUE], bar: '#2f8fd0', hang: WHITE, sel: SKY, selText: WHITE, needle: SKY,
        ramp: [BLUE, SKY, '#b5dcf5'],
        hotRamp: [BLUE, SKY, '#b5dcf5', '#ff8a8f', '#ff2a2a'],
    }),
};

/** Add the Proven themes to the kit's table (once). */
function register() {
    Object.keys(PROVEN).forEach((id) => { if (!THEMES[id]) THEMES[id] = PROVEN[id]; });
}

module.exports = { register, PROVEN, COLORS: { WHITE, SKY, BLUE, RED } };
