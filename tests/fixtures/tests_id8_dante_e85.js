'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.argv[2], scenario = process.argv[3], port = path.join(root, 'apps/_ports/dante-idrive8');
const flush = async () => { for(let i=0;i<25;i++) await new Promise(setImmediate); };
function clock() {
    let n=0; const c={now:1700000000000,timers:new Map()};
    c.Date=class extends Date { static now(){return c.now;} };
    c.setInterval=(fn,ms)=>{c.timers.set(++n,{fn,ms});return n;};c.clearInterval=(id)=>c.timers.delete(id);
    c.setTimeout=c.setInterval;c.clearTimeout=c.clearInterval;return c;
}
function load(file, deps, c) {
    const module={exports:{}};
    vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,__dirname:path.dirname(file),Date:c.Date,Buffer,setImmediate,
        setInterval:c.setInterval,clearInterval:c.clearInterval,setTimeout:c.setTimeout,clearTimeout:c.clearTimeout,
        require(name){if(!(name in deps))throw new Error('Forbidden import: '+name);return deps[name];}}, {filename:file});return module.exports;
}
const log={info(){},warn(){},error(e){throw new Error(e);}};
function context(c) {
    const subs=[], handlers=[], changes=[], visibleFns=[], events={};let visible=true;
    const spec=JSON.parse(fs.readFileSync(path.join(port,'apps/e85/app.json')));
    const values=Object.fromEntries(spec.settings.map((s)=>[s.key,s.default]));
    const ctx={log,ui:{id8:true,isVisible(n){return visible&&n==='MAIN';},onVisible(fn){visibleFns.push(fn);}},
        settings:{get(k){return values[k];},set(k,v){values[k]=v;changes.forEach((fn)=>fn(k,v));},onChange(fn){changes.push(fn);}},
        app:{on(name,fn){(events[name]||(events[name]=[])).push(fn);}}, signals:{watch(){throw new Error('Legacy/diagnostic transport forbidden');}}};
    const reader={watch(iface,instance,fields,lg,opts){
        assert.strictEqual(iface,'de.bmw.infotainment.KombiIF');assert.strictEqual(instance,'1');assert.strictEqual(opts.pollMs,2000);
        assert.deepStrictEqual(Object.keys(fields),['statusRangeTankStatus']);
        const sub={available:false,availabilityGeneration:0,closed:false,fresh(){return this.available&&!this.closed;},shutdown(){this.closed=true;}};
        subs.push(sub);handlers.push(fields);return Promise.resolve(sub);
    }};
    const legacy=load(path.join(port,'apps/e85/tank.js'),{},c);
    const impl=load(path.join(port,'apps/e85/tank_id8.js'),{'./tank':legacy,'./kit/readonly_signals':{forHmi(h){assert.strictEqual(h,'ID8');return reader;}}},c);
    return {ctx,subs,handlers,values,impl,legacy,
        emit(v,km=12345){const i=subs.length-1;subs[i].available=true;handlers[i].statusRangeTankStatus({fluidLevelFuelTank:v,mileageKilometre:km});},
        visible(v){visible=v;visibleFns.forEach((fn)=>fn('MAIN',v));},shutdown(){(events.shutdown||[]).forEach((fn)=>fn());}};
}
async function tank(){
    const c=clock(),h=context(c), t=new h.impl.TankID8(h.ctx);await flush();
    assert.strictEqual(t.now(c.now),null);assert.throws(()=>t._reader(),/unavailable/);
    for(let i=0;i<3;i++){h.emit(31);t.tick(c.now);t.now(c.now);c.now+=2000;}
    const r=t.now(c.now);assert(r&&r.settled);assert.strictEqual(r.v,31);assert.strictEqual(r.dme,null);assert.strictEqual(t.odo,12345);
    h.subs[0].available=false;assert.strictEqual(t.now(c.now),null);assert.strictEqual(t.odo,null);
    h.subs[0].availabilityGeneration++;h.emit(10);assert.strictEqual(t.now(c.now).v,10);assert.strictEqual(t.now(c.now).settled,false,'recovery resets old median/hold');
    h.emit(255);assert.strictEqual(t.now(c.now),null);assert.strictEqual(t.odo,null);
    h.emit(NaN);assert.strictEqual(t.now(c.now),null);
    h.emit(30,null);assert.strictEqual(t.odo,null,'no invented odometer');
    c.now+=6001;assert.strictEqual(t.now(c.now),null);h.emit(30);c.now--;assert.strictEqual(t.now(c.now),null);
    h.visible(false);await flush();assert(h.subs[0].closed);
    h.visible(true);await flush();assert.strictEqual(h.subs.length,2);
    h.handlers[0].statusRangeTankStatus({fluidLevelFuelTank:60,mileageKilometre:999});assert.strictEqual(t.now(c.now),null,'late old subscription ignored');
    h.ctx.settings.set('id8TankInput','manual');await flush();assert(h.subs[1].closed);assert.strictEqual(t.now(c.now),null);
    h.ctx.settings.set('id8TankInput','kombi');await flush();assert.strictEqual(h.subs.length,3);
    h.visible(true);h.shutdown();await flush();assert.strictEqual(h.subs.length,3);assert(h.subs[2].closed);
    assert.strictEqual(await t.ask(),null);assert.strictEqual(t.dme,null);
}
async function main(){
    const c=clock(),h=context(c), clicks={},buttons=new Map(),texts=[],tags=[],writes=[];let entry,frame;
    const cv=new Proxy({text(t,x,y,size){texts.push(String(t));return String(t).length*Number(size||12)/2;},textWidth(t,size){return String(t).length*size/2;}},
        {get(o,k){return k in o?o[k]:()=>cv;}});
    const gauges={BOTTOM:14,panel(cv,t,x,y,w,h){return {x,y,w,h};},toMargin(){return 0;},pageBottom(){return 520;},
        frame(cv,t,pages,page,badges){tags.push(...badges.filter(Boolean).map((b)=>b.text));},
        button(cv,t,x,y,w,h,label,fn,opts){buttons.set(opts.key,{label,fn,opts});}};
    const blend=load(path.join(port,'apps/e85/blend.js'),{},c);
    Object.assign(h.ctx,{dataDir:'/in-memory',theme(){return {dim:'#aaa',text:'#fff',warn:'#f00',accent:'#0ff'};},
        canvas(){return cv;},onTab(){},hideButton(){},loop(name,fps,fn){frame=fn;}});
    Object.assign(h.ctx.ui,{onClick(name,fn){clicks[name]=fn;},async image(){}});
    load(path.join(port,'apps/e85/main.js'),{path,fs:{readFileSync(){return JSON.stringify({setup:true,book:{known:true,e:0.10},lastV:30,prices:{98:2}});},
        writeFileSync(file,data){writes.push(JSON.parse(data));}},'./kit/mgu':{run(x){entry=x;}},'./kit/canvas':{withAlpha(x){return x;}},
        './kit/gauges':gauges,'./blend':blend,'./tank':{Tank:class{constructor(){throw new Error('ID8 constructed legacy DME tank');}}},'./tank_id8':h.impl},c);
    await entry.start(h.ctx);await flush();await frame();
    assert(texts.some((t)=>/Kombi unavailable/.test(t)));assert(buttons.get('ftop').opts.busy);
    c.now+=7000;await frame();assert(!tags.includes('DEMO'),'auto demo cannot replace missing live input');
    h.ctx.settings.set('id8TankInput','manual');h.ctx.settings.set('id8ManualLitres',30);await flush();await frame();
    assert(tags.includes('MANUAL TANK'));assert(texts.some((t)=>/DME unavailable/.test(t)));assert(!buttons.get('ftop').opts.busy);
    await buttons.get('ftop').fn();await flush();await frame();assert(buttons.has('done'));
    await buttons.get('done').fn();await flush();await frame();
    assert(writes.length>0);const guided=writes[writes.length-1].book.log[0];assert(guided.litres>0);assert(!('km' in guided));
    assert(h.values.id8ManualLitres>30,'recorded manual pours update explicit calculator volume');
    await clicks.BTN_PAGE();await frame();
    const before=writes[writes.length-1].book.log.length;
    // Manual litre logging and price work without a live tank/odometer provider.
    await buttons.get('l5').fn();await frame();await buttons.get('book').fn();await frame();
    const last=writes[writes.length-1].book.log[0];assert.strictEqual(last.litres,10);assert.strictEqual(last.cost,20);assert(!('km' in last));
    assert.strictEqual(writes[writes.length-1].book.log.length,before+1);
    const measured=Array.from(buttons.values()).find((b)=>/^Start filling/.test(b.label));
    assert(measured);await measured.fn();await frame();assert(texts.some((t)=>/Measured fill needs a current Kombi/.test(t)));
    assert(!writes[writes.length-1].book.track,'manual data never becomes a measured fill');
    h.shutdown();await flush();assert.strictEqual(c.timers.size,0);
}
async function math(){
    const m=require(path.join(port,'apps/e85/blend.js'));
    for(const v of [0,10,30,55])for(const e of [0,0.1,0.3]){
        const p=m.fullTank(v,e,0.3,0.85,0,59);assert(Math.abs(p.e85+p.p98-(59-v))<1e-9);
        const actual=(v*e+p.e85*0.85)/59;assert(Math.abs(actual-p.after)<1e-9);
    }
    const b=new m.Book({e:0.1,known:true});b.refuel({fuel:'E85',litres:10,vAfter:40,eFuel:0.85,price:1.6});
    assert.strictEqual(b.log[0].cost,16);assert.strictEqual(b.e,0.2875);b.undo();assert.strictEqual(b.e,0.1);
    b.trackStart('98',30);b.trackDone();assert.strictEqual(b.trackFeed({v:null,settled:false},0),null);
    assert.strictEqual(b.trackFeed({v:40,settled:false},0),null);assert(b.trackFeed({v:40,settled:true},0));
}
({tank,main,math}[scenario])().then(()=>process.stdout.write('PASS '+scenario+'\n')).catch((e)=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
