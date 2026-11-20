'use strict';
/**
 * theme.js - colours and the small drawing helpers every page uses.
 *
 * After Hours Garage palette (matte black, off white, steel grey) with a selectable accent. Red is the default:
 * it is what the Digital Garage design uses for the selected page and the ///AHG mark. Green / amber / red keep
 * their meaning (ok, soon, overdue) whatever the accent.
 */
const C={bg:'#0b0d10',panel:'#14171b',panel2:'#191d22',edge:'#2b3036',edgeHi:'#3a4048',text:'#f2f2f2',muted:'#9aa1a9',dim:'#6b727a',
    green:'#3ddc5a',greenDeep:'#0f3d1a',amber:'#f2b134',red:'#e1001a',blue:'#4aa8ff',
    accent:'#e1001a',onAccent:'#ffffff',accentDeep:'#5c0710',accentDark:'#22060a'};
const ACCENTS={
    red:{name:'AHG Red',c:'#e1001a',on:'#ffffff',deep:'#5c0710',dark:'#22060a'},
    lime:{name:'Neon Lime (brand)',c:'#c6ff00',on:'#0a0a0a',deep:'#3f5200',dark:'#121800'},
    blue:{name:'Ice Blue',c:'#3d9bff',on:'#ffffff',deep:'#0d3a7a',dark:'#06152b'},
    amber:{name:'Night Amber',c:'#ffa000',on:'#0a0a0a',deep:'#6b3e00',dark:'#241500'},
    violet:{name:'Violet',c:'#a77bff',on:'#ffffff',deep:'#3d2470',dark:'#160d29'}};
function setAccent(id){const a=ACCENTS[id]||ACCENTS.red;C.accent=a.c;C.onAccent=a.on;C.accentDeep=a.deep;C.accentDark=a.dark;return a;}
/** a status ('ok' | 'soon' | 'due' | 'unknown') -> its colour */
function statusColor(s){return s==='due'?C.red:s==='soon'?C.amber:s==='ok'?C.green:C.dim;}
function text(cv,value,x,y,size,color,align){cv.text(String(value),x,y,size,color||C.text,{font:'label',align:align||'left',literal:true});}
function bold(cv,value,x,y,size,color,align){cv.text(String(value),x,y,size,color||C.text,{font:'bold',align:align||'left',literal:true});}
function width(cv,value,size,isBold){return cv.textWidth(String(value),size,{font:isBold?'bold':'label',literal:true});}
/** A panel: thin border, dark fill, faint top highlight (the cards of the design). */
function panel(cv,x,y,w,h,r){r=r==null?12:r;cv.roundRect(x,y,w,h,r,C.edge);cv.card(x+1,y+1,w-2,h-2,r-1,[[0,'#171a1f'],[1,'#0e1013']]);cv.line(x+r,y+1,x+w-r,y+1,1,'#ffffff14');}
/** A button. kind: 'accent' (filled), 'ok' (green outline), undefined (plain). */
function button(cv,label,x,y,w,h,run,key,opts){
    opts=opts||{};const dis=!!opts.disabled;
    if(opts.kind==='accent'&&!dis){cv.roundRect(x,y,w,h,8,C.accent);cv.card(x+1,y+1,w-2,h-2,7,[[0,C.accent],[1,C.accentDeep]]);}
    else{cv.roundRect(x,y,w,h,8,opts.kind==='ok'?C.green:opts.on?C.accent:C.edgeHi);cv.card(x+1,y+1,w-2,h-2,7,opts.on?[[0,C.accentDeep],[1,C.accentDark]]:[[0,'#1c2026'],[1,'#121418']]);}
    bold(cv,label,x+w/2,y+h/2+6,opts.size||16,dis?C.dim:opts.kind==='accent'?C.onAccent:C.text,'center');
    if(run&&!dis)cv.target(x,y,w,h,run,key,8);
}
/** A horizontal progress bar in segments (the design's green bar with notches). f = 0..1 used. */
function bar(cv,x,y,w,h,f,color,segments){
    f=Math.max(0,Math.min(1,f||0));cv.roundRect(x,y,w,h,h/2,'#24292f');cv.roundRect(x+1,y+1,w-2,h-2,h/2-1,'#0d0f12');
    if(f>0)cv.roundRect(x+1,y+1,Math.max(h,(w-2)*f),h-2,h/2-1,color);
    const n=segments||0;for(let i=1;i<n;i++){const sx=x+w*i/n;if(sx<x+(w-2)*f)cv.fillRect(sx-1,y+1,2,h-2,'#0d0f12aa');}
}
/** Fit a string into n characters with an ellipsis. */
function fit(s,n){s=String(s);return s.length>n?s.slice(0,Math.max(1,n-3))+'...':s;}
/** 12 345 -> "12,345" (the design's thousands separator) */
function thousands(n){if(n==null||!isFinite(n))return '--';const s=String(Math.round(Math.abs(n)));return (n<0?'-':'')+s.replace(/\B(?=(\d{3})+(?!\d))/g,',');}
function date(ms){if(!ms)return '--';const d=new Date(ms),p=(n)=>(n<10?'0':'')+n;return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear();}
module.exports={C,ACCENTS,setAccent,statusColor,text,bold,width,panel,button,bar,fit,thousands,date};
