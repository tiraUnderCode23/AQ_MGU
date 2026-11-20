'use strict';
/**
 * The records: each value's highest over all drives, with when it was set, kept in the data folder
 * (data/records.json) until cleared. offer(key, value, at) takes a drive's maximum; the file is written at most
 * every SAVE_MS, and on flush().
 *
 * Copyright (c) 2026 Prototype019. All rights reserved (LICENSE).
 */

const fs = require('fs');
const path = require('path');

const SAVE_MS = 10000;

function dir() {
    return process.env.KM_DATA_DIR || path.join(__dirname, '..', '..', 'data');
}

class Records {
    constructor() {
        this.file = path.join(dir(), 'records.json');
        this.best = {};             // key -> { v, at: ms (the car's wall clock, clock.wall) }
        this.changed = false;
        this.timer = null;
        try {
            const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
            Object.keys(saved).forEach((k) => {
                const r = saved[k];
                if (r && typeof r.v === 'number' && isFinite(r.v) && typeof r.at === 'number') {
                    this.best[k] = { v: r.v, at: r.at };
                }
            });
        } catch (e) {
            this.best = {};
        }
    }

    /* A drive's value for key: a new record when it beats the kept one. True when it did. */
    offer(key, v, at) {
        if (typeof v !== 'number' || !isFinite(v)) {
            return false;
        }
        const r = this.best[key];
        if (r && !(v > r.v)) {
            return false;
        }
        this.best[key] = { v, at };
        this.changed = true;
        if (!this.timer) {
            this.timer = setTimeout(() => this.flush(), SAVE_MS);
        }
        return true;
    }

    clear() {
        this.best = {};
        this.changed = true;
        this.flush();
    }

    flush() {
        clearTimeout(this.timer);
        this.timer = null;
        if (!this.changed) {
            return;
        }
        this.changed = false;
        try {
            try {
                fs.mkdirSync(dir());
            } catch (e) { /* there */ }
            const tmp = `${this.file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(this.best));
            fs.renameSync(tmp, this.file);
        } catch (e) {
            this.changed = true;
        }
    }
}

module.exports = { Records };
