package main

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// This opt-in check loads the owner's installed Java transport without copying
// vendor code into the repository or accessing an account or physical vehicle.
func TestInstalledBimmerCodeENETTransport(t *testing.T) {
	app := os.Getenv("MGU_BIMMERCODE_APP")
	if app == "" {
		t.Skip("set MGU_BIMMERCODE_APP for the installed-client transport check")
	}
	java := os.Getenv("MGU_JAVA")
	harness := os.Getenv("MGU_BIMMERCODE_HARNESS")
	if java == "" || harness == "" {
		t.Fatal("Java and compiled loopback harness required")
	}
	udp, e := net.ListenPacket("udp4", "127.0.0.1:6811")
	if e != nil {
		t.Fatal(e)
	}
	defer udp.Close()
	tcp, e := net.Listen("tcp4", "127.0.0.1:6801")
	if e != nil {
		t.Fatal(e)
	}
	defer tcp.Close()
	_, network, _ := net.ParseCIDR("127.0.0.0/8")
	c := defaults()
	c.TASUFallback = false
	s := newService(c)
	s.resolve = func(context.Context) (gateway, error) {
		return gateway{Address: "127.0.0.2", Identification: testIdentification()}, nil
	}
	s.open = func(context.Context, gateway) (vehicle, error) {
		client, server := net.Pipe()
		go func() {
			defer server.Close()
			for {
				b, e := readFrame(server)
				if e != nil {
					return
				}
				if e = writeAll(server, frame(2, b[6:])); e != nil {
					return
				}
				var uds []byte
				switch b[8] {
				case 0x10:
					uds = []byte{0x50, 3, 0, 50, 1, 244}
				case 0x3e:
					uds = []byte{0x7e, 0}
				case 0x22:
					uds = append([]byte{0x62, 0xf1, 0x90}, []byte("WBA12345678901234")...)
				default:
					return
				}
				if writeAll(server, frame(1, append([]byte{b[7], b[6]}, uds...))) != nil {
					return
				}
			}
		}()
		return gatewaySession{client}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	go s.serveDiscovery(ctx, udp, network)
	go s.serveTCP(ctx, tcp, network)
	cp := harness + string(os.PathListSeparator) + filepath.Join(app, "*")
	if extra := os.Getenv("MGU_JAVA_EXTRA_CLASSPATH"); extra != "" {
		cp += string(os.PathListSeparator) + extra
	}
	cmd := exec.CommandContext(ctx, java, "-cp", cp, "BimmerCodeConnection", "127.0.0.1")
	out, e := cmd.CombinedOutput()
	if e != nil {
		t.Fatalf("installed client: %v\n%s", e, out)
	}
	t.Log(string(out))
	if st := s.snapshot(); st.DiscoveryReplies != 1 || st.Requests != 3 {
		t.Fatal(st)
	}
}
