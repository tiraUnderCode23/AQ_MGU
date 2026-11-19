'use strict';

// AQ///Bimmer — exhaust flap controller (MGU CommonJS kit).
//
// Verified live on this car (DME 0x12, BimmerLink ECU catalog "Motor electronics"):
// extended diagnostic session, then plain InputOutputControlByLocalIdentifier.
// No security access is required for the flap routine.
//
//   10 03                        extended diagnostic session
//   2F 60 FD 03 03 E8            flap OPEN
//   2F 60 FD 03 23 28            flap CLOSE
//   2F 60 FD 00                  restore automatic control
//   3E 80                        tester present (keep-alive while overriding)

const DME_ADDR = 0x12;   // engine DME diagnostic address

class FlapController {
    constructor(diag, log) {
        this.diag = diag;   // initialized kit Diag (TASU proxy); the app sets quiet mode
        this.log = log;

        this.busy = false;
        this.overrideActive = false;
        this.keepAliveTimer = null;

        this.state = 'AUTO';            // AUTO | OPEN | CLOSE
        this.message = 'Ready';
    }

    // ---- low-level UDS over TASU (DME 0x12), no hex logging -----------------------
    async sendUds(payload, timeoutMs = 2500) {
        if (!payload || !payload.length) return null;
        if (this.demo) return [payload[0] + 0x40, ...payload.slice(1, 3)];
        const sid = payload[0];
        const data = payload.slice(1);
        try {
            const res = await this.diag.physical(DME_ADDR, sid, data, timeoutMs);
            return (res === null || res === undefined) ? null : res;
        } catch (e) {
            this.log.warn('diagnostic request failed');
            return null;
        }
    }

    async enterExtendedSession() {
        const res = await this.sendUds([0x10, 0x03]);
        return !!(res && res[0] === 0x50);
    }

    // ---- identification (read-only) ----------------------------------------------
    async identifyDme() {
        const res = await this.sendUds([0x22, 0xF1, 0x50]);
        this.message = (res && res[0] === 0x62) ? 'Engine unit connected' : 'Engine unit not responding';
        return !!(res && res[0] === 0x62);
    }

    // ---- actuator (verified: no security access needed) ---------------------------
    async executeFlapCommand(action) {
        if (this.busy) return false;
        this.busy = true;
        try {
            if (!(await this.enterExtendedSession())) {
                this.message = 'Diagnostic session unavailable';
                return false;
            }
            const cmd = action === 'OPEN'
                ? [0x2F, 0x60, 0xFD, 0x03, 0x03, 0xE8]
                : [0x2F, 0x60, 0xFD, 0x03, 0x23, 0x28];
            const res = await this.sendUds(cmd);
            if (!res || res[0] !== 0x6F) {
                this.message = 'Command not accepted';
                return false;
            }
            this.overrideActive = true;
            this.state = action;
            this.startKeepAlive();
            this.message = action === 'OPEN' ? 'Valve open' : 'Valve closed';
            return true;
        } finally {
            this.busy = false;
        }
    }

    async restoreEcuControl() {
        if (this.busy) return false;
        this.busy = true;
        try {
            this.stopKeepAlive();
            await this.enterExtendedSession();
            const res = await this.sendUds([0x2F, 0x60, 0xFD, 0x00]);
            this.overrideActive = false;
            this.state = 'AUTO';
            this.message = (res && res[0] === 0x6F) ? 'Automatic control' : 'Restore not accepted';
            return !!(res && res[0] === 0x6F);
        } finally {
            this.busy = false;
        }
    }

    startKeepAlive() {
        this.stopKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.overrideActive && !this.busy) this.sendUds([0x3E, 0x80]).catch(() => {});
        }, 2000);
    }

    stopKeepAlive() {
        if (this.keepAliveTimer) { clearInterval(this.keepAliveTimer); this.keepAliveTimer = null; }
    }
}

module.exports = { FlapController, DME_ADDR };