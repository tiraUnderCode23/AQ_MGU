'use strict';

// A requested OAP shutdown must let actuator apps return ECU control before
// process exit. Existing apps without handlers retain the original delay.
function install(app, log, options) {
    const o = options || {};
    const later = o.setTimer || setTimeout, cancel = o.clearTimer || clearTimeout;
    const exit = o.exit || (code => process.exit(code));
    const handlers = [];
    let running = false;
    app.on('shutdown', () => {
        if (running) return;
        running = true;
        log.info('shutdown requested by MainApp');
        if (!handlers.length) { later(() => exit(0), 200); return; }
        let finished = false;
        const finish = () => { if (!finished) { finished = true; exit(0); } };
        const deadline = later(() => { log.warn('shutdown cleanup timed out'); finish(); }, 10000);
        Promise.all(handlers.map(fn => Promise.resolve().then(fn).catch(error => log.warn('shutdown cleanup: ' + error))))
            .then(() => { cancel(deadline); finish(); });
    });
    return fn => { if (typeof fn !== 'function') throw new Error('Shutdown handler must be a function'); handlers.push(fn); };
}

module.exports = { install };
