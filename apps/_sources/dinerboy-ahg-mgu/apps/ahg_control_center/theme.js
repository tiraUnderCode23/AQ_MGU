'use strict';
// After Hours Garage palette: matte black #0A0A0A, off white #F2F2F2, dark grey #1A1A1A, steel grey #5A5A5A.
// red / amber / green stay fixed for meaning (hot, warning, ok); the accent follows the "accent" setting.
const C={bg:'#0a0a0a',panel:'#1a1a1a',edge:'#4a4d50',text:'#f2f2f2',muted:'#a3a7ab',red:'#e1001a',blue:'#3e94cf',green:'#65e172',amber:'#e4b15e',
    accent:'#c6ff00',onAccent:'#0a0a0a',accentDeep:'#4f6600',accentDark:'#141a00'};
// c = the accent, on = text on a filled accent, deep / dark = the gradient behind a selected item
const ACCENTS={
    lime:{name:'Neon Lime (brand)',c:'#c6ff00',on:'#0a0a0a',deep:'#4f6600',dark:'#141a00'},
    red:{name:'Sport Red',c:'#e1001a',on:'#ffffff',deep:'#740006',dark:'#2b0306'},
    blue:{name:'Ice Blue',c:'#3d9bff',on:'#ffffff',deep:'#0d3a7a',dark:'#06152b'},
    amber:{name:'Night Amber',c:'#ffa000',on:'#0a0a0a',deep:'#6b3e00',dark:'#241500'},
    violet:{name:'Violet',c:'#a77bff',on:'#ffffff',deep:'#3d2470',dark:'#160d29'},
    white:{name:'Off White',c:'#f2f2f2',on:'#0a0a0a',deep:'#4a4a4a',dark:'#1a1a1a'}};
function setAccent(id){const a=ACCENTS[id]||ACCENTS.lime;C.accent=a.c;C.onAccent=a.on;C.accentDeep=a.deep;C.accentDark=a.dark;return a;}
/** The kit's top bar in the same accent (its M Red theme with the accent swapped in). */
function kitTheme(base){const t=Object.assign({},base);t.accent=t.sel=t.ok=t.bar=t.marker=C.accent;t.selText=C.onAccent;t.glow=C.accent+'55';t.stripes=[C.accent];t.bg=C.bg;return t;}
function text(cv,value,x,y,size,color,align) {cv.text(String(value),x,y,size,color||C.text,{font:'label',align:align||'left',literal:true});}
function bold(cv,value,x,y,size,color,align) {cv.text(String(value),x,y,size,color||C.text,{font:'bold',align:align||'left',literal:true});}
function card(cv,x,y,w,h) {cv.roundRect(x,y,w,h,11,C.edge);cv.card(x+1,y+1,w-2,h-2,10,[[0,'#141719'],[0.5,'#090b0c'],[1,'#050607']]);cv.line(x+14,y+1,x+w-14,y+1,1,'#b3b8bd55');}
function button(cv,label,x,y,w,h,action,key,selected,disabled) {
    card(cv,x,y,w,h);
    if(selected){cv.card(x+1,y+1,w-2,h-2,9,[[0,C.accentDeep],[1,C.accentDark]]);cv.line(x+10,y+h-2,x+w-10,y+h-2,2,C.accent);}
    bold(cv,label,x+w/2,y+h/2+7,18,disabled?'#6f7680':C.text,'center');
    if(action && !disabled)cv.target(x,y,w,h,action,key,10);
}
function lineIcon(cv,id,x,y,size,color) {
    const s=size/24,c=color||C.text;
    function line(points){cv.polyline(points.map((p)=>[x+p[0]*s,y+p[1]*s]),1.7*s,c);}
    if(id==='home'){line([[2,11],[12,2],[22,11]]);line([[5,9],[5,22],[10,22],[10,15],[15,15],[15,22],[20,22],[20,9]]);}
    else if(id==='controls'){[5,12,19].forEach((v,i)=>{line([[2,v],[22,v]]);cv.circle(x+[8,16,10][i]*s,y+v*s,2.5*s,C.bg);cv.arc(x+[8,16,10][i]*s,y+v*s,1.5*s,2.6*s,0,360,c);});}
    else if(id==='hybrid'){cv.roundRect(x+2*s,y+6*s,19*s,13*s,3*s,c);cv.roundRect(x+4*s,y+8*s,15*s,9*s,1*s,C.bg);line([[22,10],[23,10],[23,15],[22,15]]);line([[13,7],[9,13],[14,13],[11,18]]);}
    else {cv.arc(x+12*s,y+12*s,7*s,9*s,0,360,c);for(let i=0;i<8;i++){const a=i*Math.PI/4;cv.line(x+(12+8*Math.cos(a))*s,y+(12+8*Math.sin(a))*s,x+(12+12*Math.cos(a))*s,y+(12+12*Math.sin(a))*s,3*s,c);}cv.circle(x+12*s,y+12*s,3*s,C.bg);}
}
module.exports={C,ACCENTS,setAccent,kitTheme,text,bold,card,button,lineIcon};
