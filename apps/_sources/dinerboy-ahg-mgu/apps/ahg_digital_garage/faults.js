'use strict';
/**
 * faults.js - the fault memory scan (Diagnostics page and Vehicle Health).
 *
 * One functional request to every control unit: UDS 19 02 <mask> (ReadDTCInformation, report by status mask),
 * the same read BMW's own diagnostic service sends. Each unit answers with its stored faults and their status
 * byte. This module can only send that one request: the Diag below is private and scan() is the only thing that
 * talks to it. Nothing is cleared, coded or written (no 14 / 2E / 2F / 31).
 *
 * Fault texts: the head unit has none. If a text table is present (dtc_texts.json in the app folder or its data
 * folder: {"<address hex>:<code>": "text"}, e.g. made by kit/tools/dtc_texts.py) its texts are shown.
 */
const fs=require('fs'),path=require('path');
const {Diag,parseDtcReply,statusInfo,hex,NRC}=require('./kit/diag');
const {ECU}=require('./kit/ecus');
const MASK=0x0D;                 // test failed | pending | confirmed
const REQUEST=Object.freeze([0x02,MASK]);
const SCAN_SID=0x19;

function unitName(a){return ECU[a]||('ECU 0x'+hex(a));}
function loadTexts(dirs){
    for(const d of dirs){if(!d)continue;try{return JSON.parse(fs.readFileSync(path.join(d,'dtc_texts.json'),'utf8'));}catch(e){/* none here */}}
    return {};
}
/** Turn the scan's Map(address -> UDS reply) into units and faults (pure: the tests use it). */
function summarise(replies,texts){
    const units=[],faults=[];texts=texts||{};
    replies.forEach((uds,ecu)=>{
        const r=parseDtcReply(uds,REQUEST);
        const u={address:ecu,name:unitName(ecu),ok:r.ok,refused:r.ok?null:(r.nrc!=null?(NRC[r.nrc]||'NRC 0x'+hex(r.nrc)):'no valid answer'),count:r.dtcs.length};
        units.push(u);
        r.dtcs.forEach((d)=>{const s=statusInfo(d.status);
            faults.push({address:ecu,unit:u.name,code:d.code,status:d.status,label:s.label,sev:s.sev,text:texts[hex(ecu)+':'+d.code]||texts[d.code]||null});});
    });
    const rank={crit:0,warn:1,dim:2};
    units.sort((a,b)=>b.count-a.count||a.address-b.address);
    faults.sort((a,b)=>rank[a.sev]-rank[b.sev]||a.address-b.address||(a.code<b.code?-1:1));
    return {units:units,faults:faults,active:faults.filter((f)=>f.sev==='crit').length,stored:faults.filter((f)=>f.sev!=='crit').length};
}


class FaultScanner {
    constructor(ctx,opts){
        this.ctx=ctx;this.opts=opts||{};this.dir=this.opts.dir||null;
        this.diag=null;this.ready=false;this.error=null;
        this.state='idle';               // idle | scanning | done | error
        this.progress=0;this.result=null;this.at=null;
        this.texts=loadTexts([this.opts.appDir,this.dir]);
        this.loadLast();
    }
    async init(){
        if(this.diag)return this;
        const d=new Diag(this.ctx.signals,this.ctx.log);d.quiet=true;
        await d.init();this.diag=d;this.error=d.error;this.ready=!!d.p;
        return this;
    }
    get scanning(){return this.state==='scanning';}
    /** read every unit's fault memory: resolves with the summary (also kept in .result and saved) */
    async scan(){
        if(this.scanning)return this.result;
        this.state='scanning';this.progress=0;this.error=null;
        try{
            await this.init();
            if(!this.diag||!this.diag.p)throw new Error(this.error||'diagnostic link unavailable');
            const replies=await this.diag.functional(SCAN_SID,REQUEST.slice(),{idleMs:this.opts.idleMs||4000,maxMs:30000,onReply:(ecu,n)=>{this.progress=n;}});
            this.result=summarise(replies,this.texts);this.at=Date.now();this.state='done';this.result.at=this.at;
            if(!replies.size){this.state='error';this.error='no control unit answered';}
            this.save();return this.result;
        }catch(e){this.state='error';this.error=String(e&&e.message||e);throw e;}
    }
    save(){
        if(!this.dir||!this.result)return;
        try{fs.mkdirSync(this.dir,{recursive:true});const f=path.join(this.dir,'last-scan.json');fs.writeFileSync(f+'.tmp',JSON.stringify(this.result));fs.renameSync(f+'.tmp',f);}catch(e){/* not fatal */}
    }
    loadLast(){
        if(!this.dir)return;
        try{this.result=JSON.parse(fs.readFileSync(path.join(this.dir,'last-scan.json'),'utf8'));this.at=this.result.at||null;this.state='done';}catch(e){/* no scan yet */}
    }
}
module.exports={FaultScanner,summarise,REQUEST,SCAN_SID,unitName};
