'use strict';
// Offline composition model: a 2×2 grid, groups of up to four signals.
const categories = [
    { name: 'Двигатель', items: [['rpm','Обороты','об/мин'],['torque','Крутящий момент','Нм'],['power','Мощность','кВт'],['boost','Наддув','bar'],['gear','Передача',''],['pedal','Педаль газа','%']] },
    { name: 'Двигатель: доп.', items: [['powerPct','Мощность от максимума','%'],['torquePct','Момент от максимума','%'],['boostMax','Пиковый наддув','bar'],['engineState','Состояние двигателя',''],['oilLevel','Уровень масла',''],['startStop','Старт-стоп','']] },
    { name: 'Температуры', items: [['coolant','Охлаждение','°C'],['oil','Масло двигателя','°C'],['outside','Снаружи','°C'],['gearboxTemp','Масло коробки','°C']] },
    { name: 'Шины', items: [['p_fl','Переднее левое','bar'],['p_fr','Переднее правое','bar'],['p_rl','Заднее левое','bar'],['p_rr','Заднее правое','bar'],['t_fl','Темп. перед. лев.','°C'],['t_fr','Темп. перед. прав.','°C'],['t_rl','Темп. зад. лев.','°C'],['t_rr','Темп. зад. прав.','°C']] },
    { name: 'Движение', items: [['speed','Скорость','км/ч'],['accel','Разгон 0–100','с'],['g_long','Ускорение продольное','g'],['g_lat','Ускорение боковое','g'],['steer','Угол руля','°']] },
    { name: 'Движение: доп.', items: [['mode','Режим движения',''],['yaw','Скорость вращения','°/с'],['slope','Уклон дороги','%'],['braking','Торможение',''],['handbrake','Стояночный тормоз','']] },
    { name: 'Топливо и поездка', items: [['fuel','Уровень топлива','л'],['range','Запас хода','км'],['consumption','Расход','л/100 км'],['odo','Пробег','км'],['trip','Пробег поездки','км']] },
    { name: 'Поездка: доп.', items: [['avgCons1','Средний расход','л/100 км'],['avgSpeed1','Средняя скорость','км/ч'],['tripTime','Время поездки',''],['tripFuel','Топливо за поездку','л'],['fuelFlow','Расход в час','л/ч']] },
    { name: 'Электросистема', items: [['voltage','Напряжение 12 В','В'],['battery','Заряд 12 В батареи','%']] },
    { name: 'Медиа и навигация', items: [['track','Текущий трек',''],['artist','Исполнитель',''],['map','Карта CarPlay',''],['route','Маршрут','']] }
];
const items = {};
categories.forEach(c => c.items.forEach(i => { items[i[0]] = { id:i[0], name:i[1], unit:i[2], status:'unconfirmed' }; }));
items.tyres = {
    id:'tyres', name:'Шины', unit:'', status:'unconfirmed',
    wheels:[
        {id:'fl',label:'Переднее левое',pressure:'p_fl',temperature:'t_fl'},
        {id:'fr',label:'Переднее правое',pressure:'p_fr',temperature:'t_fr'},
        {id:'rl',label:'Заднее левое',pressure:'p_rl',temperature:'t_rl'},
        {id:'rr',label:'Заднее правое',pressure:'p_rr',temperature:'t_rr'}
    ]
};
function empty() { return {version:2, widgets:[]}; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function hasItem(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(items, id); }
function fits(ws,x,y,w,h,skip) {
    if (!Array.isArray(ws) || ![x,y,w,h].every(Number.isInteger) || x<0 || y<0 || w<1 || h<1 || x+w>3 || y+h>4) return false;
    if (!ws.every(v => v && [v.x,v.y,v.w,v.h].every(Number.isInteger) && v.x>=0 && v.y>=0 && v.w>0 && v.h>0 && v.x+v.w<=3 && v.y+v.h<=4)) return false;
    return !ws.some((v,i) => i!==skip && x<v.x+v.w && x+w>v.x && y<v.y+v.h && y+h>v.y);
}
function validate(o) {
    try {
        if (!o || typeof o !== 'object' || o.version !== 2 || !Array.isArray(o.widgets) || o.widgets.length > 12) return false;
        return o.widgets.every((v, i) => {
            if (!v || typeof v !== 'object' || !fits(o.widgets, v.x, v.y, v.w, v.h, i)) return false;
            if (!Array.isArray(v.pages) || v.pages.length < 1 || v.pages.length > 4 ||
                !Number.isInteger(v.active) || v.active < 0 || v.active >= v.pages.length) return false;
            return v.pages.every(p => Array.isArray(p) && p.length > 0 && p.length <= 2 &&
                p.every(hasItem) && new Set(p).size === p.length);
        });
    } catch (_) { return false; }
}
function migrate(o) {
    if (validate(o)) { try { return clone(o); } catch (_) { return null; } }
    if (!o || typeof o !== 'object' || o.version!==1 || !Array.isArray(o.groups) || o.groups.length>4) return null;
    const n=empty();
    for (const g of o.groups) {
        if (!g || !Array.isArray(g.items) || !g.items.length || g.items.length>4 || !g.items.every(hasItem) || !Number.isInteger(g.cell) || g.cell<0 || g.cell>3 || (g.size!==1 && g.size!==2) || (g.size===2 && g.cell%2)) return null;
        n.widgets.push({x:g.cell%2,y:Math.floor(g.cell/2)*2,w:g.size,h:2,pages:g.items.map(id=>[id]),active:0});
    }
    return validate(n)?n:null;
}
function decode(raw) {
    if (typeof raw !== 'string') return null;
    try { return migrate(JSON.parse(raw)); } catch (_) { return null; }
}
function encode(value) {
    if (!validate(value)) throw new TypeError('Expected a valid composition');
    try { return JSON.stringify(value); }
    catch (_) { throw new TypeError('Expected a serializable valid composition'); }
}
function apply(src,action,index,arg) {
    arg = arg && typeof arg === 'object' ? arg : {};
    if (action==='preset') {
        if (arg.name!=='temps' && arg.name!=='tyres') return {error:'Неизвестный шаблон'};
        const n=empty();
        if (arg.name==='temps') n.widgets=[{x:0,y:0,w:2,h:2,pages:[['coolant','oil']],active:0}];
        if (arg.name==='tyres') n.widgets=[{x:0,y:0,w:2,h:2,pages:[['tyres']],active:0}];
        return {value:n,index:0};
    }
    if (!validate(src)) return {error:'Некорректная композиция'};
    const o=clone(src), v=o.widgets[index];
    if (action==='add') {
        if (!hasItem(arg.id)) return {error:'Выберите показатель'};
        const w = arg.id === 'tyres' ? 2 : 1, h = arg.id === 'tyres' ? 2 : 1;
        if (!fits(o.widgets,arg.x,arg.y,w,h,-1)) return {error:arg.id === 'tyres' ? 'Шинам нужна область 2×2. Выберите другую ячейку или освободите место' : 'Ячейка занята. Выберите свободную'};
        o.widgets.push({x:arg.x,y:arg.y,w,h,pages:[[arg.id]],active:0}); return {value:o,index:o.widgets.length-1};
    }
    if (!v) return {error:'Сначала выберите виджет'};
    if (action==='move' || action==='size') {
        const x=action==='move'?arg.x:action==='size'&&Object.prototype.hasOwnProperty.call(arg,'x')?arg.x:v.x, y=action==='move'?arg.y:action==='size'&&Object.prototype.hasOwnProperty.call(arg,'y')?arg.y:v.y, w=action==='size'?arg.w:v.w, h=action==='size'?arg.h:v.h;
        if (!fits(o.widgets,x,y,w,h,index)) return {error:'Не помещается. Освободите место'};
        Object.assign(v,{x,y,w,h});
    } else if (action==='page' || action==='together') {
        if (!hasItem(arg.id)) return {error:'Выберите показатель'};
        if (v.pages.some(p=>p.indexOf(arg.id)>=0)) return {error:'Показатель уже добавлен'};
        if (action==='page') { if(v.pages.length>=4) return {error:'Не более 4 страниц'}; v.pages.push([arg.id]); v.active=v.pages.length-1; }
        else { if(v.pages[v.active].length>=2) return {error:'Вместе не более двух показателей'}; v.pages[v.active].push(arg.id); }
    } else if (action==='selectPage') {
        if (!Number.isInteger(arg.page) || arg.page < 0 || arg.page >= v.pages.length) return {error:'Страница не найдена'};
        v.active=arg.page;
    } else if (action==='next') {
        const delta = Number.isInteger(arg.delta) ? arg.delta : 1;
        v.active=((v.active+delta)%v.pages.length+v.pages.length)%v.pages.length;
    }
    else if (action==='order') { if(v.pages.length<2) return {error:'Только одна страница'}; const n=(v.active+1)%v.pages.length,t=v.pages[n];v.pages[n]=v.pages[v.active];v.pages[v.active]=t;v.active=n; }
    else if (action==='removeItem') { const p=v.pages[v.active]; p.pop(); if(!p.length) v.pages.splice(v.active,1); if(!v.pages.length) { o.widgets.splice(index,1); return {value:o,index:-1}; } v.active=Math.min(v.active,v.pages.length-1); }
    else if (action==='delete') o.widgets.splice(index,1);
    else if (action==='duplicate') { let place=null; for(let y=0;y<4 && !place;y++) for(let x=0;x<3;x++) if(fits(o.widgets,x,y,v.w,v.h,-1)){place={x,y};break;} if(!place) return {error:'Нет места для копии'}; const n=clone(v);n.x=place.x;n.y=place.y;o.widgets.push(n);return {value:o,index:o.widgets.length-1}; }
    else return {error:'Неизвестное действие'};
    return {value:o,index:Math.min(index,o.widgets.length-1)};
}
module.exports={categories,items,empty,validate,migrate,decode,encode,apply,fits};
