//go:build linux

package main

import (
	"bufio"
	"bytes"
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Requires a private, generated stock descriptor and the captured 12451
// request / 11002 offer policies. No firmware metadata is bundled here.
// The provider is synthetic but both processes use the real native binding
// and router, including method serialization and selective response delivery.
// All diagnostic data comes from the synthetic provider; no vehicle is used.
// The fixture runner must temporarily stop autosaronlinux.service in its
// disposable guest: it owns the same stock service/instance as our provider.
func TestEmulatorNativeTASURoundTrip(t *testing.T) {
	cfgPath := os.Getenv("MGU_TASU_NATIVE_CONFIG")
	if cfgPath == "" {
		t.Skip("requires private descriptor and captured native policies")
	}
	cfg, e := os.ReadFile(cfgPath)
	if e != nil {
		t.Fatal(e)
	}
	root, e := os.MkdirTemp("/tmp", "hu-obd-native-proxy-")
	if e != nil {
		t.Fatal(e)
	}
	defer os.RemoveAll(root)
	os.Chown(root, 8000, 903)
	os.Chmod(root, 0770)
	app := filepath.Join(root, "oap_12451")
	for _, d := range []string{"source", "someipInterfaces", "run"} {
		if e = os.MkdirAll(filepath.Join(app, d), 0755); e != nil {
			t.Fatal(e)
		}
	}
	if e = filepath.Walk(app, func(p string, _ os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		return os.Chown(p, 12451, 12451)
	}); e != nil {
		t.Fatal(e)
	}
	write := func(name string, b []byte) {
		t.Helper()
		p := filepath.Join(app, name)
		if e = os.WriteFile(p, b, 0644); e != nil {
			t.Fatal(e)
		}
		if e = os.Chown(p, 12451, 12451); e != nil {
			t.Fatal(e)
		}
	}
	write("source/package.json", []byte(`{"name":"noahg_obdbridge"}`))
	write("someipInterfaces/com_harman_infotainment_systemfunctions_tasu_tasu_InternalTasu.json", cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	js := `const fs=require('fs'),s=require('/usr/lib/someip.node'),cfg=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
let provider,calls=0;const subscribers=new Set();
process.on('uncaughtException',e=>console.error('FAKE_PROVIDER_EXCEPTION '+e.stack));
process.on('unhandledRejection',e=>console.error('FAKE_PROVIDER_REJECTION '+e));
setImmediate(()=>s.registerService(cfg,'SystemFunctionsInternalTasuInst1',{
clientSubscribed:(name,id)=>{subscribers.add(id);console.error('FAKE_SUBSCRIBED '+id);},
clientUnsubscribed:(name,id)=>{subscribers.delete(id);console.error('FAKE_UNSUBSCRIBED '+id);},
sendTasuRequest:(request,clientId)=>{
 console.error('FAKE_PROVIDER_CALLED client='+clientId+' subscribed='+subscribers.has(clientId));
 if(request.sourceAddress!==0xf2||(request.targetAddress!==0x12&&request.targetAddress!==0x10&&request.targetAddress!==0xdf)||request.serviceID!==0x22||request.subroutineID!==0||request.udsDataLength!==2||Buffer.from(request.udsData).toString('hex')!=='f190'||request.deadlockTime!==0)return Promise.resolve({TasuErrorEnum:'INVALID_REQUEST'});
 calls++;
 if(calls===2)return Promise.resolve({TasuErrorEnum:'NO_ERROR'}); // accepted but silent DME
 const h=Buffer.alloc(9);h[6]=request.targetAddress===0xdf?0x12:request.targetAddress;
 const uds=calls===4?Buffer.from([0x7f,0x22,0x31]):Buffer.concat([Buffer.from([0x62,0xf1,0x90]),Buffer.from('WBA12345678901234')]);
 const data=Buffer.concat([h,uds]);
 setImmediate(()=>Promise.resolve(provider.fire('sendTasuResponse',{udsResponse:Buffer.concat([data,Buffer.alloc(64)]),udsResponseLength:data.length,errorCode:'NO_ERROR'},[clientId])).then(()=>console.error('FAKE_PROVIDER_SENT'),e=>console.error('FAKE_PROVIDER_FIRE_FAILED '+e)));
 return Promise.resolve({TasuErrorEnum:'NO_ERROR'});
}}).then(p=>{provider=p;return p.init();}).then(()=>console.log('NATIVE_PROVIDER_READY')).catch(e=>console.log('NATIVE_PROVIDER_FAILED '+e)));
process.stdin.resume();`
	provider := exec.CommandContext(ctx, "/usr/bin/node", "-e", js, cfgPath)
	provider.Dir = "/tmp"
	provider.Env = []string{"HOME=/tmp", "PATH=/usr/bin:/bin"}
	provider.Stderr = os.Stderr
	if e = workerCredentials(provider, 11002, 12202); e != nil {
		t.Fatal(e)
	}
	input, _ := provider.StdinPipe()
	defer input.Close()
	output, e := provider.StdoutPipe()
	if e != nil {
		t.Fatal(e)
	}
	if e = provider.Start(); e != nil {
		t.Fatal(e)
	}
	defer func() { provider.Process.Kill(); provider.Wait() }()
	ready := make(chan bool, 1)
	go func() {
		scan := bufio.NewScanner(output)
		signaled := false
		for scan.Scan() {
			if scan.Text() == "NATIVE_PROVIDER_READY" {
				if !signaled {
					ready <- true
					signaled = true
				}
				// Keep draining native logs after readiness; otherwise the
				// fixture can block its provider on a full stdout pipe.
				continue
			}
			if scan.Text() == "NATIVE_PROVIDER_FAILED" {
				ready <- false
				return
			}
		}
		if !signaled {
			ready <- false
		}
	}()
	select {
	case ok := <-ready:
		if !ok {
			t.Fatal("native provider initialization failed")
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	c := defaults()
	c.OAPDirectory = root
	c.ControlSocket = filepath.Join(app, "run/control.sock")
	s := newService(c)
	if e = s.startControl(ctx); e != nil {
		t.Fatal(e)
	}
	s.tasuContext = ctx
	v, e := s.ensureTASU(ctx)
	if e != nil {
		t.Fatal("complete embedded worker did not discover native provider", e)
	}
	defer s.closeTASU()
	if v == nil || s.snapshot().TASU != "ready" {
		t.Fatal(s.snapshot())
	}
	if _, e = os.Stat(filepath.Join(app, "run/tasu-owner.json")); !os.IsNotExist(e) {
		t.Fatal("native warmup took diagnostic ownership", e)
	}
	// Model the app's separate GUI/SDK process: same OAP credentials, its
	// own native application, and no TASU response subscription.
	peerJS := `const fs=require('fs'),s=require('/usr/lib/someip.node'),cfg=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));setImmediate(()=>s.buildProxy(cfg,'SystemFunctionsInternalTasuInst1').then(p=>p.init().then(()=>p)).then(p=>p.subscribeToAvailability(a=>{if(a)console.log('PEER_READY');})).catch(()=>console.log('PEER_FAILED')));process.stdin.resume();`
	peer := exec.CommandContext(ctx, "/usr/bin/node", "-e", peerJS, cfgPath)
	peer.Dir = filepath.Join(app, "source")
	peer.Env = []string{"HOME=" + filepath.Join(app, "data"), "PATH=/usr/bin:/bin"}
	peer.Stderr = os.Stderr
	if e = workerCredentials(peer, 12451, 12202, root, app); e != nil {
		t.Fatal(e)
	}
	peerInput, _ := peer.StdinPipe()
	defer peerInput.Close()
	peerOutput, e := peer.StdoutPipe()
	if e != nil {
		t.Fatal(e)
	}
	if e = peer.Start(); e != nil {
		t.Fatal(e)
	}
	defer func() { peer.Process.Kill(); peer.Wait() }()
	peerReady := make(chan bool, 1)
	go func() {
		scan := bufio.NewScanner(peerOutput)
		sent := false
		for scan.Scan() {
			if scan.Text() == "PEER_READY" && !sent {
				peerReady <- true
				sent = true
			}
			if scan.Text() == "PEER_FAILED" && !sent {
				peerReady <- false
				sent = true
			}
		}
		if !sent {
			peerReady <- false
		}
	}()
	select {
	case ok := <-peerReady:
		if !ok {
			t.Fatal("native peer init failed")
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if e = v.WriteFrame(frame(1, []byte{0xf4, 0x12, 0x22, 0xf1, 0x90})); e != nil {
		t.Fatal(e)
	}
	ack, e := v.ReadFrame()
	if e != nil || !bytes.Equal(ack, frame(2, []byte{0xf4, 0x12, 0x22, 0xf1, 0x90})) {
		t.Fatalf("native ACK %x: %v", ack, e)
	}
	reply, e := v.ReadFrame()
	if e != nil || len(reply) < 28 || string(reply[11:]) != "WBA12345678901234" {
		t.Fatalf("native VIN reply %x: %v", reply, e)
	}
	trace := s.snapshot().TASUTrace
	if trace.Requests != 1 || trace.Events != 1 || trace.Matched != 1 || trace.Verdict != "NO_ERROR" {
		t.Fatal("native trace missing", trace)
	}
	s.hotspotMAC = func() (net.HardwareAddr, error) { return net.HardwareAddr{2, 0, 0, 0, 0, 1}, nil }
	g, e := s.discoverTASU(ctx)
	if e != nil {
		t.Fatal("full native VIN discovery", e)
	}
	if vin, ok := identification(g.Identification); !ok || vin != "WBA12345678901234" || len(g.Identification) != 56 || g.Backend != "tasu" {
		t.Fatal("full native discovery identity invalid")
	}
	trace = s.snapshot().TASUTrace
	if trace.Requests != 3 || trace.Target != "0x12" || trace.Matched != 1 {
		t.Fatal("native functional silence did not reach physical fallback", trace)
	}
	// An explicit negative response is a completed request: the alternate
	// target must work without requiring a new helper or a reconnect.
	g, e = s.discoverTASU(ctx)
	if e != nil {
		t.Fatal("native negative-response fallback", e)
	}
	if vin, ok := identification(g.Identification); !ok || vin != "WBA12345678901234" {
		t.Fatal("negative-response fallback identity invalid")
	}
	trace = s.snapshot().TASUTrace
	if trace.Requests != 5 || trace.Target != "0x12" || trace.Matched != 1 {
		t.Fatal("native functional refusal did not reach physical fallback", trace)
	}
	// A functional VIN read must preserve the actual physical responder and
	// consume its private completion event before reusing the connection.
	g, e = s.discoverTASU(ctx)
	if e != nil {
		t.Fatal("native functional VIN collection", e)
	}
	if vin, ok := identification(g.Identification); !ok || vin != "WBA12345678901234" {
		t.Fatal("native functional identity invalid")
	}
	trace = s.snapshot().TASUTrace
	if trace.Requests != 6 || trace.Target != "0xDF" || trace.Matched != 1 {
		t.Fatal("native functional read did not complete", trace)
	}
	t.Log("NATIVE_TASU_ROUNDTRIP_PASS: real binding/router and synthetic ECU")
}
