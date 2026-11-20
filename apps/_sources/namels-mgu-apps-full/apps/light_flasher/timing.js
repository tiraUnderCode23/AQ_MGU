'use strict';
// Observe actual diagnostic timings, not optical timing. No commands.
function summarize(trace){
 const accepted=r=>typeof r.rx==='string'&&r.rx.startsWith('71')&&!r.error&&Number.isFinite(r.requestMs);
 // ON = 3101A54B08<pwm>.. with pwm>0; fast-test OFF = PWM 0 restart (3101A54B0800..).
 const isOff=r=>r.tx.startsWith('3101A54B0800');
 const starts=trace.filter(r=>r.tx.startsWith('3101')&&!isOff(r)&&accepted(r));
 const offs=trace.filter(r=>isOff(r)&&accepted(r));
 const stops=trace.filter(r=>r.tx.startsWith('3102')&&accepted(r));
 const gapMs=starts.slice(1).map((r,i)=>r.elapsedMs-starts[i].elapsedMs).filter(x=>Number.isFinite(x)&&x>=0);
 const stats=a=>a.length?{count:a.length,minMs:Math.min(...a),maxMs:Math.max(...a),meanMs:Math.round(a.reduce((x,y)=>x+y,0)/a.length)}:null;
 return {basis:'host call start to UDS completion; not measured lamp output',startResponses:stats(starts.map(x=>x.requestMs)),stopResponses:stats(stops.map(x=>x.requestMs)),pwm0OffResponses:stats(offs.map(x=>x.requestMs)),startDispatchGaps:stats(gapMs),opticalTimingVerified:false};
}
module.exports={summarize};