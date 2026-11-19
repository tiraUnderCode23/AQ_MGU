'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=process.argv[2],scenario=process.argv[3],port=path.join(root,'apps/_ports/dimonprograms-idrive8');
const flush=async()=>{for(let i=0;i<25;i++)await new Promise(setImmediate);};
function clock(){let i=0;const c={now:1700000000000,timers:new Map()};c.Date=class extends Date{static now(){return c.now;}};
 c.setInterval=(fn,ms)=>{c.timers.set(++i,{fn,ms});return i;};c.clearInterval=id=>c.timers.delete(id);c.setTimeout=c.setInterval;c.clearTimeout=c.clearInterval;return c;}
function load(file,deps,c){const module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,Date:c.Date,setImmediate,
 setInterval:c.setInterval,clearInterval:c.clearInterval,setTimeout:c.setTimeout,clearTimeout:c.clearTimeout,
 require(n){if(!(n in deps))throw new Error('Forbidden import: '+n);return deps[n];}}, {filename:file});return module.exports;}
async function main(){
 const c=clock(),spec=JSON.parse(fs.readFileSync(path.join(port,'apps/dimon_track_mode/app.json'))),events={},vis=[],subs=[],handlers=[],writes=[],tags=[],texts=[],buttons=new Map();
 const values=Object.fromEntries(spec.settings.map(s=>[s.key,s.default]));let visible=true,entry,frame;
 const log={info(){},warn(){},error(e){throw new Error(e);}};
 const ui={id8:true,isVisible(n){return visible&&n==='MAIN';},onVisible(fn){vis.push(fn);},onClick(){},async image(){}};
 const ctx={ui,log,spec,dataDir:'/memory',app:{on(n,fn){(events[n]||(events[n]=[])).push(fn);}},settings:{get(k){return values[k];}},
  signals:{watch(){throw new Error('No ID7 raw backend in ID8');}},onTab(){},hideButton(){},loop(n,fps,fn){frame=fn;},
  theme(){return {bg:'#000',text:'#fff',dim:'#aaa',accent2:'#0ff',tick:'#777',crit:'#f00'};}};
 const reader={watch(iface,instance,fields,lg,opts){assert.strictEqual(iface,'de.bmw.infotainment.vehicle.Vehicle2');assert.strictEqual(opts.pollMs,1000);
  assert.deepStrictEqual(Object.keys(fields),['statusCarSpeed2']);const sub={available:false,closed:false,fresh(){return this.available&&!this.closed;},shutdown(){this.closed=true;}};
  subs.push(sub);handlers.push(fields);return Promise.resolve(sub);}};
 const speed=load(path.join(port,'apps/dimon_track_mode/speed_id8.js'),{'./kit/readonly_signals':{forHmi(h){assert.strictEqual(h,'ID8');return reader;}}},c);
 const cv=new Proxy({text(t){texts.push(String(t));return String(t).length*10;},textWidth(t){return String(t).length*10;}},{get(o,k){return k in o?o[k]:()=>cv;}});ctx.canvas=()=>cv;
 const G={isNum:v=>typeof v==='number'&&isFinite(v),fmt:(v,d)=>v.toFixed(d),hold:(key,v)=>v,BOTTOM:14,panel(cv,t,x,y,w,h){return{x,y,w,h};},
  frame(cv,t,pages,page,badges){tags.push(...badges.filter(Boolean).map(x=>x.text));},button(cv,t,x,y,w,h,label,fn,opts){buttons.set(opts.key,{label,fn});}};
 load(path.join(port,'apps/dimon_track_mode/main.js'),{path,fs:{readFileSync(){return '{}';},writeFileSync(file,s){writes.push(JSON.parse(s));}},
  './kit/mgu':{run(x){entry=x;}},'./kit/canvas':{withAlpha:x=>x},'./kit/gauges':G,
  './lap':require(path.join(port,'apps/dimon_track_mode/lap.js')),'./demo':require(path.join(port,'apps/dimon_track_mode/demo.js')),'./speed_id8':speed},c);
 await entry.start(ctx);await flush();await frame();assert.strictEqual(buttons.get('lap').label,'Start lap');assert(tags.some(t=>/SPEED UNAVAILABLE/.test(t)));
 const tick=()=>Array.from(c.timers.values()).forEach(t=>t.fn());
 c.now+=10000;tick();await frame();assert(!tags.includes('DEMO'));assert.strictEqual(buttons.get('lap').label,'Start lap','missing speed never auto-starts');
 await buttons.get('lap').fn();await frame();assert.strictEqual(buttons.get('lap').label,'Lap / next lap','ID8 has real touch lap control');
 c.now+=2000;await buttons.get('sector').fn();c.now+=3000;await buttons.get('lap').fn();
 assert.strictEqual(writes[0].laps[0].time,5);assert.deepStrictEqual(writes[0].laps[0].sectors,[2,3]);assert.strictEqual(writes[0].laps[0].maxSpeed,null);assert.strictEqual(writes[0].laps[0].avgSpeed,null);
 const sample=async raw=>{const i=handlers.length-1;subs[i].available=true;handlers[i].statusCarSpeed2({speedVehicleCentreOfGravity:raw});await flush();};
 await sample(3200);await frame();await buttons.get('lap').fn(); // closes the lap with an earlier missing-speed period
 c.now+=1000;await sample(3840);c.now+=1000;await sample(3200);await buttons.get('lap').fn();
 let lap=writes[writes.length-1].laps[0];assert.strictEqual(lap.maxSpeed,60);assert.strictEqual(lap.avgSpeed,55);
 c.now+=3001;tick();await frame();await buttons.get('lap').fn();lap=writes[writes.length-1].laps[0];assert.strictEqual(lap.speedSampleStatus,'incomplete');assert.strictEqual(lap.maxSpeed,null);
 // Reset keeps original confirmation behavior; fresh speed can then auto-start.
 await buttons.get('reset').fn();await buttons.get('reset').fn();await frame();assert.strictEqual(buttons.get('lap').label,'Start lap');
 await sample(65535);await frame();assert.strictEqual(buttons.get('lap').label,'Start lap');
 await sample(-1);await frame();assert.strictEqual(buttons.get('lap').label,'Start lap');
 await sample(3200);await frame();assert.strictEqual(buttons.get('lap').label,'Lap / next lap');
 subs[0].available=false;tick();await frame();assert(texts.some(t=>/statistics unavailable/.test(t))||tags.some(t=>/SPEED UNAVAILABLE/.test(t)));
 visible=false;vis.forEach(fn=>fn('MAIN',false));await flush();assert(subs[0].closed);
 visible=true;vis.forEach(fn=>fn('MAIN',true));await flush();assert.strictEqual(subs.length,2);
 handlers[0].statusCarSpeed2({speedVehicleCentreOfGravity:9999});await flush();await frame();assert(tags.some(t=>/SPEED UNAVAILABLE/.test(t)));
 vis.forEach(fn=>fn('MAIN',true));(events.shutdown||[]).forEach(fn=>fn());await flush();assert(subs[1].closed);assert.strictEqual(subs.length,2);assert.strictEqual(c.timers.size,0);
}
async function timer(){const {LapTimer}=require(path.join(port,'apps/dimon_track_mode/lap.js'));const t=new LapTimer();
 t.lap(1000);t.feed(1100,50);t.feed(1200,70);t.sector(2100);const first=t.lap(4100);
 assert.strictEqual(first.time,3.1);assert.deepStrictEqual(first.sectors,[1.1,2]);assert.strictEqual(first.maxSpeed,70);assert.strictEqual(first.avgSpeed,60);
 assert.strictEqual(t.best.n,1);t.stop();assert.strictEqual(t.running,false);t.lap(5000);const manual=t.lap(7000);assert.strictEqual(manual.time,2);assert.strictEqual(t.best.n,2);}
({main,timer}[scenario])().then(()=>process.stdout.write('PASS '+scenario+'\n')).catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
