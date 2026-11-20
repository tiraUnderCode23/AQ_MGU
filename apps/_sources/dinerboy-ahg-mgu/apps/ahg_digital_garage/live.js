'use strict';
/**
 * live.js - the few live readings the Digital Garage needs. Everything here only reads.
 *
 *  passive (SOME/IP, like AHG Control Center): speed (Vehicle2.statusCarSpeed2 / 64),
 *      oil and coolant (CDS.statusEngineTemperature, raw - 48)
 *  read-only diagnostic link (kit/readonly-diag, 22 and OBD 01 only):
 *      12 V      DME 0x12 22 F442, 1 mV            every 5 s
 *      HV charge SME 0x07 22 DDBC, 0.1 %           every 10 s
 *      fuel      DME OBD 01 2F, A x 100 / 255 %     every 30 s
 *      odometer  DME OBD 01 A6, 0.1 km              every 60 s (OBD odometer: not every DME answers it)
 *      VIN       DME 22 F190                        once
 *  A source refused or unanswered 3 times in a row is marked unsupported and not asked again.
 */
const {ReadOnlyDiag}=require('./kit/readonly-diag');
const CDS='de.bmw.infotainment.vehicle.CDS',VEHICLE='de.bmw.infotainment.vehicle.Vehicle2';
const STALE={speed:3000,oil:15000,coolant:15000,v12:15000,soc:30000,fuel:90000,odo:180000,vin:Infinity};
const fin=(v)=>typeof v==='number'&&isFinite(v);
function conv(raw,factor,offset,invalid,min,max){if(!fin(raw)||raw===invalid)return null;const v=raw*factor+offset;return v>=min&&v<=max?v:null;}
function u(b,i,n){let v=0;for(let k=0;k<n;k++)v=v*256+b[i+k];return v;}

class LiveData {
    constructor(ctx,opts){
        this.ctx=ctx;this.opts=opts||{};this.now=this.opts.now||Date.now;
        this.values={};this.unsupported={};this.fails={};this.timers=[];this.subs=[];this.stopped=true;this.link=null;
    }
    put(key,value,src){if(value==null||(typeof value==='number'&&!fin(value)))return;this.values[key]={value:value,at:this.now(),src:src};if(this.onValue)this.onValue(key,value,src);}
    /** a reading if it is fresh, else null */
    get(key){const r=this.values[key];if(!r)return null;return this.now()-r.at<=(STALE[key]||10000)?r.value:null;}
    source(key){const r=this.values[key];return r?r.src:null;}
    start(){
        this.stopped=false;
        this.watch(CDS,{statusEngineTemperature:(v)=>{this.put('oil',conv(v&&v.temperatureEngineOilDrive,1,-48,255,-40,170),'CDS');this.put('coolant',conv(v&&v.temperatureEngineDrive,1,-48,255,-40,170),'CDS');}},2000);
        this.watch(VEHICLE,{statusCarSpeed2:(v)=>this.put('speed',conv(v&&v.speedVehicleCentreOfGravity,1/64,0,65535,0,400),'Vehicle2')},2000);
        this.link=new ReadOnlyDiag(this.ctx.signals,this.ctx.log);
        this.link.init().then(()=>{
            if(this.stopped)return;
            this.every(5000,'v12',()=>this.did(0x12,0xF442,2,0.001,5,18,'v12','DME 22 F442'));
            this.every(10000,'soc',()=>this.did(0x07,0xDDBC,2,0.1,0,100,'soc','SME 22 DDBC'));
            this.every(30000,'fuel',()=>this.obd(0x2F,1,(b)=>b[0]*100/255,0,100,'fuel'));
            this.every(60000,'odo',()=>this.obd(0xA6,4,(b)=>u(b,0,4)/10,1,2000000,'odo'));
            this.vin();
        }).catch((e)=>this.ctx.log.warn('diagnostic link: '+String(e)));
    }
    watch(iface,handlers,delay){
        if(this.stopped)return;
        this.ctx.signals.watch(iface,'1',handlers,this.ctx.log,{pollMs:1000}).then((sub)=>{
            if(this.stopped||sub.error){if(sub.shutdown)sub.shutdown();if(!this.stopped)this.timers.push(setTimeout(()=>this.watch(iface,handlers,Math.min(delay*2,30000)),delay));return;}
            this.subs.push(sub);
        }).catch((e)=>{this.ctx.log.warn('watch '+iface+': '+String(e));if(!this.stopped)this.timers.push(setTimeout(()=>this.watch(iface,handlers,Math.min(delay*2,30000)),delay));});
    }
    every(ms,key,fn){
        let busy=false;
        const run=()=>{if(busy||this.stopped||this.unsupported[key])return;busy=true;
            Promise.resolve().then(fn).catch((e)=>this.ctx.log.warn(key+': '+String(e))).then(()=>{busy=false;});};
        run();this.timers.push(setInterval(run,ms));
    }
    miss(key){this.fails[key]=(this.fails[key]||0)+1;if(this.fails[key]>=3&&!this.unsupported[key]){this.unsupported[key]=true;this.ctx.log.info(key+': not answered by this car - stopped asking');}}
    async did(ecu,did,n,factor,min,max,key,src){
        const r=await this.link.read(ecu,did);
        if(!r||r[0]!==0x62||r.length<3+n){if(r!==undefined)this.miss(key);return;}
        this.fails[key]=0;const v=u(r,3,n)*factor;if(v>=min&&v<=max)this.put(key,v,src);
    }
    async obd(pid,n,parse,min,max,key){
        const r=await this.link.physical(0x12,0x01,[pid],1500,(x)=>(x[0]===0x41&&x[1]===pid)||(x[0]===0x7F&&x[1]===0x01));
        if(!r||r[0]!==0x41||r.length<2+n){if(r!==undefined)this.miss(key);return;}
        this.fails[key]=0;const v=parse(r.slice(2,2+n));if(v>=min&&v<=max)this.put(key,v,'DME OBD 01 '+pid.toString(16).toUpperCase());
    }
    async vin(){
        for(let i=0;i<3&&!this.stopped;i++){
            const r=await this.link.read(0x12,0xF190);
            if(r&&r[0]===0x62&&r.length>=20){const s=String.fromCharCode.apply(null,r.slice(3,20));if(/^[A-HJ-NPR-Z0-9]{17}$/.test(s)){this.put('vin',s,'DME 22 F190');return;}}
            await new Promise((res)=>setTimeout(res,5000));
        }
    }
    stop(){this.stopped=true;this.timers.forEach((t)=>{clearInterval(t);clearTimeout(t);});this.timers=[];this.subs.forEach((s)=>{if(s.shutdown)s.shutdown();});this.subs=[];if(this.link)this.link.cancel();}
}
module.exports={LiveData,conv};
