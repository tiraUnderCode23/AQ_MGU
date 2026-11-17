//go:build linux

package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLinuxSocketConfinement(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("SO_BINDTODEVICE test needs root/CAP_NET_RAW")
	}
	pc, e := listenPacket(context.Background(), "lo", "0.0.0.0:0")
	if e != nil {
		t.Fatal(e)
	}
	defer pc.Close()
	c, e := net.Dial("udp4", net.JoinHostPort("127.0.0.1", itoa(pc.LocalAddr().(*net.UDPAddr).Port)))
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	c.Write(discoveryProbe)
	pc.SetReadDeadline(time.Now().Add(time.Second))
	b := make([]byte, 64)
	if n, _, e := pc.ReadFrom(b); e != nil || n != 6 {
		t.Fatal("bound interface not receiving", e)
	}
	if other, e := listenPacket(context.Background(), "no-such-device", "0.0.0.0:0"); e == nil {
		other.Close()
		t.Fatal("invalid interface fell back to wildcard")
	}
}

func TestLinuxHotspotModeRejectsLoopback(t *testing.T) {
	if ok, _ := isHotspotAP("lo"); ok {
		t.Fatal("loopback advertised as car hotspot")
	}
	if _, e := attributes([]byte{1, 0, 2, 0}); e == nil {
		t.Fatal("short attribute accepted")
	}
	a, e := attributes(attribute(5, []byte{3, 0, 0, 0}))
	if e != nil || len(a[5]) != 4 || a[5][0] != 3 {
		t.Fatal("netlink attributes", e)
	}
}

func TestDedicatedCarBridgeDoesNotRequireWirelessType(t *testing.T) {
	root := t.TempDir()
	if isCarHotspotBridge(root, "wlan_bridge") {
		t.Fatal("missing bridge accepted")
	}
	if e := os.MkdirAll(filepath.Join(root, "wlan_bridge", "bridge"), 0700); e != nil {
		t.Fatal(e)
	}
	if !isCarHotspotBridge(root, "wlan_bridge") {
		t.Fatal("car hotspot bridge rejected for lacking a radio mode")
	}
	os.MkdirAll(filepath.Join(root, "wlan0", "bridge"), 0700)
	if isCarHotspotBridge(root, "wlan0") {
		t.Fatal("station interface trusted as car hotspot bridge")
	}
}
