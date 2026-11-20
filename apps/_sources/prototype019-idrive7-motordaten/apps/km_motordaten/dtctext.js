'use strict';
/**
 * What a fault code means: the fault texts (FORTTEXTE: code -> text) of each unit's SGBD.
 *
 * The texts are BMW's and are not part of this app. The first time the Store has internet (mgu-uplink
 * online), the app downloads the tables of the G87's units from the public SGBD documentation
 * (github.com/emdzej/ediabasx-docs-sgbd) and keeps them in its data folder; from then on they are
 * there without internet. A table that could not be loaded is tried again when there is internet.
 *
 * Units by diagnostic address -> the documentation's file (the SGBD the unit names in 22 F1 50,
 * through the SGBD index of cauliflowermossgrape/idrive7-apps, MIT; read over ENET, docs/g87-s58.md).
 * WAVE_01 (telematics, 0x61) and IHKA_G09 (climate, 0x78) are not documented there.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const dns = require('dns');

const HOST = 'raw.githubusercontent.com';
const BASE = '/emdzej/ediabasx-docs-sgbd/main/docs/sgbd/';
const DOCS = {
    0x01: 'ACSM5', 0x06: 'ICAM2', 0x08: 'SRR01_HR', 0x0F: 'GSD_F90', 0x10: 'ZGW_SP18', 0x12: 'dme8ff_r',
    0x18: 'GSZFBCE', 0x21: 'MRR02', 0x29: 'IB_G05', 0x2A: 'SRR01_HL', 0x2C: 'USS_G05', 0x30: 'EPS_G05',
    0x37: 'RAM01', 0x39: 'VIP_G05', 0x40: 'BDC_G05', 0x43: 'FLM02_L', 0x44: 'FLM02_R', 0x56: 'FZD_G11',
    0x5D: 'KAFAS04', 0x5E: 'GWS_G05', 0x60: 'KOMBSP21', 0x63: 'HU_MGU', 0x67: 'ZBE7', 0x6D: 'FAS_G11',
    0x6E: 'BFS_G11', 0x76: 'VDP_G11'
};
const TIMEOUT_MS = 60000;
const LEASES = (dir) => [path.join(dir, 'uplink.json'), '/run/mgu-uplink/lease.json'];

function dataDir() {
    return process.env.KM_DATA_DIR || path.join(__dirname, '..', '..', 'data');
}

/* The glyphs the screen has: ASCII and German; other letters without their accents, the rest '?'. */
const KEEP = 'ÄÖÜäöüß°';
function clean(s) {
    let out = '';
    for (const ch of String(s).replace(/<br\s*\/?>/gi, ' ').replace(/\\\|/g, '|').replace(/\s+/g, ' ').trim()) {
        const c = ch.charCodeAt(0);
        if ((c >= 32 && c < 127) || KEEP.indexOf(ch) >= 0) {
            out += ch;
        } else {
            const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
            out += /^[\x20-\x7e]+$/.test(base) ? base : '?';
        }
    }
    return out;
}

/**
 * The FORTTEXTE table of a documentation page, fed line by line: rows "| 0xCODE | text | ...".
 * done is true once the table is over.
 */
class TableReader {
    constructor() {
        this.texts = {};
        this.inside = false;
        this.done = false;
        this.rest = '';
    }

    feed(chunk) {
        const lines = (this.rest + chunk).split('\n');
        this.rest = lines.pop();
        lines.forEach((l) => this._line(l));
        return this.done;
    }

    end() {
        this._line(this.rest);
        this.rest = '';
        return this.texts;
    }

    _line(l) {
        if (this.done) {
            return;
        }
        if (/^#{1,6}\s/.test(l)) {
            if (this.inside) {
                this.done = true;
            }
            this.inside = /^###\s+FORTTEXTE\s*$/.test(l.trim());
            return;
        }
        if (!this.inside) {
            return;
        }
        const m = /^\|\s*0x([0-9A-Fa-f]{1,6})\s*\|((?:[^|\\]|\\.)*)\|/.exec(l);
        if (m) {
            this.texts[m[1].toUpperCase().padStart(6, '0')] = clean(m[2]);
        }
    }
}

class DtcTexts {
    constructor(log, dir) {
        this.log = log || { info() {}, warn() {} };
        this.dir = dir || dataDir();
        this.file = path.join(this.dir, 'dtc_texts.json');
        this.tables = {};
        this.busy = null;
        this.lastError = null;
        try {
            this.tables = JSON.parse(fs.readFileSync(this.file, 'utf8')).tables || {};
        } catch (e) {
            this.tables = {};
        }
    }

    /* The text for a fault: a string; null: the table has no such code; undefined: no table (yet). */
    text(ecu, code) {
        if (!DOCS[ecu]) {
            return null;
        }
        const t = this.tables[DOCS[ecu]];
        if (!t) {
            return undefined;
        }
        return t[String(code).toUpperCase().padStart(6, '0')] || null;
    }

    documented(ecu) {
        return !!DOCS[ecu];
    }

    /* How many of the documented units' tables are here, of how many. */
    count() {
        const all = Object.keys(DOCS).map((a) => DOCS[a]);
        return { have: all.filter((d) => this.tables[d]).length, of: all.length };
    }

    complete() {
        const c = this.count();
        return c.have === c.of;
    }

    /* The uplink's lease when the Store is online (mgu-uplink), else null. */
    lease() {
        for (const f of LEASES(this.dir)) {
            try {
                const l = JSON.parse(fs.readFileSync(f, 'utf8'));
                if (l && l.ip) {
                    return l;
                }
            } catch (e) { /* not there */ }
        }
        return null;
    }

    /**
     * Downloads the tables not here yet (the units with faults first), one after the other, and keeps
     * each as it comes. Resolves to the number loaded; does nothing without internet.
     */
    sync(first, fetchDoc) {
        if (this.busy) {
            return this.busy;
        }
        const lease = fetchDoc ? {} : this.lease();
        if (!lease || this.complete()) {
            return Promise.resolve(0);
        }
        const get = fetchDoc || ((doc) => this._fetch(doc, lease));
        const order = Array.from(new Set((first || []).filter((a) => DOCS[a]).concat(Object.keys(DOCS).map(Number))))
            .map((a) => DOCS[a]).filter((d, i, all) => all.indexOf(d) === i && !this.tables[d]);
        let loaded = 0;
        this.busy = order.reduce((p, doc) => p.then(() => get(doc).then((texts) => {
            if (Object.keys(texts).length) {
                this.tables[doc] = texts;
                loaded++;
                this._save();
                this.log.info(`fault texts: ${doc} ${Object.keys(texts).length}`);
            }
        }, (err) => {
            this.lastError = err && err.message;
            this.log.warn(`fault texts: ${doc}: ${this.lastError}`);
        })), Promise.resolve())
            .then(() => { this.busy = null; return loaded; });
        return this.busy;
    }

    _save() {
        try {
            fs.mkdirSync(this.dir);
        } catch (e) { /* there */ }
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ source: `https://${HOST}${BASE}`, tables: this.tables }));
        fs.renameSync(tmp, this.file);
    }

    /* Resolves the host through the uplink's DNS (the unit's own resolver has no internet). */
    _resolve(lease) {
        return new Promise((resolve, reject) => {
            const servers = (lease.dns || []).filter(Boolean);
            if (dns.Resolver && servers.length) {
                const r = new dns.Resolver();
                r.setServers(servers);
                r.resolve4(HOST, (err, ips) => (err || !ips.length ? reject(err || new Error('kein DNS')) : resolve(ips[0])));
            } else {
                dns.lookup(HOST, 4, (err, ip) => (err ? reject(err) : resolve(ip)));
            }
        });
    }

    _fetch(doc, lease) {
        return this._resolve(lease).then((ip) => new Promise((resolve, reject) => {
            const reader = new TableReader();
            const req = https.get({
                host: HOST, path: BASE + doc + '.md', servername: HOST,
                lookup: (h, o, cb) => (o && o.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4))
            }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    if (reader.feed(chunk)) {
                        req.abort();            // the table is over: the rest of the page is not needed
                        resolve(reader.end());
                    }
                });
                res.on('end', () => resolve(reader.end()));
                res.on('error', reject);
            });
            req.setTimeout(TIMEOUT_MS, () => { req.abort(); reject(new Error('Zeitüberschreitung')); });
            req.on('error', (err) => (reader.done ? undefined : reject(err)));
        }));
    }
}

module.exports = { DtcTexts, TableReader, clean, DOCS };
