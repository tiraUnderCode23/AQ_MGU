'use strict';
// Reference-matched geometry: BMW G87 P90481844; G80 ID7 P90415054.
const WHITE='#f5f7fa',RED='#ed1730',BLUE='#79c9ff';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
function point(f,side,skin){
 f=clamp(f,0,1);let x,y;
 if(skin==='id7'){
  // Smooth outer shoulders and flattened ends of the OS7 counter-rotating cluster.
  const pts=[[1350,360],[1436,344],[1478,294],[1510,232],[1487,191],[1435,146],[1360,113],[1230,98]];
  const u=f*(pts.length-1),i=Math.min(pts.length-2,Math.floor(u)),t=u-i;
  const p0=pts[Math.max(0,i-1)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(pts.length-1,i+2)];
  const cat=(k)=>.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t*t+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t*t*t);
  x=cat(0);y=cat(1);
 }else{
  y=362-264*f;
  if(f<.585)x=1370+130*f/.625;
  else if(f>.665)x=1500-66*(f-.625)/.375;
  else{const t=(f-.585)/.08;x=(1-t)*(1-t)*(1370+130*.585/.625)+2*t*(1-t)*1500+t*t*(1500-66*(.665-.625)/.375);}
 }
 return {x:side==='left'?1600-x:x,y};
}
function ribbon(cv,side,skin,from,to,outer,inner,color){
 if(to<=from)return;const dir=side==='left'?-1:1,n=Math.max(1,Math.ceil((to-from)*48));
 const edge=[],inside=[];
 for(let i=0;i<=n;i++){const p=point(lerp(from,to,i/n),side,skin);edge.push([p.x-dir*outer,p.y]);inside.push([p.x-dir*inner,p.y]);}
 cv.fill(edge.concat(inside.reverse()),color,true);
}
// Draw squared cluster numerals directly as vector strokes, independent of font atlases.
const SEG={0:'abcedf',1:'bc',2:'abdeg',3:'abcdg',4:'bcfg',5:'acdfg',6:'acdefg',7:'abc',8:'abcdefg',9:'abcdfg',P:'abefg',R:'abefg',N:'bcef'};
function digits(cv,str,x,y,h,color,align){
 str=String(str);const w=h*.82,gap=h*.18,total=str.length*(w+gap)-gap;
 if(align==='center')x-=total/2;else if(align==='right')x-=total;
 const th=h*.15;
 for(const ch of str){
  if(ch==='-'||ch==='–'){cv.fillRect(x,y+h*.48,w,th,color);x+=w+gap;continue;}
  const segments=SEG[ch]||'';
  const horizontal=(yy)=>cv.fillRect(x,yy,w,th,color);
  const vertical=(xx,yy)=>cv.fillRect(xx,yy,th,h*.53,color);
  if(segments.includes('a'))horizontal(y);
  if(segments.includes('g'))horizontal(y+h*.47);
  if(segments.includes('d'))horizontal(y+h-th);
  if(segments.includes('f'))vertical(x,y);
  if(segments.includes('b'))vertical(x+w-th,y);
  if(segments.includes('e'))vertical(x,y+h*.47);
  if(segments.includes('c'))vertical(x+w-th,y+h*.47);
  if(ch==='N')cv.quad([[x,y],[x+th,y],[x+w,y+h],[x+w-th,y+h]],color);
  if(ch==='R')cv.quad([[x+w*.45,y+h*.5],[x+w*.58,y+h*.5],[x+w,y+h],[x+w-th,y+h]],color);
  x+=w+gap;
 }
}
function scale(cv,G,side,value,max,skin){
 const id7=skin==='id7',dir=side==='left'?-1:1,color=id7?WHITE:side==='left'?BLUE:RED;
 const speedMarks=[0,30,60,90,120,150,210,270,330];
 cv.blit(G.layer('oem-rails-v4-'+skin+'-'+side+'-'+max,1600,390,c=>{
  ribbon(c,side,skin,0,1,0,id7?2:7,color);
  ribbon(c,side,skin,0,1,id7?3:8,id7?16:28,id7?'#181c22':side==='left'?'#10273b':'#340d14');
  ribbon(c,side,skin,0,1,29,30,id7?'#626974':color);
  const low=point(0,side,skin),high=point(1,side,skin);
  c.line(low.x,low.y,low.x-dir*180,low.y,2,color);
  if(!id7)c.line(high.x,high.y,high.x-dir*260,high.y,2,color);
  const n=side==='right'?max/1000:8;
  for(let i=0;i<=n*4;i++){
   const f=i/(n*4),p=point(f,side,skin),major=i%4===0;
   c.line(p.x-dir*8,p.y,p.x-dir*(major?22:13),p.y,major?1.6:1,'#bfc4ca');
   if(major){const label=side==='right'?i/4:speedMarks[i/4];
    const xx=p.x+(id7?-dir*48:dir*31);
    digits(c,label,xx,p.y-9,18,f>=.875&&side==='right'?RED:WHITE,'center');
   }
  }
  if(side==='right'){
   ribbon(c,side,skin,.875,1,2,id7?8:12,RED);
   for(let i=0;i<8;i++){const p=point(.875+i*.125/8,side,skin);c.line(p.x-dir*3,p.y,p.x-dir*16,p.y+5,1,'#ffadb5');}
  }
 }),0,0);
 const sv=G.smooth('oem-'+side+'-'+skin,Number.isFinite(value)?value:null,22);
 if(Number.isFinite(sv)){
  let f=sv/max;
  if(side==='left')f=sv<=150?sv/150*.625:.625+(sv-150)/180*.375;
  f=clamp(f,0,1);
  ribbon(cv,side,skin,0,f,9,27,id7?RED:color);
  const p=point(f,side,skin);cv.line(p.x-dir*31,p.y,p.x+dir*3,p.y,3,WHITE);
 }
}
module.exports={scale,point,digits,ribbon};
