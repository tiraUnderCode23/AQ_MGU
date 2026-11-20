'use strict';
/**
 * view.js - every page of AHG Digital Garage, drawn on the 1600 x 520 canvas.
 *
 * Layout (the Digital Garage design adapted to the MGU's wide screen):
 *   left       page list (Garage, Service, Maintenance, Diagnostics, Modifications, Records, Vehicle Info, Settings)
 *   Garage     pixel-art garage with the car and its name, Vehicle Health and Next Service on the right,
 *              five readings along the bottom (mileage, HV battery, fuel / electric / total range)
 *   others     a pixel heading and the page's own content
 * Touch / controller targets stay inside y 38..477 (the HMI's own areas are outside).
 */
const T=require('./theme'),Px=require('./pixel'),{icon}=require('./icons'),H=require('./health');
const {C,text,bold,panel,button,bar,fit,thousands,date}=T;
const PAGES=[['Garage','garage'],['Service','service'],['Maintenance','maintenance'],['Diagnostics','diagnostics'],
    ['Modifications','modifications'],['Records','records'],['Vehicle Info','info'],['Settings','settings']];
const X0=234,X1=1588,TOP=44,CT=88;

function kmText(n){return n==null?'--':thousands(n)+' km';}
function leftText(s){
    if(s.status==='off')return 'Off';
    if(s.status==='unknown')return 'Not set';
    const parts=[];
    if(s.kmLeft!=null)parts.push(s.kmLeft<0?thousands(-s.kmLeft)+' km over':'in '+thousands(s.kmLeft)+' km');
    if(s.daysLeft!=null)parts.push(s.daysLeft<0?(-s.daysLeft)+' days over':s.daysLeft+' days');
    return parts.join(' · ');
}
function shortLeft(s){
    if(s.status==='off')return 'Off';if(s.status==='unknown')return 'Not set';
    if(s.kmLeft!=null)return s.kmLeft<0?thousands(-s.kmLeft)+' km over':'in '+thousands(s.kmLeft)+' km';
    return s.daysLeft<0?(-s.daysLeft)+' days over':'in '+s.daysLeft+' days';
}
function pill(cv,label,x,y,color,align){
    const w=T.width(cv,label,13,true)+20;if(align==='right')x-=w;
    cv.roundRect(x,y,w,24,12,color);cv.roundRect(x+1,y+1,w-2,22,11,'#0e1013');bold(cv,label,x+w/2,y+17,13,color,'center');return w;
}
function heading(cv,title,sub){
    Px.word(cv,title,X0+4,TOP+6,4,C.text,{shadow:'#000000'});
    if(sub)text(cv,sub,X0+8+Px.wordWidth(title,4)+18,TOP+30,16,C.muted);
}

/* ---------- frame: page list, toast ---------- */
function nav(cv,a){
    cv.fillRect(0,38,1600,482,C.bg);
    cv.line(222,44,222,508,1,'#22262b');
    PAGES.forEach((p,i)=>{
        const y=46+i*54,on=i===a.page;
        if(on){cv.roundRect(12,y,200,50,9,C.accent);cv.card(13,y+1,198,48,8,[[0,C.accentDark],[1,C.accentDeep]]);}
        icon(cv,p[1],26,y+12,26,on?C.text:'#c4c9ce');
        text(cv,p[0],66,y+32,19,on?C.text:'#d3d7db');
        cv.target(12,y,200,50,()=>a.navigate(i),'nav-'+i,8);
    });
}
function toast(cv,a){
    if(!a.toast||Date.now()>=a.toastUntil)return;
    const msg=fit(a.toast,90),w=Math.min(900,T.width(cv,msg,16)+48),x=X0+(X1-X0-w)/2;
    cv.roundRect(x,476,w,34,17,C.edgeHi);cv.roundRect(x+1,477,w-2,32,16,'#1d2227');text(cv,msg,x+w/2,499,16,C.text,'center');
}

/* ---------- Garage ---------- */
function garage(cv,a){
    const v=a.book.vehicle;
    // the scene, with the car's name and chips over its top left (as in the design)
    const sx=X0,sy=TOP,sw=618,sh=326;
    Px.scene(cv,sx,sy,sw,sh);
    cv.strokeRoundRect(sx,sy,sw,sh,6,2,C.edge);
    cv.gradientRect(sx+2,sy+2,sw-4,110,[[0,'#000000b0'],[1,'#00000000']]);
    Px.word(cv,v.model,sx+22,sy+22,3,'#ffffff',{shadow:'#000000'});
    let cx=sx+22;
    [[v.type,'ev'],[v.hp+' hp'],[String(v.year)]].forEach((c)=>{const cy=sy+52;
        const tw=T.width(cv,c[0],17)+(c[1]?54:30);
        cv.roundRect(cx,cy,tw,36,9,'#5b6168');cv.roundRect(cx+1,cy+1,tw-2,34,8,'#101317e6');
        if(c[1])icon(cv,c[1],cx+12,cy+7,22,C.green);
        text(cv,c[0],cx+(c[1]?42:15),cy+24,17,C.text);cx+=tw+10;
    });
    // Vehicle Health
    const rx=sx+sw+12,rw=X1-rx,h=a.healthNow;
    panel(cv,rx,TOP,rw,108);
    icon(cv,'diagnostics',rx+18,TOP+16,28,C.green);bold(cv,'Vehicle Health',rx+58,TOP+38,22,C.text);
    icon(cv,'chevron',rx+rw-38,TOP+18,24,C.muted);
    const bad=h.status==='due',warn=!bad&&h.checks.some((c)=>c.status==='soon'),col=bad?C.red:warn?C.amber:h.status==='unknown'?C.dim:C.green;
    cv.roundRect(rx+16,TOP+54,rw-32,44,10,col);cv.card(rx+18,TOP+56,rw-36,40,8,[[0,bad?'#3a0a10':warn?'#3a2a08':h.status==='unknown'?'#1a1d21':C.greenDeep],[1,'#0b0d10']]);
    cv.circle(rx+44,TOP+76,13,col);
    if(bad||warn){bold(cv,'!',rx+44,TOP+83,20,'#0b0d10','center');}else cv.polyline([[rx+37,TOP+76],[rx+42,TOP+81],[rx+51,TOP+71]],3,'#0b0d10');
    bold(cv,h.headline,rx+68,TOP+83,20,col);
    cv.target(rx,TOP,rw,108,()=>a.navigate(3),'health',12);
    // Next Service
    const ny=TOP+118,nh=sh-118;
    panel(cv,rx,ny,rw,nh);
    icon(cv,'service',rx+18,ny+14,26,C.text);bold(cv,'Next Service',rx+58,ny+35,22,C.text);
    icon(cv,'chevron',rx+rw-38,ny+14,24,C.muted);
    const next=a.book.next(),half=rx+Math.round(rw*0.47);
    if(!next){text(cv,'No service history yet',rx+20,ny+78,20,C.text);text(cv,'Mark items as done on the Service page',rx+20,ny+104,15,C.muted);}
    else{
        const s=next.s,big=s.kmLeft!=null?thousands(Math.abs(s.kmLeft))+' km':Math.abs(s.daysLeft)+' days';
        const pre=(s.kmLeft!=null?s.kmLeft:s.daysLeft)<0?'over by ':'in ';
        text(cv,pre,rx+20,ny+84,22,C.text);bold(cv,big,rx+20+T.width(cv,pre,22),ny+84,32,s.status==='ok'?C.text:T.statusColor(s.status));
        text(cv,next.item.name+(s.kmLeft!=null&&s.daysLeft!=null?' · or '+s.daysLeft+' days':''),rx+20,ny+110,16,C.muted);
        bar(cv,rx+20,ny+124,half-rx-40,14,1-Math.min(1,s.used),T.statusColor(s.status),5);
    }
    // the most urgent items, as a list on the right half
    a.book.schedule().filter((x)=>x.s.status!=='off').slice(0,4).forEach((x,i)=>{
        const y=ny+52+i*36,lx=half;
        if(i)cv.line(lx,y-6,rx+rw-16,y-6,1,'#262a30');
        icon(cv,x.item.icon,lx,y,22,x.s.status==='unknown'?C.dim:'#ff5a4f');
        text(cv,fit(x.item.name,14),lx+32,y+17,16,C.text);
        text(cv,shortLeft(x.s),rx+rw-40,y+17,15,x.s.status==='due'?C.red:x.s.status==='soon'?C.amber:C.muted,'right');
        icon(cv,'chevron',rx+rw-34,y+3,16,C.dim);
    });
    cv.target(rx,ny,rw,nh,()=>a.navigate(1),'next-service',12);
    // readings along the bottom
    const L=a.live,veh=a.book.vehicle,odo=a.book.km(),soc=L.get('soc'),fuel=L.get('fuel');
    const fuelKm=fuel!=null?fuel/100*veh.tankL/veh.fuelL100*100:null,evKm=soc!=null?soc/100*veh.usableKwh/veh.kwh100*100:null;
    const tiles=[['road','Mileage',odo==null?'--':thousands(odo)+' km',a.book.odometer.source==='car'?null:a.book.odometer.source],
        ['battery','Battery (HV)',soc==null?'--':Math.round(soc)+' %',null,soc],
        ['fuel','Fuel Range',fuelKm==null?'--':thousands(fuelKm)+' km','est.'],
        ['ev','Electric Range',evKm==null?'--':thousands(evKm)+' km','est.'],
        ['range','Total Range',fuelKm==null&&evKm==null?'--':thousands((fuelKm||0)+(evKm||0))+' km','est.']];
    const ty=TOP+sh+12,tw=(X1-X0-4*10)/5,th=508-ty;
    tiles.forEach((t,i)=>{
        const x=X0+i*(tw+10);panel(cv,x,ty,tw,th,10);
        icon(cv,t[0],x+18,ty+16,26,i===1?C.green:C.text);text(cv,t[1],x+56,ty+36,18,C.text);
        if(t[4]!=null){bold(cv,t[2],x+22,ty+80,26,C.text);bar(cv,x+22,ty+94,tw-44,12,t[4]/100,C.green,5);}
        else bold(cv,t[2],x+tw/2,ty+88,30,C.text,'center');
        if(t[3])text(cv,t[3],x+tw-14,ty+th-10,12,C.dim,'right');
    });
}

/* ---------- Service ---------- */
function serviceRow(cv,a,x,i,y,w,showInterval){
    const s=x.s,it=x.item,on=a.selected===it.id,col=T.statusColor(s.status==='off'?'unknown':s.status);
    cv.roundRect(X0,y,w,44,8,on?C.accent:C.edge);cv.card(X0+1,y+1,w-2,42,7,on?[[0,C.accentDark],[1,'#0e1013']]:[[0,'#16191d'],[1,'#0f1114']]);
    icon(cv,it.icon,X0+14,y+10,24,s.status==='off'?C.dim:col);
    text(cv,it.name,X0+52,y+28,18,s.status==='off'?C.dim:C.text);
    if(showInterval)text(cv,(it.km?thousands(it.km)+' km':'')+(it.km&&it.months?' / ':'')+(it.months?it.months+' mo':'')+(!it.km&&!it.months?'No interval':''),X0+260,y+28,16,C.muted);
    else{bar(cv,X0+250,y+16,200,12,Math.min(1,s.used),col,4);}
    text(cv,leftText(s),X0+w-18,y+28,16,col,'right');
    cv.target(X0,y,w,44,()=>{a.selected=it.id;},'item-'+it.id,8);
}
function itemDetail(cv,a,px,pw,mode){
    const it=a.book.item(a.selected)||a.book.items[0],s=a.book.state(it);a.selected=it.id;
    panel(cv,px,CT,pw,388);
    icon(cv,it.icon,px+20,CT+18,30,T.statusColor(s.status));bold(cv,it.name,px+62,CT+42,24,C.text);
    pill(cv,s.status==='due'?'OVERDUE':s.status==='soon'?'DUE SOON':s.status==='ok'?'OK':s.status==='off'?'OFF':'NOT SET',px+pw-20,CT+22,T.statusColor(s.status==='off'?'unknown':s.status),'right');
    const rows=mode==='service'?[
        ['Last done',it.lastAt?date(it.lastAt)+(it.lastKm!=null?' · '+kmText(it.lastKm):''):'Never recorded'],
        ['Interval',(it.km?thousands(it.km)+' km':'')+(it.km&&it.months?' or ':'')+(it.months?it.months+' months':'')||'None'],
        ['Due',s.status==='unknown'||s.status==='off'?'--':[s.dueKm!=null?kmText(s.dueKm):null,s.dueAt?date(s.dueAt):null].filter(Boolean).join(' · ')],
        ['Remaining',leftText(s)]]:[['Distance',it.km?thousands(it.km)+' km':'Not used'],['Time',it.months?it.months+' months':'Not used']];
    rows.forEach((r,i)=>{const y=CT+84+i*40;text(cv,r[0],px+22,y,16,C.muted);text(cv,r[1],px+160,y,18,C.text);cv.line(px+20,y+14,px+pw-20,y+14,1,'#22262b');});
    return {it:it,s:s};
}
function service(cv,a){
    heading(cv,'SERVICE','odometer '+kmText(a.book.km()));
    const w=820,list=a.book.items.map((i)=>({item:i,s:a.book.state(i)}));
    list.forEach((x,i)=>serviceRow(cv,a,x,i,CT+i*48,w,false));
    const px=X0+w+14,pw=X1-px,d=itemDetail(cv,a,px,pw,'service');
    button(cv,'Mark as done now',px+20,CT+264,pw-40,52,()=>a.markDone(d.it.id),'mark-done',{kind:'accent',size:18});
    text(cv,'Saves today and '+(a.book.km()==null?'no odometer (set it on Vehicle Info)':kmText(a.book.km())),px+pw/2,CT+336,14,C.muted,'center');
    button(cv,'Edit interval',px+20,CT+346,(pw-50)/2,40,()=>a.navigate(2),'edit-interval');
    button(cv,'History',px+30+(pw-50)/2,CT+346,(pw-50)/2,40,()=>a.navigate(5),'history');
}

/* ---------- Maintenance (intervals) ---------- */
function maintenance(cv,a){
    heading(cv,'MAINTENANCE','service intervals');
    const w=820;a.book.items.forEach((it,i)=>serviceRow(cv,a,{item:it,s:a.book.state(it)},i,CT+i*48,w,true));
    const px=X0+w+14,pw=X1-px,d=itemDetail(cv,a,px,pw,'maintenance'),id=d.it.id,bw=(pw-70)/4;
    [['km',[-5000,-1000,1000,5000],(v)=>(v>0?'+':'-')+thousands(Math.abs(v)),CT+176],['months',[-12,-1,1,12],(v)=>(v>0?'+':'')+v+' mo',CT+252]].forEach((g)=>{
        text(cv,g[0]==='km'?'Distance':'Time',px+22,g[3]-8,14,C.muted);
        g[1].forEach((step,k)=>button(cv,g[2](step),px+20+k*(bw+10),g[3],bw,44,()=>a.book.adjust(id,g[0],step),'adj-'+g[0]+'-'+step));
    });
    button(cv,d.it.enabled?'Tracking on':'Tracking off',px+20,CT+318,(pw-50)/2,52,()=>a.book.toggleItem(id),'toggle-item',{on:d.it.enabled});
    button(cv,'Mark as done',px+30+(pw-50)/2,CT+318,(pw-50)/2,52,()=>a.markDone(id),'mark-done-m',{kind:'accent'});
}

/* ---------- Diagnostics ---------- */
function diagnostics(cv,a){
    const f=a.scanner,r=f.result,w=900;
    heading(cv,'DIAGNOSTICS',f.scanning?'reading every control unit...':r?'last scan '+date(r.at):'not scanned yet');
    panel(cv,X0,CT,w,70);
    button(cv,f.scanning?'Scanning... '+(f.progress||0)+' units':'Scan fault memory',X0+14,CT+12,280,46,f.scanning?null:()=>a.scan(),'scan',{kind:'accent',disabled:f.scanning,size:17});
    if(r){
        const stats=[['Units',r.units.length,C.text],['Active',r.active,r.active?C.red:C.green],['Stored',r.stored,r.stored?C.amber:C.green]];
        stats.forEach((s,i)=>{const x=X0+330+i*170;text(cv,s[0],x,CT+30,15,C.muted);bold(cv,String(s[1]),x,CT+58,24,s[2]);});
    }else text(cv,f.state==='error'?'Scan failed: '+fit(f.error||'',60):'Reads the fault memory of every unit (read only, nothing is cleared)',X0+316,CT+42,16,f.state==='error'?C.amber:C.muted);
    // fault list
    const list=r?r.faults:[],per=6,pages=Math.max(1,Math.ceil(list.length/per));a.faultPage=Math.min(a.faultPage||0,pages-1);
    const y0=CT+82;
    if(r&&!list.length){panel(cv,X0,y0,w,90);cv.circle(X0+40,y0+45,16,C.green);cv.polyline([[X0+32,y0+45],[X0+38,y0+51],[X0+49,y0+39]],3,'#0b0d10');
        bold(cv,'No faults stored',X0+72,y0+40,22,C.green);text(cv,r.units.length+' control units answered',X0+72,y0+66,16,C.muted);}
    list.slice(a.faultPage*per,a.faultPage*per+per).forEach((x,i)=>{
        const y=y0+i*52,col=x.sev==='crit'?C.red:x.sev==='warn'?C.amber:C.dim;
        cv.roundRect(X0,y,w,46,8,C.edge);cv.card(X0+1,y+1,w-2,44,7,[[0,'#16191d'],[1,'#0f1114']]);cv.roundRect(X0+1,y+1,6,44,3,col);
        bold(cv,x.code,X0+20,y+29,18,C.text);text(cv,fit(x.unit,18),X0+120,y+29,16,C.muted);
        text(cv,fit(x.text||'No fault text on the head unit',46),X0+300,y+29,15,x.text?C.text:C.dim);
        pill(cv,x.label,X0+w-14,y+11,col,'right');
    });
    if(pages>1){
        button(cv,'Prev',X0+w-230,TOP+2,100,36,a.faultPage>0?()=>{a.faultPage--;}:null,'fault-prev',{disabled:a.faultPage===0});
        button(cv,'Next',X0+w-120,TOP+2,100,36,a.faultPage<pages-1?()=>{a.faultPage++;}:null,'fault-next',{disabled:a.faultPage>=pages-1});
    }
    // health checks
    const px=X0+w+14,pw=X1-px;panel(cv,px,CT,pw,412);
    icon(cv,'diagnostics',px+18,CT+14,26,C.green);bold(cv,'Vehicle Health',px+56,CT+35,22,C.text);
    a.healthNow.checks.forEach((c,i)=>{const y=CT+60+i*68,col=T.statusColor(c.status);
        cv.circle(px+30,y+20,8,col);bold(cv,c.name,px+50,y+26,18,C.text);text(cv,fit(c.detail,52),px+50,y+50,14,C.muted);
        if(i)cv.line(px+18,y-6,px+pw-18,y-6,1,'#22262b');});
}

/* ---------- Modifications ---------- */
function modifications(cv,a){
    const fitted=a.book.mods.filter((m)=>m.fitted).length;
    heading(cv,'MODIFICATIONS',fitted+' fitted · tap to mark fitted or removed');
    const cols=3,gw=(X1-X0-2*12)/cols;
    a.book.mods.forEach((m,i)=>{
        const x=X0+(i%cols)*(gw+12),y=CT+Math.floor(i/cols)*96;
        cv.roundRect(x,y,gw,86,10,m.fitted?C.accent:C.edge);cv.card(x+1,y+1,gw-2,84,9,m.fitted?[[0,C.accentDark],[1,'#0e1013']]:[[0,'#16191d'],[1,'#0f1114']]);
        icon(cv,'modifications',x+16,y+16,26,m.fitted?C.accent:C.dim);
        bold(cv,m.name,x+56,y+36,19,m.fitted?C.text:'#b9bec4');
        text(cv,m.fitted?'Fitted '+date(m.at)+(m.km!=null?' · '+kmText(m.km):''):'Not fitted',x+56,y+64,15,m.fitted?C.muted:C.dim);
        pill(cv,m.fitted?'FITTED':'STOCK',x+gw-14,y+14,m.fitted?C.green:C.dim,'right');
        cv.target(x,y,gw,86,()=>a.toggleMod(m.id),'mod-'+m.id,10);
    });
}

/* ---------- Records ---------- */
function records(cv,a){
    const list=a.book.records,per=8,pages=Math.max(1,Math.ceil(list.length/per));a.recordPage=Math.min(a.recordPage||0,pages-1);
    heading(cv,'RECORDS',list.length+' entries');
    if(!list.length){panel(cv,X0,CT,X1-X0,90);text(cv,'Nothing yet: services you mark as done, fault scans and modifications appear here.',X0+24,CT+52,18,C.muted);}
    const TYPES={service:['service',C.green,'Service'],scan:['diagnostics',C.blue,'Scan'],mod:['modifications',C.accent,'Mod'],odometer:['road',C.amber,'Odometer']};
    list.slice(a.recordPage*per,a.recordPage*per+per).forEach((r,i)=>{
        const y=CT+i*48,t=TYPES[r.type]||['info',C.muted,r.type];
        cv.roundRect(X0,y,X1-X0,42,8,C.edge);cv.card(X0+1,y+1,X1-X0-2,40,7,[[0,'#16191d'],[1,'#0f1114']]);
        icon(cv,t[0],X0+14,y+9,24,t[1]);bold(cv,t[2],X0+52,y+27,16,t[1]);
        text(cv,date(r.at),X0+170,y+27,16,C.text);text(cv,kmText(r.km),X0+310,y+27,16,C.muted);text(cv,fit(r.text,80),X0+470,y+27,17,C.text);
    });
    if(pages>1){
        text(cv,'Page '+(a.recordPage+1)+' / '+pages,X1-240,TOP+26,15,C.muted,'right');
        button(cv,'Prev',X1-224,TOP+2,100,36,a.recordPage>0?()=>{a.recordPage--;}:null,'rec-prev',{disabled:a.recordPage===0});
        button(cv,'Next',X1-114,TOP+2,100,36,a.recordPage<pages-1?()=>{a.recordPage++;}:null,'rec-next',{disabled:a.recordPage>=pages-1});
    }
}

/* ---------- Vehicle Info ---------- */
function info(cv,a){
    const v=a.book.vehicle,o=a.book.odometer,r=a.scanner.result;
    heading(cv,'VEHICLE INFO');
    const w=640;panel(cv,X0,CT,w,412);
    const iw=360,ih=Math.round(iw*115/219);Px.scene(cv,X0+(w-iw)/2,CT+12,iw,ih);cv.strokeRoundRect(X0+(w-iw)/2,CT+12,iw,ih,4,1,C.edge);
    const SRC={car:'read from the car',estimated:'estimated from distance driven',manual:'set by hand'};
    const rows=[['Model',v.model],['Type',v.type+' · '+v.hp+' hp · '+v.year],['VIN',a.live.get('vin')||v.vin||'Not read yet'],
        ['Odometer',kmText(a.book.km())+(o.source?' · '+SRC[o.source]:'')],['Control units',r?r.units.length+' answered the last scan':'Run a scan on Diagnostics']];
    rows.forEach((row,i)=>{const y=CT+226+i*37;text(cv,row[0],X0+22,y,16,C.muted);text(cv,fit(row[1],46),X0+170,y,18,C.text);if(i<4)cv.line(X0+20,y+14,X0+w-20,y+14,1,'#22262b');});
    // odometer setter
    const px=X0+w+14,pw=X1-px;panel(cv,px,CT,pw,412);
    icon(cv,'road',px+18,CT+16,26,C.text);bold(cv,'Set odometer',px+56,CT+37,22,C.text);
    text(cv,'For when the car does not report it: from then on the distance you drive is added.',px+22,CT+66,15,C.muted);
    if(a.odoEdit==null)a.odoEdit=a.book.km()==null?0:Math.round(a.book.km());
    cv.roundRect(px+20,CT+82,pw-40,70,10,C.edgeHi);cv.roundRect(px+21,CT+83,pw-42,68,9,'#0c0e11');
    Px.word(cv,thousands(a.odoEdit)+' KM',px+pw/2,CT+100,5,C.text,{align:'center'});
    const steps=[-10000,-1000,-100,-10,10,100,1000,10000],bw=(pw-40-3*10)/4;
    steps.forEach((s,k)=>{const col=k%4,row=Math.floor(k/4);
        button(cv,(s>0?'+':'-')+thousands(Math.abs(s)),px+20+col*(bw+10),CT+164+row*52,bw,44,()=>{a.odoEdit=Math.max(0,a.odoEdit+s);},'odo'+s);});
    button(cv,'Save odometer',px+20,CT+272,pw-40,50,()=>a.saveOdometer(),'odo-save',{kind:'accent',size:18});
    button(cv,'Reset to current',px+20,CT+332,pw-40,42,()=>{a.odoEdit=a.book.km()==null?0:Math.round(a.book.km());},'odo-reset');
}

/* ---------- Settings ---------- */
function settings(cv,a){
    const s=a.ctx.settings;
    heading(cv,'SETTINGS','AHG Digital Garage '+(a.ctx.spec&&a.ctx.spec.version||''));
    panel(cv,X0,CT,660,190);bold(cv,'Accent colour',X0+22,CT+36,20,C.text);
    Object.keys(T.ACCENTS).forEach((id,i)=>{const x=X0+22+i*124,on=s.get('accent')===id,ac=T.ACCENTS[id];
        cv.roundRect(x,CT+56,112,112,12,on?C.text:C.edge);cv.roundRect(x+2,CT+58,108,108,11,'#0e1013');cv.circle(x+56,CT+100,24,ac.c);
        text(cv,ac.name.split(' ')[0],x+56,CT+152,14,on?C.text:C.muted,'center');cv.target(x,CT+56,112,112,()=>s.set('accent',id),'accent-'+id,12);});
    panel(cv,X0,CT+202,660,210);bold(cv,'Vehicle connection',X0+22,CT+238,20,C.text);
    text(cv,'Readings and fault scans use the connected car.',X0+22,CT+264,15,C.muted);
    text(cv,'Unavailable values stay blank until a verified reading arrives.',X0+22,CT+290,15,C.muted);
    button(cv,'All settings',X0+22,CT+324,240,48,()=>a.settings(),'all-settings');
    const px=X0+674,pw=X1-px;panel(cv,px,CT,pw,412);bold(cv,'About',px+22,CT+36,20,C.text);
    const lines=['Service book, fault scan and vehicle health for the G30 530e.','Everything is read only: no fault is cleared, nothing is coded.',
        'Data: '+(a.book.saveError?'NOT SAVED - '+fit(a.book.saveError,40):'saved in the app folder (garage.json)'),
        'Odometer: OBD (if the DME answers) else estimated from speed.','Fault texts: add dtc_texts.json to show descriptions.',
        'Ranges are estimates from fuel level, HV charge and set consumption.'];
    lines.forEach((l,i)=>text(cv,l,px+22,CT+76+i*34,16,i===2&&a.book.saveError?C.amber:C.muted));
    Px.word(cv,'///AHG',px+22,CT+300,5,C.accent);Px.word(cv,'BUILT AFTER HOURS',px+22,CT+352,3,C.dim);
}

const DRAW=[garage,service,maintenance,diagnostics,modifications,records,info,settings];
function draw(cv,a){
    a.healthNow=H.evaluate(a.book,a.live,a.scanner);
    nav(cv,a);DRAW[Math.max(0,Math.min(DRAW.length-1,a.page))](cv,a);toast(cv,a);
}
/** the app name drawn into the kit's top bar (left) */
function brand(cv){
    if(cv.chrome)return;
    const x=20;for(let i=0;i<3;i++)cv.quad([[x+i*9+6,9],[x+i*9+10,9],[x+i*9+4,28],[x+i*9,28]],C.accent);
    bold(cv,'AHG',x+32,27,22,C.text);text(cv,'Digital Garage',x+84,27,20,C.text);
}
module.exports={draw,brand,PAGES,leftText};
