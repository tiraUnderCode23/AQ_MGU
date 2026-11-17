'use strict';

// AQ///Lights' visual list lives in a 1600x520 logical canvas.
// All helpers in this file are pure UI state and coordinate handling.
const LIST = Object.freeze({ x: 32, y: 98, width: 1536, rowHeight: 54, cardHeight: 46, rows: 6 });
const HEADER = Object.freeze({
    // Stay inside the renderer's FULL.src (y=38..520) touch claim.
    previous: { x: 1100, y: 40, width: 86, height: 34 },
    next: { x: 1482, y: 40, width: 86, height: 34 },
});

function listWindow(length, selection) {
    if (!Number.isFinite(length) || length <= 0) return { start: 0, selected: -1, count: 0 };
    const n = Math.floor(length);
    const selected = ((Math.floor(selection) % n) + n) % n;
    const start = Math.min(Math.max(0, selected - Math.floor(LIST.rows / 2)), Math.max(0, n - LIST.rows));
    return { start, selected, count: Math.min(LIST.rows, n - start) };
}

function inRect(x, y, r) {
    return Number.isFinite(x) && Number.isFinite(y) && x >= r.x && y >= r.y &&
        x < r.x + r.width && y < r.y + r.height;
}

function hitTest(x, y, length, selection) {
    if (inRect(x, y, HEADER.previous)) return { type: 'previous' };
    if (inRect(x, y, HEADER.next)) return { type: 'next' };
    const window = listWindow(length, selection);
    if (!window.count || !inRect(x, y, {
        x: LIST.x, y: LIST.y, width: LIST.width,
        height: LIST.rowHeight * window.count,
    })) return null;
    const visible = Math.floor((y - LIST.y) / LIST.rowHeight);
    if (y >= LIST.y + visible * LIST.rowHeight + LIST.cardHeight) return null;
    return { type: 'row', index: window.start + visible };
}

// DID F150 discovery is accepted only on a positive 0x22 reply for that DID;
// a negative response or unrelated frame is not evidence of module readiness.
function positiveModuleReply(uds) {
    return !!(uds && uds.length >= 4 && uds[0] === 0x62 &&
        uds[1] === 0xF1 && uds[2] === 0x50);
}

const TILTS = Object.freeze({
    OST: 'E', OST_KURZ_GEDRUECKT: 'E', OST_LANG_GEDRUECKT: 'E',
    SUED_OST: 'E', WEST: 'W', WEST_KURZ_GEDRUECKT: 'W', WEST_LANG_GEDRUECKT: 'W',
    NORD_WEST: 'W', MITTELSTELLUNG: null, KEINE_BETAETIGUNG: null,
    0: null, 4: 'E', 5: 'E', 10: 'W', 11: 'W',
});
const PRESSED = [1, 2, 'DREHGEBER_KURZ_GEDRUECKT', 'DREHGEBER_LANG_GEDRUECKT'];
const RELEASED = [0, 'KEINE_BETAETIGUNG'];

function createController(onStep, onPage, onPush) {
    let lastOperation = null;
    let lastTilt = null;
    let lastPressed = false;
    return {
        reset() { lastOperation = null; lastTilt = null; lastPressed = false; },
        receive(event) {
            if (!event) return;
            const op = event.frontRotaryEncoderOperation;
            if (Number.isInteger(op) && op >= 0 && op < 0xffff) {
                if (lastOperation !== null) {
                    let delta = op - lastOperation;
                    if (delta > 32767) delta -= 65536;
                    if (delta < -32768) delta += 65536;
                    // Reject wildly discontinuous, stale counter samples.
                    if (delta && Math.abs(delta) <= 24) onStep(delta > 0 ? 1 : -1);
                }
                lastOperation = op;
            }
            const rawTilt = event.frontRotaryEncoderDeflection;
            if (Object.prototype.hasOwnProperty.call(TILTS, rawTilt)) {
                const tilt = TILTS[rawTilt];
                if (tilt && tilt !== lastTilt && lastTilt === null) onPage(tilt === 'E' ? 1 : -1);
                lastTilt = tilt;
            }
            const rawPush = event.frontRotaryEncoderPushButton;
            if (PRESSED.indexOf(rawPush) >= 0) {
                if (!lastPressed) onPush();
                lastPressed = true;
            } else if (RELEASED.indexOf(rawPush) >= 0) {
                lastPressed = false;
            }
        },
    };
}

// The newer ambient_config kit exposes onTap(x,y) only after the renderer has
// negotiated touch ownership and rejected drags/cancelled gestures. The legacy
// kit does not: it is unsafe to decode its event 105 as a touch (105 is CCU).
function registerTouch(ctx, onTap, isForeground) {
    if (typeof ctx.onTap !== 'function') return null;
    const unsubscribe = ctx.onTap((x, y) => {
        if (!isForeground()) return null;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return onTap(x, y);
    });
    return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}

module.exports = { LIST, HEADER, listWindow, hitTest, positiveModuleReply, createController, registerTouch };
