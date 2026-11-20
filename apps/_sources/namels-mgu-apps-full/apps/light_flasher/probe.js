'use strict';
// ReadDataByIdentifier ONLY. No session changes, writes, routines or actuator commands.
const {Diag,replyTo}=require('./tasu');
const DID=[0xE3,0xB8], IDENT=[0xF1,0x50];
const FLM={left:{address:0x43,index:'0F 26 C0'},right:{address:0x44,index:'0F 26 D0'}};
const FEEDBACK=[[0xD6,0xDB],[0xD7,0xA7],[0xD9,0xFC]];
const hex=a=>Array.from(a||[]).map(x=>x.toString(16).toUpperCase().padStart(2,'0')).join(' ');
class Reader {
 constructor(signals,log){this.diag=new Diag(signals,log);this.diag.quiet=true;this.busy=false;this.index=null;this.trace=[];this.identityReply=null;this.flmVerified={};this.diag.on('available',up=>{if(!up){this.index=null;this.flmVerified={}}})}
 async init(){await this.diag.init();return this}
 async read(did,target=0x40){
   const isFlm=Object.values(FLM).some(m=>m.address===target);
   if(target===0x40 ? did!==DID&&did!==IDENT :
      !isFlm || (did!==IDENT&&(!this.flmVerified[target]||!FEEDBACK.includes(did))))
      throw Error('Read-only address/DID not allowed');
   if(this.busy||!this.diag.available)throw Error('TASU unavailable or busy');
   this.busy=true;
   const record={at:new Date().toISOString(),target:hex([target]),tx:hex([0x22,...did])},start=Date.now();
   this.trace.push(record);if(this.trace.length>150)this.trace.shift();
   try{
     const reply=await this.diag.physical(target,0x22,did,800,replyTo(0x22,did),{maxRetries:0,callTimeoutMs:1000,hardTimeoutMs:1800,pendingTimeoutMs:1000});
     record.rx=reply&&reply.length?hex(reply):'TIMEOUT';
     if(!reply||!reply.length)throw Error(record.tx+' timed out');
     if(reply[0]!==0x62||reply[1]!==did[0]||reply[2]!==did[1])throw Error(record.tx+' refused: '+record.rx);
     return reply;
   }catch(e){record.error=String(e.message||e);throw e}
   finally{record.ms=Date.now()-start;this.busy=false}
 }
 async identify(){this.index=null;this.identityReply=null;const r=await this.read(IDENT);this.identityReply=hex(r);const index=hex(r.slice(3));if(index!=='0F 26 80')throw Error('Unsupported BDC identity: '+index+' (raw '+this.identityReply+')');this.index=index;return index}
 async stalk(){if(this.index!=='0F 26 80')throw Error('Identify BDC first');return this.read(DID)}
 // Capture raw feedback only; no interpretation as actual emitted light until verified.
 async flmFeedback(stillAllowed,onResult){
   this.flmVerified={};
   for(const side of ['left','right']){
     if(!stillAllowed())return;
     const m=FLM[side];
     try{
       const ident=await this.read(IDENT,m.address);
       const index=hex(ident.slice(3));
       onResult({side,kind:'identity',reply:hex(ident),index});
       if(!stillAllowed())return;
       if(index!==m.index)throw Error('Unsupported FLM identity: '+index);
       this.flmVerified[m.address]=index;
       for(const did of FEEDBACK){
         if(!stillAllowed())return;
         try{
           const raw=await this.read(did,m.address);
           onResult({side,kind:'feedback',did:hex(did),reply:hex(raw),payloadLength:raw.length-3});
         }catch(e){onResult({side,kind:'error',did:hex(did),error:String(e.message||e)})}
       }
     }catch(e){onResult({side,kind:'error',error:String(e.message||e)})}
   }
 }
}
class Capture{
 constructor(now=Date.now){this.now=now;this.active=false;this.events=[];this.reason='Not recorded';this.started=null;this.ended=null;this.lastStatus=null;this.lastRaw=null;this.rawCount=0;this.failures=0;}
 start(){this.active=true;this.events=[];this.reason='Recording';this.started=this.now();this.ended=null;this.lastStatus=null;this.lastRaw=null;this.rawCount=0;this.failures=0;}
 add(kind,value){if(!this.active)return;if(this.events.length>=300){this.stop('300 event limit');return}this.events.push({ms:this.now()-this.started,kind,value})}
 status(v){if(!this.active||!v)return;const x=v.statusMainBeam_headlightFlasher;if(x!==this.lastStatus){this.lastStatus=x;this.add('combined-light-status',v)}}
 raw(r,latencyMs){if(!this.active)return;this.rawCount++;const payload=hex(r.slice(3));if(payload!==this.lastRaw){this.lastRaw=payload;this.add('stalk-raw-change',{reply:hex(r),data:payload,latencyMs})}}
 error(e){if(!this.active)return;this.failures++;this.add('read-error',String(e.message||e));if(this.failures>=3)this.stop('Read failures; no session changes attempted')}
 mark(x){this.add('user-marker',x)}
 stop(reason='Stopped manually'){if(this.active){this.active=false;this.ended=this.now();this.reason=reason}}
 snapshot(){return {active:this.active,reason:this.reason,started:this.started,ended:this.ended,rawCount:this.rawCount,failures:this.failures,source:'BDC_G05 LENKSTOCK_BLINKER DID E3B8',leverVerified:false,events:this.events.slice()}}
}
module.exports={Reader,Capture,hex};
