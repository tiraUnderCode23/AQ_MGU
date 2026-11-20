'use strict';
/**
 * pixel.js - the pixel-art parts of the Digital Garage look.
 *
 *  scene(cv, x, y, w, h)       the garage with the car (assets/scene.json): a 219 x 115 pixel image stored as
 *                              flat-colour rectangles, so it stays crisp at any size. It is recorded once per size
 *                              into a cached layer (one draw call per frame on the GPU renderer).
 *  word(cv, s, x, y, px, c)    text in a 5 x 7 pixel font (headings: "BMW G30 530e").
 *  wordWidth(s, px)
 *
 * The scene is the owner's own Digital Garage concept art, reduced to a real pixel grid (tools/make-dg-art.py).
 */
const path=require('path'),zlib=require('zlib');
const {makeLayer}=require('./kit/record');

let art=null;
function load(){
    if(art)return art;
    // the build packs assets/ into assets.pack; kit/pack reads that (or the plain folder in development)
    const a=require('./kit/pack').open(path.join(__dirname,'assets')).json('scene.json');if(!a.rects)throw new Error('Missing artwork assets/scene.json');
    const b=zlib.inflateSync(Buffer.from(a.rects,'base64')),rects=[];
    for(let i=0;i+5<=b.length;i+=5)rects.push([b[i],b[i+1],b[i+2],b[i+3],b[i+4]]);
    art={w:a.width,h:a.height,palette:a.palette,rects:rects};
    return art;
}
const layers={};
function sceneLayer(w,h){
    const key=w+'x'+h;if(layers[key])return layers[key];
    const a=load(),sx=w/a.w,sy=h/a.h;
    // pixel edges on whole device pixels: no seams between neighbouring rectangles
    const X=(i)=>Math.round(i*sx),Y=(j)=>Math.round(j*sy);
    layers[key]=makeLayer(w,h,(cv)=>{a.rects.forEach((r)=>{const x0=X(r[0]),y0=Y(r[1]);cv.fillRect(x0,y0,X(r[0]+r[2])-x0,Y(r[1]+r[3])-y0,a.palette[r[4]]);});});
    return layers[key];
}
function scene(cv,x,y,w,h){cv.blit(sceneLayer(Math.round(w),Math.round(h)),x,y);}

// 5 x 7 pixel font: each glyph is 7 rows of 5 bits (most significant bit = left column)
const G={
    A:[14,17,17,31,17,17,17],B:[30,17,17,30,17,17,30],C:[14,17,16,16,16,17,14],D:[30,17,17,17,17,17,30],E:[31,16,16,30,16,16,31],
    F:[31,16,16,30,16,16,16],G:[14,17,16,23,17,17,15],H:[17,17,17,31,17,17,17],I:[14,4,4,4,4,4,14],J:[7,2,2,2,2,18,12],
    K:[17,18,20,24,20,18,17],L:[16,16,16,16,16,16,31],M:[17,27,21,21,17,17,17],N:[17,25,25,21,19,19,17],O:[14,17,17,17,17,17,14],
    P:[30,17,17,30,16,16,16],Q:[14,17,17,17,21,18,13],R:[30,17,17,30,20,18,17],S:[15,16,16,14,1,1,30],T:[31,4,4,4,4,4,4],
    U:[17,17,17,17,17,17,14],V:[17,17,17,17,17,10,4],W:[17,17,21,21,21,21,10],X:[17,17,10,4,10,17,17],Y:[17,17,10,4,4,4,4],
    Z:[31,1,2,4,8,16,31],
    0:[14,17,17,17,17,17,14],1:[4,12,4,4,4,4,14],2:[14,17,1,2,4,8,31],3:[31,2,4,2,1,17,14],4:[2,6,10,18,31,2,2],
    5:[31,16,30,1,1,17,14],6:[6,8,16,30,17,17,14],7:[31,1,2,4,8,8,8],8:[14,17,17,14,17,17,14],9:[14,17,17,15,1,2,12],
    e:[0,0,14,17,31,16,14],' ':[0,0,0,0,0,0,0],'.':[0,0,0,0,0,0,4],',':[0,0,0,0,0,4,8],'-':[0,0,0,14,0,0,0],'/':[1,2,2,4,8,8,16],
    ':':[0,4,0,0,0,4,0],'%':[25,26,2,4,8,11,19],'+':[0,4,4,31,4,4,0],'!':[4,4,4,4,4,0,4],'?':[14,17,1,2,4,0,4]};
function glyph(ch){return G[ch]||G[String(ch).toUpperCase()]||G['?'];}
function wordWidth(s,px){s=String(s);return s.length?(s.length*6-1)*px:0;}
/** pixel text: px = the size of one font pixel; y = the top of the letters. shadow: a dark copy 1 font pixel down */
function word(cv,s,x,y,px,color,opts){
    s=String(s);opts=opts||{};
    const w=wordWidth(s,px);if(opts.align==='center')x-=w/2;else if(opts.align==='right')x-=w;
    if(opts.shadow)word(cv,s,x+px,y+px,px,opts.shadow,{});
    for(let i=0;i<s.length;i++){
        const rows=glyph(s[i]),gx=x+i*6*px;
        for(let r=0;r<7;r++){
            let bits=rows[r],c=0;
            while(c<5){if(bits&(16>>c)){let e=c;while(e+1<5&&(bits&(16>>(e+1))))e++;cv.fillRect(gx+c*px,y+r*px,(e-c+1)*px,px,color);c=e+1;}else c++;}
        }
    }
    return w;
}
module.exports={scene,sceneLayer,word,wordWidth,load};
