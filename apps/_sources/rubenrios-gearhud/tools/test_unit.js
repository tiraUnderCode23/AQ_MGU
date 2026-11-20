'use strict';
// Pruebas sin coche ni servicio: la marcha, los colores, el texto y la colocación. Node 8 (como el coche).
//   node tools/test_unit.js <carpeta del kit/runtime>      (para el lienzo de las letras)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = path.join(__dirname, '..', 'apps', 'rubenrios_gearhud');
const { GearState, Guess, conditionOf } = require(path.join(A, 'gear_state'));
const C = require(path.join(A, 'colors'));
const { hudText, readPositionFile, rolesFor, roleOf } = require(path.join(A, 'rules'));
const kit = process.argv[2] || path.join(__dirname, '..', 'kit', 'runtime');
const ok = (m) => console.log('ok  ' + m);

/* ---------- la marcha ---------- */
let s = new GearState(), t = 1000;
assert.deepStrictEqual([s.view(t).letter, s.view(t).reason], [null, 'estimando: hace falta circular']);
s.vehicleCondition({ statusConditionVehicle: 'FAHREN' });
s.gearbox({ statusActualGearDrive: 'N_OR_P', statusActualStageDrive: 'P' }, t);
assert.strictEqual(s.view(t).letter, 'P');
s.gearbox({ statusActualGearDrive: 'N_OR_P', statusActualStageDrive: 'D' }, t);
assert.deepStrictEqual([s.view(t).letter, s.view(t).digit], ['D', null]);
s.gearbox({ statusActualGearDrive: 'G3', statusActualStageDrive: 'D' }, t);
assert.deepStrictEqual([s.view(t).letter, s.view(t).digit, s.view(t).source], ['D', 3, 'gearbox']);
s.gearbox({ statusActualGearDrive: 'N_OR_P' }, t + 100);
assert.strictEqual(s.view(t + 300).digit, 3, 'durante el cambio se conserva');
assert.strictEqual(s.view(t + 900).digit, null, 'parado en D: solo la letra');
s.gearbox({ statusActualGearDrive: 6 }, t + 1000);       // número de cable: G4
s.programme({ displayProgramGearbox: 'S_MINUS_PROGRAMM' });
assert.deepStrictEqual([s.view(t + 1000).letter, s.view(t + 1000).digit], ['S', 4]);
s.programme({ displayProgramGearbox: 'M_MINUS_PROGRAMM' });
assert.strictEqual(s.view(t + 1000).letter, 'M');
s.gearbox({ statusActualGearDrive: 'R', statusActualStageDrive: 'R' }, t + 1100);
assert.deepStrictEqual([s.view(t + 1100).letter, s.view(t + 1100).digit], ['R', null]);
ok('letra y marcha del cambio, P / R / D / S / M, hueco durante el cambio');

// estado del coche: solo listo (10) o sin decirlo; nunca al encender (8) ni al apagar (12, <= 5) ni con un valor raro
s = new GearState();
s.gearbox({ statusActualGearDrive: 'G2', statusActualStageDrive: 'D' }, t);
assert.ok(s.view(t).ready, 'sin estado del coche no se retiene');
for (const [c, ready] of [['FAHREN', true], [10, true], ['FAHRBEREITSCHAFT_HERSTELLEN', false], [8, false], [12, false], ['WOHNEN', false], [15, false], ['RARO', false]]) {
    s.vehicleCondition({ statusConditionVehicle: c });
    assert.strictEqual(s.view(t).ready, ready, 'estado ' + c);
    if (!ready) assert.strictEqual(s.view(t).letter, null, 'sin letra con el estado ' + c);
}
assert.strictEqual(conditionOf(15), null);
ok('solo con el coche listo: nada al encender, al apagar ni con un estado desconocido');

// DataPowerTrain2 solo (otros coches)
s = new GearState();
s.selection({ statusGearSelectionDrive: '_5' }, t);
assert.deepStrictEqual([s.view(t).letter, s.view(t).digit, s.view(t).source], ['D', 5, 'selection']);
s.selection({ statusGearSelectionDrive: 'P' }, t);
assert.strictEqual(s.view(t).letter, 'P');
ok('la marcha desde DataPowerTrain2 cuando el cambio no la da');

// sin VehicleInformation: estimación con rpm / velocidad, solo con el motor tirando
const g = new Guess();
const ratios = [140, 85, 58, 44, 35, 29];        // rpm por km/h, de 1.ª a 6.ª
for (let n = 0; n < 40; n++) ratios.forEach((k) => g.feed(k * 40, 40));
assert.strictEqual(g.feed(58 * 40, 40), 3);
assert.strictEqual(g.feed(29 * 80, 80), 6);
assert.strictEqual(g.feed(900, 40), null, 'a menos de 1100 rpm no se estima');
assert.strictEqual(g.feed(3000, 5), null, 'casi parado no se estima');
s = new GearState();
for (let n = 0; n < 40; n++) ratios.forEach((k) => s.motion(k * 40, 40, t));
s.motion(44 * 50, 50, t);
assert.deepStrictEqual([s.view(t).letter, s.view(t).digit, s.view(t).guessed], ['D', 4, true]);
assert.strictEqual(s.view(t, { guess: false }).letter, null, 'sin el ajuste no se estima');
s.motion(0, 0, t + 2000);
assert.strictEqual(s.view(t + 2000).letter, null, 'sin estimación no se inventa la D');
s.gearbox({ statusActualGearDrive: 'G2', statusActualStageDrive: 'D' }, t + 3000);
assert.deepStrictEqual([s.view(t + 3000).digit, s.view(t + 3000).source], [2, 'gearbox']);
ok('estimación por rpm / velocidad cuando el coche no envía la marcha, y el cambio manda en cuanto llega');

/* ---------- colores ---------- */
assert.strictEqual(C.hsvToHex(0, 100, 100), '#ff0000');
assert.strictEqual(C.hsvToHex(120, 100, 50), '#008000');
assert.strictEqual(C.hsvToHex(210, 0, 70), '#b3b3b3');
assert.strictEqual(C.hsvToHex(-150, 100, 100), C.hsvToHex(210, 100, 100), 'el tono da la vuelta');
assert.deepStrictEqual(C.rgbOf('#aeb2b8'), [174, 178, 184]);
assert.deepStrictEqual(C.rgbOf('basura'), [255, 255, 255]);
const sets = { customHue: 210, customSat: 10, customBright: 70 };
assert.strictEqual(C.colourOf('softgrey', (k) => sets[k]), '#aeb2b8');
assert.strictEqual(C.colourOf('custom', (k) => sets[k]), C.hsvToHex(210, 10, 70));
assert.strictEqual(C.colourOf('inventado', (k) => sets[k]), '#ffffff');
assert.ok(C.luminance('#aeb2b8') > 0.65 && C.luminance('#aeb2b8') < 0.75, 'gris suave: un 70 % de brillo');
assert.strictEqual(C.opacityOf(true, 40), 0.4);
assert.strictEqual(C.opacityOf(false, 40), 1);
assert.strictEqual(C.opacityOf(null, 40), 1, 'sin saber si es de noche, brillo entero');
assert.strictEqual(C.opacityOf(true, 100), 1);
ok('colores: muestras, personalizado por tono / saturación / brillo, brillo de noche');

/* ---------- el texto ---------- */
const view = (letter, digit) => ({ ready: true, letter, digit });
const set = (o) => (k) => o[k];
assert.strictEqual(hudText(view('D', 3), set({ hudStyle: 'full' })), 'D3');
assert.strictEqual(hudText(view('S', 4), set({ hudStyle: 'full' })), 'S4');
assert.strictEqual(hudText(view('D', 3), set({ hudStyle: 'digit' })), '3');
assert.strictEqual(hudText(view('D', null), set({ hudStyle: 'full' })), 'D');
assert.strictEqual(hudText(view('D', null), set({ hudStyle: 'digit' })), '');
assert.strictEqual(hudText(view('P', null), set({ hudPRN: 'letter' })), 'P');
assert.strictEqual(hudText(view('R', null), set({ hudPRN: 'hide' })), '');
assert.strictEqual(hudText(view('D', 10), set({ hudStyle: 'full' })), 'D', 'sin capa para 10: solo la letra');
assert.strictEqual(hudText(view(null, null), set({})), '');
ok('qué se escribe: D3, 3, P, nada');

// colores de S y M: qué capas lleva cada color y de qué color es cada carácter
const conf = (o) => (k) => Object.assign({ hudColour: 'softgrey', clusterColour: 'white', sColour: 'mred', mColour: 'orange', modeColours: 'all' }, o)[k];
let roles = rolesFor('hud', conf({}), C.colourOf);
assert.deepStrictEqual(Object.keys(roles), ['base', 'S', 'M']);
assert.deepStrictEqual([roles.base.colour, roles.S.colour, roles.M.colour], ['#aeb2b8', '#e4282e', '#ff7a1a'], 'D gris suave, S roja, M naranja');
assert.deepStrictEqual(roles.base.chars.join(''), 'PRND123456789');
assert.deepStrictEqual(roles.S.chars.join(''), 'S123456789', 'S3 entero: la S y sus números');
roles = rolesFor('hud', conf({ modeColours: 'letter' }), C.colourOf);
assert.deepStrictEqual([roles.S.chars.join(''), roles.M.chars.join('')], ['S', 'M'], 'solo la letra: sin números de más');
roles = rolesFor('hud', conf({ modeColours: 'off' }), C.colourOf);
assert.deepStrictEqual([Object.keys(roles), roles.base.chars.join('')], [['base'], 'PRNDSM123456789']);
assert.deepStrictEqual(Object.keys(rolesFor('nextToD', conf({}), C.colourOf)), ['base'], 'junto a la D, un color');
assert.strictEqual(rolesFor('centre', conf({}), C.colourOf).base.colour, '#ffffff', 'el centro del cuadro usa el color del cuadro');
assert.deepStrictEqual(['S', '3'].map((ch) => roleOf('S', ch, 'all')), ['S', 'S']);
assert.deepStrictEqual(['S', '3'].map((ch) => roleOf('S', ch, 'letter')), ['S', 'base']);
assert.deepStrictEqual(['M', '2'].map((ch) => roleOf('M', ch, 'all')), ['M', 'M']);
assert.deepStrictEqual(['D', '3'].map((ch) => roleOf('D', ch, 'all')), ['base', 'base']);
assert.deepStrictEqual(['S', '3'].map((ch) => roleOf('S', ch, 'off')), ['base', 'base']);
ok('S en rojo y M en naranja: entero, solo la letra o todo igual');

// posicion.json: solo lo que vale
const base = { panel: { big: { x: 1518, y: 337, scale: 1 }, small: { x: 1414, y: 652, scale: 0.444 } }, hud: { top: [400, 175], right: [595, 235] } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marcha-'));
const file = path.join(dir, 'posicion.json'), log = { warn() {} };
assert.strictEqual(readPositionFile(file, base, log), null);
fs.writeFileSync(file, JSON.stringify({ panel: { big: { x: 1500, y: 340 }, small: { x: -1, y: 5 } }, hud: { right: [610, 250], top: [9999, 1] } }));
const r = readPositionFile(file, base, log);
assert.deepStrictEqual(r.panel.big, { x: 1500, y: 340, scale: 1 });
assert.deepStrictEqual(r.panel.small, base.panel.small, 'fuera de rango: se queda el de fábrica');
assert.deepStrictEqual(r.hud.right, [610, 250]);
assert.deepStrictEqual(r.hud.top, [400, 175]);
fs.writeFileSync(file, '{ esto no es json');
assert.strictEqual(readPositionFile(file, base, log), null);
ok('posicion.json: valores fuera de rango o roto, ignorados');

/* ---------- letras y colocación ---------- */
const { Canvas } = require(path.join(kit, 'canvas'));
const { glyph, layout, GlyphSet } = require(path.join(A, 'glyphs'));
const hg = { size: 150, cellH: 160, baseline: 136, font: 'gear' };
const d = glyph(Canvas, 'D', '#aeb2b8', hg), three = glyph(Canvas, '3', '#aeb2b8', hg);
assert.strictEqual(d.h, 160);
assert.ok(d.w > three.w, 'la D es más ancha que el 3');
let lit = 0, maxRGB = 0;
for (let i = 0; i < d.px.length; i += 4) if (d.px[i + 3] > 0) { lit++; maxRGB = Math.max(maxRGB, d.px[i], d.px[i + 1], d.px[i + 2]); }
assert.ok(lit > 1500, 'la D tiene píxeles');
assert.ok(maxRGB <= 184, 'el color no se pasa del elegido (alfa directo, sin aclarar)');
const sh = glyph(Canvas, '3', '#ffffff', Object.assign({ shadow: { dx: 3, dy: 3, blur: 3, alpha: 0.75 } }, hg));
let dark = 0;
for (let i = 0; i < sh.px.length; i += 4) if (sh.px[i + 3] > 100 && sh.px[i] < 40) dark++;
assert.ok(dark > 200, 'con sombra hay borde negro');
// un servicio de mentira que solo apunta: show() envía solo lo que cambia
const sent = [];
const cr = { image: () => sent.length + 1, pixels: (ref) => sent.push(['px', ref]), set: (ref, o) => sent.push(['set', ref, o]), drop: (ref) => sent.push(['drop', ref]) };
const gs = new GlyphSet(cr, Canvas, 'hud', ['D', 'S', '3', '4'], hg, '#ffffff', {});
const uploads = sent.length;
assert.strictEqual(uploads, 4, 'una subida por carácter');
let items = layout(gs, 'D3', 400, 240, 0.64, 6);
assert.strictEqual(items.length, 2);
assert.ok(items[0].x < items[1].x && Math.abs(items[0].y - items[1].y) < 1e-9, 'D a la izquierda del 3, a la misma altura');
const mid = (items[0].x + gs.cell('D').pad * 0.64 + items[1].x + (gs.cell('3').pad + gs.cell('3').adv) * 0.64) / 2;
assert.ok(Math.abs(mid - 400) < 2, 'centrado en el ancla');
gs.show(items);
const n1 = sent.length;
gs.show(items);
assert.strictEqual(sent.length, n1, 'lo mismo otra vez: no se envía nada');
gs.show(layout(gs, 'D4', 400, 240, 0.64, 6));
assert.deepStrictEqual(sent.slice(n1).map((x) => [x[0], x[1], x[2].visible]), [['set', 4, true], ['set', 3, false]], 'cambio de marcha: el 4 aparece y el 3 se oculta, sin píxeles');
const n2 = sent.length;
gs.opacity(0.5);
assert.ok(sent.slice(n2).every((x) => x[0] === 'set' && x[2].opacity === 0.5), 'brillo de noche: solo opacidad');
const n3 = sent.length;
gs.colour('#aeb2b8');
assert.strictEqual(sent.slice(n3).filter((x) => x[0] === 'px').length, 4, 'nuevo color: se vuelven a subir los 4');
gs.colour('#aeb2b8');
assert.strictEqual(sent.length, n3 + 4, 'el mismo color: nada');
ok('letras: alfa directo, sombra en el cuadro, colocación centrada, solo se envía lo que cambia');

console.log('PASS test_unit');
