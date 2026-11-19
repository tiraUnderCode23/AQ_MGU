'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const M=require('./bundled-apps/vehicle_pass/model');
const dir=fs.mkdtempSync(path.join(__dirname,'profile-test-'));let n=0;
function test(fn){fn();n++;}
try{
 const file=path.join(dir,'vehicle-pass.json');
 const old={schema:1,odometer:62500,entries:[{id:'old',kind:'oil',date:'2026-09-12',km:60000,dueKm:65000,dueDate:null,note:'Keep me'}]};
 const bytes=JSON.stringify(old);fs.writeFileSync(file,bytes);
 const s=new M.Store(dir);
 test(()=>{assert.strictEqual(s.error,null);assert.strictEqual(s.data.schema,2);assert.deepStrictEqual(s.data.entries,old.entries);assert.strictEqual(fs.readFileSync(file,'utf8'),bytes);});
 test(()=>{assert.strictEqual(s.data.tyres.summer.frontBar,null);assert.strictEqual(s.data.profile.engineOil,'');});
 test(()=>{s.profile({model:'BMW F40',modifications:'Felgen',engineOil:'Eigenes Öl',oilApproval:'Eigene Angabe',partNumbers:'Eigene Teilenummer'});assert.strictEqual(new M.Store(dir).data.profile.model,'BMW F40');assert.strictEqual(fs.readFileSync(file+'.bak','utf8'),bytes);});
 test(()=>{const t={frontSize:'225/40 R18',rearSize:'225/40 R18',mountedOn:'2026-10-21',frontBar:2.3,rearBar:2.5,loadNote:'Beispielwerte für Test'};s.tyres('winter',t);s.activeTyres('winter');assert.deepStrictEqual(new M.Store(dir).data.tyres.winter,t);assert.strictEqual(new M.Store(dir).data.activeTyres,'winter');assert.strictEqual(s.data.entries[0].note,'Keep me');});
 test(()=>{assert.strictEqual(s.data.tyres.summer.frontBar,null);assert.strictEqual(s.data.tyres.allseason.frontBar,null);});
 test(()=>{const before=fs.readFileSync(file,'utf8');assert.throws(()=>s.tyres('summer',Object.assign({},s.data.tyres.summer,{frontBar:NaN})));assert.throws(()=>s.tyres('summer',Object.assign({},s.data.tyres.summer,{frontBar:-1})));assert.throws(()=>s.tyres('summer',Object.assign({},s.data.tyres.summer,{frontBar:2.345})));assert.strictEqual(fs.readFileSync(file,'utf8'),before);});
 test(()=>{assert.throws(()=>s.tyres('invalid',s.data.tyres.summer));assert.throws(()=>s.activeTyres('invalid'));});
 test(()=>{assert.throws(()=>s.tyres('summer',Object.assign({},s.data.tyres.summer,{mountedOn:'2026-02-31'})));});
 test(()=>{assert.throws(()=>s.profile(Object.assign({},s.data.profile,{partNumbers:'a'.repeat(241)})));});
 test(()=>{s.odometer(63000);s.save(Object.assign({},old.entries[0],{note:'Updated'}));assert.strictEqual(s.data.profile.model,'BMW F40');assert.strictEqual(s.data.tyres.winter.frontBar,2.3);assert.strictEqual(fs.readFileSync(file+'.v1.bak','utf8'),bytes);});
 test(()=>{s.tyres('winter',Object.assign({},s.data.tyres.winter,{frontBar:null,mountedOn:null}));assert.strictEqual(new M.Store(dir).data.tyres.winter.frontBar,null);});
 test(()=>{fs.writeFileSync(file,'{"schema":99}');const broken=new M.Store(dir);assert(broken.error);assert.throws(()=>broken.profile(M.base().profile));assert.strictEqual(fs.readFileSync(file,'utf8'),'{"schema":99}');});
 console.log(n+' migration/profile/tyre tests passed');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
