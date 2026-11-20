'use strict';
/**
 * warmup.js - when oil, coolant and gearbox oil are warm, and how far to rev until then.
 * Ported from idrive7-apps apps/warmup (main.js limitFor / measured / eta).
 *
 *   ready in   minutes until each temperature reaches its target, from the warm-up rate measured over the
 *              last ~3 min (least squares), blended with a typical rate over the first 2 min.
 *              'off' while the engine is not running (a hybrid driving electric), 'stalled' if it stops rising.
 *   safe rpm   the cold limit at 30 °C oil, climbing linearly to the redline at "oil warm" (rounded to 100).
 *   over-rev   live rpm above the safe limit (+100 rpm margin) while the oil is cold: a warning on screen and
 *              a count for this cold start. ADVISORY ONLY: nothing is sent to the engine.
 */
const M=require('./model');
// typical warm-up rates (°C / min) until enough has been measured (upstream TYPICAL)
const TYPICAL={oil:{drive:4,idle:1.5},coolant:{drive:7,idle:3},gearbox:{drive:3,idle:0.8}};
const KEYS=['oil','coolant','gearbox'],SAMPLE_MS=5000,HIST_MS=20*60000,MARGIN=100;
function num(v,d){const n=Number(v);return isFinite(n)&&n>0?n:d;}
class WarmUp {
    constructor(store,settings,options){
        this.store=store;this.settings=settings;this.now=(options&&options.now)||Date.now;
        this.hist=[];this.lastSample=0;this.over=false;this.overCount=0;this.overPeak=null;this.wasCold=null;
    }
    target(key){return num(this.settings.get(key==='oil'?'warmOil':key==='coolant'?'warmCoolant':'warmGearbox'),key==='gearbox'?60:80);}
    live(key){const r=this.store.get(key);return r.quality==='live'&&M.finite(r.value)?r.value:null;}
    /** safe rev limit for this oil temperature, or null without one */
    limit(oil){
        if(oil===undefined)oil=this.live('oil');
        const red=num(this.settings.get('redline'),6500),cold=Math.min(num(this.settings.get('coldLimit'),3500),red),warm=this.target('oil');
        if(!M.finite(oil))return null;
        if(oil>=warm)return red;
        return Math.round((cold+(red-cold)*M.clamp((oil-30)/(warm-30),0,1))/100)*100;
    }
    /** called a few times a second (on a timer: runs while the app is hidden too) */
    update(){
        const now=this.now(),oil=this.live('oil'),rpm=this.live('rpm');
        if(now-this.lastSample>=SAMPLE_MS){
            this.lastSample=now;
            this.hist.push([now,oil,this.live('coolant'),this.live('gearbox'),rpm,this.live('speed')]);
            while(this.hist.length&&now-this.hist[0][0]>HIST_MS)this.hist.shift();
        }
        const cold=M.finite(oil)&&oil<this.target('oil');
        if(cold&&this.wasCold===false){this.overCount=0;this.overPeak=null;} // a new cold start
        if(M.finite(oil))this.wasCold=cold;
        const lim=this.limit(oil),over=!!(cold&&M.finite(rpm)&&lim&&rpm>lim+MARGIN);
        if(over&&!this.over){this.overCount++;}
        if(over)this.overPeak=Math.max(this.overPeak||0,rpm);
        this.over=over;
        return over;
    }
    /** °C per minute over the last ~3 min */
    measured(idx){
        const last=this.hist.length?this.hist[this.hist.length-1][0]:0;
        const pts=this.hist.filter((h)=>M.finite(h[idx])&&last-h[0]<180000);
        if(pts.length<4)return {rate:null,span:0};
        const n=pts.length,mx=pts.reduce((a,p)=>a+p[0],0)/n,my=pts.reduce((a,p)=>a+p[idx],0)/n;
        let nu=0,de=0;pts.forEach((p)=>{nu+=(p[0]-mx)*(p[idx]-my);de+=(p[0]-mx)*(p[0]-mx);});
        return {rate:de?nu/de*60000:null,span:pts[n-1][0]-pts[0][0]};
    }
    /** { state: none|ready|off|stalled|warming, min, rate, est } */
    eta(key){
        const temp=this.live(key),target=this.target(key);
        if(!M.finite(temp))return {state:'none'};
        if(temp>=target)return {state:'ready',temp,target};
        const rpm=this.live('rpm'),speed=this.live('speed');
        if(M.finite(rpm)&&rpm<300)return {state:'off',temp,target};
        const m=this.measured(KEYS.indexOf(key)+1);
        const typ=TYPICAL[key][M.finite(speed)&&speed>10?'drive':'idle'];
        const w=M.clamp(m.span/120000,0,1),rate=M.finite(m.rate)?w*m.rate+(1-w)*typ:typ;
        if(w>0.8&&rate<0.15)return {state:'stalled',temp,target,rate};
        return {state:'warming',temp,target,rate,min:(target-temp)/Math.max(0.15,rate),est:w<0.5};
    }
    ready(){return KEYS.every((k)=>{const e=this.eta(k);return e.state==='ready'||e.state==='none';})&&this.eta('oil').state==='ready';}
}
module.exports={WarmUp,TYPICAL};
