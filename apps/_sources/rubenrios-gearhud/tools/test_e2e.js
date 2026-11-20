'use strict';
// La app de verdad (dist/<id>) + la cabeza simulada del kit (hu-stub) + un cluster-render de mentira en su ruta real.
//   node tools/test_e2e.js <dist/rubenrios_gearhud> <kit/tools> <salida para las imágenes>
// Necesita /dev/shm escribible y vacío (en el sandbox: mount -t tmpfs tmpfs /dev/shm).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FakeCluster = require('./fake_cluster.js');
const [stage, tools, out] = process.argv.slice(2);
const claims = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-claims-'));
process.env.MGU_HUD_CLAIMS = claims;
const { headUnit } = require(path.join(tools, 'hu-stub.js'));
const { Canvas } = require(path.join(stage, 'source/javascript/kit/canvas'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VI = 'de.bmw.infrastructure.VehicleInformation', VC = 'de.bmw.infrastructure.VehicleCondition', V2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const VEH = 'de.bmw.infotainment.vehicle.Vehicle', MD = 'de.bmw.infotainment.misc.MDrive';
const ok = (m) => console.log('ok  ' + m);

/** Color más brillante de una capa (lo que más se ve) como [r, g, b]. */
function brightest(l) {
    let best = [0, 0, 0], sum = -1;
    for (let i = 0; i < l.px.length; i += 4) if (l.px[i + 3] > 250 && l.px[i] + l.px[i + 1] + l.px[i + 2] > sum) { best = [l.px[i], l.px[i + 1], l.px[i + 2]]; sum = best[0] + best[1] + best[2]; }
    return best;
}

(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marcha-data-'));
    fs.mkdirSync('/dev/shm/cluster-render');
    const fc = new FakeCluster('/dev/shm/cluster-render/render.sock');
    await fc.listen();
    let frame = null;
    const warnings = [];
    const log = { info() {}, debug() {}, warn: (m) => warnings.push(String(m)), error: (w, e) => warnings.push(w + ' ' + e) };
    const hu = headUnit(stage, { live: true, closed: true, dataDir, log, sets: { demo: 'off' }, image: (n, cv) => { frame = cv; } });
    hu.start();
    await sleep(300);
    const box = (g, st) => hu.feed(VI, 'statusGearboxDrive', { statusActualGearDrive: g, statusActualStageDrive: st });
    const cond = (c) => hu.feed(VC, 'VehicleCondition', { statusConditionVehicle: c });
    const speed = (k) => hu.feed(V2, 'statusCarSpeed2', { speedVehicleCentreOfGravity: Math.round(k / 0.015625) });
    const press = (b) => hu.ui.rhmi.getByName(b).emit('action');
    const shownOn = (target) => fc.visible(target).map((l) => l.iw + 'x' + l.ih).sort();
    const hudChars = () => fc.visible('hud').length;
    const tick = () => sleep(250);

    cond('FAHREN'); speed(30); box('G3', 'D');
    await sleep(400);
    assert.strictEqual(fc.ops.length, 0, 'de fábrica no se toca cluster-render');
    ok('de fábrica (en ningún sitio) no conecta con cluster-render aunque haya marcha');

    await sleep(5000);
    const rec = fs.readFileSync(path.join(dataDir, 'senales.log'), 'utf8');
    assert.ok(/statusGearboxDrive\t\{"statusActualGearDrive":"G3"/.test(rec), rec);
    ok('registra las señales en data/senales.log');

    // HUD
    hu.settings.set('show', 'hud');
    await sleep(800);
    assert.strictEqual(hudChars(), 2, 'D y 3 en el HUD: ' + shownOn('hud'));
    assert.strictEqual(fc.visible('panel').length + fc.visible('map').length, 0, 'nada en el cuadro');
    const layers = fc.visible('hud').sort((a, b) => a.x - b.x);
    assert.ok(layers[0].x < layers[1].x && layers[0].y === layers[1].y, 'D a la izquierda del 3, alineados');
    assert.deepStrictEqual(brightest(layers[1]), [174, 178, 184], 'gris suave de fábrica');
    assert.ok(layers.every((l) => l.x >= 0 && l.y >= 0 && l.x + l.w <= 800 && l.y + l.h <= 480), 'dentro de la escena');
    assert.ok(layers.every((l) => !l.contend && !l.exclusive), 'sin quitarle el hueco a nadie');
    const px0 = fc.frames.length;
    box('G4', 'D');
    await tick();
    assert.strictEqual(fc.frames.length, px0, 'un cambio de marcha no sube píxeles');
    assert.strictEqual(hudChars(), 2);
    ok('HUD: D3 en gris suave, a la derecha, y un cambio de marcha sin subir píxeles');

    // S en rojo y M en naranja, sin subir píxeles al cambiar
    const colours = () => fc.visible('hud').sort((a, b) => a.x - b.x).map((l) => brightest(l).join(','));
    const px3 = fc.frames.length;
    hu.feed(MD, 'dataDisplayGearbox', { displayProgramGearbox: 'S_MINUS_PROGRAMM' });
    await tick();
    assert.deepStrictEqual(colours(), ['228,40,46', '228,40,46'], 'S4 en rojo: ' + colours());
    hu.feed(MD, 'dataDisplayGearbox', { displayProgramGearbox: 'M_MINUS_PROGRAMM' });
    await tick();
    assert.deepStrictEqual(colours(), ['255,122,26', '255,122,26'], 'M4 en naranja');
    assert.strictEqual(fc.frames.length, px3, 'de D a S y a M sin subir píxeles');
    hu.settings.set('modeColours', 'letter');
    await tick();
    assert.deepStrictEqual(colours(), ['255,122,26', '174,178,184'], 'solo la M en naranja');
    hu.settings.set('modeColours', 'off');
    await tick();
    assert.deepStrictEqual(colours(), ['174,178,184', '174,178,184'], 'todo del mismo color');
    hu.settings.set('modeColours', 'all');
    hu.feed(MD, 'dataDisplayGearbox', { displayProgramGearbox: 'NONE' });
    await tick();
    assert.deepStrictEqual(colours(), ['174,178,184', '174,178,184'], 'D otra vez en gris suave');
    ok('S en rojo y M en naranja (o solo la letra, o todo igual), sin subir píxeles al cambiar de D a S y a M');

    // el coche apagándose y encendiéndose: nada en el HUD
    cond('FAHRBEREITSCHAFT_BEENDEN');
    await tick();
    assert.strictEqual(hudChars(), 0, 'al apagar (12) nada');
    cond('WOHNEN');
    await tick();
    assert.strictEqual(hudChars(), 0, 'apagado (5) nada');
    cond('FAHRBEREITSCHAFT_HERSTELLEN');
    await tick();
    assert.strictEqual(hudChars(), 0, 'al encender (8) nada');
    cond('FAHREN');
    await tick();
    assert.strictEqual(hudChars(), 2);
    ok('nada en el HUD al encender, al apagar ni apagado (el guardián de cluster-render)');

    // otra app toma el HUD (Redline): se le deja
    fs.writeFileSync(path.join(claims, 'redline'), JSON.stringify({ held: true, at: Date.now() }));
    await sleep(1300);
    assert.strictEqual(hudChars(), 0, 'cedido a Redline');
    assert.ok(JSON.parse(fs.readFileSync(path.join(claims, hu.spec.id + '.standing'), 'utf8')).on, 'se anuncia como app fija del HUD');
    hu.settings.set('hudGiveWay', false);
    await tick();
    assert.strictEqual(hudChars(), 2, 'sin el ajuste no se cede');
    hu.settings.set('hudGiveWay', true);
    fs.unlinkSync(path.join(claims, 'redline'));
    await sleep(1300);
    assert.strictEqual(hudChars(), 2, 'Redline lo suelta: vuelve');
    ok('deja el HUD a Redline mientras lo tiene (kit/hud_claim.js) y vuelve después');

    // noche
    hu.settings.set('nightBright', 40);
    hu.feed(VEH, 'statusDayNightChangeOver', { dayNightChangeOver: 'NACHT' });
    await tick();
    assert.ok(fc.visible('hud').every((l) => l.opacity === 0.4), 'de noche, al 40 %');
    const px1 = fc.frames.length;
    hu.feed(VEH, 'statusDayNightChangeOver', { dayNightChangeOver: 'TAG' });
    await tick();
    assert.ok(fc.visible('hud').every((l) => l.opacity === 1), 'de día, entero');
    assert.strictEqual(fc.frames.length, px1, 'el brillo de noche no sube píxeles');
    ok('brillo de noche con la opacidad de la capa, sin subir píxeles');

    // color, estilo, P / R / N, tamaño y posición
    hu.settings.set('hudColour', 'amber');
    await tick();
    assert.deepStrictEqual(brightest(fc.visible('hud')[0]), [255, 162, 31], 'ámbar');
    hu.settings.set('hudColour', 'custom'); hu.settings.set('customHue', 120); hu.settings.set('customSat', 50); hu.settings.set('customBright', 60);
    await tick();
    assert.deepStrictEqual(brightest(fc.visible('hud')[0]), [77, 153, 77], 'personalizado: tono 120, 50 %, 60 %');
    hu.settings.set('hudColour', 'softgrey');
    hu.settings.set('hudStyle', 'digit');
    await tick();
    assert.strictEqual(hudChars(), 1, 'solo el número');
    hu.settings.set('hudStyle', 'full');
    box('N_OR_P', 'P');
    await tick();
    assert.strictEqual(hudChars(), 1, 'P');
    hu.settings.set('hudPRN', 'hide');
    await tick();
    assert.strictEqual(hudChars(), 0, 'P oculta');
    hu.settings.set('hudPRN', 'letter');
    box('G3', 'D');
    await tick();
    const before = fc.visible('hud').map((l) => l.h)[0], px2 = fc.frames.length;
    hu.settings.set('hudSize', 150); hu.settings.set('hudPos', 'top'); hu.settings.set('hudY', -20);
    await tick();
    const big = fc.visible('hud');
    assert.ok(big[0].h > before * 1.4, 'más grande');
    assert.strictEqual(fc.frames.length, px2, 'tamaño y posición sin subir píxeles');
    const cx = (Math.min.apply(null, big.map((l) => l.x)) + Math.max.apply(null, big.map((l) => l.x + l.w))) / 2;
    assert.ok(Math.abs(cx - 400) < 20, 'arriba, centrado: ' + cx);
    ok('color (muestras y personalizado), solo número, P / R / N, tamaño y posición');

    // imagen del HUD como se vería (negro = transparente en el cristal)
    hu.settings.set('hudSize', 100); hu.settings.set('hudPos', 'right'); hu.settings.set('hudY', 0);
    await tick();
    const hudImg = new Canvas(800, 480).clear('#000000');
    fc.compose('hud', hudImg.d, 800, 480);
    fs.writeFileSync(path.join(out, 'hud.png'), hudImg.png());

    // cuadro: junto a la D, y los dos a la vez
    hu.settings.set('show', 'both');
    await sleep(600);
    const pos = hu.spec.config.positions.panel.big, panel = fc.visible('panel');
    assert.strictEqual(panel.length, 1, 'el número junto a la D');
    const cellW = hu.spec.config.glyph.w * hu.spec.config.glyph.stretch;
    assert.ok(Math.abs(panel[0].x + panel[0].w / 2 - (pos.x + cellW / 2)) <= 1 && panel[0].y === pos.y, 'centrado en la celda medida');
    assert.strictEqual(hudChars(), 2, 'y el HUD a la vez');
    hu.feed(MD, 'dataDisplayGearbox', { displayProgramGearbox: 'M_MINUS_PROGRAMM' });
    await tick();
    assert.strictEqual(fc.visible('panel').length, 0, 'en M el cuadro ya lo muestra');
    assert.strictEqual(hudChars(), 2, 'en el HUD sí: M3');
    hu.feed(MD, 'dataDisplayGearbox', { displayProgramGearbox: 'NONE' });
    hu.settings.set('clusterPlace', 'centre');
    await sleep(600);
    assert.strictEqual(fc.visible('panel').length, 0, 'ya no junto a la D');
    assert.strictEqual(fc.visible('map').length, 2, 'D3 en el centro del cuadro');
    const mapImg = new Canvas(1088, 480).clear('#202428');
    fc.compose('map', mapImg.d, 1088, 480);
    fs.writeFileSync(path.join(out, 'centro.png'), mapImg.png());
    ok('cuadro: junto a la D (oculto en M) o en el centro; HUD y cuadro a la vez');

    // calibrar: solo parado
    press('BTN_CALIB');
    await tick();
    assert.ok(!fc.visible('hud').some((l) => l.w === 800), 'en marcha no se calibra');
    speed(0);
    hu.settings.set('clusterPlace', 'nextToD');
    await tick();
    press('BTN_CALIB');
    await sleep(400);
    assert.ok(fc.visible('hud').some((l) => l.w === 800 && l.h === 480), 'rejilla en el HUD');
    assert.ok(fc.visible('panel').some((l) => l.w === 1920), 'rejilla en el cuadro');
    const gridImg = new Canvas(800, 480).clear('#000000');
    fc.compose('hud', gridImg.d, 800, 480);
    fs.writeFileSync(path.join(out, 'hud-rejilla.png'), gridImg.png());
    press('BTN_CALIB');
    await sleep(400);
    assert.ok(!fc.visible('hud').some((l) => l.w === 800), 'rejilla quitada');
    speed(20);
    await sleep(400);
    ok('calibrar solo parado: rejilla en el HUD y en el cuadro, prueba y fin al moverse');

    // demo: nunca en el HUD ni en el cuadro
    hu.settings.set('demo', 'on');
    await sleep(600);
    assert.strictEqual(hudChars() + fc.visible('panel').length + fc.visible('map').length, 0, 'demo solo en pantalla');
    hu.settings.set('demo', 'off');
    hu.settings.set('show', 'off');
    await sleep(600);
    assert.strictEqual(fc.layers.size, 0, 'apagado: no quedan capas (se cierra la conexión)');
    ok('demo solo en la pantalla; "en ningún sitio" suelta cluster-render');

    if (frame) fs.writeFileSync(path.join(out, 'pantalla.png'), frame.png());
    const bad = warnings.filter((w) => !/cluster-render: desconectado|señal .* error/.test(w));
    assert.deepStrictEqual(bad, [], 'sin avisos: ' + bad.join(' | '));
    console.log('PASS test_e2e');
    await fc.close();
    process.exit(0);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
