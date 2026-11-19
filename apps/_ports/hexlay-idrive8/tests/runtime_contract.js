'use strict';
// Offline contract tests: SDK, files, native binding and renderer are inert mocks.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {EventEmitter} = require('events');
const PORT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const BASE = path.resolve(process.argv[3] || path.join(PORT, '../../_sources/hexlay-idrive7-apps'));
const RUNTIME = path.join(PORT, 'kit/runtime');
let checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks++; };
const eq = (a, b, label) => { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), label); checks++; };
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); await new Promise(setImmediate); };
const quiet = () => ({info(){},warn(){},error(){},debug(){}});
function load(file, requireFn, extra) {
    const context = {module:{exports:{}}, exports:{}, require:requireFn, __dirname:path.dirname(file),
        Buffer, Promise, Map, Set, Date, Math, Number, String, Object, Array, JSON,
        setTimeout, clearTimeout, setImmediate, setInterval, clearInterval,
        process:{env:{}, pid:1, cwd:()=>'/inert/data', on(){}, exit(){throw Error('exit not allowed');}, memoryUsage:()=>({rss:0})},
        ...extra};
    vm.runInNewContext(fs.readFileSync(file,'utf8'), context, {filename:file,timeout:3000});
    return context.module.exports;
}
const lifecycle = load(path.join(RUNTIME,'id8_lifecycle.js'), name=>{throw Error(name);});
async function testLifecycleHelper() {
    const events=[];
    const state={updateResources:async()=>events.push('resources')};
    const wrapper={getDescription:()=>({uuid:'synthetic-entry',textId:'synthetic-text',icon:'synthetic.png'}),
        init:async()=>events.push('init'), entryPoint:{setText:async()=>events.push('text'),setIcon:async()=>events.push('icon')},
        setAvailability:async value=>events.push(value)};
    const ids=await lifecycle.entryPoints({getEntryPoints:()=>[wrapper]}, {mapEntryState:async uuid=>events.push('map:'+uuid)},state,['synthetic-entry'],quiet());
    eq(ids,['synthetic-entry'],'entry IDs retained');
    eq(events,['resources','init','map:synthetic-entry','text','icon','ENABLED'],'resource/init/map/appearance/enable order');
    events.length=0;
    await lifecycle.entryPoints({getEntryPoints:()=>[{getDescription:()=>({uuid:'unrelated'})}]}, {mapEntryState:async uuid=>events.push(uuid)},state,['synthetic-entry'],quiet());
    eq(events,['resources','synthetic-entry'],'unrelated SDK wrapper does not suppress fallback');
    for (const value of [false,0,'0','false',null,undefined]) ok(!lifecycle.truth(value),'false event coerces safely');
    for (const value of [true,1,'1','true']) ok(lifecycle.truth(value),'true event coerces safely');
    ok(lifecycle.foreground({startReason:'BACKGROUND',getVisibilityData:()=>({reason:'ENTRY_POINT'})}),'visibility reason can establish foreground');
    ok(!lifecycle.foreground({startReason:'BACKGROUND'}),'background stays background');
}
function runtime(id8, sdk, reason, noRhmi) {
    const events=[], cells=[], states={};
    const spec=JSON.parse(fs.readFileSync(path.join(PORT,'apps/sys_monitor/app.json'),'utf8'));
    const named=['MAIN','SETTINGS','MAIN_GFX','BTN_PAGE','BTN_SETTINGS',...spec.settings.map(s=>'SET_'+s.key.toUpperCase())];
    if (id8) named.push('KIT_HMI_ID8');
    for (const name of named) {
        const c=states[name]=new EventEmitter();
        c._uiDescription={type:name==='MAIN_GFX'?'label':'button',rows:[name==='MAIN_GFX'?{}:id8?{PrimaryText:{},FrequencyText:{}}:{Text:{},Text1stRow:{},Text2ndRow:{}}]};
        c.updateResources=async()=>events.push('resources:'+name);
        c.getId=()=>name==='MAIN'?1:9;
        c.setValue=async(...args)=>cells.push([name,...args]);
        c.setRowCount=async()=>{}; c.setProperty=async()=>{};
    }
    const rhmi=new EventEmitter();
    rhmi.getByName=name=>states[name];
    rhmi.mapEntryState=async uuid=>events.push('map:'+uuid);
    rhmi.openEntryState=async uuid=>events.push('open:'+uuid);
    rhmi.openState=async name=>events.push('state:'+name);
    rhmi.closeState=async()=>{};
    let app;
    class OnlineApp extends EventEmitter {
        constructor(){super();app=this;this.startReason=reason;this.rhmiApplication=noRhmi?null:rhmi;this.appDescription={application:{entryPoints:[{uuid:'synthetic-entry'}]}};}
        async start(){events.push('start');this.emit('appStatusProxyReady');}
        async registerActive(){events.push('active');}
        async initialized(){events.push('initialized');}
        getLastExecutedEntryPointUuid(){return null;}
        getVisibilityData(){return {reason:this.startReason};}
        getEntryPoints(){return [{getDescription:()=>({uuid:'synthetic-entry',textId:'t'}),init:async()=>events.push('entry-init'),setAvailability:async()=>events.push('enabled')}];}
        async registerHmiVisible(){events.push('visible');}
        async unregisterHmiVisible(){events.push('hidden');}
    }
    class Display {
        constructor(ui){this.ui=ui;this.sheet=null;this.ready=true;}
        label(){} openSheet(sheet){this.sheet=sheet;events.push('touch-settings');return this.ready;}
        closeSheet(){this.sheet=null;} onLayout(){} onTick(){}
    }
    const inertFs={existsSync:()=>false,readFileSync:file=>{
        if (file.endsWith('app-spec.json')) return JSON.stringify(spec);
        if (file.endsWith('rhmiData/application.json')) return JSON.stringify({application:{entryPoints:[{uuid:'synthetic-entry'}]}});
        throw Error('mock file absent');
    },readdirSync:()=>[],unlinkSync(){},appendFileSync(){},writeFileSync(){},renameSync(){}};
    const signalMock={allowTyped:value=>events.push('typed:'+value)};
    const imports={'fs':inertFs,'path':path,'oap-sdk':{OnlineApp,logging:{getSDKLogger:quiet}},
        'oap-sdk/package.json':{version:sdk},'./themes':{theme:()=>({})},'./display':{Display},
        './hmi-text':{HmiText:class {set(c,n,r,key,value){cells.push([n,key,value]);return Promise.resolve();}}},
        './sheet':{listSheet:()=>({})},'./uplink':{init(){},describe:()=>''},'./signals':signalMock,'./id8_lifecycle':lifecycle};
    const mod=load(path.join(RUNTIME,'mgu.js'),name=>{if(name in imports)return imports[name];throw Error('unexpected import '+name);});
    return {run:mod.run,events,cells,states,rhmi,get app(){return app;}};
}
async function testRuntime() {
    const run=runtime(true,'50.1.0','ENTRY_POINT',false);
    const ctx=await run.run({start:async()=>run.events.push('app-start')}); await flush();
    ok(ctx.ui.id8,'loaded marker selects ID8');
    ok(run.events.indexOf('active')>run.events.indexOf('app-start'),'ID8 ACTIVE is deferred to foreground init');
    ok(run.events.indexOf('active')<run.events.indexOf('initialized'),'ACTIVE precedes initialized');
    ok(run.events.includes('open:synthetic-entry'),'cold entry opens declared UUID without a last-executed SDK value');
    run.app.emit('entryPointExecute','synthetic-entry','ENTRY_POINT','test'); await flush();
    ok(run.events.filter(e=>e==='open:synthetic-entry').length===2,'actual entryPointExecute callback opens entry');
    run.states.BTN_SETTINGS.emit('action',{}); await flush();
    ok(run.events.includes('touch-settings')&&!run.events.includes('state:SETTINGS'),'Settings callback uses touch sheet');
    run.states.BTN_SETTINGS.emit('action',{}); await flush();
    ctx.display.ready=false; run.states.BTN_SETTINGS.emit('action',{}); await flush();
    ok(run.events.includes('state:SETTINGS'),'unavailable renderer retains native ID8 settings');
    const before=ctx.settings.get('interval'); run.states.SET_INTERVAL.emit('action',{}); await flush();
    ok(ctx.settings.get('interval')!==before,'ID8 number setting cycles via action');
    ok(run.cells.some(c=>c[0]==='SET_INTERVAL'&&c[1]==='FrequencyText'),'ID8 values use FrequencyText');
    run.states.MAIN.emit('visible',{visible:'false'}); ok(!ctx.ui.isVisible('MAIN'),'string false does not show canvas');
    run.states.MAIN.emit('visible',{visible:'1'}); ok(ctx.ui.isVisible('MAIN'),'string one shows canvas');
    run.states.MAIN.emit('focus',{focus:'false'}); ok(!ctx.ui.hasFocus('MAIN'),'popup hides canvas focus');
    run.rhmi.emit('applicationStackChanged',{ROOT_APP:[1]}); ok(ctx.ui.isVisible('MAIN')&&ctx.ui.hasFocus('MAIN'),'ROOT_APP foreground restores canvas');
    run.app.emit('changeVisibility',{visible:false}); ok(!ctx.ui.isVisible('MAIN'),'visibility exit hides canvas');
    await ctx.ui._image('MAIN_GFX',Buffer.from('not-an-image'));
    ok(!run.cells.some(c=>c.includes('Graphic')),'ID8 never sends unsupported Graphic images');
    ok(run.cells.some(c=>c[0]==='MAIN_GFX'&&c[1]==='Text'&&/renderer/.test(c[2])),'empty-row label retains Text and shows renderer requirement');
    const bg=runtime(true,'50.1.0','BACKGROUND',true);
    await bg.run({}); eq(bg.events,['start','initialized'],'ID8 background without RHMI initializes without ACTIVE');
    const idle=runtime(true,'50.1.0','BACKGROUND',false); await idle.run({});await flush();
    ok(!idle.events.includes('active')&&!idle.events.some(e=>e.startsWith('open:')),'background with RHMI is not forced foreground');
    const old=runtime(false,'50.1.0','ENTRY_POINT',false); const oldctx=await old.run({}); await flush();
    ok(!oldctx.ui.id8&&old.events.includes('active')&&old.events.includes('typed:false'),'actual ID7 resources override SDK-major hint');
    ok(old.cells.some(c=>c[0]==='SET_INTERVAL'&&c[1]==='SelectedItem'),'ID7 dropdown semantics retained');
}
function displayClass(root) {
    class Recorder {textWidth(text){return String(text).length*10;}}
    const imports={'./record':{Recorder,play(){}},'./canvas':{Canvas:class {}},'./renderd':{RenderClient:class{}},
        './gauges':{},'./credits':{drawCredit(){}},'./panel':{}};
    return load(path.join(root,'kit/runtime/display.js'),name=>{if(name in imports)return imports[name];throw Error(name);},
        {setInterval:()=>1,clearInterval(){}}).Display;
}
function displayFixture(C,id8,screen,area) {
    const events=[],d=Object.create(C.prototype),vis={MAIN:true,SETTINGS:false};
    Object.assign(d,{ui:{id8,isVisible:n=>!!vis[n],hasFocus:()=>true,visible:(n,v)=>events.push(['row',n,v])},
        gpu:{ready:true,native:true,touch:true,info:{controller:false},screen,area,place:p=>events.push(['place',p]),grab:v=>events.push(['grab',v]),show:v=>events.push(['show',v]),claim:r=>events.push(['claim',r])},
        settings:{get:k=>k==='layout'?'standard':null},log:quiet(),screen:{name:'MAIN',buttons:[['BTN_PAGE','Next page'],['BTN_SETTINGS','Settings']]},
        recorders:new Map(),layoutHandlers:[],tickHandlers:[],labels:{},ownHidden:new Set(),headEnd:400,barOff:0,chromeK:()=>1,
        _paintSheet(){events.push(['paint-sheet']);},_repaint(){},_click:n=>events.push(['click',n])});
    return {d,events,vis};
}
async function testDisplay() {
    const C=displayClass(PORT), Old=displayClass(BASE);
    const a=displayFixture(C,false,{w:1920,h:720});const b=displayFixture(Old,false,{w:1920,h:720});
    a.d._place();b.d._place();eq(a.d.place,b.d.place,'ID7 standard placement unchanged');eq(a.d.geo(),b.d.geo(),'ID7 geometry unchanged');
    for(const area of [undefined,{x:120,y:90,w:2700,h:740}]) {
        const {d,events}=displayFixture(C,true,{w:2880,h:960},area);d._place();
        const want=area||{x:0,y:76,w:2880,h:764};
        eq([d.place.x,d.place.y,d.place.w,d.place.h],[want.x,want.y,want.w,want.h],'ID8 overlay respects reported or known app area');
        eq(d.layout(),'full','stale ID7 standard preference cannot change ID8 geometry');
        ok(d.own()&&!d.gpu.info.controller,'touch ownership does not require controller gate');
        ok(events.some(e=>e[0]==='grab'&&e[1]===false),'missing controller capability is respected');
        eq(d.buttons(),[],'ID7 pager/settings bar is removed when ID8 touch header owns controls');
        d._openTab(d._tabList().settings);ok(events.some(e=>e[0]==='click'&&e[1]==='BTN_SETTINGS'),'actual header Settings tab invokes button callback');
        ok(d.openSheet({settings:true}),'actual touch sheet works without controller');
        d._claimTabs([],null);
        const rects=events.filter(e=>e[0]==='claim').pop()[1];
        for(const r of rects) {
            const x=r.x*d.place.scale+d.place.ox,y=r.y*d.place.scale+d.place.oy;
            ok(x>=-0.01&&y>=-0.01&&x+r.w*d.place.scale<=d.place.w+0.01&&y+r.h*d.place.scale<=d.place.h+0.01,'touch claim remains inside local app area');
        }
    }
    for(const [screen,area] of [[{w:2560,h:960},undefined],[{w:2880,h:960},{x:-1,y:76,w:2880,h:764}]]) {
        const {d,events}=displayFixture(C,true,screen,area); d._place();d._syncVisible();
        ok(d.place===null&&!events.some(e=>e[0]==='show'&&e[1]===true),'unknown/invalid area cannot show overlay');
        ok(events.some(e=>e[0]==='row'&&e[2]===true),'native ID8 rows stay accessible without a usable placement');
    }
    const {d,events,vis}=displayFixture(C,true,{w:2880,h:960});d._place();vis.SETTINGS=true;
    ok(!d._shown(),'native Settings takes priority over canvas');
    d.gpu.touch=false;d._syncVisible();ok(events.slice(-1)[0][1]===false,'renderer without touch cannot show inaccessible canvas');
}
function signalModule({native,config,typed,failSdk,timers}={}) {
    const events=[];
    const imports={'fs':{readFileSync(){if(config)return JSON.stringify({fields:{sample:{getter:true}}});throw Error('no config');}},'path':path};
    if(native) imports.someip={buildProxy:async()=>{events.push('raw');return native;}};
    imports['oap-sdk']={someipBuilders:{buildAndInitTypedProxy:async(iface,inst)=>{events.push(['typed',iface,inst]);if(failSdk)throw Error('synthetic SDK failure');return typed;}}};
    const mod=load(path.join(RUNTIME,'signals.js'),name=>{if(name in imports)return imports[name];throw Error('mock module absent '+name);},
        timers?{setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){}}:undefined);
    return {mod,events};
}
async function testSignals() {
    let rawShutdown=0,typedShutdown=0,reads=[];
    const raw={init:async()=>{},subscribe:async()=>{},subscribeToAvailability:fn=>fn(true),isAvailable:()=>true,
        getValue:async()=>11,shutdown:async()=>{rawShutdown++;}};
    let s=signalModule({native:raw,config:true});s.mod.allowTyped(true,quiet());
    const sub=await s.mod.watch('example.synthetic.Sensor','1',{sample:v=>reads.push(v)},quiet(),{pollMs:1000});await flush();await sub.shutdown();
    eq(s.events,['raw'],'native+config keeps original raw backend');ok(reads.includes(11)&&rawShutdown===1,'raw getters and shutdown preserved');
    const typed={sample:{getValue:async()=>22,subscribe:async fn=>fn(23)},echo:async p=>({echo:p}),
        subscribeToAvailability:fn=>fn(true),isAvailable:()=>true,shutdown:async()=>{typedShutdown++;}};
    s=signalModule({typed});
    let off=await s.mod.watch('example.synthetic.Sensor','1',{},quiet());ok(!!off.error&&!s.events.length,'typed fallback is disabled by default');
    s.mod.allowTyped(true,quiet());reads=[];
    const ts=await s.mod.watch('example.synthetic.Sensor','1',{sample:v=>reads.push(v)},quiet(),{pollMs:1000});await flush();
    ok(ts.available&&reads.includes(22)&&reads.includes(23),'typed getter/subscription contract delivers inert values');
    eq(await s.mod.call(ts.proxy,'echo',{value:7}),{echo:{value:7}},'typed methods retain argument structs');
    let error;try{await s.mod.call(ts.proxy,'absent',{});}catch(e){error=e;}
    ok(error&&/no method absent/.test(error.message),'missing typed method fails explicitly');
    await ts.shutdown();ok(typedShutdown===1,'typed shutdown is forwarded when available');
    eq(s.mod.backends()['example.synthetic.Sensor'],'typed','backend choice is observable');
    const failed=signalModule({failSdk:true});failed.mod.allowTyped(true,quiet());
    const miss=await failed.mod.watch('example.synthetic.Missing','1',{},quiet());
    ok(!!miss.error&&!miss.available&&/synthetic SDK failure/.test(miss.error),'SDK failure is surfaced without inventing data');
    const nativeNoConfig=signalModule({native:raw,typed});nativeNoConfig.mod.allowTyped(true,quiet());
    const fallback=await nativeNoConfig.mod.proxy('example.synthetic.Sensor','1');
    ok(fallback.typed&&nativeNoConfig.events[0][0]==='typed','missing raw config selects allowed typed path');
    await fallback.shutdown();
    let failRead=true;const timers=[];
    const recovering=signalModule({timers,typed:{sample:{subscribe:async()=>{},getValue:async()=>{if(failRead)throw Error('getter failed');return 44;}}}});
    recovering.mod.allowTyped(true,quiet());
    const recovery=await recovering.mod.watch('example.synthetic.Recovery','1',{sample(){}},quiet(),{pollMs:1000});await flush();
    ok(!recovery.available&&/getter failed/.test(recovery.error),'fresh getter failure is visible as unavailable');
    failRead=false;timers[0]();await flush();
    ok(recovery.available&&recovery.error===null,'polling recovers only after fresh getter succeeds');
    await recovery.shutdown();
}
async function testReadGuard() {
    let clock=100000;const handlers={};
    const FakeDate=class extends Date {static now(){return clock;}};
    const Car=load(path.join(RUNTIME,'car.js'),name=>{if(name==='./sim')return class {sample(){return {};}};throw Error(name);},
        {Date:FakeDate,setInterval:()=>1,clearInterval(){}});
    const ctx={log:quiet(),spec:{config:{}},settings:{get:()=> 'off'},signals:{watch:async(iface,inst,fields)=>{handlers[iface]=fields;return {iface,available:true,error:null,shutdown:async()=>{}};}}};
    const car=new Car(ctx,['rpm','condition']);await flush();
    const guard=load(path.join(PORT,'apps/m_copilot/id8_read_guard.js'),name=>{throw Error(name);});
    ok(!guard(car,clock).ok,'unknown initial state blocks ID8 reads');
    const cds='de.bmw.infotainment.vehicle.CDS',condition='de.bmw.infrastructure.VehicleCondition';
    handlers[cds].statusEngineSpeed2({actualValueRPMEngineCrankshaft:2400});
    handlers[condition].VehicleCondition({statusConditionVehicle:7});
    ok(guard(car,clock).ok,'fresh valid state and providers permit the existing read path');
    clock+=6000;ok(!guard(car,clock).ok,'cached state is rejected after freshness budget');
    handlers[cds].statusEngineSpeed2({actualValueRPMEngineCrankshaft:2400});
    handlers[condition].VehicleCondition({statusConditionVehicle:8});
    ok(!guard(car,clock).ok,'transition state blocks reads');
    handlers[condition].VehicleCondition({statusConditionVehicle:7});
    handlers[cds].statusEngineSpeed2({actualValueRPMEngineCrankshaft:65535});
    ok(!guard(car,clock).ok,'invalid new sample invalidates old valid timestamp');
    handlers[cds].statusEngineSpeed2({actualValueRPMEngineCrankshaft:2400});
    car.subs[0].available=false;ok(!guard(car,clock).ok,'provider loss blocks even recent cached state');
    car.subs[0].available=true;car.demoActive=true;ok(!guard(car,clock).ok,'demo state never authorizes reads');
    car.demoActive=false;ok(guard(car,clock).ok,'fresh live state recovers');
    car.stop();
    const main=fs.readFileSync(path.join(PORT,'apps/m_copilot/main.js'),'utf8');
    const start=main.indexOf('        function steady() {'),end=main.indexOf('        /** Up to waitMs',start);
    const steadySource=main.slice(start,end);
    const guardContext={ui:{id8:true},car:null,require:name=>{assert.strictEqual(name,'./id8_read_guard');return guard;},
        Date:FakeDate,statusMsg:null,statusTime:0,telemetry:{condition:7,rpm:600,engineSnap:{}},id8StateFailure:null,log:quiet(),takeCar(){throw Error('stale state must not be copied');}};
    vm.runInNewContext(steadySource+'; result=steady();',guardContext);
    ok(guardContext.result===false&&/unavailable/.test(guardContext.statusMsg)&&guardContext.telemetry.rpm===null,'actual steady branch fails closed and displays unavailable');
}
(async()=>{await testLifecycleHelper();await testRuntime();await testDisplay();await testSignals();await testReadGuard();console.log(JSON.stringify({checks,status:'PASS',scope:'synthetic SDK/renderer/signals and pure read guard; no vehicle or whole application executed'}));})().catch(error=>{console.error(error.stack);process.exitCode=1;});
