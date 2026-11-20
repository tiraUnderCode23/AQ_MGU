'use strict';
/**
 * AHG Digital Garage - service book, vehicle health and fault memory for the G30 530e (ID7 MGU).
 *
 * Read only: live readings and the fault scan only read (see live.js, faults.js). The app's own data (service
 * book, last scan) is kept in its data folder. Vehicle readings always come from the connected car.
 */
const path=require('path');
const mgu=require('./kit/mgu'),G=require('./kit/gauges'),KIT_RED=require('./kit/themes').THEMES.m_red;
const T=require('./theme'),V=require('./view');
const {ServiceBook}=require('./book'),{LiveData}=require('./live'),{FaultScanner}=require('./faults');
const {listSheet}=require('./kit/sheet');
const IDS=['garage','service','maintenance','diagnostics','modifications','records','info','settings'];

function kitTheme(){const t=Object.assign({},KIT_RED);t.accent=t.sel=t.ok=t.bar=t.marker=T.C.accent;t.selText=T.C.onAccent;t.glow=T.C.accent+'55';t.stripes=[T.C.accent];t.bg=T.C.bg;return t;}

function start(ctx){
    const app={ctx:ctx,page:Math.max(0,IDS.indexOf(ctx.settings.get('page'))),selected:'oil',faultPage:0,recordPage:0,odoEdit:null,
        toast:null,toastUntil:0,book:null,live:null,scanner:null};
    app.notice=(s)=>{app.toast=s;app.toastUntil=Date.now()+3500;ctx.log.info(s);};
    app.navigate=(i)=>{app.page=Math.max(0,Math.min(IDS.length-1,i));app.odoEdit=null;ctx.settings.set('page',IDS[app.page]);};
    app.settings=()=>{if(!ctx.sheet||!ctx.sheet(listSheet(ctx.settings,null,{version:ctx.spec&&ctx.spec.version})))ctx.ui.open('SETTINGS');};
    const save=()=>{if(app.book.dirty&&!app.book.save())app.notice('Could not save: '+app.book.saveError);};
    app.markDone=(id)=>{const r=app.book.markDone(id);save();if(r)app.notice(r.text+(app.book.km()!=null?' at '+T.thousands(app.book.km())+' km':''));};
    app.toggleMod=(id)=>{const r=app.book.toggleMod(id);save();if(r)app.notice(r.text);};
    app.saveOdometer=()=>{app.book.setManualKm(app.odoEdit);save();app.notice('Odometer set to '+T.thousands(app.odoEdit)+' km');};
    app.scan=()=>{
        if(app.scanner.scanning)return;
        app.notice('Fault scan started: reading every control unit');
        app.scanner.scan().then((r)=>{
            const msg=r.active?r.active+' active, '+r.stored+' stored fault'+(r.stored===1?'':'s'):r.stored?'No active faults, '+r.stored+' stored':'No faults stored';
            app.book.record('scan',msg+' ('+r.units.length+' units)');save();app.notice('Scan done: '+msg);
        }).catch((e)=>app.notice('Scan failed: '+String(e&&e.message||e)));
    };

    // Persist the service book and read only from the connected vehicle.
    function setup(){
        if(app.live)app.live.stop();
        app.book=new ServiceBook(ctx.dataDir);
        app.scanner=new FaultScanner(ctx,{dir:ctx.dataDir?path.join(ctx.dataDir,'scans'):null,appDir:__dirname});
        app.live=new LiveData(ctx);
        // odometer: a reading from the car wins; otherwise the distance driven moves the last value on
        app.live.onValue=(key,value)=>{if(key==='odo'&&app.book.setCarKm(value))save();if(key==='vin'){app.book.setVin(value);save();}};
        app.live.start();
        if(app.book.saveError)app.notice(app.book.saveError);
    }
    setup();
    ctx.settings.onChange((key)=>{if(key==='page')app.page=Math.max(0,IDS.indexOf(ctx.settings.get('page')));});

    // distance from the speed signal, 4 times a second; saved every 30 s while it changes
    let last=Date.now();
    const odoTimer=setInterval(()=>{try{
        const now=Date.now(),dt=Math.min(2,(now-last)/1000);last=now;const v=app.live.get('speed');
        if(v!=null&&v>0.5&&app.live.get('odo')==null)app.book.addDistance(v*dt/3600);
    }catch(e){ctx.log.warn('odometer: '+String(e));}},250);
    const saveTimer=setInterval(save,30000);
    let autoScan=null;
    if(ctx.settings.get('autoScan')!=='off')autoScan=setTimeout(()=>{if(!app.scanner.scanning)app.scan();},20000);

    ctx.ui.onClick('BTN_PAGE',()=>app.navigate((app.page+1)%IDS.length));
    ctx.ui.onClick('BTN_PREV',()=>app.navigate((app.page+IDS.length-1)%IDS.length));
    ctx.ui.onClick('BTN_SETTINGS',()=>app.settings());
    if(ctx.onTab)ctx.onTab((i)=>app.navigate(i));

    let previous=0;
    const loop=ctx.loop('MAIN',4,async()=>{
        if(Date.now()-previous<60)return;previous=Date.now();     // a page of cards: ~15 frames a second is plenty
        T.setAccent(ctx.settings.get('accent'));
        const cv=ctx.canvas(1600,520);cv.clear(T.C.bg);
        G.frame(cv,kitTheme(),[],-1,[app.scanner.scanning?{text:'SCANNING',color:T.C.accent}:null]);
        V.brand(cv);V.draw(cv,app);
        await ctx.ui.image('MAIN_GFX',cv);
    });
    const stop=async()=>{clearInterval(odoTimer);clearInterval(saveTimer);clearTimeout(autoScan);save();app.live.stop();loop.stop();};
    const shutdown=()=>{stop().catch((e)=>ctx.log.warn('shutdown: '+String(e))).then(()=>process.exit(0));};
    process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
    app.stop=stop;return app;
}
if(process.env.AHG_UNIT_TEST!=='1')mgu.run({start:start});
module.exports={start,IDS};
