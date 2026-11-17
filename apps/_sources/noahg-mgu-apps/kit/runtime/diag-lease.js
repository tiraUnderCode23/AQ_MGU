'use strict';
const fs = require('fs');
const FILE = '/run/mgu-obd-adapter/tasu-owner.json';
function check(read, now) {
    read = read || (() => fs.readFileSync(FILE, 'utf8'));
    now = now === undefined ? Date.now() : now;
    let lease;
    try { const data = read(); if (data.length > 1024) return; lease = JSON.parse(data); } catch (e) { return; }
    // Updated consumers queue in Diag; this synchronous UI check must not
    // reject an operation simply because another transaction is in flight.
    if (lease && lease.coordinated === true) return;
    if (lease && typeof lease.expiresAt === 'number' && lease.expiresAt > now && lease.expiresAt <= now + 10000) {
        throw new Error('diagnostic transport owned by OBD Bridge');
    }
}
module.exports = { check };
