'use strict';
const mgu=require('./kit/mgu');
const G=require('./kit/gauges');
const Car=require('./kit/car');
const {Canvas}=require('./kit/canvas');
const {DiagLink}=require('./diaglink');
const {Control}=require('./control');
const UI=require('./ui');
const {Temperatures}=require('./temperatures');
const {MapFeedback}=require('./map_feedback');
const {Boost}=require('./boost');
mgu.run({async start(ctx) {
    const {ui,settings,log}=ctx;
    const seen={rpm:0,speed:0,oil:0,coolant:0};
    const thermal=new Temperatures(ctx);
    const feedback=new MapFeedback(ctx);
    const boost=new Boost(ctx);
    // Timestamp each signal separately; unrelated samples must not refresh RPM.
    const signals=Object.create(ctx.signals);
    signals.watch=(iface,instance,fields,logger)=>{
        const wrapped={};
        Object.keys(fields).forEach(key=>{wrapped[key]=value=>{
            const now=Date.now();
            if(key==='statusCarSpeed2') seen.speed=value && Number.isFinite(value.speedVehicleCentreOfGravity) && value.speedVehicleCentreOfGravity<65535?now:0;
            if(key==='statusEngineSpeed2') seen.rpm=value && Number.isFinite(value.actualValueRPMEngineCrankshaft) && value.actualValueRPMEngineCrankshaft<65535?now:0;
            if(key==='statusEngineTemperature') {
                seen.oil=value && Number.isFinite(value.temperatureEngineOilDrive) && value.temperatureEngineOilDrive<255?now:0;
                seen.coolant=value && Number.isFinite(value.temperatureEngineDrive) && value.temperatureEngineDrive<255?now:0;
            }
            return fields[key](value);
        };});
        return ctx.signals.watch(iface,instance,wrapped,logger,{pollMs:2000});
    };
    const car=new Car(Object.assign({},ctx,{signals}),['rpm','temps','speed','gear']);
    function data() {
        const d=car.data();
        d.boost=d.demo?Math.max(0,Math.min(2.4,(d.rpm-1500)/2300)):boost.value();
        d.gearbox=d.demo?82+Math.sin(Date.now()/18000)*4:thermal.value('gearbox');
        d.intake=d.demo?32+Math.sin(Date.now()/13000)*6:thermal.value('intake');
        if(!d.demo) Object.keys(seen).forEach(k=>{if(!seen[k] || Date.now()-seen[k]>(k==='rpm'||k==='speed'?5000:30000)) d[k]=null;});
        return d;
    }
    const control=new Control({enabled:()=>settings.get('control')==='mhd',demo:()=>settings.get('demo')==='on',rpm:()=>{const d=data();return d.demo?null:d.rpm;}});
    let loop=null,page=0;
    const repaint=()=>{if(loop) loop.kick();};
    const act=(kind,value)=>{if(kind==='map')feedback.reset();const p=control.send(kind,value);repaint();return p.then(repaint).catch(e=>log.error('control',e));};
    async function render() {
        const cv=ctx.canvas(UI.W,UI.H)||new Canvas(UI.W,UI.H);
        UI.draw(cv,G,ctx.theme(),{data:data(),state:control.state,busy:control.busy,note:control.note,mapAck:control.mapAck,
            skin:settings.get('skin')||'id8',mapStatus:feedback.view(control.state.map,settings.get('demo')==='on'),
            demo:settings.get('demo')==='on',connected:!!(control.link&&control.link.available),
            redline:Number(settings.get('redline'))||8000,units:settings.get('units'),page},act);
        await ui.image('MAIN_GFX',cv);
    }
    loop=ctx.loop('MAIN',10,render);
    ui.onClick('BTN_PAGE',()=>{page=(page+1)%3;setLabels();repaint();});
    function setLabels() {
        const labels=[['Map 1','Map 2','Map 3','Map 4'],['OEM','Open','Closed','OEM'],['On','Off','On','Off']][page];
        labels.forEach((s,i)=>ui.text('BTN_'+(i+1),s));
    }
    [1,2,3,4].forEach(n=>ui.onClick('BTN_'+n,()=>page===0?act('map',n):page===1?act('flap',['OEM','OPEN','CLOSED','OEM'][n-1]):act('cooling',n%2===1)));
    ['BTN_PAGE','BTN_1','BTN_2','BTN_3','BTN_4'].forEach(b=>ctx.hideButton&&ctx.hideButton(b));
    ctx.onTab(()=>repaint());
    const syncThermal=()=>{if(ui.isVisible('MAIN')&&settings.get('demo')!=='on')thermal.start();else thermal.stop();};
    ui.onVisible((name)=>{if(name==='MAIN')syncThermal();});
    settings.onChange(key=>{if(key==='control'||key==='demo'){control.reset();feedback.reset();}if(key==='demo'){boost.reset();syncThermal();}repaint();});
    syncThermal();
    boost.start().catch(e=>log.warn(String(e)));
    feedback.start().catch(e=>log.warn(String(e)));
    await render();
    try {
        control.link=await new DiagLink(ctx.signals,log).init();
        control.link.onAvailable(()=>{control.reset();feedback.reset();repaint();});
        control.note='Select a control - current DME state unknown';
    } catch(e) {control.note='Diagnostic link unavailable';log.warn(String(e));}
    repaint();
}});
