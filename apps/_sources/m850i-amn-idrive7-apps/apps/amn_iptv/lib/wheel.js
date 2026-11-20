'use strict';
/**
 * wheel.js - the steering wheel's skip changes the channel while one plays: right (>) the next, left (<) the one
 * before, on release. The buttons reach apps through de.bmw.infotainment.controlelements.SteeringWheelPushButton,
 * instance 1, field statusSearchSwitch1, member operationPushButtonAudioAutomaticTuningSteeringWheel:
 * ..._SKIP_RECHTS (right) or ..._SKIP_LINKS (left) while down, KEINE_AKTION once let go (as found in the car by
 * aurelmarius' Media Probe). Nothing happens while nothing plays, so the radio keeps its own skip. amn_iptv's own.
 *
 *   const wheel = createWheel({ zap(dir), active() });  wheel.onSwitch(value)
 */
const IFACE = 'de.bmw.infotainment.controlelements.SteeringWheelPushButton';
const FIELD = 'statusSearchSwitch1';
function createWheel(o) {
    let down = 0;
    function onSwitch(v) {
        const val = v && typeof v === 'object' ? v.operationPushButtonAudioAutomaticTuningSteeringWheel : v;
        if (typeof val !== 'string') return;
        if (/SKIP_RECHTS/.test(val)) { down = 1; return; }
        if (/SKIP_LINKS/.test(val)) { down = -1; return; }
        if (/KEINE_AKTION/.test(val) && down) { const d = down; down = 0; if (o.active()) o.zap(d); }
    }
    return { onSwitch };
}
module.exports = { createWheel, IFACE, FIELD };
