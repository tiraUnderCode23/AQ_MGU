'use strict';
/**
 * health.js - the Garage health check and the misfire warning.
 *
 * HealthMonitor watches the live readings all the time (a few times a second, on the app's timer) and keeps
 * what a mechanic would look at: misfires per cylinder, boost target vs actual under load, fuel pressures with
 * the engine running, the 12 V system, the HV battery and how the engine warms up. check() turns that into a
 * report: each item PASS, ATTENTION or NO DATA with the numbers behind it, saved as JSON in the app's data
 * folder (health/). The limits are deliberately loose: ATTENTION means "have a look", not a diagnosis.

 */
const fs=require('fs'),path=require('path');
const M=require('./model'),E=require('./engine');
// limits for ATTENTION (loose on purpose)
const L={underBoost:0.25,hpfpMin:30,lpfpMin:3.5,v12Low:12.2,v12High:15.2,hvTempLow:0,hvTempHigh:45,oilHot:130,coolantHot:115,iatHot:70,
    loadDev:25,timingLow:-10,boostLoadBar:0.4,boostRpm:2000,hold:8};
const KEEP_REPORTS=20;
function live(store,k){const r=store.get(k);return r.quality==='live'&&M.finite(r.value)?r.value:null;}
class Stat {
    constructor(){this.n=0;this.min=null;this.max=null;this.sum=0;}
    add(v){if(!M.finite(v))return;this.n++;this.sum+=v;this.min=this.min==null?v:Math.min(this.min,v);this.max=this.max==null?v:Math.max(this.max,v);}
    mean(){return this.n?this.sum/this.n:null;}
}
class HealthMonitor {
    constructor(store,options){
        this.store=store;this.options=options||{};this.now=this.options.now||Date.now;this.dir=this.options.dir||null;
        this.reset();this.last=null;this.running=null;
        this.misfire=null;          // {counts, level, at} from the misfire monitor
        this.loadLast();
    }
    reset(){
        this.s={boostDev:new Stat(),boostShort:new Stat(),hpfp:new Stat(),lpfp:new Stat(),v12:new Stat(),hvTemp:new Stat(),
            oil:new Stat(),coolant:new Stat(),iat:new Stat(),loadDev:new Stat(),timing:new Stat()};
        this.since=this.now();
    }
    /** a few times a second: add the current readings to the session statistics */
    sample(){
        const st=this.store,s=this.s,rpm=live(st,'rpm'),running=rpm!=null&&rpm>500;
        const bt=live(st,'boost_target'),ba=live(st,'boost_actual');
        if(running&&bt!=null&&ba!=null&&rpm>=L.boostRpm&&bt>=L.boostLoadBar){s.boostDev.add(Math.abs(bt-ba));s.boostShort.add(bt-ba);}
        if(running){s.hpfp.add(live(st,'hpfp'));s.lpfp.add(live(st,'lpfp'));s.timing.add(live(st,'timing'));
            const la=live(st,'load'),lt=live(st,'load_target');if(la!=null&&lt!=null&&lt>60)s.loadDev.add(lt-la);}
        // 12 V while the car is ready (DC/DC charging): the HV system or the engine is up
        const v=live(st,'voltage');if(v!=null)s.v12.add(v);
        s.hvTemp.add(live(st,'hv_temp'));s.oil.add(live(st,'oil'));s.coolant.add(live(st,'coolant'));s.iat.add(live(st,'iat'));
    }
    setMisfire(counts,level){this.misfire={counts:counts.slice(),level:level,at:this.now()};}
    /** the report for what was seen since the last reset (warm: a WarmUp, for the warm-up behaviour) */
    report(warm){
        const s=this.s,items=[],f=(v,d)=>v==null?'--':v.toFixed(d);
        const add=(id,name,status,detail)=>items.push({id,name,status,detail});
        // misfires
        const mf=this.misfire;
        if(!mf)add('misfire','Misfires','nodata','Misfire monitor not read yet');
        else{const worst=mf.counts.reduce((b,n,i)=>n!=null&&n>(b.n||0)?{n:n,i:i}:b,{n:0,i:-1});
            add('misfire','Misfires',mf.level==='ok'?'pass':'attention',mf.counts.map((n,i)=>'C'+(i+1)+' '+(n==null?'-':n)).join('  ')+
                (mf.level!=='ok'&&worst.i>=0?' · cylinder '+(worst.i+1)+' highest':''));}
        // boost target vs actual
        if(!s.boostDev.n)add('boost','Boost target vs actual','nodata','Needs a pull above '+L.boostRpm+' rpm and '+L.boostLoadBar+' bar target');
        else{const under=s.boostShort.max;
            add('boost','Boost target vs actual',under>L.underBoost?'attention':'pass','avg deviation '+f(s.boostDev.mean(),2)+' bar · max under target '+f(Math.max(0,under),2)+' bar ('+s.boostDev.n+' samples)');}
        // load target vs actual
        if(s.loadDev.n)add('load','Load target vs actual',s.loadDev.max>L.loadDev?'attention':'pass','max short of target '+f(Math.max(0,s.loadDev.max),0)+' % ('+s.loadDev.n+' samples)');
        // fuel
        if(!s.hpfp.n)add('hpfp','High pressure fuel','nodata','Needs the engine running');
        else add('hpfp','High pressure fuel',s.hpfp.min<L.hpfpMin?'attention':'pass','min '+f(s.hpfp.min,0)+' · max '+f(s.hpfp.max,0)+' bar');
        if(!s.lpfp.n)add('lpfp','Low pressure fuel','nodata','Needs the engine running');
        else add('lpfp','Low pressure fuel',s.lpfp.min<L.lpfpMin?'attention':'pass','min '+f(s.lpfp.min,1)+' · max '+f(s.lpfp.max,1)+' bar');
        // ignition
        if(s.timing.n)add('timing','Ignition timing',s.timing.min<L.timingLow?'attention':'pass','min '+f(s.timing.min,1)+'° · max '+f(s.timing.max,1)+'°');
        // 12 V
        if(!s.v12.n)add('v12','12 V system','nodata','No 12 V reading yet');
        else add('v12','12 V system',s.v12.min<L.v12Low||s.v12.max>L.v12High?'attention':'pass','min '+f(s.v12.min,1)+' · max '+f(s.v12.max,1)+' V');
        // HV battery
        const soc=live(this.store,'hv_soc');
        if(!s.hvTemp.n&&soc==null)add('hv','HV battery','nodata','No HV battery reading yet');
        else{const bad=s.hvTemp.n&&(s.hvTemp.min<L.hvTempLow||s.hvTemp.max>L.hvTempHigh);
            add('hv','HV battery',bad?'attention':'pass',(s.hvTemp.n?'temp '+f(s.hvTemp.min,0)+'-'+f(s.hvTemp.max,0)+' °C':'temp --')+(soc!=null?' · charge '+Math.round(soc)+' %':''));}
        // temperatures and warm-up behaviour
        const hot=(s.oil.max!=null&&s.oil.max>L.oilHot)||(s.coolant.max!=null&&s.coolant.max>L.coolantHot);
        if(!s.oil.n&&!s.coolant.n)add('temps','Oil & coolant','nodata','No engine temperatures yet');
        else add('temps','Oil & coolant',hot?'attention':'pass','max oil '+f(s.oil.max,0)+' °C · max coolant '+f(s.coolant.max,0)+' °C');
        if(warm){
            const e=warm.eta('oil'),c=warm.eta('coolant'),stalled=e.state==='stalled'||c.state==='stalled';
            const st=e.state==='none'?'nodata':stalled||warm.overCount>0?'attention':'pass';
            add('warmup','Warm-up behaviour',st,(stalled?'temperature stopped rising before warm · ':e.state==='ready'?'warm · ':e.state==='warming'?'warming normally · ':'')+
                (warm.overCount?warm.overCount+' cold over-rev'+(warm.overCount>1?'s':''):'no cold over-revs'));
        }
        if(s.iat.n)add('iat','Intake air',s.iat.max>L.iatHot?'attention':'pass','max '+f(s.iat.max,0)+' °C');
        const att=items.filter((x)=>x.status==='attention').length,data=items.filter((x)=>x.status!=='nodata').length;
        return {at:this.now(),since:this.since,result:!data?'nodata':att?'attention':'pass',attention:att,items:items};
    }
    /**
     * The health check: wanted() is true for holdS seconds so the engine values and the misfire monitor are read
     * fast (hybrid.js focus), then the report is made, kept and saved. done(report) when finished.
     */
    start(warm,done,holdS){
        if(this.running)return false;
        const ms=(holdS==null?L.hold:holdS)*1000;
        this.running={started:this.now(),until:this.now()+ms};
        this.timer=setTimeout(()=>{this.running=null;const r=this.report(warm);this.last=r;this.save(r);if(done)done(r);},ms);
        return true;
    }
    progress(){return this.running?M.clamp((this.now()-this.running.started)/(this.running.until-this.running.started),0,1):null;}
    wanted(){return !!this.running;}
    save(r){
        if(!this.dir)return;
        try{fs.mkdirSync(this.dir,{recursive:true});
            const name='health-'+new Date(r.at).toISOString().replace(/[:.]/g,'-')+'.json';
            fs.writeFileSync(path.join(this.dir,name),JSON.stringify(r,null,1));r.file=name;
            const old=fs.readdirSync(this.dir).filter((n)=>/^health-.*\.json$/.test(n)).sort();
            old.slice(0,Math.max(0,old.length-KEEP_REPORTS)).forEach((n)=>{try{fs.unlinkSync(path.join(this.dir,n));}catch(e){/* ignore */}});
        }catch(e){r.saveError=String(e.message||e);}
    }
    loadLast(){
        if(!this.dir)return;
        try{const list=fs.readdirSync(this.dir).filter((n)=>/^health-.*\.json$/.test(n)).sort();
            if(list.length){this.last=JSON.parse(fs.readFileSync(path.join(this.dir,list[list.length-1]),'utf8'));this.last.file=list[list.length-1];}}
        catch(e){this.last=null;}
    }
    stop(){clearTimeout(this.timer);this.running=null;}
}
/** Misfire counts that grew past a warning level since the last call: a message, or null. */
class MisfireAlert {
    constructor(){this.warned={};this.level=null;}
    update(counts,level){
        if(!counts)return null;
        const out=[];
        counts.forEach((n,i)=>{if(n!=null&&n>=E.MIS_CYL_WARN&&!this.warned[i]){this.warned[i]=true;out.push('cylinder '+(i+1)+' ('+n+')');}});
        const was=this.level;this.level=level;
        if(level==='crit'&&was!=='crit')return 'MISFIRES: '+counts.reduce((s,n)=>s+(n||0),0)+' this cycle - ease off and have it checked';
        if(out.length)return 'Misfire warning: '+out.join(', ')+' this driving cycle';
        return null;
    }
}
module.exports={HealthMonitor,MisfireAlert,LIMITS:L,Stat};
