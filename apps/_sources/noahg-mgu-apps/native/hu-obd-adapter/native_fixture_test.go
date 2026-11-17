package main

import (
	"io"
	"os"
	"os/exec"
	"sync"
)

type nativeFixtureWorker struct {
	cmd    *exec.Cmd
	reader io.ReadCloser
	writer io.WriteCloser
	once   sync.Once
}

func (v *nativeFixtureWorker) ReadFrame() ([]byte, error) { return readFrame(v.reader) }
func (v *nativeFixtureWorker) WriteFrame(b []byte) error  { return writeAll(v.writer, b) }
func (v *nativeFixtureWorker) Close() error {
	v.once.Do(func() { v.writer.Close(); v.reader.Close(); v.cmd.Process.Kill(); v.cmd.Wait() })
	return nil
}

// Opt-in native replay through the production TASU session core.
// Replies come from a private fixture; no vendor payloads are distributed.
func startNativeFixtureWorker(replies, worker string) (vehicle, error) {
	const script = `
const fs=require('fs'),fixture=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const core=require(process.argv[2]);let session;
const proxy={callMethod(name,p){
 const u=Buffer.concat([Buffer.from([p.serviceID]),p.udsData]);
 let reply=fixture.replies[Buffer.concat([Buffer.from([p.targetAddress]),u]).toString('hex')];
 let uds=reply?Buffer.from(reply,'hex'):p.serviceID===0x2c?Buffer.concat([Buffer.from([0x6c]),u.slice(1,4)]):Buffer.from([0x7f,p.serviceID,0x31]);
 setImmediate(()=>{const h=Buffer.alloc(9);h[6]=p.targetAddress;session.reply({errorCode:0,udsResponse:Buffer.concat([h,uds])});});
 return Promise.resolve('NO_ERROR');
}};
session=core.createSession(proxy,m=>{if(m.type==='frame')process.stdout.write(Buffer.from(m.hex,'hex'));if(m.type==='error'){process.stderr.write('TASU fixture failed\n');process.exit(1);}});
session.availability(true);let input=Buffer.alloc(0);
process.stdin.on('data',b=>{input=Buffer.concat([input,b]);while(input.length>=6){const n=input.readUInt32BE(0)+6;if(n>1048582)throw Error('fixture frame too large');if(input.length<n)return;session.enqueue(input.slice(0,n).toString('hex'));input=input.slice(n);}});
process.stdin.on('end',()=>{session.stop();process.exit(0);});
`
	node := os.Getenv("MGU_BOOTMOD3_NODE")
	if node == "" {
		node = "node"
	}
	cmd := exec.Command(node, "-e", script, replies, worker)
	in, e := cmd.StdinPipe()
	if e != nil {
		return nil, e
	}
	out, e := cmd.StdoutPipe()
	if e != nil {
		in.Close()
		return nil, e
	}
	cmd.Stderr = os.Stderr
	if e = cmd.Start(); e != nil {
		in.Close()
		out.Close()
		return nil, e
	}
	return &nativeFixtureWorker{cmd: cmd, reader: out, writer: in}, nil
}
