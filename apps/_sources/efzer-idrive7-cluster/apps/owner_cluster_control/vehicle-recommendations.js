'use strict';

const M = require('./composition');
const LAYOUTS = Object.freeze({
    unknown: ['rpm', 'speed', 'gear', 'pedal', 'voltage', 'battery'],
    petrol: ['rpm', 'speed', 'gear', 'power', 'boost', 'fuel'],
    diesel: ['rpm', 'speed', 'gear', 'boost', 'boostMax', 'consumption']
});
const POSITIONS = Object.freeze([
    [0, 2], [1, 2], [2, 2], [0, 3], [1, 3], [2, 3]
]);

function defaults(profile) {
    if (!Object.prototype.hasOwnProperty.call(LAYOUTS, profile)) throw new TypeError('profile must be unknown, petrol, or diesel');
    const widgets = [
        { x: 0, y: 0, w: 2, h: 2, pages: [['tyres']], active: 0 },
        { x: 2, y: 0, w: 1, h: 2, pages: [['coolant', 'oil'], ['outside', 'gearboxTemp']], active: 0 }
    ];
    LAYOUTS[profile].forEach((id, i) => {
        const [x, y] = POSITIONS[i];
        widgets.push({ x, y, w: 1, h: 1, pages: [[id]], active: 0 });
    });
    const result = { version: 2, widgets };
    if (!M.validate(result)) throw new Error('Internal recommendation is not a valid composition');
    return result;
}

// Returns a fresh default only for a valid empty model. Existing user layouts are never replaced.
function recommend(existing, profile) {
    if (!M.validate(existing) || existing.widgets.length !== 0) return null;
    return defaults(profile);
}

module.exports = { defaults, recommend };
