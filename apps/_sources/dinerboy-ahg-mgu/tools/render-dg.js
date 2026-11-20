'use strict';
// Render every AHG Digital Garage page with test fixtures to PNG (no car, no emulator needed):
//   node tools/render-dg.js [out_dir]      -> out_dir/dg-<n>-<page>.png (default screenshots/digital-garage)
// Uses the kit's own recorder and software playback, i.e. what the car shows without the GPU renderer.
process.env.AHG_UNIT_TEST='1';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||path.join(root,'screenshots','digital-garage'));
const load=require('../test/load-dg');
const {Recorder,play}=require('../kit/runtime/record'),{Canvas}=require('../kit/runtime/canvas');
const G=require('../kit/runtime/gauges'),KIT_RED=require('../kit/runtime/themes').THEMES.m_red;
const T=load('theme'),V=load('view'),{fixture}=load.fixtureModule();
fs.mkdirSync(out,{recursive:true});
const empty=process.argv.indexOf('--empty')>=0;
fixture({empty}).then((a)=>{
    const ids=['garage','service','maintenance','diagnostics','modifications','records','info','settings'];
    ids.forEach((id,i)=>{
        a.page=i;T.setAccent(a.ctx.settings.get('accent'));
        const cv=new Recorder(1600,520);cv.clear(T.C.bg);
        const t=Object.assign({},KIT_RED);t.accent=t.sel=T.C.accent;t.bg=T.C.bg;
        G.frame(cv,t,[],-1,empty?[]:[{text:'TEST FIXTURE',color:T.C.amber}]);V.brand(cv);V.draw(cv,a);
        const c=new Canvas(1600,520);play(cv.words(),c);
        const file=path.join(out,'dg-'+(i+1)+'-'+id+'.png');fs.writeFileSync(file,c.png());console.log(file);
    });
}).catch((e)=>{console.error(e);process.exit(1);});
