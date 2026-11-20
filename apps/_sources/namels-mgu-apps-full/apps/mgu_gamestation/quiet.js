'use strict';

// The vendored SNES and Game Boy engines print debug lines (watchpoints, ROM checks)
// with console.log. On the head unit that ends up in the journal many times a second.
// quiet(fn) runs fn with console.log/info/debug muted; warnings and errors still pass.
const noop = function () {};

function quiet(fn) {
    const log = console.log, info = console.info, debug = console.debug;
    console.log = noop; console.info = noop; console.debug = noop;
    try { return fn(); }
    finally { console.log = log; console.info = info; console.debug = debug; }
}

module.exports = {quiet};
