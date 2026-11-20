'use strict';
const DEFINITIONS = {
    boost: {label:'Boost',unit:'bar',min:0,max:2,major:0.5,minor:0.1,decimals:2,hot:1.5},
    oil: {label:'Oil temperature',unit:'°C',min:50,max:150,major:20,minor:5,decimals:0,hot:125},
    // App advisory colours, not BMW's calibrated overheating thresholds.
    coolant: {label:'Coolant',unit:'°C',min:50,max:130,major:20,minor:5,decimals:0,warn:115,hot:120},
    voltage: {label:'12 V system',unit:'V',min:10,max:16,major:1,minor:0.2,decimals:1,hot:15,staleMs:15000},
    rpm: {label:'Engine speed',unit:'rpm',min:0,max:8000,major:2000,minor:200,decimals:0,hot:6500},
    speed: {label:'Speed',unit:'km/h',min:0,max:240,major:40,minor:10,decimals:0,hot:200},
    hv_soc:{label:'HV battery',unit:'%',min:0,max:100,major:25,minor:5,decimals:0,staleMs:25000},
    ev_range:{label:'EV range',unit:'km',decimals:0}, electric_kw:{label:'Electric power',unit:'kW',min:-60,max:100,major:20,minor:5,decimals:1},
    regen_kw:{label:'Recuperation',unit:'kW',decimals:1}, fuel:{label:'Trip consumption',unit:'L/100 km',decimals:1},
    energy_used:{label:'Trip energy',unit:'kWh',decimals:1}, regen_energy:{label:'Recovered energy',unit:'kWh',decimals:1},
    gearbox:{label:'Gearbox oil',unit:'°C',min:0,max:150,major:25,minor:5,decimals:0,hot:120,staleMs:20000}, hv_v:{label:'HV voltage',unit:'V',decimals:0}, hv_temp:{label:'HV battery temp',unit:'°C',min:-10,max:60,major:10,minor:5,decimals:0,hot:45}, edrive_pct:{label:'eDRIVE needle',unit:'%',decimals:0}, electric_share:{label:'Electric distance',unit:'%',decimals:0},
    drive_source:{label:'Drive source',unit:''}, drive_mode:{label:'Drive mode',unit:''},
    charging:{label:'Charging',unit:''}, charge_energy:{label:'Last charge energy',unit:'kWh',decimals:1},
    manifold_bar:{label:'Manifold absolute',unit:'bar abs'},
    // engine.js (DME, read-only) and the sport display (FES)
    iat:{label:'Intake air',unit:'°C',min:0,max:100,major:20,minor:5,decimals:0,hot:70,staleMs:12000},
    hpfp:{label:'High pressure fuel',unit:'bar',min:0,max:400,major:100,minor:20,decimals:0,staleMs:12000},
    lpfp:{label:'Low pressure fuel',unit:'bar',min:0,max:8,major:2,minor:0.5,decimals:1,staleMs:12000},
    timing:{label:'Ignition timing',unit:'°',min:-20,max:40,major:10,minor:2,decimals:1,staleMs:12000},
    load:{label:'Engine load',unit:'%',min:0,max:200,major:50,minor:10,decimals:0,staleMs:12000},
    load_target:{label:'Load target',unit:'%',min:0,max:200,major:50,minor:10,decimals:0,staleMs:12000},
    boost_target:{label:'Boost target',unit:'bar',min:0,max:2,major:0.5,minor:0.1,decimals:2,staleMs:12000},
    boost_actual:{label:'Boost actual',unit:'bar',min:0,max:2,major:0.5,minor:0.1,decimals:2,staleMs:12000},
    eng_torque:{label:'Engine torque',unit:'Nm',min:0,max:400,major:100,minor:20,decimals:0},
    eng_power:{label:'Engine power',unit:'kW',min:0,max:200,major:50,minor:10,decimals:0},
    power_pct:{label:'Sport display power',unit:'%',min:0,max:100,major:25,minor:5,decimals:0},
    misfire_total:{label:'Misfires (cycle)',unit:'',min:0,max:500,major:100,minor:25,decimals:0,hot:100,staleMs:70000}, baro_bar:{label:'Atmospheric',unit:'bar abs'}
};
function finite(v) { return typeof v === 'number' && isFinite(v); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function angle(v, lo, hi) { return 140 + clamp((v-lo)/(hi-lo),0,1)*260; }
function damp(value, target, dt) { return value + (target-value)*(1-Math.exp(-clamp(dt,0,0.5)/0.11)); }
function format(reading, decimals) { return reading && reading.quality === 'live' && reading.value != null ?
    (finite(reading.value) ? reading.value.toFixed(decimals == null ? 0 : decimals) : String(reading.value)) : '--'; }
class SignalStore {
    constructor(now) { this.now=now || Date.now; this.clear(); }
    clear() { this.values=Object.create(null); }
    put(key,value,source,provenance) {
        if(!DEFINITIONS[key]) return;
        const valid=typeof value==='string' || finite(value);
        this.values[key]={key:key,value:valid?value:null,unit:DEFINITIONS[key].unit,timestampMs:this.now(),
            source:source,quality:valid?'live':'error',provenance:provenance || source};
    }
    get(key) {
        const r=this.values[key];
        if(!r) return {key:key,value:null,unit:(DEFINITIONS[key]||{}).unit || '',timestampMs:null,source:null,quality:'unsupported',provenance:'No verified source'};
        const age=Math.max(0,this.now()-r.timestampMs);
        // slow reads (HV charge every 10 s, 12 V every 5 s) stay fresh for their own period
        const limit=(DEFINITIONS[key]&&DEFINITIONS[key].staleMs)||3000;
        return Object.assign({},r,{quality:r.quality==='live' && age>limit?'stale':r.quality,ageMs:age});
    }
    rows() { return Object.keys(DEFINITIONS).map((k)=>this.get(k)); }
}
function boostFrom(map,baro) {
    if(!map || !baro || map.quality!=='live' || baro.quality!=='live' || !finite(map.value) || !finite(baro.value) ||
        map.unit!=='bar abs' || baro.unit!=='bar abs' || map.source!==baro.source || baro.value<0.7 || baro.value>1.2) return null;
    return map.value-baro.value;
}
module.exports={DEFINITIONS,finite,clamp,angle,damp,format,SignalStore,boostFrom};
