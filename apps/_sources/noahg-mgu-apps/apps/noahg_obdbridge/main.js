'use strict';
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const { Canvas } = require('./kit/canvas');
const { request } = require('./client');

function readEvidence(value) { return value === 'positive_reply' ? 'live' : value === 'requested' ? 'requested' : 'unverified'; }
const names = {
    waiting_hotspot: 'Waiting for car hotspot', listening_unverified: 'Listening for diagnostic apps',
    connecting_vehicle: 'Connecting to vehicle', connected_unverified: 'Diagnostic client connected', disabled: 'Disabled',
    network_error: 'Diagnostic network setup failed',
};
const errors = {
    hotspot_firewall_failed: 'Car firewall access failed', vehicle_firewall_failed: 'Vehicle diagnostic firewall access failed',
    hotspot_bind_failed: 'Diagnostic port could not open', gateway_unreachable_or_ambiguous: 'No unique vehicle diagnostic gateway answered',
    gateway_and_tasu_unavailable: 'Neither the ENET gateway nor a TASU VIN read answered',
    hotspot_ap_mode_unavailable: 'Hotspot interface is not ready', vehicle_transport_unavailable: 'Vehicle diagnostic connection unavailable',
};
const tasuErrors = {
    helper_not_installed: 'TASU: OBD Bridge installation not found', config_missing: 'TASU: installed interface configuration missing',
    config_invalid: 'TASU: interface configuration invalid', multiple_helpers: 'TASU: duplicate OBD Bridge installations',
    module_load_failed: 'TASU: native SOME/IP module could not load', proxy_init_failed: 'TASU: proxy initialization failed',
    subscribe_failed: 'TASU: response subscription failed', availability_timeout: 'TASU: provider did not become available',
    worker_start_failed: 'TASU: helper process could not start', worker_exited: 'TASU: helper exited before readiness',
    worker_permission_denied: 'TASU: helper startup permission denied', worker_missing_path: 'TASU: helper executable or working directory missing',
    worker_resource_limit: 'TASU: helper startup hit a process or memory limit', worker_argument_limit: 'TASU: helper startup argument limit exceeded',
    helper_permissions: 'TASU: installed app access groups unavailable',
    request_refused: 'TASU: provider refused the diagnostic request', transport_failed: 'TASU: diagnostic transport failed',
    vin_refused: 'TASU: neither VIN source supplied a VIN', vin_invalid: 'TASU: vehicle VIN response was invalid',
    vin_timeout: 'VIN request timed out', request_busy: 'TASU: request remained temporarily busy',
    method_timeout: 'TASU: method timed out', ecu_timeout: 'TASU: ECU reply timed out', request_timeout: 'TASU: request deadline reached',
    diagnostics_deactivated: 'TASU: diagnostics deactivated', invalid_session: 'TASU: invalid session',
    exclusive_mode: 'TASU: another diagnostic owner has exclusive access', transport_rejected: 'TASU: transport rejected the request',
    malformed_reply: 'TASU: malformed reply', provider_unavailable: 'TASU: provider became unavailable',
    coordinator_unavailable: 'TASU: local request queue unavailable or wait expired',
    coordinator_lost: 'TASU: local request queue disconnected',
    method_verdict_invalid: 'TASU: provider returned no valid acceptance verdict',
    tas_connection_error: 'TASU: provider reported a vehicle transport connection error',
    invalid_request: 'TASU: provider rejected the request format',
    invalid_length: 'TASU: provider rejected the request length',
    wrong_identifier: 'TASU: provider rejected the identifier',
};
const controlErrors = {
    ENOENT: 'Service socket missing', ECONNREFUSED: 'Service is not accepting connections',
    EACCES: 'Service socket permission denied', ETIMEDOUT: 'Service status request timed out',
};

mgu.run({ async start(ctx) {
    let state = null, message = '', serviceError = '', busy = false, ended = false;
    async function refresh() {
        try {
            state = await request('GET', '/status'); serviceError = '';
            if (message === 'Adapter service unavailable') message = '';
        }
        catch (e) { state = null; serviceError = controlErrors[e.code] || 'Service status could not be read'; }
    }
    async function action(fn) {
        if (busy) return;
        busy = true;
        try { await fn(); await refresh(); }
        catch (e) { message = String(e.message || e); }
        finally { busy = false; }
    }
    ctx.ui.onClick('BTN_ENABLED', () => action(async () => {
        if (!state) throw new Error('Adapter service unavailable');
        state = await request('POST', '/enabled', { enabled: !state.enabled }); message = '';
    }));
    ctx.ui.onClick('BTN_PROBE', () => action(async () => { message = 'Checking vehicle route'; state = await request('POST', '/probe'); message = 'Vehicle identity answered; client connection needs testing'; }));
    ctx.ui.onClick('BTN_EXPORT', () => action(async () => {
        const data = await request('GET', '/export');
        fs.writeFileSync(path.join(ctx.dataDir, 'hu-obd-diagnostics.json'), JSON.stringify(data, null, 2) + '\n');
        message = 'Diagnostics saved';
    }));
    await refresh();
    let timer;
    const poll = async () => { if (ended) return; await refresh(); if (!ended) timer = setTimeout(poll, 2000); };
    timer = setTimeout(poll, 2000);
    ctx.app.on('shutdown', () => { ended = true; clearTimeout(timer); });
    ctx.loop('MAIN', 1, async () => {
        const t = ctx.theme(), cv = new Canvas(1600, 520);
        cv.clear(t.bg);
        const lines = state ? [
            names[state.state] || state.state,
            'Car hotspot: ' + (state.address || 'waiting for ' + (state.expectedHotspot || 'network address')),
            'Vehicle route: ' + state.backend.replace(/_/g, ' ') + '    Firewall: ' + (state.firewall || 'unknown') + '    TASU: ' + (state.tasu || 'idle'),
            'Client: ' + (state.clientConnected ? 'connected' : 'none') + '    Discovery: ' + (state.discoveryRequests || 0) + ' received / ' + (state.discoveryReplies || 0) + ' answered',
            'DME reads: ID ' + readEvidence((state.dmeReads || {}).identification) + ' / SWE ' + readEvidence((state.dmeReads || {}).sweMetadata) + ' / memory ' + readEvidence((state.dmeReads || {}).romMemory) + ' / date ' + readEvidence((state.dmeReads || {}).manufactureDate),
            'App ' + ctx.spec.version + ' / Service ' + state.version + '    Client requests: ' + state.requests + '    Responses: ' + state.responses,
            'TASU calls: ' + ((state.tasuTrace || {}).requests || 0) + '    ' + ((state.tasuTrace || {}).target || '--') + ' / ' + ((state.tasuTrace || {}).service || '--') + '    Verdict: ' + ((state.tasuTrace || {}).verdict || 'waiting') +
                '    Events: ' + ((state.tasuTrace || {}).events || 0) + ' / matched: ' + ((state.tasuTrace || {}).matched || 0) + ' / ignored: ' + ((state.tasuTrace || {}).ignored || 0),
            'TASU response: ' + ((state.tasuTrace || {}).lastEvent || 'none received') + (((state.tasuTrace || {}).lastIgnore) ? ' / ' + state.tasuTrace.lastIgnore.replace(/_/g, ' ') : ''),
            (state.tasu !== 'ready' && tasuErrors[state.tasuError]) ||
                (state.tasuVinError ? 'VIN from ' + state.tasuVinTarget + ': ' + (tasuErrors[state.tasuVinError] || 'Read failed') + (state.tasuVinNrc ? ' / NRC ' + state.tasuVinNrc : '') : '') ||
                tasuErrors[state.tasuError] || errors[state.lastError] || (state.lastError || '').replace(/_/g, ' ') || (state.lastDeniedService ? 'Unavailable operation: ' + state.lastDeniedService + (state.lastDeniedIdentifier ? ' / ' + state.lastDeniedIdentifier : '') : message),
        ] : ['OBD Bridge service unavailable', serviceError, 'Check OBD Bridge service in the Store', '', 'App ' + ctx.spec.version, message];
        lines.forEach((line, i) => cv.text(line, 48, 45 + i * 53, i === 0 ? 34 : 25, i === 0 ? t.accent : t.text));
        await ctx.ui.image('MAIN_GFX', cv);
    });
} });
