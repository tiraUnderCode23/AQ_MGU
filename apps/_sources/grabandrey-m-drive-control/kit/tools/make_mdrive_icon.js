'use strict';
// Original M Drive mark, rendered with the same vector canvas as the app.
const fs=require('fs');
const path=require('path');
const {ScaledCanvas}=require('../runtime/canvas');
const root=path.resolve(__dirname,'../..');
function render(size){
 const c=new ScaledCanvas(140,140,size/140);
 const white='#f4f5f7',blue='#81c4ff',navy='#16588e',red='#ed172d';
 c.arc(70,77,48,53,-130,130,'#747c86');
 c.arc(70,77,48,53,62,130,red);
 for(let a=-120;a<=120;a+=40){const r=a*Math.PI/180;
  c.line(70+Math.sin(r)*39,77-Math.cos(r)*39,70+Math.sin(r)*44,77-Math.cos(r)*44,2.5,white);
 }
 // Three slanted motorsport stripes and a strong angular M monogram.
 [blue,navy,red].forEach((color,i)=>c.quad([[25+i*11,68],[33+i*11,68],[23+i*11,94],[15+i*11,94]],color));
 c.fill([[59,94],[69,61],[80,61],[86,77],[101,61],[114,61],[104,94],[93,94],[99,76],[84,91],[77,91],[73,76],[68,94]],white);
 c.line(48,115,96,115,3,white);
 return c.canvas.png(9);
}
fs.writeFileSync(path.join(root,'apps/andrei_mdrive/icon.png'),render(140));
fs.mkdirSync(path.join(root,'docs/mdrive'),{recursive:true});
fs.writeFileSync(path.join(root,'docs/mdrive/icon.png'),render(560));
console.log('Created 140px app icon and 560px documentation icon');
