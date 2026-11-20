'use strict';
// FLM02_L/R D6DB: 15 consecutive channel records, each 5 bytes.
// Readback only. A reported current/PWM is not proof of optical output or override authority.
function decode(reply){
 const tokens=String(reply||'').trim().split(/\s+/);
 if(tokens.length!==78||tokens.some(x=>!/^[\da-f]{2}$/i.test(x)))return null;
 const b=tokens.map(x=>parseInt(x,16));
 if(b[0]!==0x62||b[1]!==0xd6||b[2]!==0xdb)return null;
 const channels=[];
 for(let n=1;n<=15;n++){
  const i=3+5*(n-1);
  const phase=b[i+4],pwm=b[i];
  channels.push({channel:n,pwmPercent:pwm<=100?pwm:null,currentMa:b[i+1]*256+b[i+2],
    voltageV:b[i+3],phase:phase===0||phase===1?phase:null});
 }
 return channels;
}
function sampleState(sample){
 const expected=sample.label==='OEM steady high beam on'?'EIN':'AUS';
 const sides={};
 for(const side of ['left','right']){
  const row=sample.results.find(r=>r.side===side&&r.kind==='feedback'&&r.did==='D6 DB');
  const channels=row&&decode(row.reply);
  if(channels)sides[side]={lowBeam:channels[6],highBeam:channels[7],combinedSignal:row.combinedSignal};
 }
 const consistent=!!sample.complete&&sample.before===expected&&sample.after===expected&&
  ['left','right'].every(side=>sides[side]&&sides[side].combinedSignal===expected);
 return {expected,consistent,sides};
}
const limits=Object.freeze({oemPriorityVerified:false,zeroPwmOverrideVerified:false,
 physicalRestorationVerified:false,exact100msVerified:false,physicalActuation:false,
 reason:'Readback verified; control priority and restoration not established'});
module.exports={decode,sampleState,limits};
