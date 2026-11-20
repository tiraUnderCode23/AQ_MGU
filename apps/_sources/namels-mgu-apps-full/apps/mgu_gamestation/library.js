'use strict';

// Everything GameStation keeps on disk, in the app's own data folder:
//   roms/<console>/<file>         games imported from a phone
//   saves/<console>/<file>.sav    battery RAM (in-game saves) per game
//   gamestation-state.json        the last game played (for "Continue")
// Node 8: no recursive mkdir, no fs.promises. Writes go to a temp file first.
const fs = require('fs');
const path = require('path');

const CONSOLES = ['nes', 'snes', 'gb'];
const EXTENSIONS = {nes: ['.nes'], snes: ['.sfc', '.smc'], gb: ['.gb', '.gbc']};
const MAX_ROM = 8 * 1024 * 1024;
const MAX_SAVE = 256 * 1024;

function mkdir(p) { try { fs.mkdirSync(p); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
/** A file name that is safe on the head unit's file system (no folders, no hidden files). */
function safeName(name) {
    return String(name || '').replace(/[^a-zA-Z0-9_. ()\-[\]!&',+]/g, '_').replace(/^[.\s]+/, '').slice(0, 90).trim();
}
/** A stored file name: no folders, not hidden (older versions kept names a little differently). */
function plain(name) {
    name = String(name || '');
    return !!name && name.length <= 120 && !/[\/\\\0]/.test(name) && name[0] !== '.';
}
function allowed(kind, name) {
    return !!EXTENSIONS[kind] && EXTENSIONS[kind].some(ext => String(name).toLowerCase().endsWith(ext));
}
/** Title shown for a ROM file: no extension, underscores as spaces. */
function title(name) {
    return String(name).replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || String(name);
}
function writeAtomic(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
}

class Library {
    constructor(dataDir) {
        this.dir = dataDir;
        this.stateFile = path.join(dataDir, 'gamestation-state.json');
        this.state = this.readState();
    }
    romDir(kind) { return path.join(this.dir, 'roms', kind); }
    saveFile(kind, name) { return path.join(this.dir, 'saves', kind, safeName(name) + '.sav'); }

    /** Games of one console, sorted by title: [{kind, name, title, size, saved}]. */
    list(kind) {
        if (!EXTENSIONS[kind]) return [];
        let names = [];
        try { names = fs.readdirSync(this.romDir(kind)); } catch (_) { return []; }
        return names.filter(n => allowed(kind, n) && plain(n)).map(name => {
            let size = 0, saved = false;
            try { size = fs.statSync(path.join(this.romDir(kind), name)).size; } catch (_) { return null; }
            try { saved = fs.statSync(this.saveFile(kind, name)).size > 0; } catch (_) { saved = false; }
            return {kind, name, title: title(name), size, saved};
        }).filter(Boolean).sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    }
    counts() {
        const out = {};
        CONSOLES.forEach(k => { out[k] = this.list(k).length; });
        return out;
    }
    has(kind, name) {
        return allowed(kind, name) && plain(name) && fs.existsSync(path.join(this.romDir(kind), name));
    }
    read(kind, name) {
        if (!this.has(kind, name)) throw new Error('Game not found');
        const bytes = fs.readFileSync(path.join(this.romDir(kind), name));
        if (bytes.length > MAX_ROM) throw new Error('ROM is too large');
        return bytes;
    }
    /** Store an imported ROM. replace: overwrite a file of the same name. Returns the stored name. */
    add(kind, name, bytes, replace) {
        const clean = safeName(name);
        if (!clean || !allowed(kind, clean)) throw new Error('Unsupported file name');
        mkdir(path.join(this.dir, 'roms')); mkdir(this.romDir(kind));
        const file = path.join(this.romDir(kind), clean);
        if (replace) writeAtomic(file, bytes);
        else fs.writeFileSync(file, bytes, {flag: 'wx'});
        return clean;
    }
    /** Delete a ROM and its save. Returns false when it did not exist. */
    remove(kind, name) {
        if (!this.has(kind, name)) return false;
        fs.unlinkSync(path.join(this.romDir(kind), name));
        try { fs.unlinkSync(this.saveFile(kind, name)); } catch (_) { /* no save */ }
        if (this.state.last && this.state.last.kind === kind && this.state.last.name === name) {
            this.state.last = null; this.writeState();
        }
        return true;
    }

    /* ---------------- battery saves ---------------- */
    loadSave(kind, name) {
        try {
            const bytes = fs.readFileSync(this.saveFile(kind, name));
            return bytes.length && bytes.length <= MAX_SAVE ? bytes : null;
        } catch (_) { return null; }
    }
    /** Write a save when it differs from what is on disk. Returns true when written. */
    store(kind, name, bytes) {
        if (!bytes || !bytes.length || bytes.length > MAX_SAVE || !allowed(kind, name)) return false;
        const old = this.loadSave(kind, name);
        if (old && old.equals(bytes)) return false;
        mkdir(path.join(this.dir, 'saves')); mkdir(path.join(this.dir, 'saves', kind));
        writeAtomic(this.saveFile(kind, name), bytes);
        return true;
    }

    /* ---------------- last game ---------------- */
    readState() {
        try {
            const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            return s && typeof s === 'object' ? s : {};
        } catch (_) { return {}; }
    }
    writeState() {
        try { writeAtomic(this.stateFile, JSON.stringify(this.state)); } catch (_) { /* best effort */ }
    }
    remember(kind, name) {
        this.state.last = {kind, name, at: Date.now()};
        this.writeState();
    }
    /** The last game, if it still exists: {kind, name, title} or null. Arcade counts too. */
    last() {
        const l = this.state.last;
        if (!l) return null;
        if (l.kind === 'arcade') return {kind: 'arcade', name: 'pong', title: 'Pong'};
        return this.has(l.kind, l.name) ? {kind: l.kind, name: l.name, title: title(l.name)} : null;
    }
}

module.exports = {Library, CONSOLES, EXTENSIONS, MAX_ROM, safeName, allowed, title};
