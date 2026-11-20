'use strict';
/**
 * book.js - the car's service book: what the Digital Garage remembers between drives.
 *
 * Kept as JSON in the app's data folder (garage.json, written atomically):
 *   vehicle   model / type / power / year (shown in the header), VIN once read from the car
 *   odometer  km, when, and where it came from: 'car' (read from the DME), 'estimated' (the last known value plus
 *             the distance driven since, from the speed signal) or 'manual' (set on the Vehicle Info page)
 *   items     service items with an interval in km and / or months and when they were last done
 *   records   the history: services done, fault scans, modifications, odometer corrections (newest first)
 *   mods      the modification catalogue with what is fitted
 *
 * Due dates follow the item's own interval: whichever of distance and time runs out first. "Soon" is within
 * SOON_KM or SOON_DAYS. An item never marked as done has no due date ("Not set") until it is.
 */
const fs=require('fs'),path=require('path');
const DAY=86400000,MONTH=30.4375*DAY;
const KM_PER_DAY=41,SOON_KM=1500,SOON_DAYS=30,MAX_RECORDS=300;
const ITEMS=[
    {id:'oil',name:'Engine Oil',icon:'oil',km:15000,months:12},
    {id:'brakes',name:'Brake Service',icon:'brake',km:50000,months:0},
    {id:'brake_fluid',name:'Brake Fluid',icon:'drop',km:0,months:24},
    {id:'air_filter',name:'Air Filter',icon:'filter',km:60000,months:48},
    {id:'cabin_filter',name:'Cabin Filter',icon:'fan',km:30000,months:24},
    {id:'spark_plugs',name:'Spark Plugs',icon:'plug',km:60000,months:72},
    {id:'vehicle_check',name:'Vehicle Check',icon:'check',km:30000,months:24},
    {id:'battery_12v',name:'12 V Battery',icon:'battery',km:0,months:60}];
const MODS=[
    {id:'tune',name:'Engine Tune'},{id:'exhaust',name:'Exhaust'},{id:'intake',name:'Intake'},{id:'downpipe',name:'Downpipe'},
    {id:'suspension',name:'Suspension / Lowering'},{id:'wheels',name:'Wheels & Tyres'},{id:'brakes_upgrade',name:'Brake Upgrade'},
    {id:'lighting',name:'Lighting'},{id:'coding',name:'Coding'},{id:'wrap',name:'Wrap / PPF'},{id:'tint',name:'Window Tint'},
    {id:'interior',name:'Interior'}];
const VEHICLE={model:'BMW G30 530e',type:'PHEV',hp:292,year:2020,vin:null,tankL:46,usableKwh:9.6,fuelL100:7.0,kwh100:20};

function clone(o){return JSON.parse(JSON.stringify(o));}
class ServiceBook {
    constructor(dir,opts){
        this.dir=dir||null;this.now=(opts&&opts.now)||Date.now;this.file=dir?path.join(dir,'garage.json'):null;
        this.data=this.fresh();this.dirty=false;this.saveError=null;this.load();
    }
    fresh(){return {version:1,vehicle:clone(VEHICLE),odometer:{km:null,at:null,source:null},
        items:ITEMS.map((i)=>Object.assign(clone(i),{lastKm:null,lastAt:null,enabled:true})),records:[],
        mods:MODS.map((m)=>Object.assign(clone(m),{fitted:false,at:null,km:null}))};}
    load(){
        if(!this.file)return;
        try{const d=JSON.parse(fs.readFileSync(this.file,'utf8'));
            // keep what was saved; new items / mods / vehicle fields of a newer version are added
            const f=this.fresh();
            f.vehicle=Object.assign(f.vehicle,d.vehicle||{});
            if(d.odometer)f.odometer=Object.assign(f.odometer,d.odometer);
            f.items=f.items.map((i)=>Object.assign(i,(d.items||[]).find((x)=>x.id===i.id)||{}));
            (d.items||[]).forEach((x)=>{if(!f.items.some((i)=>i.id===x.id))f.items.push(x);});
            f.mods=f.mods.map((m)=>Object.assign(m,(d.mods||[]).find((x)=>x.id===m.id)||{}));
            f.records=Array.isArray(d.records)?d.records.slice(0,MAX_RECORDS):[];
            this.data=f;
        }catch(e){if(e.code!=='ENOENT')this.saveError='garage.json unreadable: '+String(e.message||e);}
    }
    save(){
        this.dirty=false;if(!this.file)return true;
        try{fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);this.saveError=null;return true;}
        catch(e){this.saveError=String(e.message||e);return false;}
    }
    get vehicle(){return this.data.vehicle;}
    get items(){return this.data.items;}
    get mods(){return this.data.mods;}
    get records(){return this.data.records;}
    get odometer(){return this.data.odometer;}
    item(id){return this.data.items.find((i)=>i.id===id)||null;}
    record(type,text,extra){
        const r=Object.assign({at:this.now(),km:this.km(),type:type,text:text},extra||{});
        this.data.records.unshift(r);if(this.data.records.length>MAX_RECORDS)this.data.records.length=MAX_RECORDS;this.dirty=true;return r;
    }
    /** the best odometer value now (km), or null */
    km(){const o=this.data.odometer;return o.km==null?null:o.km;}
    /** a reading from the car itself: always wins */
    setCarKm(km){
        if(!isFinite(km)||km<0||km>2000000)return false;
        const o=this.data.odometer,was=o.km;
        o.km=km;o.at=this.now();o.source='car';
        if(was==null||Math.abs(was-km)>=1)this.dirty=true;
        return true;
    }
    /** distance driven (from the speed signal): moves an estimated or manual reading on, not one from the car */
    addDistance(km){
        const o=this.data.odometer;if(o.km==null||!(km>0))return;
        o.km+=km;o.at=this.now();if(o.source==='car')o.source='estimated';this.dirty=true;
    }
    setManualKm(km,note){
        km=Math.max(0,Math.round(km));const o=this.data.odometer,was=o.km;
        o.km=km;o.at=this.now();o.source='manual';
        this.record('odometer',note||('Odometer set to '+km+' km'+(was!=null?' (was '+Math.round(was)+' km)':'')));this.dirty=true;
    }
    setVin(vin){if(vin&&vin!==this.data.vehicle.vin){this.data.vehicle.vin=vin;this.dirty=true;}}
    /** status of one item: {status, kmLeft, daysLeft, used (0..1 of the interval), dueKm, dueAt} */
    state(item){
        const now=this.now(),odo=this.km();
        if(!item.enabled)return {status:'off',kmLeft:null,daysLeft:null,used:0};
        if(item.lastKm==null&&item.lastAt==null)return {status:'unknown',kmLeft:null,daysLeft:null,used:0};
        let kmLeft=null,daysLeft=null,used=0;
        if(item.km>0&&item.lastKm!=null&&odo!=null){kmLeft=item.lastKm+item.km-odo;used=Math.max(used,(odo-item.lastKm)/item.km);}
        if(item.months>0&&item.lastAt!=null){const due=item.lastAt+item.months*MONTH;daysLeft=Math.floor((due-now)/DAY);used=Math.max(used,(now-item.lastAt)/(item.months*MONTH));}
        if(kmLeft==null&&daysLeft==null)return {status:'unknown',kmLeft:null,daysLeft:null,used:0};
        const due=(kmLeft!=null&&kmLeft<=0)||(daysLeft!=null&&daysLeft<=0);
        const soon=(kmLeft!=null&&kmLeft<=SOON_KM)||(daysLeft!=null&&daysLeft<=SOON_DAYS);
        return {status:due?'due':soon?'soon':'ok',kmLeft:kmLeft,daysLeft:daysLeft,used:Math.max(0,used),
            dueKm:kmLeft!=null?item.lastKm+item.km:null,dueAt:item.months>0&&item.lastAt!=null?item.lastAt+item.months*MONTH:null};
    }
    /** items with their state, the most urgent first (overdue, then the most of the interval used) */
    schedule(){
        // soonest first: days are counted as distance at an average KM_PER_DAY, so "in 167 days" and "in 4,800 km" compare
        const rank={due:0,soon:1,ok:2,unknown:3,off:4};
        const left=(s)=>Math.min(s.kmLeft==null?Infinity:s.kmLeft,s.daysLeft==null?Infinity:s.daysLeft*KM_PER_DAY);
        return this.data.items.map((i)=>({item:i,s:this.state(i)})).sort((a,b)=>rank[a.s.status]-rank[b.s.status]||left(a.s)-left(b.s));
    }
    next(){const s=this.schedule().find((x)=>x.s.status!=='unknown'&&x.s.status!=='off');return s||null;}
    markDone(id){
        const i=this.item(id);if(!i)return null;
        i.lastKm=this.km();i.lastAt=this.now();this.dirty=true;
        return this.record('service',i.name+' done',{item:id});
    }
    /** change an interval: field 'km' (step km) or 'months' */
    adjust(id,field,step){
        const i=this.item(id);if(!i)return;
        const max=field==='km'?300000:240;i[field]=Math.max(0,Math.min(max,(i[field]||0)+step));this.dirty=true;
    }
    toggleItem(id){const i=this.item(id);if(i){i.enabled=!i.enabled;this.dirty=true;}}
    toggleMod(id){
        const m=this.data.mods.find((x)=>x.id===id);if(!m)return null;
        m.fitted=!m.fitted;m.at=m.fitted?this.now():null;m.km=m.fitted?this.km():null;this.dirty=true;
        return this.record('mod',m.name+(m.fitted?' fitted':' removed'),{mod:id});
    }

}
module.exports={ServiceBook,ITEMS,MODS,VEHICLE,DAY,MONTH,SOON_KM,SOON_DAYS};
