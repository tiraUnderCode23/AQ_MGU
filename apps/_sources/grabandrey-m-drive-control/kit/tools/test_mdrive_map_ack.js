'use strict';
const assert=require('assert');
const {Control}=require('../../apps/andrei_mdrive/control');
async function main(){
 let enabled=true,demo=false,finish;
 const c=new Control({enabled:()=>enabled,demo:()=>demo,rpm:()=>1000});
 c.link={available:true,sendToDme:()=>new Promise(r=>{finish=r;})};
 let pending=c.send('map',2);
 assert.deepEqual(c.mapAck,{slot:2,status:'sending'});
 finish({ok:true,sid:0x6f,data:[1,1]});assert(await pending);
 assert.deepEqual(c.mapAck,{slot:2,status:'accepted'});
 pending=c.send('flap','OPEN');finish({ok:true,sid:0x6f,data:[2,1]});await pending;
 assert.deepEqual(c.mapAck,{slot:2,status:'accepted'});
 pending=c.send('map',3);finish({ok:true,sid:0x6f,data:[1,1]});assert.equal(await pending,false);
 assert.deepEqual(c.mapAck,{slot:3,status:'unconfirmed'});
 c.link.sendToDme=async()=>{throw Error('timeout');};await c.send('map',4);
 assert.deepEqual(c.mapAck,{slot:4,status:'unconfirmed'});
 demo=true;await c.send('map',1);assert.equal(c.mapAck.status,'demo');
 demo=false;enabled=false;await c.send('map',2);assert.equal(c.mapAck.status,'disabled');
 enabled=true;c.link.available=false;await c.send('map',3);assert.equal(c.mapAck.status,'unavailable');
 c.link.available=true;c.link.sendToDme=()=>new Promise(r=>{finish=r;});
 pending=c.send('map',4);c.reset();finish({ok:true,sid:0x6f,data:[1,3]});await pending;
 assert.equal(c.mapAck,null);
 console.log('PASS: map acknowledgements, mismatches, timeouts, demo, blocked commands, reset, and persistence across other controls');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
