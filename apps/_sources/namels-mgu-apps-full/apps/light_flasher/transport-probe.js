'use strict';
// Two read-only identity requests, different ECUs, no session or actuator operations.
// Send the second without waiting for the first method result or ECU response.
const allowedIntervals=[100,150,200,300,500,1000];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hex=b=>Array.from(b||[]).map(n=>n.toString(16).padStart(2,'0').toUpperCase()).join(' ');
async function probe(diag,interval,allowed,now=Date.now,delay=sleep){
 if(!allowedIntervals.includes(interval))throw Error('Invalid interval');
 if(!diag.available||!allowed())throw Error('Enable diagnostics and select P');
 const t0=now(),time=()=>now()-t0;
 const records=[{side:'left',address:0x43,expected:'62 F1 50 0F 26 C0'},{side:'right',address:0x44,expected:'62 F1 50 0F 26 D0'}];
 const transportEvents=[],jobs=[];
 const result={requestedIntervalMs:interval,startedAt:new Date(t0).toISOString(),records,transportEvents,finished:false,cancelled:false};
 let listening=true;
 const frame=f=>{
  if(!listening)return;
  const r=records.find(x=>x.address===f.ecu&&x.sentMs!==undefined);
  if(!r||r.replyMs!==undefined)return;
  const u=f.uds||[];
  if(u[0]===0x7f&&u[1]===0x22&&u[2]===0x78){r.pendingMs=time();return}
  if(!(u[0]===0x62&&u[1]===0xf1&&u[2]===0x50)&&!(u[0]===0x7f&&u[1]===0x22))return;
  r.replyMs=time();r.reply=hex(u);r.identityMatches=r.reply===r.expected;
 };
 const event=(kind,value)=>{if(transportEvents.length<20)transportEvents.push({ms:time(),kind,value:String(value)})};
 const onErr=e=>event('tasError',e),onReject=e=>event('tasReject',e);
 diag.on('frame',frame);diag.on('tasError',onErr);diag.on('tasReject',onReject);
 function dispatch(r){
  r.sentMs=time();
  const p=(async()=>{try{
   r.verdict=await diag.send(r.address,0x22,[0xf1,0x50],{maxRetries:0,callTimeoutMs:1000});
   r.transportAccepted=['NO_ERROR','REQUEST_PENDING','0','1'].includes(r.verdict);
  }catch(e){r.error=String(e.message||e);r.transportAccepted=false}
  finally{r.verdictMs=time()}})();
  jobs.push(p);
 }
 try{
  dispatch(records[0]);await delay(interval);
  if(allowed()&&diag.available)dispatch(records[1]);else result.cancelled=true;
  // Drain the finite two-request test even after cancellation; do not overlap subsequent app operations.
  await Promise.all(jobs);
  const end=time()+1000;
  while(time()<end&&records.some(r=>r.sentMs!==undefined&&r.transportAccepted&&r.replyMs===undefined)){
   if(!allowed()||!diag.available)result.cancelled=true;
   await delay(Math.min(25,end-time()));
  }
  if(!allowed()||!diag.available)result.cancelled=true;
  result.actualDispatchGapMs=records[1].sentMs===undefined?null:records[1].sentMs-records[0].sentMs;
  result.secondBeforeFirstReply=records[1].sentMs!==undefined&&records[0].replyMs!==undefined&&records[1].sentMs<records[0].replyMs;
  result.secondBeforeFirstVerdict=records[1].sentMs!==undefined&&records[0].verdictMs!==undefined&&records[1].sentMs<records[0].verdictMs;
  result.bothIdentitiesReceived=records.every(r=>r.transportAccepted&&r.identityMatches);
  result.finished=true;
 }finally{
  listening=false;diag.removeListener('frame',frame);diag.removeListener('tasError',onErr);diag.removeListener('tasReject',onReject);
  result.elapsedMs=time();
 }
 return result;
}
module.exports={probe};
