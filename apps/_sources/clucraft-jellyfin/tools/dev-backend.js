'use strict';
/**
 * dev-backend.js - what the app talks to when it runs in the kit's emulator on a PC: the real Drivefin service
 * (native/clucraft-jellyfin) on a local TCP port, with the tests' stand-in player (test/fake-player.js: it keeps the
 * film's time, and draws and plays nothing), and a stand-in Jellyfin server (tools/mock-jellyfin.js: an invented
 * library) that the service already knows the address of.
 *
 *   node tools/dev-backend.js [port]          default 8078; then start the app with JFD_SOCK=<port>
 *
 * Sign-in: the page opens at Quick Connect for the stand-in server, and "Get a code" signs in at once (nobody has to
 * enter the code anywhere; with MOCK_LINKED=0 it waits until <the mock's address>/mock/link is opened). Its name and
 * password are in tools/mock-jellyfin.js (USER, PASSWORD).
 *
 * A real server: "Other server" on the sign-in page takes any address this PC reaches, and Quick Connect then works
 * as in the car (the code is entered in your own Jellyfin). Its films are read as in the car; the stand-in player
 * keeps their time from the stream's own clock, so the place the server is told is the true one.
 *
 * The sign-in lives in a temporary folder and is gone when this ends (DEV_STATE=<folder> keeps it there instead).
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { createMock } = require('./mock-jellyfin');
const { createService } = require('../native/clucraft-jellyfin/service');

const PORT = Number(process.argv[2]) || 8078;
const quiet = process.env.BACKEND_LOG ? console.log.bind(console) : () => {};

(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drivefin-dev-'));
    const state = process.env.DEV_STATE ? path.resolve(process.env.DEV_STATE) : path.join(tmp, 'state');
    const o = { linked: process.env.MOCK_LINKED !== '0', filmSeconds: Number(process.env.MOCK_FILM_S) || 0 };
    // Jellyfin's own port where it is free, so that "localhost" typed on the sign-in page finds the stand-in
    const mock = await createMock(Object.assign({ port: Number(process.env.MOCK_PORT) || 8096 }, o)).catch(() => createMock(o));
    // (the head unit "is online": the service reads mgu-uplink's lease for its status)
    fs.writeFileSync(path.join(tmp, 'lease.json'), JSON.stringify({ interface: 'emulator', ip: '127.0.0.1', dns: [] }));
    fs.mkdirSync(state, { recursive: true });
    if (!fs.existsSync(path.join(state, 'server.json')) && !fs.existsSync(path.join(state, 'account.json'))) {
        fs.writeFileSync(path.join(state, 'server.json'), JSON.stringify({ url: mock.url, id: null, name: 'Jupiter', version: '10.11.0', quick: true }));
    }
    const say = console.log.bind(console);
    console.log = quiet;                                   // the service's own log lines (BACKEND_LOG=1 shows them)
    const svc = createService({
        stateDir: state, uid: null, exit: false, leasePath: path.join(tmp, 'lease.json'),
        childEnv: { JFD_SYSTEM_DNS: '1' },
        playerBin: process.execPath, playerArgs: [path.join(__dirname, '..', 'test', 'fake-player.js')], playerCwd: tmp, videoPath: path.join(tmp, 'video'),
        playerEnv: { FAKE_SPEED: process.env.FAKE_SPEED || '1' },
        watchMs: 24 * 3600 * 1000,
    });
    const server = net.createServer();
    svc.serve(server);
    server.listen(PORT, '127.0.0.1', () => {
        svc.start();
        say('dev-backend: the Drivefin service on 127.0.0.1:' + PORT + ' (JFD_SOCK=' + PORT + '), a mock Jellyfin server at ' + mock.url);
    });
    const end = () => { try { svc.stop(0); } catch (e) { /* ending */ } setTimeout(() => process.exit(0), 300); };
    process.on('SIGINT', end); process.on('SIGTERM', end);
})().catch((e) => { console.error('dev-backend: ' + (e && e.stack || e)); process.exit(1); });
