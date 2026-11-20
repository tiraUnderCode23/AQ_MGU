'use strict';
const assert=require('assert');
const {Control}=require('../../apps/andrei_mdrive/control');
async function main(){
 let enabled=false,demo=false,rpm=null,calls=[];
 const c=new Control({enabled:()=>enabled,demo:()=>demo,rpm:()=>rpm});
 c.link={available:true,sendToDme:async(sid,data)=>{calls.push([sid,data]);return {ok:true,sid:0x6f,data};}};
 assert.equal(await c.send('map',1),false); assert.equal(calls.length,0);
 enabled=true;
 for(let n=1;n<=4;n++){assert.equal(await c.send('map',n),true);assert.deepEqual(calls.pop(),[0x2f,[1,n-1]]);}
 for(const [n,m] of ['OEM','OPEN','CLOSED'].entries()){await c.send('flap',m);assert.deepEqual(calls.pop(),[0x2f,[2,n]]);}
 assert.equal(await c.send('cooling',true),false);assert.equal(calls.length,0);
 rpm=500;assert.equal(await c.send('cooling',true),false);
 rpm=501;assert.equal(await c.send('cooling',true),true);assert.deepEqual(calls.pop(),[0x2f,[3,1]]);
 rpm=null;assert.equal(await c.send('cooling',false),true);assert.deepEqual(calls.pop(),[0x2f,[3,0]]);
 await assert.rejects(()=>c.send('map',5),/Invalid/);
 c.link.sendToDme=async()=>({ok:true,sid:0x6f,data:[1,3]});
 assert.equal(await c.send('map',1),false);assert.equal(c.state.map,null);
 c.link.sendToDme=async()=>({ok:false,reason:'request rejected'});
 assert.equal(await c.send('flap','OPEN'),false);assert.equal(c.state.flap,null);
 c.link.sendToDme=async()=>{throw Error('timeout');};
 assert.equal(await c.send('map',2),false);assert.equal(c.busy,false);
 demo=true;assert.equal(await c.send('map',3),true);assert.equal(c.state.map,3);
 assert.match(c.note,/Demo/);c.reset();assert.equal(c.state.map,null);demo=false;
 let finish; c.link.sendToDme=()=>new Promise(r=>{finish=r;});
 const pending=c.send('map',1);assert.equal(c.busy,true);
 assert.equal(await c.send('map',2),false);c.reset();finish({ok:true,sid:0x6f,data:[1,0]});
 assert.equal(await pending,false);assert.equal(c.state.map,null);
 c.link.available=false;assert.equal(await c.send('map',1),false);
 console.log('PASS: disabled/demo isolation, every command encoding, RPM guard, rejection, timeout, concurrent presses, reset during request, disconnect');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
