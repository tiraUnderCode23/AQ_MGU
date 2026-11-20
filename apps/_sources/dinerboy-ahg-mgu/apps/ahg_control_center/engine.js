'use strict';
/**
 * engine.js - engine readings for the Gauges and Health pages, READ-ONLY.
 *
 * Identifiers from idrive7-apps car_vitals (app.json config.dme), all on the DME (0x12). Each value has
 * candidates; the first that answers with a plausible number is kept (kit/dids.js). Not yet confirmed on
 * the 530e's B48: the OBD forms answer on every petrol engine, the 22 F4xx / 4AB0 forms on most MG1s.
 *
 *   IAT              22 F40F / F477 (byte 1) / OBD 0F       °C + 40
 *   High pressure    22 F423 / F459 / OBD 23                0.1 bar
 *   Low pressure     22 F40A / F422 / OBD 0A / OBD 22       bar
 *   Timing advance   22 F40E / OBD 0E                       0.5° - 64 (cylinder 1, before TDC)
 *   Load             22 480C (target) / 5813 (actual)       %
 *   Boost target     22 4AB0 / F470 byte 1 / OBD 70 byte 1  absolute kPa, minus outside air pressure
 *   Boost actual     22 580B / F470 byte 3 / OBD 70 byte 3  (the same row as the target that answered)
 *   Misfires         OBD 06 MID A2.. (one per cylinder) test 0C = this driving cycle, else 22 F6A2..
 *
 * Misfires need service 06, which the read-only link only passes when opened with { monitors: true }.
 */
const DME=0x12;
const C={
    iat:[{ecu:DME,did:'F40F',bytes:1,offset:-40,min:-40,max:150,timeoutMs:500},{ecu:DME,did:'F477',bytes:1,at:1,offset:-40,min:-40,max:150,timeoutMs:500},
        {ecu:DME,obd:'0F',bytes:1,offset:-40,min:-40,max:150,timeoutMs:500}],
    hpfp:[{ecu:DME,did:'F423',bytes:2,factor:0.1,min:0,max:500,timeoutMs:500},{ecu:DME,did:'F459',bytes:2,factor:0.1,offset:-1,min:0,max:500,timeoutMs:500},
        {ecu:DME,obd:'23',bytes:2,factor:0.1,min:0,max:500,timeoutMs:500}],
    lpfp:[{ecu:DME,did:'F40A',bytes:1,factor:0.03,min:0.5,max:8,timeoutMs:500},{ecu:DME,did:'F422',bytes:2,factor:0.00079,min:0.5,max:15,timeoutMs:500},
        {ecu:DME,obd:'0A',bytes:1,factor:0.03,min:0.5,max:8,timeoutMs:500},{ecu:DME,obd:'22',bytes:2,factor:0.00079,min:0.5,max:15,timeoutMs:500}],
    timing:[{ecu:DME,did:'F40E',bytes:1,factor:0.5,offset:-64,min:-64,max:64,timeoutMs:500},{ecu:DME,obd:'0E',bytes:1,factor:0.5,offset:-64,min:-64,max:64,timeoutMs:500}],
    loadTarget:[{ecu:DME,did:'480C',bytes:2,factor:0.0234375,min:0,max:250,timeoutMs:500}],
    loadActual:[{ecu:DME,did:'5813',bytes:1,factor:0.75,min:0,max:191.25,timeoutMs:500}],
    // target and actual pair up by row: the actual is read from the same row as the target that answered
    boostTarget:[{ecu:DME,did:'4AB0',bytes:2,factor:0.00390625,min:20,max:400,timeoutMs:500},{ecu:DME,did:'F470',bytes:2,at:1,factor:0.03125,min:20,max:400,timeoutMs:500},
        {ecu:DME,obd:'70',bytes:2,at:1,factor:0.03125,min:20,max:400,timeoutMs:500}],
    boostActual:[{ecu:DME,did:'580B',bytes:2,factor:0.00390625,min:20,max:400,timeoutMs:500},{ecu:DME,did:'F470',bytes:2,at:3,factor:0.03125,min:20,max:400,timeoutMs:500},
        {ecu:DME,obd:'70',bytes:2,at:3,factor:0.03125,min:20,max:400,timeoutMs:500}]
};
// when misfire counts are coloured (car_vitals): the total from WARN (amber) and CRIT (red), one cylinder from CYL_WARN
const MIS_WARN=100,MIS_CRIT=500,MIS_CYL_WARN=50,MIS_RETRY_MS=300000,MIS_TID=0x0C;
/** Severity of a set of misfire counts: 'ok' | 'warn' | 'crit' (null counts = not read). */
function misfireLevel(counts){
    if(!counts||!counts.length)return null;
    const known=counts.filter((n)=>n!=null),total=known.reduce((s,n)=>s+n,0);
    if(total>=MIS_CRIT)return 'crit';
    if(total>=MIS_WARN||known.some((n)=>n>=MIS_CYL_WARN))return 'warn';
    return 'ok';
}
/**
 * Misfires per cylinder from the DME's on-board monitors (car_vitals findMisfire / readMasterMisfire, for one
 * engine unit). mode: false = OBD 06, true = UDS 22 F6xx, null = not found yet. cyl: cylinders found.
 */
class MisfireReader {
    constructor(reader,log,now){this.rd=reader;this.log=log;this.now=now||Date.now;this.mode=null;this.cyl=0;this.retryAt=0;this.counts=null;this.at=0;this.why='';}
    async find(){
        if(await this.rd.monitor(DME,0xA2,false)){this.mode=false;return true;}
        if(await this.rd.monitor(DME,0xA2,true)){this.mode=true;return true;}
        return false;
    }
    /** this driving cycle's counts per cylinder, or null (no answer: the last counts are kept) */
    async read(){
        if(this.mode===null){
            if(this.now()<this.retryAt)return null;
            if(!(await this.find())){this.retryAt=this.now()+MIS_RETRY_MS;this.why='The engine unit gave no misfire monitors - asked again in 5 min';return null;}
            this.log.info('misfire monitor: DME '+(this.mode?'UDS 22 F6xx':'OBD 06'));
        }
        if(!this.cyl){
            const sup=await this.rd.supported(DME,0xA0,this.mode);let n=0;
            while(sup&&n<12&&sup.indexOf(0xA2+n)>=0)n++;
            if(n){this.cyl=n;this.log.info('misfire monitor: '+n+' cylinders (engine unit list)');}
        }
        const out=[];
        for(let c=0;c<(this.cyl||12);c++){
            const res=await this.rd.monitor(DME,0xA2+c,this.mode);
            if(!res){
                // counting without the list: a refusal after cylinder 1 is the end of the engine; no reply is a missed round
                const r=this.rd.raws[this.rd.monitorKey(DME,0xA2+c,this.mode)];
                if(this.cyl||!c||!r||!/^NRC/.test(r.why)){this.why='No answer for cylinder '+(c+1);return null;}
                break;
            }
            const tr=res.find((x)=>x.tid===MIS_TID)||res[0];
            out.push(tr.value>=65535?null:tr.value);
        }
        if(!this.cyl){this.cyl=out.length;this.log.info('misfire monitor: '+this.cyl+' cylinders (counted)');}
        if(out.length!==this.cyl)return null;
        this.counts=out;this.at=this.now();this.why='';
        return out;
    }
    level(){return misfireLevel(this.counts);}
    total(){return this.counts?this.counts.reduce((s,n)=>s+(n||0),0):null;}
}
/** Engine power from crankshaft torque (Nm) and engine speed: kW. */
function powerKw(torque,rpm){return torque*rpm/9549;}
module.exports={CANDIDATES:C,MisfireReader,misfireLevel,powerKw,MIS_WARN,MIS_CRIT,MIS_CYL_WARN};
