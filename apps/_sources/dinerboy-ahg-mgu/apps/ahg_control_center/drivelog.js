'use strict';
// Drive logger: records live vehicle readings to CSV on the head unit and keeps
// a short summary of each drive (drives.json) for the in-app Drive page.
// Node 8 target: no recursive mkdir, no optional chaining.
const fs=require('fs'),path=require('path');
const M=require('./model');
const COLUMNS=[['speed','speed_kmh',1],['rpm','rpm',0],['oil','oil_c',0],['coolant','coolant_c',0],['drive_mode','drive_mode',null]];
const MAX_FILES=20,MAX_BYTES=20*1024*1024,MAX_SUMMARIES=30,FLUSH_MS=5000,IDLE_SPLIT_MS=10*60*1000;
function pad(n){return (n<10?'0':'')+n;}
function stamp(d){return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds());}
function csvValue(v){const s=String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
class DriveLog {
    constructor(dataDir,options){
        this.options=options||{};this.now=this.options.now||Date.now;
        this.dir=path.join(dataDir||'.','drive-logs');this.summaryFile=path.join(this.dir,'drives.json');
        this.enabled=true;this.current=null;this.buffer=[];this.lastFlush=0;this.error=null;this.summaries=[];
        try{if(!fs.existsSync(this.dir))fs.mkdirSync(this.dir);}catch(e){this.error='Log folder not writable';}
        try{const list=JSON.parse(fs.readFileSync(this.summaryFile,'utf8'));if(Array.isArray(list))this.summaries=list.slice(0,MAX_SUMMARIES);}catch(e){}
    }
    setEnabled(on){if(this.enabled===!!on)return;this.enabled=!!on;if(!on)this.finish();}
    // One sample: called on a timer whether or not the app is on screen.
    sample(store,extra){
        if(!this.enabled||this.error)return;
        const now=this.now(),rows=COLUMNS.map((c)=>store.get(c[0]));
        const live=rows.filter((r)=>r.quality==='live'&&r.value!=null);
        if(!live.length){
            // Ignition off / signals gone: close the drive after a long gap.
            if(this.current&&now-this.current.lastAt>IDLE_SPLIT_MS)this.finish();
            return;
        }
        if(!this.current)this.open(now,live[0].source);
        const d=this.current;
        const values=rows.map((r,i)=>r.quality==='live'&&r.value!=null?(COLUMNS[i][2]==null?r.value:Number(r.value).toFixed(COLUMNS[i][2])):'');
        const flap=extra&&extra.flap?extra.flap:'';
        this.buffer.push([new Date(now).toISOString(),((now-d.startedAt)/1000).toFixed(1),d.source].concat(values,[flap]).map(csvValue).join(','));
        d.rows++;d.lastAt=now;
        const speed=store.get('speed'),rpm=store.get('rpm'),oil=store.get('oil'),coolant=store.get('coolant');
        if(speed.quality==='live'&&M.finite(speed.value)){
            if(d.prevSpeed&&now-d.prevSpeed.at<5000)d.km+=(speed.value+d.prevSpeed.v)/2*(now-d.prevSpeed.at)/3600000;
            d.prevSpeed={v:speed.value,at:now};d.maxSpeed=Math.max(d.maxSpeed,speed.value);
            if(speed.value>2)d.movingMs+=Math.min(5000,now-(d.prevMoveAt||now));d.prevMoveAt=now;
        }else d.prevSpeed=null;
        if(rpm.quality==='live'&&M.finite(rpm.value))d.maxRpm=Math.max(d.maxRpm,rpm.value);
        if(oil.quality==='live'&&M.finite(oil.value))d.maxOil=Math.max(d.maxOil,oil.value);
        if(coolant.quality==='live'&&M.finite(coolant.value))d.maxCoolant=Math.max(d.maxCoolant,coolant.value);
        if(now-this.lastFlush>=FLUSH_MS)this.flush();
    }
    open(now,source){
        const name='drive-'+stamp(new Date(now))+'.csv';
        this.current={file:name,startedAt:now,lastAt:now,rows:0,bytes:0,source:source==='mock'?'demo':'car',km:0,maxSpeed:0,maxRpm:0,maxOil:null,maxCoolant:null,movingMs:0,prevSpeed:null,prevMoveAt:null,full:false};
        this.current.maxOil=-Infinity;this.current.maxCoolant=-Infinity;
        this.buffer=['time,elapsed_s,source,'+COLUMNS.map((c)=>c[1]).join(',')+',flap_readback'];
        this.lastFlush=now;this.prune();
    }
    flush(){
        const d=this.current;this.lastFlush=this.now();
        if(!d||!this.buffer.length)return;
        if(d.full){this.buffer=[];return;}
        const text=this.buffer.join('\n')+'\n';this.buffer=[];
        try{fs.appendFileSync(path.join(this.dir,d.file),text);d.bytes+=Buffer.byteLength(text);if(d.bytes>MAX_BYTES)d.full=true;}
        catch(e){this.error='Could not write drive log: '+String(e.message||e);}
    }
    summary(d){
        d=d||this.current;if(!d)return null;
        const fin=(v)=>M.finite(v)&&v>-Infinity?Math.round(v):null;
        return {file:d.file,source:d.source,startedAt:d.startedAt,durationS:Math.round((d.lastAt-d.startedAt)/1000),movingS:Math.round(d.movingMs/1000),
            km:Math.round(d.km*10)/10,maxSpeed:fin(d.maxSpeed),maxRpm:fin(d.maxRpm),maxOil:fin(d.maxOil),maxCoolant:fin(d.maxCoolant),rows:d.rows,full:d.full};
    }
    finish(){
        const d=this.current;if(!d)return;
        this.flush();this.current=null;
        if(d.rows<5)return; // too short to be a drive
        this.summaries.unshift(this.summary(d));this.summaries=this.summaries.slice(0,MAX_SUMMARIES);
        try{const tmp=this.summaryFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.summaries,null,1));fs.renameSync(tmp,this.summaryFile);}catch(e){this.error='Could not save drive summary';}
    }
    prune(){
        try{
            const files=fs.readdirSync(this.dir).filter((f)=>/^drive-.*\.csv$/.test(f)).sort();
            while(files.length>=MAX_FILES)fs.unlinkSync(path.join(this.dir,files.shift()));
        }catch(e){}
    }
    status(){
        if(this.error)return {state:'error',text:this.error};
        if(!this.enabled)return {state:'off',text:'Logging off'};
        if(!this.current)return {state:'waiting',text:'Waiting for live data'};
        if(this.current.full)return {state:'full',text:'Log full (20 MB) - start a new drive'};
        return {state:'rec',text:'Recording '+this.current.file};
    }
    storage(){
        let bytes=0,count=0;
        try{fs.readdirSync(this.dir).forEach((f)=>{if(/\.csv$/.test(f)){count++;bytes+=fs.statSync(path.join(this.dir,f)).size;}});}catch(e){}
        return {count:count,mb:bytes/1048576};
    }
    stop(){this.finish();}
}
module.exports={DriveLog,COLUMNS};
