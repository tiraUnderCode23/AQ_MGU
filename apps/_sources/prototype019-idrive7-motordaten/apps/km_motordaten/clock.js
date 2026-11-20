'use strict';
/**
 * The car's wall clock. The head unit runs on UTC; the time the car shows comes from the instrument
 * cluster (KombiIF statusShowTimeDate: displayHour, displayMinute, displaySecond, and a status that is odd
 * while the shown time is valid; 15 means not filled in). Time zones differ from UTC by whole quarter hours,
 * so the offset is the shown time minus UTC, rounded to 15 minutes and brought into -12 h .. +12 h.
 *
 * wall(ms) is a Date whose UTC fields read the car's wall clock (getUTCHours() etc.). Until the cluster has
 * told, the offset is 0.
 *
 * Copyright (c) 2026 Prototype019. All rights reserved (LICENSE).
 */

const MINUTES_PER_DAY = 24 * 60;
const STATUS_NOT_FILLED = 15;

let offsetMinutes = 0;
let haveOffset = false;

const minutesOfDay = (h, m, s) => h * 60 + m + s / 60;

/* The cluster's shown time against the system's UTC (now: ms, the system time by default). True when the
 * offset is new or changed. */
function setCluster(show, now) {
    if (!show) {
        return false;
    }
    const status = show.statusDisplayClockTimeDate;
    const valid = typeof status === 'number' && status !== STATUS_NOT_FILLED && status % 2 === 1 &&
        show.displayHour >= 0 && show.displayHour < 24 && show.displayMinute >= 0 && show.displayMinute < 60;
    if (!valid) {
        return false;
    }
    const utc = new Date(now === undefined ? Date.now() : now);
    const shown = minutesOfDay(show.displayHour, show.displayMinute, show.displaySecond < 60 ? show.displaySecond : 0);
    const system = minutesOfDay(utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds() + utc.getUTCMilliseconds() / 1000);
    let diff = Math.round((shown - system) / 15) * 15;
    // the day boundary: an hour behind at 00:30 shown is 23:30 the day before, not 23 hours ahead
    while (diff > MINUTES_PER_DAY / 2) diff -= MINUTES_PER_DAY;
    while (diff <= -MINUTES_PER_DAY / 2) diff += MINUTES_PER_DAY;
    const changed = !haveOffset || diff !== offsetMinutes;
    offsetMinutes = diff;
    haveOffset = true;
    return changed;
}

function wall(ms) {
    return new Date((ms === undefined ? Date.now() : ms) + offsetMinutes * 60000);
}

module.exports = { setCluster, wall, offset: () => offsetMinutes, known: () => haveOffset };
