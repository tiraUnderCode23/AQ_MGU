'use strict';
const assert=require('assert');
const {Temperatures,CANDIDATES}=require('../../apps/andrei_mdrive/temperatures');
const {MapFeedback}=require('../../apps/andrei_mdrive/map_feedback');
const ctx={log:{warn(){}},spec:{},settings:{get:()=> 'off'}};
async function main(){
 let calls=[];
 const reader={value:async(key,list)=>{calls.push([key,list]);return key==='gearbox'?94:36;}};
 const t=new Temperatures(ctx,reader);t.active=true;await t.poll();
 assert.equal(t.value('gearbox'),94);assert.equal(t.value('intake'),36);
 assert.equal(calls[0][1][0].ecu,0x18);assert.equal(calls[0][1][0].did,'6000');
 assert.equal(t.value('gearbox',Date.now()+21000),null);
 t.next={};reader.value=async()=>255;await t.poll();assert.equal(t.value('gearbox'),null);
 for(let i=0;i<3;i++){t.next={};reader.value=async()=>null;await t.poll();}
 assert(t.next.gearbox-Date.now()>59000);
 t.stop();assert.equal(t.value('gearbox'),null);
 t.active=true;t.next={};let resolve;reader.value=()=>new Promise(r=>{resolve=r;});
 const pending=t.poll();t.stop();resolve(88);await pending;assert.equal(t.value('gearbox'),null);
 let invoked=0;const f=new MapFeedback(Object.assign({},ctx,{signals:{watch:async()=>{invoked++;}}}));
 await f.start();assert.equal(invoked,0);assert.equal(f.view(null,false).active,null);
 f.observeActive(2,10000);assert.equal(f.view(1,false,10001).active,2);
 f.observeActive(4,10050);assert.equal(f.view(1,false,10051).active,4);
 assert.equal(f.view(1,false,16000).active,null);
 f.observeActive(255);assert.equal(f.view(null,false).active,null);
 f.observeCluster(false,1,3000,20000);assert.equal(f.view(null,false,20001).preview,null);
 f.observeCluster(true,2,3000,20000);assert.equal(f.view(null,false,20001).preview,null);
 f.observeCluster(true,1,3000,20000);assert.equal(f.view(null,false,20001).preview,3);assert.equal(f.view(null,false,20001).active,null);
 f.observeCluster(false,1,3000,20050);assert.equal(f.view(null,false,20051).active,null);
 let callback,demo='off';
 const cfg={spec:{config:{mapFeedback:{verified:true,signals:[{iface:'TEST',field:'sample',activePath:'map',zeroBased:true}]}}},settings:{get:()=>demo},log:ctx.log,signals:{watch:async(i,n,h)=>{callback=h.sample;return {error:null};}}};
 const live=new MapFeedback(cfg);await live.start();callback({map:2});assert.equal(live.view(null,false).active,3);
 demo='on';callback({map:0});assert.equal(live.view(null,false).active,3);live.reset();assert.equal(live.view(null,false).active,null);
 console.log('PASS: thermal decoding, invalid/stale readings, backoff, stop in flight, no unconfigured map reads, live updates, map-menu gating, demo isolation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
