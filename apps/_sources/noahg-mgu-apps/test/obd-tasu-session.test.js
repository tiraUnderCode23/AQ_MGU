'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pack, matches, createSession, loadSomeip } = require('../native/hu-obd-adapter/tasu-worker');
test('standalone TASU loads the HU native binding when no Node package exists', () => {
    let loaded;
    const binding = { buildProxy() {} };
    assert.equal(loadSomeip('/fixture', () => { const e = new Error('not found'); e.code = 'MODULE_NOT_FOUND'; throw e; }, file => { loaded = file; return binding; }), binding);
    assert.equal(loaded, '/usr/lib/someip.node');
    assert.equal(loadSomeip('/fixture', () => '/fixture/source/node_modules/someip/index.js', file => file), '/fixture/source/node_modules/someip/index.js');
    const failure = new Error('binding ABI/library failure');
    assert.throws(() => loadSomeip('/fixture', () => '/fixture/someip.node', () => { throw failure; }), e => e === failure);
});
const request = uds => pack(1, Buffer.from([0xf4, 0x12].concat(uds))).toString('hex');
function response(session, ecu, uds) {
    const header = Buffer.alloc(9); header[6] = ecu;
    session.reply({errorCode:0,udsResponse:Buffer.concat([header,Buffer.from(uds)])});
}
async function until(predicate) {
    const deadline = Date.now() + 1000;
    while (!predicate()) { if (Date.now() > deadline) throw new Error('session did not progress'); await new Promise(r => setTimeout(r, 5)); }
}

test('TASU serializes connection setup, suppressed tester-present and VIN reads', async t => {
    const events = [], calls = [];
    let session;
    const proxy = {callMethod(name, p) {
        calls.push(p);
        if (p.serviceID === 0x10) setTimeout(() => response(session,0x12,[0x50,3,0,50,1,244]),5);
        if (p.serviceID === 0x22) setTimeout(() => {
            response(session,0x13,[0x62,0xf1,0x90,0]); // other ECU
            response(session,0x12,[0x62,0xf1,0x95,0]); // other DID
            response(session,0x12,[0x7f,0x22,0x78]);
            response(session,0x12,[0x62,0xf1,0x90,1]);
        },5);
        return Promise.resolve('NO_ERROR');
    }};
    session = createSession(proxy,e => events.push(e)); t.after(() => session.stop());
    session.availability(true);
    assert.equal(calls.length,0);
    session.enqueue(request([0x10,3])); session.enqueue(request([0x3e,0x80])); session.enqueue(request([0x22,0xf1,0x90]));
    await until(() => events.filter(e => e.type === 'frame').length === 6);
    assert.deepEqual(calls.map(p => p.serviceID),[0x10,0x3e,0x22]);
    assert(calls.every(p => p.sourceAddress === 0xf2));
    assert(!events.some(e => e.type === 'error'));
    assert(matches([0x50,3],[0x10,0x83]));
    assert(matches([0x7e,0],[0x3e,0x80]));
});

test('TASU buffers early ECU replies until provider accepts and never acknowledges refusal', async t => {
    for (const verdict of ['NO_ERROR','APP_REQUEST_TEMPORARILY_NOT_ACCEPTED']) {
        const events=[]; let session;
        const proxy={callMethod() {response(session,0x12,[0x62,0xf1,0x90,1]);return Promise.resolve(verdict);}};
        session=createSession(proxy,e=>events.push(e), {busyRetryMs:2}); t.after(()=>session.stop());
        session.availability(true);session.enqueue(request([0x22,0xf1,0x90]));
        await until(()=>events.filter(e=>e.type==='frame').length>=2 || events.some(e=>e.type==='error'));
        const frames=events.filter(e=>e.type==='frame').map(e=>Buffer.from(e.hex,'hex').readUInt16BE(4));
        assert.deepEqual(frames,verdict==='NO_ERROR'?[2,1]:[]);
    }
});

test('TASU collects functional replies before releasing the next request', async t => {
    let session;const calls=[];
    const proxy={callMethod(name,p){calls.push(p);setImmediate(()=>response(session,p.targetAddress===0xdf?0x12:p.targetAddress,[0x62,0xf1,0x90,1]));return Promise.resolve('NO_ERROR');}};
    session=createSession(proxy,()=>{}, {quietMs:25});t.after(()=>session.stop());session.availability(true);
    session.enqueue(pack(1,Buffer.from([0xf4,0xdf,0x22,0xf1,0x90])).toString('hex'));
    session.enqueue(request([0x22,0xf1,0x90]));
    await until(()=>calls.length===1);await new Promise(r=>setTimeout(r,5));assert.equal(calls.length,1);
    await until(()=>calls.length===2);
});

test('TASU queue exhaustion stops rather than replaying or growing without bound', t => {
    const events=[];let calls=0;
    const session=createSession({callMethod(){calls++;return Promise.resolve('NO_ERROR');}},e=>events.push(e));t.after(()=>session.stop());
    for(let i=0;i<18;i++)session.enqueue(request([0x22,0xf1,0x90]));
    assert.equal(events.filter(e=>e.type==='error').length,1);assert.equal(calls,0);
});

test('functional replies arriving before a slow provider verdict remain buffered', async t => {
    let session; const events=[];
    const proxy={callMethod(){response(session,0x12,[0x62,0xf1,0x90,1]);return new Promise(r=>setTimeout(()=>r('NO_ERROR'),30));}};
    session=createSession(proxy,e=>events.push(e),{quietMs:5});t.after(()=>session.stop());session.availability(true);
    session.enqueue(pack(1,Buffer.from([0xf4,0xdf,0x22,0xf1,0x90])).toString('hex'));
    await until(()=>events.filter(e=>e.type==='frame').length===2);
    assert(!events.some(e=>e.type==='error'));
    assert.deepEqual(events.filter(e=>e.type==='frame').map(e=>Buffer.from(e.hex,'hex').readUInt16BE(4)),[2,1]);
});

test('TASU read setup and SWE metadata match full echoed identifiers', async t => {
    const events=[],calls=[];let session;
    const proxy={callMethod(name,p){
        calls.push(p);const u=[p.serviceID].concat(Array.from(p.udsData));
        if(u[0]===0x2c){
            response(session,0x12,[0x6c,u[1],0xf3,2]);
            response(session,0x12,[0x6c,u[1],0xf3,1]);
        }else if(u[0]===0x31){
            response(session,0x12,[0x7f,0x31,0x78]);
            response(session,0x12,[0x71,1,2,4,1]);
            response(session,0x12,[0x71,1,2,5,1]);
        }else response(session,0x12,[0x62,0xf3,1,0xa5]);
        return Promise.resolve('NO_ERROR');
    }};
    session=createSession(proxy,e=>events.push(e));t.after(()=>session.stop());session.availability(true);
    session.enqueue(request([0x2c,3,0xf3,1]));
    session.enqueue(request([0x2c,2,0xf3,1,0x24,0x80,0x7f,0xfe,0x50,0,0xff]));
    session.enqueue(request([0x22,0xf3,1]));
    session.enqueue(request([0x31,1,2,5,6,0,0,0x42,0x95,1,45,1]));
    await until(()=>events.filter(e=>e.type==='frame').length===9);
    assert.equal(calls.length,4);
    const uds=events.filter(e=>e.type==='frame').map(e=>Buffer.from(e.hex,'hex')).filter(b=>b.readUInt16BE(4)===1).map(b=>Array.from(b.subarray(8)));
    assert.deepEqual(uds,[[0x6c,3,0xf3,1],[0x6c,2,0xf3,1],[0x62,0xf3,1,0xa5],[0x7f,0x31,0x78],[0x71,1,2,5,1]]);
});

test('TASU preserves the complete observed bootmod3 DME and CustomROM read order', async t => {
    const sequence = [
        'f440310110010a0a43',
        'f4122c03f301', 'f4122c02f30124807ffe5000ff', 'f41222f301',
        'f4122c03f301', 'f4122c02f301240977fe4c00ff', 'f41222f301',
        'f4122c03f301', 'f4122c02f30124801ffdac00ff', 'f41222f301',
        'f4122c03f301', 'f4122c02f301248005fe1e00ff', 'f41222f301',
        'f41222f101', 'f41231010205080000637532dc01',
        'f412310102050600004295012d01', 'f41222f103', 'f41822f101',
        'f412310102050600004295012d01', 'f41222f186', 'f412224098',
        'f41222f103', 'f412310102050600004295012d01',
        'f4122c03f301', 'f4122c02f30124807ffe5000ff', 'f41222f301',
        'f4122c03f301', 'f4122c02f301240977fe4c00ff', 'f41222f301',
        'f4122c03f301', 'f4122c02f30124801ffdac00ff', 'f41222f301',
        'f4122c03f301', 'f4122c02f301248005fe1e00ff', 'f41222f301',
        'f41231010205080000637532dc01', 'f412310102050600004295012d01'
    ];
    const events = [], calls = [];
    let session;
    const proxy = { callMethod(name, p) {
        calls.push(p);
        const requestUds = [p.serviceID].concat(Array.from(p.udsData));
        let replyUds;
        if (p.serviceID === 0x2c) replyUds = [0x6c].concat(requestUds.slice(1, 4));
        else if (p.serviceID === 0x31 && p.targetAddress === 0x40) replyUds = [0x7f, 0x31, 0x31];
        else if (p.serviceID === 0x31) replyUds = [0x71, 1, 2, 5, 0];
        else replyUds = [0x62].concat(requestUds.slice(1, 3), [0xa5]);
        setImmediate(() => response(session, p.targetAddress, replyUds));
        return Promise.resolve('NO_ERROR');
    } };
    session = createSession(proxy, event => events.push(event));
    t.after(() => session.stop());
    session.availability(true);
    for (let index = 0; index < sequence.length; index++) {
        const before = events.filter(event => event.type === 'frame').length;
        session.enqueue(pack(1, Buffer.from(sequence[index], 'hex')).toString('hex'));
        await until(() => events.filter(event => event.type === 'frame').length === before + 2);
    }
    assert.equal(calls.length, sequence.length);
    assert.deepEqual(calls.map(call => Buffer.concat([
        Buffer.from([0xf4, call.targetAddress, call.serviceID]), call.udsData
    ]).toString('hex')), sequence);
    assert(calls.every(call => call.sourceAddress === 0xf2 && call.udsDataLength === call.udsData.length));
    assert(!events.some(event => event.type === 'error'));
});

test('temporarily unaccepted TASU requests retry with one acknowledgement after acceptance', async t => {
    const events = [], calls = [];
    let session;
    const proxy = { callMethod(name, parameters) {
        calls.push(parameters);
        if (calls.length < 3) {
            response(session, 0x12, [0x62, 0xf1, 0x90, 0]);
            return Promise.resolve({ TasuErrorEnum: 'APP_REQUEST_TEMPORARILY_NOT_ACCEPTED' });
        }
        response(session, 0x12, [0x62, 0xf1, 0x90, 1]);
        return Promise.resolve({ TasuErrorEnum: 'NO_ERROR' });
    } };
    session = createSession(proxy, event => events.push(event), { busyRetryMs: 2 });
    t.after(() => session.stop());
    session.availability(true);
    session.enqueue(request([0x22, 0xf1, 0x90]));
    await until(() => events.filter(event => event.type === 'frame').length === 2);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(calls[1], calls[2]);
    const frames = events.filter(event => event.type === 'frame').map(event => Buffer.from(event.hex, 'hex'));
    assert.equal(frames[0].readUInt16BE(4), 2);
    assert.deepEqual(Array.from(frames[1].subarray(8)), [0x62, 0xf1, 0x90, 1]);
    assert(!events.some(event => event.type === 'error'));
});

test('stopping during a TASU busy backoff cancels further calls', async t => {
    let calls = 0;
    const session = createSession({ callMethod() {
        calls++;
        return Promise.resolve({ TasuErrorEnum: 7 });
    } }, () => {}, { busyRetryMs: 20 });
    t.after(() => session.stop());
    session.availability(true);
    session.enqueue(request([0x22, 0xf1, 0x90]));
    await until(() => calls === 1);
    session.stop();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(calls, 1);
});

test('an accepted TASU request is never retried and pending provider events are preserved', async t => {
    const events = [];
    let calls = 0, session;
    session = createSession({ callMethod() {
        calls++;
        setImmediate(() => {
            session.reply({ errorCode: 'REQUEST_PENDING' });
            response(session, 0x12, [0x7f, 0x22, 0x78]);
            response(session, 0x12, [0x62, 0xf1, 0x90, 1]);
        });
        return Promise.resolve({ TasuErrorEnum: 'REQUEST_PENDING' });
    } }, event => events.push(event));
    t.after(() => session.stop());
    session.availability(true);
    session.enqueue(request([0x22, 0xf1, 0x90]));
    await until(() => events.filter(event => event.type === 'frame').length === 3);
    assert.equal(calls, 1);
    assert(!events.some(event => event.type === 'error'));
});

test('missing or unknown provider verdicts never become diagnostic acknowledgements', async t => {
    for (const verdict of [undefined, {}, { TasuErrorEnum: 42 }, { TasuErrorEnum: 'UNKNOWN' }]) {
        const events=[];
        const session=createSession({callMethod(){return Promise.resolve(verdict);}},e=>events.push(e));
        t.after(()=>session.stop());session.availability(true);session.enqueue(request([0x22,0xf1,0x90]));
        await until(()=>events.some(e=>e.type==='error'));
        assert.equal(events.find(e=>e.type==='error').code,'method_verdict_invalid');
        assert.equal(events.filter(e=>e.type==='frame').length,0);
    }
});

test('native trace reports accepted requests, mismatched event metadata and matches without payload data', async t => {
    const events=[];let session;
    session=createSession({callMethod(){
        response(session,0x40,[0x62,0xf1,0x90].concat(Array.from(Buffer.from('WBA12345678901234'))));
        response(session,0x12,[0x62,0xf1,0x95,0]);
        response(session,0x12,[0x62,0xf1,0x90].concat(Array.from(Buffer.from('WBA12345678901234'))));
        return Promise.resolve({TasuErrorEnum:0});
    }},e=>events.push(e));t.after(()=>session.stop());session.availability(true);session.enqueue(request([0x22,0xf1,0x90]));
    await until(()=>events.filter(e=>e.type==='frame').length===2);
    const trace=events.filter(e=>e.type==='tasu_trace');
    assert.equal(trace.filter(e=>e.stage==='event').length,3);
    assert(trace.some(e=>e.stage==='verdict'&&e.code==='NO_ERROR'));
    assert(trace.some(e=>e.stage==='other_ecu'));
    assert(trace.some(e=>e.stage==='other_reply'));
    assert(trace.some(e=>e.stage==='matched'));
    assert(!JSON.stringify(trace).includes('WBA12345678901234'));
    assert(trace.every(e=>!('hex' in e)&&!('uds' in e)&&!('data' in e)));
});
