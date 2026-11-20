'use strict';
/**
 * presets.js - saved compositions ("пресеты").
 *
 * A preset is a named snapshot of the whole composition, so a driver can keep a
 * daily layout, a long-trip layout and a track layout and switch between them
 * instead of rebuilding the grid each time.
 *
 * Storage is one JSON file next to composition.json, written atomically (tmp +
 * rename) like the composition itself: a failed write must never leave a
 * half-written preset list behind.
 *
 * Every entry is validated against the composition model on load, so a file
 * edited by hand or written by an older version cannot put an impossible layout
 * on screen.
 */
const fs = require('fs');
const path = require('path');
const M = require('./composition');

const FILE = 'presets.json';
const MAX = 8;                       // fits the sheet without a second page
const VERSION = 1;

function file(dataDir) { return path.join(dataDir, FILE); }

/** Labels for a composition, most telling first: what the driver sees on the tiles. */
function labelsOf(composition) {
    const out = [];
    (composition && composition.widgets ? composition.widgets : []).forEach((w) => {
        const page = w.pages && w.pages[w.active || 0];
        if (!page || !page.length) return;
        page.forEach((id) => {
            const item = M.items[id];
            const name = id === 'tyres' ? 'Шины' : (item && item.name ? item.name : id);
            if (out.indexOf(name) < 0) out.push(name);
        });
    });
    return out;
}

/**
 * A name the driver can recognise without typing one. The kit has no text input,
 * so the name comes from the content itself: the two most telling indicators.
 * Duplicates get a counter, so saving twice never produces two identical names.
 */
function nameFor(composition, taken) {
    const labels = labelsOf(composition);
    let base;
    if (!labels.length) base = 'Пустая';
    else if (labels.length === 1) base = labels[0];
    else base = labels[0] + ' · ' + labels[1];
    if (base.length > 34) base = base.slice(0, 33) + '…';
    const used = (taken || []).map((p) => p.name);
    if (used.indexOf(base) < 0) return base;
    for (let n = 2; n <= MAX + 1; n++) {
        const candidate = base + ' ' + n;
        if (used.indexOf(candidate) < 0) return candidate;
    }
    return base;
}

/** A preset as it goes to disk: only the fields the sheet needs. */
function makeEntry(composition, name, now) {
    const at = now === undefined ? Date.now() : now;
    return {
        id: 'p' + at.toString(36) + Math.floor(Math.random() * 1296).toString(36),
        name: name,
        at: at,
        composition: JSON.parse(JSON.stringify(composition))
    };
}

function validEntry(e) {
    return !!(e && typeof e.id === 'string' && typeof e.name === 'string' &&
        e.name.length > 0 && e.name.length <= 40 && M.validate(e.composition));
}

/** Read the preset list; a missing file is an empty list, a corrupt one is reported. */
function load(dataDir) {
    let raw;
    try { raw = fs.readFileSync(file(dataDir), 'utf8'); }
    catch (e) {
        if (e.code === 'ENOENT') return { presets: [], error: null };
        return { presets: [], error: 'read' };
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return { presets: [], error: 'json' }; }
    if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.presets)) return { presets: [], error: 'format' };
    // Drop entries the composition model rejects instead of failing the whole list: one bad
    // preset must not cost the driver the others.
    const presets = parsed.presets.filter(validEntry).slice(0, MAX);
    return { presets: presets, error: null };
}

/** Write the list atomically. Returns null on success, or a reason string. */
function save(dataDir, presets) {
    const clean = (presets || []).filter(validEntry).slice(0, MAX);
    const body = JSON.stringify({ version: VERSION, presets: clean }, null, 2);
    const target = file(dataDir);
    try {
        fs.writeFileSync(target + '.tmp', body, 'utf8');
        fs.renameSync(target + '.tmp', target);
        return null;
    } catch (e) {
        try { fs.unlinkSync(target + '.tmp'); } catch (_) { /* nothing to clean */ }
        return 'write';
    }
}

/** Append a preset for this composition. Returns { presets, entry, error }. */
function add(dataDir, presets, composition, now) {
    if (!M.validate(composition)) return { presets: presets, entry: null, error: 'invalid' };
    if ((presets || []).length >= MAX) return { presets: presets, entry: null, error: 'full' };
    const entry = makeEntry(composition, nameFor(composition, presets), now);
    const next = (presets || []).concat([entry]);
    const error = save(dataDir, next);
    return error ? { presets: presets, entry: null, error: error } : { presets: next, entry: entry, error: null };
}

/** Remove one preset by id. Returns { presets, error }. */
function remove(dataDir, presets, id) {
    const next = (presets || []).filter((p) => p.id !== id);
    if (next.length === (presets || []).length) return { presets: presets, error: 'missing' };
    const error = save(dataDir, next);
    return error ? { presets: presets, error: error } : { presets: next, error: null };
}

/** Is this composition exactly the one the preset holds? (marks the applied preset) */
function same(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
}

module.exports = { FILE, MAX, VERSION, file, load, save, add, remove, same, nameFor, labelsOf, makeEntry, validEntry };
