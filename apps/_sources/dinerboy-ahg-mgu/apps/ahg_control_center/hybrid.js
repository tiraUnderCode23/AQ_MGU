'use strict';
/**
 * hybrid.js - high-voltage battery and 12 V readings, READ-ONLY.
 *
 * Source: idrive7-apps eDrive (apps/edrive/app.json config.battery), set up on the X5 45e and
 * written for BMW plug-in hybrids in general. Not yet confirmed on a G30 530e: every value has
 * several candidate identifiers; the first one that answers with a plausible number is used.
 *
 *   HV charge      SME (0x07)  22 DDBC   0.1 %
 *   HV voltage     SME (0x07)  22 DDB4 / DD68 / DD66 / DDEF
 *   HV current     SME (0x07)  22 DD69   0.01 A, signed, negative = the battery gives power
 *   12 V voltage   DME (0x12)  22 F442 (or OBD 01 42), else the battery sensor / gearbox unit
 *   Boost          DME (0x12)  22 F470 / F487 / F40B (or OBD 01 0B) absolute kPa minus 22 F433 outside air
 *                  pressure - only when the sport display sends no boost (as idrive7-apps car_vitals readBoost)
 *
 * Every request goes through kit/readonly-diag.js, which refuses anything but 0x22 reads (and
 * OBD 01/09) before it reaches the car: nothing is written, coded or actuated here.
 */
const M=require('./model'),E=require('./engine');
const SME=0x07;
const C={
    soc:[{ecu:SME,did:'DDBC',bytes:2,factor:0.1,min:0.5,max:100,timeoutMs:600}],
    hvV:[{ecu:SME,did:'DDB4',bytes:2,factor:0.01,min:150,max:500,timeoutMs:600},{ecu:SME,did:'DD68',bytes:2,factor:0.01,min:150,max:500,timeoutMs:600},
        {ecu:SME,did:'DD66',bytes:2,factor:0.01,min:150,max:500,timeoutMs:600},{ecu:SME,did:'DDEF',bytes:2,factor:1,min:150,max:500,timeoutMs:600}],
    hvI:[{ecu:SME,did:'DD69',bytes:4,factor:0.01,signed:true,min:-800,max:800,timeoutMs:600}],
    v12:[{ecu:0x12,did:'F442',bytes:2,factor:0.001,min:5,max:18,timeoutMs:600},{ecu:0x12,obd:'42',bytes:2,factor:0.001,min:5,max:18,timeoutMs:600},
        {ecu:0x12,did:'402B',bytes:2,at:2,factor:0.00025,offset:6,min:5,max:18,timeoutMs:600},{ecu:0x12,did:'5853',bytes:2,factor:0.001,min:5,max:18,timeoutMs:600},
        {ecu:0x18,did:'F442',bytes:2,factor:0.001,min:5,max:18,timeoutMs:600}],
    // car_vitals app.json config.dme.boost / baro (absolute kPa)
    boost:[{ecu:0x12,did:'F470',bytes:2,at:3,factor:0.03125,min:20,max:600,timeoutMs:400},{ecu:0x12,did:'F487',bytes:2,at:1,factor:0.03125,min:20,max:600,timeoutMs:400},
        {ecu:0x12,did:'F40B',bytes:1,factor:1,min:20,max:255,timeoutMs:400},{ecu:0x12,obd:'0B',bytes:1,factor:1,min:20,max:255,timeoutMs:400}],
    // gearbox oil: EGS 22 6000 (ZF 8HP, °C + 40, read on a G22); DA12 (°C + 48) unconfirmed - only once it moves
    gearbox:[{ecu:0x18,did:'6000',bytes:1,offset:-40,min:-40,max:160,timeoutMs:600},{ecu:0x18,did:'DA12',bytes:1,offset:-48,min:-40,max:160,timeoutMs:600}],
    baro:[{ecu:0x12,did:'F433',bytes:1,factor:1,min:50,max:115,timeoutMs:600},{ecu:0x12,obd:'33',bytes:1,factor:1,min:50,max:115,timeoutMs:600}]
};
const POWER_SIGN=-1;          // DD69: negative current = the battery gives power -> positive kW = driving
// engine values (engine.js): fast while shown on screen or a health check runs, slow otherwise
const ENGINE_FOCUS_MS=300,ENGINE_MS=5000,MISFIRE_FOCUS_MS=4000,MISFIRE_MS=30000;
/*
 * Shown DME values are read together: once each one's identifier is known (a single read answered, which
 * also gives its reply length), up to 8 of them go in ONE 22 request (22 F470 4AB0 580B F40F ...), every
 * cycle. One request instead of eight makes the dials as quick as boost. A DME that refuses several
 * identifiers in one request is remembered (multi = false) and the values are read one by one again.
 */
const ENG=[
    {name:'boost',key:'boost',list:C.boost,boost:true},
    {name:'boostTarget',key:'boost_target',list:E.CANDIDATES.boostTarget,boost:true},
    {name:'boostActual',key:'boost_actual',list:E.CANDIDATES.boostActual,boost:true},
    {name:'iat',key:'iat',list:E.CANDIDATES.iat},{name:'hpfp',key:'hpfp',list:E.CANDIDATES.hpfp},
    {name:'lpfp',key:'lpfp',list:E.CANDIDATES.lpfp},{name:'timing',key:'timing',list:E.CANDIDATES.timing},
    {name:'loadActual',key:'load',list:E.CANDIDATES.loadActual},{name:'loadTarget',key:'load_target',list:E.CANDIDATES.loadTarget}];
const TASK_KEYS={iat:['iat'],hpfp:['hpfp'],lpfp:['lpfp'],timing:['timing'],load:['load','load_target'],charge:['boost_target','boost_actual']};
/** a value from a positive single-identifier reply (62 DID data...), as kit/dids.js read() does */
function decode(c,u){
    const at=3+(c.at||0),n=c.bytes||1;if(!u||u.length<at+n)return null;
    let raw=0;for(let i=0;i<n;i++)raw=raw*256+u[at+i];
    if(c.signed&&raw>=Math.pow(2,8*n-1))raw-=Math.pow(2,8*n);
    const v=raw*(c.factor==null?1:c.factor)+(c.offset||0);
    return (c.min!=null&&v<c.min)||(c.max!=null&&v>c.max)?null:v;
}
const BOOST_MS=100,FAST_MS=1000,SOC_MS=10000,V12_MS=5000,BARO_MS=60000,GEAR_MS=5000,RETRY_FAILS=3,ABSENT_MS=120000,MAX_BACKOFF_MS=600000;
/** What drives the car now, from engine speed, battery power and speed (all measured). */
function driveSource(rpm,kw,speed){
    if(!M.finite(rpm))return null;
    const engine=rpm>400,moving=M.finite(speed)&&speed>2,k=M.finite(kw)?kw:0;
    if(!moving&&!engine)return k<-0.8?'Charging':'Ready';
    if(engine)return k>3?'Hybrid boost':k<-1?'Engine + charging':'Engine';
    return k<-1?'Recuperating':'Electric';
}
class EnergyTrip {
    constructor(){this.reset();}
    reset(){this.usedKwh=0;this.regenKwh=0;this.km=0;this.evKm=0;this.last=null;}
    update(kw,speed,rpm,now){
        const p=this.last;this.last={t:now,kw:kw,speed:speed,rpm:rpm};
        if(!p)return;const h=(now-p.t)/3600000;if(h<=0||h>5/3600)return; // gaps over 5 s are not integrated
        if(M.finite(kw)&&M.finite(p.kw)){const e=(kw+p.kw)/2*h;if(e>0)this.usedKwh+=e;else this.regenKwh-=e;}
        if(M.finite(speed)&&M.finite(p.speed)){const d=(speed+p.speed)/2*h;this.km+=d;if(M.finite(rpm)&&rpm<300)this.evKm+=d;}
    }
    share(){return this.km>0.05?100*this.evKm/this.km:null;}
}
class HybridReader {
    constructor(ctx,store,options){
        this.ctx=ctx;this.store=store;this.options=options||{};this.link=null;this.reader=null;
        this.timer=null;this.stopped=true;this.gearFirst=null;this.gearMoved=false;this.cand={};this.lens={};this.multi=null;this.batchStats={sent:0,ok:0};this.baro=101.3;this.trip=new EnergyTrip();this.error=null;
    }
    async start(){
        this.stopped=false;
        try{
            const {ReadOnlyDiag}=require('./kit/readonly-diag'),{DidReader}=require('./kit/dids');
            this.link=this.options.link||new ReadOnlyDiag(this.ctx.signals,this.ctx.log,{monitors:true});
            if(!this.options.link)await this.link.init();
            this.reader=new DidReader(this.link,{ecu:SME});
            this.misfire=new E.MisfireReader(this.reader,this.ctx.log);
        }catch(e){this.error='Diagnostic link unavailable: '+String(e.message||e);this.ctx.log.warn('hybrid: '+this.error);return;}
        const gen=this.gen=(this.gen||0)+1;
        if(!this.stopped)this.schedule(0,gen);
    }
    /*
     * Scheduling. Every request goes through one serial diagnostic queue, so a slow or unanswered read
     * holds up everything behind it. Boost is the only value that needs to be real time:
     *   - each cycle reads boost first (when the sport display sends none), then at most ONE slow task
     *   - cycles run back to back, at most every BOOST_MS: boost updates as fast as the DME answers
     *   - a slow task that got no answer RETRY_FAILS times in a row backs off to every ABSENT_MS
     *     (e.g. hybrid battery identifiers this car doesn't have), so it can't stall boost every second
     */
    schedule(ms,gen){if(!this.stopped&&gen===this.gen){clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.stopped||gen!==this.gen)return;const t0=Date.now();
        this.step().catch((e)=>this.ctx.log.warn('vehicle read: '+String(e))).then(()=>this.schedule(Math.max(0,BOOST_MS-(Date.now()-t0)),gen));},ms);}}
    /** store keys shown on screen now (or wanted by a health check): read fast */
    wanted(){const w=this.options.wanted&&this.options.wanted();return w&&w.size?w:null;}
    fast(keys){const w=this.wanted();return !!w&&keys.some((k)=>w.has(k));}
    /** remember the reply length of a DME identifier that answered, so it can join a combined request */
    learn(c){
        if(!c||!c.did||c.ecu!==0x12)return;
        const r=this.reader.raws[this.reader.key(c)];
        if(r&&r.ok&&r.bytes)this.lens[parseInt(c.did,16)]=r.bytes.split(' ').length-3;
    }
    /** the shown DME values in one request: { key: true } for each value it delivered */
    async readBatch(now){
        const w=this.wanted(),done={};
        if(!w||this.multi===false)return done;
        const items=[],dids=[];
        ENG.forEach((e)=>{
            if(!w.has(e.key)||(e.key==='boost'&&!this.boostWanted()))return;
            const i=e.name==='boostActual'?this.reader.pick.boostTarget:this.reader.pick[e.name];if(i==null)return;
            const c=e.list[i];if(!c||!c.did||c.ecu!==0x12)return;
            const did=parseInt(c.did,16);if(this.lens[did]==null)return;
            if(dids.indexOf(did)<0){if(dids.length>=8)return;dids.push(did);}
            items.push({e:e,c:c,did:did});
        });
        if(dids.length<2)return done;
        this.batchStats.sent++;
        let u=null;
        try{u=await this.link.readMany(0x12,dids,500);}catch(e){u=null;}
        if(!u)return done;
        const {split}=require('./kit/sgbd');
        const parts=u[0]===0x62?split(u,this.lens):null;
        if(!parts||!dids.every((d)=>parts[d])){
            if(this.multi===null){this.multi=false;this.ctx.log.info('vehicle read: the DME answers one identifier per request - reading them one by one');}
            return done;
        }
        if(this.multi===null)this.ctx.log.info('vehicle read: '+dids.length+' DME identifiers per request');
        this.multi=true;this.batchStats.ok++;
        items.forEach((it)=>{
            const v=decode(it.c,parts[it.did]);if(v==null)return;
            const lab='DME 22 '+it.c.did+' (combined read)';
            if(it.e.boost)this.put(it.e.key,(v-this.baro)/100,lab+' minus outside air');
            else this.put(it.e.key,v,lab);
            done[it.e.key]=true;
        });
        if(done.boost)this.boostOk=true;
        // the tasks whose values all came with it are not due again yet
        this.tasks().forEach((t)=>{const ks=TASK_KEYS[t.name];if(ks&&ks.every((k)=>done[k]||!w.has(k))&&ks.some((k)=>done[k])){t.due=now+(typeof t.every==='function'?t.every():t.every);t.fails=0;t.ok=true;}});
        return done;
    }
    put(key,value,note){if(!this.stopped)this.store.put(key,value,'mgu',note);}
    tasks(){
        if(this._tasks)return this._tasks;
        const T=(name,every,run)=>({name,every,run,due:0,fails:0});
        const label=(c)=>c.obd?'OBD '+c.obd:'22 '+c.did;
        // run() returns a value, null (no answer from any candidate) or undefined (still trying candidates)
        const val=async(name,list,use)=>{const r=await this.one(name,list);if(!r.done)return undefined;if(r.v!=null)use(r.v,list[this.reader.pick[name]||0]);return r.v;};
        this._tasks=[
            T('baro',BARO_MS,()=>val('baro',C.baro,(b)=>{this.baro=b;})),
            T('hv',FAST_MS,async()=>{
                const v=await val('hvV',C.hvV,(x,c)=>this.put('hv_v',x,'SME 22 '+c.did));if(v==null)return v;
                const i=await val('hvI',C.hvI,()=>{});
                if(i!=null){const kw=POWER_SIGN*v*i/1000;this.put('electric_kw',kw,'SME pack voltage x current (DD69)');this.put('regen_kw',kw<0?-kw:0,'SME: negative battery power');}
                return v;}),
            T('soc',SOC_MS,()=>val('soc',C.soc,(x)=>this.put('hv_soc',x,'SME 22 DDBC'))),
            T('v12',V12_MS,()=>val('v12',C.v12,(x,c)=>this.put('voltage',x,'12 V: '+(c.did||'OBD 42')))),
            T('gear',GEAR_MS,()=>val('gearbox',C.gearbox,(g,c)=>{
                if(c.did==='DA12'){if(this.gearFirst==null)this.gearFirst=g;if(Math.abs(g-this.gearFirst)>=1)this.gearMoved=true;}
                if(c.did!=='DA12'||this.gearMoved)this.put('gearbox',g,'EGS 22 '+c.did);})),
            // engine.js: DME values for the Gauges and Health pages
            T('iat',()=>this.fast(['iat'])?ENGINE_FOCUS_MS:ENGINE_MS,()=>val('iat',E.CANDIDATES.iat,(x,c)=>this.put('iat',x,'DME '+label(c)))),
            T('hpfp',()=>this.fast(['hpfp'])?ENGINE_FOCUS_MS:ENGINE_MS,()=>val('hpfp',E.CANDIDATES.hpfp,(x,c)=>this.put('hpfp',x,'DME '+label(c)))),
            T('lpfp',()=>this.fast(['lpfp'])?ENGINE_FOCUS_MS:ENGINE_MS,()=>val('lpfp',E.CANDIDATES.lpfp,(x,c)=>this.put('lpfp',x,'DME '+label(c)))),
            T('timing',()=>this.fast(['timing'])?ENGINE_FOCUS_MS:ENGINE_MS,()=>val('timing',E.CANDIDATES.timing,(x,c)=>this.put('timing',x,'DME '+label(c)))),
            T('load',()=>this.fast(['load','load_target'])?ENGINE_FOCUS_MS:ENGINE_MS,async()=>{
                const a=await val('loadActual',E.CANDIDATES.loadActual,(x)=>this.put('load',x,'DME 22 5813'));if(a==null)return a;
                await val('loadTarget',E.CANDIDATES.loadTarget,(x)=>this.put('load_target',x,'DME 22 480C'));return a;}),
            T('charge',()=>this.fast(['boost_target','boost_actual'])?ENGINE_FOCUS_MS:ENGINE_MS,async()=>{
                const t=await val('boostTarget',E.CANDIDATES.boostTarget,()=>{});if(t==null)return t;
                const i=this.reader.pick.boostTarget||0,c=E.CANDIDATES.boostActual[i],m=await this.reader.read(c);
                this.learn(E.CANDIDATES.boostTarget[i]);if(m!=null){this.reader.pick.boostActual=i;this.learn(c);}
                this.put('boost_target',(t-this.baro)/100,'DME '+label(E.CANDIDATES.boostTarget[i])+' minus outside air');
                if(m!=null)this.put('boost_actual',(m-this.baro)/100,'DME '+label(c)+' minus outside air');
                return t;}),
            T('misfire',()=>this.fast(['misfire_total'])?MISFIRE_FOCUS_MS:MISFIRE_MS,async()=>{
                const counts=await this.misfire.read();
                if(counts){this.put('misfire_total',this.misfire.total(),'DME '+(this.misfire.mode?'22 F6xx':'OBD 06')+' this driving cycle');
                    if(this.options.onMisfire)this.options.onMisfire(counts,this.misfire.level());}
                // not found: the reader waits MIS_RETRY_MS itself, so this is no failure for the scheduler
                return counts||(this.misfire.mode===null?0:null);})];
        return this._tasks;
    }
    /**
     * One request for a value: the candidate that worked last, or the next one to try. Returns
     * { v, done }: done=false while candidates are still being tried (no answer yet, not a failure),
     * so a slow cycle never costs more than one request's timeout.
     */
    async one(name,list){
        const st=this.cand[name]||(this.cand[name]={i:this.reader.pick[name]||0,tried:0});
        const v=await this.reader.read(list[st.i]);
        if(v!=null){this.reader.pick[name]=st.i;st.tried=0;this.learn(list[st.i]);return {v:v,done:true};}
        st.i=(st.i+1)%list.length;st.tried++;
        if(st.tried>=list.length){st.tried=0;return {v:null,done:true};}
        return {v:null,done:false};
    }
    async runTask(t,now){
        const every=(x)=>typeof x.every==='function'?x.every():x.every;
        const v=await t.run();
        if(v===undefined){t.due=now;return;}     // still trying candidates: next cycle again
        if(v==null){t.fails++;
            // never answered: back off after one round; answered before: allow RETRY_FAILS misses first.
            // The back-off doubles with every miss after that, up to MAX_BACKOFF_MS.
            const limit=t.ok?RETRY_FAILS:1;
            if(t.fails>=limit){t.backoff=Math.min(MAX_BACKOFF_MS,t.backoff?t.backoff*2:ABSENT_MS);t.due=now+t.backoff;
                if(t.fails===limit)this.ctx.log.warn('vehicle read: no answer for '+t.name+', retrying in '+Math.round(t.backoff/1000)+' s');}
            else t.due=now+every(t);}
        else{t.fails=0;t.ok=true;t.backoff=0;t.due=now+every(t);}
    }
    boostWanted(){const fes=this.store.get('boost');return !(fes.quality==='live'&&String(fes.provenance).indexOf('FES')>=0);}
    /** one cycle: boost, then the most overdue slow task (if any is due) */
    async step(){
        if(this.stopped||!this.reader||(this.link.available===false))return;
        const now=Date.now(),w=this.wanted(),sig=w?Array.from(w).sort().join(','):'';
        // what is shown changed (another page, another dial): read the newly shown values right away
        if(sig!==this.shown){this.shown=sig;this.tasks().forEach((t)=>{if(typeof t.every==='function'&&!t.backoff)t.due=Math.min(t.due,now+(typeof t.every==='function'?t.every():0));});}
        const got=await this.readBatch(now);
        if(this.boostWanted()&&!got.boost&&!this.stopped)await this.readBoost();
        const due=this.tasks().filter((t)=>t.due<=now).sort((x,y)=>x.due-y.due)[0];
        if(due&&!this.stopped)await this.runTask(due,now);
        this.derive(Date.now());
    }
    /** a full pass: boost and every task until each one has an answer or ran out of candidates (tests) */
    async tick(){
        if(this.stopped||!this.reader||(this.link.available===false))return;
        const run=async(t)=>{let n=0;do{if(this.stopped)return;await this.runTask(t,Date.now());}while(t.due<=Date.now()&&t.fails===0&&++n<12);};
        await run(this.tasks()[0]);                // outside air pressure first: boost needs it
        if(this.boostWanted())await this.readBoost();
        for(const t of this.tasks().slice(1)){let n=0;do{if(this.stopped)return;await this.runTask(t,Date.now());}while(t.due<=Date.now()&&t.fails===0&&++n<12);}
        this.derive(Date.now());
    }
    /** charge / manifold pressure (absolute kPa) minus outside air pressure, in bar */
    async readBoost(){
        // a DME that never answered any boost identifier is asked again every 10 s, not every cycle
        const now=Date.now();if(!this.boostOk&&this.boostFails>=RETRY_FAILS&&now<this.boostRetryAt)return;
        const m=await this.reader.value('boost',C.boost);
        if(m==null){if(!this.boostOk){this.boostFails=(this.boostFails||0)+1;this.boostRetryAt=now+10000;}return;}
        this.boostOk=true;this.learn(C.boost[this.reader.pick.boost||0]);
        if(m!=null){const c=C.boost[this.reader.pick.boost||0];this.put('boost',(m-this.baro)/100,'DME 22 '+(c.did||'OBD '+c.obd)+' minus outside air '+Math.round(this.baro)+' kPa');}
    }
    // Derived values from what was measured (no extra requests).
    derive(now){
        const g=(k)=>{const r=this.store.get(k);return r.quality==='live'?r.value:null;};
        const rpm=g('rpm'),kw=g('electric_kw'),speed=g('speed');
        const src=driveSource(rpm,kw,speed);if(src)this.put('drive_source',src,'Derived: engine speed, battery power, speed');
        this.trip.update(kw,speed,rpm,now);
        if(this.trip.km>0||this.trip.usedKwh>0){
            this.put('energy_used',this.trip.usedKwh,'Integrated battery power');this.put('regen_energy',this.trip.regenKwh,'Integrated negative battery power');
            const sh=this.trip.share();if(sh!=null)this.put('electric_share',sh,'Distance with the engine off');
        }
    }
    stop(){this.stopped=true;this.gen=(this.gen||0)+1;clearTimeout(this.timer);if(this.link&&this.link.cancel)this.link.cancel();}
}
module.exports={HybridReader,EnergyTrip,driveSource,CANDIDATES:C};
