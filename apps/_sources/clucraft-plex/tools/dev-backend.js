'use strict';
/**
 * dev-backend.js - what the app talks to when it runs in the kit's emulator on a PC: the real Drive-In service
 * (native/clucraft-plex) on a local TCP port, against the stand-in plex.tv and server (tools/mock-plex.js: an
 * invented library), with the tests' stand-in player (test/fake-player.js: it counts the film's bytes on a clock,
 * and draws and plays nothing).
 *
 *   node tools/dev-backend.js [port]          default 8078; then start the app with PLEXD_SOCK=<port>
 *
 * Sign-in: "Get a code" in the app is linked at once (nobody has to type it anywhere). The account lives in a
 * temporary folder and is gone when this ends.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { createMock } = require('./mock-plex');
const { createService } = require('../native/clucraft-plex/service');

const PORT = Number(process.argv[2]) || 8078;
const quiet = process.env.BACKEND_LOG ? console.log.bind(console) : () => {};

(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drivein-dev-'));
    const mock = await createMock({ linked: true, filmSeconds: Number(process.env.MOCK_FILM_S) || 0 });
    // (the head unit "is online": the service reads mgu-uplink's lease for its status)
    fs.writeFileSync(path.join(tmp, 'lease.json'), JSON.stringify({ interface: 'emulator', ip: '127.0.0.1', dns: [] }));
    const say = console.log.bind(console);
    console.log = quiet;                                   // the service's own log lines (BACKEND_LOG=1 shows them)
    const svc = createService({
        stateDir: path.join(tmp, 'state'), uid: null, exit: false, leasePath: path.join(tmp, 'lease.json'),
        childEnv: { PLEXD_TV: mock.url, PLEXD_SYSTEM_DNS: '1' },
        playerBin: process.execPath, playerArgs: [path.join(__dirname, '..', 'test', 'fake-player.js')], playerCwd: tmp, videoPath: path.join(tmp, 'video'),
        playerEnv: { FAKE_SPEED: process.env.FAKE_SPEED || '1' },
        watchMs: 24 * 3600 * 1000,
    });
    const server = net.createServer();
    svc.serve(server);
    server.listen(PORT, '127.0.0.1', () => {
        svc.start();
        say('dev-backend: the Drive-In service on 127.0.0.1:' + PORT + ' (PLEXD_SOCK=' + PORT + '), a mock Plex server at ' + mock.url);
    });
    const end = () => { try { svc.stop(0); } catch (e) { /* ending */ } setTimeout(() => process.exit(0), 300); };
    process.on('SIGINT', end); process.on('SIGTERM', end);
})().catch((e) => { console.error('dev-backend: ' + (e && e.stack || e)); process.exit(1); });
