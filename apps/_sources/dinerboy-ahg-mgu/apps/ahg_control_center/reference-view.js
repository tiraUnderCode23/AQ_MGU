'use strict';
const T=require('./theme'),M=require('./model'),Art=require('./art');
const {C,text,bold,card,button,lineIcon}=T;
const PAGES=['Home','Controls','Hybrid','Drive','Warm-up','Health','System'];
const E=require('./engine');
function field(a,k,d){return M.format(a.store.get(k),d);}
function withUnit(a,k,d,unit){const v=field(a,k,d);return v==='--'?v:v+' '+unit;}
function fit(s,n){s=String(s);return s.length>n?s.slice(0,n-3)+'...':s;}
// Split a sentence over at most `lines` lines of `n` characters.
function wrap(s,n,lines){
    const words=String(s).split(' '),out=[''];
    words.forEach((w)=>{const cur=out[out.length-1];if(cur&&(cur+' '+w).length>n)out.push(w);else out[out.length-1]=cur?cur+' '+w:w;});
    if(out.length>lines){out.length=lines;out[lines-1]=fit(out[lines-1]+' ...',n);}
    return out;
}
function icon(cv,name,x,y,size,color){lineIcon(cv,name,x,y,size,color);}
function duration(sec){if(!M.finite(sec))return '--';sec=Math.max(0,Math.round(sec));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;
    return h?h+' h '+(m<10?'0':'')+m+' min':m?m+' min '+(s<10?'0':'')+s+' s':s+' s';}
function clock(ms){const d=new Date(ms),p=(n)=>(n<10?'0':'')+n;return p(d.getDate())+'/'+p(d.getMonth()+1)+' '+p(d.getHours())+':'+p(d.getMinutes());}
function logState(a){return a.driveLog?a.driveLog.status():{state:'off',text:'Logging off'};}
// 21 px page icons for the side bar
function navIcon(cv,label,x,y,col){
    if(label==='Drive'){cv.arc(x+11,y+12,8,10,-90,90,col);cv.line(x+11,y+12,x+17,y+6,2,col);cv.circle(x+11,y+12,2.5,col);}
    else if(label==='Warm-up'){cv.roundRect(x+8,y,6,16,3,col);cv.circle(x+11,y+17,5,col);cv.line(x+11,y+5,x+11,y+17,2,'#0a0a0a');}
    else if(label==='Home'){cv.arc(x+11,y+12,9,11,-120,120,col);cv.line(x+11,y+12,x+17,y+4,2,col);cv.circle(x+11,y+12,2.5,col);cv.line(x+3,y+20,x+19,y+20,1.5,col);}
    else if(label==='Health'){cv.polyline([[x,y+12],[x+5,y+12],[x+8,y+4],[x+12,y+20],[x+15,y+10],[x+17,y+12],[x+22,y+12]],2,col);}
    else icon(cv,label.toLowerCase(),x,y,21,col);
}
function header(cv,a){
    cv.fillRect(12,38,1576,482,C.bg);
    for(let i=0;i<7;i++)cv.polyline([[184,415-i*9],[690,300-i*8],[1570,215-i*8]],1,'#ffffff05');
    Art.draw(cv,'mark',37,47,96,41); // AHG monogram (art/ahg-mark.png); the full logo is on Home
    text(cv,'CONTROL CENTER',85,101,10,C.muted,'center');
    cv.line(158,48,158,470,1,'#333538');
    PAGES.forEach((label,i)=>{
        const y=112+i*50,on=i===a.page,col=on?C.text:'#c9cccf';
        if(on){cv.card(16,y,132,44,5,[[0,'#0a0a0a'],[0.45,C.accentDark],[1,C.accentDeep]]);cv.line(16,y+1,16,y+43,3,C.accent);}
        navIcon(cv,label,25,y+11,col);
        text(cv,label,56,y+28,17,on?C.text:'#d6d8da');
        cv.target(16,y,132,44,()=>a.navigate(i),'nav-'+i,6);
    });
    bold(cv,'BMW 530e',870,65,19,C.text,'center');
    const toast=a.toast&&Date.now()<a.toastUntil;
    if(toast){const msg=fit(a.toast,74),w=Math.min(620,msg.length*7.6+36);cv.roundRect(1570-w,44,w,30,15,'#3a3f45');cv.roundRect(1571-w,45,w-2,28,14,'#1b1f23');text(cv,msg,1552,64,14,C.text,'right');}
    cv.line(174,477,1587,477,1,'#717477');
    const flap=a.controls.getState('exhaust'),log=logState(a);
    const entries=[
        ['Flap',flap.source==='simulation'?(flap.actual||'--')+' (sim)':!a.controls.ready?'Not detected':flap.readback||'Auto'],
        ['Mode',field(a,'drive_mode')],
        ['Speed',withUnit(a,'speed',0,'km/h')],
        ['Oil',withUnit(a,'oil',0,'°C')],
        ['Trip',a.trip.known?a.trip.km.toFixed(1)+' km':'--'],
        ['Log',log.state==='rec'?'REC':log.state==='waiting'?'Ready':log.state==='off'?'Off':'Error']];
    entries.forEach((e,i)=>{const x=187+i*232;text(cv,e[0],x,505,14,C.muted);
        const color=i===5&&log.state==='rec'?C.red:i===5&&log.state==='error'?C.amber:C.text;
        if(i===5&&log.state==='rec')cv.circle(x+62,500,5,C.red);
        bold(cv,e[1],x+(i===5&&log.state==='rec'?74:62),505,16,color);if(i<5)cv.line(x+218,487,x+218,510,1,'#53565a');});
}
// Segmented control: one rounded track, the chosen segment filled in AHG red.
function segmented(cv,items,x,y,w,h){
    cv.roundRect(x,y,w,h,12,'#3b3f44');cv.roundRect(x+1,y+1,w-2,h-2,11,'#0b0d0f');
    const sw=(w-8)/items.length;
    items.forEach((it,i)=>{const sx=x+4+i*sw;
        if(it.selected){cv.card(sx,y+4,sw,h-8,9,[[0,C.accent],[1,C.accent]]);cv.line(sx+14,y+5,sx+sw-14,y+5,1,'#ffffff55');}
        else if(it.pending){cv.roundRect(sx,y+4,sw,h-8,9,C.accentDeep);cv.roundRect(sx+2,y+6,sw-4,h-12,8,'#0b0d0f');}
        else if(i>0&&!items[i-1].selected)cv.line(sx,y+14,sx,y+h-14,1,'#2e3236');
        bold(cv,it.label,sx+sw/2,y+h/2+7,19,it.selected?C.onAccent:'#c9cdd1','center');
        cv.target(sx,y+4,sw,h-8,it.action,it.key,9);});
}
function chip(cv,label,x,y,color){
    const w=label.length*8.6+34;
    cv.roundRect(x,y,w,26,13,color+'55');cv.roundRect(x+1,y+1,w-2,24,12,'#0b0d0f');
    cv.circle(x+14,y+13,4,color);bold(cv,label,x+24,y+18,13,color);return w;
}
function toggle(cv,x,y,on,enabled){
    cv.roundRect(x,y,76,31,15,!enabled?'#1a1b1d':on?C.accent:'#292b2d');cv.circle(on?x+60:x+16,y+15,12,!enabled?'#55595d':on?C.onAccent:C.text);
}
// Exhaust smoke from a tailpipe of the hero photo: puffs that billow out, rise, grow and fade.
// A function of time only, so every frame moves it on. amt 0..1. Stays inside the hero card.
function alphaHex(c,al){return c+('0'+Math.round(M.clamp(al,0,1)*255).toString(16)).slice(-2);}
function rnd(n){const x=Math.sin(n*78.233+12.9898)*43758.5453;return x-Math.floor(x);}
function smoke(cv,ox,oy,dir,reach,amt,ts,seed){
    if(amt<0.03)return;
    const N=18,period=2.8;
    for(let i=0;i<N;i++){
        const cyc=ts/period+i/N+seed,p=((cyc%1)+1)%1,k=Math.floor(cyc)*31+i; // k: a new random path every cycle
        const x=ox+dir*(6+p*reach)+(rnd(k)-0.5)*34*p+Math.sin(ts*1.3+i*1.7)*7*p;
        const y=oy-4+p*8-p*p*80+(rnd(k+7)-0.5)*22*p;
        const r=7+p*(34+rnd(k+3)*14);
        const al=amt*0.62*(1-p)*Math.min(1,p*6);
        if(al<0.01)continue;
        cv.circle(x,y,r,alphaHex('#c4c9cf',al*0.3));
        cv.circle(x-r*0.12,y-r*0.1,r*0.7,alphaHex('#d9dde2',al*0.42));
        cv.circle(x-r*0.2,y-r*0.18,r*0.4,alphaHex('#eff1f4',al*0.5));
    }
}
function controls(cv,a,dt){
    const control=a.controls,sim=control.simulated,flap=control.getState('exhaust');
    // Exhaust flap hero: the photo fills the right of a black card, controls sit on the dark left.
    cv.roundRect(184,85,1386,215,12,'#2f3337');cv.roundRect(185,86,1384,213,11,'#000000'); // photo edge is pure black: no seam
    Art.draw(cv,'exhaust',748,86,820,213); // pre-cropped to exactly this box (art/exhaust-crop.png)
    // Round the photo's right corners to match the card.
    [[1558,97,0,90],[1558,288,90,180]].forEach((k)=>{cv.arc(k[0],k[1],11,18,k[2],k[3],C.bg);cv.arc(k[0],k[1],11,12,k[2],k[3],'#2f3337');});
    cv.line(1569,97,1569,288,1,'#2f3337');cv.line(748,86,1558,86,1,'#2f3337');cv.line(748,299,1558,299,1,'#2f3337');
    // Smoke follows the flap: Open -> both tips, Closed -> left tip, Auto -> a light wisp from both.
    // On the car it follows the DME read-back, so it only shows what the DME reports.
    const fstate=sim?flap.actual:flap.readback;
    const target={l:fstate==='CLOSED'||fstate==='OPEN'?1:0.3,r:fstate==='OPEN'?1:fstate==='CLOSED'?0:0.3};
    a.smoke=a.smoke||{l:target.l,r:target.r};
    a.smoke.l=M.damp(a.smoke.l,target.l,(dt||0)*0.25);a.smoke.r=M.damp(a.smoke.r,target.r,(dt||0)*0.25);
    const ts=Date.now()/1000;
    smoke(cv,1343,236,-1,150,a.smoke.l,ts,0);smoke(cv,1431,236,0.45,70,a.smoke.r,ts,0.37);
    cv.line(198,86,1556,86,1,'#b3b8bd44');
    text(cv,'EXHAUST',212,122,13,C.muted);bold(cv,'Exhaust Flap',212,154,28);
    const ready=sim||control.ready;chip(cv,sim?'SIMULATION':ready?'READY':control.busy?'DETECTING':'NOT DETECTED',420,132,sim?C.amber:ready?C.accent:C.amber);
    const modes=[['Auto','OEM'],['Open','OPEN'],['Closed','CLOSED']].map((s)=>({label:s[0],key:'flap-'+s[1],action:()=>a.control('exhaust',s[1]),
        selected:flap.desired===s[1]&&flap.acknowledged===true,pending:flap.desired===s[1]&&flap.pending}));
    segmented(cv,modes,212,178,540,54);
    const flapLine=flap.error||(sim?'Desktop simulation · flap '+(flap.actual==='OEM'?'auto':flap.actual?flap.actual.toLowerCase():'not set')+'. Nothing is sent to a car.':
        !control.ready?(control.busy?'Looking for the exhaust flap on the DME...':'Waiting for the DME - starts by itself with the ignition on.'):flap.pending?'Sending...':flap.acknowledged==null?'Ready - tap a mode or use the controller.':
        'DME '+(flap.acknowledged?'accepted':'did not accept')+' · ECU read-back: '+(flap.readback||'Unknown'));
    wrap(flapLine,92,2).forEach((l,i)=>text(cv,l,212,259+i*19,15,flap.error?C.amber:'#c9cdd1'));
    if(!sim&&!control.ready&&!control.busy)button(cv,'Retry',1388,100,168,40,()=>a.recheckControls(),'recheck-link');
    // Hold + Close guard: real settings of the flap automation (ec_auto.js).
    const hold=a.ctx.settings.get('hold')!=='off',limit=a.ctx.settings.get('closeLimit');
    card(cv,184,312,680,60);card(cv,882,312,688,60);
    cv.arc(225,342,13,16,40,320,C.text);cv.fill([[236,328],[245,336],[233,340]],C.text);
    bold(cv,'Hold Flap Position',268,337,20);
    text(cv,hold?'Re-sends Open / Closed every 15 s so the DME keeps it':'Off - the DME returns to auto after about 20 s',268,361,14,C.muted);
    toggle(cv,755,327,hold,true);cv.target(744,314,100,56,()=>a.cycleSetting('hold'),'hold-toggle',10);
    cv.arc(925,342,15,18,-120,120,C.text);cv.line(925,342,935,333,2,C.text);cv.circle(925,342,3,C.text);
    bold(cv,'Close Guard',966,337,20);text(cv,'Closed hands back to auto above this engine speed',966,361,14,C.muted);
    button(cv,limit+' rpm',1404,322,146,40,()=>a.cycleSetting('closeLimit'),'close-guard');
    // Flap status: what the DME reports and when the automation hands back
    card(cv,184,385,1386,84);
    const rows=[['ECU read-back',sim?(flap.actual==='OEM'?'Auto':flap.actual?flap.actual[0]+flap.actual.slice(1).toLowerCase():'--'):(flap.readback?flap.readback[0]+flap.readback.slice(1).toLowerCase():'--')],
        ['DME',sim?'Simulation':!control.ready?(control.busy?'Detecting...':'Not detected'):flap.acknowledged==null?'Ready':flap.acknowledged?'Accepted':'Not accepted'],
        ['Engine',lv(a,'rpm')==null?'--':Math.round(lv(a,'rpm'))+' rpm'],
        ['Hold',hold?'Every 15 s':'Off'],['Close guard',limit+' rpm']];
    rows.forEach((r,i)=>{const x=212+i*272;text(cv,r[0],x,418,14,C.muted);bold(cv,r[1],x,447,20,C.text);if(i)cv.line(x-22,404,x-22,452,1,'#36393d');});
}
function metric(cv,label,value,unit,x,y,w,h,color){
    card(cv,x,y,w,h);text(cv,label,x+22,y+27,16,C.muted);bold(cv,value,x+22,y+h-16,28,color||C.text);text(cv,unit,x+w-18,y+h-18,15,C.muted,'right');
}
// Power in the unit of the "powerUnit" setting: hp (metric, PS: 1 kW = 1.35962 hp, as BMW quotes it) or kW.
// Stored values stay kW (logs, health check); only the display converts.
const HP=1.35962,POWER_KEYS={eng_power:1,electric_kw:1,regen_kw:1};
function hp(a){return a.ctx.settings.get('powerUnit')!=='kw';}
function pwUnit(a){return hp(a)?'hp':'kW';}
function pw(a,kw){return kw==null?null:hp(a)?kw*HP:kw;}
function pwField(a,k,d){const r=a.store.get(k);return r.quality==='live'&&M.finite(r.value)?pw(a,r.value).toFixed(hp(a)?0:d):'--';}
/** a power reading and its dial spec in the chosen unit */
function pwDial(a,key,s,r){
    if(!POWER_KEYS[key]||!hp(a))return [s,r];
    const t=Object.assign({},s,{unit:'hp',decimals:0});
    if(key==='eng_power'){t.min=0;t.max=s.max>150?300:200;t.major=50;t.minor=10;}
    else{t.min=-80;t.max=160;t.major=40;t.minor=10;}
    return [t,Object.assign({},r,{value:M.finite(r.value)?r.value*HP:r.value,unit:'hp'})];
}
function lv(a,k){const r=a.store.get(k);return r.quality==='live'&&r.value!=null?r.value:null;}
function hybrid(cv,a){
    const soc=a.store.get('hv_soc'),hasSoc=soc.quality==='live',cx=347,cy=188,r=95;
    const kw=lv(a,'electric_kw'),tag=(k)=>{const q=a.store.get(k);return q.quality==='live'?(q.source==='mock'?'DEMO':'LIVE'):q.quality==='stale'?'STALE':'NO DATA';};
    card(cv,184,85,329,218);cv.circle(cx,cy,r+6,'#060708');cv.arc(cx,cy,r+3,r+6,0,360,'#a6acb1');
    cv.arc(cx,cy,r-13,r,0,360,'#414445');if(hasSoc)cv.arc(cx,cy,r-13,r,0,M.clamp(soc.value,0,100)*3.6,soc.value<15?C.amber:'#4bff41');
    bold(cv,hasSoc?M.format(soc,0)+'%':'--',cx,cy+4,40,C.text,'center');text(cv,'HV Battery',cx,cy+32,15,C.text,'center');
    const st=tag('hv_soc');text(cv,st,cx,cy+58,13,st==='LIVE'?C.blue:C.amber,'center');
    metric(cv,'Drive Source',field(a,'drive_source'),'',530,85,348,86,C.blue);
    const t=lv(a,'hv_temp');metric(cv,'HV Battery',withUnit(a,'hv_v',0,'V'),t!=null?Math.round(t)+' °C':'',894,85,294,86);
    metric(cv,'Electric Power',pwField(a,'electric_kw',1),pwUnit(a),530,187,319,76,kw!=null&&kw<0?C.green:null);
    metric(cv,'Recuperation',pwField(a,'regen_kw',1),pwUnit(a),865,187,323,76,C.green);
    powerFlow(cv,a,kw,hasSoc);
    card(cv,1204,85,366,93);bold(cv,'Energy (This Drive)',1223,115,20);text(cv,a.demo?'DEMO readings':'Measured battery power',1223,150,15,C.muted);
    card(cv,1204,191,366,218);
    const rows=[['Distance',a.trip.known?a.trip.km.toFixed(1)+' km':'--'],['Electric share',withUnit(a,'electric_share',0,'%')],['Energy used',withUnit(a,'energy_used',2,'kWh')],['Recovered',withUnit(a,'regen_energy',2,'kWh')]];
    rows.forEach((row,i)=>{text(cv,row[0],1223,226+i*49,16,C.text);bold(cv,row[1],1550,226+i*49,16,C.text,'right');if(i<3)cv.line(1219,241+i*49,1555,241+i*49,1,'#36393d');});
    card(cv,184,429,1386,40);icon(cv,'hybrid',200,439,19,C.text);
    const src=lv(a,'drive_source');
    text(cv,'Charging',237,455,15,C.muted);bold(cv,src==='Charging'?'Charging':src?'Not charging':'--',330,455,15,src==='Charging'?C.green:C.text);
    text(cv,'12 V battery',560,455,15,C.muted);bold(cv,withUnit(a,'voltage',1,'V'),680,455,15,C.text);
    const e=lv(a,'edrive_pct');text(cv,'eDRIVE',900,455,15,C.muted);bold(cv,e==null?'--':e<0?'Regen '+(-e)+'%':e+'%',980,455,15,e!=null&&e<0?C.green:C.text);
    text(cv,'HV voltage',1200,455,15,C.muted);bold(cv,withUnit(a,'hv_v',0,'V'),1320,455,15,C.text);
}
// Power flow: battery <-> e-motor / gearbox <- engine, from what the car measures. A line carries moving dots
// while power flows over it: blue from the battery, green back into it, the accent from the engine.
function flowLine(cv,x1,x2,y,on,col,dir,speed,t){
    cv.line(x1,y,x2,y,4,'#2a2d31');
    if(!on)return;
    cv.line(x1,y,x2,y,2,col+'88');
    const len=x2-x1,gap=26;
    for(let i=0;i<Math.ceil(len/gap);i++){const o=((t*speed+i*gap)%len+len)%len,x=dir>0?x1+o:x2-o;cv.circle(x,y,4,col);}
}
function flowNode(cv,x,y,w,h,title,value,sub,col,on){
    cv.roundRect(x,y,w,h,10,on?col:'#3a3e43');cv.roundRect(x+1.5,y+1.5,w-3,h-3,9,'#0c0e10');
    if(on)cv.roundRect(x+1.5,y+12,4,h-24,2,col);
    text(cv,title,x+20,y+24,13,C.muted);bold(cv,value,x+20,y+52,21,on?C.text:'#9aa0a6');
    if(sub)text(cv,sub,x+w-16,y+52,15,on?col:C.muted,'right');
}
function powerFlow(cv,a,kw,hasSoc){
    card(cv,184,316,1004,104);
    const rpm=lv(a,'rpm'),eng=lv(a,'eng_power'),sp=lv(a,'speed'),soc=lv(a,'hv_soc'),t=a.elapsed||0;
    const batOn=kw!=null&&Math.abs(kw)>0.5,batCol=kw!=null&&kw<0?C.green:C.blue,engOn=rpm!=null&&rpm>400;
    const P=(v)=>Math.round(Math.abs(pw(a,v)))+' '+pwUnit(a);
    flowNode(cv,204,330,250,76,'HV BATTERY',soc==null?'--':Math.round(soc)+' %',batOn?(kw<0?'+':'')+P(kw):'',batCol,batOn);
    flowNode(cv,571,330,250,76,'E-MOTOR · 8HP',sp==null?'--':Math.round(sp)+' km/h',batOn||engOn?'to wheels':'',C.text,batOn||engOn);
    flowNode(cv,918,330,250,76,'ENGINE',engOn?Math.round(rpm)+' rpm':rpm==null?'--':'Off',engOn&&eng!=null&&eng>1?P(eng):'',C.accent,engOn);
    flowLine(cv,454,571,368,batOn,batCol,kw!=null&&kw<0?-1:1,20+Math.min(80,Math.abs(kw||0)*2),t);
    flowLine(cv,821,918,368,engOn,C.accent,-1,20+Math.min(80,(eng||0)*0.8),t);
    if(!a.demo&&!hasSoc&&kw==null)text(cv,'Waiting for the HV battery (SME) - the Signal Viewer on System shows what arrives',1172,412,12,C.amber,'right');
}
// Real-data page: what the car actually provides plus the drive log.
function drive(cv,a){
    const log=a.driveLog,cur=log&&log.current?log.summary():null,st=logState(a);
    card(cv,184,85,560,384);bold(cv,'This Drive',207,120,22);
    const dot=st.state==='rec'?C.red:st.state==='error'||st.state==='full'?C.amber:C.muted;
    cv.circle(214,145,6,dot);text(cv,fit(st.text,52),228,151,15,dot===C.muted?C.muted:dot);
    const rows=[['Distance',a.trip.known?a.trip.km.toFixed(1)+' km'+(a.trip.partial?' (gaps)':''):'--'],
        ['Drive time',cur?duration(cur.durationS):'--'],['Top speed',cur&&cur.maxSpeed!=null?cur.maxSpeed+' km/h':'--'],
        ['Max RPM',cur&&cur.maxRpm?cur.maxRpm+' rpm':'--'],['Max oil temp',cur&&cur.maxOil!=null?cur.maxOil+' °C':'--'],
        ['Max coolant',cur&&cur.maxCoolant!=null?cur.maxCoolant+' °C':'--']];
    rows.forEach((r,i)=>{const y=192+i*35;text(cv,r[0],207,y,17,C.text);bold(cv,r[1],720,y,17,C.text,'right');if(i<5)cv.line(205,y+12,723,y+12,1,'#36393d');});
    const logging=a.ctx.settings.get('logging')!=='off';
    button(cv,'Save & New Drive',203,407,255,48,()=>a.newDrive(),'drive-new');
    button(cv,'Logging: '+(logging?'On':'Off'),470,407,255,48,()=>a.toggleLogging(),'drive-logging',logging);
    metric(cv,'Speed',field(a,'speed',0),'km/h',762,85,396,92);
    metric(cv,'Engine',field(a,'rpm',0),'rpm',1174,85,396,92);
    metric(cv,'Oil',field(a,'oil',0),'°C',762,190,396,92,a.store.get('oil').value>=125?C.red:null);
    metric(cv,'Coolant',field(a,'coolant',0),'°C',1174,190,396,92,a.store.get('coolant').value>=110?C.red:null);
    card(cv,762,296,808,173);bold(cv,'Recent Drives',785,328,20);
    const list=log?log.summaries.slice(0,3):[];
    if(!list.length)text(cv,'No saved drives yet. A drive is saved when you press Save & New Drive, or 10 min after live data stops.',785,365,15,C.muted);
    list.forEach((d,i)=>{const y=365+i*36;
        text(cv,clock(d.startedAt),785,y,16,C.text);text(cv,duration(d.durationS),925,y,16,C.text);
        text(cv,d.km.toFixed(1)+' km',1080,y,16,C.text);text(cv,'top '+(d.maxSpeed!=null?d.maxSpeed:'--')+' km/h',1180,y,16,C.muted);
        text(cv,'oil '+(d.maxOil!=null?d.maxOil:'--')+' °C',1550,y,16,C.muted,'right');if(i<2)cv.line(783,y+12,1550,y+12,1,'#36393d');});
}
// Gauges page: boost target vs actual on one dial, eight dials to choose (tap one for the next value), and
// the power split between the engine and the electric motor.
// short dial titles: the small dials have room for about 10 characters between their tick labels
const SHORT={iat:'Intake air',hpfp:'HPFP',lpfp:'LPFP',timing:'Timing',load:'Load',load_target:'Load target',boost_target:'Boost target',boost_actual:'Boost actual',
    eng_power:'Engine',eng_torque:'Torque',power_pct:'Power',electric_kw:'Electric',gearbox:'Gearbox',voltage:'12 V',hv_temp:'HV temp',hv_soc:'HV charge',
    oil:'Oil',coolant:'Coolant',rpm:'Engine',speed:'Speed',misfire_total:'Misfires',boost:'Boost'};
const GP=['gp1','gp2','gp3','gp4','gp5','gp6','gp7','gp8'];
function spec(a,key){
    const s=Object.assign({},M.DEFINITIONS[key]||M.DEFINITIONS.oil);
    if(key==='boost'||key==='boost_target'||key==='boost_actual')s.max=Number(a.ctx.settings.get('boostMax'))||2;
    if(key==='eng_power')s.max=Number(a.ctx.settings.get('maxPower'))>150?200:150;
    if(s.min==null){s.min=0;s.max=100;s.major=25;s.minor=5;}
    if(SHORT[key])s.label=SHORT[key];
    return s;
}
function gaugesPage(cv,a,dt){
    card(cv,184,85,376,384);text(cv,'BOOST · TARGET VS ACTUAL',372,114,13,C.muted,'center');
    const bs=spec(a,'boost_target');bs.label='Boost';
    const tgt=a.store.get('boost_target'),act=a.store.get('boost_actual').quality==='live'?a.store.get('boost_actual'):a.store.get('boost');
    a.gauges.dual(cv,'dual-boost',bs,tgt,act,372,252,128,dt);
    const tv=lv(a,'boost_target'),av=act.quality==='live'?act.value:null;
    cv.line(202,410,542,410,1,'#36393d');
    cv.polyline([[206,431],[226,431]],2,C.text);text(cv,'Target',234,436,15,C.muted);bold(cv,tv==null?'--':tv.toFixed(2)+' bar',372,436,16,C.text,'right');
    cv.line(400,431,420,431,4,C.accent);text(cv,'Actual',428,436,15,C.muted);bold(cv,av==null?'--':av.toFixed(2),540,436,16,C.text,'right');
    const la=lv(a,'load'),lt=lv(a,'load_target');
    text(cv,'Load '+(la==null?'--':Math.round(la))+' / '+(lt==null?'--':Math.round(lt))+' %',206,460,14,C.muted);
    const dev=tv!=null&&av!=null&&tv>0.3?av-tv:null;
    text(cv,dev==null?'':(dev>=0?'+':'')+dev.toFixed(2)+' bar vs target',540,460,14,dev!=null&&dev<-0.25?C.amber:C.muted,'right');
    const cols=[700,948,1196,1444],rows=[164,328];
    GP.forEach((slot,i)=>{
        const key=a.ctx.settings.get(slot),cx=cols[i%4],cy=rows[i>>2],r=72;
        const d=pwDial(a,key,spec(a,key),a.store.get(key));
        a.gauges.draw(cv,'gp-'+slot+'-'+key+'-'+d[0].unit,d[0],d[1],cx,cy,r,dt);
        cv.target(cx-r-8,cy-r-8,2*r+16,2*r+30,()=>{a.cycleSetting(slot);const k=a.ctx.settings.get(slot);a.notice('Dial '+(i+1)+': '+(M.DEFINITIONS[k]?M.DEFINITIONS[k].label:k));},'gauge-'+slot,6);
    });
    // power split: engine (crank torque x rpm) and electric (battery power), from what the car measures
    card(cv,576,425,994,44);
    const eng=lv(a,'eng_power'),el=lv(a,'electric_kw'),e1=eng==null?null:Math.max(0,eng),e2=el==null?null:Math.max(0,el);
    text(cv,'POWER',596,453,13,C.muted);
    const bx=770,bw=560,tot=(e1||0)+(e2||0);
    cv.roundRect(bx,440,bw,14,7,'#2c2f33');
    if(tot>0.5){const w1=bw*(e1||0)/tot;if(w1>2)cv.roundRect(bx,440,w1,14,7,C.accent);if(bw-w1>2)cv.roundRect(bx+w1,440,bw-w1,14,7,C.blue);}
    bold(cv,'Engine '+(e1==null?'--':Math.round(pw(a,e1))+' '+pwUnit(a)),756,453,15,C.accent,'right');
    bold(cv,(e2==null?'--':Math.round(pw(a,e2))+' '+pwUnit(a))+' Electric',1344,453,15,C.blue);
    const tq=lv(a,'eng_torque');text(cv,tq==null?'':Math.round(tq)+' Nm',1552,453,14,C.muted,'right');
}
// Health page: misfire monitor on the left, the health check report on the right.
const STATUS={pass:['PASS',null],attention:['CHECK',C.amber],nodata:['NO DATA',C.muted]};
function healthPage(cv,a){
    const mf=a.health.misfire,lvl=mf?mf.level:null;
    card(cv,184,85,560,384);bold(cv,'Misfire Monitor',207,120,22);
    chip(cv,!mf?'WAITING':lvl==='crit'?'MISFIRING':lvl==='warn'?'WARNING':'OK',560,100,!mf?C.muted:lvl==='ok'?C.accent:lvl==='warn'?C.amber:C.red);
    text(cv,'Counts this driving cycle, per cylinder (DME on-board monitor)',207,146,14,C.muted);
    if(!mf){const why=a.hybrid&&a.hybrid.misfire&&a.hybrid.misfire.why;
        wrap(why||'Read from the engine unit every 30 s, every 4 s while this page is open.',60,3).forEach((l,i)=>text(cv,l,207,200+i*22,15,C.muted));}
    else{
        const n=mf.counts.length,max=Math.max(E.MIS_CYL_WARN*2,Math.max.apply(null,mf.counts.map((x)=>x||0))),gap=Math.min(46,220/Math.max(1,n));
        mf.counts.forEach((c,i)=>{const y=180+i*gap,w=c==null?0:440*M.clamp(c/max,0,1);
            text(cv,'Cyl '+(i+1),207,y+14,15,C.text);cv.roundRect(270,y+2,400,16,8,'#2c2f33');
            if(c)cv.roundRect(270,y+2,Math.max(16,w*400/440),16,8,c>=E.MIS_CYL_WARN?C.red:c>=E.MIS_CYL_WARN/2?C.amber:C.accent);
            bold(cv,c==null?'-':String(c),724,y+15,16,c>=E.MIS_CYL_WARN?C.red:C.text,'right');});
        const tot=mf.counts.reduce((s,x)=>s+(x||0),0);
        cv.line(205,412,723,412,1,'#36393d');
        text(cv,'Total',207,440,15,C.muted);bold(cv,String(tot),300,440,18,tot>=E.MIS_CRIT?C.red:tot>=E.MIS_WARN?C.amber:C.text);
        text(cv,'read '+Math.max(0,Math.round((Date.now()-mf.at)/1000))+' s ago · warn at '+E.MIS_CYL_WARN+' / cyl, '+E.MIS_WARN+' total',723,440,13,C.muted,'right');
    }
    card(cv,762,85,808,384);bold(cv,'Garage Health Check',785,120,22);
    const run=a.health.running,prog=a.health.progress();
    button(cv,run?'Checking...':'Run Check',1394,98,156,42,run?null:()=>a.runHealth(),'health-run',!run,!!run);
    button(cv,'Clear',1290,98,92,42,()=>a.resetHealth(),'health-reset');
    const last=a.health.last,rep=last||a.health.report(a.warm);
    const res=rep.result==='pass'?['ALL CLEAR',C.accent]:rep.result==='attention'?[rep.attention+' TO CHECK',C.amber]:['NO DATA YET',C.muted];
    if(run){cv.roundRect(785,140,480,8,4,'#2c2f33');cv.roundRect(785,140,Math.max(8,480*prog),8,4,C.accent);text(cv,'Reading engine values fast...',785,168,14,C.muted);}
    else{const w=chip(cv,res[0],785,135,res[1]);text(cv,last?'Saved '+clock(last.at)+' · stats since '+clock(last.since):'Live preview - Run Check saves a report',797+w,153,14,C.muted);}
    rep.items.slice(0,12).forEach((it,i)=>{const x=785+(i%2)*398,y=190+(i>>1)*46,st=STATUS[it.status]||STATUS.nodata;
        cv.circle(x+5,y-5,5,st[1]||C.accent);bold(cv,fit(it.name,26),x+18,y,15,C.text);bold(cv,st[0],x+378,y,13,st[1]||C.accent,'right');
        text(cv,fit(it.detail,56),x+18,y+20,13,C.muted);});
}
// Cold over-rev warning on every page (advisory - nothing is sent to the engine).
function coldAlert(cv,a){
    const w=a.warm;if(!w||!w.over||a.ctx.settings.get('coldAlert')==='off')return;
    const lim=w.limit(),oil=w.live('oil'),on=Math.floor(Date.now()/350)%2===0;
    const c=on?C.red:'#7a0010';cv.line(176,42,1586,42,4,c);cv.line(176,474,1586,474,4,c);cv.line(176,42,176,474,4,c);cv.line(1586,42,1586,474,4,c);
    cv.roundRect(560,44,620,34,8,C.red);
    bold(cv,'COLD ENGINE · KEEP UNDER '+lim+' RPM · OIL '+Math.round(oil)+' °C',870,67,17,'#ffffff','center');
}
function tempRow(cv,a,key,label,y){
    const w=a.warm,e=w.eta(key),col=key==='oil'?C.accent:key==='coolant'?C.blue:'#b98cff';
    cv.circle(905,y-6,6,col);bold(cv,label,920,y,18,C.text);text(cv,'warm at '+w.target(key)+' °C',920,y+22,13,C.muted);
    bold(cv,e.state==='none'?'--':Math.round(e.temp)+' °C',1180,y+8,24,C.text,'right');
    const st=e.state==='ready'?['READY',C.accent]:e.state==='warming'?['~'+Math.max(1,Math.round(e.min))+' min'+(e.est?' (est.)':''),C.text]:
        e.state==='off'?['Engine off',C.muted]:e.state==='stalled'?['Not rising',C.amber]:['No data',C.muted];
    bold(cv,st[0],1550,y+8,e.state==='ready'||e.state==='warming'?24:18,st[1],'right');
    if(e.state!=='none'){const f=M.clamp((e.temp-20)/(e.target-20),0,1);cv.roundRect(1200,y+18,350,6,3,'#2c2f33');cv.roundRect(1200,y+18,Math.max(6,350*f),6,3,col);}
}
function warmup(cv,a){
    const w=a.warm;if(!w)return;
    const oil=w.live('oil'),rpm=w.live('rpm'),lim=w.limit(),red=Number(a.ctx.settings.get('redline'))||6500,warmOil=w.target('oil');
    const cold=oil!=null&&oil<warmOil;
    card(cv,184,85,680,232);text(cv,'SAFE REV LIMIT',207,116,13,C.muted);
    if(w.over){cv.roundRect(184,85,680,232,12,C.red);cv.roundRect(186,87,676,228,11,'#2b0306');text(cv,'SAFE REV LIMIT',207,116,13,'#ffb4b0');}
    bold(cv,lim?String(lim):'--',207,178,58,w.over?'#ffffff':cold?C.text:C.accent);text(cv,'rpm',214+(lim?String(lim).length*35:62),178,20,C.muted);
    text(cv,oil==null?'Waiting for the oil temperature':cold?'Climbs to '+red+' rpm as the oil reaches '+warmOil+' °C':'Engine warm - full rev range',207,212,16,w.over?'#ffffff':C.muted);
    // bar: 0 .. redline, safe part in the accent, live rpm as a marker
    const bx=207,bw=634,by=240,X=(r)=>bx+bw*M.clamp(r/red,0,1);
    cv.roundRect(bx,by,bw,14,7,'#2c2f33');if(lim)cv.roundRect(bx,by,Math.max(14,X(lim)-bx),14,7,cold?C.amber:C.accent);
    if(lim&&lim<red)cv.roundRect(X(lim),by,bx+bw-X(lim),14,7,'#5c1a20');
    if(rpm!=null){const x=X(rpm);cv.line(x,by-8,x,by+22,3,w.over?'#ffffff':C.text);}
    text(cv,'0',bx,by+38,12,C.muted);text(cv,red+' rpm',bx+bw,by+38,12,C.muted,'right');if(rpm!=null)text(cv,'now '+Math.round(rpm),X(rpm),by-12,12,C.text,'center');
    text(cv,w.overCount?'Cold over-revs this start: '+w.overCount+' (peak '+Math.round(w.overPeak)+' rpm)':'No cold over-revs this start',bx,302,14,w.overCount?C.amber:C.muted);
    card(cv,882,85,688,232);
    const ready=w.ready();bold(cv,ready?'Ready to drive hard':'Warming up',905,118,20,ready?C.accent:C.text);
    tempRow(cv,a,'oil','Oil',165);tempRow(cv,a,'coolant','Coolant',222);tempRow(cv,a,'gearbox','Gearbox oil',279);
    // 20-minute trend
    card(cv,184,331,1386,138);text(cv,'LAST 20 MIN',207,360,13,C.muted);
    const gx=360,gw=1190,gy=345,gh=110,now=Date.now(),T=(t)=>gx+gw*(1-(now-t)/(20*60000)),Y=(v)=>gy+gh-gh*M.clamp((v-0)/130,0,1);
    [40,80,120].forEach((v)=>{cv.line(gx,Y(v),gx+gw,Y(v),1,'#2a2d31');text(cv,v+' °C',gx-8,Y(v)+4,11,C.muted,'right');});
    cv.line(gx,Y(warmOil),gx+gw,Y(warmOil),1,C.accent+'66');
    [[1,C.accent],[2,C.blue],[3,'#b98cff']].forEach((k)=>{const pts=w.hist.filter((h)=>M.finite(h[k[0]])).map((h)=>[T(h[0]),Y(h[k[0]])]);if(pts.length>1)cv.polyline(pts,2,k[1]);});
    [['Oil',C.accent],['Coolant',C.blue],['Gearbox','#b98cff']].forEach((l,i)=>{cv.circle(213,386+i*24,5,l[1]);text(cv,l[0],225,391+i*24,13,C.text);});
}
function progress(cv,label,value,x,y,w){
    text(cv,label,x,y+16,16,C.text);cv.roundRect(x+100,y+4,w-185,12,6,'#343638');
    if(M.finite(value))cv.roundRect(x+100,y+4,Math.max(1,(w-185)*M.clamp(value,0,100)/100),12,6,'#45ed43');
    text(cv,M.finite(value)?Math.round(value)+'%':'--',x+w,y+16,16,C.text,'right');
}
function system(cv,a){
    const stats=a.diagnostics.update();card(cv,184,85,680,114);card(cv,882,85,688,114);
    const live=a.store.rows().filter((r)=>r.quality==='live'&&r.source==='mgu').length;
    const ok=live>0;
    cv.arc(229,141,23,26,0,360,ok?C.green:C.amber);text(cv,ok?'OK':'?',229,149,ok?18:27,ok?C.green:C.amber,'center');
    bold(cv,'Vehicle Data',280,127,22);text(cv,a.demo?'Demo data (synthetic)':ok?live+' live car signals':'No live car signals yet',280,162,18,ok?C.green:C.amber);
    button(cv,'Refresh',716,121,128,42,()=>a.refresh(),'refresh-data');
    bold(cv,a.emulator?'Host system (emulator)':'MGU System',905,112,19);
    progress(cv,'CPU',stats.cpu,905,122,633);progress(cv,'RAM',stats.ram,905,146,633);progress(cv,'Storage',stats.storage,905,170,633);
    card(cv,184,215,680,199);card(cv,882,215,688,199);
    if(a.systemMode==='signals'||a.systemMode==='logs'){
        const signals=a.systemMode==='signals',per=6;
        bold(cv,signals?'Signal Viewer':'App Log',205,246,20);
        const all=signals?a.store.rows().filter((r)=>r.quality!=='unsupported').map((r)=>fit(r.key,14)+'   '+M.format(r,1)+' '+r.unit+'   '+r.quality+(r.ageMs!=null?' · '+(r.ageMs/1000).toFixed(1)+' s':'')):a.diagnostics.entries.slice().reverse().map((s)=>s.slice(11,19)+' '+s.slice(25));
        const pages=Math.max(1,Math.ceil(all.length/per)),off=M.clamp(a.logOffset||0,0,pages-1);
        const lines=all.slice(off*per,off*per+per);
        if(!lines.length)text(cv,signals?'No signals received yet':'Log is empty',205,280,15,C.muted);
        lines.forEach((s,i)=>text(cv,fit(s,80),205,280+i*22,14,C.text));
        text(cv,(off+1)+' / '+pages,600,246,14,C.muted,'right');
        button(cv,'Newer',617,224,110,32,()=>{a.logOffset=Math.max(0,off-1);},'log-newer',false,off===0);
        button(cv,'Older',737,224,110,32,()=>{a.logOffset=Math.min(pages-1,off+1);},'log-older',false,off>=pages-1);
        button(cv,'Close',727,372,120,32,()=>{a.systemMode='overview';a.logOffset=0;},'overview');
    }else{
        bold(cv,'Service Status',205,247,20);
        const lst=logState(a);
        const rows=[['Vehicle signals',a.demo||a.emulator?'Demo':live?'Receiving':'Waiting',!!live],['Drive logging',lst.state==='rec'?'Recording':lst.state==='waiting'?'Ready':lst.state==='off'?'Off':'Error',lst.state==='rec'],
            ['Exhaust flap',a.controls.simulated?'Simulation':a.controls.ready?'Ready':a.controls.busy?'Detecting':'Not detected',!a.controls.simulated&&a.controls.ready],['Hybrid data',a.demo?'Demo':lv(a,'hv_soc')!=null||lv(a,'electric_kw')!=null?'Receiving (SME)':'Waiting (SME)',!a.demo&&(lv(a,'hv_soc')!=null||lv(a,'electric_kw')!=null)],['App runtime','Running',true]];
        rows.forEach((r,i)=>{const y=282+i*27;cv.circle(212,y-5,5,r[2]?C.green:C.muted);text(cv,r[0],232,y,16,C.text);text(cv,r[1],841,y,16,r[2]?C.green:C.muted,'right');});
    }
    const storage=a.driveLog?a.driveLog.storage():{count:0,mb:0};
    const rows=[['App Version',a.ctx.spec&&a.ctx.spec.version?a.ctx.spec.version:'--'],['Saved drive logs',storage.count+(storage.count===1?' file · ':' files · ')+storage.mb.toFixed(1)+' MB'],['Last Launch',new Date(a.diagnostics.started).toISOString().slice(11,19)+' UTC'],['App Uptime',duration((Date.now()-a.diagnostics.started)/1000)]];
    rows.forEach((r,i)=>{const y=254+i*45;icon(cv,i===0?'system':'controls',903,y-16,18,C.text);text(cv,r[0],943,y,17,C.text);text(cv,r[1],1548,y,17,C.text,'right');if(i<3)cv.line(901,y+15,1551,y+15,1,'#35383b');});
    const actions=[['App Log',()=>{a.systemMode='logs';a.logOffset=0;}],['Signal Viewer',()=>{a.systemMode='signals';a.logOffset=0;}],['Export Diagnostics',()=>a.exportReport()],['Settings',()=>a.settings()]];
    actions.forEach((r,i)=>button(cv,r[0],184+i*350,425,336,44,r[1],'system-'+i));
}
function draw(cv,a,dt){
    header(cv,a);
    // one page failing (a reading the code did not expect) must not take the app down: show it, log it once
    try{[gaugesPage,controls,hybrid,drive,warmup,healthPage,system][a.page](cv,a,dt);}
    catch(e){const m=String(e&&e.message||e);text(cv,'This page hit an error: '+fit(m,90),200,140,16,C.amber);
        if(a.lastDrawError!==m){a.lastDrawError=m;if(a.diagnostics&&a.diagnostics.log)a.diagnostics.log('draw error (page '+PAGES[a.page]+'): '+String(e&&e.stack||e));}}
    coldAlert(cv,a);
}
module.exports={draw,PAGES,GP,wrap,fit};
