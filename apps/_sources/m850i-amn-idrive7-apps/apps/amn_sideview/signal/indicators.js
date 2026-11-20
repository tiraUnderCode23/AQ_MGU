'use strict';
/**
 * indicators.js - the turn signals as the car's light module reports them: SOME/IP de.bmw.body.Light (instance 1),
 * fields StatusFunctionsIndicators and StatusFunctionsIndicators2 (notifiers only, no getter), found in the unit's
 * /etc/oap/someip/someip-interfaces.json on Nov 16 2026 (Vehicle2 statusLightStatus does not change with them).
 *
 *   controlIndicateDirection (BodyTypes.ControlIndicateDirection): 0 BLINKEN_AUS, 1 TIPP_BLINKEN_LINKS_EIN,
 *     2 TIPP_BLINKEN_RECHTS_EIN, 3 DAUER_BLINKEN_LINKS_EIN, 4 DAUER_BLINKEN_RECHTS_EIN, 8 BEIDSEITIGES_BLINKEN_EIN,
 *     13-15 not available / fault / unfilled
 *   activeFunctionIndicateDirection (BodyTypes.ActiveFunctionIndicateDirection): 7 DAUERBLINKEN_LINKS,
 *     8 DAUERBLINKEN_RECHTS, 9 TIPPBLINKEN_LINKS, 10 TIPPBLINKEN_RECHTS, 18/20/22 FAS_RICHTUNGSBLINKEN_*_LINKS and
 *     19/21/23 *_RECHTS (the car's own lane change); everything else (hazards, lock / unlock, alarm, crash) is no side
 *
 * The binding may hand an enum over as its number or its name; both are read. A side is the stalk's
 * (controlIndicateDirection) when it says one, else the active function's. Pure, no timers. Node 8.
 */

const CONTROL = { 1: 'left', 3: 'left', 2: 'right', 4: 'right', 0: 'off', 8: 'hazard',
    TIPP_BLINKEN_LINKS_EIN: 'left', DAUER_BLINKEN_LINKS_EIN: 'left', TIPP_BLINKEN_RECHTS_EIN: 'right', DAUER_BLINKEN_RECHTS_EIN: 'right',
    BLINKEN_AUS: 'off', BEIDSEITIGES_BLINKEN_EIN: 'hazard' };
const ACTIVE = { 7: 'left', 9: 'left', 18: 'left', 20: 'left', 22: 'left', 8: 'right', 10: 'right', 19: 'right', 21: 'right', 23: 'right', 0: 'off',
    DAUERBLINKEN_LINKS: 'left', TIPPBLINKEN_LINKS: 'left', FAS_RICHTUNGSBLINKEN_LOWPRIO_LINKS: 'left', FAS_RICHTUNGSBLINKEN_MIDPRIO_LINKS: 'left',
    FAS_RICHTUNGSBLINKEN_HIGHPRIO_LINKS: 'left', DAUERBLINKEN_RECHTS: 'right', TIPPBLINKEN_RECHTS: 'right', FAS_RICHTUNGSBLINKEN_LOWPRIO_RECHTS: 'right',
    FAS_RICHTUNGSBLINKEN_MIDPRIO_RECHTS: 'right', FAS_RICHTUNGSBLINKEN_HIGHPRIO_RECHTS: 'right', BLINKEN_AUS: 'off' };

const key = (x) => (typeof x === 'string' && /^\s*\d+\s*$/.test(x) ? Number(x) : x);
/** A StatusFunctionsIndicators(2) value -> 'left' | 'right' | 'hazard' | 'off' | 'other' | null (nothing readable). */
function decode(v) {
    if (!v || typeof v !== 'object') return null;
    const c = CONTROL[key(v.controlIndicateDirection)];
    if (c === 'left' || c === 'right' || c === 'hazard') return c;
    const a = ACTIVE[key(v.activeFunctionIndicateDirection)];
    if (a) return a;
    if (c === 'off') return v.activeFunctionIndicateDirection === undefined || v.activeFunctionIndicateDirection === null ? 'off' : 'other';
    return v.activeFunctionIndicateDirection !== undefined ? 'other' : null;
}

class Indicators {
    constructor() { this.state = null; this.prev = null; this.offAt = -1e9; this.at = 0; this.n = 0; this.raw = null; }
    /** A new value of either field. Returns the decoded state. */
    feed(v, now) {
        const s = decode(v);
        this.n++; this.at = now; this.raw = v;
        if (s === null) return s;
        if ((this.state === 'left' || this.state === 'right') && s !== this.state) { this.prev = this.state; this.offAt = now; }
        this.state = s;
        return s;
    }
    /** True once the car has sent a readable value. */
    live() { return this.state !== null; }
    /** 'left' | 'right' | null: the side signalled now, or for holdMs after it stops (not after hazards). */
    side(now, holdMs) {
        if (this.state === 'left' || this.state === 'right') return this.state;
        if (this.state === 'off' && this.prev && now - this.offAt <= holdMs) return this.prev;
        return null;
    }
    lit(side) { return this.state === side || (side && this.state === 'hazard'); }
}

module.exports = { Indicators, decode };
