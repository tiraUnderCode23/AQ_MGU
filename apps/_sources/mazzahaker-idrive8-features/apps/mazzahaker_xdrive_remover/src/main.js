// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const path = require('path');
const OnlineApp = require('oap-sdk/src/core/OnlineApp.js');
const logger = require('oap-sdk/src/logging/logging').getSDKLogger();
const { XDriveController, reportedMode } = require('./controller.js');
const { Tasu } = require('./tasu.js');
const { watchVehicle, signalText } = require('./vehicle.js');
const { Drawn } = require('./drawn.js');

const monotonicMs = () => {
    const [seconds, nanos] = process.hrtime();
    return seconds * 1000 + nanos / 1e6;
};
const hex = (value, width) => value === null ? '—' : '0x' + value.toString(16).toUpperCase().padStart(width, '0');
const TORQUE_POLL_MS = 3000;
const report = (error) => logger.warn('xDriveRemover: ' + error.message);
const logHmi = (message) => logger.info('xDriveRemover: HMI ' + message);
const SIGNAL_ROWS = [
    ['ignition', 'signalIgnition', 'Ignition'], ['rpm', 'signalRpm', 'Engine'],
    ['speed', 'signalSpeed', 'Speed'],
    ['gearDiagnostic', 'signalGearDiagnostic', 'Selector PT2'],
    ['brake', 'signalBrake', 'Parking brake']
];
const TABS = {
    drive: { title: 'Drive', rows: ['mode', 'torque', 'status', 'updated'] },
    diagnostics: { title: 'Diagnostics', rows: ['diagnosticsStatus', 'identity', 'function', 'qualifiers',
        'raw', 'signalsHint'].concat(SIGNAL_ROWS.map((row) => row[1])) }
};

class App extends OnlineApp {
    constructor() {
        super();
        this.components = {};
        this.actions = new Map();
        this.lastPress = new Map();
        this.tab = 'drive';
        this.hmiLossEpoch = 0;
        this.on('initialized', () => this.setup().catch(report));
        this.on('entryPointExecute', (uuid) => {
            logHmi('entryPointExecute');
            this.open(uuid).catch(report);
        });
        this.on('changeVisibility', (state) => {
            if (state && state.visible === false) this.hide();
        });
        this.on('shutdown', () => {
            this.hide();
            if (this.drawn) this.drawn.close();
            const closed = Promise.all([this.vehicleClosing, this.transport && this.transport.close()]);
            closed.then(() => this.destroyBundles()).catch(report).then(() => process.exit(0));
        });
        this.on('error', report);
    }

    async setup() {
        const rhmi = this.rhmiApplication;
        if (!rhmi) return this.initialized();
        this.state = rhmi.getByName('ST_XDriveMain');
        if (!this.state) throw new Error('RHMI screen missing');
        this.drawn = new Drawn(logger, (tab) => {
            this.selectTab(tab);
            this.render();
        }, () => this.refresh().catch(report), undefined, () => this.frontOff(),
        () => this.cancelFrontConfirmation());
        for (const name of ['tabHeading', 'driveTab', 'diagnosticsTab', 'refresh']
            .concat(TABS.drive.rows, TABS.diagnostics.rows)) {
            this.components[name] = rhmi.getByName(name);
            if (!this.components[name]) throw new Error('RHMI component missing: ' + name);
        }

        this.monitor = new XDriveController(async (target, sid, data) => {
            if (!this.transport) throw new Error('TASU is unavailable');
            return this.transport.exchange(target, sid, data);
        }, monotonicMs, {
            command: async (target, sid, data) => {
                if (!this.transport) throw new Error('TASU is unavailable');
                return this.transport.command(target, sid, data);
            },
            signals: () => (this.vehicleTransport && this.vehicleSamples) || {},
            allowed: () => Boolean(this.vehicleTransport && this.drawn.active),
            log: (message) => logger.info('xDriveRemover: ' + message),
            changed: () => this.render()
        });
        this.bind('refresh', () => this.refresh());
        this.bind('driveTab', () => this.selectTab('drive'));
        this.bind('diagnosticsTab', () => this.selectTab('diagnostics'));
        rhmi.on('userEvent', (event) => {
            if (event && event.eventType === 'ACTION') this.press(Number(event.sourceId));
        });
        rhmi.on('applicationStackChanged', (stack) => {
            const keys = stack && Object.keys(stack);
            if (!keys || !keys.length) return;
            if (keys.includes('ROOT_APP')) this.pageVisible(true);
            else this.hide();
        });
        rhmi.on('restoreHmi', () => {
            logHmi('restoreHmi visible=' + this.monitor.visible);
            this.renderTab();
            this.render();
        });
        this.state.on('visible', (event) => this.pageVisible(event && event.visible));
        this.state.on('focus', (event) => {
            if (event && event.focus !== undefined) {
                const focused = [true, 1, 'true', '1'].includes(event.focus);
                logHmi('focus=' + focused);
                if (!focused) this.hmiLossEpoch++;
                this.drawn.setFocused(focused);
            }
        });
        this.drawn.connect();

        await this.state.updateResources();
        const descriptions = this.appDescription.application.entryPoints;
        const entry = this.getEntryPoints().find((point) =>
            descriptions.some((description) => description.uuid === point.getDescription().uuid));
        if (!entry) throw new Error('Entry point missing');
        this.uuid = entry.getDescription().uuid;
        await entry.init();
        await rhmi.mapEntryState(this.uuid, this.state);
        await entry.setAvailability('ENABLED');
        const reason = (this.getVisibilityData && this.getVisibilityData() || {}).reason || this.startReason;
        if (reason === 'ENTRY_POINT' || reason === 'LUM') this.registerActive();
        await this.initialized();
        this.ready = true;
        const pendingEntry = this.pendingEntry;
        this.pendingEntry = null;
        if (pendingEntry === this.uuid ||
            (this.getLastExecutedEntryPointUuid && this.getLastExecutedEntryPointUuid() === this.uuid)) {
            await this.open(this.uuid);
        } else if (this.monitor.visible) {
            await this.refresh();
        }
    }

    async open(uuid) {
        if (!uuid) return;
        if (!this.ready) {
            this.pendingEntry = uuid;
            return;
        }
        if (uuid !== this.uuid) return;
        this.cancelFrontConfirmation();
        const lossEpoch = this.hmiLossEpoch;
        logHmi('openEntryState start');
        await this.rhmiApplication.openEntryState(uuid);
        logHmi('openEntryState complete');
        if (lossEpoch !== this.hmiLossEpoch) return;
        this.drawn.reopen();
        this.pageVisible(true);
    }

    hide() {
        this.hmiLossEpoch++;
        this.setVisible(false);
    }

    pageVisible(visible) {
        logHmi('page visible=' + visible);
        if (visible === true || visible === 1 || visible === 'true' || visible === '1') {
            this.setVisible(true);
            this.renderTab();
            this.render();
        } else if (visible === false || visible === 0 || visible === 'false' || visible === '0') {
            this.hide();
        }
    }

    selectTab(tab) {
        if (!this.monitor.visible || this.tab === tab) return;
        this.monitor.cancelConfirm();
        this.tab = tab;
        this.updateTorquePolling();
        this.startVehicleSignals();
        this.renderTab();
        this.refreshOnOpen();
    }

    renderTab() {
        if (!this.monitor.visible) return;
        for (const [tab, panel] of Object.entries(TABS)) {
            for (const name of panel.rows) this.setRowVisible(name, this.tab === tab);
        }
        this.setText('tabHeading', 'Selected tab: ' + TABS[this.tab].title);
    }

    setVisible(visible) {
        if (this.drawn) this.drawn.setVisible(visible);
        if (!this.monitor || this.monitor.visible === visible) return;
        this.monitor.show(visible);
        this.updateTorquePolling();
        if (!visible) this.stopVehicleSignals();
        if (visible && this.ready) {
            Promise.resolve(this.registerActive()).catch(report);
            Promise.resolve(this.registerHmiVisible()).catch(report);
            this.startVehicleSignals();
            this.refreshOnOpen();
        } else if (!visible && this.ready) {
            Promise.resolve(this.unregisterHmiVisible()).catch(report);
            Promise.resolve(this.unregisterInactive()).catch(report);
        }
    }

    refreshOnOpen() {
        if (this.loading) this.refreshPending = true;
        else this.refresh().catch(report);
    }

    updateTorquePolling() {
        clearInterval(this.torqueTimer);
        this.torqueTimer = null;
        if (this.monitor.visible && this.tab === 'drive') {
            this.torqueTimer = setInterval(() => {
                if (this.monitor.visible && this.tab === 'drive' && !this.monitor.writing && !this.monitor.front().confirming) {
                    this.refresh(this.monitor.hasRecentRead()).catch(report);
                }
            }, TORQUE_POLL_MS);
        }
    }

    startVehicleSignals() {
        if (!this.vehicleTimer) this.vehicleTimer = setInterval(() => this.render(), 1000);
        if (this.vehicleTransport) return;

        this.vehicleSamples = {};
        const nativeAddon = 'someip';
        let transport;
        try {
            transport = new Tasu(require(nativeAddon).buildProxy,
                path.resolve(__dirname, '..', '..', 'someipInterfaces'));
        } catch (error) {
            for (const [signal] of SIGNAL_ROWS) this.vehicleSamples[signal] = { error: error.message };
            report(error);
            return;
        }
        this.vehicleTransport = transport;
        const update = (name, sample) => {
            if (this.vehicleTransport === transport) this.vehicleSamples[name] = sample;
        };
        const previous = this.vehicleClosing || Promise.resolve();
        previous.then(() => {
            if (this.vehicleTransport !== transport) return;
            return watchVehicle(transport, (name, value, raw, source, at) => {
                update(name, { value, raw, source, at: at === undefined ? monotonicMs() : at });
            }, (name, error) => update(name, { error }));
        }).catch(report);
    }

    stopVehicleTimer() {
        clearInterval(this.vehicleTimer);
        this.vehicleTimer = null;
    }

    stopVehicleSignals() {
        this.stopVehicleTimer();
        if (!this.vehicleTransport) return;
        const transport = this.vehicleTransport;
        this.vehicleTransport = null;
        this.vehicleClosing = transport.close().catch(report);
    }

    signalRows() {
        const now = monotonicMs();
        return SIGNAL_ROWS.map(([signal, row, label]) => {
            const sample = this.vehicleSamples && this.vehicleSamples[signal];
            return [row, label + ': ' + signalText(signal, sample, now)];
        });
    }

    renderVehicleSignals() {
        if (!this.monitor.visible || this.tab !== 'diagnostics') return;
        const rows = this.signalRows();
        for (const [row, text] of rows) {
            this.setText(row, text);
        }
        if (this.drawn.model) this.drawn.render(Object.assign({}, this.drawn.model, { signals: rows.map((row) => row[1]) }));
    }

    cancelFrontConfirmation() {
        if (!this.monitor || !this.monitor.confirmUntil) return;
        this.monitor.cancelConfirm();
        this.render();
    }

    frontOff() {
        if (!this.monitor.visible || this.tab !== 'drive' || this.loading) return;
        this.monitor.requestFrontOff().catch(report).then(() => this.render());
    }

    async refresh(torqueOnly) {
        if (!this.monitor.visible || this.loading || this.monitor.busy) return;
        const visit = this.monitor.visit;
        this.loading = true;
        try {
            if (!torqueOnly) this.render();
            if (!this.transport) {
                // The native addon is resolved by the unit's Node loader at runtime.
                const nativeAddon = 'someip';
                const transport = new Tasu(require(nativeAddon).buildProxy,
                    path.resolve(__dirname, '..', '..', 'someipInterfaces'));
                try {
                    await transport.init();
                    this.transport = transport;
                } catch (error) {
                    await transport.close();
                    throw error;
                }
            }
            if (this.monitor.visit === visit) {
                if (torqueOnly && this.tab === 'drive') await this.monitor.refreshTorque();
                else if (!torqueOnly) await this.monitor.refresh();
            }
        } catch (error) {
            if (this.monitor.visit === visit) {
                this.monitor.message = 'Diagnostic link unavailable: ' + error.message;
            }
            report(error);
        } finally {
            this.loading = false;
            const refreshPending = this.refreshPending;
            this.refreshPending = false;
            if (this.monitor.visible && (this.monitor.visit !== visit || refreshPending)) {
                this.refresh().catch(report);
            } else {
                if (this.monitor.visible) this.startVehicleSignals();
                this.render();
            }
        }
    }

    bind(name, handler) {
        const component = this.components[name];
        const id = Number(component.getId());
        this.actions.set(id, handler);
        component.on('action', () => this.press(id));
    }

    press(id) {
        if (!this.monitor.visible || !this.actions.has(id)) return;
        const now = monotonicMs();
        if (this.lastPress.has(id) && now - this.lastPress.get(id) < 250) return;
        this.lastPress.set(id, now);
        Promise.resolve().then(this.actions.get(id)).then(() => this.render()).catch(report);
    }

    setRowVisible(name, visible) {
        Promise.resolve().then(() => this.components[name].setProperty('Visible', visible ? 1 : 0, 'UInt')).catch(report);
    }

    setText(name, text) {
        Promise.resolve().then(() => this.components[name].setValue(0, 'Text', text, 'Text')).catch(report);
    }

    render() {
        if (!this.monitor || !this.monitor.visible) return;
        if (this.tab === 'diagnostics') this.renderVehicleSignals();
        const monitor = this.monitor;
        const sample = monitor.sample;
        const torque = sample && sample.torque;
        const set = (name, value) => this.setText(name, value);
        const mode = reportedMode(sample);
        set('mode', 'Drive mode: ' + mode);
        set('torque', torque ? 'Front axle: ' + torque.actual + ' Nm estimated / ' + torque.requested +
            ' Nm requested' : 'Front axle torque: Unavailable');
        const status = this.loading || monitor.busy ? 'Reading xDrive diagnostics…' : monitor.message;
        set('status', status);
        set('diagnosticsStatus', status);
        const updated = 'Last successful read: ' + (monitor.lastRead ? monitor.lastRead.toTimeString().slice(0, 8) : '—');
        const dsc = 'DSC: ' + (sample ? hex(sample.dsc, 6) : '—');
        const lmv = 'LMV: ' + (sample ? hex(sample.lmv, 6) : '—');
        const statusByte = 'DSC DBE1: ' + (sample ? hex(sample.status, 2) : '—');
        const qualifiers = torque ? 'LMV DB32 qualifiers: ' + hex(torque.actualQualifier, 4) +
            ' estimated / ' + hex(torque.qualifier, 4) + ' requested' : 'LMV DB32 qualifiers: —';
        const raw = sample && sample.rawTorque ? sample.rawTorque.map((byte) => hex(byte, 2).slice(2)).join(' ') : '—';
        set('updated', updated);
        set('identity', dsc + '   ' + lmv);
        set('function', statusByte);
        set('qualifiers', qualifiers);
        set('raw', 'LMV DB32 response: ' + raw);
        this.drawn.render({
            tab: this.tab, mode, status, updated,
            metrics: [
                ['Front axle · estimated', torque ? torque.actual + ' Nm' : '—'],
                ['Front axle · requested', torque ? torque.requested + ' Nm' : '—']
            ],
            diagnostics: [dsc, lmv, statusByte, status],
            details: [statusByte, qualifiers, 'LMV DB32 response', raw],
            signals: this.signalRows().map((row) => row[1]),
            front: monitor.front()
        });
    }
}

const app = new App();
app.start().catch(report);
