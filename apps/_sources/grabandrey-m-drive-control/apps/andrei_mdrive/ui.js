'use strict';
// Full-width RPM strip and round temperature instruments with M-inspired accents.
// Original vector drawing; no OEM bitmap assets or fonts bundled.
const W=1600,H=520;
const C={bg:'#050609',surface:'#131519',edge:'#34383f',text:'#f4f5f7',dim:'#9da5b0',blue:'#81c4ff',navy:'#16588e',red:'#ed172d'};
function text(cv,s,x,y,size,color,align,font){cv.text(String(s),x,y,size,color||C.text,{font:font||'label',align:align||'left',literal:true});}
function button(cv,x,y,w,label,selected,run,key,disabled,pending){
 // Bare labels with a lower rail; selection is conveyed by underglow.
 cv.line(x,y+41,x+w-12,y+41,selected?3:1,selected?C.red:pending?'#a59a7e':'#373c43');
 // A narrow red underglow leaves the button surface neutral.
 if(selected)for(let i=0;i<8;i++)cv.fillRect(x+2+i,y+43+i,w-16-i*2,1,'#ed172d'+Math.round(95*Math.pow(1-i/8,2)).toString(16).padStart(2,'0'));
 text(cv,label,x+w/2,y+28,21,disabled?C.dim:C.text,'center','bold');
 if(cv.own&&!disabled)cv.target(x,y,w,42,run,key,0,'underline');
}
const TEMP_SPECS=[
 {key:'oil',label:'ENGINE OIL',min:40,max:160,color:C.red},
 {key:'coolant',label:'WATER TEMP',min:40,max:140,color:C.blue},
 {key:'gearbox',label:'GEARBOX OIL',min:40,max:160,color:C.red},
 {key:'intake',label:'INTAKE AIR',min:-20,max:120,color:C.blue},
 {key:'boost',label:'TURBO PRESSURE',min:0,max:3,color:C.blue,unit:'bar'}
];
function tempGauge(cv,G,s,value,cx,cy,units){
 const pressure=s.unit==='bar',f=!pressure&&units==='f',convert=n=>f?n*1.8+32:n;
 const point=(angle,r)=>[cx+Math.sin(angle*Math.PI/180)*r,cy-Math.cos(angle*Math.PI/180)*r];
 cv.arc(cx,cy,77,78,0,360,C.edge);
 cv.arc(cx,cy,68,73,-135,135,C.edge);
 for(let i=0;i<=8;i++){const a=-135+i*270/8,p=point(a,65),q=point(a,i%2?60:56);cv.line(p[0],p[1],q[0],q[1],1,C.dim);}
 const valid=Number.isFinite(value),v=G.smooth('temp-'+s.key,valid?value:null);
 if(valid){const amount=Math.max(0,Math.min(1,(v-s.min)/(s.max-s.min))),angle=-135+270*amount;
  if(amount>0)cv.arc(cx,cy,68,73,-135,angle,s.color);
  const p=point(angle,66),q=point(angle,55);cv.line(p[0],p[1],q[0],q[1],3,C.text);
 }
 text(cv,valid?(pressure?value.toFixed(2):Math.round(convert(value))):'--',cx,cy+13,46,C.text,'center','num');
 text(cv,pressure?'bar':f?'°F':'°C',cx,cy+34,17,C.dim,'center');
 text(cv,Math.round(convert(s.min)),cx-50,cy+98,16,C.dim,'center');
 text(cv,Math.round(convert(s.max)),cx+50,cy+98,16,C.dim,'center');
 text(cv,s.label,cx,cy+126,17,C.text,'center','bold');
}
function tachometer(cv,G,v){
 const x=30,w=W-60,y=108,h=40,max=v.redline,valid=Number.isFinite(v.data.rpm);
 const fraction=n=>Math.max(0,Math.min(1,n/max)),X=n=>x+(w-18)*fraction(n);
 const strip=(c,a,b,color)=>{if(b>a)c.quad([[a+18,y],[b+18,y],[b,y+h],[a,y+h]],color);};
 cv.blit(G.layer('motorsport-rpm-strip-v2-'+max,W,192,c=>{
  strip(c,x,X(max),'#25292f');
  strip(c,X(max-1000),X(max),'#591823');
  c.line(x,y+h+5,X(max),y+h+5,1,C.edge);
  for(let n=0;n<=max;n+=250){const major=n%1000===0,xx=X(n);
   c.line(xx,y+h+5,xx,y+h+(major?14:9),major?2:1,n>=max-1000?C.red:C.dim);
   if(major)text(c,n/1000,xx,181,20,n>=max-1000?C.red:C.text,n===0?'left':n===max?'right':'center','bold');
  }
 }),0,0);
 const rpm=G.smooth('race-rpm-strip',valid?v.data.rpm:null,22);
 if(valid&&Number.isFinite(rpm)&&rpm>0){
  const end=X(rpm),warn=X(max-1000);
  strip(cv,x,Math.min(end,warn),v.skin==='id7'?C.text:C.blue);
  if(end>warn)strip(cv,warn,end,C.red);
  cv.line(end+18,y,end,y+h,3,C.text);
 }
 const value=valid?Math.round(G.hold('rpm',v.data.rpm,100)/10)*10:'--';
 text(cv,value,805,81,46,C.text,'right','num');
 text(cv,'RPM',819,80,18,C.dim);
 text(cv,'× 1000',x+w,98,14,C.dim,'right');
}
function draw(cv,G,t,v,act){
 cv.clear(C.bg);G.frame(cv,t,['M Drive'],0,[]);
 [C.blue,C.navy,C.red].forEach((c,i)=>cv.quad([[32+i*12,56],[40+i*12,56],[32+i*12,80],[24+i*12,80]],c));
 text(cv,'M Drive',78,77,25,C.text,'left','bold');
 text(cv,v.demo?'DEMO - VEHICLE COMMANDS OFF':v.connected?'MHD+ controls':'Vehicle link unavailable',1570,77,17,v.demo?C.blue:C.dim,'right');
 tachometer(cv,G,v);
 const down=Math.min(40,Math.max(20,(cv.extra||0)/2));
 TEMP_SPECS.forEach((s,i)=>tempGauge(cv,G,s,v.data[s.key],[180,490,800,1110,1420][i],252+down,v.units));
 // Use the extra full-screen height for a larger gap above the controls.
 const controlsDown=down+Math.max(0,Math.min(32,(cv.extra||0)-20));
 text(cv,'MHD MAP',30,416+controlsDown,18,C.dim,'left','bold');
 const ack=v.mapAck,ackLabels={sending:'Sending to DME...',accepted:'DME accepted',unconfirmed:'Not confirmed',demo:'Demo - not sent',disabled:'Enable MHD+',unavailable:'DME unavailable'};
 const mapLabel=ack?'Map '+ack.slot+' · '+ackLabels[ack.status]:v.mapStatus.label;
 const mapColor=ack?(ack.status==='accepted'||ack.status==='sending'?C.blue:ack.status==='unconfirmed'||ack.status==='unavailable'?C.red:C.dim):C.dim;
 text(cv,mapLabel,490,416+controlsDown,16,mapColor,'right');
 [1,2,3,4].forEach((n,i)=>button(cv,30+i*118,428+controlsDown,106,'Map '+n,v.mapStatus.active===n,()=>act('map',n),'map'+n,v.busy,v.mapStatus.requested===n));
 text(cv,'EXHAUST FLAPS',550,416+controlsDown,18,C.dim,'left','bold');
 ['OEM','OPEN','CLOSED'].forEach((m,i)=>button(cv,550+i*150,428+controlsDown,138,m==='OPEN'?'Open':m==='CLOSED'?'Closed':'OEM',v.state.flap===m,()=>act('flap',m),'flap'+m,v.busy));
 text(cv,'MAX COOLING',1050,416+controlsDown,18,C.dim,'left','bold');
 button(cv,1050,428+controlsDown,246,'On',v.state.cooling===true,()=>act('cooling',true),'coolOn',v.busy);
 button(cv,1310,428+controlsDown,246,'Off',v.state.cooling===false,()=>act('cooling',false),'coolOff',v.busy);
 const note=cv.own?v.note:['Maps','Exhaust flaps','Max cooling'][v.page]+' - use the bottom buttons';
 text(cv,note,30,G.pageBottom(cv)-8,16,v.busy?C.blue:C.dim);
 return cv;
}
module.exports={draw,W,H,TEMP_SPECS};
