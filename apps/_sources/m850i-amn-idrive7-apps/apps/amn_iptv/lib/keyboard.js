'use strict';
/* amn_iptv: from leschi/mgu-media-client (apps/media/keyboard.js), used unchanged below this note. MIT, Copyright (c) 2026 Leopold Poechinger / IbexData GmbH: see LICENSE.third-party. */
/**
 * keyboard.js - the model for the on-screen keyboard and the text fields it edits. Pure logic (no
 * drawing, no SDK) so it is unit-tested on a PC. main.js draws the grid this returns and feeds it
 * taps (touch) or cursor moves + press (the iDrive controller).
 *
 * The keyboard is how the user enters the host/IP, port, username and password - the head unit's
 * app settings only offer choices, not free text, so the app brings its own keyboard. The same
 * keyboard, in "remote" mode, also sends keystrokes to the VNC server once connected.
 *
 * Layers: 'abc' lower case, 'ABC' upper case, '123' digits and symbols. Special key ids start with
 * a '#': #shift #layer #back #space #enter #left #right #clear. Everything else is the literal
 * character the key inserts.
 */

const LAYERS = {
    abc: [
        'qwertyuiop'.split(''),
        'asdfghjkl'.split(''),
        ['#shift', ...'zxcvbnm'.split(''), '#back'],
        ['#layer', '.', '#space', '-', '_', '#enter'],
    ],
    ABC: [
        'QWERTYUIOP'.split(''),
        'ASDFGHJKL'.split(''),
        ['#shift', ...'ZXCVBNM'.split(''), '#back'],
        ['#layer', '.', '#space', '-', '_', '#enter'],
    ],
    123: [
        '1234567890'.split(''),
        ['.', ':', '/', '@', '-', '_', '~', '?', '#', '%'],
        ['#shift', '!', '$', '&', '*', '+', '=', ',', '#back'],
        ['#layer', '(', '#space', ')', '"', '#enter'],
    ],
};

/** Keyboard state machine. `onEnter` and `onClear` are surfaced to the caller as actions. */
class Keyboard {
    constructor(layer = 'abc') {
        this.layer = LAYERS[layer] ? layer : 'abc';
        this.row = 0;
        this.col = 0;
    }

    rows() { return LAYERS[this.layer]; }
    rowCount() { return LAYERS[this.layer].length; }
    colCount(row) { return LAYERS[this.layer][row].length; }

    /** The key id at the cursor. */
    current() {
        const r = LAYERS[this.layer][Math.min(this.row, this.rowCount() - 1)];
        return r[Math.min(this.col, r.length - 1)];
    }

    /** Move the cursor for a controller tilt/turn: 'up' | 'down' | 'left' | 'right'. */
    move(dir) {
        if (dir === 'up') this.row = (this.row - 1 + this.rowCount()) % this.rowCount();
        else if (dir === 'down') this.row = (this.row + 1) % this.rowCount();
        else if (dir === 'left') this.col = (this.col - 1 + this.colCount(this.row)) % this.colCount(this.row);
        else if (dir === 'right') this.col = (this.col + 1) % this.colCount(this.row);
        if (this.col >= this.colCount(this.row)) this.col = this.colCount(this.row) - 1;
        return this.current();
    }

    setCursor(row, col) {
        this.row = Math.max(0, Math.min(row, this.rowCount() - 1));
        this.col = Math.max(0, Math.min(col, this.colCount(this.row) - 1));
    }

    toggleShift() { this.layer = this.layer === 'abc' ? 'ABC' : 'abc'; this._clamp(); }
    toggleLayer() { this.layer = this.layer === '123' ? 'abc' : '123'; this._clamp(); }
    _clamp() { this.row = Math.min(this.row, this.rowCount() - 1); this.col = Math.min(this.col, this.colCount(this.row) - 1); }

    /**
     * Apply a key id to a text field (see makeField). Special keys that are not field edits
     * (#enter, #clear) return an action string instead of mutating the field; #shift / #layer
     * change the keyboard; everything else edits the field. Returns { action } or { edited:true }.
     */
    apply(id, field) {
        switch (id) {
            case '#shift': this.toggleShift(); return { action: 'shift' };
            case '#layer': this.toggleLayer(); return { action: 'layer' };
            case '#enter': return { action: 'enter' };
            case '#clear': field.value = ''; field.caret = 0; return { edited: true };
            case '#back': backspace(field); return { edited: true };
            case '#left': field.caret = Math.max(0, field.caret - 1); return { edited: true };
            case '#right': field.caret = Math.min(field.value.length, field.caret + 1); return { edited: true };
            case '#space': insert(field, ' '); return { edited: true };
            default: insert(field, id); return { edited: true };
        }
    }
}

/* ---------------- text field ---------------- */
function makeField(value = '', opts = {}) {
    return { value: String(value), caret: String(value).length, mask: !!opts.mask, max: opts.max || 255 };
}
function insert(field, ch) {
    if (field.value.length >= field.max) return;
    field.value = field.value.slice(0, field.caret) + ch + field.value.slice(field.caret);
    field.caret += ch.length;
}
function backspace(field) {
    if (field.caret === 0) return;
    field.value = field.value.slice(0, field.caret - 1) + field.value.slice(field.caret);
    field.caret -= 1;
}
/** What to show for a field (password fields show '*': the car's font has no bullet glyph). */
function display(field) { return field.mask ? '*'.repeat(field.value.length) : field.value; }

module.exports = { Keyboard, LAYERS, makeField, insert, backspace, display };
