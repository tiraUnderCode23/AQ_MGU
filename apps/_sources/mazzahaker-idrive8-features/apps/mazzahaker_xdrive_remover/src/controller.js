// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const DSC = 0x29;
const LMV = 0x19;
const ID = [0xf1, 0x50];
const FUNCTION = [0xdb, 0xe1];
const TORQUE = [0xdb, 0x32];
const FRONT_OFF = [0xdb, 0xe1, 0x00];   // 2E DB E1 00: LMV_FUNKTION off until the ignition is cycled
const EXTENDED_SESSION = [0x03];
const SESSION_NRC = [0x7e, 0x7f];       // "not in this session": retry once in the extended session
const CONFIRM_MS = 6000;                // the second press must come within this
const READ_FRESH_MS = 30000;            // a complete diagnostic read must be this recent
const VERIFY_TRIES = 4;
const VERIFY_GAP_MS = 700;
const MOVING_KMH = 0.5;
const ENGINE_OFF_RPM = 50;              // engine speed must be below this, fresh
const SIGNAL_FRESH_MS = 2500;           // rpm and speed are polled; older than this does not count
const STATE_FRESH_MS = 10000;           // ignition state and selector: change-driven, an event must have arrived this recently
const NRC_TEXT = {
    0x22: 'DSC conditions not met',
    0x31: 'not supported by this DSC',
    0x33: 'refused (security access); put the car in diagnostic mode (Start button 3 times without the brake) and try again',
    0x7e: 'not allowed even in the extended session',
    0x7f: 'not allowed even in the extended session'
};

function matches(reply, sid, did, length) {
    return Array.isArray(reply) && reply.length === length &&
        reply[0] === sid && reply[1] === did[0] && reply[2] === did[1];
}

function index(reply) {
    return matches(reply, 0x62, ID, 6) ?
        (reply[3] << 16) | (reply[4] << 8) | reply[5] : null;
}

function parseFunction(reply) {
    return matches(reply, 0x62, FUNCTION, 4) && (reply[3] === 0 || reply[3] === 1) ?
        reply[3] : null;
}

function parseTorque(reply) {
    if (!matches(reply, 0x62, TORQUE, 11)) return null;
    const nm = (offset) => Buffer.from(reply.slice(offset, offset + 2)).readInt16BE(0) / 4;
    return {
        actual: nm(3),
        requested: nm(7),
        actualQualifier: (reply[5] << 8) | reply[6],
        qualifier: (reply[9] << 8) | reply[10]
    };
}

function reportedMode(sample) {
    if (!sample || sample.dsc !== 0x0f2510 || sample.lmv !== 0x0f29e0 || !sample.torque) return 'Unknown';
    const qualifier = sample.torque.qualifier;
    if (qualifier === 0x20 || qualifier === 0x21) return 'AWD reported by LMV';
    if (qualifier === 0xe8) return 'RWD reported by LMV';
    return 'Unknown';
}

class XDriveController {
    constructor(exchange, now, options) {
        const extra = options || {};
        this.exchange = exchange;
        this.now = now;
        this.command = extra.command || null;
        this.signals = extra.signals || (() => ({}));
        this.changed = extra.changed || (() => {});
        this.allowed = extra.allowed || (() => true);
        this.log = extra.log || (() => {});
        this.confirmVisit = -1;
        this.sleep = extra.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.writing = false;
        this.confirmUntil = 0;
        this.frontNote = 'Front drive: not sent';
        this.visible = false;
        this.visit = 0;
        this.busy = false;
        this.sample = null;
        this.message = 'Ready to read DSC and LMV';
    }

    show(visible) {
        if (this.visible === visible) return;
        this.visible = visible;
        this.visit++;
        this.sample = null;
        this.cancelConfirm();
    }

    cancelConfirm() {
        this.confirmUntil = 0;
        this.confirmVisit = -1;
        if (!this.writing) this.frontNote = 'Front drive: not sent';
    }

    async refresh() {
        if (!this.visible || this.busy) return;
        this.busy = true;
        this.sample = null;
        const visit = this.visit;
        const replies = [];
        let request = 'DSC F150';
        let failure = null;
        try {
            for (const [target, did, label] of [
                [DSC, ID, 'DSC F150'], [LMV, ID, 'LMV F150'], [DSC, FUNCTION, 'DSC DBE1'], [LMV, TORQUE, 'LMV DB32']
            ]) {
                request = label;
                const reply = await this.exchange(target, 0x22, did);
                if (visit !== this.visit) return;
                if (reply && reply[0] === 0x7f) throw new Error('ECU refused (NRC 0x' + reply[2].toString(16) + ')');
                replies.push(reply);
            }
        } catch (error) {
            failure = request + ': ' + error.message;
        } finally {
            this.busy = false;
        }
        if (visit !== this.visit) return;
        const dsc = index(replies[0]), lmv = index(replies[1]);
        const status = parseFunction(replies[2]), torque = parseTorque(replies[3]);
        this.sample = { dsc, lmv, status, torque, rawTorque: torque ? replies[3] : null };
        if (dsc !== null && lmv !== null && status !== null && torque) {
            this.sample.at = this.now();
            this.lastRead = new Date();
        }
        this.message = failure || (this.sample.at === undefined ?
            'Missing or invalid diagnostic response' : 'Diagnostic read complete');
    }

    async refreshTorque() {
        if (!this.visible || this.busy) return;
        if (!this.sample || this.sample.lmv === null) return this.refresh();
        const visit = this.visit;
        this.busy = true;
        let raw;
        let failure;
        try {
            raw = await this.exchange(LMV, 0x22, TORQUE);
        } catch (error) {
            failure = error.message;
        } finally {
            this.busy = false;
        }
        if (visit !== this.visit) return;
        const torque = parseTorque(raw);
        this.sample = Object.assign({}, this.sample, { torque, rawTorque: torque ? raw : null });
        if (torque) {
            this.lastRead = new Date();
        }
        this.message = torque ? 'Front axle data updated' : 'LMV DB32: ' + (failure || 'Invalid response');
    }

    // Local preconditions for the front-drive request. RPM and speed are polled.
    // Ignition and selector use recent events because they are subscription-only.
    hasRecentRead() {
        const sample = this.sample;
        return Boolean(sample && sample.at !== undefined && this.now() - sample.at < READ_FRESH_MS);
    }

    frontChecks() {
        const signals = this.signals() || {};
        const value = (name, maxAge) => {
            const sample = signals[name];
            if (!sample || sample.error || sample.value === null || sample.value === undefined) return null;
            if (maxAge !== undefined && !(this.now() - sample.at <= maxAge)) return null;
            return sample.value;
        };
        const sample = this.sample;
        const rpm = value('rpm', SIGNAL_FRESH_MS);
        const speed = value('speed', SIGNAL_FRESH_MS);
        const selector = value('gear', STATE_FRESH_MS);
        const selectorPt2 = value('gearDiagnostic', STATE_FRESH_MS);
        const selectorInPark = (selector === 'P' && selectorPt2 === null) ||
            (selectorPt2 === 'P' && (selector === null || selector === 'P'));
        return [
            ['Visible app with live signals', Boolean(this.allowed())],
            ['DSC 0F2510 and LMV 0F29E0', Boolean(sample && sample.dsc === 0x0f2510 && sample.lmv === 0x0f29e0)],
            ['Recent complete diagnostic read', this.hasRecentRead()],
            ['Ignition on (state 7, recent event)', value('ignition', STATE_FRESH_MS) === 7],
            ['Engine speed fresh and below ' + ENGINE_OFF_RPM + ' rpm', typeof rpm === 'number' && rpm < ENGINE_OFF_RPM],
            ['Selector in P (recent event)', selectorInPark],
            ['Stationary (fresh speed)', typeof speed === 'number' && speed < MOVING_KMH],
            ['Not already RWD', reportedMode(sample) !== 'RWD reported by LMV']
        ];
    }

    frontBlocker() {
        if (!this.command) return 'Front drive control is unavailable';
        if (!this.visible) return 'Open the app first';
        if (this.busy || this.writing) return 'Busy';
        const bad = this.frontChecks().find((check) => !check[1]);
        return bad ? 'Needs: ' + bad[0] : null;
    }

    front() {
        const confirming = this.visible && this.confirmUntil > 0 && this.confirmVisit === this.visit &&
            this.now() <= this.confirmUntil;
        const words = String(this.frontNote).split(' ');
        const lines = [''];
        for (const word of words) {
            const last = lines.length - 1;
            if ((lines[last] + ' ' + word).trim().length > 56 && lines.length < 2) lines.push(word);
            else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + word).trim();
        }
        return {
            title: this.writing ? 'Sending…' : confirming ? 'Press again to confirm' : 'Switch to RWD',
            lines,
            confirming
        };
    }

    // First press: checks and asks. Second press within CONFIRM_MS, in the same visit of the app: sends
    // the one allow-listed write. Every step after the first await checks the conditions again.
    async requestFrontOff() {
        const blocker = this.frontBlocker();
        if (blocker) {
            this.cancelConfirm();
            this.frontNote = blocker;
            return;
        }
        const confirmed = this.confirmUntil > 0 && this.confirmVisit === this.visit && this.now() <= this.confirmUntil;
        if (!confirmed) {
            this.confirmUntil = this.now() + CONFIRM_MS;
            this.confirmVisit = this.visit;
            this.frontNote = 'Press again to switch the front drive off until the ignition is cycled';
            setTimeout(() => {
                if (!this.writing && this.now() > this.confirmUntil && this.frontNote.indexOf('Press again') === 0) {
                    this.frontNote = 'Confirmation expired; nothing was sent';
                    this.changed();
                }
            }, CONFIRM_MS + 100);
            return;
        }
        const visit = this.visit;
        this.confirmUntil = 0;
        this.confirmVisit = -1;
        this.writing = true;
        this.busy = true;
        this.frontNote = 'Sending to the DSC…';
        this.changed();
        const guard = (stage) => {
            if (this.visible && this.visit === visit) {
                const bad = this.frontChecks().find((check) => !check[1]);
                if (!bad) return true;
                this.frontNote = 'Stopped before ' + stage + ': "' + bad[0] + '" no longer holds. Nothing more was sent';
            } else {
                this.frontNote = 'Stopped before ' + stage + ': the app was closed or reopened. Nothing more was sent';
            }
            this.log('front drive off stopped before ' + stage + ': ' + this.frontNote);
            return false;
        };
        let accepted = false;
        try {
            let reply = null;
            if (guard('the DSC write')) {
                this.log('-> DSC 2E DB E1 00');
                reply = await this.command(DSC, 0x2e, FRONT_OFF);
                this.log('<- DSC ' + (reply ? reply.map((b) => b.toString(16)).join(' ') : 'no answer'));
                if (reply && reply[0] === 0x7f && SESSION_NRC.includes(reply[2])) {
                    reply = null;
                    if (guard('the extended session request')) {
                        this.log('-> DSC 10 03');
                        const session = await this.command(DSC, 0x10, EXTENDED_SESSION);
                        this.log('<- DSC ' + (session ? session.map((b) => b.toString(16)).join(' ') : 'no answer'));
                        if (session && session[0] === 0x50) {
                            if (guard('the repeated write')) {
                                this.log('-> DSC 2E DB E1 00 (repeat)');
                                reply = await this.command(DSC, 0x2e, FRONT_OFF);
                                this.log('<- DSC ' + (reply ? reply.map((b) => b.toString(16)).join(' ') : 'no answer'));
                            }
                        } else {
                            this.frontNote = 'DSC refused the extended session' +
                                (session && session[0] === 0x7f ? ' (NRC 0x' + session[2].toString(16) + ')' : '');
                        }
                    }
                }
                if (reply && reply[0] === 0x6e) {
                    accepted = true;
                } else if (reply && reply[0] === 0x7f) {
                    this.frontNote = 'DSC refused: ' + (NRC_TEXT[reply[2]] || 'NRC 0x' + reply[2].toString(16));
                } else if (reply) {
                    this.frontNote = 'No matching answer from the DSC; press Refresh to check the LMV state';
                }
            }
        } catch (error) {
            this.frontNote = 'Not confirmed: ' + error.message + '; press Refresh to check the LMV state';
        } finally {
            this.busy = false;
            if (!accepted) this.writing = false;
        }
        if (!accepted) return;
        try {
            if (visit !== this.visit) return;
            this.frontNote = 'Accepted by the DSC; reading the transfer case…';
            this.changed();
            for (let i = 0; i < VERIFY_TRIES; i++) {
                await this.sleep(VERIFY_GAP_MS);
                if (visit !== this.visit) return;
                await this.refreshTorque();
                if (visit !== this.visit) return;
                if (reportedMode(this.sample) === 'RWD reported by LMV') break;
            }
            const torque = this.sample && this.sample.torque;
            this.log('after write: ' + reportedMode(this.sample) + (torque ? ', front ' + torque.actual + ' Nm actual / ' +
                torque.requested + ' Nm requested, qualifiers 0x' + torque.actualQualifier.toString(16) + ' / 0x' +
                torque.qualifier.toString(16) : ''));
            this.frontNote = reportedMode(this.sample) === 'RWD reported by LMV' ?
                'DSC accepted; LMV status reports RWD (DB32 0xE8). Status only, not a measurement' :
                'DSC accepted, but the LMV does not report RWD yet; press Refresh';
        } finally {
            this.writing = false;
            if (visit !== this.visit) this.cancelConfirm();
        }
    }
}

module.exports = { XDriveController, parseFunction, parseTorque, reportedMode };
