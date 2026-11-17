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

// Exercises the embedded worker, UID drop, protocol and lease lifecycle on the
// captured Node 8 runtime. Only the vehicle provider is synthetic.
func TestEmulatorNode8TASUWorker(t *testing.T) {
	if os.Getenv("MGU_OBD_EMULATOR_TASU_TEST") != "1" {
		t.Skip("requires isolated captured-HU guest")
	}
	if os.Geteuid() != 0 {
		t.Fatal("UID-drop fixture requires root")
	}
	root, e := os.MkdirTemp("/tmp", "hu-obd-worker-")
	if e != nil {
		t.Fatal(e)
	}
	defer os.RemoveAll(root)
	// Match captured /var/opt/public/oap: 0770, owner 8000, mgu_persist
	// group 903. A helper with only tm_oap_app cannot traverse this parent.
	if e = os.Chown(root, 8000, 903); e != nil {
		t.Fatal(e)
	}
	if e = os.Chmod(root, 0770); e != nil {
		t.Fatal(e)
	}
	app := filepath.Join(root, "oap_12252")
	for _, dir := range []string{"source/node_modules/someip", "someipInterfaces", "run"} {
		if e = os.MkdirAll(filepath.Join(app, dir), 0755); e != nil {
			t.Fatal(e)
		}
	}
	// Match installer ownership as well as the protected parent. systemd's
	// production umask 0027 must not leave fixture modules root-only.
	if e = filepath.Walk(app, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		return os.Chown(p, 12252, 12252)
	}); e != nil {
		t.Fatal(e)
	}
	write := func(name, body string) {
		t.Helper()
		if e := os.WriteFile(filepath.Join(app, name), []byte(body), 0644); e != nil {
			t.Fatal(e)
		}
		if e := os.Chown(filepath.Join(app, name), 12252, 12252); e != nil {
			t.Fatal(e)
		}
	}
	write("source/package.json", `{"name":"noahg_obdbridge"}`)
	write("someipInterfaces/com_harman_infotainment_systemfunctions_tasu_tasu_InternalTasu.json", `{}`)
	write("source/node_modules/someip/index.js", `'use strict';
if(process.getuid()!==12252 || process.getgid()!==12252 || process.getgroups().indexOf(12202)<0 || process.getgroups().indexOf(903)<0)throw Error('incorrect helper credentials');
exports.buildProxy=function(){var onReply,firstVIN=true;return Promise.resolve({
 init:function(){return Promise.resolve();},subscribe:function(o){onReply=o.onReceive;return Promise.resolve();},
 subscribeToAvailability:function(fn){fn(true);return Promise.resolve();},shutdown:function(){return Promise.resolve();},
 callMethod:function(name,p){
  var data=Array.prototype.slice.call(p.udsData),uds;
  if(p.sourceAddress!==0xf2)throw Error('wrong tester');
  if(p.targetAddress===0xdf){uds=Buffer.from([0x7f,0x22,0x31]);}
  else if(p.serviceID===0x22&&data[0]===0xf1&&data[1]===0x90&&p.targetAddress===0x12&&firstVIN){firstVIN=false;uds=Buffer.from([0x7f,0x22,0x31]);}
  else if(p.serviceID===0x22&&data[0]===0xf1&&data[1]===0x90)uds=Buffer.concat([Buffer.from([0x62,0xf1,0x90]),Buffer.from('WBA12345678901234')]);
  else if(p.serviceID===0x2c)uds=Buffer.from([0x6c].concat(data.slice(0,3)));
  else if(p.serviceID===0x31)uds=Buffer.from([0x71,1,2,5,0x44]);
  else if(p.serviceID===0x10)uds=Buffer.from([0x50,data[0],0,50,1,244]);
  else if(p.serviceID===0x3e&&data[0]===0x80)return Promise.resolve('NO_ERROR');
  else throw Error('unexpected diagnostic write');
  var h=Buffer.alloc(9);h[6]=p.targetAddress===0xdf?0x12:p.targetAddress;onReply({errorCode:0,udsResponse:Buffer.concat([h,uds])});
  return Promise.resolve('NO_ERROR');
 }});};`)
	c := defaults()
	c.OAPDirectory = root
	c.ControlSocket = filepath.Join(app, "run/control.sock")
	s := newService(c)
	s.hotspotMAC = func() (net.HardwareAddr, error) { return net.HardwareAddr{2, 0, 0, 0, 0, 1}, nil }
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if e = s.startControl(ctx); e != nil {
		t.Fatal(e)
	}
	s.tasuContext = ctx
	v, e := s.ensureTASU(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer s.closeTASU()
	lease := filepath.Join(app, "run/tasu-owner.json")
	if _, e = os.Stat(lease); !os.IsNotExist(e) {
		t.Fatal("idle helper owns diagnostics", e)
	}
	probe, cancelProbe := context.WithCancel(ctx)
	g, e := s.discoverTASU(probe)
	cancelProbe()
	if e != nil {
		t.Fatal(e)
	}
	if vin, ok := identification(g.Identification); !ok || vin != "WBA12345678901234" {
		t.Fatal("VIN discovery", vin, ok)
	}
	if reusable, e := s.ensureTASU(ctx); e != nil || reusable != v {
		t.Fatal("successful discovery discarded warmed worker", e)
	}
	vinDeadline := time.Now().Add(time.Second)
	for {
		_, e = os.Stat(lease)
		if os.IsNotExist(e) {
			break
		}
		if time.Now().After(vinDeadline) {
			t.Fatal("VIN probe leaked diagnostic ownership", e)
		}
		time.Sleep(time.Millisecond)
	}
	requests := [][]byte{frame(1, []byte{0xf4, 0x12, 0x10, 3}), frame(1, []byte{0xf4, 0x12, 0x3e, 0x80}), frame(1, []byte{0xf4, 0x12, 0x22, 0xf1, 0x90}), frame(1, []byte{0xf4, 0x12, 0x2c, 3, 0xf3, 1}), frame(1, []byte{0xf4, 0x12, 0x31, 1, 2, 5, 6, 0, 0, 0x42, 0x95, 1, 45, 1})}
	for _, b := range requests {
		if e = v.WriteFrame(b); e != nil {
			t.Fatal(e)
		}
	}
	for _, want := range [][]byte{frame(2, requests[0][6:]), frame(1, []byte{0x12, 0xf4, 0x50, 3, 0, 50, 1, 244}), frame(2, requests[1][6:]), frame(2, requests[2][6:]), frame(1, append([]byte{0x12, 0xf4, 0x62, 0xf1, 0x90}, []byte("WBA12345678901234")...)), frame(2, requests[3][6:]), frame(1, []byte{0x12, 0xf4, 0x6c, 3, 0xf3, 1}), frame(2, requests[4][6:]), frame(1, []byte{0x12, 0xf4, 0x71, 1, 2, 5, 0x44})} {
		got, e := v.ReadFrame()
		if e != nil || !bytes.Equal(got, want) {
			t.Fatalf("worker response %x expected %x: %v", got, want, e)
		}
	}
	// Worker completion and broker EOF run on separate processes. The lease
	// must disappear without disconnecting the still-live client session.
	deadline := time.Now().Add(time.Second)
	for {
		_, e = os.Stat(lease)
		if os.IsNotExist(e) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("completed request retained ownership", e)
		}
		time.Sleep(time.Millisecond)
	}
	v.Close()
	if _, e = os.Stat(lease); !os.IsNotExist(e) {
		t.Fatal("client disconnect leaked lease", e)
	}
	// A native binding may fail immediately. Preserve its fixed startup code
	// instead of letting process exit race the stdout scanner and hide it.
	for i := 0; i < 3; i++ {
		write("source/node_modules/someip/index.js", `exports.buildProxy=function(){throw Error('private startup details');};`)
		if _, e = s.ensureTASU(ctx); tasuErrorCode(e) != "proxy_init_failed" {
			t.Fatalf("startup code lost: %v", e)
		}
		if st := s.snapshot(); st.TASUError != "proxy_init_failed" {
			t.Fatal(st)
		}
	}
}

func TestEmulatorNode8NativeSOMEIPLoader(t *testing.T) {
	if os.Getenv("MGU_OBD_EMULATOR_TASU_TEST") != "1" {
		t.Skip("requires captured HU native binding")
	}
	root, e := os.MkdirTemp("/tmp", "hu-obd-native-")
	if e != nil {
		t.Fatal(e)
	}
	defer os.RemoveAll(root)
	os.Chmod(root, 0755)
	worker := filepath.Join(root, "worker.js")
	if e = os.WriteFile(worker, []byte(tasuWorker), 0644); e != nil {
		t.Fatal(e)
	}
	if e = os.Chown(worker, 12252, 12252); e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	// No app-local stub and no launcher NODE_PATH: use the installed binary
	// under the same credentials as the production helper.
	cmd := exec.CommandContext(ctx, "/usr/bin/node", "-e", `const w=require(process.argv[1]);const s=w.loadSomeip(process.argv[2]);if(typeof s.buildProxy!=='function')process.exit(1);console.log('HU_NATIVE_SOMEIP_LOADED');process.stdin.resume();`, worker, root)
	cmd.Dir = root
	cmd.Env = []string{"HOME=" + root, "PATH=/usr/bin:/bin"}
	if e = workerCredentials(cmd, 12252, 12202); e != nil {
		t.Fatal(e)
	}
	input, e := cmd.StdinPipe()
	if e != nil {
		t.Fatal(e)
	}
	defer input.Close()
	output, e := cmd.StdoutPipe()
	if e != nil {
		t.Fatal(e)
	}
	if e = cmd.Start(); e != nil {
		t.Fatal(e)
	}
	// The production service terminates its dedicated helper process on
	// shutdown; native binding unload is not a prerequisite for module loading.
	defer func() { cmd.Process.Kill(); cmd.Wait() }()
	loaded := make(chan bool, 1)
	go func() {
		scan := bufio.NewScanner(output)
		for scan.Scan() {
			if scan.Text() == "HU_NATIVE_SOMEIP_LOADED" {
				loaded <- true
				return
			}
		}
		loaded <- false
	}()
	select {
	case ok := <-loaded:
		if !ok {
			t.Fatal("native binding failed before readiness")
		}
	case <-ctx.Done():
		t.Fatal("native binding did not load under app credentials")
	}
}
