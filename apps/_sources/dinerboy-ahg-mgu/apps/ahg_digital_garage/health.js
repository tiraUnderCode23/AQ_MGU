'use strict';
/**
 * health.js - Vehicle Health: one verdict from the fault memory, the live readings and the service book.
 *
 * Each check is ok / soon (look at it) / due (act on it) / unknown. Limits are advisory and loose: the car's own
 * warnings always come first. The headline is what matters most: active faults, then overdue service, then the
 * rest; "No active faults" when all is well.
 */
const LIMITS={v12Low:11.8,v12Soft:12.2,v12High:15.3,coolantWarn:115,coolantHot:120,oilWarn:125,oilHot:135,scanOldDays:30};
function check(id,name,status,detail){return {id,name,status,detail};}
function evaluate(book,live,scanner,now){
    now=now||Date.now();const out=[];
    // fault memory
    const result=scanner&&scanner.result;
    const r=result&&result.units&&result.units.some((u)=>u.ok)?result:null;
    if(!r)out.push(check('faults','Fault memory','unknown','Not scanned yet'));
    else{
        const age=(now-(r.at||0))/86400000;
        // stored (not active) faults are history: listed on Diagnostics, not a health problem by themselves
        const st=r.active?'due':age>LIMITS.scanOldDays?'soon':'ok';
        out.push(check('faults','Fault memory',st,(r.active?r.active+' active':'No active faults')+(r.stored?' · '+r.stored+' stored':'')+' · '+r.units.length+' units'));
    }
    // service
    const sched=book.schedule().filter((x)=>x.s.status!=='off');
    const due=sched.filter((x)=>x.s.status==='due'),soon=sched.filter((x)=>x.s.status==='soon'),unset=sched.filter((x)=>x.s.status==='unknown');
    out.push(check('service','Service',due.length?'due':soon.length?'soon':unset.length===sched.length?'unknown':'ok',
        due.length?due.map((x)=>x.item.name).join(', ')+' overdue':soon.length?soon.map((x)=>x.item.name).join(', ')+' soon':unset.length===sched.length?'No service history yet':'Nothing due'));
    // 12 V
    const v=live.get('v12');
    out.push(v==null?check('v12','12 V battery','unknown','No reading'):
        check('v12','12 V battery',v<LIMITS.v12Low||v>LIMITS.v12High?'due':v<LIMITS.v12Soft?'soon':'ok',v.toFixed(1)+' V'));
    // temperatures
    const c=live.get('coolant'),o=live.get('oil');
    if(c==null&&o==null)out.push(check('temps','Engine temperatures','unknown','No temperature readings'));
    else{const st=(c!=null&&c>=LIMITS.coolantHot)||(o!=null&&o>=LIMITS.oilHot)?'due':(c!=null&&c>=LIMITS.coolantWarn)||(o!=null&&o>=LIMITS.oilWarn)?'soon':'ok';
        out.push(check('temps','Engine temperatures',st,'Oil '+(o==null?'--':Math.round(o)+' °C')+' · Coolant '+(c==null?'--':Math.round(c)+' °C')));}
    // HV battery
    const soc=live.get('soc');
    out.push(soc==null?check('hv','HV battery','unknown','No reading'):check('hv','HV battery','ok',Math.round(soc)+' % charge'));
    const rank={due:3,soon:2,ok:1,unknown:0};
    const worst=out.reduce((w,x)=>rank[x.status]>rank[w]?x.status:w,'unknown');
    let headline;
    if(r&&r.active)headline=r.active+' active fault'+(r.active>1?'s':'');
    else if(due.length)headline='Service overdue';
    else if(worst==='due')headline='Needs attention';
    else if(r)headline='No active faults';
    else headline='Not scanned yet';
    return {status:worst,headline:headline,checks:out};
}
module.exports={evaluate,LIMITS};
