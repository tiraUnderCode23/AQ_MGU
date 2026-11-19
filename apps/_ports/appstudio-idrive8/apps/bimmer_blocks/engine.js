'use strict';
const SHAPES=[[[1,1,1,1]],[[1,1],[1,1]],[[0,1,0],[1,1,1]],[[0,1,1],[1,1,0]],[[1,1,0],[0,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]]];
class Game {
 constructor(random){this.random=random||Math.random;this.restart();this.paused=true;}
 restart(){this.board=Array.from({length:20},()=>Array(10).fill(0));this.score=0;this.lines=0;this.level=1;this.over=false;this.paused=false;this.bag=[];this.elapsed=0;this.next=this.take();this.spawn();}
 take(){if(!this.bag.length){this.bag=[0,1,2,3,4,5,6];for(let i=6;i>0;i--){const j=Math.floor(this.random()*(i+1));const v=this.bag[i];this.bag[i]=this.bag[j];this.bag[j]=v;}}return this.bag.pop();}
 spawn(){this.kind=this.next;this.next=this.take();this.piece=SHAPES[this.kind].map(r=>r.slice());this.x=Math.floor((10-this.piece[0].length)/2);this.y=0;this.elapsed=0;if(!this.fits(this.x,this.y,this.piece))this.over=true;}
 fits(x,y,p){return p.every((r,j)=>r.every((v,i)=>!v||(x+i>=0&&x+i<10&&y+j>=0&&y+j<20&&!this.board[y+j][x+i])));}
 active(){return !this.paused&&!this.over;}
 move(dx){if(this.active()&&this.fits(this.x+dx,this.y,this.piece))this.x+=dx;}
 rotate(){if(!this.active()||this.kind===1)return;const p=this.piece[0].map((_,i)=>this.piece.map(r=>r[i]).reverse());for(const dy of [0,-1])for(const dx of [0,-1,1,-2,2])if(this.fits(this.x+dx,this.y+dy,p)){this.x+=dx;this.y+=dy;this.piece=p;return;}}
 down(manual){if(!this.active())return;if(this.fits(this.x,this.y+1,this.piece)){this.y++;if(manual)this.score++;}else this.lock();}
 ghost(){let y=this.y;while(this.fits(this.x,y+1,this.piece))y++;return y;}
 drop(){if(!this.active())return;const y=this.ghost();this.score+=(y-this.y)*2;this.y=y;this.lock();}
 lock(){this.piece.forEach((r,j)=>r.forEach((v,i)=>{if(v)this.board[this.y+j][this.x+i]=this.kind+1;}));const keep=this.board.filter(r=>r.some(v=>!v));const n=20-keep.length;while(keep.length<20)keep.unshift(Array(10).fill(0));this.board=keep;this.score+=[0,100,300,500,800][n]*this.level;this.lines+=n;this.level=1+Math.floor(this.lines/10);this.spawn();}
 tick(ms){if(!this.active())return;this.elapsed+=Math.max(0,Math.min(250,ms));const interval=Math.max(100,900-(this.level-1)*70);if(this.elapsed>=interval){this.elapsed-=interval;this.down(false);}}
}
module.exports={Game,SHAPES};
