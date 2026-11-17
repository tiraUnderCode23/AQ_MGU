'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('OBD status fits native progress, unmatched reply details and failure on the HU canvas',async()=>{
    let app,draw,rendered;const text=[];
    class Canvas {constructor(w,h){this.width=w;this.height=h;}clear(){}text(value,x,y,size){text.push({value,x,y,size});}}
    const state={state:'listening_unverified',address:'172.16.222.97:6801',backend:'unverified',firewall:'scoped',tasu:'ready',
        version:'0.2.11',requests:0,responses:0,discoveryRequests:4,discoveryReplies:0,
        tasuVinError:'ecu_timeout',tasuVinTarget:'0x10',tasuTrace:{requests:2,target:'0x10',service:'0x22',verdict:'NO_ERROR',events:1,matched:0,ignored:1,lastEvent:'ECU 0x40 / SID 0x62 / 29 bytes / DID 0xF190',lastIgnore:'other_ecu'}};
    const main=fs.readFileSync(path.join(__dirname,'../apps/noahg_obdbridge/main.js'),'utf8');
    vm.runInNewContext(main,{require(name){
        if(name==='./kit/mgu')return{run(value){app=value;}};
        if(name==='./kit/canvas')return{Canvas};
        if(name==='./client')return{request:async()=>state};
        return require(name);
    },setTimeout(){return 1;},clearTimeout(){}});
    await app.start({ui:{onClick(){},async image(name,canvas){rendered=canvas;}},app:{on(){}},loop(name,fps,fn){draw=fn;},theme(){return{bg:0,accent:1,text:2};},spec:{version:'0.2.11'}});
    await draw();
    assert.equal(text.length,9);
    assert(text.every(row=>row.y>=0&&row.y+row.size<=rendered.height));
    assert(text.some(row=>row.value.includes('Verdict: NO_ERROR')&&row.value.includes('Events: 1')));
    assert(text.some(row=>row.value.includes('ECU 0x40')&&row.value.includes('other ecu')));
    assert(text.some(row=>row.value.includes('ECU reply timed out')));
});
