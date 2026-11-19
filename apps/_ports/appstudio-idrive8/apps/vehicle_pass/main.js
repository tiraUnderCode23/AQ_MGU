'use strict';
const mgu=require('./kit/mgu'),G=require('./kit/gauges'),themes=require('./kit/themes');
const {getLanguage}=require('./kit/i18n');
const M=require('./model');
require('./text-font');
themes.THEMES.bimmer_blue=Object.assign({},themes.THEMES.m_tricolour,{name:'Bimmer Blue',sel:'#0879ff',selText:'#ffffff',accent:'#0879ff',accent2:'#67b4ff',bar:'#0879ff',bg:'#070b10'});
const labels={
 tyreService:['Reifenwechsel','Tyre change'],overview:['Übersicht','Overview'],history:['Wartungshistorie','Maintenance history'],profile:['Fahrzeugprofil','Vehicle profile'],tyres:['Reifenübersicht','Tyre overview'],mileage:['Kilometerstand','Mileage'],
 oil:['Öl und Filter','Oil and filter'],brakes:['Bremsen','Brakes'],fluid:['Bremsflüssigkeit','Brake fluid'],plugs:['Zündkerzen','Spark plugs'],inspection:['Inspektion','Inspection'],other:['Sonstiges','Other'],
 add:['Eintrag hinzufügen','Add entry'],edit:['Bearbeiten','Edit'],del:['Eintrag löschen','Delete entry'],confirm:['Löschen bestätigen','Confirm deletion'],cancel:['Abbrechen','Cancel'],save:['Speichern','Save'],back:['Zurück','Back'],
 kind:['Arbeit','Work'],date:['Datum','Date'],km:['Kilometerstand','Mileage'],dueKm:['Nächste Erinnerung bei km','Next reminder at km'],dueDate:['Nächste Erinnerung am','Next reminder on'],note:['Notiz','Note'],
 manual:['Manuell eingetragen','Manually entered'],empty:['Noch keine Wartung eingetragen','No maintenance entries yet'],none:['Keine eigene Erinnerung','No personal reminder'],disabled:['Nicht hinterlegt','Not entered'],due:['Fällig / überfällig','Due / overdue'],remaining:['Reststrecke','Distance left'],
 saved:['Gespeichert','Saved'],error:['Nicht gespeichert. Datum und Werte prüfen.','Not saved. Check dates and values.'],broken:['Datendatei nicht lesbar. Original bleibt erhalten.','Data file unreadable. Original preserved.'],
 step:['Schrittweite','Step size'],clear:['Wert leeren','Clear value'],done:['Fertig','Done'],space:['Leerzeichen','Space'],deleteChar:['Zeichen löschen','Delete character'],new:['Neuer Eintrag','New entry'],
 prev:['Vorherige Seite','Previous page'],next:['Nächste Seite','Next page'],hint:['Feld wählen, Wert ändern, anschließend speichern.','Select a field, edit its value, then save.'],keep:['Persönliches Wartungsbuch · keine CBS-Änderung','Personal maintenance log · no CBS changes'],
 count:['Einträge','Entries'],nextService:['Nächste Wartung','Next maintenance'],lastService:['Letzter Service','Last service'],car:['Bimmer Fahrzeugpass','Bimmer Vehicle Pass'],
 summer:['Sommerreifen','Summer tyres'],winter:['Winterreifen','Winter tyres'],allseason:['Ganzjahresreifen','All-season tyres'],active:['Aktiver Reifensatz','Active tyre set'],activate:['Diesen Satz aktiv setzen','Set as active'],
 frontSize:['Reifengröße vorne','Front tyre size'],rearSize:['Reifengröße hinten','Rear tyre size'],mountedOn:['Montagezeitpunkt','Fitted on'],frontBar:['Soll-Druck vorne (bar)','Front target pressure (bar)'],rearBar:['Soll-Druck hinten (bar)','Rear target pressure (bar)'],loadNote:['Beladung / Hinweis','Load / note'],
 front:['Vorderachse','Front axle'],rear:['Hinterachse','Rear axle'],targets:['Eigene Sollwerte · keine Live-Messung','Your target values · not live readings'],pressureNote:['Soll-Drücke aus deinen Fahrzeugunterlagen übernehmen.','Use the target pressures specified for your vehicle.'],
 model:['Fahrzeug / Modell','Vehicle / model'],modifications:['Umbauten','Modifications'],engineOil:['Verwendetes Motoröl','Engine oil used'],oilApproval:['Öl-Freigabe / Spezifikation','Oil approval / specification'],partNumbers:['Teilenummern','Part numbers'],partsNote:['Eigene Angaben · Teilezuordnung nicht automatisch geprüft','Your records · part compatibility not verified automatically'],letter:['Zeichen einfügen','Insert character'],chars:['Zeichen','Characters']
};
const L=k=>(labels[k]||[k,k])[getLanguage()==='de'?0:1];
const K=k=>L(k==='tyres'?'tyreService':k);
const copy=o=>JSON.parse(JSON.stringify(o));
function today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function shiftDate(s,n){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function shownDate(s){return !s?L('disabled'):getLanguage()==='de'?s.slice(8,10)+'.'+s.slice(5,7)+'.'+s.slice(0,4):s;}
function km(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,getLanguage()==='de'?'.':',')+' km';}
function pressure(n){return n===null?L('disabled'):n.toFixed(1).replace('.',getLanguage()==='de'?',':'.')+' bar';}
const ENTRY=[['kind','choice'],['date','date'],['km','km'],['dueKm','km'],['dueDate','date'],['note','text',80]];
const TYRES=[['frontSize','text',48],['rearSize','text',48],['mountedOn','date'],['frontBar','pressure'],['rearBar','pressure'],['loadNote','text',100]];
const PROFILE=Object.keys(M.PROFILE_LIMITS).map(k=>[k,'text',M.PROFILE_LIMITS[k]]);
mgu.run({async start(ctx){
 const {ui,settings}=ctx,store=new M.Store(ctx.dataDir);
 let dirty=true,tab=0,page='home',focus=0,offset=0,draft=null,selected=null,step=100,message='',editKind='entry',keyIndex=0,lower=false,textField=null,keyBuf='',detailText='',detailTitle='';
 let tyreSet=store.data.activeTyres||'summer';
 const tabs=['overview','history','tyres','profile'];
 const fields=()=>editKind==='entry'?ENTRY:editKind==='tyres'?TYRES:PROFILE;
 const alphabet=()=> (lower?'abcdefghijklmnopqrstuvwxyz':'ABCDEFGHIJKLMNOPQRSTUVWXYZ')+'0123456789 .,-/'+(lower?'äöüß':'ÄÖÜß')+':()';
 function act(fn){return ()=>{dirty=true;try{message='';fn();}catch(e){message=L('error');ctx.log.warn(String(e));}};}
 function begin(kind,value){if(store.error)return;editKind=kind;draft=copy(value);page='edit';focus=0;}
 function fresh(){begin('entry',{id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),kind:'oil',date:today(),km:store.data.odometer,dueKm:null,dueDate:null,note:''});}
 function keyboard(){textField=fields()[focus];keyBuf=draft[textField[0]];keyIndex=0;page='keyboard';}
 function finishText(){draft[textField[0]]=keyBuf;page='edit';dirty=true;}
 function insert(ch){keyBuf=(keyBuf+ch).slice(0,textField[2]);}
 function dateField(){return page==='edit'&&fields()[focus][1]==='date';}
 function effectiveStep(){return dateField()?(step===100?30:step===1000?365:1):step;}
 function nextStep(){step=step===1?100:step===100?1000:1;}
 function change(dir){
  if(page==='home'){if(tab===1){const n=M.history(store.data).length;focus=n?(focus+dir+n)%n:0;offset=Math.floor(focus/4)*4;}else if(tab===2)tyreSet=M.SETS[(M.SETS.indexOf(tyreSet)+dir+3)%3];return;}
  if(page==='keyboard'){keyIndex=(keyIndex+dir+alphabet().length)%alphabet().length;return;}
  if(page==='mileage'){draft.km=Math.max(0,Math.min(2000000,draft.km+dir*step));return;}
  if(page!=='edit')return;
  const [f,type]=fields()[focus];
  if(type==='choice')draft[f]=M.TYPES[(M.TYPES.indexOf(draft[f])+dir+M.TYPES.length)%M.TYPES.length];
  else if(type==='date'){const v=draft[f]||today();const n=shiftDate(v,draft[f]===null?0:dir*effectiveStep());if(M.dateOK(n))draft[f]=n;}
  else if(type==='pressure'){const tenth=Math.round((draft[f]||0)*10)+dir;draft[f]=tenth<=0?null:Math.min(100,tenth)/10;}
  else if(type==='text')keyboard();
  else draft[f]=Math.max(0,Math.min(2000000,(draft[f]===null?store.data.odometer:draft[f])+dir*step));
 }
 function clear(){if(page!=='edit')return;const [f,type]=fields()[focus];if(type==='text')draft[f]='';else if(['dueKm','dueDate','mountedOn','frontBar','rearBar'].indexOf(f)>=0)draft[f]=null;}
 function save(){
  if(store.error)return;
  if(page==='keyboard'){insert(alphabet()[keyIndex]);return;}
  if(page==='edit'){if(editKind==='entry'){store.save(draft);tab=1;offset=focus=0;}else if(editKind==='tyres'){store.tyres(tyreSet,draft);tab=2;}else{store.profile(draft);tab=3;}page='home';message=L('saved');return;}
  if(page==='mileage'){store.odometer(draft.km);page='home';message=L('saved');return;}
  if(page==='detail'){begin('entry',selected);return;}
  if(page==='confirm'){store.remove(selected.id);page='home';tab=1;offset=focus=0;return;}
  if(page==='longtext'){page='home';return;}
  if(tab===2){begin('tyres',store.data.tyres[tyreSet]);return;}
  if(tab===3){begin('profile',store.data.profile);return;}
  if(tab===1&&M.history(store.data)[focus]){selected=M.history(store.data)[focus];page='detail';return;}
  fresh();
 }
 function back(){dirty=true;if(page==='keyboard'){finishText();return;}page='home';message='';}
 function longText(title,text){detailTitle=title;detailText=text||L('disabled');page='longtext';}
 function editMileage(){draft={km:store.data.odometer};page='mileage';}
 function nativeLabels(){ui.text('BTN_PAGE',L('overview')+' / '+L('next'));ui.text('BTN_NEXT',L('next'));ui.text('BTN_SAVE',page==='keyboard'?L('letter'):L('save'));ui.text('BTN_BACK',page==='keyboard'?L('done'):L('back'));}
 ui.onClick('BTN_PAGE',act(()=>{if(page==='home'){tab=(tab+1)%4;focus=offset=0;}else if(page==='detail')page='confirm';else if(page==='keyboard')lower=!lower;else back();}));
 ui.onClick('BTN_NEXT',act(()=>{if(page==='edit')focus=(focus+1)%fields().length;else if(page==='keyboard'||page==='home')change(1);else nextStep();}));
 ui.onClick('BTN_MINUS',act(()=>change(-1)));ui.onClick('BTN_PLUS',act(()=>change(1)));ui.onClick('BTN_SAVE',act(save));ui.onClick('BTN_BACK',back);
 ctx.onTab(i=>{dirty=true;tab=i;page='home';focus=offset=0;});ctx.onLayout(()=>{dirty=true;});settings.onChange(()=>{dirty=true;});
 const clock=setInterval(()=>{dirty=true;},60000);if(clock.unref)clock.unref();
 async function render(){
  if(!dirty)return;dirty=false;nativeLabels();
  const t=ctx.theme(),cv=ctx.canvas(1600,520).clear(t.bg),blue='#0879ff';
  function text(s,x,y,size,color){cv.text(String(s),x,y,size||26,color||t.text,{literal:true});}
  function fit(s,width,size){s=String(s);while(s.length&&cv.textWidth(s,size||26,{literal:true})>width)s=s.slice(0,-1);return s;}
  function button(label,x,y,w,fn,active){cv.roundRect(x,y,w,52,8,active?blue:'#19212d');cv.strokeRoundRect(x,y,w,52,8,1,active?'#69b2ff':'#3e4856');text(fit(label,w-32,24),x+16,y+35,24);if(cv.own)cv.target(x,y,w,52,act(fn),label,5);}
  function row(label,value,y,fn,on){cv.roundRect(24,y,1552,48,7,on?'#064b9c':'#141b25');text(fit(label,560,24),42,y+33,24);text(fit(value,900,25),625,y+33,25);if(fn&&cv.own)cv.target(24,y,1552,48,act(fn),label,5);}
  function panel(x,y,w,h){cv.roundRect(x,y,w,h,10,'#121b27');cv.strokeRoundRect(x,y,w,h,10,1,'#354252');}
  function car(x,y,scale){const p=(n)=>n*scale;cv.line(x+p(8),y+p(50),x+p(40),y+p(20),3,blue);cv.line(x+p(40),y+p(20),x+p(116),y+p(20),3,blue);cv.line(x+p(116),y+p(20),x+p(151),y+p(50),3,blue);cv.strokeRoundRect(x,y+p(50),p(165),p(45),8,3,blue);cv.circle(x+p(35),y+p(97),p(15),'#111822');cv.circle(x+p(130),y+p(97),p(15),'#111822');cv.circle(x+p(35),y+p(97),p(7),'#b3c6df');cv.circle(x+p(130),y+p(97),p(7),'#b3c6df');}
  function detailLines(s,x,y,width,size,max){let remaining=String(s);for(let n=0;n<max&&remaining;n++){let line=fit(remaining,width,size);if(!line)break;if(line.length<remaining.length){const k=line.lastIndexOf(' ');if(k>line.length/2)line=line.slice(0,k);}text(line,x,y+n*(size+12),size);remaining=remaining.slice(line.length).trim();}}
  G.frame(cv,t,tabs.map(L),tab,[]);
  if(store.error){text(L('broken'),35,125,30,t.warn);await ui.image('MAIN_GFX',cv);return;}
  const records=M.history(store.data),profile=store.data.profile;
  if(page==='home'){
   if(tab===0){
    text(L('overview'),30,88,35);text(profile.model||L('car'),30,125,24,t.dim);car(1345,44,1.0);
    const reminders=M.reminders(store.data,today()),next=reminders[0],last=records[0];
    const xs=[30,555,1080];xs.forEach(x=>panel(x,157,490,185));
    text(L('nextService'),xs[0]+22,193,24,t.dim);text(fit(next?K(next.entry.kind):L('none'),445,35),xs[0]+22,246,35);
    const nextLine=next?(next.overdue?L('due'):next.remaining!==null?km(next.remaining):shownDate(next.entry.dueDate)):L('manual');
    text(nextLine,xs[0]+22,299,25,next&&next.overdue?t.warn:t.dim);
    text(L('mileage'),xs[1]+22,193,24,t.dim);text(km(store.data.odometer),xs[1]+22,246,43);text(L('manual'),xs[1]+22,299,24,t.dim);
    text(L('lastService'),xs[2]+22,193,24,t.dim);text(last?shownDate(last.date):'—',xs[2]+22,246,37);text(last?K(last.kind):L('empty'),xs[2]+22,299,24,t.dim);
    button('+  '+L('add'),30,373,730,fresh,true);button(L('mileage'),785,373,785,editMileage);
    text(L('keep'),30,478,23,t.dim);
   }else if(tab===1){
    text(L('history'),30,90,35);text(records.length+' '+L('count'),1250,90,24,t.dim);
    if(!records.length)text(L('empty'),35,190,29,t.dim);
    records.slice(offset,offset+4).forEach((e,i)=>row(shownDate(e.date)+'   '+K(e.kind),km(e.km),119+i*61,()=>{selected=e;page='detail';},focus===offset+i));
    button(L('prev'),30,395,350,()=>{offset=Math.max(0,offset-4);focus=offset;});button(L('next'),400,395,350,()=>{if(offset+4<records.length){offset+=4;focus=offset;}});button('+ '+L('add'),775,395,795,fresh,true);
   }else if(tab===2){
    M.SETS.forEach((s,i)=>button(L(s),30+i*520,63,500,()=>{tyreSet=s;},s===tyreSet));
    const tyres=store.data.tyres[tyreSet];panel(30,135,750,194);panel(800,135,770,194);
    [0,1].forEach(i=>{const x=i?824:54;cv.circle(x+35,182,28,blue);cv.circle(x+35,182,15,'#111b27');text(L(i?'rear':'front'),x+85,186,26);text(fit(tyres[i?'rearSize':'frontSize']||L('disabled'),690,32),x,242,32);text(pressure(tyres[i?'rearBar':'frontBar']),x,296,37);});
    text(L('mountedOn')+': '+shownDate(tyres.mountedOn),35,366,26);text(fit(tyres.loadNote||L('targets'),710,23),820,366,23,t.dim);
    button(L('edit'),30,397,480,()=>begin('tyres',tyres),true);
    button(store.data.activeTyres===tyreSet?L('active'):L('activate'),535,397,1035,()=>{store.activeTyres(tyreSet);message=L('saved');});
    text(L('pressureNote'),30,481,23,t.dim);
   }else if(tab===3){
    text(fit(profile.model||L('profile'),1190,34),30,92,34);car(1390,39,0.6);
    [['engineOil',profile.engineOil],['oilApproval',profile.oilApproval],['modifications',profile.modifications],['partNumbers',profile.partNumbers]].forEach((r,i)=>row(L(r[0]),r[1]||L('disabled'),119+i*61,()=>longText(L(r[0]),r[1]),false));
    button(L('edit'),30,397,730,()=>begin('profile',profile),true);button(L('mileage'),785,397,785,editMileage);text(L('partsNote'),30,481,22,t.dim);
   }
  }else if(page==='edit'){
   fields().forEach(([f,type],i)=>{const val=draft[f];const display=val===null?L('disabled'):type==='date'?shownDate(val):type==='pressure'?pressure(val):f==='kind'?K(val):val||'—';row(L(f),display,61+i*52,()=>{focus=i;if(type==='text')keyboard();},focus===i);});
   button('-',24,391,100,()=>change(-1));button('+',140,391,100,()=>change(1));
   const unit=fields()[focus][1]==='pressure'?'0,1 bar':effectiveStep()+(dateField()?' d':' km');
   button(L('step')+': '+unit,260,391,300,nextStep);button(L('clear'),580,391,240,clear);button(L('save'),840,391,310,save,true);button(L('cancel'),1170,391,390,back);
   text(L('hint'),30,477,23,t.dim);
  }else if(page==='keyboard'){
   text(L(textField[0])+'   '+keyBuf.length+'/'+textField[2],30,78,26,t.dim);detailLines(keyBuf.slice(-112)||'_',30,113,1480,24,2);
   Array.from(alphabet()).forEach((ch,i)=>button(ch===' '?'_':ch,30+(i%13)*118,160+Math.floor(i/13)*53,104,()=>insert(ch),keyIndex===i));
   button('Aa',30,391,160,()=>{lower=!lower;});button(L('deleteChar'),215,391,420,()=>{keyBuf=keyBuf.slice(0,-1);});button(L('done'),660,391,430,finishText,true);button(L('cancel'),1115,391,445,()=>{page='edit';});
  }else if(page==='mileage'){
   text(L('mileage'),30,105,34);text(km(draft.km),30,201,64);button('-',30,261,160,()=>change(-1));button('+',210,261,160,()=>change(1));button(L('step')+': '+step,400,261,390,nextStep);button(L('save'),30,382,400,save,true);button(L('cancel'),455,382,400,back);
  }else if(page==='detail'){
   row(L('kind'),K(selected.kind),63);row(L('date'),shownDate(selected.date)+'   /   '+km(selected.km),118);row(L('dueKm'),selected.dueKm===null?L('disabled'):km(selected.dueKm),173);row(L('dueDate'),shownDate(selected.dueDate),228);row(L('note'),selected.note||'—',283,()=>longText(L('note'),selected.note));button(L('edit'),30,385,400,save,true);button(L('del'),455,385,400,()=>{page='confirm';});button(L('back'),880,385,400,back);
  }else if(page==='confirm'){
   text(L('confirm')+'?',30,150,36);text(shownDate(selected.date)+'   '+K(selected.kind),30,215,30);button(L('confirm'),30,325,480,save,true);button(L('cancel'),540,325,400,()=>{page='detail';});
  }else if(page==='longtext'){
   text(detailTitle,30,100,35);detailLines(detailText,30,164,1490,30,6);button(L('back'),30,418,480,back,true);
  }
  if(message)text(message,30,510,21,t.warn);
  await ui.image('MAIN_GFX',cv);
 }
 ctx.loop('MAIN',2,render);
}});
