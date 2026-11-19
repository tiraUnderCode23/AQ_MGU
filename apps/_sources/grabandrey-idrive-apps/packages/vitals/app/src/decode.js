'use strict';
/*
 * Vitals: the car's raw SOME/IP values -> metric numbers (C, bar), null when the car says
 * "no value". Pure functions, tested on a desktop by tools/test_model.js.
 *
 * CDS.statusEngineTemperature   temperatureEngineDrive (coolant), temperatureEngineOilDrive:
 *                               C + 48, 255 = none
 * BasicDataSet.basicDataSet     valueTemperatureTransmissionOil (gearbox oil): C + 48, 255 = none.
 *                               Some cars never fill it in and send one fixed value: car_data.js
 *                               passes it on only once it has changed.
 * TPMS.statusTyreTemperature    actualValueTemperatureTyre{FL,FR,RL,RR}H: the car's degrees + 40,
 *                               65535 = none (F when the car is set to F)
 * TPMS.statusTyrePressure       actualValuePressureTyre{FL,FR,RL,RR}H: 0.1 x the car's pressure
 *                               unit, 65532 and up = none
 * Vehicle.statusNewCurrentUnitsStatusExt  unitOfMeasurementTemperature (1 C, 2 F),
 *                               unitOfMeasurementAirPressure (1 bar, 2 kPa, 3 psi); names or numbers
 * (scalings as the MIT-licensed cluster kits for these cars read them)
 */
const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const PRESS_TO_BAR = { BAR: 1, KPA: 0.01, PSI: 1 / 14.5038 };

function num(v) { return typeof v === 'number' && isFinite(v); }

function engine(v) {
    const t = (raw) => (num(raw) && raw >= 0 && raw < 255 ? raw - 48 : null);
    return { coolant: t(v && v.temperatureEngineDrive), oil: t(v && v.temperatureEngineOilDrive) };
}

/* gearbox oil in C, or null */
function gearbox(v) {
    const raw = v && v.valueTemperatureTransmissionOil;
    return num(raw) && raw >= 0 && raw < 255 ? raw - 48 : null;
}

function tempUnit(x) {
    if (x === 1 || /^(C|CELSIUS)$/i.test(String(x)) || /CELS/i.test(String(x))) return 'C';
    if (x === 2 || /^(F|FAHRENHEIT)$/i.test(String(x)) || /FAHR/i.test(String(x))) return 'F';
    return null;
}
function pressUnit(x) {
    if (x === 1 || /BAR/i.test(String(x))) return 'BAR';
    if (x === 2 || /KPA/i.test(String(x))) return 'KPA';
    if (x === 3 || /PSI/i.test(String(x))) return 'PSI';
    return null;
}
function units(v) {
    return { carTemp: tempUnit(v && v.unitOfMeasurementTemperature), carPress: pressUnit(v && v.unitOfMeasurementAirPressure) };
}

/* tyre temperatures in C, from the car's unit (C when not known yet) */
function tyreTemps(v, carTemp) {
    const out = {};
    CORNERS.forEach((k) => {
        const raw = v && v['actualValueTemperatureTyre' + k + 'H'];
        if (!num(raw) || raw < 0 || raw >= 65535) { out[k] = null; return; }
        const t = raw - 40;
        out[k] = carTemp === 'F' ? (t - 32) * 5 / 9 : t;
    });
    return out;
}

/* tyre pressures in bar, from the car's unit; without it, guessed from the size of the number */
function tyrePressures(v, carPress) {
    const out = {};
    CORNERS.forEach((k) => {
        const raw = v && v['actualValuePressureTyre' + k + 'H'];
        if (!num(raw) || raw < 0 || raw >= 65532) { out[k] = null; return; }
        const p = raw / 10, f = PRESS_TO_BAR[carPress];
        if (f) out[k] = p * f;
        else if (p >= 0.5 && p <= 6) out[k] = p;             // bar
        else if (p >= 7 && p < 60) out[k] = p / 14.5038;     // psi
        else if (p >= 60 && p <= 600) out[k] = p / 100;      // kPa
        else out[k] = null;
    });
    return out;
}

module.exports = { engine, gearbox, units, tyreTemps, tyrePressures, CORNERS };
