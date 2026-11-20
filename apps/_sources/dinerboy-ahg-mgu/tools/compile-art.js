'use strict';
// Convert authored PNGs to the SDK's supported cached gradient-triangle layers.
// Native mgu-render/1 does not support kit setImage; Engine Config uses this
// same triangle-cell approach for its photographic exhaust artwork.
const fs=require('fs'),path=require('path'),zlib=require('zlib'),{PNG}=require('pngjs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'apps/ahg_control_center/assets');
fs.mkdirSync(output,{recursive:true});
// dial160 / dial288: the dial face pre-sized for the small and middle dials. Painting the 512 px face into a
// 160 px dial costs ~14k cells (83k vertices) per dial per frame; these have 2.6k / 6.2k.
const specs=[['dial','dial-face.png',512,512],['dial160','dial-face.png',160,160],['dial288','dial-face.png',288,288],['exhaust','exhaust-crop.png',820,213],['mark','ahg-mark.png',138,59]];
for(const spec of specs){
    const name=spec[0],png=PNG.sync.read(fs.readFileSync(path.join(root,'art',spec[1]))),W=spec[2],H=spec[3];
    function sample(x,y){
        const sx=Math.max(0,Math.min(png.width-1,x/W*(png.width-1))),sy=Math.max(0,Math.min(png.height-1,y/H*(png.height-1)));
        const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,png.width-1),y1=Math.min(y0+1,png.height-1),tx=sx-x0,ty=sy-y0;
        return [0,1,2,3].map((c)=>Math.round(png.data[(y0*png.width+x0)*4+c]*(1-tx)*(1-ty)+png.data[(y0*png.width+x1)*4+c]*tx*(1-ty)+png.data[(y1*png.width+x0)*4+c]*(1-tx)*ty+png.data[(y1*png.width+x1)*4+c]*tx*ty));
    }
    function pack(c){return (((c[0]<<24)|(c[1]<<16)|(c[2]<<8)|c[3])>>>0);}
    const cells=[];
    function cut(x,y,w,h){
        const c=[sample(x,y),sample(x+w,y),sample(x,y+h),sample(x+w,y+h)];
        let error=0;
        for(const uv of [[0.5,0.5],[0.25,0.25],[0.75,0.75],[0.25,0.75],[0.75,0.25],[0.5,0],[0.5,1],[0,0.5],[1,0.5]]){
            const u=uv[0],v=uv[1],real=sample(x+w*u,y+h*v);
            for(let k=0;k<4;k++){
                // The renderer shades two triangles across the 00—11 diagonal.
                const approx=u>=v?c[0][k]*(1-u)+c[1][k]*(u-v)+c[3][k]*v:c[0][k]*(1-v)+c[3][k]*u+c[2][k]*(v-u);
                error=Math.max(error,Math.abs(real[k]-approx));
            }
        }
        if((w<=2&&h<=2)||(error<=6&&w<=48&&h<=48)){
            if(c.every((s)=>s[3]===0))return;
            cells.push({x,y,w,h,c:c.map(pack)});return;
        }
        if(w>=h&&w>2){const a=Math.floor(w/2);cut(x,y,a,h);cut(x+a,y,w-a,h);}
        else{const a=Math.floor(h/2);cut(x,y,w,a);cut(x,y+a,w,h-a);}
    }
    cut(0,0,W,H);
    const bytes=Buffer.alloc(cells.length*24);
    cells.forEach((c,i)=>{let p=i*24;[c.x,c.y,c.w,c.h].forEach((n)=>{bytes.writeUInt16LE(n,p);p+=2;});c.c.forEach((n)=>{bytes.writeUInt32LE(n,p);p+=4;});});
    const pixels=Buffer.alloc(W*H*4);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const c=sample(x+0.5,y+0.5);for(let k=0;k<4;k++)pixels[(y*W+x)*4+k]=c[k];}
    fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify({width:W,height:H,count:cells.length,
        cells:zlib.deflateSync(bytes,{level:9}).toString('base64'),pixels:zlib.deflateSync(pixels,{level:9}).toString('base64')}));
    console.log(name+': '+cells.length+' cached shaded cells, '+W+'x'+H+' exact software pixels');
}
