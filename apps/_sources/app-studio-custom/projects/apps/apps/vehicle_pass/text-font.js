
'use strict';
// Keep German personal notes readable after switching the app to English.
const fonts=require('./kit/fonts'),zlib=require('zlib'),data=require('./latin-font');
const original=fonts.get;
const sizes=data.sizes.map(s=>({size:s.size,ascent:s.ascent,descent:s.descent,atlasW:s.atlasW,atlasH:s.atlasH,glyphs:s.glyphs,_alpha:s.alpha,alpha:null,family:'vehicle_pass_latin',cacheKey:'v1'}));
fonts.get=function(name,size,text){
 if(!text||!/[\u00c0-\u024f]/.test(text))return original(name,size,text);
 let f=sizes.filter(s=>s.size>=size).sort((a,b)=>a.size-b.size)[0]||sizes[sizes.length-1];
 if(!f.alpha)f.alpha=zlib.inflateSync(Buffer.from(f._alpha,'base64'));
 return f;
};
