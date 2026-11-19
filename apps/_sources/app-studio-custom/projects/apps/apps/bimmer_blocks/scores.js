'use strict';
const fs=require('fs'),path=require('path');
class Scores{
 constructor(dir){this.file=path.join(dir,'blocks-highscore.json');this.best=0;this.error=null;try{const d=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!Number.isSafeInteger(d.best)||d.best<0)throw Error('Invalid score');this.best=d.best;}catch(e){if(e.code!=='ENOENT')this.error=e;}}
 save(score){if(this.error||!Number.isSafeInteger(score)||score<=this.best)return;const tmp=this.file+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify({best:score}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(fs.existsSync(this.file))fs.copyFileSync(this.file,this.file+'.bak');fs.renameSync(tmp,this.file);this.best=score;}
}
module.exports={Scores};
