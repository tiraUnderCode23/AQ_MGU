'use strict';
// Actual signals module with inert typed members only. No SDK or native binding.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const file=path.resolve(process.argv[2],'kit/runtime/signals.js');
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(setImmediate);};
function fixture(){
 let next=0,provider,notify,stopped=0;const deadlines=new Map(),polls=new Map(),requests=[],values=[];
 const px={field:{subscribe(fn){notify=fn;},getValue(){return new Promise((resolve,reject)=>requests.push({resolve,reject}));}},
  subscribeToAvailability(fn){provider=fn;fn(true);},isAvailable(){return true;},shutdown(){stopped++;}};
 const dependencies={fs:{readFileSync(){throw new Error('inert missing raw config');}},path,'oap-sdk':{someipBuilders:{buildAndInitTypedProxy:async()=>px}}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,__dirname:path.dirname(file),setImmediate,
  setTimeout(fn,ms){deadlines.set(++next,{fn,ms});return next;},clearTimeout(id){deadlines.delete(id);},
  setInterval(fn,ms){polls.set(++next,{fn,ms});return next;},clearInterval(id){polls.delete(id);},
  require(name){if(!(name in dependencies))throw new Error('Forbidden dependency: '+name);return dependencies[name];}}, {filename:file});
 const api=module.exports;api.allowTyped(true);
 return {api,requests,values,deadlines,polls,get stopped(){return stopped;},
  watch:opts=>api.watch('Fixture.ReadOnly','1',{field(v){values.push(v);}}, {warn(){}},opts),
  provider:v=>provider(v),notify:v=>notify(v),poll(){Array.from(polls.values()).forEach(t=>t.fn());},
  timeout(){for(const [id,t]of Array.from(deadlines.entries()))if(t.ms===3500){deadlines.delete(id);t.fn();}}};
}
(async()=>{
 const a=fixture(),sub=await a.watch();await flush();
 assert.strictEqual(a.requests.length,1,'availability and isAvailable must share one pending initial getter');
 a.timeout();assert.match(sub.error,/timed out/);assert.strictEqual(sub.available,false);
 for(let i=0;i<3;i++){a.provider(false);a.provider(true);await flush();}
 assert.strictEqual(a.requests.length,1,'provider recovery does not pile up a still-pending getter');
 a.requests[0].resolve({n:999});await flush();assert.strictEqual(a.values.length,0,'late expired/previous-generation result ignored');
 assert.match(sub.error,/timed out/);
 a.provider(true);await flush();assert.strictEqual(a.requests.length,2);a.requests[1].resolve({n:20});await flush();assert.strictEqual(sub.available,true);assert.strictEqual(a.values[0].n,20);
 a.provider(false);a.notify({n:666});assert.strictEqual(a.values.length,1,'provider loss blocks event callbacks');
 a.provider(true);await flush();assert.strictEqual(a.requests.length,3);await sub.shutdown();
 a.requests[2].resolve({n:777});a.notify({n:888});a.provider(true);await flush();
 assert.strictEqual(a.values.length,1);assert.strictEqual(a.requests.length,3);assert.strictEqual(a.stopped,1);assert.strictEqual(a.deadlines.size,0);
 await assert.rejects(sub.readField('field',1000),/stopped/);
 const b=fixture(),polled=await b.watch({pollMs:1000});await flush();b.timeout();
 for(let i=0;i<8;i++){b.poll();await flush();}
 assert.strictEqual(b.requests.length,1,'eight polls after deadline still share one outstanding getter');
 await polled.shutdown();assert.strictEqual(b.polls.size,0);assert.strictEqual(b.deadlines.size,0);
 b.requests[0].resolve({n:1});await flush();assert.strictEqual(b.values.length,0);
 // Shiftlights retains ownership of its explicit, independently bounded reads.
 const c=fixture(),manual=await c.watch({initialRead:false,dropStaleReads:true});await flush();assert.strictEqual(c.requests.length,0);
 const pending=manual.readField('field',3000);await flush();assert.strictEqual(c.requests.length,1);
 await manual.shutdown();c.requests[0].resolve({n:99});assert.strictEqual(await pending,null);assert.strictEqual(c.values.length,0);
 console.log('PASS typed pending getters, deadlines, generation, shutdown and manual-read ownership');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
