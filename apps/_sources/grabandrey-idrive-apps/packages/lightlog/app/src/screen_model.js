'use strict';
/*
 * Light Logger: what the screen shows. Pure, tested on a desktop by tools/test_lightlog.js.
 *
 * Without MGU Store's renderer the screen is the head unit's own list: a status line, four buttons, then LINES rows
 * of text in one of three views (Show steps through them):
 *   'seat'  the lights that may be the seat logos now (journal.relevant()), each with why
 *   'log'   the newest events first, only the seat lights', the car's, the marks and the link's
 *   'all'   every light now: the RGB modules and the BDC's lamp outputs
 *   'find'  the finder (finder.js): learn the values the units report, snapshots with the logos ON and OFF, and
 *           the values that follow them
 * (ui.js draws the same with the renderer: its left card is seat, all or find, the log always beside it.)
 */
const lin = require('./lin.js');
const lamps = require('./lamps.js');
const { line, SOURCES } = require('./journal.js');

const LINES = 40;
const BUTTONS = [
    { id: 21, name: 'llMark', label: 'Mark this moment' },
    { id: 22, name: 'llRead', label: 'Read the lights now' },
    { id: 23, name: 'llView', label: 'Show' },
    { id: 24, name: 'llClear', label: 'Clear the log on screen' },
    { id: 28, name: 'llKeep', label: 'Keep the logos on' },
    { id: 29, name: 'llKeepTest', label: 'Keep on: test for 10 s' },
    { id: 25, name: 'llLearn', label: 'Finder: learn what the units report' },
    { id: 26, name: 'llSnapOn', label: 'Finder: snapshot, logos ON' },
    { id: 27, name: 'llSnapOff', label: 'Finder: snapshot, logos OFF' },
];
const LINE_IDS = Array.apply(null, Array(LINES)).map((_, i) => ({ id: 40 + i, name: 'llLine' + i }));

function status(s) {
    const parts = [];
    parts.push(s.linkReady ? 'diagnostic link ready' : 'diagnostic link: ' + (s.linkError || 'starting'));
    s.buses.forEach((b, i) => {
        const name = SOURCES[i];
        if (i === 3 && !b.reads) return;
        if (b.refused) parts.push(name + ': refused (' + b.refused + ')');
        else if (b.modules === null) parts.push(name + ': ' + (b.reads ? 'no answer yet' : 'waiting'));
        else parts.push(name + ': ' + b.modules + (i === 2 ? ' outputs' : i === 3 ? ' values' : ' lights') + ', ' + b.on + ' on');
    });
    parts.push(s.engine === true ? 'engine running' : s.engine === false ? 'engine off' : 'engine ?');
    if (s.kmh !== null && s.kmh !== undefined) parts.push(Math.round(s.kmh) + ' km/h');
    if (s.keep && s.keep.holding) parts.push('KEEPING lamp output ' + s.keep.output + ' ON');
    parts.push(s.file ? 'file ' + s.file : 'no log file');
    return parts.join('  |  ');
}

const VIEWS = ['seat', 'log', 'all', 'find'];
const DRAWN_VIEWS = ['seat', 'all', 'find'];
const VIEW_LABELS = { seat: 'Seat lights now', log: 'Seat light log', all: 'All lights now', find: 'Finder' };
const REASONS = { pinned: 'PINNED', seat: 'SEAT', mark: 'CHANGED AT MARK', unknown: 'UNKNOWN CODE' };

function viewLabel(view) { return VIEW_LABELS[view] || VIEW_LABELS.seat; }
function nextView(view) { return VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]; }
function nextDrawnView(view) { return DRAWN_VIEWS[(DRAWN_VIEWS.indexOf(view) + 1) % DRAWN_VIEWS.length]; }
function tags(m) { return (m.reasons || []).map((r) => REASONS[r]).join(', '); }

/* what the seat view says when no light qualifies */
function noSeatText(journal) {
    const all = journal.modules();
    if (!all.length) return ['No answer from the body controller yet.'];
    return [
        'No seat light so far.',
        'The body controller reports ' + all.length + ' lights: none in a seat, none with an unknown code.',
        'Press Mark this moment when the logos go dark: any light that changes then shows up here.',
        'If none does, they are switched elsewhere: use Find to look through everything the units report.',
    ];
}

/* the finder in words: [lines] */
function findText(f) {
    if (!f) return ['The finder is not running.'];
    const st = f.state, out = [];
    const step = (n, text) => out.push(n + '. ' + text);
    const units = st.unitsKnown ? (st.units.length ? st.units.map((u) => u.name + ': ' + u.values + ' values' + (u.done ? '' : ', ' + Math.round(100 * u.next / st.total) + ' % learned')).join('  |  ') : 'no unit answered') : 'not looked for yet';
    step(1, 'Learn (once, a few minutes a unit, car on): ' + units);
    if (st.phase === 'learning' && st.progress) out.push('   learning ' + st.progress.name + ': ' + Math.round(100 * st.progress.done / st.progress.total) + ' %');
    step(2, 'With the logos ON: snapshot (taken ' + st.counts.on + 'x)');
    step(3, 'With the logos OFF: snapshot (taken ' + st.counts.off + 'x)');
    if (st.phase === 'snapshot' && st.progress) out.push('   reading: ' + Math.round(100 * st.progress.done / Math.max(1, st.progress.total)) + ' %');
    if (st.error) out.push('   error: ' + st.error);
    if (st.counts.on && st.counts.off) {
        const c = f.candidates();
        out.push(c.length + ' values follow the logos (take two of each to drop what moves anyway):');
        c.forEach((x) => out.push('   ' + lamps.unitName(x.unit) + ' 0x' + lamps.hex(x.did, 4) + '   ON ' + x.on + '   OFF ' + x.off));
    }
    return out;
}

/* the value shown beside a button in the plain list */
function buttonValue(name, st, view, marks) {
    const k = st && st.keep;
    if (name === 'llView') return viewLabel(view);
    if (name === 'llMark') return marks ? marks + ' so far' : '';
    if (name === 'llKeep') return k && k.output ? (k.enabled ? (k.holding ? 'ON, holding output ' + k.output : 'ON, waiting for the car') : 'Off') : 'pin the output first';
    if (name === 'llKeepTest') return k && k.mode === 'test' ? 'testing' : '';
    return '';
}

/* the LINES rows' texts */
function lines(view, journal, finder) {
    let out;
    if (view === 'find') {
        out = findText(finder);
    } else if (view === 'all') {
        out = journal.modules().map((m) => lin.describe(m) + '  [' + m.raw + ']');
        if (!out.length) out = ['No answer from the body controller yet.'];
    } else if (view === 'log') {
        out = journal.events.filter((e) => journal.isRelevant(e)).reverse().map((e) => (e.seat ? '>> ' : '') + line(e));
        if (!out.length) out = ['Nothing logged yet.'];
    } else {
        out = journal.relevant().map((m) => '[' + tags(m) + '] ' + lin.describe(m) + '  [' + m.raw + ']');
        if (!out.length) out = noSeatText(journal);
    }
    while (out.length < LINES) out.push('');
    return out.slice(0, LINES);
}

/* what ui.js draws: the left card is the seat lights, or all of them ('all'); the right one the seat light log */
function drawModel(journal, st, view, focus, pressed, finder, page) {
    const f = finder ? finder.state : null;
    return {
        find: f ? Object.assign({}, f, { candidates: f.counts.on && f.counts.off ? finder.candidates().slice(0, 40) : [] }) : null,
        status: st, view: DRAWN_VIEWS.indexOf(view) >= 0 ? view : 'seat', seat: journal.relevant(), all: journal.modules(),
        noSeat: noSeatText(journal), log: journal.events.filter((e) => journal.isRelevant(e)).reverse().slice(0, 20),
        pins: Array.from(journal.pins), marks: journal.marks, focus: focus, pressed: pressed, page: page || 0,
    };
}

module.exports = { buttonValue, drawModel, LINES, BUTTONS, LINE_IDS, VIEWS, DRAWN_VIEWS, REASONS, status, lines, viewLabel, nextView, nextDrawnView, tags, noSeatText, findText };
