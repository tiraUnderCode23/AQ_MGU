'use strict';
function validated(item,value) {
    if(item.type==='choice')return item.options.some((pair)=>pair[0]===value)?value:item.default;
    if(item.type==='number')return (item.steps||[]).indexOf(value)>=0?value:item.default;
    if(item.type==='bool')return typeof value==='boolean'?value:item.default;
    return item.default;
}
function normalize(settings,schema) {
    schema.forEach((item)=>{const value=settings.get(item.key),safe=validated(item,value);if(value!==safe)settings.set(item.key,safe);});
}
module.exports={validated,normalize};
