'use strict';
const M=require('./model'),E=require('./engine');
const CDS='de.bmw.infotainment.vehicle.CDS', VEHICLE='de.bmw.infotainment.vehicle.Vehicle2';
const FES='de.bmw.infotainment.drivingexcitement.FES',UNITS='de.bmw.infotainment.vehicle.Vehicle';
const BDS='de.bmw.infrastructure.analytics.BasicDataSet',EFF='de.bmw.infotainment.drivingexcitement.Efficiencytainment2',LSC='de.bmw.infotainment.lsc.LSCDataSink';
// Passive SOME/IP sources from idrive7-apps live_data/signals.js and edrive/main.js.
// Boost (sport display): 0.01 bar or 1 kPa a step, 0.1 psi a step in the car's pressure unit; 255 = no value.
const PRESS_UNITS={1:'BAR',2:'KPA',3:'PSI'};
/** every entry holding `key`, however the list arrives (plain, wrapped, single) - as edrive/main.js */
function entries(v,key,out){out=out||[];if(v&&typeof v==='object'){if(key in v)out.push(v);else Object.keys(v).forEach((k)=>entries(v[k],key,out));}return out;}
function one(v,key){const e=entries(v,key)[0];return e?e[key]:undefined;}
const {flapFor,modeName}=require('./ec_auto');
function convert(raw,factor,offset,invalid,min,max) {
    if(!M.finite(raw) || raw===invalid) return null;
    const value=raw*factor+offset;
    return value>=min && value<=max?value:null;
}
class MockProvider {
    constructor(store,hz) { this.store=store;this.hz=hz;this.startTime=Date.now();this.timer=null;this.visible=true; }
    sample(t) {
        const s=t==null?(Date.now()-this.startTime)/1000:t;
        const wave=(1+Math.sin(s*0.34-0.4))/2;
        const data={oil:102+8*Math.sin(s*0.05),coolant:91+3*Math.sin(s*0.09),voltage:14.2+0.12*Math.sin(s*0.17),
            rpm:1200+4300*wave,speed:38+72*wave,hv_soc:72-1.2*Math.sin(s*0.01),ev_range:31,
            electric_kw:18*Math.sin(s*0.18),regen_kw:Math.min(0,18*Math.sin(s*0.18)),fuel:4.1,
            energy_used:4.2,electric_share:68,drive_source:'Hybrid',drive_mode:'Sport',charging:'Not connected',charge_energy:9.8,
            baro_bar:1.013,manifold_bar:1.013+0.78+0.64*Math.sin(s*0.3),
            iat:34+6*wave,hpfp:60+240*wave,lpfp:5.2-0.3*wave,timing:8+14*(1-wave),load:22+150*wave,load_target:20+155*wave,
            boost_target:0.05+1.15*wave,boost_actual:0.03+1.1*wave+0.04*Math.sin(s*2),eng_torque:60+290*wave,
            eng_power:(60+290*wave)*(1200+4300*wave)/9549,power_pct:Math.round(15+75*wave),misfire_total:3,
            gearbox:78+4*Math.sin(s*0.04),hv_v:352-0.12*18*Math.sin(s*0.18),hv_temp:24,edrive_pct:Math.round(60*Math.sin(s*0.18)),regen_energy:0.6};
        Object.keys(data).forEach((k)=>this.store.put(k,data[k],'mock','Deterministic emulator/demo model'));
        const boost=M.boostFrom(this.store.get('manifold_bar'),this.store.get('baro_bar'));
        this.store.put('boost',boost,'mock','DEMO: manifold absolute minus atmospheric pressure');
    }
    start() { this.sample();this.schedule(); }
    schedule() { clearInterval(this.timer);this.timer=setInterval(()=>this.sample(),this.visible?1000/this.hz:1000); }
    setVisible(visible) { if(this.visible!==visible){this.visible=visible;this.schedule();} }
    stop() { clearInterval(this.timer);this.timer=null; }
    capabilities() { return {mode:'demo',vehicleWrites:false}; }
}
class MguProvider {
    constructor(ctx,store) { this.ctx=ctx;this.store=store;this.subscriptions=[];this.timers=[];this.stopped=false;this.generation=0; }
    start() {
        this.stopped=false;const generation=++this.generation;this.pressUnit=null;
        const source=process.env.AHG_EMULATOR==='1'?'mock':'mgu';
        const put=(key,value,provenance)=>{ if(!this.stopped && generation===this.generation) this.store.put(key,value,source,provenance); };
        this.subscribe(CDS,{
            statusEngineSpeed2:(v)=>put('rpm',convert(v.actualValueRPMEngineCrankshaft,0.25,0,65535,0,12000),CDS+'.statusEngineSpeed2 raw * 0.25'),
            statusEngineTemperature:(v)=>{
                put('oil',convert(v.temperatureEngineOilDrive,1,-48,255,-40,170),CDS+'.statusEngineTemperature.temperatureEngineOilDrive raw - 48');
                put('coolant',convert(v.temperatureEngineDrive,1,-48,255,-40,170),CDS+'.statusEngineTemperature.temperatureEngineDrive raw - 48');
            }
        },1000,generation);
        this.subscribe(VEHICLE,{statusCarSpeed2:(v)=>put('speed',convert(v.speedVehicleCentreOfGravity,1/64,0,65535,0,400),VEHICLE+'.statusCarSpeed2 raw / 64')},1000,generation);
        this.subscribe(FES,{statusFESVehicleDynamicSwitchHMI:(v)=>{
            const raw=v&&v.actualValueModeDrivingExperience;
            put('drive_mode',flapFor(raw)?modeName(raw):null,FES+'.statusFESVehicleDynamicSwitchHMI');
        },statusSwitchDriveDynamicSport2:(v)=>{
            const raw=v&&v.displayBoostPressure,k=this.pressUnit==='PSI'?0.1/14.5038:0.01;
            if(!this.loggedBoost){this.loggedBoost=true;const L=this.ctx.log;(L.info||L.warn).call(L,'raw FES boost: '+JSON.stringify(raw));}
            if(!M.finite(raw)||raw===255)return; // no sport-display boost: the DME fallback (hybrid.js) fills it
            // a value that never moves (0 with the sport display off) is not trusted, as car_vitals
            if(raw!==0)this.fesBoostMoved=true;if(!this.fesBoostMoved)return;
            put('boost',M.finite(raw)&&raw!==255?raw*k:null,FES+'.statusSwitchDriveDynamicSport2.displayBoostPressure ('+(this.pressUnit||'BAR?')+')');
        },
        // sport display power (% of the car's maximum) and crankshaft torque (car_vitals config.scaling sportPct / torque)
        statusVehicleDynamicEngine:(v)=>{
            const p=v&&v.displaySportEnginePower;
            put('power_pct',convert(p,1,0,255,0,120),FES+'.statusVehicleDynamicEngine.displaySportEnginePower (%)');
        },
        statusActualValueTorque2:(v)=>{
            const raw=v&&v.actualValueTorqueCrankshaft;
            if(!M.finite(raw)||raw===65535||raw>=4095){put('eng_torque',null,FES+'.statusActualValueTorque2');return;}
            const tq=Math.max(0,raw*0.5-1023.5);
            put('eng_torque',tq,FES+'.statusActualValueTorque2.actualValueTorqueCrankshaft * 0.5 - 1023.5');
            const r=this.store.get('rpm');
            // engine power from crank torque x engine speed (the 530e's e-motor sits behind the crank: engine only)
            if(r.quality==='live'&&M.finite(r.value))put('eng_power',r.value>400?E.powerKw(tq,r.value):0,'Crank torque x engine speed / 9549');
        }},1000,generation);
        this.subscribe(UNITS,{statusNewCurrentUnitsStatusExt:(v)=>{
            const x=v&&v.unitOfMeasurementAirPressure;this.pressUnit=PRESS_UNITS[x]||(['BAR','KPA','PSI'].indexOf(x)>=0?x:null);
        }},1000,generation);
        this.subscribe(EFF,{statusBatteryTemperature:(v)=>{
            const raw=one(v,'actualValueTemperatureHighVoltageStorage');
            const t=M.finite(raw)&&raw!==255?raw-50:null;
            put('hv_temp',t!=null&&t>-30&&t<70?t:null,EFF+'.statusBatteryTemperature raw - 50');
        },statusPowerRelativHybrid:(v)=>{
            const e=entries(v,'displayActualValuePowerRelativeDrivingElectric')[0];if(!e)return;
            const d=e.displayActualValuePowerRelativeDrivingElectric,r=e.displayActualValuePowerRelativeRecuperation;
            if(M.finite(d)&&M.finite(r)&&d<=254&&r<=254)put('edrive_pct',d>0?d:-r,EFF+'.statusPowerRelativHybrid (cluster eDRIVE needle)');
        }},1000,generation);
        // gearbox oil from the car's BasicDataSet (°C + 48, 255 = none), only once it moves (some cars leave it fixed),
        // and only while the gearbox unit (hybrid.js, EGS 22 6000) isn't answering
        let gearFirst=null,gearMoved=false;
        this.subscribe(BDS,{basicDataSet:(v)=>{
            const raw=v&&v.valueTemperatureTransmissionOil;if(!M.finite(raw)||raw===255)return;const t=raw-48;
            if(gearFirst==null)gearFirst=t;if(Math.abs(t-gearFirst)>=1)gearMoved=true;
            const cur=this.store.get('gearbox');
            if(gearMoved&&!(cur.quality==='live'&&String(cur.provenance).indexOf('EGS')===0))put('gearbox',t,BDS+'.basicDataSet.valueTemperatureTransmissionOil - 48');
        }},1000,generation);
        this.subscribe(LSC,{statusHighVoltageStorage:(v)=>{
            const x=one(v,'actualValueVoltageHighVoltageStorage');if(!M.finite(x))return;
            const volts=x>1500?x/10:x,cur=this.store.get('hv_v');
            if(volts>150&&volts<500&&!(cur.quality==='live'&&String(cur.provenance).indexOf('SME')===0))put('hv_v',volts,LSC+'.statusHighVoltageStorage');
        }},1000,generation);
    }
    subscribe(iface,handlers,delay,generation) {
        if(this.stopped || generation!==this.generation) return;
        // BMW fields may notify only when the value changes. Read their getters
        // periodically so a steady/parked value can satisfy the freshness guard.
        this.ctx.signals.watch(iface,'1',handlers,this.ctx.log,{pollMs:1000}).then((sub)=>{
            if(this.stopped || generation!==this.generation){if(sub.shutdown)sub.shutdown();return;}
            if(sub.error){
                if(sub.shutdown)sub.shutdown();
                const timer=setTimeout(()=>this.subscribe(iface,handlers,Math.min(delay*2,30000),generation),delay);
                this.timers.push(timer);
            } else this.subscriptions.push(sub);
        }).catch((error)=>{
            this.ctx.log.warn('Read-only subscription: '+String(error));
            if(!this.stopped && generation===this.generation)this.timers.push(setTimeout(()=>this.subscribe(iface,handlers,Math.min(delay*2,30000),generation),delay));
        });
    }
    setVisible() {}
    stop() { this.stopped=true;this.generation++;this.timers.forEach(clearTimeout);this.timers=[];
        this.subscriptions.forEach((s)=>{if(s.shutdown)s.shutdown();});this.subscriptions=[]; }
    capabilities() { return {mode:'read-only',signals:['rpm','oil','coolant','speed','drive_mode','boost','hv_temp','edrive_pct','hv_v','power_pct','eng_torque','eng_power'],vehicleWrites:false}; }
}
module.exports={MockProvider,MguProvider,convert};
