'use strict';
/*
 * Light Logger: the journal's lines in a text file as well, so a whole drive can be read afterwards (over SSH, or
 * copied off the head unit). The first folder of dirs that takes a write is used; the file is started again
 * (the old one kept as .1) once it passes maxBytes.
 *
 *   const f = new LogFile(['/var/opt/ida_lightlog', os.tmpdir()], 'lightlog.txt');
 *   f.path -> where it writes, or null      f.write('a line')
 */
const fs = require('fs');
const path = require('path');

class LogFile {
    constructor(dirs, name, maxBytes) {
        this.max = maxBytes || 1024 * 1024;
        this.path = null;
        this.error = null;
        for (let i = 0; i < dirs.length && !this.path; i++) {
            const d = dirs[i];
            if (!d) continue;
            const p = path.join(d, name);
            try {
                try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') throw e; }    // Node 8: no recursive
                fs.appendFileSync(p, '');
                this.path = p;
            } catch (e) { this.error = e.message; }
        }
    }

    write(text) {
        if (!this.path) return false;
        try {
            let size = 0;
            try { size = fs.statSync(this.path).size; } catch (e) { /* new */ }
            if (size > this.max) fs.renameSync(this.path, this.path + '.1');
            fs.appendFileSync(this.path, text + '\n');
            return true;
        } catch (e) {
            this.error = e.message;
            return false;
        }
    }
}

module.exports = { LogFile };
