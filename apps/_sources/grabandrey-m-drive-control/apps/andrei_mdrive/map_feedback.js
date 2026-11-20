'use strict';
const slot=v=>Number.isInteger(v)&&v>=1&&v<=4;
function get(obj,path){return String(path||'').split('.').reduce((o,k)=>o==null?undefined:o[k],obj);}
class MapFeedback {
 constructor(ctx){this.ctx=ctx;this.active=null;this.activeAt=0;this.preview=null;this.menu=false;this.menuAt=0;this.subs=[];this.configured=false;this.generation=0;}
 reset(){this.active=null;this.activeAt=0;this.preview=null;this.menu=false;this.menuAt=0;this.generation++;}
 observeActive(value,now){this.active=slot(value)?value:null;this.activeAt=now==null?Date.now():now;}
 observeCluster(menu,page,rpm,now){
  this.menu=menu===true;this.menuAt=now==null?Date.now():now;this.preview=null;
  // The MHD menu reuses RPM for flaps/ethanol too. Never decode RPM without its map-page gate.
  if(!this.menu||page!==1||!Number.isFinite(rpm))return;
  const n=Math.round(rpm/1000);if(slot(n)&&Math.abs(rpm-n*1000)<=35)this.preview=n;
 }
 view(requested,demo,now){
  now=now==null?Date.now():now;
  if(demo)return {active:requested,requested:null,label:requested?'Demo '+requested:'Demo'};
  const active=this.activeAt&&now-this.activeAt<5000?this.active:null;
  const preview=this.menu&&now-this.menuAt<2500?this.preview:null;
  return {active,requested,preview,label:preview?'Cluster selecting '+preview:active?'Active map '+active:requested?'Last request: '+requested:'Live map unavailable'};
 }
 async start(){
  const p=this.ctx.spec.config&&this.ctx.spec.config.mapFeedback;
  if(!p||p.verified!==true)return; // A vehicle-validated profile is required.
  const sources=p.signals||[];
  for(const source of sources){
   if(!source.iface||!source.field||(!source.activePath&&!source.menuPath))continue;
   const sub=await this.ctx.signals.watch(source.iface,String(source.instance||'1'),{[source.field]:v=>{
    if(this.ctx.settings.get('demo')==='on')return;
    if(source.activePath){const raw=get(v,source.activePath),value=typeof raw==='number'?raw+(source.zeroBased?1:0):null;this.observeActive(value);}
    if(source.menuPath&&source.pagePath&&source.rpmPath){this.observeCluster(get(v,source.menuPath)===source.menuActiveValue,get(v,source.pagePath)===source.mapPageValue?1:null,get(v,source.rpmPath)*(source.rpmFactor||1));}
   }},this.ctx.log,{pollMs:500});
   this.subs.push(sub);if(!sub.error)this.configured=true;
  }
 }
}
module.exports={MapFeedback};
