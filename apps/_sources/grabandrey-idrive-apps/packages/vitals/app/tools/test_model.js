'use strict';
/* node packages/vitals/app/tools/test_model.js: settings rows, the service's checks, the car-data decoding, the view */
const assert = require('assert');
const path = require('path');
const m = require('../src/settings_model.js');
const decode = require('../src/decode.js');
const svc = require(path.join(__dirname, '../../tool/vitals.js'));
const view = require(path.join(__dirname, '../../tool/view.js'));
const layout = require(path.join(__dirname, '../../tool/layout.js'));

/* ---- settings rows, through the service's own checks ---- */
const row = (name) => m.ROWS.find((r) => r.name === name);
let s = svc.normalize({});
function press(name) {
    const change = row(name).press(s);
    s = change === 'reset' ? svc.normalize({}) : svc.normalize(Object.assign({}, s, change));
    return s;
}
assert.strictEqual(row('vtTempUnit').value(s), 'Car setting');
assert.strictEqual(press('vtTempUnit').tempUnit, 'C');
assert.strictEqual(press('vtTempUnit').tempUnit, 'F');
assert.strictEqual(row('vtCoolantWarn').value(s), '239 °F');
assert.strictEqual(press('vtTempUnit').tempUnit, 'auto');
assert.strictEqual(press('vtPressUnit').pressUnit, 'bar');
assert.strictEqual(press('vtPressUnit').pressUnit, 'psi');
assert.strictEqual(press('vtPressUnit').pressUnit, 'kPa');
assert.strictEqual(press('vtCoolantWarn').coolantWarn, 120);
for (let i = 0; i < 20; i++) press('vtCoolantWarn');
assert.ok(s.coolantWarn >= 95 && s.coolantWarn <= 130);
assert.strictEqual(press('vtOilWarn').oilWarn, 140);
assert.strictEqual(press('vtGearboxWarn').gearboxWarn, 125);
assert.strictEqual(press('vtAccent').accent, 'lightblue');
assert.strictEqual(row('vtAccent').value(s), 'Light blue');
assert.strictEqual(press('vtPressures').pressures, false);
assert.strictEqual(row('vtPressures').value(s), 'Hidden');
assert.strictEqual(row('vtUp').value(s), 'Default');
assert.strictEqual(press('vtDown').shiftY, 10);
assert.strictEqual(row('vtDown').value(s), '10 px lower');
for (let i = 0; i < 30; i++) press('vtUp');
assert.strictEqual(s.shiftY, -100, 'stops at the top of its range');
assert.strictEqual(row('vtUp').value(s), '100 px higher');
assert.strictEqual(svc.normalize({ shiftY: 500 }).shiftY, 0, 'a position out of range falls back');
assert.strictEqual(press('vtZoomIn').zoom, 105);
for (let i = 0; i < 30; i++) press('vtZoomOut');
assert.strictEqual(s.zoom, 70, 'stops at its smallest');
assert.strictEqual(svc.normalize({ zoom: 400 }).zoom, 100);
assert.strictEqual(press('vtDemo').demo, true);
press('vtReset');
assert.strictEqual(s.shiftY, 0);
assert.strictEqual(s.zoom, 100);
assert.deepStrictEqual([s.tempUnit, s.pressUnit, s.coolantWarn, s.oilWarn, s.gearboxWarn, s.accent, s.pressures, s.demo],
    ['auto', 'auto', 115, 135, 120, 'blue', true, false]);


/* the service refuses nonsense */
const bad = svc.normalize({ gearboxWarn: 200, tempUnit: 'K', pressUnit: 'atm', coolantWarn: 300, oilWarn: 'hot', accent: 'pink', pressures: 'yes', demo: 1, target: '../x' });
assert.strictEqual(bad.gearboxWarn, 120);
assert.deepStrictEqual([bad.tempUnit, bad.pressUnit, bad.coolantWarn, bad.oilWarn, bad.accent, bad.pressures, bad.demo, bad.target],
    ['auto', 'auto', 115, 135, 'blue', true, false, 'vitals']);
const cd = svc.cleanData({ coolant: 91, oil: 999, tyreT: { FL: 40, FR: 'x' }, tyreP: { FL: 2.4, RR: 50 }, carTemp: 'K', carPress: 'PSI', evil: 1 }, 1000);
assert.deepStrictEqual(cd, { coolant: 91, oil: null, engineAt: 1000, tyreT: { FL: 40, FR: null, RL: null, RR: null },
    tyreP: { FL: 2.4, FR: null, RL: null, RR: null }, tyresAt: 1000, carPress: 'PSI' });

/* ---- decoding the car's raw values ---- */
assert.deepStrictEqual(decode.engine({ temperatureEngineDrive: 138, temperatureEngineOilDrive: 152 }), { coolant: 90, oil: 104 });
assert.deepStrictEqual(decode.engine({ temperatureEngineDrive: 255 }), { coolant: null, oil: null });
assert.strictEqual(decode.gearbox({ valueTemperatureTransmissionOil: 130 }), 82);
assert.strictEqual(decode.gearbox({ valueTemperatureTransmissionOil: 255 }), null);
assert.strictEqual(decode.gearbox({}), null);
assert.deepStrictEqual(svc.cleanData({ gearbox: 82 }, 5), { gearbox: 82, gearboxAt: 5 });
assert.deepStrictEqual(svc.cleanData({ gearbox: 900 }, 5), { gearbox: null, gearboxAt: 5 });
assert.deepStrictEqual(decode.units({ unitOfMeasurementTemperature: 2, unitOfMeasurementAirPressure: 3 }), { carTemp: 'F', carPress: 'PSI' });
assert.deepStrictEqual(decode.units({ unitOfMeasurementTemperature: 'CELSIUS', unitOfMeasurementAirPressure: 'BAR' }), { carTemp: 'C', carPress: 'BAR' });
const tt = decode.tyreTemps({ actualValueTemperatureTyreFLH: 80, actualValueTemperatureTyreFRH: 65535, actualValueTemperatureTyreRLH: 140 }, 'F');
assert.ok(Math.abs(tt.FL - 4.44) < 0.01 && tt.FR === null && Math.abs(tt.RL - 37.78) < 0.01 && tt.RR === null, JSON.stringify(tt));
assert.strictEqual(decode.tyreTemps({ actualValueTemperatureTyreFLH: 80 }, 'C').FL, 40);
const tp = decode.tyrePressures({ actualValuePressureTyreFLH: 24, actualValuePressureTyreFRH: 350, actualValuePressureTyreRLH: 2400, actualValuePressureTyreRRH: 65535 }, null);
assert.ok(Math.abs(tp.FL - 2.4) < 1e-9 && Math.abs(tp.FR - 2.413) < 0.001 && Math.abs(tp.RL - 2.4) < 1e-9 && tp.RR === null, JSON.stringify(tp));
assert.ok(Math.abs(decode.tyrePressures({ actualValuePressureTyreFLH: 2400 }, 'KPA').FL - 2.4) < 1e-9);

/* ---- the view ---- */
const now = 100000;
const data = { coolant: 120, oil: 100, gearbox: 125, gearboxAt: now, tyreT: { FL: 10, FR: 50, RL: 80, RR: 99 }, tyreP: { FL: 2.4, FR: 2.4, RL: 2.6, RR: 2.6 },
    carTemp: 'C', carPress: 'BAR', engineAt: now, tyresAt: now };
let v = view.compose(svc.normalize({}), data, now);
const field = (id) => v.fields.find((f) => f.id === id).text;
assert.strictEqual(field('coolant.value'), '120');
assert.deepStrictEqual(v.uniforms.u_cool.slice(1), [1, 1], 'coolant over 115: warned');
assert.deepStrictEqual(v.uniforms.u_oil.slice(1), [1, 0]);
assert.deepStrictEqual(v.uniforms.u_gbox.slice(1), [1, 1], 'gearbox over 120: warned');
assert.strictEqual(field('gearbox.value'), '125');
const fieldOf = (id) => v.fields.find((f) => f.id === id);
assert.deepStrictEqual([fieldOf('tyre.FL.t').text, fieldOf('tyre.FL.t').suffix.text], ['10', '°C'], 'the unit next to the tyre');
assert.deepStrictEqual([fieldOf('tyre.RR.p').text, fieldOf('tyre.RR.p').suffix.text], ['2.6', 'bar']);
assert.strictEqual(fieldOf('tyre.FL.t').align, 'right'); assert.strictEqual(fieldOf('tyre.FR.t').align, 'left');
assert.strictEqual(v.uniforms.u_tFL[2], 0.96, 'cold tyre blue');
assert.strictEqual(v.uniforms.u_tRR[0], 0.95, 'hot tyre red');
assert.strictEqual(field('tyre.FL.p'), '2.4');
v = view.compose(svc.normalize({ tempUnit: 'F', pressUnit: 'psi' }), data, now);
assert.strictEqual(field('coolant.value'), '248');
assert.strictEqual(field('tyre.FL.p'), '35');
assert.strictEqual(v.fields.find((f) => f.id === 'tyre.FL.p').suffix.text, 'psi');
assert.strictEqual(v.fields.find((f) => f.id === 'tyre.FL.t').suffix.text, '°F');
v = view.compose(svc.normalize({}), data, now + 20000);
assert.strictEqual(field('coolant.value'), '– –', 'stale engine data shows dashes');
assert.strictEqual(field('tyre.FL.t'), '10', 'tyre data lasts longer');
assert.strictEqual(field('gearbox.value'), '125', 'gearbox data lasts a minute');
v = view.compose(svc.normalize({}), data, now + 70000);
assert.strictEqual(field('gearbox.value'), '– –');

/* the text: a unit drawn right after its number, in one box */
const { TextCanvas } = require(path.join(__dirname, '../../tool/text.js'));
const FONT = require(path.join(__dirname, '../../tool/font.js'));
const tc = new TextCanvas(layout.W, layout.H, FONT);
const plain = tc.draw('value', 300, 400, '41', 'right', 0);
tc.px.fill(0);
const withUnit = tc.draw('value', 300, 400, '41', 'right', 0, { style: 'unit', text: '°C', gap: 4, dim: 0.6 });
assert.ok(withUnit.x < plain.x && withUnit.x + withUnit.w <= 300 + 1, 'right-aligned as one: the number moves left for its unit');
const peak = (x0, x1) => { let m = 0; for (let y = 360; y < 410; y++) for (let x = x0; x < x1; x++) m = Math.max(m, tc.px[y * layout.W + x]); return m; };
const split = withUnit.x + plain.w + 2;          // the number on the left of it, the unit on the right
assert.strictEqual(peak(withUnit.x, split), 255, 'the number at full strength');
assert.ok(peak(split, 302) > 0 && peak(split, 302) <= 153, 'the unit fainter (dim 0.6)');

console.log('vitals model, decoding and view: ok');

/* ---- gearbox oil (car_data.js, with stand-ins for BMW's SDK) ---- */
const Module = require('module');
const realLoad = Module._load;
Module._load = function (req) {
    if (req === 'oap-sdk/src/someip/someipBuilders') return { buildTypedProxy: () => Promise.reject(new Error('no SDK here')) };
    return realLoad.apply(this, arguments);
};
const { CarData } = require('../src/car_data.js');
Module._load = realLoad;
const quiet = { info() {}, warn() {} };
let car = new CarData(quiet), got = [];
car.on('data', (d) => got.push(d));
car._gearbox({ valueTemperatureTransmissionOil: 255 });
assert.strictEqual(got.length, 0, '255 = no value');
car._gearbox({ valueTemperatureTransmissionOil: 48 + 31 });
assert.deepStrictEqual(got.pop(), { gearbox: 31 }, 'the first plausible value shows at once');
car = new CarData(quiet); got = [];
car.on('data', (d) => got.push(d));
car.oil = 20;
car._gearbox({ valueTemperatureTransmissionOil: 100 });
car.oil = 50;
car._gearbox({ valueTemperatureTransmissionOil: 100 });
assert.deepStrictEqual(got.pop(), { gearbox: null }, 'a value that never moves while the engine warms is hidden');
car._gearbox({ valueTemperatureTransmissionOil: 101 });
assert.strictEqual(got.length, 1, 'and stays hidden');

/* the gearbox value stays while the engine data is live, even when the car sends it rarely */
const gd = { coolant: 80, oil: 90, gearbox: 70, engineAt: now + 300000, gearboxAt: now };
const gf = (v2) => v2.fields.find((f) => f.id === 'gearbox.value').text;
assert.strictEqual(gf(view.compose(svc.normalize({}), gd, now + 300000)), '70');
assert.strictEqual(gf(view.compose(svc.normalize({}), gd, now + 700000)), '– –');

/* the layout fits the layer */
assert.ok(layout.tyre.yRear + layout.tyreText.dyP + 12 < layout.H - 40, 'room at the bottom');
console.log('  gearbox, position: ok');

/* ---- the drawn screen (src/ui.js) ---- */
const ui = require('../src/ui.js');
const full = svc.normalize({});
const drawn = ui.draw(new ui.Recorder(), { settings: full, status: { renderer: 'connected', engine: true }, connected: true,
    data: { coolant: 90, oil: 100, carTemp: 'C' }, rows: m.ROWS, focus: 'vtDemo', pressed: null });
const keys = drawn.targets.map((t) => t.key).sort();
assert.deepStrictEqual(keys, m.ROWS.map((r) => r.name).sort(), 'every settings row has a place on the drawn screen');
drawn.targets.forEach((t) => assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= ui.W && t.y + t.h <= ui.H, t.key + ' on screen'));
assert.strictEqual(ui.hit(drawn.targets, drawn.targets[0].x + 5, drawn.targets[0].y + 5).key, drawn.targets[0].key);
assert.strictEqual(ui.hit(drawn.targets, 5, 5), null);
assert.ok(drawn.rec.words().length > 100 && drawn.rec.atlases.length >= 3);
// every op in the frame is one the renderer knows, with the right length
{
    const w = drawn.rec.words(), LEN = { 1: 2, 2: 6, 4: 7, 5: 8, 15: 10 };
    let i = 0;
    while (i < w.length) {
        if (w[i] === 11) i += 4 + w[i + 3] * 8;
        else { assert.ok(LEN[w[i]], 'op ' + w[i] + ' at ' + i); i += LEN[w[i]]; }
    }
    assert.strictEqual(i, w.length);
}
const pl = ui.placement({ x: 0, y: 76, w: 2880, h: 764 });
assert.deepStrictEqual([pl.scale, pl.ox, pl.oy], [1, 0, 0]);
console.log('  drawn screen: ok');

/* ---- the renderer client (src/gpu.js) against a stand-in renderer ---- */
const net = require('net');
const os = require('os');
const fs = require('fs');
const { Gpu } = require('../src/gpu.js');
const sockPath = path.join(os.tmpdir(), 'vitals-gpu-test-' + process.pid + '.sock');
try { fs.unlinkSync(sockPath); } catch (e) { /* none */ }
const seen = [];
const server = net.createServer((c) => {
    let buf = Buffer.alloc(0);
    c.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 8 && buf.length >= 8 + buf.readUInt32LE(4)) {
            const type = buf.readUInt32LE(0), len = buf.readUInt32LE(4);
            seen.push({ type, p: buf.slice(8, 8 + len) });
            buf = buf.slice(8 + len);
            if (type === 1) {           // HELLO: X_READY with an app area, then READY 2880x960
                const x = Buffer.alloc(44); x.writeUInt32LE(32 | 1, 8);
                [0, 76, 2880, 764].forEach((v, k) => x.writeInt32LE(v, 28 + k * 4));
                const r = Buffer.alloc(16); r.writeUInt32LE(2880, 4); r.writeUInt32LE(960, 8); r.writeUInt32LE(1, 12);
                const head = (t, p) => { const h = Buffer.alloc(8); h.writeUInt32LE(t, 0); h.writeUInt32LE(p.length, 4); return Buffer.concat([h, p]); };
                c.write(Buffer.concat([head(0x4d520101, x), head(101, r)]));
            }
            if (type === 7) {           // FRAME: a tick, and a tap at 100, 200
                const t = Buffer.alloc(12); t.writeUInt32LE(3, 0); t.writeFloatLE(100, 4); t.writeFloatLE(200, 8);
                const head = (ty, p) => { const h = Buffer.alloc(8); h.writeUInt32LE(ty, 0); h.writeUInt32LE(p.length, 4); return Buffer.concat([h, p]); };
                c.write(Buffer.concat([head(102, Buffer.alloc(8)), head(105, t)]));
            }
        }
    });
});
server.listen(sockPath, () => {
    const gpu = new Gpu('ida_vitals', quiet, [sockPath]);
    let area = null, touch = null;
    gpu.on('ready', (scr, a) => { area = a; gpu.place(ui.placement(a)); gpu.show(true); gpu.claim([{ x: 0, y: 0, w: ui.W, h: ui.H }]); gpu.frame(drawn.rec); });
    gpu.on('touch', (ph, x, y) => { touch = [ph, x, y]; });
    gpu.on('tick', () => setTimeout(() => {
        gpu.close(); server.close();
        try { fs.unlinkSync(sockPath); } catch (e) { /* gone */ }
        assert.deepStrictEqual(area, { x: 0, y: 76, w: 2880, h: 764 });
        assert.deepStrictEqual(touch, [3, 100, 200]);
        const types = seen.map((s) => s.type);
        assert.strictEqual(types[0], 1);
        assert.ok(seen[0].p.toString().indexOf('proto=mgu-render/1') > 0);
        [0x4d520001, 2, 3, 9, 4, 7].forEach((t) => assert.ok(types.indexOf(t) >= 0, 'sent message ' + t));
        assert.ok(types.indexOf(4) < types.indexOf(7), 'the glyph atlases before the frame');
        const frame = seen.find((s) => s.type === 7).p;
        assert.strictEqual(frame.length, drawn.rec.words().length * 4);
        console.log('  renderer client: ok');
    }, 50));
    gpu.connect();
});

/* ---- gearbox diagnostics for the screen ---- */
{
    const c = new CarData(quiet);
    assert.ok(/not set up/.test(c.gearboxText()));
    c.diag.BasicDataSet = { state: 'waiting for the car', updates: 0, at: 0, error: null };
    assert.ok(/waiting for the car, 0 updates/.test(c.gearboxText()));
    c.diag.BasicDataSet.updates = 3;
    c._gearbox({ somethingElse: 1 });
    assert.ok(/without a gearbox oil value/.test(c.gearboxText()), c.gearboxText());
    c._gearbox({ valueTemperatureTransmissionOil: 255 });
    assert.ok(/raw 255 \(= no value\)/.test(c.gearboxText()), c.gearboxText());
    console.log('  gearbox diagnostics: ok');
}
