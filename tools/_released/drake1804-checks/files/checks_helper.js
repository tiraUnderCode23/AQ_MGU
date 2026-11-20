'use strict';
/**
 * The root half of the YouTube Checks app. An app cannot read the journal or play a tone, so this does, and the app prints what it says
 * on the car's screen, for a photo. See ../README.md. Node 8, the unit's own.
 *
 * /run/drake1804-checks/ctl.sock, mode 0660, group tm_oap_app. One command a line, one JSON line back. Only the commands in JOBS exist.
 * Nothing from the socket reaches a shell or names a file. A sound device must be one ytaudio has just listed, and not one it leaves alone.
 * Everything that leaves here is cleaned first, as collect-logs.sh does, because it ends up in a photo.
 *
 * It holds no account's tokens and never opens the player's state folder, but for the name of the saved sound device, through ytaudio.
 */
const cp = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const VERSION = '0.1.2';
const R = process.env.CHECKS_ROOT || '';            // tests only: a fake tree. Empty on the car.
const r = (p) => `${R}${p}`;
const SOCKET = process.env.CHECKS_SOCKET || r('/run/drake1804-checks/ctl.sock');
const GROUP = process.env.CHECKS_GROUP || 'tm_oap_app';
const RESULTS = r('/var/opt/drake1804-checks/results.log');
const YTAUDIO = r('/var/opt/drake1804-ytplay/current/ytaudio');
const PLAYER_LOG = r('/var/opt/drake1804-ytplay/log');
const PLAYER_SOCKET = process.env.CHECKS_PLAYER_SOCKET || r('/run/drake1804-ytplay/ctl.sock');
const DEPLOY = r('/var/opt/mgu-deploy/mgu-deploy.sh');
const OAP = r('/var/opt/public/oap');
const PROBE_OUT = r('/tmp/bube-audio-probe');
const LEASE = r('/run/mgu-uplink/lease.json');
const TEST_VIDEO = process.env.CHECKS_TEST_VIDEO || 'dQw4w9WgXcQ';
const BARS_S = Number(process.env.CHECKS_BARS_S || 15);
const RATE_S = Number(process.env.CHECKS_RATE_S || 30);
const PLAY_S = Number(process.env.CHECKS_PLAY_S || 30);

const UNITS = ['drake1804-ytplay', 'drake1804-checks', 'mgu-render', 'mgu-render-hmi', 'mgu-uplink', 'mgu-updater', 'carplay',
    'avbstreamhandler', 'avbsourcesinkcontroller', 'mediaengine', 'mediaapp'];
const LEVELS = ['-30', '-20'];
const PROBE_LABELS = ['idle', 'playing', 'after'];
const MAX_OUT = 512 * 1024;
const MAX_LINE = 400;
const MAX_REQUEST = 4096;
const RESULTS_MAX = 64 * 1024;
const LOG_TAIL = 64 * 1024;
const GOOD_FPS = 28;
const SIMD = ['ssse3', 'sse4_1', 'sse4_2', 'avx', 'avx2', 'aes'];
const DRI_FOLDERS = ['/usr/lib/dri', '/usr/lib64/dri', '/usr/lib/x86_64-linux-gnu/dri'];
const LIB_ROOTS = ['/usr', '/lib', '/lib64', '/opt'];
const VIDEO_LIBS = ['*_drv_video.so', 'libva*.so*', 'libmfx*', 'libigdgmm*', 'libigfxcmrt*', 'libgstvaapi*', 'vainfo'];
const LIB_SEARCH_MS = 20000;
const MAX_LIBS = 30;

const say = (m) => console.log(m);

/* As collect-logs.sh: the path and query of links, phone addresses, VIN-shaped words and tokens. And e-mail addresses, for the player's account. */
function clean(text) {
    return String(text)
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
        .replace(/(https?:\/\/[^/ "']*)[^ "']*/g, '$1/...')
        .replace(/([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/g, '<mac>')
        .replace(/[A-HJ-NPR-Z0-9]{17}/g, '<17-chars>')
        .replace(/(token"?[:=] *"?)[^", ]*/g, '$1<removed>')
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
}
const cleanLines = (lines) => lines.map((l) => {
    const s = clean(l);
    return s.length > MAX_LINE ? `${s.slice(0, MAX_LINE)}...` : s;
});
const linesOf = (text) => String(text || '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l);

/* A program with its own arguments, never a shell: { code, out, timedOut }. out is the end of what it wrote. */
function run(cmd, args, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
        let out = '', done = false, timedOut = false, timer = null;
        const finish = (code) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({ code, out, timedOut });
        };
        const take = (d) => { out = (out + d).slice(-MAX_OUT); };
        let child;
        try {
            child = cp.spawn(cmd, args, { cwd: R || '/', stdio: ['ignore', 'pipe', o.stdoutOnly ? 'ignore' : 'pipe'],
                env: Object.assign({}, process.env, { LC_ALL: 'C', SYSTEMD_COLORS: '0', SYSTEMD_PAGER: '' }, o.env || {}) });
        } catch (e) {
            out = `${cmd}: ${e.code || e.message}`;
            finish(-1);
            return;
        }
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', take);
        if (child.stderr) {
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', take);
        }
        child.on('error', (e) => {
            out = `${cmd}: ${e.code || e.message}`;
            finish(-1);
        });
        child.on('close', (code) => finish(code === null ? -1 : code));
        timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
            /* a grandchild that keeps the pipe open must not hold this up */
            timer = setTimeout(() => finish(-1), 2000);
        }, o.ms || 10000);
    });
}

function read(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (e) {
        return null;
    }
}
function list(dir) {
    try {
        return fs.readdirSync(dir).sort();
    } catch (e) {
        return null;
    }
}
function exists(file) {
    try {
        fs.statSync(file);
        return true;
    } catch (e) {
        return false;
    }
}

/* A file's last n lines, or null. */
function tail(file, n) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(fd).size;
        const want = Math.min(size, LOG_TAIL);
        const b = Buffer.alloc(want);
        fs.readSync(fd, b, 0, want, size - want);
        return linesOf(b.toString('utf8')).slice(-n);
    } catch (e) {
        return null;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

function journal(args, n) {
    return run('journalctl', ['--no-pager', '-o', 'short-monotonic', '-n', String(n)].concat(args), { ms: 20000 });
}

/* A line for the results log, which outlives a restart of the unit, so that the next report shows what was tried before it. */
function note(line) {
    const stamped = `${new Date().toISOString().slice(0, 19)} ${line}`;
    say(stamped);
    try {
        fs.appendFileSync(RESULTS, `${clean(stamped)}\n`);
        if (fs.statSync(RESULTS).size > RESULTS_MAX) fs.writeFileSync(RESULTS, `${tail(RESULTS, 200).join('\n')}\n`);
    } catch (e) {
        say(`results log: ${e.message}`);
    }
}

/* ---- the player's socket ---- */

function playerLine() {
    const s = net.connect(PLAYER_SOCKET);
    let buf = '', error = null;
    const waiting = [];
    const fail = (why) => {
        error = why;
        while (waiting.length) waiting.shift().resolve({ ok: false, error: why });
    };
    s.setEncoding('utf8');
    s.on('error', (e) => fail(e.code || e.message));
    s.on('close', () => fail('the player closed the connection'));
    s.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            const w = waiting.shift();
            if (!w) continue;
            clearTimeout(w.timer);
            try {
                w.resolve(JSON.parse(line));
            } catch (e) {
                w.resolve({ ok: false, error: 'not JSON' });
            }
        }
    });
    return {
        ask(line, ms) {
            return new Promise((resolve) => {
                if (error) {
                    resolve({ ok: false, error });
                    return;
                }
                const w = { resolve, timer: setTimeout(() => {
                    const at = waiting.indexOf(w);
                    if (at >= 0) waiting.splice(at, 1);
                    resolve({ ok: false, error: `no answer in ${Math.round((ms || 3000) / 1000)} s` });
                }, ms || 3000) };
                waiting.push(w);
                s.write(`${line}\n`);
            });
        },
        close() { s.destroy(); }
    };
}

function playerLinesOf(st) {
    if (!st.ok) return [`no answer: ${st.error}`];
    const line = ['state', 'id', 'pos', 'dur', 'buffered', 'frames', 'dropped', 'w', 'h', 'fps', 'live', 'online', 'quality'];
    const sound = ['sound', 'audio', 'audioDevice', 'audioError', 'audioDrift', 'audioUnderruns'];
    const words = (keys) => keys.filter((k) => st[k] !== undefined && st[k] !== '').map((k) => `${k}=${st[k]}`).join(' ');
    return [words(line), words(sound)].concat(st.error ? [`error: ${st.error}`] : []).filter((l) => l);
}

/* ---- what the report holds: each part is { title, lines, verdicts: [[word, text]] } ---- */

const verdict = (word, text) => [word, text];

function fmtSpan(s) {
    const t = Math.floor(s);
    return t >= 3600 ? `${Math.floor(t / 3600)} h ${Math.floor(t / 60) % 60} min` : `${Math.floor(t / 60)} min ${t % 60} s`;
}

async function partUnit() {
    const lines = [`Clock on the car: ${new Date().toISOString().slice(0, 19)}`];
    const up = Number((read(r('/proc/uptime')) || '').split(' ')[0]);
    if (up) lines.push(`Up ${fmtSpan(up)}, load ${(read(r('/proc/loadavg')) || '?').trim()}`);
    const kernel = await run('uname', ['-r']);
    lines.push(`Kernel ${kernel.out.trim()}, node ${process.version}, helper ${VERSION}`);
    linesOf(read(r('/etc/os-release'))).filter((l) => /^(NAME|PRETTY_NAME|VERSION|VERSION_ID|BUILD_ID|IMAGE_[A-Z_]*)=/.test(l)).slice(0, 8).forEach((l) => lines.push(l));
    const mem = {};
    linesOf(read(r('/proc/meminfo'))).forEach((l) => {
        const m = /^(MemTotal|MemAvailable):\s+(\d+)/.exec(l);
        if (m) mem[m[1]] = Math.round(Number(m[2]) / 1024);
    });
    if (mem.MemTotal) lines.push(`Memory ${mem.MemAvailable} of ${mem.MemTotal} MB free`);
    const temps = (list(r('/sys/class/thermal')) || []).filter((n) => /^thermal_zone/.test(n))
        .map((n) => Number(read(r(`/sys/class/thermal/${n}/temp`))) / 1000).filter((t) => t > 0);
    if (temps.length) lines.push(`Hottest sensor ${Math.max.apply(null, temps).toFixed(0)} C`);
    const df = await run('df', ['-k', r('/var/opt'), r('/tmp')]);
    linesOf(df.out).forEach((l) => lines.push(l));
    let free = null;
    linesOf(df.out).slice(1, 2).forEach((l) => {
        const words = l.split(/\s+/);
        if (words.length >= 4) free = Number(words[3]);
    });
    const verdicts = [];
    if (free !== null && free < 50 * 1024) verdicts.push(verdict('WARN', `Only ${Math.round(free / 1024)} MB free in /var/opt`));
    if (up) verdicts.push(verdict('INFO', `Head unit up ${fmtSpan(up)}`));
    return { title: 'Head unit', lines, verdicts };
}

/* Whether the GPU could take decoding from the CPU: its device, its kernel driver, and a video driver for it. This only looks: nothing here opens the GPU. */
async function partHardwareDecode() {
    const lines = [];
    const cpu = linesOf(read(r('/proc/cpuinfo')));
    const field = (name) => {
        const line = cpu.find((l) => l.startsWith(name));
        return line ? line.slice(line.indexOf(':') + 1).trim() : '';
    };
    const threads = cpu.filter((l) => /^processor\s*:/.test(l)).length;
    const simd = field('flags').split(' ').filter((f) => SIMD.indexOf(f) >= 0);
    lines.push(threads ? `CPU ${field('model name') || 'of unknown model'}, ${threads} threads, with ${simd.join(' ') || 'no SIMD this looks for'}` : 'CPU: /proc/cpuinfo says nothing');

    const nodes = (list(r('/dev/dri')) || []).filter((n) => /^(card|renderD)\d+$/.test(n));
    nodes.forEach((n) => {
        const st = fs.statSync(r(`/dev/dri/${n}`));
        lines.push(`/dev/dri/${n}: mode ${(st.mode & 0o7777).toString(8)}, owner ${st.uid}:${st.gid}`);
    });
    if (!nodes.length) lines.push('/dev/dri: no GPU device');
    const gpu = linesOf(read(r('/sys/class/drm/card0/device/uevent'))).filter((l) => /^(DRIVER|PCI_ID)=/.test(l));
    lines.push(gpu.length ? `Kernel: ${gpu.join(', ')}` : 'Kernel: says nothing of a GPU in /sys/class/drm/card0');
    DRI_FOLDERS.forEach((d) => {
        const names = list(r(d));
        if (names) lines.push(`${d}: ${names.join(' ') || 'empty'}`);
    });

    const roots = LIB_ROOTS.map(r).filter(exists);
    const args = VIDEO_LIBS.reduce((all, name, i) => all.concat(i ? ['-o', '-name', name] : ['-name', name]), roots);
    const search = roots.length ? await run('find', args, { ms: LIB_SEARCH_MS, stdoutOnly: true }) : { code: 0, out: '', timedOut: false };
    const failed = search.code < 0 && !search.timedOut;
    const found = failed ? [] : linesOf(search.out).map((l) => l.slice(R.length)).sort();
    lines.push(`Video drivers and libraries in ${LIB_ROOTS.join(' ')}:`);
    found.slice(0, MAX_LIBS).forEach((l) => lines.push(l));
    if (found.length > MAX_LIBS) lines.push(`and ${found.length - MAX_LIBS} more`);
    if (!found.length && !failed) lines.push('none found');
    if (failed) lines.push(`The search could not run: ${search.out}`);
    if (search.timedOut) lines.push(`The search ran out of time after ${LIB_SEARCH_MS / 1000} s: there may be more`);

    const node = nodes.find((n) => n.startsWith('renderD')) || nodes[0];
    const drivers = found.filter((l) => /_drv_video\.so$/.test(l)).map((l) => path.basename(l));
    let says = 'Hardware decode: no GPU device in /dev/dri';
    if (node && drivers.length) says = `Hardware decode may work: GPU device ${node}, video driver ${drivers.join(' ')}`;
    else if (node) says = `Hardware decode needs a video driver: GPU device ${node}, no driver found`;
    return { title: 'Hardware decode', lines, verdicts: [verdict('INFO', says)] };
}

async function partInstalled() {
    if (!exists(DEPLOY)) return { title: 'Installed', lines: [`${DEPLOY} is not there: the Store's deploy tool is missing`], verdicts: [verdict('FAIL', 'The deploy tool is missing')] };
    const res = await run('sh', [DEPLOY, 'status', '--json'], { ms: 40000, stdoutOnly: true });
    const last = linesOf(res.out).pop() || '';
    let s = null;
    try {
        s = JSON.parse(last);
    } catch (e) {
        return { title: 'Installed', lines: [`deploy status gave no JSON, exit ${res.code}${res.timedOut ? ' (timed out)' : ''}`].concat(linesOf(res.out).slice(-20)),
            verdicts: [verdict('WARN', 'The deploy tool gave no status')] };
    }
    const lines = [`Deploy tool ${s.version}, ${(s.unit && s.unit.hmi) || 'unknown HMI'}, firmware ${(s.unit && s.unit.firmware) || 'unknown'}`];
    const comps = s.components || [];
    const verdicts = [];
    comps.filter((c) => c.kind === 'tool').forEach((c) => {
        const units = (c.units || []).map((u) => `${u.name.replace(/\.service$/, '')} ${u.enabled}/${u.active}`).join(', ');
        lines.push(`tool ${c.id} ${c.version}${c.previous ? ` (was ${c.previous})` : ''}: ${units}`);
    });
    comps.filter((c) => c.kind === 'app').forEach((c) => {
        lines.push(`app ${c.id} ${c.version} uid ${c.uid} running=${c.running} tile provisioned=${c.tile_provisioned} fallback=${c.tile_fallback} visible=${c.tile_visible}`);
    });
    (s.pending_reboot || []).forEach((p) => {
        lines.push(`pending restart: ${p.id}: ${p.reason}`);
        verdicts.push(verdict('WARN', `Waits for a restart of the head unit: ${p.id} (${p.reason})`));
    });
    if (s.last_verify) lines.push(`last verify: ${JSON.stringify(s.last_verify)}`);
    ['crash_list', 'service_limits', 'live_installs'].forEach((k) => {
        if (s[k]) lines.push(`${k}: ${s[k].state} (${s[k].reason})`);
    });
    const app = comps.find((c) => c.id === 'drake1804_youtube');
    const tool = comps.find((c) => c.id === 'drake1804-ytplay');
    const render = comps.find((c) => c.id === 'mgu-render' || c.provides === 'renderer');
    verdicts.push(render ? verdict('OK', `Renderer ${render.id} ${render.version} installed`) : verdict('FAIL', 'No renderer installed'));
    verdicts.push(tool ? verdict('OK', `YouTube player tool ${tool.version} installed`) : verdict('WARN', 'YouTube player tool not installed'));
    if (!app) verdicts.push(verdict('WARN', 'YouTube app not installed'));
    else verdicts.push(verdict(app.tile_visible === false ? 'WARN' : 'OK', `YouTube app ${app.version} installed, running=${app.running}, tile visible=${app.tile_visible}`));
    return { title: 'Installed', lines, verdicts };
}

async function partServices() {
    const lines = [], verdicts = [];
    for (const u of UNITS) {
        const res = await run('systemctl', ['show', '-p', 'LoadState', '-p', 'ActiveState', '-p', 'SubState', '-p', 'NRestarts', '-p', 'Result', '-p', 'ExecMainStatus', `${u}.service`]);
        const f = {};
        linesOf(res.out).forEach((l) => {
            const at = l.indexOf('=');
            if (at > 0) f[l.slice(0, at)] = l.slice(at + 1);
        });
        if (f.LoadState === 'not-found' || !f.ActiveState) {
            lines.push(`${u}: not on this unit`);
            continue;
        }
        lines.push(`${u}: ${f.ActiveState}/${f.SubState}, restarts ${f.NRestarts === undefined ? '?' : f.NRestarts}, result ${f.Result}, last exit ${f.ExecMainStatus}`);
        if (u === 'mgu-render' || u === 'drake1804-ytplay') {
            const name = u === 'mgu-render' ? 'Renderer' : 'YouTube player';
            if (f.ActiveState !== 'active') verdicts.push(verdict('FAIL', `${name} service is ${f.ActiveState}`));
            else if (Number(f.NRestarts) > 0) verdicts.push(verdict('WARN', `${name} service has restarted ${f.NRestarts} times`));
            else verdicts.push(verdict('OK', `${name} service is running`));
        } else if (f.ActiveState === 'failed') {
            verdicts.push(verdict('WARN', `The ${u} service has failed, after ${f.NRestarts} restarts`));
        }
    }
    return { title: 'Services', lines, verdicts };
}

async function partRenderer() {
    const res = await journal(['-b', '-u', 'mgu-render.service'], 30);
    return { title: 'Renderer log', lines: linesOf(res.out), verdicts: [] };
}

async function partPlayer() {
    const lines = [], verdicts = [];
    const p = playerLine();
    const st = await p.ask('status', 3000);
    p.close();
    lines.push('Now:');
    playerLinesOf(st).forEach((l) => lines.push(l));
    if (!st.ok) verdicts.push(verdict('WARN', `The YouTube player does not answer: ${st.error}`));
    else if (st.online === false) verdicts.push(verdict('FAIL', 'The YouTube player says there is no internet'));
    else verdicts.push(verdict('OK', `The YouTube player answers: ${st.state}${st.online ? ', online' : ''}`));
    if (st.audioError) verdicts.push(verdict('FAIL', `Last sound error: ${st.audioError}`));
    const log = tail(`${PLAYER_LOG}/ytplay.log`, 30);
    lines.push('Log:');
    (log || ['no log yet']).forEach((l) => lines.push(l));
    return { title: 'YouTube player', lines, verdicts };
}

async function partApps() {
    const lines = [];
    (list(OAP) || []).filter((n) => /^oap_/.test(n)).forEach((n) => {
        ['app.log', 'checks.log'].forEach((f) => {
            const log = tail(`${OAP}/${n}/data/${f}`, f === 'app.log' ? 30 : 12);
            if (!log) return;
            lines.push(`${f === 'app.log' ? 'The YouTube app' : 'This app'} (${n}):`);
            log.forEach((l) => lines.push(l));
        });
    });
    if (!lines.length) lines.push('No app has written a log yet');
    return { title: 'App logs', lines, verdicts: [] };
}

async function partStore() {
    const lines = ['Lines about these apps in the journal:'];
    const all = await journal(['-b'], 8000);
    const ours = linesOf(all.out).filter((l) => /drake1804/i.test(l)).slice(-25);
    (ours.length ? ours : ['none']).forEach((l) => lines.push(l));
    const updater = await journal(['-b', '-u', 'mgu-updater.service'], 12);
    lines.push('The Store\'s updater:');
    linesOf(updater.out).forEach((l) => lines.push(l));
    return { title: 'Store and installs', lines, verdicts: [] };
}

async function partInternet() {
    const lines = [], verdicts = [];
    const lease = read(LEASE);
    if (lease) {
        lines.push(`Uplink lease: ${lease.trim().replace(/\s+/g, ' ')}`);
        verdicts.push(verdict('OK', 'The uplink holds a lease'));
    } else {
        lines.push('The uplink holds no lease');
        verdicts.push(verdict('WARN', 'The uplink holds no lease: no internet for the player'));
    }
    const route = await run('ip', ['-4', 'route']);
    linesOf(route.out).slice(0, 8).forEach((l) => lines.push(l));
    const nft = await run('nft', ['list', 'table', 'inet', 'mgu_uplink']);
    const ours = linesOf(nft.out).filter((l) => /3920/.test(l)).map((l) => l.trim());
    lines.push(ours.length ? `Firewall lets out the player: ${ours[0]}` : 'Firewall has no line for the player\'s uid 3920');
    return { title: 'Internet', lines, verdicts };
}

async function partSound() {
    const lines = [], verdicts = [];
    const found = await listDevices();
    if (!found.helper) {
        lines.push('ytaudio is not installed: it comes with the YouTube player tool');
        verdicts.push(verdict('WARN', 'Sound helper not installed'));
    } else {
        found.raw.forEach((l) => lines.push(l));
        const usable = found.devices.filter((d) => d.cls !== 'leave');
        verdicts.push(usable.length ? verdict('OK', `Sound devices to try: ${usable.length}, saved: ${found.saved || 'auto'}`) : verdict('FAIL', 'No sound device to try'));
    }
    ['/usr/lib/alsa-lib', '/usr/lib/x86_64-linux-gnu/alsa-lib'].forEach((d) => {
        const names = list(r(d));
        if (names) lines.push(`${d}: ${names.filter((n) => /smartx|avb/i.test(n)).join(' ') || 'no smartx or avb plugin'}`);
    });
    const run_ = list(r('/run/smartx'));
    lines.push(run_ ? `/run/smartx: ${run_.join(' ') || 'empty'}` : '/run/smartx: not there');
    const shm = (list(r('/dev/shm')) || []).filter((n) => /smartx|avb/i.test(n));
    lines.push(`/dev/shm: ${shm.join(' ') || 'nothing of smartx or avb'}`);
    lines.push(`/dev/snd: ${(list(r('/dev/snd')) || ['not there']).join(' ')}`);
    linesOf(read(r('/proc/asound/cards'))).forEach((l) => lines.push(l));
    const log = tail(`${PLAYER_LOG}/ytaudio.log`, 20);
    if (log) {
        lines.push('ytaudio log:');
        log.forEach((l) => lines.push(l));
    }
    return { title: 'Sound', lines, verdicts };
}

async function partErrors() {
    const lines = [];
    const errors = await journal(['-b', '-p', 'err'], 30);
    const errs = linesOf(errors.out);
    lines.push(`Errors this boot (last ${errs.length}):`);
    errs.forEach((l) => lines.push(l));
    const boots = await run('journalctl', ['--list-boots', '--no-pager'], { ms: 15000 });
    lines.push('Boots the journal knows:');
    linesOf(boots.out).slice(-5).forEach((l) => lines.push(l));
    const before = await journal(['-b', '-1'], 15);
    lines.push('The end of the boot before this one:');
    linesOf(before.out).forEach((l) => lines.push(l));
    return { title: 'Errors', lines, verdicts: [] };
}

async function partTried() {
    return { title: 'Tests tried so far', lines: tail(RESULTS, 30) || ['None yet'], verdicts: [] };
}

const PARTS = [partUnit, partHardwareDecode, partInstalled, partServices, partInternet, partPlayer, partSound, partApps, partRenderer, partStore, partErrors, partTried];

async function jobReport() {
    const parts = [];
    for (const make of PARTS) {
        try {
            parts.push(await make());
        } catch (e) {
            parts.push({ title: make.name, lines: [`this check failed: ${e.message}`], verdicts: [verdict('WARN', `A check failed: ${make.name}: ${e.message}`)] });
        }
    }
    const order = { FAIL: 0, WARN: 1, OK: 2, INFO: 3 };
    const verdicts = parts.reduce((all, p) => all.concat(p.verdicts), []).sort((a, b) => order[a[0]] - order[b[0]]);
    const summary = { title: 'Summary', lines: verdicts.map((v) => `${v[0]}  ${v[1]}`) };
    const sections = [summary].concat(parts).map((p) => ({ title: p.title, lines: cleanLines(p.lines) }));
    return { ok: true, version: VERSION, title: 'All checks', at: new Date().toISOString().slice(0, 19), sections };
}

/* ---- the video path: tools/plumbing/plumbing.js ---- */

async function plumbing(mode, seconds) {
    const args = [path.join(__dirname, 'plumbing.js'), mode, '--seconds', String(seconds)];
    if (process.env.CHECKS_RENDER_SOCKET) args.push('--socket', process.env.CHECKS_RENDER_SOCKET);
    if (process.env.CHECKS_RENDER_CLIENT) args.push('--client', process.env.CHECKS_RENDER_CLIENT);
    if (process.env.CHECKS_FRAME_FILE) args.push('--frame-file', process.env.CHECKS_FRAME_FILE);
    return run(process.execPath, args, { ms: (seconds + 15) * 1000 });
}

async function jobVideo() {
    const lines = [];
    let good = true;
    const bars = await plumbing('bars', BARS_S);
    const barLines = linesOf(bars.out);
    barLines.filter((l) => !/^stats /.test(l)).forEach((l) => lines.push(l));
    const drew = barLines.some((l) => /^bars at /.test(l));
    const refused = barLines.filter((l) => /^(error |FAIL )/.test(l));
    if (!drew || refused.length || bars.code !== 0) good = false;
    let fps = null;
    if (drew) {
        const rate = await plumbing('rate', RATE_S);
        const rateLines = linesOf(rate.out);
        const stats = rateLines.filter((l) => /^stats /.test(l));
        rateLines.filter((l) => /^(error |FAIL |done)/.test(l)).forEach((l) => lines.push(l));
        stats.slice(-5).forEach((l) => lines.push(l));
        stats.forEach((l) => {
            const m = /^stats ([\d.]+) fps/.exec(l);
            if (m) fps = Math.max(fps || 0, Number(m[1]));
        });
        if (rate.code !== 0) good = false;
    }
    const head = [];
    if (!drew) head.push('FAIL  The renderer never took the bars: the video path is not working');
    else if (!good) head.push('FAIL  The renderer took the bars, then refused something: see the lines below');
    else head.push('OK    The renderer took the bars. Please say whether you saw them');
    if (fps !== null) head.push(`${fps >= GOOD_FPS ? 'OK  ' : 'WARN'}  Best frame rate ${fps} fps; video needs ${GOOD_FPS}`);
    note(`video test: ${drew ? 'renderer took the bars' : 'renderer never took the bars'}, best ${fps === null ? 'unknown' : fps} fps`);
    return { ok: true, title: 'Video test', at: new Date().toISOString().slice(0, 19),
        sections: [{ title: 'Video test', lines: cleanLines(head.concat(lines)) }] };
}

/* ---- the player, with nothing on the screen: searching, fetching, decoding ---- */

/* CPU ticks so far of the running programs of these names, and how many of them there are. */
function cpuOf(names) {
    let ticks = 0, count = 0;
    (list(r('/proc')) || []).filter((n) => /^\d+$/.test(n)).forEach((pid) => {
        const stat = read(r(`/proc/${pid}/stat`));
        if (!stat) return;
        const close = stat.lastIndexOf(')');
        const comm = stat.slice(stat.indexOf('(') + 1, close);
        if (names.indexOf(comm) < 0) return;
        const words = stat.slice(close + 2).split(' ');
        ticks += Number(words[11]) + Number(words[12]);
        count++;
    });
    return { ticks, count };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function jobPlayer() {
    const lines = [], head = [];
    const done = () => ({ ok: true, title: 'Player test', at: new Date().toISOString().slice(0, 19),
        sections: [{ title: 'Player test', lines: cleanLines(head.concat(lines)) }] });
    const p = playerLine();
    const first = await p.ask('status', 3000);
    if (!first.ok) {
        p.close();
        head.push(`FAIL  The YouTube player does not answer: ${first.error}`);
        note(`player test: no answer: ${first.error}`);
        return done();
    }
    lines.push(`Before: ${playerLinesOf(first)[0]}`);
    const t0 = Date.now();
    const found = await p.ask('search test', 60000);
    const took = ((Date.now() - t0) / 1000).toFixed(1);
    if (found.ok && Array.isArray(found.results)) {
        head.push(`OK    Search found ${found.results.length} videos in ${took} s`);
    } else {
        head.push(`FAIL  Search failed after ${took} s: ${found.error || 'no results'}`);
    }
    const play = await p.ask(`play ${TEST_VIDEO}`, 10000);
    if (!play.ok) lines.push(`play: ${play.error}`);
    const startAt = Date.now();
    let cpu = cpuOf(['ffmpeg']), cpuAt = Date.now(), cpuPct = null, last = null, playing = false, playingAt = null;
    while (Date.now() - startAt < PLAY_S * 1000) {
        await sleep(Math.min(5000, Math.max(200, PLAY_S * 100)));
        last = await p.ask('status', 3000);
        lines.push(`${Math.round((Date.now() - startAt) / 1000)} s: ${last.ok ? `${last.state} at ${last.pos}, buffered ${last.buffered}, ${last.frames} frames, ${last.dropped} dropped` : last.error}`);
        if (last.ok && last.state === 'playing') {
            if (!playing) playingAt = Date.now();
            playing = true;
            const now = cpuOf(['ffmpeg']), at = Date.now();
            if (now.count && at > cpuAt && cpu.count) cpuPct = Math.round(((now.ticks - cpu.ticks) / 100) / ((at - cpuAt) / 1000) * 100);
            cpu = now;
            cpuAt = at;
        }
        if (last.ok && (last.state === 'error' || last.state === 'ended')) break;
    }
    if (last) playerLinesOf(last).slice(1).forEach((l) => lines.push(l));
    await p.ask('stop', 3000);
    p.close();
    if (playing) {
        const waited = ((playingAt - startAt) / 1000).toFixed(0);
        const share = last && last.frames ? (100 * (last.dropped || 0) / last.frames).toFixed(1) : '?';
        head.push(`OK    The video played, after about ${waited} s. ${last.frames} frames, ${last.dropped} dropped (${share} %)`);
        if (cpuPct !== null) head.push(`${cpuPct > 200 ? 'WARN' : 'INFO'}  ffmpeg at ${cpuPct} % of one core; the limit we set is 200`);
    } else {
        head.push(`FAIL  The video never played: ${(last && last.error) || (last && last.state) || 'no status'}`);
    }
    note(`player test: search ${found.ok ? `ok in ${took} s` : 'failed'}, ${playing ? `played, ${last.frames} frames, ${last.dropped} dropped` : 'never played'}`);
    return done();
}

/* ---- sound ---- */

let knownDevices = [];

async function listDevices() {
    if (!exists(YTAUDIO)) {
        knownDevices = [];
        return { helper: false, devices: [], saved: null, raw: [] };
    }
    const res = await run(YTAUDIO, ['list'], { ms: 15000, env: { YTAUDIO_LOG: '/dev/null' } });
    const raw = linesOf(res.out);
    const devices = [];
    let saved = null;
    raw.forEach((l) => {
        const m = /^(try|maybe|leave)\s+(\S.*)$/.exec(l);
        if (m) devices.push({ cls: m[1], name: m[2].trim() });
        const s = /^saved: (.+)$/.exec(l);
        if (s) saved = s[1].trim();
    });
    knownDevices = devices;
    return { helper: true, devices, saved, raw };
}

async function jobDevices() {
    const found = await listDevices();
    return { ok: true, helper: found.helper, devices: found.devices, saved: found.saved, lines: cleanLines(found.raw) };
}

/* Only what ytaudio just listed, and never what it would leave alone. */
const allowedDevice = (name) => knownDevices.some((d) => d.name === name && d.cls !== 'leave');

async function jobTone(args) {
    const [name, level] = args;
    if (!name || LEVELS.indexOf(level) < 0) return { ok: false, error: 'tone takes a device and -30 or -20' };
    if (!allowedDevice(name)) return { ok: false, error: `${name} is not a device to try` };
    const res = await run(YTAUDIO, ['tone', '--device', name, '--seconds', '3', '--db', level], { ms: 25000 });
    const last = linesOf(res.out).pop() || '';
    let a = null;
    try {
        a = JSON.parse(last);
    } catch (e) {
        a = { ok: false, error: last || `exit ${res.code}` };
    }
    note(`tone ${name} at ${level} dB: ${a.ok ? `played ${a.frames} frames, ${a.underruns} underruns` : `failed: ${a.error}`}`);
    return { ok: true, played: !!a.ok, error: a.ok ? null : clean(a.error || 'failed'), device: name };
}

async function jobSave(args) {
    const name = args[0];
    if (!name || (name !== 'auto' && !allowedDevice(name))) return { ok: false, error: `${name} is not a device to save` };
    const res = await run(YTAUDIO, ['save', name], { ms: 10000 });
    note(`save ${name}: exit ${res.code}`);
    return res.code === 0 ? { ok: true, saved: name } : { ok: false, error: clean(res.out.trim()) };
}

async function jobProbe(args) {
    const label = args[0];
    if (PROBE_LABELS.indexOf(label) < 0) return { ok: false, error: 'probe takes idle, playing or after' };
    const res = await run('sh', [path.join(__dirname, 'probe.sh'), '-s', '3', '-o', PROBE_OUT, label], { ms: 180000, env: { PROBE_ROOT: R } });
    note(`sound snapshot ${label}: exit ${res.code}${res.timedOut ? ' (timed out)' : ''}`);
    const sections = [{ title: `Snapshot: ${label}`, lines: linesOf(read(`${PROBE_OUT}/${label}/summary.txt`) || res.out) }];
    const compare = read(`${PROBE_OUT}/compare.txt`);
    if (label !== 'idle' && compare) sections.push({ title: 'What changed between idle and playing', lines: linesOf(compare) });
    return { ok: res.code === 0, error: res.code === 0 ? null : `the probe ended with ${res.code}`, title: `Sound snapshot: ${label}`, at: new Date().toISOString().slice(0, 19),
        sections: sections.map((s) => ({ title: s.title, lines: cleanLines(s.lines) })) };
}

const JOBS = { report: jobReport, video: jobVideo, player: jobPlayer, devices: jobDevices, tone: jobTone, save: jobSave, probe: jobProbe };

/* ---- the socket ---- */

let busy = null;

function handle(line, reply) {
    const words = line.trim().split(/\s+/).filter((w) => w);
    const cmd = words[0];
    if (cmd === 'ping') {
        reply({ ok: true, version: VERSION, busy });
        return;
    }
    if (!Object.prototype.hasOwnProperty.call(JOBS, cmd)) {
        reply({ ok: false, error: `no such command: ${String(cmd).slice(0, 40)}` });
        return;
    }
    if (busy) {
        reply({ ok: false, busy: true, error: `still busy with ${busy}` });
        return;
    }
    busy = cmd;
    say(`command: ${cmd}`);
    Promise.resolve().then(() => JOBS[cmd](words.slice(1)))
        .catch((e) => ({ ok: false, error: e.message }))
        .then((answer) => {
            busy = null;
            reply(answer);
        });
}

function connection(s) {
    let buf = '';
    s.setEncoding('utf8');
    s.on('error', () => { /* 'close' follows */ });
    s.on('data', (d) => {
        buf += d;
        if (buf.length > MAX_REQUEST) {
            s.destroy();
            return;
        }
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            handle(line, (answer) => {
                if (!s.destroyed) s.write(`${JSON.stringify(answer)}\n`);
            });
        }
    });
}

function groupId(name) {
    const entry = linesOf(read(r('/etc/group'))).map((l) => l.split(':')).find((f) => f[0] === name);
    return entry ? Number(entry[2]) : null;
}

function main() {
    try {
        fs.unlinkSync(SOCKET);
    } catch (e) { /* none left over */ }
    process.umask(0o117);
    const server = net.createServer(connection);
    server.on('error', (e) => {
        console.error(`socket: ${e.message}`);
        process.exit(1);
    });
    server.listen(SOCKET, () => {
        fs.chmodSync(SOCKET, 0o660);
        const gid = groupId(GROUP);
        if (gid !== null && process.getuid() === 0) fs.chownSync(SOCKET, 0, gid);
        else if (gid === null) say(`no group ${GROUP}: only root can reach the socket`);
        process.umask(0o022);
        say(`checks helper ${VERSION} on ${SOCKET}`);
    });
    process.on('SIGTERM', () => process.exit(0));
    process.on('SIGPIPE', () => {});
}

if (require.main === module) main();

module.exports = { clean, VERSION };
