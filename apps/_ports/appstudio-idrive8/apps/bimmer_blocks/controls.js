'use strict';
const PUSH={KEINE_BETAETIGUNG:0,DREHGEBER_KURZ_GEDRUECKT:1,DREHGEBER_LANG_GEDRUECKT:2};
const DIR={MITTELSTELLUNG:0,NORD_KURZ_GEDRUECKT:1,NORD_LANG_GEDRUECKT:2,OST_KURZ_GEDRUECKT:4,OST_LANG_GEDRUECKT:5,SUED_KURZ_GEDRUECKT:7,SUED_LANG_GEDRUECKT:8,WEST_KURZ_GEDRUECKT:10,WEST_LANG_GEDRUECKT:11};
const val=(v,map)=>typeof v==='number'?v:map[v];
class Controls {
 constructor(action){this.action=action;this.reset();}
 reset(){this.pos=null;this.pressed=false;this.dir=0;}
 raw(v){if(!v)return;const pos=v.frontRotaryEncoderOperation;if(Number.isInteger(pos)&&pos>=0&&pos<65535){if(this.pos!==null){const d=((pos-this.pos+32768)&65535)-32768;if(Math.abs(d)<=16)for(let i=0;i<Math.abs(d);i++)this.action(d>0?'right':'left');}this.pos=pos;}
 const p=val(v.frontRotaryEncoderPushButton,PUSH);const pressed=p===1||p===2;if(pressed&&!this.pressed)this.action('pause');this.pressed=pressed;
 const d=val(v.frontRotaryEncoderDeflection,DIR);const direction=d===1||d===2?1:d===4||d===5?4:d===7||d===8?7:d===10||d===11?10:0;
 if(direction&&direction!==this.dir)this.action({1:'rotate',4:'right',7:'drop',10:'left'}[direction]);this.dir=direction;}
}
module.exports={Controls};
