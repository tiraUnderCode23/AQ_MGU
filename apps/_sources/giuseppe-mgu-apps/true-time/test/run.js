'use strict';
/**
 * True Time's tests: the measuring core (app/engine.js) driven by the simulated car (app/sim.js).
 *
 *   node test/run.js
 *
 * The check that matters: a run on a slope, corrected, must come out as the same car's run on the level.
 */
const assert = require('assert');
const path = require('path');
const { Recorder, analyze, overall, heightOf } = require(path.join(__dirname, '..', 'app', 'engine'));
const { SimCar, baroReading } = require(path.join(__dirname, '..', 'app', 'sim'));
const { DscSlope } = require(path.join(__dirname, '..', 'app', 'dscslope'));
const T = require(path.join(__dirname, '..', 'app', 'tests'));

let failed = 0, passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}

/** A seeded random (the barometer's noise): the same numbers every run. */
function rng(seed) {
    let x = seed >>> 0;
    return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

/**
 * Drive the simulated car through script [[mode, until(car, t)]] and feed a Recorder as the app does:
 * speed every 20 ms (BMW's 1/64 km/h steps), the barometer every 125 ms. armAt: the script step whose
 * start presses Arm. Returns { rec, run, results }.
 */
function drive(script, opts) {
    const o = opts || {};
    const car = new SimCar({ grade: o.grade || (() => 0) });
    if (o.v0) car.v = o.v0;
    const rnd = rng(o.seed || 7);
    let run = null;
    const rec = new Recorder(o.kind || 'accel', { rollout: !!o.rollout, onDone: (r) => { run = r; } });
    let t = 1000000, nextBaro = t;
    let hFilt = null;
    // the DSC's sensor as a car has it: a little noise, a short lag, and the body's pitch (o.pitch g of
    // reading per g of acceleration: the tail squats under power, dives under braking)
    const dsc = o.source === 'dsc' ? new DscSlope({ pitch: o.comp || 0 }) : null;
    let aSensor = 0;
    for (let i = 0; i < script.length; i++) {
        const [mode, until] = script[i];
        if (i === (o.armAt || 0)) rec.arm();
        let inPhase = 0;
        while (!until(car, inPhase) && inPhase < 120) {
            car.step(0.02, mode);
            inPhase += 0.02; t += 20;
            const vCar = Math.round(car.v * 64) / 64;
            if (dsc) {
                const truth = car.aG + (o.pitch || 0) * (car.dvdt / 9.80665) + (rnd() - 0.5) * 0.02;
                aSensor += (truth - aSensor) * (1 - Math.exp(-0.02 / 0.06));
                dsc.push(t, vCar, Math.round(aSensor * 500) / 500);
                hFilt = dsc.height;
                for (const p of dsc.take()) if (p.t >= nextBaro) { nextBaro = p.t + 100; rec.baroReading(p.t, p.h); }
            } else if (t >= nextBaro) {
                nextBaro += o.baroMs || 125;
                const h = heightOf(o.noBaro ? NaN : baroReading(car.hPa, rnd));
                if (isFinite(h)) { hFilt = hFilt === null ? h : hFilt + (h - hFilt) * 0.1; rec.baroReading(t, h); }
            }
            rec.feed(t, vCar, car.aG, hFilt, null);
            rec.tick(t);
        }
    }
    const tests = o.kind === 'brake' ? T.brakeTests(o.system || 'metric', o.customs) : T.accelTests(o.system || 'metric', o.customs);
    return { rec, run, results: run ? analyze(run, tests) : [], car };
}

const byKey = (results) => { const m = {}; results.forEach((r) => { m[r.key] = r; }); return m; };
const STAND = [['stop', (c, t) => t >= 3], ['full', (c) => c.v >= 205], ['coast', (c, t) => t >= 3]];

console.log('engine');

test('level road: corrected = measured, grade ~0', () => {
    const { results } = drive(STAND);
    const r = byKey(results);
    assert.ok(r['kmh:0-100'], '0-100 measured');
    assert.ok(r['kmh:0-200'], '0-200 measured');
    assert.ok(r['dist:400.000'], '400 m measured');
    for (const k of ['kmh:0-100', 'kmh:0-200', 'dist:400.000', 'kmh:100-200']) {
        assert.ok(Math.abs(r[k].grade) < 0.003, k + ' grade ' + r[k].grade);
        assert.ok(Math.abs(r[k].timeCorr - r[k].time) < 0.06, k + ' ' + r[k].time + ' vs ' + r[k].timeCorr);
    }
    console.log('       level: 0-100 ' + r['kmh:0-100'].time.toFixed(2) + ' s, 0-200 ' + r['kmh:0-200'].time.toFixed(2) + ' s, 400 m ' + r['dist:400.000'].time.toFixed(2) + ' s');
});

test('2% downhill and 2% uphill: corrected matches the level run', () => {
    const flat = byKey(drive(STAND).results);
    for (const p of [-0.02, 0.02]) {
        const r = byKey(drive(STAND, { grade: () => p, seed: 11 }).results);
        const line = [];
        for (const k of ['kmh:0-100', 'kmh:0-200', 'kmh:100-200', 'dist:400.000', 'dist:1000.000']) {
            assert.ok(r[k] && flat[k], k);
            const off = r[k].time - flat[k].time, err = r[k].timeCorr - flat[k].time;
            assert.ok(Math.abs(r[k].grade - p) < 0.004, k + ' grade ' + r[k].grade + ' vs ' + p);
            // the correction takes away at least 80 % of what the slope did
            assert.ok(Math.abs(err) <= Math.max(0.05, Math.abs(off) * 0.2), k + ': level ' + flat[k].time.toFixed(3) + ', slope ' + r[k].time.toFixed(3) + ', corrected ' + r[k].timeCorr.toFixed(3));
            line.push(k.replace(/^\w+:/, '') + ' ' + flat[k].time.toFixed(2) + '/' + r[k].time.toFixed(2) + '/' + r[k].timeCorr.toFixed(2));
        }
        console.log('       ' + (p * 100) + '% (level/measured/corrected): ' + line.join(', '));
    }
});

test('rollout: 0-100 and 400 m start after the first foot', () => {
    const a = byKey(drive(STAND).results), b = byKey(drive(STAND, { rollout: true }).results);
    const d = a['kmh:0-100'].time - b['kmh:0-100'].time;
    assert.ok(d > 0.1 && d < 0.5, 'rollout saves ' + d);
    assert.ok(a['dist:400.000'].time > b['dist:400.000'].time, '400 m');
    assert.ok(Math.abs(a['kmh:100-200'].time - b['kmh:100-200'].time) < 0.02, 'a rolling range is the same either way');
});

test('rolling start at 80: 80-120 and 100-200, no 0-X or distances', () => {
    const script = [['cruise', (c, t) => t >= 4], ['full', (c) => c.v >= 205], ['coast', (c, t) => t >= 3]];
    const { run, results } = drive(script, { v0: 80 });
    assert.strictEqual(run.mode, 'rolling');
    const r = byKey(results);
    assert.ok(r['kmh:80-120'] && r['kmh:100-200'], 'rolling ranges');
    assert.ok(!r['kmh:0-100'] && !r['dist:400.000'], 'no standing tests');
    assert.ok(!r['kmh:60-100'], 'nothing below the start');
});

test('the run ends once the speed settles, timed up to the top', () => {
    const script = [['stop', (c, t) => t >= 2], ['full', (c) => c.v >= 120], ['cruise', (c, t) => t >= 6]];
    const { rec, run } = drive(script);
    assert.strictEqual(rec.state, 'done');
    assert.ok(run.samples[run.samples.length - 1].v >= 119, 'ends at the top: ' + run.samples[run.samples.length - 1].v);
});

test('braking 100-0 and 200-0 on a 2% rise, corrected = level', () => {
    const script = (top) => [['full', (c) => c.v >= top], ['coast', (c, t) => t >= 1.5], ['brake', (c) => c.v <= 0], ['stop', (c, t) => t >= 2]];
    const flat = byKey(drive(script(210), { kind: 'brake', armAt: 1 }).results);
    const up = byKey(drive(script(210), { kind: 'brake', armAt: 1, grade: () => 0.02 }).results);
    for (const k of ['kmh:100-0', 'kmh:200-0']) {
        assert.ok(flat[k] && up[k], k);
        assert.ok(up[k].dist < flat[k].dist, 'the rise shortens it');
        assert.ok(Math.abs(up[k].distCorr - flat[k].dist) < Math.max(0.3, (flat[k].dist - up[k].dist) * 0.2), k + ' level ' + flat[k].dist.toFixed(2) + ' m, rise ' + up[k].dist.toFixed(2) + ', corrected ' + up[k].distCorr.toFixed(2));
        assert.ok(Math.abs(up[k].timeCorr - flat[k].time) < 0.05, k + ' time');
    }
    console.log('       100-0 level/rise/corrected: ' + flat['kmh:100-0'].dist.toFixed(2) + '/' + up['kmh:100-0'].dist.toFixed(2) + '/' + up['kmh:100-0'].distCorr.toFixed(2) + ' m');
});

test('no barometer: measured only', () => {
    const r = byKey(drive(STAND, { noBaro: true }).results);
    assert.ok(r['kmh:0-100'].time > 0);
    assert.strictEqual(r['kmh:0-100'].timeCorr, null);
});

test('custom ranges: 50-150 accelerating, 150-50 braking', () => {
    const customs = [{ from: 50, to: 150, unit: 'kmh' }, { from: 150, to: 50, unit: 'kmh' }, null];
    const r = byKey(drive(STAND, { customs }).results);
    assert.ok(r['custom:kmh:50-150'], 'custom accel range');
    const tests = T.brakeTests('metric', customs);
    assert.ok(tests.some((x) => x.key === 'custom:kmh:150-50'), 'custom braking range');
});

test('imperial: 0-60 mph, 60 ft, 1/4 mile', () => {
    const r = byKey(drive(STAND, { system: 'imperial' }).results);
    assert.ok(r['mph:0-60'] && r['dist:18.288'] && r['dist:402.336'], Object.keys(r).join(' '));
});

test('a creep from the standstill is not a launch', () => {
    const script = [['stop', (c, t) => t >= 2], ['cruise', (c, t) => { c.cruiseKmh = 3; return t >= 1; }], ['stop', (c, t) => t >= 3], ['full', (c) => c.v >= 110], ['coast', (c, t) => t >= 3]];
    const { run, results } = drive(script);
    assert.strictEqual(run.mode, 'standing');
    assert.ok(byKey(results)["kmh:0-100"].time < 7.2, "timed from the real launch: " + byKey(results)["kmh:0-100"].time);
});

test('overall: the run\'s height change on a 1.5% downhill', () => {
    const { run } = drive(STAND, { grade: () => -0.015 });
    const o = overall(run);
    assert.ok(Math.abs(o.grade + 0.015) < 0.003, 'grade ' + o.grade);
    assert.ok(o.dh < 0, 'down');
});


test('a road that changes: 1.5% down, then a 1% rise (the demo road)', () => {
    const { demoGrade } = require(path.join(__dirname, '..', 'app', 'sim'));
    const flat = byKey(drive(STAND).results);
    const r = byKey(drive(STAND, { grade: demoGrade, seed: 5 }).results);
    const line = [];
    for (const k of ['kmh:0-100', 'kmh:0-200', 'kmh:100-200', 'dist:400.000', 'dist:1000.000']) {
        const off = r[k].time - flat[k].time, err = r[k].timeCorr - flat[k].time;
        assert.ok(Math.abs(err) <= Math.max(0.06, Math.abs(off) * 0.15), k + ': level ' + flat[k].time.toFixed(3) + ', measured ' + r[k].time.toFixed(3) + ', corrected ' + r[k].timeCorr.toFixed(3));
        line.push(k.replace(/^\w+:/, '') + ' ' + flat[k].time.toFixed(2) + '/' + r[k].time.toFixed(2) + '/' + r[k].timeCorr.toFixed(2));
    }
    console.log('       demo road (level/measured/corrected): ' + line.join(', '));
});

test('a slow barometer (2 readings a second, more noise) still corrects', () => {
    const flat = byKey(drive(STAND).results);
    const r = byKey(drive(STAND, { grade: () => -0.02, seed: 3, baroMs: 500 }).results);
    for (const k of ['kmh:0-100', 'kmh:0-200', 'dist:400.000']) {
        const off = r[k].time - flat[k].time, err = r[k].timeCorr - flat[k].time;
        assert.ok(Math.abs(err) <= Math.max(0.08, Math.abs(off) * 0.25), k + ': level ' + flat[k].time.toFixed(3) + ', measured ' + r[k].time.toFixed(3) + ', corrected ' + r[k].timeCorr.toFixed(3));
    }
});

test('braking: the run starts at the brake, not while coasting', () => {
    const script = [['full', (c) => c.v >= 200], ['coast', (c, t) => t >= 3], ['brake', (c) => c.v <= 0], ['stop', (c, t) => t >= 2]];
    const { run } = drive(script, { kind: 'brake', armAt: 1 });
    const dur = (run.tEnd - run.t0) / 1000, top = run.samples.find((x) => x.t >= run.t0).v;
    assert.ok(dur > 5 && dur < 6.3, 'braking took ' + dur.toFixed(2) + ' s');
    assert.ok(top < 196, 'starts after the coast, at ' + top.toFixed(1) + ' km/h');
});

test('rolling: a slow drift while cruising does not start a run', () => {
    const script = [['cruise', (c, t) => { c.cruiseKmh = 80 + t * 0.12; return t >= 30; }], ['full', (c) => c.v >= 150], ['coast', (c, t) => t >= 3]];
    const { run } = drive(script, { v0: 80 });
    const start = run.samples.find((x) => x.t >= run.t0).v;
    assert.ok(start > 82, 'the run starts at the full throttle, at ' + start.toFixed(1) + ' km/h');
});

console.log('\nslope from the DSC (sensor noise, lag, and a body that pitches 1.5% per g, compensated)');

test('DSC: 2% down and up, corrected = level', () => {
    const flat = byKey(drive(STAND).results);
    for (const p of [-0.02, 0.02]) {
        const r = byKey(drive(STAND, { grade: () => p, source: 'dsc', pitch: 0.015, comp: 0.015, seed: 9 }).results);
        const line = [];
        for (const k of ['kmh:0-100', 'kmh:0-200', 'kmh:100-200', 'dist:400.000', 'dist:1000.000']) {
            const off = r[k].time - flat[k].time, err = r[k].timeCorr - flat[k].time;
            assert.ok(Math.abs(r[k].grade - p) < 0.006, k + ' grade ' + r[k].grade.toFixed(4) + ' vs ' + p);
            assert.ok(Math.abs(err) <= Math.max(0.08, Math.abs(off) * 0.2), k + ': level ' + flat[k].time.toFixed(3) + ', measured ' + r[k].time.toFixed(3) + ', corrected ' + r[k].timeCorr.toFixed(3));
            line.push(k.replace(/^\w+:/, '') + ' ' + flat[k].time.toFixed(2) + '/' + r[k].time.toFixed(2) + '/' + r[k].timeCorr.toFixed(2));
        }
        console.log('       ' + (p * 100) + '% (level/measured/corrected): ' + line.join(', '));
    }
});

test('DSC: a road that changes (1.5% down, then a 1% rise)', () => {
    const { demoGrade } = require(path.join(__dirname, '..', 'app', 'sim'));
    const flat = byKey(drive(STAND).results);
    const r = byKey(drive(STAND, { grade: demoGrade, source: 'dsc', pitch: 0.015, comp: 0.015, seed: 4 }).results);
    const line = [];
    for (const k of ['kmh:0-100', 'kmh:0-200', 'kmh:100-200', 'dist:400.000', 'dist:1000.000']) {
        const off = r[k].time - flat[k].time, err = r[k].timeCorr - flat[k].time;
        assert.ok(Math.abs(err) <= Math.max(0.08, Math.abs(off) * 0.2), k + ': level ' + flat[k].time.toFixed(3) + ', measured ' + r[k].time.toFixed(3) + ', corrected ' + r[k].timeCorr.toFixed(3));
        line.push(k.replace(/^\w+:/, '') + ' ' + flat[k].time.toFixed(2) + '/' + r[k].time.toFixed(2) + '/' + r[k].timeCorr.toFixed(2));
    }
    console.log('       demo road (level/measured/corrected): ' + line.join(', '));
});

test('DSC: braking on a 2% rise, corrected = level', () => {
    const script = [['full', (c) => c.v >= 210], ['coast', (c, t) => t >= 1.5], ['brake', (c) => c.v <= 0], ['stop', (c, t) => t >= 2]];
    const flat = byKey(drive(script, { kind: 'brake', armAt: 1 }).results);
    const up = byKey(drive(script, { kind: 'brake', armAt: 1, grade: () => 0.02, source: 'dsc', pitch: 0.015, comp: 0.015, seed: 2 }).results);
    for (const k of ['kmh:100-0', 'kmh:200-0']) {
        assert.ok(Math.abs(up[k].distCorr - flat[k].dist) < Math.max(0.5, (flat[k].dist - up[k].dist) * 0.3), k + ' level ' + flat[k].dist.toFixed(2) + ', rise ' + up[k].dist.toFixed(2) + ', corrected ' + up[k].distCorr.toFixed(2));
    }
    console.log('       100-0 level/rise/corrected: ' + flat['kmh:100-0'].dist.toFixed(2) + '/' + up['kmh:100-0'].dist.toFixed(2) + '/' + up['kmh:100-0'].distCorr.toFixed(2) + ' m');
});

test('DSC: standing still on a 3% slope reads 3%', () => {
    const d = new DscSlope();
    for (let i = 0; i < 200; i++) d.push(1000 + i * 20, 0, 0.03 + (i % 2 ? 0.004 : -0.004));
    assert.ok(Math.abs(d.grade - 0.03) < 0.002, 'grade ' + d.grade);
    assert.strictEqual(d.height, 0);
});

test('DSC: a raw sensor that pitched (the value the car sends is pitch-free)', () => {
    const flat = byKey(drive(STAND).results), raw = byKey(drive(STAND, { grade: () => 0.01, source: 'dsc', pitch: 0.015, seed: 6 }).results);
    console.log('       body pitching 1.5% per g, not compensated, 1% rise: 0-100 ' + raw['kmh:0-100'].timeCorr.toFixed(2) + ', 0-200 ' + raw['kmh:0-200'].timeCorr.toFixed(2) +
        ' (level ' + flat['kmh:0-100'].time.toFixed(2) + ', ' + flat['kmh:0-200'].time.toFixed(2) + ')');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
