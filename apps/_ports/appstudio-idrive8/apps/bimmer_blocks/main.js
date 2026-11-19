'use strict';
const mgu=require('./kit/mgu'),G=require('./kit/gauges');
const {getLanguage}=require('./kit/i18n');
const {Game,SHAPES}=require('./engine'),{Controls}=require('./controls'),{Scores}=require('./scores');
const STR={score:['Punkte','Score'],best:['Highscore','High score'],lines:['Reihen','Lines'],level:['Level','Level'],next:['Nächster Stein','Next piece'],left:['Links','Left'],right:['Rechts','Right'],rotate:['Drehen','Rotate'],down:['Absenken','Down'],drop:['Fallen lassen','Drop'],pause:['Pause / Weiter','Pause / Resume'],new:['Neues Spiel','New game'],confirm:['Nochmals: neues Spiel','Again: new game'],paused:['Pausiert','Paused'],over:['Spiel beendet','Game over'],waiting:['Warte auf Geschwindigkeitssignal','Waiting for speed signal'],moving:['Nur im Stand spielen','Play only while stationary'],start:['Neues Spiel starten','Start a new game'],hint:['Bildschirmtasten oder iDrive-Fokus verwenden','Use screen buttons or iDrive focus'],direct:['Direkt: links/rechts kippen = bewegen · drücken = Pause','Direct: tilt left/right = move · press = pause'],tilt:['Kippen: oben = drehen · unten = fallen lassen','Tilt: up = rotate · down = hard drop'],local:['Highscore wird lokal gespeichert','High score is saved locally'],saveError:['Highscore konnte nicht gespeichert werden','High score could not be saved'],lost:['Signaldaten fehlen: Spiel pausiert','Signal unavailable: game paused']};
const L=k=>STR[k][getLanguage()==='de'?0:1];
const COLORS=['','#34d3f5','#ffe16b','#b18bff','#67df98','#ff6874','#559dff','#ffa65e'];
mgu.run({async start(ctx){
 const {ui,settings,log}=ctx,game=new Game(),scores=new Scores(ctx.dataDir);
 let speed=null,speedTime=0,started=false,dirty=true,last=Date.now(),confirmUntil=0,grabbed=false,saveError=!!scores.error;
 let speedSub=null,closed=false;
 // Keep the original stationary/speed-age guard. On ID8 it additionally needs
 // a fresh read-only subscription: provider loss or a failed getter must not
 // reuse the last stationary value. No new signal or vehicle method is added.
 const speedSource=ui.id8?require('./kit/readonly_signals').forHmi('ID8'):ctx.signals;
 const visible=()=>ui.isVisible('MAIN')&&(!ui.hasFocus||ui.hasFocus('MAIN'));
 const permitted=()=>speed!==null&&Date.now()-speedTime<10000&&speed<=0.5&&(!ui.id8||(!closed&&speedSub&&speedSub.fresh('statusCarSpeed2')));
 const store=()=>{try{scores.save(game.score);}catch(e){saveError=true;log.warn('highscore save: '+e);}};
 const controls=new Controls(action);
 function pause(){if(!game.paused){game.paused=true;store();}dirty=true;}
 function sync(){if(!permitted()||!visible())pause();const want=started&&game.active()&&permitted()&&visible()&&!!settings.get('direct');if(want!==grabbed){ctx.controller.grab(want);grabbed=want;controls.reset();dirty=true;}}
 function action(key){
  dirty=true;
  if(key==='pause'){if(started&&!game.over&&permitted()){if(game.paused){game.paused=false;last=Date.now();}else pause();}sync();return;}
  if(key==='new'){
   if(!permitted())return;
   if(started&&!game.over&&Date.now()>confirmUntil){confirmUntil=Date.now()+5000;pause();return;}
   store();game.restart();started=true;confirmUntil=0;last=Date.now();sync();return;
  }
  if(!started||!permitted()||!visible()||!game.active())return;
  if(key==='left')game.move(-1);if(key==='right')game.move(1);if(key==='rotate')game.rotate();if(key==='down')game.down(true);if(key==='drop')game.drop();
  if(game.over){store();sync();}
 }
 speedSource.watch('de.bmw.infotainment.vehicle.Vehicle2','1',{statusCarSpeed2:v=>{
  if(closed)return;
  const raw=v&&v.speedVehicleCentreOfGravity;
  if(typeof raw==='number'&&isFinite(raw)&&raw>=0&&raw<65535){speed=raw*0.015625;speedTime=Date.now();}else{speed=null;speedTime=0;}
  dirty=true;sync();
 }},log,{pollMs:2000}).then(s=>{if(closed){if(s&&s.shutdown)s.shutdown();return;}speedSub=s;if(s.error)log.warn('speed signal: '+s.error);if(ui.id8)sync();}).catch(e=>log.warn(String(e)));
 ['left','rotate','right','down','drop','pause','new'].forEach(k=>{ui.onClick('BTN_'+k.toUpperCase(),()=>action(k));ui.text('BTN_'+k.toUpperCase(),L(k));});
 ctx.controller.onInput(v=>{if(grabbed)controls.raw(v);});
 settings.onChange(()=>{dirty=true;sync();});ctx.onLayout(()=>{dirty=true;});
 const timer=setInterval(()=>{sync();dirty=true;},500);if(timer.unref)timer.unref();
 if(ui.id8){
  ui.onVisible(()=>{dirty=true;sync();});
  if(ctx.app&&ctx.app.on)ctx.app.on('shutdown',()=>{closed=true;speed=null;speedTime=0;clearInterval(timer);pause();sync();if(speedSub&&speedSub.shutdown)speedSub.shutdown();});
 }
 async function render(){
  if(closed)return;
  sync();const now=Date.now(),dt=now-last;last=now;
  if(started&&permitted()&&visible())game.tick(dt);
  if(game.over){store();sync();}
  if(!dirty&&!game.active())return;dirty=false;
  const t=ctx.theme(),cv=ctx.canvas(1600,520).clear(t.bg);
  function text(s,x,y,size,color){cv.text(String(s),x,y,size||25,color||t.text);}
  function button(key,x,y,w){const label=key==='new'&&confirmUntil>Date.now()?L('confirm'):L(key);cv.roundRect(x,y,w,56,9,key==='new'?'#0767d8':'#202d40');text(label,x+16,y+37,25);if(cv.own)cv.target(x,y,w,56,()=>action(key),key,5);}
  G.frame(cv,t,['Bimmer Blocks'],0,[]);
  text('BIMMER BLOCKS',35,94,39);text(L('moving'),35,130,23,t.dim);
  [[L('score'),game.score],[L('best'),Math.max(scores.best,game.score)],[L('lines'),game.lines],[L('level'),game.level]].forEach((v,i)=>{const x=35+(i%2)*275,y=156+Math.floor(i/2)*91;cv.roundRect(x,y,255,78,9,'#152235');text(v[0],x+14,y+26,21,t.dim);text(v[1],x+14,y+62,31);});
  button('left',35,357,155);button('rotate',205,357,155);button('right',375,357,155);button('down',35,428,240);button('drop',290,428,240);
  const bx=660,by=46,c=22;
  cv.roundRect(bx-6,by-6,232,452,5,'#263b54');cv.roundRect(bx,by,220,440,1,'#0a101b');
  function cell(x,y,color,ghost){if(ghost)cv.strokeRoundRect(bx+x*c+1,by+y*c+1,c-2,c-2,2,1,color);else{cv.roundRect(bx+x*c+1,by+y*c+1,c-2,c-2,2,color);cv.line(bx+x*c+3,by+y*c+3,bx+(x+1)*c-4,by+y*c+3,1,'#cde7ff');}}
  game.board.forEach((r,y)=>r.forEach((v,x)=>{if(v)cell(x,y,COLORS[v]);}));
  if(started&&!game.over){const gy=game.ghost();game.piece.forEach((r,y)=>r.forEach((v,x)=>{if(v){cell(game.x+x,gy+y,COLORS[game.kind+1],true);cell(game.x+x,game.y+y,COLORS[game.kind+1]);}}));}
  text(L('next'),955,94,28);SHAPES[game.next].forEach((r,y)=>r.forEach((v,x)=>{if(v)cv.roundRect(955+x*34,112+y*34,31,31,3,COLORS[game.next+1]);}));
  let status=!permitted()?(speed===null||now-speedTime>=10000?L('waiting'):L('moving')):!started?L('start'):game.over?L('over'):game.paused?L('paused'):'';
  text(status,955,235,25,t.warn);
  text(L('hint'),955,278,20,t.dim);text(L('direct'),955,311,18,t.dim);text(L('tilt'),955,341,18,t.dim);
  button('pause',955,367,560);button('new',955,438,560);
  text(saveError?L('saveError'):L('local'),35,511,19,saveError?t.warn:t.dim);
  await ui.image('MAIN_GFX',cv);
 }
 ctx.loop('MAIN',20,render);
}});
