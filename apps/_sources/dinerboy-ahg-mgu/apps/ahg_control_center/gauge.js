'use strict';
const M=require('./model'),T=require('./theme');
const {makeLayer,dropLayer}=require('./kit/record');
const Art=require('./art');
const RAD=Math.PI/180;
function point(cx,cy,r,a) {return [cx+r*Math.cos(a*RAD),cy+r*Math.sin(a*RAD)];}
class Gauge {
    constructor() {this.faces={};this.keys=[];this.needle={};}
    face(spec,r) {
        const key=[spec.label,spec.min,spec.max,spec.warn,spec.hot,r].join(':');
        if(this.faces[key])return this.faces[key];
        const d=r*2+16,c=r+8;
        const layer=makeLayer(d,d,(cv)=>{
            // the face artwork compiled nearest this size: far fewer triangles for the small dials
            Art.paint(cv,d<=200?'dial160':d<=320?'dial288':'dial',d,d);
            // Recorder arcs start at twelve o'clock; Cartesian geometry starts
            // at three. Keep warning zones on the same scale as ticks/needles.
            cv.arc(c,c,r*0.83,r*0.865,230,270,T.C.blue);
            if(spec.warn!=null)cv.arc(c,c,r*0.83,r*0.865,M.angle(spec.warn,spec.min,spec.max)+90,M.angle(spec.hot==null?spec.max:spec.hot,spec.min,spec.max)+90,T.C.amber);
            if(spec.hot!=null)cv.arc(c,c,r*0.83,r*0.865,M.angle(spec.hot,spec.min,spec.max)+90,490,T.C.red);
            const count=Math.round((spec.max-spec.min)/spec.minor);
            for(let i=0;i<=count;i++){
                const value=spec.min+i*spec.minor,a=M.angle(value,spec.min,spec.max);
                const major=Math.abs((value-spec.min)/spec.major-Math.round((value-spec.min)/spec.major))<0.001;
                const outer=r*0.815,inner=outer-(major?r*0.08:r*0.035);
                const p=point(c,c,inner,a),q=point(c,c,outer,a);
                cv.line(p[0],p[1],q[0],q[1],major?2:1,major?'#e5e7eb':'#74808d');
                if(major){const z=point(c,c,r*0.64,a);const label=spec.max>=1000?String(Math.round(value/1000)):String(Math.round(value*10)/10);
                    T.text(cv,label,z[0],z[1]+5,r>140?18:12,'#f0f2f5','center');}
            }
        });
        this.faces[key]=layer;this.keys.push(key);
        if(this.keys.length>12){const old=this.keys.shift();dropLayer(this.faces[old]);delete this.faces[old];}
        return layer;
    }
    draw(cv,id,spec,reading,cx,cy,r,dt) {
        const size=r>140?1:0.72;
        cv.blit(this.face(spec,r),cx-r-8,cy-r-8);
        const live=reading.quality==='live' && M.finite(reading.value);
        let value=this.needle[id];
        if(!live){delete this.needle[id];value=spec.min;}
        else {
            const target=M.clamp(reading.value,spec.min,spec.max);
            if(value==null)value=reading.source==='mock'?spec.min:target;
            value=M.damp(value,target,dt);this.needle[id]=value;
        }
        const a=M.angle(value,spec.min,spec.max)*RAD,ux=Math.cos(a),uy=Math.sin(a),nx=-uy,ny=ux;
        function p(l,w){return [cx+ux*l+nx*w,cy+uy*l+ny*w];}
        const polygon=[p(r*0.79,0),p(r*0.08,r*0.027),p(-r*0.16,r*0.022),p(-r*0.18,0),p(-r*0.16,-r*0.022),p(r*0.08,-r*0.027)];
        if(live){cv.fill(polygon.map((pt)=>[pt[0]+3,pt[1]+3]),'#000000aa');cv.fill(polygon,T.C.accent);const tip=p(r*0.7,0),tail=p(-r*0.11,0);cv.line(tail[0],tail[1],tip[0],tip[1],1,'#ffffff77');}
        else {const q=p(r*0.65,0);cv.line(cx,cy,q[0],q[1],2,'#333b45');}
        cv.circle(cx,cy,r*0.105,'#11151b');cv.arc(cx,cy,r*0.095,r*0.105,180,350,'#87909b');cv.circle(cx,cy,r*0.067,'#222831');
        T.bold(cv,spec.label,cx,cy+r*0.28,(r>140?20:18)*size,T.C.text,'center');
        T.text(cv,spec.unit+(spec.unit==='rpm'?' ×1000':''),cx,cy+r*0.42,15*size,T.C.muted,'center');
        const rw=r>140?133:94,rh=r>140?34:27,ry=cy+r*0.53;
        cv.roundRect(cx-rw/2,ry,rw,rh,5,'#7a838e');cv.roundRect(cx-rw/2+1,ry+1,rw-2,rh-2,4,'#06080b');
        T.bold(cv,M.format(reading,spec.decimals)+(live?' '+spec.unit:''),cx,ry+rh*0.72,20*size,live?T.C.text:T.C.muted,'center');
        const state=live?(reading.source==='mock'?'DEMO':'LIVE'):reading.quality==='stale'?'STALE':'NO SIGNAL';
        T.text(cv,state,cx,cy+r+12,13,live?(reading.source==='mock'?T.C.amber:T.C.blue):T.C.amber,'center');
    }
    /**
     * Two needles on one face: the target as a hollow outline, the actual filled in the accent (boost target vs
     * actual). Readout: the actual, with the target and the difference under the dial.
     */
    dual(cv,id,spec,target,actual,cx,cy,r,dt) {
        cv.blit(this.face(spec,r),cx-r-8,cy-r-8);
        const needle=(key,reading)=>{
            const live=reading.quality==='live'&&M.finite(reading.value);
            if(!live){delete this.needle[key];return null;}
            const t=M.clamp(reading.value,spec.min,spec.max);let v=this.needle[key];
            v=v==null?t:M.damp(v,t,dt);this.needle[key]=v;return v;
        };
        const tv=needle(id+':t',target),av=needle(id+':a',actual);
        const shape=(value,l,w)=>{const a=M.angle(value,spec.min,spec.max)*RAD,ux=Math.cos(a),uy=Math.sin(a),nx=-uy,ny=ux;
            const p=(L,W)=>[cx+ux*L+nx*W,cy+uy*L+ny*W];return [p(r*l,0),p(r*0.08,r*w),p(-r*0.16,r*w*0.8),p(-r*0.18,0),p(-r*0.16,-r*w*0.8),p(r*0.08,-r*w)];};
        if(tv!=null){const poly=shape(tv,0.84,0.034);cv.polyline(poly.concat([poly[0]]),2,T.C.text);}
        if(av!=null){const poly=shape(av,0.76,0.027);cv.fill(poly.map((pt)=>[pt[0]+3,pt[1]+3]),'#000000aa');cv.fill(poly,T.C.accent);}
        cv.circle(cx,cy,r*0.105,'#11151b');cv.arc(cx,cy,r*0.095,r*0.105,180,350,'#87909b');cv.circle(cx,cy,r*0.067,'#222831');
        T.bold(cv,spec.label,cx,cy+r*0.28,20,T.C.text,'center');
        T.text(cv,spec.unit,cx,cy+r*0.42,15,T.C.muted,'center');
        const rw=150,rh=34,ry=cy+r*0.53;
        cv.roundRect(cx-rw/2,ry,rw,rh,5,'#7a838e');cv.roundRect(cx-rw/2+1,ry+1,rw-2,rh-2,4,'#06080b');
        T.bold(cv,av==null?'--':M.format(actual,spec.decimals)+' '+spec.unit,cx,ry+rh*0.72,20,av==null?T.C.muted:T.C.text,'center');
        return {target:tv,actual:av};
    }
    clear() {this.keys.forEach((k)=>dropLayer(this.faces[k]));this.faces={};this.keys=[];this.needle={};}
}
module.exports={Gauge,point};
