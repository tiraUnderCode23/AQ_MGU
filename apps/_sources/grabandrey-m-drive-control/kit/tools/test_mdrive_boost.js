'use strict';
const assert=require('assert');
const {Boost}=require('../../apps/andrei_mdrive/boost');
async function main(){
 let demo='off';const handlers={};
 const b=new Boost({settings:{get:()=>demo},log:{},signals:{watch:async(i,n,h)=>{Object.assign(handlers,h);return {};}}});
 b.observe({displayBoostPressure:100},100);b.observe({displayBoostPressure:120},200);
 assert.equal(b.value(201),null); // Never guess the car's pressure unit.
 for(const unit of [1,2,3]){
  b.observeUnits({unitOfMeasurementAirPressure:unit});
  b.observe({displayBoostPressure:100},100);assert.equal(b.value(101),null);
  b.observe({displayBoostPressure:120},200);
  assert(Math.abs(b.value(201)-(unit===3?12/14.5038:1.2))<1e-9);
  assert.equal(b.value(2200),null);
  for(const invalid of [255,-1,NaN,Infinity,null]){b.observe({displayBoostPressure:invalid},300);assert.equal(b.value(301),null);}
 }
 await b.start();demo='on';handlers.statusSwitchDriveDynamicSport2({displayBoostPressure:80});assert.equal(b.raw,null);
 demo='off';handlers.statusNewCurrentUnitsStatusExt({unitOfMeasurementAirPressure:1});
 handlers.statusSwitchDriveDynamicSport2({displayBoostPressure:90});handlers.statusSwitchDriveDynamicSport2({displayBoostPressure:110});
 assert.equal(b.value(),1.1);b.reset();assert.equal(b.value(),null);
 console.log('PASS: boost unit conversion, unknown units, constant/invalid/stale signals, subscriptions and demo isolation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
