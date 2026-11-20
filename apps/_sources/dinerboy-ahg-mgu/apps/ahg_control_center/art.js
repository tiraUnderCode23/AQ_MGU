'use strict';
const path=require('path'),zlib=require('zlib');
const {makeLayer,OP}=require('./kit/record'),{Canvas}=require('./kit/canvas');
const db=require('./kit/pack').open(path.join(__dirname,'assets'));
const cache={};
function layer(name,w,h){
    const key=name+'@'+w+'x'+h;if(cache[key])return cache[key];
    const a=db.json(name+'.json');if(!a.count)throw new Error('Missing compiled artwork '+name);
    const cells=zlib.inflateSync(Buffer.from(a.cells,'base64')),sx=w/a.width,sy=h/a.height;
    const result=makeLayer(w,h,(cv)=>{
        cv._grow(2+a.count*18);let n=cv.n;const u=cv.u,f=cv.f;u[n++]=OP.TRIS;u[n++]=a.count*2;
        for(let i=0;i<a.count;i++){
            const p=i*24,x=cells.readUInt16LE(p)*sx,y=cells.readUInt16LE(p+2)*sy,
                x1=x+cells.readUInt16LE(p+4)*sx,y1=y+cells.readUInt16LE(p+6)*sy;
            const c0=cells.readUInt32LE(p+8),c1=cells.readUInt32LE(p+12),c2=cells.readUInt32LE(p+16),c3=cells.readUInt32LE(p+20);
            const points=[[x,y,c0],[x1,y,c1],[x1,y1,c3],[x,y,c0],[x1,y1,c3],[x,y1,c2]];
            for(let j=0;j<6;j++){f[n++]=points[j][0];f[n++]=points[j][1];u[n++]=points[j][2];}
        }
        cv.n=n;
    });
    // The kit software rasterizer shades triangles flat. Preserve the source
    // bitmap for its fallback while the GPU gets the cached shaded cells.
    const rgba=zlib.inflateSync(Buffer.from(a.pixels,'base64')),soft=new Canvas(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const from=(Math.min(a.height-1,Math.floor((y+0.5)*a.height/h))*a.width+Math.min(a.width-1,Math.floor((x+0.5)*a.width/w)))*4;
        for(let c=0;c<4;c++)soft.d[(y*w+x)*4+c]=rgba[from+c];
    }
    result.soft=soft;cache[key]=result;return result;
}
function draw(cv,name,x,y,w,h){cv.blit(layer(name,w,h),x,y);}
// Native renderd deliberately ignores nested OP_LAYER instructions. Inline
// artwork geometry into a parent cached layer instead of nesting textures.
function paint(cv,name,w,h){const a=layer(name,w,h);cv._grow(a.words.length);cv.u.set(a.words,cv.n);cv.n+=a.words.length;}
module.exports={draw,layer,paint};
