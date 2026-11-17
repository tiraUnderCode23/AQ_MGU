//go:build linux

package main

import (
	"bytes"
	"context"
	"net"
	"os"
	"strings"
	"testing"
	"time"
)

// Opt-in only in our disposable captured-HU guest, never an ordinary host
// test or a car. This table is created only when no stock table exists.
func TestEmulatorNFTPacketPath(t *testing.T) {
	if os.Getenv("MGU_OBD_EMULATOR_NFT_TEST") != "1" {
		t.Skip("requires the isolated head-unit emulator")
	}
	if os.Geteuid() != 0 {
		t.Fatal("emulator test requires root")
	}
	listed, e := runNFT("list", "tables")
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(listed, "table ip filter") {
		t.Skip("existing stock table is never changed by this fixture")
	}
	call := func(args ...string) {
		t.Helper()
		if _, e := runNFT(args...); e != nil {
			t.Fatal(args, e)
		}
	}
	if _, e := runNFT("add", "table", "ip", "filter"); e != nil {
		if strings.Contains(e.Error(), "Operation not supported") {
			t.Skip("captured emulator kernel lacks nf_tables; real packet-path validation remains open")
		}
		t.Fatal(e)
	}
	defer runNFT("delete", "table", "ip", "filter")
	call("add", "chain", "ip", "filter", "input", "{ type filter hook input priority 0; policy accept; }")
	call("add", "chain", "ip", "filter", "output", "{ type filter hook output priority 0; policy accept; }")
	call("add", "rule", "ip", "filter", "input", "tcp", "dport", "8470", "accept", "comment", quoted("unrelated-fixture-rule"))
	// Only the synthetic adapter ports are denied. Other guest traffic and
	// global policies remain intact while the test proves rule precedence.
	call("add", "rule", "ip", "filter", "input", "iifname", quoted("lo"), "udp", "dport", "40682", "drop")
	call("add", "rule", "ip", "filter", "input", "iifname", quoted("lo"), "tcp", "dport", "40681", "drop")
	call("add", "rule", "ip", "filter", "output", "oifname", quoted("lo"), "udp", "sport", "40682", "drop")

	c := defaults()
	c.TCPPort = 40681
	c.DiscoveryPort = 40682
	c.GatewayPort = 40683
	s := newService(c)
	ip, network, _ := net.ParseCIDR("127.0.0.1/8")
	h := link{Name: "lo", IP: ip, Network: network}
	g := gateway{Address: "127.0.0.2", Local: "127.0.0.1", Device: "lo", Identification: testIdentification()}
	s.resolve = func(context.Context) (gateway, error) { return g, nil }
	gw, e := net.Listen("tcp4", "127.0.0.2:40683")
	if e != nil {
		t.Fatal(e)
	}
	defer gw.Close()
	request := frame(1, []byte{0xf4, 0x12, 0x22, 0xf1, 0x90})
	response := frame(1, []byte{0x12, 0xf4, 0x62, 0xf1, 0x90, 'A'})
	peerDone := make(chan error, 1)
	go func() {
		p, e := gw.Accept()
		if e != nil {
			peerDone <- e
			return
		}
		defer p.Close()
		p.SetDeadline(time.Now().Add(5 * time.Second))
		got, e := readFrame(p)
		if e == nil && !bytes.Equal(got, request) {
			e = net.InvalidAddrError("request changed")
		}
		if e == nil {
			e = writeAll(p, response)
		}
		peerDone <- e
	}()
	ctx, cancel := context.WithCancel(context.Background())
	defer func() { cancel(); s.stopListeners(); s.firewall.close() }()
	if e = s.startListeners(ctx, h); e != nil {
		t.Fatal("hotspot listeners", e)
	}
	u, e := net.Dial("udp4", "127.0.0.1:40682")
	if e != nil {
		t.Fatal(e)
	}
	defer u.Close()
	u.SetDeadline(time.Now().Add(5 * time.Second))
	u.Write(discoveryProbe)
	b := make([]byte, 4096)
	n, e := u.Read(b)
	if e != nil || !bytes.Equal(b[:n], g.Identification) {
		t.Fatal("discovery did not pass the scoped firewall rules", e)
	}
	client, e := net.DialTimeout("tcp4", "127.0.0.1:40681", 5*time.Second)
	if e != nil {
		t.Fatal(e)
	}
	defer client.Close()
	client.SetDeadline(time.Now().Add(5 * time.Second))
	if e = writeAll(client, request); e != nil {
		t.Fatal(e)
	}
	got, e := readFrame(client)
	if e != nil || !bytes.Equal(got, response) {
		t.Fatal("diagnostic forwarding failed", e)
	}
	if e = <-peerDone; e != nil {
		t.Fatal(e)
	}
	client.Close()
	cancel()
	s.stopListeners()
	if e = s.firewall.close(); e != nil {
		t.Fatal(e)
	}
	input, e := runNFT("-a", "list", "chain", "ip", "filter", "input")
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(input, firewallTag) || !strings.Contains(input, "unrelated-fixture-rule") {
		t.Fatal("cleanup affected unrelated rules or leaked adapter rules", input)
	}
}
