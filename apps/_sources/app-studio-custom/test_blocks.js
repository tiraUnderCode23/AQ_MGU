'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {Game}=require('./bundled-apps/bimmer_blocks/engine'),{Controls}=require('./bundled-apps/bimmer_blocks/controls'),{Scores}=require('./bundled-apps/bimmer_blocks/scores');
let count=0;function test(name,fn){fn();count++;console.log('OK '+name);}
function game(){const g=new Game(()=>0.4);g.restart();return g;}
test('seven-bag contains all shapes',()=>{const g=game();g.bag=[];assert.strictEqual(new Set(Array.from({length:7},()=>g.take())).size,7);});
test('board dimensions',()=>{const g=game();assert.strictEqual(g.board.length,20);assert(g.board.every(r=>r.length===10));});
test('left and right collision',()=>{const g=game();for(let i=0;i<25;i++)g.move(-1);assert(g.x>=0);for(let i=0;i<25;i++)g.move(1);assert(g.x+g.piece[0].length<=10);});
test('four rotations preserve piece',()=>{const g=game();g.kind=2;g.piece=[[0,1,0],[1,1,1]];g.x=4;g.y=5;const p=JSON.stringify(g.piece);for(let i=0;i<4;i++)g.rotate();assert.strictEqual(JSON.stringify(g.piece),p);});
test('square rotation unchanged',()=>{const g=game();g.kind=1;g.piece=[[1,1],[1,1]];const p=JSON.stringify(g.piece);g.rotate();assert.strictEqual(JSON.stringify(g.piece),p);});
test('hard drop locks piece and awards score',()=>{const g=game();g.drop();assert(g.board.some(r=>r.some(Boolean)));assert(g.score>0);});
test('soft drop awards one point',()=>{const g=game();g.down(true);assert.strictEqual(g.score,1);assert.strictEqual(g.y,1);});
test('clear four rows',()=>{const g=game();for(let y=16;y<20;y++)g.board[y]=Array(10).fill(2);for(let y=16;y<20;y++)g.board[y][4]=0;g.kind=0;g.piece=[[1],[1],[1],[1]];g.x=4;g.y=16;g.lock();assert.strictEqual(g.lines,4);assert.strictEqual(g.score,800);assert(g.board.every(r=>r.every(v=>v===0)));});
test('level rises after ten lines',()=>{const g=game();g.lines=9;g.board[19]=Array(10).fill(2);g.board[19][4]=0;g.piece=[[1]];g.x=4;g.y=19;g.lock();assert.strictEqual(g.level,2);});
test('paused game ignores input and time',()=>{const g=game();g.paused=true;const before=JSON.stringify(g);g.move(1);g.down(true);g.drop();g.rotate();g.tick(1000);assert.strictEqual(JSON.stringify(g),before);});
test('spawn collision is game over',()=>{const g=game();g.board[0].fill(3);g.spawn();assert(g.over);});
test('restart clears board and score',()=>{const g=game();g.drop();g.restart();assert.strictEqual(g.score,0);assert(g.board.every(r=>r.every(v=>!v)));});
test('gravity advances on elapsed time',()=>{const g=game();for(let i=0;i<18;i++)g.tick(50);assert.strictEqual(g.y,1);});
test('ghost stays above floor',()=>{const g=game();const y=g.ghost();assert(g.fits(g.x,y,g.piece));assert(!g.fits(g.x,y+1,g.piece));});
test('controller press only once per edge',()=>{let actions=[];const c=new Controls(x=>actions.push(x));c.raw({frontRotaryEncoderPushButton:1});c.raw({frontRotaryEncoderPushButton:2});assert.deepStrictEqual(actions,['pause']);});
test('controller resets ignore counter jump',()=>{let a=[];const c=new Controls(x=>a.push(x));c.raw({frontRotaryEncoderOperation:100});c.raw({frontRotaryEncoderOperation:2000});assert.strictEqual(a.length,0);c.raw({frontRotaryEncoderOperation:2002});assert.deepStrictEqual(a,['right','right']);});
test('invalid controller counter ignored',()=>{let a=[];const c=new Controls(x=>a.push(x));c.raw({frontRotaryEncoderOperation:65535});assert.strictEqual(c.pos,null);});
test('controller directions match requested mapping',()=>{let a=[];const c=new Controls(x=>a.push(x));[10,0,4,0,1,0,7].forEach(d=>c.raw({frontRotaryEncoderDeflection:d}));assert.deepStrictEqual(a,['left','right','rotate','drop']);});
test('held direction drops only once',()=>{let a=[];const c=new Controls(x=>a.push(x));[7,8,8,8].forEach(d=>c.raw({frontRotaryEncoderDeflection:d}));assert.deepStrictEqual(a,['drop']);});
test('named direction enums work',()=>{let a=[];const c=new Controls(x=>a.push(x));['NORD_KURZ_GEDRUECKT','MITTELSTELLUNG','SUED_KURZ_GEDRUECKT'].forEach(d=>c.raw({frontRotaryEncoderDeflection:d}));assert.deepStrictEqual(a,['rotate','drop']);});
const dir=fs.mkdtempSync(path.join(__dirname,'score-test-'));
try{
 test('highscore persists and does not decrease',()=>{const s=new Scores(dir);s.save(1000);s.save(10);assert.strictEqual(new Scores(dir).best,1000);});
 test('highscore backup preserves preceding value',()=>{new Scores(dir).save(2000);assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir,'blocks-highscore.json.bak'))).best,1000);});
 test('corrupt highscore is preserved',()=>{const f=path.join(dir,'blocks-highscore.json');fs.writeFileSync(f,'broken');const s=new Scores(dir);assert(s.error);s.save(5000);assert.strictEqual(fs.readFileSync(f,'utf8'),'broken');});
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log(count+' block-game tests passed');
