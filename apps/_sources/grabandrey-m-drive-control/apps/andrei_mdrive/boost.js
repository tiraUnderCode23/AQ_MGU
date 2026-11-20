'use strict';
// Read-only sport-display boost; scaling follows the existing Redline reader.
class Boost {
 constructor(ctx){this.ctx=ctx;this.unit=null;this.subs=[];this.reset();}
 reset(){this.raw=null;this.at=0;this.first=null;this.moved=false;}
 observeUnits(v){
  const unit=({1:'BAR',2:'KPA',3:'PSI',BAR:'BAR',KPA:'KPA',PSI:'PSI'})[v&&v.unitOfMeasurementAirPressure]||null;
  if(unit!==this.unit){this.unit=unit;this.reset();}
 }
 observe(v,now=Date.now()){
  const raw=v&&v.displayBoostPressure;
  if(!Number.isFinite(raw)||raw<0||raw>=255){this.reset();return;}
  // Some vehicles publish a constant placeholder. Require a changing signal.
  if(this.first===null)this.first=raw;else if(raw!==this.first)this.moved=true;
  this.raw=raw;this.at=now;
 }
 value(now=Date.now()){
  if(!this.unit||!this.moved||this.raw===null||now-this.at>=2000)return null;
  return this.unit==='PSI'?this.raw*0.1/14.5038:this.raw*0.01;
 }
 async start(){
  const sources=[['de.bmw.infotainment.vehicle.Vehicle','statusNewCurrentUnitsStatusExt',v=>this.observeUnits(v)],
   ['de.bmw.infotainment.drivingexcitement.FES','statusSwitchDriveDynamicSport2',v=>this.observe(v)]];
  for(const [iface,field,observe] of sources){
   const sub=await this.ctx.signals.watch(iface,'1',{[field]:v=>{
    if(this.ctx.settings.get('demo')!=='on')observe(v);
   }},this.ctx.log,{pollMs:1000});
   this.subs.push(sub);
  }
 }
}
module.exports={Boost};
