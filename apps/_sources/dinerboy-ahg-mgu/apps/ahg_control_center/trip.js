'use strict';
const M=require('./model');
class Trip {
    constructor(){this.reset();}
    reset(){this.km=0;this.previous=null;this.known=false;this.partial=false;}
    update(reading,now){
        if(reading.quality!=='live'||!M.finite(reading.value)){if(this.known)this.partial=true;this.previous=null;return;}
        if(this.previous){const dt=(now-this.previous.time)/1000;if(dt>0&&dt<1)this.km+=(reading.value+this.previous.speed)/2*dt/3600;else if(dt>=1)this.partial=true;}
        this.previous={time:now,speed:reading.value};this.known=true;
    }
}
module.exports={Trip};
