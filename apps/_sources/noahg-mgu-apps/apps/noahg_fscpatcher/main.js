'use strict';
const mgu = require('./kit/mgu');
const { request } = require('./client');

const CONFIRM_MS = 8000;
const POLL_MS = 2000;
const binaryStates = {
    stock: 'Stock',
    'stock-variant': 'Stock variant',
    patched: 'Patched',
    'pattern-missing': 'Unsupported',
    missing: 'Verifier not found',
};
const blockStates = { patched: 'Ready', other: 'Modified', absent: 'Missing' };


mgu.run({ start(ctx) {
    const { ui } = ctx;
    const shown = {};
    let state = null, notice = '', statusError = '', busy = false, ended = false;
    let statusRead, pollTimer, confirmTimer, armed = null, armedAt = 0, armedState;

    const stateKey = value => value && JSON.stringify([value.binary.sha256, value.binary.state, value.block.sha256, value.block.state, value.blockPending, value.binary.trust]);

    function show() {
        if (ended) return;
        const b = state && state.binary, k = state && state.block;
        const summary = (b && b.keyUpdateRequired ? 'Signing key update required' : b && b.trust === 'replacement-only' ? 'Legacy patch' : b ? binaryStates[b.state] || b.state : 'Loading...')
            + (state && state.restartRequired ? '. Restart required.' : '');
        const backups = state && [state.binaryBackup && 'binary', state.blockBackup && 'support block'].filter(Boolean);
        const rows = {
            STATUS: statusError || notice || summary,
            BTN_PATCH: armed === 'patch' ? 'Confirm patch' : 'Patch',
            BTN_RESTORE: armed === 'restore' ? 'Confirm restore' : 'Restore backup',
            BTN_RESTART: armed === 'restart' ? 'Confirm restart' : 'Restart iDrive',
            DETAIL_TEXT: [
                notice, statusError, summary,
                b && 'Keys: ' + (b.trust === 'oem-and-local' ? 'OEM + local' : b.trust === 'replacement-only' ? 'Local only' : 'OEM'),
                state && state.blockPending && 'Support block: Pending',
                b && 'Binary: ' + b.path,
                b && 'SHA-256: ' + (b.sha256 || 'unknown'),
                b && b.offset >= 0 ? 'Offset: 0x' + b.offset.toString(16) : 'Patch site not found',
                b && 'OEM key SHA-256: ' + (b.modulusSha256 || 'unknown'),
                b && b.signingKeySha256 && 'Local key SHA-256: ' + b.signingKeySha256,
                k && 'Support block: ' + (blockStates[k.state] || k.state),
                k && 'Support block SHA-256: ' + (k.sha256 || 'unknown'),
                state && 'Backups: ' + (backups.length ? backups.join(', ') : 'none'),
                'App ' + ctx.spec.version + ' / Service ' + (state ? state.version : 'unavailable'),
            ].filter(Boolean).join('\n\n'),
        };
        Object.keys(rows).forEach(name => {
            if (shown[name] === rows[name]) return;
            shown[name] = rows[name];
            ui.text(name, rows[name]);
        });
    }

    function refresh() {
        if (!statusRead) {
            statusRead = request('GET', '/status').then(result => {
                if (!result || !result.binary || !result.block || typeof result.binary.state !== 'string' || typeof result.block.state !== 'string') throw new Error('Invalid status response');
                if (armed && stateKey(result) !== armedState) {
                    disarm();
                    notice = 'State changed. Confirm again.';
                }
                state = result;
                statusError = '';
            }).catch(error => {
                state = null;
                disarm();
                statusError = 'Service unavailable: ' + error.message;
            }).then(() => {
                statusRead = null;
                show();
            });
        }
        return statusRead;
    }

    function disarm() {
        clearTimeout(confirmTimer);
        if (armed) notice = '';
        armed = null;
    }

    function cancelConfirmation() {
        if (!armed) return;
        disarm();
        show();
    }

    async function operate(name) {
        if (ended || busy || !state) return;
        if (armed !== name || Date.now() - armedAt >= CONFIRM_MS) {
            disarm();
            armed = name;
            armedAt = Date.now();
            armedState = stateKey(state);
            notice = name === 'restart' ? 'Park safely, then press again to restart.' : 'Press again to confirm.';
            confirmTimer = setTimeout(cancelConfirmation, CONFIRM_MS);
            show();
            return;
        }

        const confirmedState = armedState;
        disarm();
        busy = true;
        notice = 'Working...';
        show();
        try {
            // Finish any poll already using the service before sending the write.
            if (statusRead) await statusRead;
            if (ended) return;
            if (!state) { notice = ''; return; }
            if (stateKey(state) !== confirmedState) {
                notice = 'State changed. Confirm again.';
                return;
            }
            const result = await request('POST', '/' + name);
            notice = result.message || 'Done';
            if (result.restartRequired && !/restart/i.test(notice)) notice += '. Restart required.';
        } catch (error) {
            notice = error.message;
        } finally {
            if (!ended) {
                show();
                await refresh();
                busy = false;
            }
        }
    }

    ui.onClick('BTN_REFRESH', () => {
        if (ended || busy) return;
        disarm();
        notice = '';
        show();
        return refresh();
    });
    ui.onClick('BTN_PATCH', () => operate('patch'));
    ui.onClick('BTN_RESTORE', () => operate('restore'));
    ui.onClick('BTN_RESTART', () => operate('restart'));
    ui.onClick('BTN_DETAILS', () => {
        cancelConfirmation();
        return ui.open('DETAILS');
    });
    const visibility = (name, on) => {
        if (name === 'MAIN' && !on) cancelConfirmation();
        if (on && (name === 'MAIN' || name === 'DETAILS')) {
            Object.keys(shown).forEach(key => { delete shown[key]; });
            show();
        }
    };
    ui.onVisible(visibility);
    ui.onFocus(visibility);
    ctx.onShutdown(() => {
        ended = true;
        clearTimeout(pollTimer);
        clearTimeout(confirmTimer);
    });

    async function poll() {
        if (!busy) await refresh();
        if (!ended) pollTimer = setTimeout(poll, POLL_MS);
    }
    show();
    poll();
} });
