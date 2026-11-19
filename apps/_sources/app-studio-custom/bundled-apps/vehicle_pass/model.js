'use strict';
const fs=require('fs'),path=require('path');
const TYPES=['oil','brakes','fluid','plugs','inspection','tyres','other'];
const SETS=['summer','winter','allseason'];
const PROFILE_LIMITS={model:60,modifications:240,engineOil:80,oilApproval:80,partNumbers:240};
function dateOK(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00Z');return isFinite(d.getTime())&&d.toISOString().slice(0,10)===s&&+s.slice(0,4)>=2000&&+s.slice(0,4)<=2100;}
function kmOK(n){return Number.isInteger(n)&&n>=0&&n<=2000000;}
function textOK(s,n){return typeof s==='string'&&s.length<=n&&!/[\x00-\x1f]/.test(s);}
function blankTyres(){return {frontSize:'',rearSize:'',mountedOn:null,frontBar:null,rearBar:null,loadNote:''};}
function blankProfile(){return {model:'',modifications:'',engineOil:'',oilApproval:'',partNumbers:''};}
function base(){return {schema:2,odometer:0,entries:[],profile:blankProfile(),activeTyres:'summer',tyres:{summer:blankTyres(),winter:blankTyres(),allseason:blankTyres()}};}
function validateEntries(data){
 if(!kmOK(data.odometer)||!Array.isArray(data.entries)||data.entries.length>500)throw Error('Invalid data');
 const ids=new Set();data.entries.forEach(e=>{if(!e||typeof e.id!=='string'||!e.id||ids.has(e.id)||TYPES.indexOf(e.kind)<0||!dateOK(e.date)||!kmOK(e.km)||(e.dueKm!==null&&(!kmOK(e.dueKm)||e.dueKm<=e.km))||(e.dueDate!==null&&(!dateOK(e.dueDate)||e.dueDate<=e.date))||!textOK(e.note,80))throw Error('Invalid entry');ids.add(e.id);});
}
function validate(data){
 if(!data||data.schema!==2)throw Error('Unsupported schema');validateEntries(data);
 if(!data.profile||!data.tyres||SETS.indexOf(data.activeTyres)<0)throw Error('Invalid profile');
 Object.keys(PROFILE_LIMITS).forEach(k=>{if(!textOK(data.profile[k],PROFILE_LIMITS[k]))throw Error('Invalid profile text');});
 SETS.forEach(k=>{const t=data.tyres[k];if(!t||!textOK(t.frontSize,48)||!textOK(t.rearSize,48)||!textOK(t.loadNote,100)||(t.mountedOn!==null&&!dateOK(t.mountedOn)))throw Error('Invalid tyres');['frontBar','rearBar'].forEach(p=>{if(t[p]!==null&&(!Number.isFinite(t[p])||t[p]<=0||t[p]>10||Math.abs(t[p]*10-Math.round(t[p]*10))>0.000001))throw Error('Invalid pressure');});});
 return data;
}
function migrate(data){
 if(!data)throw Error('Invalid data');
 if(data.schema===1){validateEntries(data);return validate(Object.assign(base(),JSON.parse(JSON.stringify(data)),{schema:2,profile:blankProfile(),activeTyres:'summer',tyres:{summer:blankTyres(),winter:blankTyres(),allseason:blankTyres()}}));}
 return validate(data);
}
function history(data){return data.entries.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.km-a.km||b.id.localeCompare(a.id));}
function reminders(data,today){const seen=new Set();return history(data).filter(e=>{if(seen.has(e.kind))return false;seen.add(e.kind);return e.dueKm!==null||e.dueDate!==null;}).map(e=>({entry:e,remaining:e.dueKm===null?null:e.dueKm-data.odometer,overdue:(e.dueKm!==null&&data.odometer>=e.dueKm)||(e.dueDate!==null&&today>=e.dueDate)})).sort((a,b)=>Number(b.overdue)-Number(a.overdue));}
class Store{
 constructor(dir){this.file=path.join(dir,'vehicle-pass.json');this.error=null;this.legacy=false;this.data=base();try{const raw=JSON.parse(fs.readFileSync(this.file,'utf8'));this.data=migrate(raw);this.legacy=raw.schema===1;}catch(e){if(e.code!=='ENOENT')this.error=e;}}
 commit(next){if(this.error)throw Error('Data unreadable; original preserved');validate(next);const tmp=this.file+'.tmp',fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(next,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(this.legacy&&!fs.existsSync(this.file+'.v1.bak'))fs.copyFileSync(this.file,this.file+'.v1.bak');if(fs.existsSync(this.file))fs.copyFileSync(this.file,this.file+'.bak');fs.renameSync(tmp,this.file);this.data=JSON.parse(JSON.stringify(next));this.legacy=false;}
 save(entry){const next=JSON.parse(JSON.stringify(this.data));next.entries=next.entries.filter(e=>e.id!==entry.id);next.entries.push(entry);this.commit(next);}
 remove(id){this.commit(Object.assign({},this.data,{entries:this.data.entries.filter(e=>e.id!==id)}));}
 odometer(n){this.commit(Object.assign({},this.data,{odometer:n}));}
 profile(p){this.commit(Object.assign({},this.data,{profile:p}));}
 tyres(key,t){if(SETS.indexOf(key)<0)throw Error('Unknown tyre set');const next=JSON.parse(JSON.stringify(this.data));next.tyres[key]=t;this.commit(next);}
 activeTyres(key){this.commit(Object.assign({},this.data,{activeTyres:key}));}
}
module.exports={TYPES,SETS,PROFILE_LIMITS,base,dateOK,kmOK,validate,migrate,history,reminders,Store};
