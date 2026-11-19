'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const M=require('./bundled-apps/vehicle_pass/model');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vehicle-pass-test-'));
let tests=0;
function test(fn){fn();tests++;}
const entry={id:'one',kind:'oil',date:'2026-09-12',km:60000,dueKm:65000,dueDate:'2027-09-12',note:'Filter'};
try{
 test(()=>{assert(M.dateOK('2024-02-29'));assert(!M.dateOK('2026-02-29'));assert(!M.dateOK('2026-13-01'));});
 const s=new M.Store(dir);
 test(()=>{assert.strictEqual(s.data.entries.length,0);assert.strictEqual(s.error,null);});
 test(()=>{s.odometer(62500);s.save(entry);assert.strictEqual(new M.Store(dir).data.entries[0].note,'Filter');});
 test(()=>{assert.strictEqual(M.reminders(s.data,'2026-11-03')[0].remaining,2500);assert(!M.reminders(s.data,'2026-11-03')[0].overdue);});
 test(()=>{assert(M.reminders(s.data,'2027-09-12')[0].overdue);});
 test(()=>{s.odometer(65000);assert(M.reminders(s.data,'2026-11-03')[0].overdue);});
 test(()=>{s.save(Object.assign({},entry,{note:'Updated'}));assert.strictEqual(s.data.entries.length,1);assert(fs.existsSync(s.file+'.bak'));});
 test(()=>{const before=fs.readFileSync(s.file,'utf8');assert.throws(()=>s.save(Object.assign({},entry,{dueKm:59999})));assert.strictEqual(fs.readFileSync(s.file,'utf8'),before);});
 test(()=>{assert.throws(()=>s.odometer(-1));assert.throws(()=>s.odometer(NaN));assert.throws(()=>s.odometer(4.5));});
 test(()=>{s.save(Object.assign({},entry,{id:'two',date:'2026-10-01',km:64000,dueKm:null,dueDate:null}));assert.strictEqual(M.reminders(s.data,'2026-11-03').length,0);});
 test(()=>{s.remove('two');assert.strictEqual(s.data.entries.length,1);s.remove('one');assert.strictEqual(new M.Store(dir).data.entries.length,0);});
 test(()=>{fs.writeFileSync(s.file,'broken original');const broken=new M.Store(dir);assert(broken.error);assert.throws(()=>broken.odometer(1));assert.strictEqual(fs.readFileSync(s.file,'utf8'),'broken original');});
 console.log(tests+' vehicle-pass model tests passed');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
