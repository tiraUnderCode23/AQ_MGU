package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The measured bootmod3 setup/read path, live backend replies and the
// virtual-gateway VIN share one session. Only the exact observed gateway setup
// is forwarded; its ECU response is preserved.
func TestBootmod3SetupAndVirtualGatewayVIN(t *testing.T) {
	s := newService(defaults())
	client, server := net.Pipe()
	peer, upstream := net.Pipe()
	defer peer.Close()
	defer client.Close()
	identity, _ := tasuIdentification("WBA12345678901234", 0x10, net.HardwareAddr{2, 0, 0, 0, 0, 1})
	vin := tasuGatewayVIN(gateway{Backend: "tasu", Identification: identity})
	if tasuGatewayVIN(gateway{Identification: identity}) != "" {
		t.Fatal("VIN synthesized without TASU")
	}
	done := make(chan error, 1)
	go func() { done <- s.relay(context.Background(), server, gatewaySession{upstream}, vin) }()
	client.SetDeadline(time.Now().Add(3 * time.Second))
	requestBodies := [][]byte{
		{0xf4, 0x40, 0x31, 1, 0x10, 1, 0x0a, 0x0a, 0x43},
		{0xf4, 0x12, 0x2c, 3, 0xf3, 1},
		{0xf4, 0x12, 0x2c, 2, 0xf3, 1, 0x24, 0x80, 0x7f, 0xfe, 0x50, 0, 0xff},
		{0xf4, 0x12, 0x22, 0xf3, 1},
		{0xf4, 0x12, 0x22, 0x40, 0x98},
		{0xf4, 0x12, 0x22, 0xf1, 0x8b},
		{0xf4, 0x12, 0x22, 0xf1, 1},
		{0xf4, 0x12, 0x22, 0xf1, 3},
		{0xf4, 0x18, 0x22, 0xf1, 1},
		{0xf4, 0x12, 0x31, 1, 2, 5, 6, 0, 0, 0x42, 0x95, 1, 45, 1},
		{0xf4, 0x12, 0x31, 1, 2, 5, 8, 0, 0, 0x63, 0x75, 0x32, 0xdc, 1},
		{0xf4, 0x12, 0x22, 0xf1, 0x86},
	}
	backend := make(chan error, 1)
	go func() {
		for _, r := range requestBodies {
			got, e := readFrame(peer)
			if e != nil {
				backend <- e
				return
			}
			if !bytes.Equal(got, frame(1, r)) {
				backend <- context.Canceled
				return
			}
			var u []byte
			switch r[2] {
			case 0x2c:
				u = append([]byte{0x6c}, r[3:6]...)
			case 0x22:
				u = append([]byte{0x62}, append(r[3:5:5], 0xa5)...)
			case 0x31:
				if r[1] == 0x40 {
					u = []byte{0x7f, 0x31, 0x31}
				} else {
					u = []byte{0x71, 1, 2, 5, 0x44}
				}
			}
			if e = writeAll(peer, frame(2, r)); e != nil {
				backend <- e
				return
			}
			if e = writeAll(peer, frame(1, append([]byte{0x12, 0xf4}, u...))); e != nil {
				backend <- e
				return
			}
		}
		backend <- nil
	}()
	for _, r := range requestBodies {
		if _, e := client.Write(frame(1, r)); e != nil {
			t.Fatal(e)
		}
		for i := 0; i < 2; i++ {
			if _, e := readFrame(client); e != nil {
				t.Fatal(e)
			}
		}
	}
	if e := <-backend; e != nil {
		t.Fatal("read changed or a blocked operation reached backend", e)
	}
	if st := s.snapshot(); st.DeniedRequests != 0 || st.DME.Identification != "positive_reply" || st.DME.SWEMetadata != "positive_reply" || st.DME.ROMMemory != "positive_reply" || st.DME.ManufactureDate != "positive_reply" {
		t.Fatal(st)
	}
	client.Write(frame(1, []byte{0xf5, 0x10, 0x22, 0xf1, 0x90}))
	if _, e := readFrame(client); e != nil {
		t.Fatal(e)
	}
	reply, e := readFrame(client)
	if e != nil || !bytes.Equal(reply, frame(1, append([]byte{0x10, 0xf5, 0x62, 0xf1, 0x90}, []byte(vin)...))) {
		t.Fatal(reply, e)
	}
	client.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("relay leaked")
	}
}

// Opt-in fixture for the owner's unchanged native bootmod3 agent, isolated
// onto loopback by the private research harness. No vendor files are bundled.
func TestInstalledBootmod3AgentFixture(t *testing.T) {
	dir := os.Getenv("MGU_BOOTMOD3_FIXTURE")
	if dir == "" {
		t.Skip("private native-agent replay only")
	}
	var fixture struct {
		VIN     string
		Replies map[string]string
	}
	if file := os.Getenv("MGU_BOOTMOD3_REPLIES"); file != "" {
		b, e := os.ReadFile(file)
		if e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(b, &fixture); e != nil {
			t.Fatal(e)
		}
	}
	for _, name := range []string{"metadata-success", "customrom-success"} {
		if e := os.Remove(filepath.Join(dir, name)); e != nil && !os.IsNotExist(e) {
			t.Fatal(e)
		}
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
	s := newService(defaults())
	vin := fixture.VIN
	if vin == "" {
		vin = "WBA12345678901234"
	}
	identity, _ := tasuIdentification(vin, 0x10, net.HardwareAddr{2, 0, 0, 0, 0, 1})
	s.resolve = func(context.Context) (gateway, error) {
		return gateway{Backend: "tasu", Address: "tasu", Identification: identity}, nil
	}
	s.open = func(context.Context, gateway) (vehicle, error) {
		if worker := os.Getenv("MGU_BOOTMOD3_TASU_WORKER"); worker != "" {
			v, e := startNativeFixtureWorker(os.Getenv("MGU_BOOTMOD3_REPLIES"), worker)
			if e == nil {
				t.Cleanup(func() { v.Close() })
			}
			return v, e
		}
		client, server := net.Pipe()
		go func() {
			defer server.Close()
			for {
				b, e := readFrame(server)
				if e != nil {
					return
				}
				if b[7] == 0x10 {
					t.Errorf("virtual VIN reached backend: %x", b)
					return
				}
				if writeAll(server, frame(2, b[6:])) != nil {
					return
				}
				u := []byte{0x7f, b[8], 0x31}
				switch b[8] {
				case 0x2c:
					u = append([]byte{0x6c}, b[9:12]...)
				case 0x22:
					if bytes.Equal(b[9:], []byte{0xf1, 1}) {
						// Fresh fixture software version 099 differs from the owner's screen.
						u, _ = hex.DecodeString("62f101010100042401010600004295012d010800005d5532dc63080000637532dc01050000274200ab23")
					}
					if bytes.Equal(b[9:], []byte{0xf3, 1}) {
						u = append([]byte{0x62, 0xf3, 1}, make([]byte, 255)...)
					}
				}
				if text, ok := fixture.Replies[hex.EncodeToString(b[7:])]; ok {
					u, e = hex.DecodeString(text)
					if e != nil {
						t.Error(e)
						return
					}
				}
				if writeAll(server, frame(1, append([]byte{b[7], b[6]}, u...))) != nil {
					return
				}

			}
		}()
		return gatewaySession{client}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	go s.serveDiscovery(ctx, udp, network)
	go s.serveTCP(ctx, tcp, network)
	if e := os.WriteFile(filepath.Join(dir, "bridge-ready"), []byte("ready"), 0600); e != nil {
		t.Fatal(e)
	}
	marker := "metadata-success"
	if fixture.VIN != "" {
		marker = "customrom-success"
	}
	for {
		select {
		case <-ctx.Done():
			t.Fatal("native agent did not publish expected live-read status", s.snapshot())
		case <-time.After(100 * time.Millisecond):
			if b, e := json.Marshal(s.snapshot()); e == nil {
				os.WriteFile(filepath.Join(dir, "bridge-status.json"), b, 0600)
			}
			if _, e := os.Stat(filepath.Join(dir, marker)); e == nil {
				st := s.snapshot()
				if st.DiscoveryReplies == 0 || st.Requests == 0 || st.DeniedRequests != 0 || st.DME.Identification != "positive_reply" || st.DME.ROMMemory != "positive_reply" {
					t.Fatal(st)
				}
				if fixture.VIN != "" && st.DME.ManufactureDate != "positive_reply" {
					t.Fatal("date not read from backend", st)
				}
				t.Logf("native broker published expected fixture identification; discovery=%d requests=%d", st.DiscoveryReplies, st.Requests)
				return
			}
		}
	}
}
