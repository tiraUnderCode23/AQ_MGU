'use strict';
// Read-only temperature candidates from the MIT App Kit Car Vitals / Redline.
// Do not use DA12: its scaling has not been confirmed. No invented live fallback.
const CANDIDATES={
 gearbox:[{ecu:0x18,did:'6000',bytes:1,offset:-40,min:-40,max:160,timeoutMs:1200}],
 intake:[{ecu:0x12,did:'F40F',bytes:1,offset:-40,min:-40,max:150,timeoutMs:1200},
         {ecu:0x12,obd:'0F',bytes:1,offset:-40,min:-40,max:150,timeoutMs:1200}]
};
class Temperatures {
 constructor(ctx,reader) {this.ctx=ctx;this.reader=reader||null;this.link=null;this.active=false;this.busy=false;this.epoch=0;this.timer=null;this.samples={};this.next={};this.misses={};this.initializing=null;}
 async start() {
  if(this.active)return;
  this.active=true;const epoch=++this.epoch;
  try {
   if(!this.reader){
    const {ReadOnlyDiag}=require('./kit/readonly-diag');
    const {DidReader}=require('./kit/dids');
    if(!this.initializing){const link=new ReadOnlyDiag(this.ctx.signals,this.ctx.log);this.link=link;this.initializing=link.init().then(()=>{this.reader=new DidReader(link,{ecu:0x12});});}
    await this.initializing;
   }
   if(!this.active||epoch!==this.epoch)return;
   this.timer=setInterval(()=>this.poll(),5000);this.poll();
  }catch(e){this.ctx.log.warn('temperatures: '+String(e));if(epoch===this.epoch)this.active=false;}
 }
 stop(){this.active=false;this.epoch++;clearInterval(this.timer);this.timer=null;if(this.link)this.link.cancel();this.samples={};}
 async poll(){
  if(!this.active||this.busy||!this.reader)return;
  this.busy=true;const epoch=this.epoch;
  try {
   for(const key of Object.keys(CANDIDATES)){
    if(!this.active||epoch!==this.epoch)break;
    if(Date.now()<(this.next[key]||0))continue;
    if(this.link)this.link.wake(CANDIDATES[key][0].ecu);
    const value=await this.reader.value(key,CANDIDATES[key]);
    if(!this.active||epoch!==this.epoch)break;
    const c=CANDIDATES[key][0];
    const valid=typeof value==='number'&&isFinite(value)&&value>=c.min&&value<=c.max;
    this.samples[key]={value:valid?value:null,time:Date.now()};
    this.misses[key]=valid?0:(this.misses[key]||0)+1;
    this.next[key]=Date.now()+(this.misses[key]>=3?60000:5000);
   }
  }catch(e){this.ctx.log.warn('temperature read: '+String(e));}
  finally{this.busy=false;}
 }
 value(key,now){const s=this.samples[key];return s&&(now==null?Date.now():now)-s.time<20000?s.value:null;}
}
module.exports={Temperatures,CANDIDATES};
