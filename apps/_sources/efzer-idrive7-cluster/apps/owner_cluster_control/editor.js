'use strict';
// Composition editor — touch-first, offline preview (redesigned).
// Long-press an empty tile to open the add-catalog; long-press a widget to edit it.
// Four corner handles resize; swipe up/down switches a widget's page; tiny ticks on the right show the page.
// Entering edit mode needs no buttons — only the right-side menu, which shifts the grid left.
const fs = require('fs'), path = require('path'), M = require('./composition'), recommendations = require('./vehicle-recommendations'), P = require('./presets');
// Local rgba+withAlpha (matches kit/runtime/canvas.js so the app stays self-contained —
// the shipped app does not expose ./canvas). hex '#rrggbb'/'#rrggbbaa' or [r,g,b] → [r,g,b,a].
function rgba(c) {
    if (Array.isArray(c)) return c.length === 4 ? c.concat().slice(0,4) : [c[0], c[1], c[2], 255];
    let s = String(c).replace('#', '');
    if (s.length === 3) s = s.split('').map((x) => x + x).join('');
    const v = [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16),
        s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255];
    return v;
}
function withAlpha(c, a) { const v = rgba(c); return [v[0], v[1], v[2], Math.round(a * 255)]; }

/**
 * Demo model (offline study): plausible value + range + history for every item, so the
 * widgets show a believable number that moves (like the OEM cluster does from the car's signals).
 * Ranges and values are illustrative only; they are not validated vehicle limits.
 */
const DEMO = {
    rpm: { unit: '', min: 0, max: 8000, dec: 0, base: 2400, wobble: 1600, period: 6, hlen: 60 },
    torque: { unit: 'Нм', min: 0, max: 600, dec: 0, base: 320, wobble: 180, period: 7, hlen: 60 },
    power: { unit: 'кВт', min: 0, max: 300, dec: 0, base: 150, wobble: 110, period: 7, hlen: 60 },
    boost: { unit: 'bar', min: 0, max: 3, dec: 1, base: 1.1, wobble: 0.7, period: 5, hlen: 60 },
    gear: { unit: '', min: 1, max: 8, dec: 0, base: 5, wobble: 1.5, period: 3, hlen: 40 },
    pedal: { unit: '%', min: 0, max: 100, dec: 0, base: 28, wobble: 35, period: 4, hlen: 60 },
    powerPct: { unit: '%', min: 0, max: 100, dec: 0, base: 55, wobble: 30, period: 7, hlen: 60 },
    torquePct: { unit: '%', min: 0, max: 100, dec: 0, base: 50, wobble: 28, period: 7, hlen: 60 },
    boostMax: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.6, wobble: 0.2, period: 20, hlen: 60 },
    engineState: { unit: '', min: 0, max: 2, dec: 0, base: 2, wobble: 0.2, period: 30, hlen: 20 },
    oilLevel: { unit: '%', min: 0, max: 100, dec: 0, base: 72, wobble: 2, period: 30, hlen: 60 },
    startStop: { unit: '', min: 0, max: 1, dec: 0, base: 1, wobble: 0.2, period: 20, hlen: 20 },
    coolant: { unit: '°C', min: 20, max: 120, dec: 0, base: 92, wobble: 6, period: 20, hlen: 60 },
    oil: { unit: '°C', min: 20, max: 130, dec: 0, base: 104, wobble: 6, period: 20, hlen: 60 },
    gearboxTemp: { unit: '°C', min: 20, max: 120, dec: 0, base: 78, wobble: 6, period: 20, hlen: 60 },
    outside: { unit: '°C', min: -20, max: 45, dec: 0, base: 18, wobble: 4, period: 40, hlen: 60 },
    p_fl: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.35, wobble: 0.15, period: 15, hlen: 60 },
    p_fr: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.3, wobble: 0.15, period: 15, hlen: 60 },
    p_rl: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.5, wobble: 0.15, period: 15, hlen: 60 },
    p_rr: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.45, wobble: 0.15, period: 15, hlen: 60 },
    t_fl: { unit: '°C', min: 0, max: 120, dec: 0, base: 58, wobble: 8, period: 15, hlen: 60 },
    t_fr: { unit: '°C', min: 0, max: 120, dec: 0, base: 60, wobble: 8, period: 15, hlen: 60 },
    t_rl: { unit: '°C', min: 0, max: 120, dec: 0, base: 65, wobble: 8, period: 15, hlen: 60 },
    t_rr: { unit: '°C', min: 0, max: 120, dec: 0, base: 66, wobble: 8, period: 15, hlen: 60 },
    // Target pressures for the demo model: without them the four-wheel widget would compare a
    // pressure against the fallback range and invent a wild deviation.
    tp_fl: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.4, wobble: 0, period: 60, hlen: 10 },
    tp_fr: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.4, wobble: 0, period: 60, hlen: 10 },
    tp_rl: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.5, wobble: 0, period: 60, hlen: 10 },
    tp_rr: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.5, wobble: 0, period: 60, hlen: 10 },
    speed: { unit: 'км/ч', min: 0, max: 240, dec: 0, base: 95, wobble: 45, period: 6, hlen: 60 },
    accel: { unit: 'с', min: 6, max: 25, dec: 0, base: 8.5, wobble: 2, period: 20, hlen: 40 },
    g_long: { unit: 'g', min: 0, max: 1.5, dec: 1, base: 0.4, wobble: 0.35, period: 4, hlen: 60 },
    g_lat: { unit: 'g', min: 0, max: 1.5, dec: 1, base: 0.3, wobble: 0.3, period: 4, hlen: 60 },
    steer: { unit: '°', min: 0, max: 400, dec: 0, base: 180, wobble: 120, period: 5, hlen: 60 },
    mode: { unit: '', min: 0, max: 2, dec: 0, base: 1, wobble: 0.2, period: 30, hlen: 20 },
    yaw: { unit: '°/с', min: 0, max: 6, dec: 1, base: 1.5, wobble: 1.5, period: 4, hlen: 60 },
    slope: { unit: '%', min: 0, max: 20, dec: 0, base: 4, wobble: 3, period: 15, hlen: 60 },
    braking: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 2, hlen: 40 },
    handbrake: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 20, hlen: 20 },
    fuel: { unit: 'л', min: 0, max: 80, dec: 0, base: 52, wobble: 1, period: 60, hlen: 60 },
    range: { unit: 'км', min: 0, max: 700, dec: 0, base: 380, wobble: 40, period: 30, hlen: 60 },
    consumption: { unit: 'л', min: 0, max: 20, dec: 1, base: 7.2, wobble: 2.5, period: 6, hlen: 60 },
    odo: { unit: 'км', min: 0, max: 200000, dec: 0, base: 42000, wobble: 200, period: 120, hlen: 60 },
    trip: { unit: 'км', min: 0, max: 200, dec: 0, base: 64, wobble: 10, period: 30, hlen: 60 },
    avgCons1: { unit: 'л', min: 0, max: 20, dec: 1, base: 7.5, wobble: 1, period: 60, hlen: 60 },
    avgSpeed1: { unit: 'км/ч', min: 0, max: 200, dec: 0, base: 82, wobble: 20, period: 40, hlen: 60 },
    tripTime: { unit: '', min: 0, max: 600, dec: 0, base: 3600, wobble: 200, period: 60, hlen: 60 },
    tripFuel: { unit: 'л', min: 0, max: 100, dec: 1, base: 18.4, wobble: 2, period: 40, hlen: 60 },
    fuelFlow: { unit: 'л/ч', min: 0, max: 40, dec: 1, base: 8.5, wobble: 3, period: 6, hlen: 60 },
    voltage: { unit: 'В', min: 0, max: 16, dec: 1, base: 14.2, wobble: 0.3, period: 10, hlen: 60 },
    battery: { unit: '%', min: 0, max: 100, dec: 0, base: 82, wobble: 6, period: 40, hlen: 60 },
    track: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 30, hlen: 20 },
    artist: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 30, hlen: 20 },
    map: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 30, hlen: 20 },
    route: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 30, hlen: 20 }
};
const fmt = (v, d) => (typeof v === 'number' ? v.toFixed(d || 0) : '--');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/**
 * Danger bands per indicator: the range where the value means something is wrong with the car.
 * `hi` = above this is dangerous, `lo` = below this is dangerous, both present = a safe window
 * with danger on either side. Values are in the indicator's own unit, from the workshop data
 * these signals come from: coolant and oil overheat, oil pressure/level collapse, tyre pressure
 * drifts from spec, battery stops charging, brake/steering signals saturate.
 */
const DANGER = {
    coolant: { hi: 115, lo: 40, label: 'ПЕРЕГРЕВ' },
    oil: { hi: 130, lo: 20, label: 'ПЕРЕГРЕВ МАСЛА' },
    gearboxTemp: { hi: 120, lo: -10, label: 'ПЕРЕГРЕВ КОРОБКИ' },
    oilLevel: { lo: 1, label: 'НИЗКИЙ УРОВЕНЬ' },
    battery: { lo: 30, label: 'НИЗКИЙ ЗАРЯД' },
    voltage: { lo: 11.8, hi: 15.0, label: 'СЕТЬ' },
    fuel: { lo: 6, label: 'МАЛО ТОПЛИВА' },
    range: { lo: 30, label: 'МАЛО ЗАПАСА' },
    p_fl: { lo: 1.9, hi: 3.2, label: 'ДАВЛЕНИЕ' },
    p_fr: { lo: 1.9, hi: 3.2, label: 'ДАВЛЕНИЕ' },
    p_rl: { lo: 1.9, hi: 3.2, label: 'ДАВЛЕНИЕ' },
    p_rr: { lo: 1.9, hi: 3.2, label: 'ДАВЛЕНИЕ' },
    t_fl: { hi: 85, label: 'ПЕРЕГРЕВ ШИНЫ' },
    t_fr: { hi: 85, label: 'ПЕРЕГРЕВ ШИНЫ' },
    t_rl: { hi: 85, label: 'ПЕРЕГРЕВ ШИНЫ' },
    t_rr: { hi: 85, label: 'ПЕРЕГРЕВ ШИНЫ' },
    rpm: { hi: 7200, label: 'ПЕРЕКРУТ' },
    torque: { hi: 620, label: 'ПЕРЕГРУЗ' },
    power: { hi: 320, label: 'ПЕРЕГРУЗ' },
    boost: { hi: 2.6, label: 'ПЕРЕДУВ' },
    g_long: { hi: 1.2, lo: -1.4, label: 'ПЕРЕГРУЗКА' },
    g_lat: { hi: 1.3, lo: -1.3, label: 'СНОС' },
    steer: { hi: 500, lo: -500, label: 'УГОЛ РУЛЯ' },
    yaw: { hi: 45, lo: -45, label: 'ВРАЩЕНИЕ' },
    slope: { hi: 25, lo: -25, label: 'УКЛОН' },
    consumption: { hi: 35, label: 'РАСХОД' },
    fuelFlow: { hi: 45, label: 'РАСХОД' },
};
/** Which side of the band a value crossed: 'hi', 'lo' or null. */
function dangerOf(id, value) {
    const band = DANGER[id];
    if (!band || typeof value !== 'number' || !isFinite(value)) return null;
    if (band.hi !== undefined && value > band.hi) return { side: 'hi', label: band.label };
    if (band.lo !== undefined && value < band.lo) return { side: 'lo', label: band.label };
    return null;
}
/**
 * How far a tyre pressure is from its own target, in bar. This is the reading a driver acts on:
 * a cold morning reads 1.9 bar on a 2.4 target and 1.9 bar on a 1.9 target are different facts.
 */
function pressureDelta(actual, target) {
    if (typeof actual !== 'number' || typeof target !== 'number' || !isFinite(actual) || !isFinite(target) || target <= 0) return null;
    // Round to two decimals: 2.8 - 2.4 is 0.3999999999999999 in binary floating point, which
    // would sit just under a 0.4 threshold and let a genuinely over-inflated tyre pass as fine.
    return Math.round((actual - target) * 100) / 100;
}
/** Danger for a tyre: over-temperature first, then the deviation from target. */
function tyreDanger(actual, target, temp) {
    const t = dangerOf('t_fl', temp);
    if (t) return t;
    const delta = pressureDelta(actual, target);
    if (delta === null) return dangerOf('p_fl', actual);
    if (delta <= -0.3) return { side: 'lo', label: 'НИЖЕ НОРМЫ' };
    if (delta >= 0.4) return { side: 'hi', label: 'ВЫШЕ НОРМЫ' };
    return null;
}
/** A blink phase from the clock: 0.5 Hz, so the flash reads as a warning and not a strobe. */
function blinkOn(now) { return Math.floor((now === undefined ? Date.now() : now) / 520) % 2 === 0; }
// Charts show a rolling 3-minute window (not a live flicker): keep samples within the last 180s.
const HISTORY_MINUTES = 3;

// Optional sixth argument: profile string, {profile}, or a provider function returning either.
// Optional seventh argument: { now() } supplies this editor's demo clock in milliseconds.
// Optional eighth argument: the live data layer (signals.js) - real car values win over demo.
module.exports = function (ctx, fit, color, redraw, isActive, vehicleProfile, demoOptions, live) {
    const demoNow = demoOptions && typeof demoOptions.now === 'function' ? demoOptions.now : Date.now;
    const demoHist = {};
    let readOnlyDraw = false;
    const file = path.join(ctx.dataDir, 'composition.json');
    let data = M.empty(), blocked = false, msg = '', edit = false, selected = -1;
    let cell = { x: 0, y: 0 }, undo = null, confirmClear = false;
    let showMenu = false, menuState = 'select', editPick = null; // select=add; edit=manage widget
    let menuPage = 0, maxMenuPage = 0;
    let resizing = false, resizeDir = '', resizeStart = {}, resizeOrig = {}, resizePreview = null;
    let gesture = null, dragTarget = null;
    // Presets: a saved composition the driver can return to. The list is read once at start and
    // kept in memory; every change is written through P.* which persists atomically.
    const presetState = P.load(ctx.dataDir);
    let presets = presetState.presets;
    let showPresets = false;
    let presetPage = 0;
    let presetConfirmDelete = null;   // id awaiting a second tap

    // ---- Layout: equal margins on all sides; grid shrinks when the menu opens. ----
    const LEFT = 52, RIGHT = 52, TOP = 24, BOTTOM_PAD = 22;
    const ROWS = 4, COLS = 3, GAP = 8;
    // Fill the page height so widgets are as tall (readable) as possible; the chrome header is
    // drawn by the display above this surface, so no big top margin is needed here.
    const ch = Math.floor((520 - TOP - BOTTOM_PAD - GAP * (ROWS - 1)) / ROWS);
    const MW = 500, MH = 504, MY = 8;
    const GAP_BETWEEN = 32;
    const REC = { x: LEFT, y: TOP + 8, w: 1600 - RIGHT - MW - GAP_BETWEEN - LEFT, h: 96 };
    let MX = 1600 - RIGHT - MW;
    let cw = 0;
    function computeLayout() {
        const gridRight = showMenu ? MX - GAP_BETWEEN : 1600 - RIGHT;
        cw = (gridRight - LEFT - GAP * (COLS - 1)) / COLS;
    }
    function gridX(i) { return LEFT + i * (cw + GAP); }
    function gridY(j) { return TOP + j * (ch + GAP); }
    function box(w) {
        return { x: gridX(w.x), y: gridY(w.y),
                 w: w.w * cw + (w.w - 1) * GAP, h: w.h * ch + (w.h - 1) * GAP };
    }

    // ---- Catalog ----
    const groupedCategories = [
        { name: 'Двигатель', items: ['rpm', 'torque', 'power', 'boost', 'gear', 'pedal', 'powerPct', 'torquePct', 'boostMax', 'engineState', 'oilLevel', 'startStop'] },
        { name: 'Температуры', items: ['coolant', 'oil', 'outside', 'gearboxTemp'] },
        { name: 'Шины', items: ['tyres'] },
        { name: 'Движение', items: ['speed', 'accel', 'g_long', 'g_lat', 'steer', 'mode', 'yaw', 'slope', 'braking', 'handbrake'] },
        { name: 'Топливо и поездка', items: ['fuel', 'range', 'consumption', 'odo', 'trip', 'avgCons1', 'avgSpeed1', 'tripTime', 'tripFuel', 'fuelFlow'] },
        { name: 'Электросистема', items: ['voltage', 'battery'] },
        { name: 'Медиа и навигация', items: ['track', 'artist', 'map', 'route'] }
    ];
    const addFlat = [];
    const _perWheel = /^[pt]_(fl|fr|rl|rr)$/;
    M.categories.forEach(c => c.items.forEach(i => { if (!_perWheel.test(i[0])) addFlat.push({ id: i[0], name: i[1], unit: i[2], cat: c.name }); }));
    const selectFlat = [];
    groupedCategories.forEach(g => g.items.forEach(id => {
        const item = M.items[id];
        if (item) selectFlat.push({ id, name: item.name, unit: item.unit, cat: g.name });
    }));
    const PER_PAGE = 10;

    try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); const loaded = M.migrate(raw); if (!loaded) throw Error('invalid'); data = loaded; }
    catch (e) { if (e.code !== 'ENOENT') { blocked = true; msg = 'Ошибка чтения. Сохранение недоступно'; } }
    function save(r, keepUndo) {
        if (r.error) { msg = r.error; redraw(); return false; }
        if (blocked) { msg = 'Ошибка чтения. Сохранение недоступно'; redraw(); return false; }
        try { fs.writeFileSync(file + '.tmp', JSON.stringify(r.value, null, 2), 'utf8'); fs.renameSync(file + '.tmp', file); if (!keepUndo) undo = data; data = r.value; selected = r.index; msg = 'Сохранено в DEMO'; confirmClear = false; }
        catch (e) { try { fs.unlinkSync(file + '.tmp'); } catch (_) {} msg = 'Ошибка сохранения. Изменение не применено'; redraw(); return false; }
        redraw();
        return true;
    }
    function action(a, arg) { confirmClear = false; return save(M.apply(data, a, selected, arg)); }
    const ACTIONS = { undo: { x: LEFT, y: 60, w: 132, h: 36 }, clear: { x: LEFT + 140, y: 60, w: 148, h: 36 } };
    // Keep rejection feedback on the same toolbar row, but start it after the widest control.
    const STATUS = { x: ACTIONS.clear.x + ACTIONS.clear.w + 16, y: 60, w: 650, h: 40 };
    function toolbarTargetAt(x, y) {
        for (const name of ['undo', 'clear']) {
            const r = ACTIONS[name];
            if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return name;
        }
        return null;
    }
    function undoLast() {
        if (!undo) { msg = 'Нет успешного изменения для отмены'; redraw(); return false; }
        const previous = undo;
        if (!save({ value: previous, index: -1 }, true)) return false;
        undo = null;
        selected = -1; confirmClear = false; msg = 'Отменено последнее изменение'; redraw();
        return true;
    }
    function activateClear() {
        if (!data.widgets.length) { confirmClear = false; msg = 'Композиция уже пуста'; redraw(); return false; }
        if (!confirmClear) { confirmClear = true; msg = 'Подтвердите очистку повторным нажатием "Очистить?"'; redraw(); return true; }
        const success = save({ value: M.empty(), index: -1 });
        if (success) { selected = -1; showMenu = false; edit = false; menuState = 'select'; editPick = null; msg = 'Композиция очищена'; computeLayout(); redraw(); }
        return success;
    }
    function removeSelectedItem() {
        if (!showMenu || menuState !== 'edit' || selected < 0 || !data.widgets[selected]) return false;
        const removedCell = { x: data.widgets[selected].x, y: data.widgets[selected].y };
        if (!action('removeItem')) return false;
        editPick = null;
        if (selected < 0) {
            cell = removedCell;
            menuState = 'select';
            menuPage = 0;
            computeLayout();
            redraw();
        }
        return true;
    }
    function deleteSelected() {
        if (!action('delete')) return false;
        selected = -1; showMenu = false; computeLayout(); redraw();
        return true;
    }

    function refreshMaxPage() { maxMenuPage = Math.max(0, Math.ceil(selectFlat.length / PER_PAGE) - 1); }
    refreshMaxPage();

    // ---- Presets ----
    // A sheet, not a wizard: the list of saved layouts plus one primary action. Applying is a
    // single tap on a row, saving is one tap at the top, deleting needs a second tap on the same
    // row's cross (a destructive action never fires on the first touch).
    const PSH = { w: 460, pad: 18, rowH: 68, rowGap: 8, head: 76, saveH: 44, footH: 52 };
    function presetSheet() {
        const h = Math.min(504, PSH.head + PSH.saveH + 14 + presets.length * (PSH.rowH + PSH.rowGap) + PSH.footH);
        return { x: 1600 - RIGHT - PSH.w, y: Math.max(8, (520 - h) / 2), w: PSH.w, h: h };
    }
    function presetSaveRect() { const s = presetSheet(); return { x: s.x + PSH.pad, y: s.y + PSH.head, w: s.w - PSH.pad * 2, h: PSH.saveH }; }
    function presetRowRect(i) { const s = presetSheet(); return { x: s.x + PSH.pad, y: s.y + PSH.head + PSH.saveH + 14 + i * (PSH.rowH + PSH.rowGap), w: s.w - PSH.pad * 2, h: PSH.rowH }; }
    function presetDelRect(i) { const r = presetRowRect(i); return { x: r.x + r.w - 40, y: r.y + r.h / 2 - 16, w: 32, h: 32 }; }
    function presetCloseRect() { const s = presetSheet(); return { x: s.x + s.w - 44, y: s.y + 12, w: 32, h: 32 }; }
    function presetTargetAt(x, y) {
        const s = presetSheet();
        if (x < s.x || x >= s.x + s.w || y < s.y || y >= s.y + s.h) return null;
        const c = presetCloseRect();
        if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) return { kind: 'close' };
        const sv = presetSaveRect();
        if (x >= sv.x && x < sv.x + sv.w && y >= sv.y && y < sv.y + sv.h) return { kind: 'save' };
        for (let i = 0; i < presets.length; i++) {
            const d = presetDelRect(i);
            if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return { kind: 'delete', index: i };
            const r = presetRowRect(i);
            if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return { kind: 'apply', index: i };
        }
        return { kind: 'sheet' };
    }
    function openPresets() { showPresets = true; showMenu = false; editPick = null; presetConfirmDelete = null; msg = ''; redraw(); }
    function closePresets() { showPresets = false; presetConfirmDelete = null; redraw(); }
    function savePreset() {
        const r = P.add(ctx.dataDir, presets, data);
        if (r.error === 'full') { msg = 'Не более ' + P.MAX + ' пресетов. Удалите один'; redraw(); return false; }
        if (r.error === 'invalid') { msg = 'Композиция некорректна, пресет не сохранён'; redraw(); return false; }
        if (r.error) { msg = 'Ошибка сохранения пресета'; redraw(); return false; }
        presets = r.presets;
        msg = 'Пресет «' + r.entry.name + '» сохранён';
        redraw();
        return true;
    }
    function applyPreset(i) {
        const p = presets[i];
        if (!p) return false;
        if (!save({ value: p.composition, index: -1 }, true)) { msg = 'Ошибка сохранения. Пресет не применён'; redraw(); return false; }
        selected = -1; showPresets = false; edit = false; showMenu = false; menuState = 'select'; editPick = null;
        msg = 'Применён пресет «' + p.name + '»';
        computeLayout(); redraw();
        return true;
    }
    function deletePreset(i) {
        const p = presets[i];
        if (!p) return false;
        if (presetConfirmDelete !== p.id) { presetConfirmDelete = p.id; msg = 'Нажмите ещё раз, чтобы удалить пресет'; redraw(); return true; }
        const r = P.remove(ctx.dataDir, presets, p.id);
        presetConfirmDelete = null;
        if (r.error) { msg = 'Ошибка удаления пресета'; redraw(); return false; }
        presets = r.presets;
        msg = 'Пресет удалён';
        redraw();
        return true;
    }
    /** Which saved preset is exactly what is on screen now (marks the active row). */
    function activePresetIndex() {
        for (let i = 0; i < presets.length; i++) if (P.same(presets[i].composition, data)) return i;
        return -1;
    }

    function currentProfile() {
        let value = typeof vehicleProfile === 'function' ? vehicleProfile() : vehicleProfile;
        if (value && typeof value === 'object') value = value.profile;
        return value === 'petrol' || value === 'diesel' ? value : 'unknown';
    }
    function acceptRecommendation() {
        if (data.widgets.length !== 0) return;
        const result = recommendations.recommend(data, currentProfile());
        if (result) save({ value: result, index: -1 });
    }

    // ---- Hit testing ----
    let hx = 0, hy = 0;
    function hit(cx, cy) {
        hx = cx; hy = cy;
        if (showPresets) return presetTargetAt(cx, cy) ? { presets: true } : { presetsOutside: true };
        if (!readOnlyDraw && edit && !showMenu) {
            const pb = presetButtonRect();
            if (cx >= pb.x && cx < pb.x + pb.w && cy >= pb.y && cy < pb.y + pb.h) return { presetButton: true };
        }
        if (data.widgets.length === 0 && !showMenu && cx >= REC.x && cx < REC.x + REC.w && cy >= REC.y && cy < REC.y + REC.h) return { recommendation: true };
        if (showMenu && cx >= MX && cx < MX + MW && cy >= MY && cy < MY + MH) return { menu: true };
        if (edit && selected >= 0) {
            const b = box(data.widgets[selected]);
            const bx = b.x + b.w - 30, by = b.y + 6, bs = 26;
            if (cx >= bx && cx < bx + bs && cy >= by && cy < by + bs) return { delete: true, index: selected };
        }
        if (edit && selected >= 0) {
            const b = box(data.widgets[selected]);
            const dirs = ['tl', 'tr', 'bl', 'br'];
            const cs = [4, b.w - 4, 4, b.w - 4];
            const csy = [4, 4, b.h - 4, b.h - 4];
            for (let k = 0; k < 4; k++) if (Math.abs(cx - (b.x + cs[k])) < 16 && Math.abs(cy - (b.y + csy[k])) < 16) return { corner: true, dir: dirs[k], index: selected };
        }
        for (let i = data.widgets.length - 1; i >= 0; i--) {
            const b = box(data.widgets[i]);
            if (cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h) return { index: i, x: data.widgets[i].x, y: data.widgets[i].y };
        }
        if (cy >= TOP && cy < TOP + ROWS * ch + GAP * (ROWS - 1)) {
            const j = Math.min(ROWS - 1, Math.floor((cy - TOP) / (ch + GAP)));
            const i = Math.min(COLS - 1, Math.floor((cx - LEFT) / (cw + GAP)));
            if (cx >= gridX(i) && cx < gridX(i) + cw && cy >= gridY(j) && cy < gridY(j) + ch) return { x: i, y: j };
        }
        return null;
    }

    function openMenuFor(h) {
        edit = true; showMenu = true;
        if (h.index >= 0) { selected = h.index; menuState = 'edit'; editPick = null; refreshMaxPage(); }
        else { menuState = 'select'; cell = { x: h.x, y: h.y }; menuPage = 0; refreshMaxPage(); }
        redraw();
    }
    function clearMenu() { showMenu = false; menuState = 'select'; editPick = null; edit = false; }

    // The one way into the preset sheet: a quiet button that only exists in edit mode, so the
    // driving view stays free of chrome. It sits above the grid, right-aligned with it.
    const PRESET_BTN = { w: 148, h: 34 };
    function presetButtonRect() {
        const gridRight = showMenu ? MX - GAP_BETWEEN : 1600 - RIGHT;
        return { x: gridRight - PRESET_BTN.w, y: 4, w: PRESET_BTN.w, h: PRESET_BTN.h };
    }

    function selectWidget(idx) { clearMenu(); selected = idx >= 0 ? idx : -1; redraw(); }

    function onCatalogTap(item) {
        if (menuState === 'select') {
            if (action('add', { x: cell.x, y: cell.y, id: item.id })) {
                selected = data.widgets.length - 1; menuState = 'edit'; editPick = null; refreshMaxPage(); redraw();
            }
        } else {
            const w = data.widgets[selected]; if (!w) return;
            if (editPick !== 'page' && editPick !== 'together') { msg = 'Сначала выберите "Страница" или "Вместе"'; redraw(); return; }
            const operation = editPick;
            editPick = null;
            action(operation, { id: item.id });
            redraw();
        }
    }

    function startResize(h) { resizing = true; resizeDir = h.dir; resizeStart = { x: hx, y: hy };
        const w = data.widgets[h.index]; resizeOrig = { index: h.index, x: w.x, y: w.y, w: w.w, h: w.h }; resizePreview = null; }
    function calculateResize(cx, cy) {
        const dx = cx - resizeStart.x, dy = cy - resizeStart.y;
        const w = data.widgets[resizeOrig.index]; if (!w) return null;
        let newW = resizeOrig.w, newH = resizeOrig.h; const dir = resizeDir;
        if (dir.indexOf('r') >= 0) newW = Math.max(1, Math.min(COLS, resizeOrig.w + Math.round(dx / cw)));
        if (dir.indexOf('l') >= 0) newW = Math.max(1, Math.min(COLS, resizeOrig.w + Math.round(-dx / cw)));
        if (dir.indexOf('b') >= 0) newH = Math.max(1, Math.min(ROWS, resizeOrig.h + Math.round(dy / ch)));
        if (dir.indexOf('t') >= 0) newH = Math.max(1, Math.min(ROWS, resizeOrig.h + Math.round(-dy / ch)));
        const nx = dir.indexOf('l') >= 0 ? resizeOrig.x + resizeOrig.w - newW : resizeOrig.x;
        const ny = dir.indexOf('t') >= 0 ? resizeOrig.y + resizeOrig.h - newH : resizeOrig.y;
        const result = M.apply(data, 'size', resizeOrig.index, { x: nx, y: ny, w: newW, h: newH });
        if (result.error) { msg = 'Не помещается. Освободите место'; return null; }
        return { x: nx, y: ny, w: newW, h: newH };
    }
    function previewResize(cx, cy) {
        resizePreview = calculateResize(cx, cy);
        if (resizePreview) msg = '';
        redraw();
    }

    // ---- Drawing ----
    // Baseline that vertically centres a line of `s` px inside a box [y, y+h].
    function vmid(y, h, s) { return y + h / 2 + s * 0.33; }
    function drawHandles(cv, b) {
        const s = 12, t = 3, c = color.accent, inset = 5;
        const L = (px, py, sx, sy) => { cv.line(px, py, px + sx * s, py, t, c); cv.line(px, py, px, py + sy * s, t, c); };
        L(b.x + inset, b.y + inset, 1, 1);
        L(b.x + b.w - inset, b.y + inset, -1, 1);
        L(b.x + inset, b.y + b.h - inset, 1, -1);
        L(b.x + b.w - inset, b.y + b.h - inset, -1, -1);
    }
    function drawSwipeDots(cv, w) {
        const n = Math.min(6, w.pages.length), sp = 8;
        const b = box(w);
        const sx = b.x + b.w - sp - ((n - 1) * sp) / 2 - 6, sy = b.y + b.h / 2 - ((n - 1) * sp) / 2;
        for (let i = 0; i < n; i++) cv.roundRect(sx + i * sp, sy + i * sp, 6, 6, 2, i === (w.active || 0) ? color.accent : color.line);
    }
    /**
     * One widget value. The live car wins: when the data layer has a usable value for
     * this id, that is what the widget shows and `demo` is false. The demo model is the
     * fallback while no car answers, and it is labelled as such on the card.
     */
    function demoValue(id) {
        const d = DEMO[id] || DEMO.speed;
        const now = demoNow();
        const lv = live && typeof live.read === 'function' ? live.read(id) : null;
        if (lv && lv.valid) {
            const val = typeof lv.n === 'number' ? lv.n : null;
            const arr = demoHist[id] || [];
            if (!readOnlyDraw && val !== null) {
                arr.push([now, val]);
                const cutoff = now - HISTORY_MINUTES * 60 * 1000;
                while (arr.length && arr[0][0] < cutoff) arr.shift();
                demoHist[id] = arr;
            }
            return { d, val, vals: arr.map((h) => h[1]), live: true, text: lv.text, stale: !!lv.stale };
        }
        // No usable value from the car. With a data layer present that means the widget shows "--":
        // inventing a number here would put a plausible-looking reading on the cluster that the
        // car never sent. The demo model stays only for a host with no data layer at all (the
        // layout tests) or when the driver explicitly turns demo data on in settings.
        const demoAllowed = !live || (ctx.settings && typeof ctx.settings.get === 'function' && ctx.settings.get('demo') === 'on');
        if (!demoAllowed) {
            return { d, val: null, vals: (demoHist[id] || []).map((h) => h[1]), live: false, empty: true };
        }
        const val = clamp(d.base + d.wobble * Math.sin(now / 1000 / (d.period || 5)), d.min, d.max);
        const arr = demoHist[id] || [];
        if (!readOnlyDraw) {
            arr.push([now, val]);
            const cutoff = now - HISTORY_MINUTES * 60 * 1000;
            while (arr.length && arr[0][0] < cutoff) arr.shift();
            demoHist[id] = arr;
        }
        return { d, val, vals: arr.map((h) => h[1]), live: false, demoModel: true };
    }
    // Values array for a history id (samples trimmed to the rolling 3-minute window).
    function histVals(id) { const arr = demoHist[id] || []; return arr.map((h) => h[1]); }
    // Shrink a value so value + unit always fit the inner width (never overlaps the unit or edge).
    function _fitValueSize(cv, value, unit, maxSize, minSize, availW) {
        const unitW = unit ? (cv.textWidth ? cv.textWidth(unit, Math.max(11, Math.round(maxSize * 0.30))) : unit.length * maxSize * 0.22) : 0;
        let size = maxSize;
        while (size > minSize) {
            const vw = cv.textWidth ? cv.textWidth(value, size, { font: 'cluster-m' }) : value.length * size * 0.62;
            if (vw + unitW + 10 <= availW) break;
            size -= 2;
        }
        return size;
    }
    // One consistent metric card: label top-left, big value with the unit on the SAME baseline to
    // its right, an optional level bar, an optional rolling sparkline and an optional min/max
    // footer. Every band follows the one above it, so nothing ever overlaps.
    // A stopped feed is the only state worth marking on the card itself: a value the car stopped
    // refreshing reads as current unless it says otherwise. Where the data came from is stated
    // once, in the screen footer, not repeated on every widget.
    function staleTag(dv) {
        return dv && dv.live && dv.stale ? { text: 'НЕТ ОБНОВЛЕНИЯ', color: color.warn } : null;
    }
    function _metricCard(cv, b, o) {
        const compact = o.compact, pad = compact ? 12 : 16;
        const x = b.x, y = b.y, W = b.w, H = b.h;
        const innerL = x + pad, innerR = x + W - pad, innerW = innerR - innerL;
        const danger = o.danger || null;
        const flash = danger ? blinkOn(demoNow()) : false;
        const accent = danger ? color.crit : (o.accent || '#468bd4');
        // Danger repaints the whole card: a filled red wash on the blink phase and a solid red
        // border always, so the state is visible even between flashes.
        if (danger) {
            cv.roundRect(x + 2, y + 2, W - 4, H - 4, 10, flash ? withAlpha(color.crit, 0.22) : '#0e141f');
            cv.strokeRoundRect(x + 2.5, y + 2.5, W - 5, H - 5, 10, 2, color.crit);
        } else {
            cv.roundRect(x + 2, y + 2, W - 4, H - 4, 10, '#0e141f');
            cv.strokeRoundRect(x + 2.5, y + 2.5, W - 5, H - 5, 10, 1, '#26313e');
        }
        // No decorative top rule: the label already names the card, and a coloured stripe on every
        // card is the tell the antislop rules call out. Colour is spent only where it means state.
        const labY = y + (compact ? 20 : 25);
        cv.text(o.label, innerL, labY, compact ? 10.5 : 12, danger ? color.crit : color.muted, { font: 'bold', spacing: 1 });
        // Top-right: DANGER with its cause while the value is out of band, else a stale note.
        if (danger) {
            const t = flash ? 'DANGER' : (danger.label || 'DANGER');
            cv.text(t, innerR, labY, compact ? 9 : 10, color.crit, { align: 'right', font: 'bold' });
        } else if (o.tag) {
            cv.text(o.tag.text, innerR, labY, compact ? 9 : 10, o.tag.color, { align: 'right', font: 'bold' });
        }
        const maxV = compact ? 32 : Math.min(58, Math.max(38, H * 0.36));
        const minV = compact ? 18 : 24;
        const unit = o.unit || '', unitSize = compact ? 12 : 15;
        const vSize = _fitValueSize(cv, o.value, unit, maxV, minV, innerW);
        const vTop = y + (compact ? 26 : 34);
        const vBase = vTop + vSize * 0.74;
        cv.text(o.value, innerL, vBase, vSize, color.white, { font: 'cluster-m' });
        const vw = cv.textWidth ? cv.textWidth(o.value, vSize, { font: 'cluster-m' }) : o.value.length * vSize * 0.6;
        if (unit) cv.text(unit, innerL + vw + (compact ? 5 : 8), vBase, unitSize, color.muted);
        let cursor = vBase + vSize * 0.24;
        if (typeof o.frac === 'number') {
            const barH = 4, barY = cursor + (compact ? 8 : 12), barW = innerW;
            cv.roundRect(innerL, barY, barW, barH, barH / 2, '#26313e');
            const fw = Math.max(barH, barW * Math.max(0, Math.min(1, o.frac)));
            if (o.frac > 0) cv.roundRect(innerL, barY, fw, barH, barH / 2, accent);
            cursor = barY + barH;
        }
        if (o.vals && o.vals.length > 1) {
            const hasMM = !compact;
            const top = cursor + (compact ? 8 : 12);
            const bottom = y + H - (hasMM ? 24 : (compact ? 12 : 16));
            const h = bottom - top;
            if (h > 6) {
                const vals = o.vals, lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
                const span = hi - lo > 1e-6 ? hi - lo : 1, spanW = innerW, x0 = innerL;
                const pts = vals.map((v, i) => [x0 + i / (vals.length - 1) * spanW, bottom - ((v - lo) / span) * h]);
                cv.fillUnder(pts, bottom, withAlpha(accent, 0.12));
                cv.polyline(pts, 2, accent);
            }
            if (!compact) {
                const dec = o.dec || 0;
                cv.text('мин ' + fmt(Math.min.apply(null, o.vals), dec), innerL, y + H - 9, 10, color.muted);
                cv.text('макс ' + fmt(Math.max.apply(null, o.vals), dec), innerR, y + H - 9, 10, color.muted, { align: 'right' });
            }
        }
    }
    // Dynamic metrics: label, big value + unit, level bar (full cards) and a rolling sparkline.
    function drawChart(cv, b, w) {
        const activePage = w.pages[w.active || 0]; if (!activePage || !activePage.length) return;
        const id = activePage[0], item = M.items[id]; if (!item) return;
        const { d, val, vals, live: isLive, stale, text } = demoValue(id);
        const compact = b.h < 130;
        const unit = item.unit || d.unit || '';
        const frac = d.max > d.min ? (val - d.min) / (d.max - d.min) : 0;
        _metricCard(cv, b, {
            label: itemLabel(id), value: text !== undefined && text !== null ? text : fmt(val, d.dec), unit: text !== undefined ? '' : unit, dec: d.dec,
            frac, vals: compact ? null : vals, compact, accent: '#468bd4',
            tag: staleTag({ live: isLive, stale }),
            danger: isLive ? dangerOf(id, val) : null,
            lo: d.min, hi: d.max, valueNum: val,
        });
    }

    const CHART_ITEMS = new Set(['rpm', 'torque', 'power', 'boost', 'pedal', 'powerPct', 'torquePct', 'boostMax', 'speed', 'accel', 'g_long', 'g_lat', 'steer', 'yaw', 'slope', 'fuelFlow']);
    const TEMP_ITEMS = new Set(['coolant', 'oil', 'gearboxTemp', 'outside', 't_fl', 't_fr', 't_rl', 't_rr']);
    const STATE_ITEMS = new Set(['gear', 'engineState', 'startStop', 'mode', 'braking', 'handbrake', 'track', 'artist', 'map', 'route']);
    const WHEEL_IDS = ['p_fl', 'p_fr', 'p_rl', 'p_rr'];
    // Russian corner labels: the cluster is a Russian build, and "ПЛ/ПП/ЗЛ/ЗП" needs no
    // translation for the driver. The letters stay short enough for a 1x1 column.
    const WHEEL_LABELS = ['ПЛ', 'ПП', 'ЗЛ', 'ЗП'];
    function itemLabel(id) {
        const i = M.items[id];
        if (id === 'tyres') return 'ШИНЫ';
        if (/^p_(fl|fr|rl|rr)$/.test(id)) return 'ДАВЛЕНИЕ ' + WHEEL_LABELS[WHEEL_IDS.indexOf(id)];
        if (/^t_(fl|fr|rl|rr)$/.test(id)) return 'ТЕМП. ' + id.slice(2).toUpperCase();
        return i && i.name ? i.name.toUpperCase() : 'НЕИЗВЕСТНЫЙ ПОКАЗАТЕЛЬ';
    }
    function drawCard(cv, b, id, x, width, compact) {
        const item = M.items[id], known = !!(item && DEMO[id]);
        const state = STATE_ITEMS.has(id);
        const C = compact || b.h < 130;
        const pad = C ? 12 : 16;
        const dv0 = state ? (live && typeof live.read === 'function' ? live.read(id) : null) : null;
        const tag0 = staleTag(dv0 && dv0.valid ? { live: true, stale: dv0.stale } : { live: false });
        if (state) {
            cv.roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 10, '#0e141f');
            cv.strokeRoundRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5, 10, 1, '#26313e');
            cv.text(itemLabel(id), b.x + pad, b.y + (C ? 20 : 25), C ? 10.5 : 12, color.muted, { font: 'bold', spacing: 1 });
            if (tag0) cv.text(tag0.text, b.x + b.w - pad, b.y + (C ? 20 : 25), C ? 9 : 10, tag0.color, { align: 'right', font: 'bold' });
            // A state value is a word from the car, never a stand-in: unknown stays unknown.
            const txt = dv0 && dv0.valid ? (dv0.text !== undefined ? dv0.text : String(dv0.n)) : '--';
            const cy = b.y + b.h * 0.60;
            const pw = Math.min(b.w - 2 * pad, C ? 160 : 220), ph = C ? 26 : 34;
            cv.roundRect(b.x + (b.w - pw) / 2, cy - ph / 2, pw, ph, 8, color.selected);
            fit(cv, txt, b.x + b.w / 2, cy + (C ? 6 : 8), C ? 15 : 19, pw - 12, { align: 'center', font: 'bold', color: dv0 && dv0.valid ? color.accent : color.muted });
            return;
        }
        const dv = known ? demoValue(id) : null;
        const raw = dv ? dv.val : null;
        const dm = known ? DEMO[id] : null;
        const frac = (dm && raw != null && dm.max > dm.min) ? Math.max(0, Math.min(1, (raw - dm.min) / (dm.max - dm.min))) : null;
        const tag = staleTag(dv);
        _metricCard(cv, b, {
            label: itemLabel(id),
            value: dv && dv.text !== undefined && dv.text !== null ? dv.text : (known && raw != null ? fmt(raw, dm.dec) : '--'),
            unit: dv && dv.text !== undefined ? '' : (known ? (dm.unit || item.unit || '') : ''),
            dec: known ? dm.dec : 0,
            frac, vals: null, compact: C, accent: color.accent, tag,
            danger: dv && dv.live ? dangerOf(id, raw) : null,
            lo: dm ? dm.min : undefined, hi: dm ? dm.max : undefined, valueNum: raw,
        });
    }
    function drawTemperature(cv, b, id) {
        const item = M.items[id], known = !!(item && DEMO[id]);
        const d = known ? DEMO[id] : null;
        const H = b.h, W = b.w;
        const ring = known && H >= 130 && W <= H * 2.6;   // tall, not elongated -> dial; else horizontal gauge
        if (!ring) {
            const dv = known ? demoValue(id) : null;
            const val = dv ? dv.val : null;
            const pad = 12, x = b.x, y = b.y, W = b.w, H = b.h;
            cv.roundRect(x + 2, y + 2, W - 4, H - 4, 10, '#0e141f');
            cv.strokeRoundRect(x + 2.5, y + 2.5, W - 5, H - 5, 10, 1, '#26313e');
            const dvC = demoValue(id);
            const dgrC = dvC.live ? dangerOf(id, dvC.val) : null;
            const flashC = dgrC ? blinkOn(demoNow()) : false;
            if (dgrC) cv.strokeRoundRect(x + 2.5, y + 2.5, W - 5, H - 5, 10, 2, color.crit);
            cv.text(itemLabel(id), x + pad, y + 20, 10.5, dgrC ? color.crit : color.muted, { font: 'bold', spacing: 1 });
            const tagC = staleTag(dvC);
            if (dgrC) cv.text(flashC ? 'DANGER' : (dgrC.label || 'DANGER'), x + W - pad, y + 20, 9, color.crit, { align: 'right', font: 'bold' });
            else if (tagC) cv.text(tagC.text, x + W - pad, y + 20, 9, tagC.color, { align: 'right', font: 'bold' });
            if (!known || val == null) { cv.text('--', x + W / 2, y + H * 0.62, 24, color.muted, { align: 'center', font: 'cluster-m' }); return; }
            // compact dial: small 270-degree ring on the left, value + unit to its right (SOC/SOH echo)
            const frac = d.max > d.min ? Math.max(0, Math.min(1, (val - d.min) / (d.max - d.min))) : 0;
            const R = Math.min(H * 0.30, 30), th = Math.max(6, R * 0.22);
            const cx = x + pad + R, cy = y + H * 0.60;
            cv.arc(cx, cy, R - th, R, -135, 135, '#26313e', { round: true });
            if (frac > 0.002) cv.arc(cx, cy, R - th, R, -135, -135 + frac * 270, dgrC ? color.crit : color.accent, { round: true });
            const vSize = Math.min(34, Math.round(H * 0.42)), vStr = fmt(val, d.dec);
            const vx = cx + R + 12, vBase = cy + vSize * 0.30;
            cv.text(vStr, vx, vBase, vSize, color.white, { font: 'cluster-m' });
            const vw = cv.textWidth ? cv.textWidth(vStr, vSize, { font: 'cluster-m' }) : vStr.length * vSize * 0.6;
            const unit = d.unit || item.unit || '';
            if (unit) cv.text(unit, vx + vw + 6, vBase, 12, color.muted);
            return;
        }
        const pad = 16;
        const { d: dd, val, live: ringLive, stale: ringStale } = demoValue(id);
        const dgrR = ringLive ? dangerOf(id, val) : null;
        const flashR = dgrR ? blinkOn(demoNow()) : false;
        cv.roundRect(b.x + 2, b.y + 2, W - 4, H - 4, 10, dgrR && flashR ? withAlpha(color.crit, 0.22) : '#0e141f');
        cv.strokeRoundRect(b.x + 2.5, b.y + 2.5, W - 5, H - 5, 10, dgrR ? 2 : 1, dgrR ? color.crit : '#26313e');
        cv.text(itemLabel(id), b.x + pad, b.y + 25, 12, dgrR ? color.crit : color.muted, { font: 'bold', spacing: 1 });
        const tagRing = staleTag({ live: ringLive, stale: ringStale });
        if (dgrR) cv.text(flashR ? 'DANGER' : (dgrR.label || 'DANGER'), b.x + W - pad, b.y + 25, 10, color.crit, { align: 'right', font: 'bold' });
        else if (tagRing) cv.text(tagRing.text, b.x + W - pad, b.y + 25, 10, tagRing.color, { align: 'right', font: 'bold' });
        const frac = Math.max(0, Math.min(1, (val - dd.min) / (dd.max - dd.min)));
        // Ring per the reference: a 300° sweep with the gap at the BOTTOM, a thicker stroke, faint
        // ticks outside it, and the value centred with the unit under it. The gap at the bottom
        // keeps the open side away from the label, so the dial reads as a gauge, not a donut.
        const cx = b.x + W / 2, cy = b.y + H * 0.50;
        const R = Math.min(W * 0.38, H * 0.32, 118);
        const th = Math.max(11, R * 0.20);
        const A0 = -150, SWEEP = 300;              // start lower-left, sweep over the top to lower-right
        const ringTint = dgrR ? color.crit : color.accent;
        // The track runs the full sweep first; the ticks then sit just outside it, so a tick never
        // floats where there is no track under it.
        cv.arc(cx, cy, R - th, R, A0, A0 + SWEEP, '#1b2430', { round: true });
        // Outer ticks: 30 marks, longer every fifth, tinted up to the value.
        for (let i = 0; i <= 30; i++) {
            const a = (A0 + SWEEP * (i / 30)) * Math.PI / 180;
            const major = i % 5 === 0;
            const r0 = R + 3, r1 = R + (major ? 9 : 6);
            const on = i / 30 <= frac + 1e-6;
            cv.line(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0, cx + Math.sin(a) * r1, cy - Math.cos(a) * r1,
                major ? 1.6 : 1, withAlpha(on ? ringTint : color.muted, on ? 0.8 : 0.28));
        }
        if (frac > 0.002) cv.arc(cx, cy, R - th, R, A0, A0 + SWEEP * frac, ringTint, { round: true });
        // Value centred in the ring, unit directly under it: the reference's hierarchy.
        const vSize = Math.round(R * 0.54);
        cv.text(fmt(val, dd.dec), cx, cy + vSize * 0.30, vSize, dgrR ? color.crit : color.white, { align: 'center', font: 'cluster-m' });
        cv.text(dd.unit || item.unit || '', cx, cy + R * 0.66, Math.round(R * 0.18), dgrR ? color.crit : color.muted, { align: 'center' });
        // Scale ends sit on the ring's own gap, not in the card corners: they label the sweep.
        const gapA = (A0 + 360) * Math.PI / 180;
        const gy = cy + Math.cos((A0 + SWEEP / 2) * Math.PI / 180) * 0 + R * 0.92;
        cv.text(fmt(dd.min, dd.dec), cx - R * 0.62, gy, 10, color.muted, { align: 'center' });
        cv.text(fmt(dd.max, dd.dec), cx + R * 0.62, gy, 10, color.muted, { align: 'center' });
    }
    function drawNumberWithUnit(cv, value, unit, centerX, y, size, valueColor, unitColor, unitSize, align) {
        const valueWidth = cv.textWidth ? cv.textWidth(value, size, { font: 'cluster-m' }) : value.length * size * 0.62;
        const unitWidth = cv.textWidth ? cv.textWidth(unit, unitSize) : unit.length * unitSize * 0.55;
        const totalWidth = valueWidth + unitWidth + 3;
        const left = align === 'right' ? centerX - totalWidth : centerX - totalWidth / 2;
        cv.text(value, left + valueWidth / 2, y, size, valueColor, { align: 'center', font: 'cluster-m' });
        cv.text(unit, left + valueWidth + 3, y, unitSize, unitColor);
    }
    /**
     * The four-wheel widget. Two layouts, one idea: the wheels sit where they sit on the car
     * (front pair on top), each with its pressure as the hero number, its temperature quiet, and
     * its deviation from the car's own target pressure as the reading that actually means
     * something. A pressure on target is a bare number; off-target adds the signed delta.
     * Danger is per wheel, never a wash over the whole block, so the driver sees WHICH tyre.
     */
    /**
     * The four-wheel widget, drawn as a 2x2 quadrant map.
     *
     * Design decision: the reading a driver needs is not "what is the pressure" but "is this tyre
     * where it should be". So each quadrant leads with its DEVIATION from the car's own target
     * (-0.4 / +0.2 bar), and the absolute pressure sits under it as context. A tyre on target
     * shows a single quiet dash instead of a number, which makes the off-target ones stand out
     * without any colour at all.
     *
     * Layout is a quadrant map, not a list: four cells, front pair on top, so the geometry says
     * "front left" before the label does. The cells share one hairline cross, so the block reads
     * as one instrument rather than four cards inside a card.
     */
    /**
     * The tyre pictogram the dashboard uses: a rounded carcass with three tread bars. Drawn here
     * at any size, tinted by the wheel's state, so a bad corner is identified before a number is
     * read. The shape is the same as on the centre screen, so the two never look unrelated.
     */
    function tyreGlyph(cv, x, y, w, h, tint) {
        cv.strokeRoundRect(x, y, w, h, Math.max(2, w * 0.18), 1.4, tint);
        const inset = w * 0.26;
        const barW = w - inset * 2, barH = Math.max(1, h * 0.075);
        for (let i = 0; i < 3; i++) {
            const by = y + h * (0.26 + i * 0.24) - barH / 2;
            cv.fillRect(x + inset, by, barW, barH, tint);
        }
    }
    function drawTyres(cv, b, compact) {
        cv.roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 10, color.row);
        cv.strokeRoundRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5, 10, 1, color.line);

        const press = WHEEL_IDS.map((id) => demoValue(id));
        const temp = WHEEL_IDS.map((id) => demoValue('t_' + id.slice(2)));
        const target = WHEEL_IDS.map((id) => demoValue('tp_' + id.slice(2)));
        const anyStale = press.concat(temp).some((v) => v.stale);
        const wheels = WHEEL_IDS.map((id, i) => {
            const delta = press[i].val != null && target[i].val != null ? pressureDelta(press[i].val, target[i].val) : null;
            return {
                i, p: press[i], t: temp[i], tp: target[i], delta,
                dg: press[i].live ? tyreDanger(press[i].val, target[i].live ? target[i].val : null, temp[i].live ? temp[i].val : null) : null
            };
        });
        const bad = wheels.filter((w) => w.dg).length;
        const flash = blinkOn(demoNow());
        const num = (v, dec) => (v && v.val != null ? fmt(v.val, dec) : '--');

        cv.text('ШИНЫ', b.x + 12, b.y + 17, compact ? 10.5 : 12, bad ? color.crit : color.muted, { font: 'bold', spacing: 1 });
        if (bad) cv.text(flash ? 'DANGER' : bad + ' ИЗ 4', b.x + b.w - 12, b.y + 17, compact ? 9 : 10, color.crit, { align: 'right', font: 'bold' });
        else if (anyStale) cv.text('НЕТ ОБНОВЛЕНИЯ', b.x + b.w - 12, b.y + 17, 9, color.warn, { align: 'right', font: 'bold' });

        // 1x1: one row of four. Each column keeps the same two facts as a large cell - the
        // pressure it should have and the deviation from it - with the tyre temperature as context.
        if (compact) {
            const colW = b.w / 4;
            wheels.forEach((w, i) => {
                const cx = b.x + i * colW + colW / 2;
                if (w.dg) cv.roundRect(b.x + i * colW + 3, b.y + 23, colW - 6, b.h - 29, 5, withAlpha(color.crit, 0.16));
                const cL = b.x + i * colW + 8, cR = b.x + (i + 1) * colW - 8;
                // The 1x1 is the only size without the pictogram: its column cannot hold a tyre
                // and a label without crowding both. Every wider size gets it, on the RIGHT of the
                // column and large enough to work as the corner's marker.
                if (colW >= 160) {
                    const gH = Math.max(22, Math.min(34, Math.round(b.h * 0.34)));
                    const gW = Math.round(gH * 0.78);
                    tyreGlyph(cv, cR - gW, b.y + 24, gW, gH, w.dg ? color.crit : color.muted);
                    cv.text(WHEEL_LABELS[i], cL, b.y + 36, 10, w.dg ? color.crit : color.muted, { font: 'bold' });
                } else {
                    cv.text(WHEEL_LABELS[i], cL, b.y + 34, 10, w.dg ? color.crit : color.muted, { font: 'bold' });
                }
                const tC = num(w.t, 0);
                cv.text(tC === '--' ? '--' : tC + '°C', cL, b.y + 48, 9, w.dg ? color.crit : color.muted);
                // Deviation under the label, pressure under it. ASCII '-' because the monospace
                // digit atlas has no U+2212: a typographic minus renders as nothing at all.
                const inSpecC = w.delta !== null && Math.abs(w.delta) < 0.05;
                if (inSpecC) {
                    cv.fillRect(cx - 7, b.y + 52, 14, 3, withAlpha(color.muted, 0.7));
                } else {
                    const dTxtC = w.delta === null ? '--' : (w.delta > 0 ? '+' : '-') + Math.abs(w.delta).toFixed(1);
                    const off = w.delta !== null;
                    cv.text(dTxtC, cx, b.y + 56, 14, w.dg ? color.crit : off ? color.warn : color.muted, { align: 'center', font: 'cluster-m' });
                }
                drawNumberWithUnit(cv, num(w.p, 1), 'бар', cx, b.y + 72, 10, w.dg ? color.crit : color.white, w.dg ? color.crit : color.white, 8);
            });
            return;
        }

        // Large: a quadrant map with a shared hairline cross. The cross is the only rule and it
        // carries meaning (axle and centre line), so no per-cell borders are needed.
        const headH = 30, padX = 12, padB = 10;
        const mapX = b.x + padX, mapY = b.y + headH;
        const mapW = b.w - padX * 2, mapH = b.h - headH - padB;
        const cellW = mapW / 2, cellH = mapH / 2;
        const midX = mapX + cellW, midY = mapY + cellH;
        cv.fillRect(midX, mapY + 6, 1, mapH - 12, withAlpha(color.line, 0.5));
        cv.fillRect(mapX + 6, midY, mapW - 12, 1, withAlpha(color.line, 0.5));

        wheels.forEach((w, i) => {
            const col = i % 2, row = i < 2 ? 0 : 1;
            const x = mapX + col * cellW, y = mapY + row * cellH;
            const off = w.delta !== null && Math.abs(w.delta) >= 0.05;
            const inner = { x: x + (col === 0 ? 8 : 14), y: y + 6, w: cellW - 22, h: cellH - 10 };
            if (w.dg) cv.roundRect(inner.x - 6, inner.y, inner.w + 8, inner.h, 7, flash ? withAlpha(color.crit, 0.18) : withAlpha(color.crit, 0.07));
            const tint = w.dg ? color.crit : off ? color.warn : color.white;

            // Row 1: corner label + temperature on the left, the tyre pictogram on the RIGHT and
            // large, because the pictogram is how a driver finds the corner at a glance - it is a
            // marker, not a footnote. Tinted by this wheel's state, so a bad corner is identified
            // by shape before any number is read.
            const tStr = num(w.t, 0);
            cv.text(WHEEL_LABELS[i], inner.x, y + 21, 10, w.dg ? color.crit : color.muted, { font: 'bold', spacing: 0.6 });
            cv.text(tStr === '--' ? '--' : tStr + '°C', inner.x + 22, y + 21, 10, w.dg ? color.crit : color.muted);
            // Sized off the cell so it scales with the widget, and kept square-ish: a tyre is taller
            // than it is wide.
            const gH = Math.max(24, Math.min(46, Math.round(cellH * 0.46)));
            const gW = Math.round(gH * 0.78);
            tyreGlyph(cv, inner.x + inner.w - gW, y + 6, gW, gH, w.dg ? color.crit : color.muted);

            // Row 2: the deviation, large. This is the widget's answer to "is anything wrong".
            const big = Math.max(22, Math.min(32, Math.round(cellH * 0.32)));
            const inSpec = w.delta !== null && Math.abs(w.delta) < 0.05;
            const dBase = y + cellH * 0.60;
            // In spec there is nothing to report, so a short rule stands where the number would be:
            // quieter than "0 бар", which reads as a measurement that was taken.
            // Off spec the deviation is the headline. ASCII '-' and not U+2212 - the monospace
            // digit atlas has no typographic minus and would drop the sign entirely.
            if (inSpec) {
                cv.fillRect(inner.x, dBase - big * 0.30, Math.round(big * 1.1), 3, withAlpha(color.muted, 0.7));
            } else {
                const dTxt = w.delta === null ? '--' : (w.delta > 0 ? '+' : '-') + Math.abs(w.delta).toFixed(1);
                cv.text(dTxt, inner.x, dBase, big, tint, { font: 'cluster-m' });
                if (w.delta !== null) {
                    const dw = cv.textWidth ? cv.textWidth(dTxt, big, { font: 'cluster-m' }) : dTxt.length * big * 0.6;
                    cv.text('бар', inner.x + dw + 5, dBase, 10, w.dg ? color.crit : color.muted);
                }
            }

            // Row 3: the absolute pressure and what it should be, as context under the deviation.
            const tgt = num(w.tp, 1);
            const abs = num(w.p, 1);
            cv.text(tgt === '--' ? abs + ' бар' : abs + ' из ' + tgt, inner.x, y + cellH - 8, 10, color.muted);
        });
    }

    function drawCompactTyrePair(cv, b, otherId) {
        // Preserve both legacy paired signals in a 1×1 widget: four concise wheel readouts
        // above a dedicated line for the companion signal rather than clipping one away.
        drawTyres(cv, b, true);
        const item = M.items[otherId], d = ['track', 'artist', 'map', 'route'].includes(otherId) ? null : DEMO[otherId];
        const name = itemLabel(otherId), unit = d ? (d.unit || item.unit || '') : (item && item.unit || '');
        const ov = d ? demoValue(otherId) : null;
        const value = ov && ov.text !== undefined ? ov.text : (ov && ov.val != null ? fmt(ov.val, d.dec) : '--');
        const y = b.y + b.h - 5, left = b.x + 10, right = b.x + b.w - 10;
        const nameSize = 11, valueSize = 13, unitSize = 11, gap = 5;
        const nameWidth = cv.textWidth ? cv.textWidth(name, nameSize, { font: 'bold' }) : name.length * nameSize * 0.6;
        const valueWidth = cv.textWidth ? cv.textWidth(value, valueSize, { font: 'cluster-m' }) : value.length * valueSize * 0.62;
        const unitWidth = unit ? (cv.textWidth ? cv.textWidth(unit, unitSize) : unit.length * unitSize * 0.55) : 0;
        const unitGap = unit ? 4 : 0;
        // Keep the companion on a dedicated footer row; place the value/unit group at
        // the right edge so even longer labels cannot collide with it or the tyre row.
        cv.text(name, left, y, nameSize, color.muted, { font: 'bold' });
        const groupWidth = valueWidth + unitGap + unitWidth;
        const groupLeft = Math.max(left + nameWidth + gap, right - groupWidth);
        cv.text(value, groupLeft + valueWidth / 2, y, valueSize, color.white, { align: 'center', font: 'cluster-m' });
        if (unit) cv.text(unit, groupLeft + valueWidth + unitGap, y, unitSize, color.white);
    }
    function drawSemantic(cv, b, w) {
        const page = w.pages && w.pages[w.active || 0];
        if (!page || !page.length) return;
        const tyreIndex = page.indexOf('tyres');
        if (tyreIndex >= 0 && page.length === 1) { drawTyres(cv, b, b.h < 125); return; }
        if (tyreIndex >= 0 && page.length === 2 && b.h < 125) {
            drawCompactTyrePair(cv, b, page[1 - tyreIndex]);
            return;
        }
        const cols = page.length, subW = b.w / cols;
        page.forEach((id, i) => {
            const part = { x: b.x + i * subW, y: b.y, w: subW, h: b.h };
            if (id === 'tyres') drawTyres(cv, part, part.h < 125);
            else if (TEMP_ITEMS.has(id)) drawTemperature(cv, part, id);
            else if (CHART_ITEMS.has(id) && M.items[id] && DEMO[id]) drawChart(cv, part, { ...w, pages: [[id]], active: 0, w: w.w / cols, h: w.h });
            else drawCard(cv, part, id, part.x, subW, b.w < 520 || b.h < 140);
        });
    }

    // ---- Touch ----
    function touch(phase, tx, ty) {
        if (!isActive() && !showMenu) return false;
        if (phase === 1) {
            if (resizing) return true;
            const h = hit(tx, ty);
            // Preset sheet owns the touch while it is open: nothing behind it may react.
            if (showPresets) {
                gesture = { presets: true, presetTarget: presetTargetAt(tx, ty), moved: false, ox: tx, oy: ty, timer: null };
                return true;
            }
            if (h && h.presetButton) { gesture = { presetButton: true, moved: false, ox: tx, oy: ty, timer: null }; return true; }
            if (h && h.menu) {
                gesture = { menu: true, menuTarget: menuTargetAt(tx, ty), moved: false, ox: tx, oy: ty, timer: null };
                return true;
            }
            if (h && h.delete) { gesture = { deleteTarget: true, moved: false, ox: tx, oy: ty, timer: null }; return true; }
            if (h && h.corner) { startResize(h); return true; }
            const mode = h && h.index >= 0 ? 'move' : 'add';
            gesture = { h, moved: false, mode, ox: tx, oy: ty, timer: null };
            if (h && h.index >= 0) cell = { x: h.x, y: h.y };
            if (!edit && h) gesture.timer = setTimeout(function () { if (gesture && !gesture.moved) { gesture.longPressed = true; openMenuFor(h); } }, 600);
            else if (edit) gesture.timer = setTimeout(function () { if (gesture && !gesture.moved) gesture.mode = 'move'; }, 400);
            return true;
        }
        if (phase === 2) {
            if (resizing) { previewResize(tx, ty); return true; }
            if (!gesture) return false;
            const dx = tx - gesture.ox, dy = ty - gesture.oy;
            if (!gesture.moved && (Math.abs(dx) > 18 || Math.abs(dy) > 18)) { gesture.moved = true; clearTimeout(gesture.timer); }
            if (gesture.deleteTarget) {
                const deleteHit = hit(tx, ty);
                if (!deleteHit || !deleteHit.delete || deleteHit.index !== selected) gesture.moved = true;
            }
            if (gesture.menu && gesture.menuTarget !== menuTargetAt(tx, ty)) gesture.menuLeftTarget = true;
            if (edit && gesture.moved && gesture.mode === 'move' && gesture.h && gesture.h.index >= 0) {
                const w = data.widgets[gesture.h.index];
                const dx = tx - gesture.ox, dy = ty - gesture.oy;
                const x = w.x + Math.round(dx / (cw + GAP)), y = w.y + Math.round(dy / (ch + GAP));
                dragTarget = { x, y, valid: M.fits(data.widgets, x, y, w.w, w.h, gesture.h.index) };
                msg = dragTarget.valid ? 'Перетащите виджет в свободную ячейку' : 'Не помещается. Освободите место';
                redraw();
            }
            return true;
        }
        if (phase === 3) {
            if (gesture) clearTimeout(gesture.timer);
            // Preset sheet: a tap inside the sheet acts; a tap outside closes it. A drag that
            // leaves the row it started on cancels, so a scroll never applies a preset by accident.
            if (gesture && gesture.presets) {
                const start = gesture.presetTarget, moved = gesture.moved;
                gesture = null;
                const released = presetTargetAt(tx, ty);
                if (!moved && start && released && start.kind === released.kind && start.index === released.index) {
                    if (start.kind === 'close') { closePresets(); return true; }
                    if (start.kind === 'save') { savePreset(); return true; }
                    if (start.kind === 'apply') { applyPreset(start.index); return true; }
                    if (start.kind === 'delete') { deletePreset(start.index); return true; }
                }
                return true;
            }
            if (gesture && gesture.presetButton) {
                const moved = gesture.moved;
                gesture = null;
                if (!moved) openPresets();
                return true;
            }
            if (resizing) {
                const candidate = calculateResize(tx, ty);
                if (candidate && (candidate.x !== resizeOrig.x || candidate.y !== resizeOrig.y || candidate.w !== resizeOrig.w || candidate.h !== resizeOrig.h)) {
                    selected = resizeOrig.index;
                    save(M.apply(data, 'size', resizeOrig.index, candidate));
                }
                resizing = false; resizePreview = null; redraw(); return true;
            }
            if (gesture && gesture.h && gesture.h.recommendation) {
                const released = hit(tx, ty);
                const valid = !gesture.moved && released && released.recommendation;
                gesture = null;
                if (valid) acceptRecommendation();
                return true;
            }
            if (gesture && gesture.menu) {
                const target = gesture.menuTarget;
                const moved = gesture.moved, leftTarget = gesture.menuLeftTarget;
                const released = menuTargetAt(tx, ty);
                gesture = null;
                if (!leftTarget && !moved && target && target === released) {
                    hit(tx, ty);
                    handleMenuTap({ menu: true });
                }
                return true;
            }
            if (gesture && gesture.deleteTarget) {
                const released = hit(tx, ty);
                const valid = !gesture.moved && released && released.delete && released.index === selected;
                gesture = null;
                if (valid) deleteSelected();
                return true;
            }
            if (gesture && gesture.longPressed) { gesture = null; return true; }
            if (gesture && gesture.h) {
                if (edit) {
                    if (gesture.moved && gesture.mode === 'move' && gesture.h.index >= 0) {
                        const target = dragTarget;
                        if (target) {
                            const result = M.apply(data, 'move', gesture.h.index, { x: target.x, y: target.y });
                            if (result.error) { msg = 'Перемещение отклонено: ячейка занята или вне сетки'; redraw(); }
                            else save(result);
                        } else redraw();
                    } else selectWidget(gesture.h.index >= 0 ? gesture.h.index : -1);
                } else if (gesture.moved && gesture.h.index >= 0 && Math.abs(ty - gesture.oy) > 40 && Math.abs(ty - gesture.oy) > Math.abs(tx - gesture.ox)) {
                    selected = gesture.h.index; action('next', { delta: ty < gesture.oy ? 1 : -1 });
                }
            }
            gesture = null; dragTarget = null; return true;
        }
        if (phase === 4) {
            if (gesture) clearTimeout(gesture.timer);
            if (gesture && gesture.toolbarAction === 'clear' && confirmClear) { confirmClear = false; msg = 'Очистка отменена'; }
            if (gesture && gesture.moved) msg = 'Перетаскивание отменено';
            gesture = null; dragTarget = null; resizing = false; resizePreview = null; redraw(); return true;
        }
        return true;
    }
    const oldTouch = ctx.display._touch;
    ctx.display._touch = function (phase, x, y) { if (touch(phase, x, y)) return; return oldTouch.call(this, phase, x, y); };

    // ---- Menu geometry: ONE source of truth for drawing and hit-testing ----
    // Panel is 500 x 504 at (MX, MY). Every control below is derived from these offsets, so a
    // design change moves the drawn rectangle and its pointer target together.
    const MNP = { head: 70, pad: 16, chipW: 40, chipH: 30, chipGap: 6, ctlH: 36, ctlGap: 8, delH: 34, cardGapY: 4 };
    function isEditMenu() { return menuState === 'edit' && selected >= 0; }
    function chipRect(i) { return { x: MX + MNP.pad + i * (MNP.chipW + MNP.chipGap), y: MY + MNP.head + 28, w: MNP.chipW, h: MNP.chipH }; }
    function ctlRect(k) { const bw = (MW - MNP.pad * 2 - 8) / 2; return { x: MX + MNP.pad + (k % 2) * (bw + 8), y: MY + MNP.head + 68 + Math.floor(k / 2) * (MNP.ctlH + MNP.ctlGap), w: bw, h: MNP.ctlH }; }
    function delRect() { const r = ctlRect(2); return { x: MX + MNP.pad, y: r.y + MNP.ctlH + 10, w: MW - MNP.pad * 2, h: MNP.delH }; }
    // The catalogue fills the band between the controls and the pager: 6 cards while managing a
    // widget, 12 while adding. The card height is derived from the space actually left, so the
    // last row always meets the pager instead of leaving a dead band above it.
    function catalogPageSize() { return isEditMenu() ? 6 : 12; }
    function catTopOf() { return isEditMenu() ? delRect().y + MNP.delH + 32 : MY + MNP.head + 34; }
    function catRows() { return Math.ceil(catalogPageSize() / 2); }
    function cardH() {
        const pagerTop = MY + MH - 48;
        const avail = pagerTop - catTopOf() - (catRows() - 1) * MNP.cardGapY;
        // 48 is the floor: below that a card is two cramped lines instead of one readable row.
        return Math.max(48, Math.min(58, Math.floor(avail / catRows())));
    }
    function catalogCard(i) { const cardW = (MW - MNP.pad * 2 - 8) / 2; return { x: MX + MNP.pad + (i % 2) * (cardW + 8), y: catTopOf() + Math.floor(i / 2) * (cardH() + MNP.cardGapY), w: cardW, h: cardH() }; }
    function pageControl(direction) { return { x: MX + MNP.pad + (direction === 'prev' ? 0 : MW - MNP.pad * 2 - 104), y: MY + MH - 48, w: 104, h: 34 }; }

    // Give every actionable menu region a stable identity. A menu action is committed only
    // when a gesture starts and ends on this exact target; the menu's empty background is inert.
    function menuTargetAt(x, y) {
        const cbx = MX + MW - 44, cby = MY + 10, cbs = 32;
        if (x >= cbx && x < cbx + cbs && y >= cby && y < cby + cbs) return 'close';
        if (isEditMenu()) {
            const w = data.widgets[selected];
            if (!w) return null;
            for (let i = 0; i < w.pages.length; i++) { const r = chipRect(i); if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return 'page:' + i; }
            const keys = ['page', 'together', 'order', 'removeItem'];
            for (let k = 0; k < keys.length; k++) { const r = ctlRect(k); if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return 'control:' + keys[k]; }
            const d = delRect();
            if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return 'delete';
        }
        const list = menuState === 'select' ? selectFlat : addFlat;
        const pages = Math.max(1, Math.ceil(list.length / catalogPageSize()));
        for (const direction of ['prev', 'next']) { const r = pageControl(direction); if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && (direction === 'prev' ? menuPage > 0 : menuPage < pages - 1)) return direction === 'prev' ? 'page-up' : 'page-down'; }
        for (let i = 0; i < catalogPageSize(); i++) {
            const idx = menuPage * catalogPageSize() + i;
            if (idx >= list.length) break;
            const rect = catalogCard(i);
            if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return 'catalog:' + idx;
        }
        return null;
    }
    function handleMenuTap(h) {
        const x = hx, y = hy;
        const cbx = MX + MW - 44, cby = MY + 10, cbs = 32;
        if (x >= cbx && x < cbx + cbs && y >= cby && y < cby + cbs) { const hadWidget = isEditMenu(); clearMenu(); edit = true; if (!hadWidget) selected = -1; msg = hadWidget ? 'Редактирование: перетащите виджет или удерживайте для меню' : 'Редактирование сетки'; computeLayout(); redraw(); return; }
        if (isEditMenu()) {
            const w = data.widgets[selected];
            for (let i = 0; i < w.pages.length; i++) {
                const r = chipRect(i);
                if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) { if (i !== w.active) action('next', { delta: i - w.active }); return; }
            }
            const keys = ['page', 'together', 'order', 'removeItem'];
            for (let k = 0; k < keys.length; k++) {
                const r = ctlRect(k);
                if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
                    const knd = keys[k];
                    if (knd === 'order') { editPick = null; action(knd); }
                    else if (knd === 'removeItem') removeSelectedItem();
                    else { editPick = editPick === knd ? null : knd; msg = editPick ? 'Выберите показатель в каталоге' : ''; redraw(); }
                    return;
                }
            }
            const d = delRect();
            if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) { deleteSelected(); return; }
        }
        // catalog grid
        const cols = 2;
        const list = menuState === 'select' ? selectFlat : addFlat;
        const pages = Math.max(1, Math.ceil(list.length / catalogPageSize()));
        for (const direction of ['prev', 'next']) { const r = pageControl(direction); if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && (direction === 'prev' ? menuPage > 0 : menuPage < pages - 1)) { menuPage += direction === 'prev' ? -1 : 1; redraw(); return; } }
        for (let i = 0; i < catalogPageSize(); i++) {
            const idx = menuPage * catalogPageSize() + i; if (idx >= list.length) break;
            const item = list[idx];
            const rect = catalogCard(i);
            if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) { onCatalogTap(item); return; }
        }
    }

    // ---- Draw ----
    function draw(cv, options) {
        const interactive = !options || options.interactive !== false;
        const readOnly = !!(options && options.readOnly === true);
        readOnlyDraw = readOnly;
        computeLayout();
        const catTop = catTopOf();
        const cols = 2;
        const list = menuState === 'select' ? selectFlat : addFlat;
        const pages = Math.max(1, Math.ceil(list.length / catalogPageSize()));

        // grid cells: only while editing (a guide). In view mode the widgets stand on the dark
        // background with no empty-cell frames, so a sparse composition still looks finished.
        for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
            if (!edit) continue;
            const sel = selected < 0 && cell.x === i && cell.y === j;
            cv.roundRect(gridX(i), gridY(j), cw, ch, 8, sel ? color.selected : color.row);
            cv.strokeRoundRect(gridX(i) + 1, gridY(j) + 1, cw - 2, ch - 2, 8, sel ? 2.5 : 1.5, sel ? color.accent : color.line);
        }
        if (!readOnly && edit && selected < 0) {
            const b = box({ x: cell.x, y: cell.y, w: 1, h: 1 });
            cv.strokeRoundRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3, 8, 2, color.accent);
        }
        if (!readOnly && data.widgets.length === 0 && !showMenu) {
            const profile = currentProfile();
            const label = profile === 'unknown' ? 'Автоподбор · профиль неизвестен' : 'Автоподбор · предположительно ' + (profile === 'diesel' ? 'дизель' : 'бензин');
            cv.roundRect(REC.x, REC.y, REC.w, REC.h, 9, color.selected);
            cv.strokeRoundRect(REC.x + 0.5, REC.y + 0.5, REC.w - 1, REC.h - 1, 9, 1, color.accent);
            fit(cv, label, REC.x + 18, REC.y + 34, 16, REC.w - 36, { color: color.white, font: 'bold' });
            fit(cv, 'Нажмите и отпустите, чтобы принять рекомендацию', REC.x + 18, REC.y + 60, 13, REC.w - 36, { color: color.muted });
        }

        // widgets
        const renderedWidgets = data.widgets.slice();
        if (resizePreview && renderedWidgets[resizeOrig.index]) renderedWidgets[resizeOrig.index] = { ...renderedWidgets[resizeOrig.index], ...resizePreview };
        renderedWidgets.forEach((w, idx) => {
            const b = box(w); const isSelected = !readOnly && idx === selected;
            cv.roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 10, isSelected ? color.selected : color.row);
            if (isSelected) cv.strokeRoundRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5, 10, 2, color.accent);
            if (w.pages && w.pages.length > 0) drawSemantic(cv, b, w);
            if (w.pages && w.pages.length > 1) drawSwipeDots(cv, w);
            if (edit && isSelected) drawHandles(cv, b);
        });
        if (!readOnly && dragTarget && selected >= 0 && data.widgets[selected]) {
            const w = data.widgets[selected], targetBox = box({ x: dragTarget.x, y: dragTarget.y, w: w.w, h: w.h });
            cv.strokeRoundRect(targetBox.x + 1.5, targetBox.y + 1.5, targetBox.w - 3, targetBox.h - 3, 8, 3, dragTarget.valid ? color.accent : color.crit);
        }

        // delete button (top-right of selected widget)
        if (!readOnly && edit && selected >= 0) {
            const b = box(data.widgets[selected]);
            const bx = b.x + b.w - 30, by = b.y + 6, bs = 26;
            cv.roundRect(bx, by, bs, bs, 6, '#d32f2f');
            cv.line(bx + 9, by + 9, bx + bs - 9, by + bs - 9, 2.5, color.white);
            cv.line(bx + bs - 9, by + 9, bx + 9, by + bs - 9, 2.5, color.white);
            if (cv.own && interactive) cv.target(bx, by, bs, bs, deleteSelected, 'del_btn', 3);
        }

        if (!readOnly && edit && !showMenu) {
            const pb = presetButtonRect();
            cv.strokeRoundRect(pb.x + 0.5, pb.y + 0.5, pb.w - 1, pb.h - 1, 8, 1.5, color.line);
            // A small stack glyph: three offset rectangles read as "saved layouts".
            const gx = pb.x + 15, gy = pb.y + pb.h / 2;
            for (let k = 0; k < 3; k++) cv.strokeRoundRect(gx + k * 2.5, gy - 7 + k * 2.5, 11, 8, 2, 1.2, color.muted);
            fit(cv, 'Пресеты' + (presets.length ? ' · ' + presets.length : ''), pb.x + 40, vmid(pb.y, pb.h, 13), 13, pb.w - 52, { font: 'bold', color: color.white });
            if (cv.own && interactive) cv.target(pb.x, pb.y, pb.w, pb.h, openPresets, 'presets_open', 3);
        }
        // menu
        if (!readOnly && showMenu) {
            const editMenu = isEditMenu();
            // Panel: one surface, one border. The header is a flat band with a hairline, not a
            // second rounded block, so the panel reads as a single sheet.
            cv.roundRect(MX, MY, MW, MH, 14, color.bg);
            cv.strokeRoundRect(MX + 0.5, MY + 0.5, MW - 1, MH - 1, 14, 1.5, color.line);
            cv.fillRect(MX, MY + MNP.head - 1, MW, 1, color.line);

            // Title block: title on the left, subtitle directly under it — a two-line block
            // instead of a centred title with a floating subtitle below the header.
            const title = editMenu ? 'Управление виджетом' : 'Добавить показатель';
            const cbx = MX + MW - 44, cby = MY + 10, cbs = 32;
            cv.text(title, MX + MNP.pad, MY + 30, 19, color.white, { font: 'bold' });
            const sub = editMenu
                ? (editPick ? (editPick === 'page' ? 'Новый лист · выберите показатель' : 'На текущий лист · выберите показатель') : 'Сначала действие, затем показатель')
                : 'Выберите показатель для свободной ячейки';
            cv.text(sub, MX + MNP.pad, MY + 52, 13, editPick ? color.accent : color.muted);

            // Close: quiet outline, not a filled block competing with the title.
            cv.strokeRoundRect(cbx, cby, cbs, cbs, 8, 1.5, color.line);
            cv.line(cbx + 11, cby + 11, cbx + cbs - 11, cby + cbs - 11, 2, color.muted);
            cv.line(cbx + cbs - 11, cby + 11, cbx + 11, cby + cbs - 11, 2, color.muted);
            if (cv.own && interactive) cv.target(cbx, cby, cbs, cbs, function () { clearMenu(); }, 'menu_close', 3);

            if (editMenu) {
                const w = data.widgets[selected];
                // Section label sits above the chip row, on its own line: it names the row
                // without competing with the chips for horizontal space.
                cv.text('ЛИСТЫ', MX + MNP.pad, MY + MNP.head + 14, 10, color.muted, { font: 'bold', spacing: 1 });
                w.pages.forEach((pg, i) => {
                    const r = chipRect(i), isSel = i === (w.active || 0);
                    if (isSel) {
                        cv.roundRect(r.x, r.y, r.w, r.h, 6, color.accent);
                    } else {
                        cv.strokeRoundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 6, 1.5, color.line);
                    }
                    cv.text(String(i + 1), r.x + r.w / 2, vmid(r.y, r.h, 15), 15,
                        isSel ? color.bg : color.white, { align: 'center', font: 'bold' });
                    if (cv.own && interactive) cv.target(r.x, r.y, r.w, r.h, (function (ii) {
                        return function () { const current = data.widgets[selected]; if (current && ii !== current.active) action('next', { delta: ii - current.active }); };
                    })(i), 'pchip_' + i, 2);
                });
                // Page count as a quiet trailing note, right-aligned on the chip row.
                const count = w.pages.length + ' из 4';
                cv.text(count, MX + MW - MNP.pad, MY + MNP.head + 47, 12, color.muted, { align: 'right' });

                // Actions: outlined rows. Only the pending pick is filled, so the current mode
                // is visible without reading the subtitle.
                const ctl = [['Страница', 'page'], ['Вместе', 'together'], ['Порядок', 'order'], ['- Пункт', 'removeItem']];
                ctl.forEach((bnd, k) => {
                    const r = ctlRect(k);
                    const on = editPick === bnd[1];
                    if (on) cv.roundRect(r.x, r.y, r.w, r.h, 7, color.accent);
                    else { cv.roundRect(r.x, r.y, r.w, r.h, 7, color.row); cv.strokeRoundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 7, 1.5, color.line); }
                    const ic = on ? color.bg : color.white;
                    const ix = r.x + 17, iy = r.y + r.h / 2;
                    if (bnd[1] === 'page') {
                        cv.strokeRoundRect(ix - 6, iy - 7, 12, 14, 2, 1.5, ic);
                        cv.line(ix, iy - 1, ix, iy + 5, 1.5, ic); cv.line(ix - 3, iy + 2, ix + 3, iy + 2, 1.5, ic);
                    } else if (bnd[1] === 'together') {
                        cv.strokeRoundRect(ix - 7, iy - 6, 9, 11, 2, 1.5, ic);
                        cv.strokeRoundRect(ix - 2, iy - 3, 9, 11, 2, 1.5, ic);
                    } else if (bnd[1] === 'order') {
                        cv.line(ix - 6, iy - 4, ix + 6, iy - 4, 1.5, ic); cv.line(ix - 6, iy + 4, ix + 6, iy + 4, 1.5, ic);
                        cv.line(ix - 3, iy - 7, ix - 3, iy - 1, 1.5, ic); cv.line(ix + 3, iy + 1, ix + 3, iy + 7, 1.5, ic);
                    } else {
                        cv.line(ix - 6, iy, ix + 6, iy, 2, ic);
                    }
                    fit(cv, bnd[0], ix + 16, vmid(r.y, r.h, 13), 13, r.w - 44, { font: 'bold', color: on ? color.bg : color.white });
                    if (cv.own && interactive) cv.target(r.x, r.y, r.w, r.h, (function (knd) {
                        return function () {
                            if (knd === 'order') { editPick = null; action(knd); }
                            else if (knd === 'removeItem') removeSelectedItem();
                            else { editPick = editPick === knd ? null : knd; msg = editPick ? 'Выберите показатель в каталоге' : ''; redraw(); }
                        };
                    })(bnd[1]), 'ctl_' + bnd[1], 2);
                });

                // Destructive action: quiet outline with a red label and icon. A full-width
                // saturated red bar outweighed every real action in the panel.
                const d = delRect();
                cv.strokeRoundRect(d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1, 7, 1.5, withAlpha('#d65051', 0.55));
                cv.line(d.x + 14, d.y + d.h / 2, d.x + 26, d.y + d.h / 2, 2, '#d65051');
                fit(cv, 'Удалить виджет', d.x + 36, vmid(d.y, d.h, 13), 13, d.w - 60, { font: 'bold', color: '#d65051' });
                if (cv.own && interactive) cv.target(d.x, d.y, d.w, d.h, deleteSelected, 'menu_del', 3);
            }

            // Catalogue: cards are ONE line — name left, unit right, on a single baseline. No
            // category colour rule and no per-card category stamp: six colours had no legend and
            // repeating one word twelve times is noise. The names describe themselves.
            const catLabel = editMenu ? (editPick ? 'ВЫБЕРИТЕ ПОКАЗАТЕЛЬ' : 'ПОКАЗАТЕЛИ') : 'КАТАЛОГ';
            cv.text(catLabel, MX + MNP.pad, catTopOf() - 10, 10, editPick ? color.accent : color.muted, { font: 'bold', spacing: 1 });
            for (let i = 0; i < catalogPageSize(); i++) {
                const idx = menuPage * catalogPageSize() + i; if (idx >= list.length) break;
                const item = list[idx];
                const card = catalogCard(i);
                const base = vmid(card.y, card.h, 15);
                cv.roundRect(card.x, card.y, card.w, card.h, 8, color.row);
                cv.strokeRoundRect(card.x + 0.5, card.y + 0.5, card.w - 1, card.h - 1, 8, 1.5, color.line);
                const tx = card.x + 13;
                const unitW = item.unit ? cv.textWidth(item.unit, 12) + 12 : 0;
                fit(cv, item.name, tx, base, 15, card.w - (tx - card.x) - unitW - 10, { font: 'bold' });
                if (item.unit) cv.text(item.unit, card.x + card.w - 11, base, 12, color.muted, { align: 'right' });
                if (cv.own && interactive) cv.target(card.x, card.y, card.w, card.h, (function (it) { return function () { onCatalogTap(it); }; })(item), 'cat_' + menuState + '_' + idx, 2);
            }

            // Pager: chevrons only, page counter centred. Labels "Назад/Далее" repeated what the
            // arrows already say and cost 60px of the row.
            const prev = pageControl('prev'), next = pageControl('next');
            const pmy = prev.y + prev.h / 2, nmy = next.y + next.h / 2;
            const hasPrev = menuPage > 0, hasNext = menuPage < pages - 1;
            if (hasPrev) { cv.roundRect(prev.x, prev.y, prev.w, prev.h, 8, color.row); cv.strokeRoundRect(prev.x + 0.5, prev.y + 0.5, prev.w - 1, prev.h - 1, 8, 1.5, color.line); }
            const pc = hasPrev ? color.white : withAlpha(color.muted, 0.4);
            cv.line(prev.x + 24, pmy - 6, prev.x + 18, pmy, 2.5, pc); cv.line(prev.x + 18, pmy, prev.x + 24, pmy + 6, 2.5, pc);
            cv.text('Назад', prev.x + 34, vmid(prev.y, prev.h, 13), 13, pc, { font: 'bold' });
            if (cv.own && interactive && hasPrev) cv.target(prev.x, prev.y, prev.w, prev.h, function () { menuPage = Math.max(0, menuPage - 1); redraw(); }, 'pg_up', 3);
            cv.text((menuPage + 1) + ' / ' + pages, MX + MW / 2, vmid(prev.y, prev.h, 13), 13, color.muted, { align: 'center', font: 'bold' });
            if (hasNext) { cv.roundRect(next.x, next.y, next.w, next.h, 8, color.row); cv.strokeRoundRect(next.x + 0.5, next.y + 0.5, next.w - 1, next.h - 1, 8, 1.5, color.line); }
            const nc = hasNext ? color.white : withAlpha(color.muted, 0.4);
            cv.text('Далее', next.x + next.w - 34, vmid(next.y, next.h, 13), 13, nc, { font: 'bold', align: 'right' });
            cv.line(next.x + next.w - 24, nmy - 6, next.x + next.w - 18, nmy, 2.5, nc); cv.line(next.x + next.w - 18, nmy, next.x + next.w - 24, nmy + 6, 2.5, nc);
            if (cv.own && interactive && hasNext) cv.target(next.x, next.y, next.w, next.h, function () { menuPage = Math.min(pages - 1, menuPage + 1); redraw(); }, 'pg_dn', 3);
        }

        // ---- Preset sheet ----
        // Full-height sheet over the grid: a dimming scrim, a titled list, one primary action.
        // Rows carry what the layout actually contains, so the driver recognises a preset by its
        // content instead of guessing from a name.
        if (!readOnly && showPresets) {
            cv.fillRect(0, 0, 1600, 520, withAlpha('#04070c', 0.72));
            const s = presetSheet();
            cv.roundRect(s.x, s.y, s.w, s.h, 14, color.bg);
            cv.strokeRoundRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1, 14, 1.5, color.line);
            cv.fillRect(s.x, s.y + 64, s.w, 1, color.line);

            cv.text('Пресеты', s.x + PSH.pad, s.y + 34, 19, color.white, { font: 'bold' });
            cv.text(presets.length ? presets.length + ' из ' + P.MAX : 'Ни одного сохранённого', s.x + PSH.pad, s.y + 54, 12, color.muted);

            const cl = presetCloseRect();
            cv.line(cl.x + 11, cl.y + 11, cl.x + cl.w - 11, cl.y + cl.h - 11, 2, color.muted);
            cv.line(cl.x + cl.w - 11, cl.y + 11, cl.x + 11, cl.y + cl.h - 11, 2, color.muted);
            if (cv.own && interactive) cv.target(cl.x, cl.y, cl.w, cl.h, closePresets, 'presets_close', 3);

            // Primary action: filled, because saving is the reason to open this sheet.
            const sv = presetSaveRect();
            const full = presets.length >= P.MAX;
            cv.roundRect(sv.x, sv.y, sv.w, sv.h, 9, full ? color.row : color.accent);
            cv.line(sv.x + 20, sv.y + sv.h / 2, sv.x + 32, sv.y + sv.h / 2, 2, full ? color.muted : color.bg);
            cv.line(sv.x + 26, sv.y + sv.h / 2 - 6, sv.x + 26, sv.y + sv.h / 2 + 6, 2, full ? color.muted : color.bg);
            fit(cv, full ? 'Лимит ' + P.MAX + ' пресетов' : 'Сохранить текущую композицию', sv.x + 44, vmid(sv.y, sv.h, 14), 14, sv.w - 56,
                { font: 'bold', color: full ? color.muted : color.bg });
            if (cv.own && interactive && !full) cv.target(sv.x, sv.y, sv.w, sv.h, savePreset, 'preset_save', 3);

            const activeIdx = activePresetIndex();
            if (!presets.length) {
                const ey = presetRowRect(0).y + 18;
                fit(cv, 'Соберите панель и нажмите «Сохранить» —', s.x + PSH.pad, ey, 13, s.w - PSH.pad * 2, { color: color.muted });
                fit(cv, 'раскладка вернётся одним нажатием.', s.x + PSH.pad, ey + 20, 13, s.w - PSH.pad * 2, { color: color.muted });
            }
            presets.forEach((p, i) => {
                const r = presetRowRect(i);
                const isActive = i === activeIdx;
                const pendingDel = presetConfirmDelete === p.id;
                cv.roundRect(r.x, r.y, r.w, r.h, 9, isActive ? color.selected : color.row);
                cv.strokeRoundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 9, isActive ? 2 : 1, isActive ? color.accent : color.line);
                // Name + the indicators it holds: recognition beats recall.
                fit(cv, p.name, r.x + 14, r.y + 26, 15, r.w - 74, { font: 'bold', color: color.white });
                const labels = P.labelsOf(p.composition);
                const summary = labels.slice(2, 6).join(' · ') || (labels.length ? labels.join(' · ') : 'пусто');
                fit(cv, summary, r.x + 14, r.y + 48, 12, r.w - 74, { color: color.muted });
                if (isActive) cv.text('АКТИВЕН', r.x + 14, r.y + r.h - 8, 9, color.accent, { font: 'bold' });
                else cv.text(labels.length + ' видж.', r.x + 14, r.y + r.h - 8, 9, color.muted, { font: 'bold' });
                // Delete: quiet cross that turns red and asks again on the first tap.
                const d = presetDelRect(i);
                if (pendingDel) {
                    cv.roundRect(d.x, d.y, d.w, d.h, 7, color.crit);
                    cv.line(d.x + 11, d.y + 16, d.x + d.w - 11, d.y + 16, 2, color.white);
                    fit(cv, 'удалить?', d.x - 4, d.y + 12, 10, 62, { align: 'right', font: 'bold', color: color.crit });
                } else {
                    cv.line(d.x + 11, d.y + 11, d.x + d.w - 11, d.y + d.h - 11, 1.6, color.muted);
                    cv.line(d.x + d.w - 11, d.y + 11, d.x + 11, d.y + d.h - 11, 1.6, color.muted);
                }
                if (cv.own && interactive) {
                    cv.target(r.x, r.y, r.w, r.h, (function (ii) { return function () { applyPreset(ii); }; })(i), 'preset_apply_' + i, 2);
                    cv.target(d.x, d.y, d.w, d.h, (function (ii) { return function () { deletePreset(ii); }; })(i), 'preset_del_' + i, 3);
                }
            });
        }

        // Single status line at the very bottom (rejections in red). No persistent toolbar/help clutter.
        if (!readOnly && msg) {
            const isRejection = msg.indexOf('Не помещается') === 0 || msg.indexOf('Перемещение отклонено') === 0 || msg.indexOf('Шинам нужна область') === 0;
            const fy = 514;
            if (isRejection) {
                const w = Math.min(900, String(msg).length * 8 + 28);
                cv.roundRect(LEFT, fy - 16, w, 22, 6, '#d65051');
                fit(cv, msg, LEFT + 12, fy, 12, w - 24, { color: color.white, font: 'bold' });
            } else {
                fit(cv, msg, LEFT, fy, 12, 900, { color: color.muted });
            }
        }
    }
    return { draw: draw };
};
// The danger bands are part of the app's data contract, not a drawing detail: the centre screen
// uses the same ones, so a value that flashes red in one place never looks calm in the other.
module.exports.dangerOf = dangerOf;
module.exports.blinkOn = blinkOn;
module.exports.DANGER = DANGER;
