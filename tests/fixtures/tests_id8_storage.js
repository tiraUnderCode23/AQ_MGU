'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=process.argv[2],scenario=process.argv[3],file=path.join(root,'apps/_ports/bmwenthusiast-idrive8/apps/ab_storage/main.js');
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(setImmediate);};
const df=(device='/fixture',mount='/fictional')=>'Filesystem 1024-blocks Used Available Capacity Mounted on\n'+device+' 10000000 4000000 6000000 40% '+mount+'\n';
function harness(visibleInitially){
 const calls=[],pending=[],timers=new Map(),visibleFns=[],events={},texts=[];let next=0,entry,visible=!!visibleInitially,images=0;
 const cv=new Proxy({text(t){texts.push(String(t));return 80;},textWidth(){return 150;}},{get(o,k){return k in o?o[k]:()=>cv;}});
 const ctx={dataDir:'/fictional app data',ui:{id8:true,isVisible(){return visible;},onVisible(fn){visibleFns.push(fn);},async image(){images++;}},
  log:{warn(){}},app:{on(n,fn){(events[n]||(events[n]=[])).push(fn);}},theme(){return{text:'#fff',bg:'#000',dim:'#aaa',tick:'#999',accent:'#0ff'};},canvas(){return cv;}};
 const deps={'child_process':{execFile(cmd,args,opts,cb){assert.strictEqual(cmd,'df');assert.deepStrictEqual(Array.from(args).slice(0,2),['-Pk','--']);assert.strictEqual(opts.timeout,2500);
  calls.push({cmd,args:Array.from(args),opts});pending.push(cb);},execFileSync(){throw new Error('No synchronous process or filesystem read in actual app start');}},
  './kit/mgu':{run(x){entry=x;}},'./kit/gauges':{frame(){}},'./kit/canvas':{withAlpha:x=>x}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,setInterval(fn,ms){timers.set(++next,{fn,ms});return next;},clearInterval(id){timers.delete(id);},
  require(n){if(!(n in deps))throw new Error('Forbidden import: '+n);return deps[n];}}, {filename:file});
 return {module:module.exports,calls,pending,timers,texts,get images(){return images;},start:()=>entry.start(ctx),
  show(on){visible=on;visibleFns.forEach(fn=>fn('MAIN',on));},finish(){pending.splice(0).forEach(cb=>cb(null,df()));},shutdown(){(events.shutdown||[]).forEach(fn=>fn());}};
}
async function parser(){
 const h=harness(false),m=h.module;const good=m.parseDf(df());assert.strictEqual(good.totalKB,10000000);assert.strictEqual(m.fmt(10000000),'10.24');
 assert.strictEqual(m.parseDf(''),null);assert.strictEqual(m.parseDf('head\n/dev 0 0 0 0% /'),null);assert.strictEqual(m.parseDf('head\n/dev 100 200 0 200% /'),null);
 assert.strictEqual(m.parseDf('head\n/dev -1 0 0 0% /'),null);assert.strictEqual(m.parseDf('head\n/dev 10000 9000 9000 90% /'),null);
 const sync=m.readVolumes('/fictional',(cmd,args)=>{assert.strictEqual(cmd,'df');assert.strictEqual(args[2],args[2]==='/var/opt'?'/var/opt':'/fictional');return df();});assert.strictEqual(sync.length,1,'duplicate filesystems not counted twice');
 const mixed=await m.readVolumesAsync('/missing',(cmd,args,opts,cb)=>args[2]==='/missing'?cb(new Error('inert missing')):cb(null,df()));
 assert.strictEqual(mixed.length,2);assert.strictEqual(mixed[0].error,'Not accessible');assert.strictEqual(mixed[1].totalKB,10000000);
 assert.strictEqual(h.calls.length,0,'parser tests did not run any host df');
}
async function lifecycle(){
 const h=harness(false);await h.start();assert.strictEqual(h.calls.length,0);assert.strictEqual(h.timers.size,0);
 h.show(true);assert.strictEqual(h.calls.length,2);assert.strictEqual(h.timers.size,1);assert.strictEqual(Array.from(h.timers.values())[0].ms,15000);
 Array.from(h.timers.values()).forEach(t=>t.fn());assert.strictEqual(h.calls.length,2,'one asynchronous read batch at a time');
 h.show(false);assert.strictEqual(h.timers.size,0);h.finish();await flush();assert.strictEqual(h.images,0,'hide invalidates pending images');
 h.show(true);assert.strictEqual(h.calls.length,4);h.finish();await flush();assert.strictEqual(h.images,1);assert(h.texts.includes('GB FREE'));
 Array.from(h.timers.values()).forEach(t=>t.fn());assert.strictEqual(h.calls.length,6);h.shutdown();assert.strictEqual(h.timers.size,0);
 h.finish();await flush();assert.strictEqual(h.images,1,'shutdown invalidates pending images');h.show(true);assert.strictEqual(h.calls.length,6);assert.strictEqual(h.timers.size,0);
}
async function initial(){const h=harness(true);await h.start();assert.strictEqual(h.calls.length,2,'already visible MAIN gets a first frame');h.finish();await flush();assert.strictEqual(h.images,1);h.shutdown();}
({parser,lifecycle,initial}[scenario])().then(()=>process.stdout.write('PASS '+scenario+'\n')).catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
