'use strict';
// Show library: turns the lamps a user picked into a bounded list of steps.
// A step lists the lamps that are on together. Hardware rules applied here:
//   - one FLM module runs one LED channel at a time, so two channels of the same headlamp in
//     one step are played one after the other;
//   - every request goes through the head unit's diagnostic transport one by one (about
//     100-500 ms each in the car), so the step times are requested minimums, not exact timing.
const Lamps = require('./lamps');

const EFFECTS = Object.freeze([
    { id: 'wigwag', name: 'Wig-Wag', text: 'Left side, then right side', needs: 'sides' },
    { id: 'dual', name: 'Dual Flash', text: 'Two flashes left, two flashes right', needs: 'sides' },
    { id: 'chase', name: 'Chase', text: 'One lamp after another, in your order', needs: 'any' },
    { id: 'pingpong', name: 'Knight Rider', text: 'Runs through your order and back', needs: 'two' },
    { id: 'wave', name: 'Front-to-Rear Wave', text: 'Front lamps, side, then rear', needs: 'any' },
    { id: 'strobe', name: 'All Flash', text: 'Everything selected flashes together', needs: 'any' },
    { id: 'alternate', name: 'Alternating', text: 'Odd and even lamps take turns', needs: 'two' },
    { id: 'heartbeat', name: 'Heartbeat', text: 'Two quick pulses, then a pause', needs: 'any' },
    { id: 'sparkle', name: 'Sparkle', text: 'Random single lamps', needs: 'two' },
]);
const STEP_MS = Object.freeze([200, 300, 500, 750, 1000, 1500]);
const GAP_MS = Object.freeze([0, 100, 200, 300, 500]);
const CYCLES = Object.freeze([1, 2, 3, 5, 10]);
const PWM = Object.freeze([20, 40, 60, 80, 100]);
const MAX_LAMPS = 40, MAX_STEPS = 240, MAX_MS = 180000;

function effect(id) {
    const e = EFFECTS.find((x) => x.id === id);
    if (!e) throw new Error('Unknown effect');
    return e;
}
function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Raw steps (arrays of lamp ids) for one cycle, before the FLM split. */
function pattern(id, lamps) {
    const ids = lamps.map((l) => l.id);
    const left = lamps.filter((l) => Lamps.sideOf(l) === 'left').map((l) => l.id);
    const right = lamps.filter((l) => Lamps.sideOf(l) === 'right').map((l) => l.id);
    const shared = lamps.filter((l) => !Lamps.sideOf(l)).map((l) => l.id);
    switch (id) {
    case 'wigwag': return [left.length ? left : shared, right.length ? right : shared];
    case 'dual': return [left, [], left, [], right, [], right, []];
    case 'chase': return ids.map((x) => [x]);
    case 'pingpong': return ids.map((x) => [x]).concat(ids.slice(1, -1).reverse().map((x) => [x]));
    case 'wave': {
        const groups = ['front', 'side', 'rear'].map((g) => lamps.filter((l) => l.group === g).map((l) => l.id)).filter((g) => g.length);
        return groups.concat(groups.slice(1, -1).reverse());
    }
    case 'strobe': return [ids, []];
    case 'alternate': return [ids.filter((_, i) => i % 2 === 0), ids.filter((_, i) => i % 2 === 1)];
    case 'heartbeat': return [ids, [], ids, [], [], []];
    case 'sparkle': {
        const rnd = seeded(ids.join('|').length * 7919 + ids.length), out = [];
        let last = null;
        for (let i = 0; i < Math.max(6, ids.length * 2); i++) {
            let pick = ids[Math.floor(rnd() * ids.length)];
            if (pick === last && ids.length > 1) pick = ids[(ids.indexOf(pick) + 1) % ids.length];
            out.push([pick]); last = pick;
        }
        return out;
    }
    default: throw new Error('Unknown effect');
    }
}

/** Split a step so that no module runs two channel routines at the same time. */
function unitOf(l) {
    if (l.route === 'flm') return 'flm:' + l.side;
    if (l.route === 'rlm' && l.kind === 'grp') return 'rlm:' + l.address;
    return null;
}
function splitStep(ids, byId) {
    const out = [];
    const rest = ids.slice();
    while (rest.length) {
        const step = [], used = {};
        for (let i = 0; i < rest.length;) {
            const u = unitOf(byId[rest[i]]);
            if (u) {
                if (used[u]) { i++; continue; }
                used[u] = true;
            }
            step.push(rest.splice(i, 1)[0]);
        }
        out.push(step);
    }
    return out;
}

/**
 * Build a show plan.
 * selection: ordered lamp ids; lampList: catalog entries (all must be available and allowed).
 * options: {effect, stepMs, gapMs, cycles, pwm}
 * -> {effect, name, steps:[{on:[ids], ms, split}], gapMs, cycles, pwm, estimateMs, notes:[]}
 */
function plan(selection, lampList, options) {
    const o = options || {}, e = effect(o.effect);
    if (!Array.isArray(selection) || !selection.length) throw new Error('Pick at least one lamp');
    if (selection.length > MAX_LAMPS) throw new Error('At most ' + MAX_LAMPS + ' lamps per show');
    if (new Set(selection).size !== selection.length) throw new Error('A lamp is selected twice');
    const stepMs = Number(o.stepMs), gapMs = Number(o.gapMs), cycles = Number(o.cycles), pwm = Number(o.pwm);
    if (STEP_MS.indexOf(stepMs) < 0) throw new Error('Choose a step time');
    if (GAP_MS.indexOf(gapMs) < 0) throw new Error('Choose a pause');
    if (CYCLES.indexOf(cycles) < 0) throw new Error('Choose how often to repeat');
    if (PWM.indexOf(pwm) < 0) throw new Error('Choose a headlamp LED brightness');
    const byId = {};
    lampList.forEach((l) => { byId[l.id] = l; });
    const lamps = selection.map((id) => {
        const l = byId[id];
        if (!l) throw new Error('Unknown lamp ' + id);
        return l;
    });
    const notes = [];
    if (e.needs === 'two' && lamps.length < 2) throw new Error(e.name + ' needs at least two lamps');
    if (e.needs === 'sides') {
        const l = lamps.some((x) => Lamps.sideOf(x) === 'left'), r = lamps.some((x) => Lamps.sideOf(x) === 'right');
        if (!l || !r) throw new Error(e.name + ' needs lamps on the left and on the right');
        if (lamps.some((x) => !Lamps.sideOf(x))) notes.push('Lamps that light both sides at once are left out of ' + e.name + '.');
    }
    const steps = [];
    let split = false;
    for (const raw of pattern(e.id, lamps)) {
        if (!raw.length) { steps.push({ on: [], ms: stepMs, split: false }); continue; }
        const parts = splitStep(raw, byId);
        if (parts.length > 1) split = true;
        parts.forEach((p) => steps.push({ on: p, ms: parts.length > 1 ? Math.max(200, Math.round(stepMs / parts.length / 50) * 50) : stepMs, split: parts.length > 1 }));
    }
    if (steps.length * cycles > MAX_STEPS) throw new Error('Show too long: use fewer lamps or repeats');
    if (split) notes.push('Several channels of one headlamp or tail light play one after another: each module runs one channel at a time.');
    if (lamps.some((l) => l.route === 'fn')) notes.push('Function lamps (both sides) switch off by themselves after their time.');
    if (lamps.some((l) => l.route === 'out')) notes.push('BDC single outputs are experimental: lights that LED headlamps or tail light modules drive themselves stay dark.');
    const estimateMs = cycles * steps.reduce((s, st) => s + st.ms + gapMs, 0);
    if (estimateMs > MAX_MS) throw new Error('Show longer than 3 minutes: shorten it');
    return { effect: e.id, name: e.name, steps, gapMs, cycles, pwm, estimateMs, notes, lamps: selection.slice() };
}

module.exports = { unitOf, EFFECTS, STEP_MS, GAP_MS, CYCLES, PWM, MAX_LAMPS, effect, pattern, plan, splitStep };
