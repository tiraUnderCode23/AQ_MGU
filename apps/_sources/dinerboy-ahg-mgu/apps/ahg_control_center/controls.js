'use strict';
// Stock-car integration of Engine Config's existing MG1 adapter and RPM guard.
const {Controller}=require('./ec_controller'),{AutoFlap}=require('./ec_auto');
class Controls {
    constructor(ctx,store,options){
        this.ctx=ctx;this.store=store;this.options=options||{};this.armed=false;this.ready=false;this.stopped=false;this.busy=false;
        this.queue=Promise.resolve();this.timer=null;
        this.states={};this.mode='simulation';this.generation=0;this.watchedLink=null;this.detectionError=null;
        const settings={get:(k)=>k==='arm'?(this.armed?'on':'off'):k==='platform'?'auto':k==='driveLink'?'off':ctx.settings.get(k),set:()=>{}};
        this.controller=this.options.controller||new Controller({signals:ctx.signals,log:ctx.log,spec:ctx.spec,settings});
        this.auto=new AutoFlap({controller:this.controller,get:(k)=>k==='driveLink'?'off':ctx.settings.get(k),rpm:()=>{
            const r=store.get('rpm');return r.quality==='live'&&r.source==='mgu'?r.value:null;
        },log:ctx.log});
        this.reset();
    }
    reset(){['exhaust','asd','startStop'].forEach((id)=>{this.states[id]={id,supported:true,desired:null,pending:false,acknowledged:null,actual:null,readback:null,error:null,source:this.mode};});}
    get simulated(){return !!this.options.emulator||!!(this.options.demo&&this.options.demo())||this.ctx.settings.get('controlMode')!=='vehicle';}
    getState(id){return Object.assign({},this.states[id]);}
    capabilities(){return {exhaust:this.simulated||this.ready,asd:this.simulated,startStop:this.simulated};}
    async start(){
        this.mode=this.simulated?'simulation':'vehicle';this.reset();
        this.timer=setInterval(()=>{if(this.armed&&!this.busy)this.auto.tick().then(()=>this.sync()).catch((e)=>this.ctx.log.warn(String(e)));},250);
        // In the car the controls are always ready: arm at startup. Arming only detects the DME (read-only
        // 0x22 probes); nothing is commanded until a mode is pressed.
        if(!this.simulated)await this.arm().catch((e)=>this.ctx.log.warn('auto-arm: '+String(e.message||e)));
    }
    enqueue(fn){const p=this.queue.then(fn);this.queue=p.catch(()=>{});return p;}
    watchLink(){
        const link=this.controller.link;
        if(!link||link===this.watchedLink||!link.onAvailable)return;
        this.watchedLink=link;
        link.onAvailable((on)=>{
            if(!this.armed||this.stopped||link!==this.controller.link)return;
            if(!on){this.ready=false;this.detectionError='Diagnostic link lost - pick the mode again once it is back';this.auto._stop();this.auto.desired='OEM';this.auto.sent='OEM';this.auto.source='start';this.auto.paused=false;this.sync();return;}
            // Re-detection is read-only. Never replay an earlier Open/Close on reconnect.
            this.enqueue(async()=>{if(this.armed&&!this.stopped){await this.detect();this.sync();}}).catch((e)=>this.ctx.log.warn('DME reconnect: '+String(e)));
        });
    }
    async detect(){
        this.busy=true;
        try{
            const link=this.controller.link;
            if(!link||(link.diag&&!link.diag.p))await this.controller.start();else await this.controller.refresh();
            this.watchLink();
            this.ready=this.controller.real&&!this.controller.blocked&&this.controller.link.available!==false;
            const active=this.controller.link;
            this.detectionError=this.ready?null:active&&active.available===false?
                'Diagnostic link not up yet - connects by itself with the ignition on':this.controller.pickReason||'No compatible MG1 flap detected';
            this.ctx.log.info('AHG flap detection: '+(this.ready?'ready':this.detectionError));
        }catch(e){this.ready=false;this.detectionError='DME detection failed: '+String(e.message||e);this.states.exhaust.error=this.detectionError;throw e;}
        finally{this.busy=false;}
    }
    recheck(){return this.enqueue(async()=>{
        if(!this.armed)throw new Error('Arm this session before rechecking');
        await this.detect();this.sync();return this.ready;
    });}
    sync(){
        if(!this.armed)return;
        const v=this.controller.view(),s=this.states.exhaust;
        s.desired=this.auto.desired;s.pending=!!v.busy;s.acknowledged=v.accepted;
        s.readback=v.confirmed==='UNKNOWN'?null:v.confirmed;s.actual=null;s.source='vehicle';
        const note=this.auto.note();s.error=this.detectionError||(!this.ready?this.controller.pickReason||'Flap not ready':null)||v.error||(note&&note.warn?note.text:null)||(v.accepted===false?'DME rejected or did not answer; see app logs':null);
    }
    arm(){return this.enqueue(()=>this._arm());}
    async _arm(){
        if(this.stopped)throw new Error('Controls stopped');
        if(this.simulated)throw new Error('Simulation runs on the desktop emulator only');
        if(this.armed)return;
        this.busy=true;
        try{
            this.mode='vehicle';this.reset();this.armed=true;
            // A DME that isn't reachable yet (ignition, TASU starting) is not an error here: detection runs again
            // when the link comes up and on the next press. The controls stay armed.
            try{await this.detect();}catch(e){this.ctx.log.warn('DME detection: '+String(e.message||e));}
            this.auto.desired='OEM';this.auto.sent='OEM';
            this.sync();
        }catch(e){this.ctx.log.warn('arm: '+String(e.message||e));}finally{this.busy=false;}
    }
    async disarm(){return this.enqueue(async()=>{
        this.generation++;this.auto._stop();
        try{if(this.armed&&this.ready){await this.auto.press('OEM');this.sync();}}
        finally{
            this.armed=false;this.ready=false;this.detectionError=null;this.auto._stop();this.auto.desired='OEM';this.auto.sent='OEM';
            await this.controller.refresh();
        }
    });}
    async settingsChanged(key){
        if(key==='controlMode'||key==='demo'){
            await this.disarm();this.mode=this.simulated?'simulation':'vehicle';this.reset();if(!this.simulated)await this.arm();
        }else if(key==='hold'||key==='closeLimit')await this.auto.settingsChanged(key);
    }
    async request(id,desired){return this.enqueue(async()=>{
        if(this.stopped)throw new Error('Controls stopped');
        if(!this.states[id])throw new Error('Unknown control');
        const s=this.states[id];s.error=null;
        if(id==='exhaust'&&['OEM','OPEN','CLOSED'].indexOf(desired)<0)throw new Error('Invalid exhaust mode');
        if((id==='asd'||id==='startStop')&&typeof desired!=='boolean')throw new Error('Expected on/off');
        if(this.simulated){
            s.source='simulation';s.supported=true;s.desired=desired;s.acknowledged=true;s.actual=desired;s.readback=desired;s.pending=false;return this.getState(id);
        }
        s.source='vehicle';s.desired=desired;s.actual=null;s.acknowledged=null;
        if(id==='asd'||id==='startStop'){
            s.supported=false;s.error=id==='asd'?'Stock ASD write unavailable; Engine Config ASD requires bootmod3':'No verified stock start-stop memory write in the referenced SDK';throw new Error(s.error);
        }
        if(!this.armed)await this._arm();
        if(id==='exhaust'){
            if(!this.ready){await this.detect();if(!this.ready){s.error=this.detectionError;throw new Error(s.error);}}
            s.pending=true;await this.auto.press(desired);this.sync();return this.getState(id);
        }
        throw new Error('Unknown control');
    });}
    async stop(){this.stopped=true;clearInterval(this.timer);await this.disarm();
        const p=this.controller.link&&this.controller.link.diag&&this.controller.link.diag.p;
        if(p&&p.shutdown)await p.shutdown();
    }
}
module.exports={Controls};
