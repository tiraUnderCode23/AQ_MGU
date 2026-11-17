package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"sync/atomic"
	"testing"
	"time"
)

func TestRelayPreservesAcknowledgementsPendingAndReplies(t *testing.T) {
	s := newService(defaults())
	client, server := net.Pipe()
	peer, upstream := net.Pipe()
	defer client.Close()
	defer peer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.relay(ctx, server, gatewaySession{upstream}) }()
	req := frame(1, []byte{0xf4, 0x12, 0x22, 0xf1, 0x90})
	want := [][]byte{frame(2, req[6:]), frame(1, []byte{0x12, 0xf4, 0x7f, 0x22, 0x78}), frame(1, []byte{0x12, 0xf4, 0x62, 0xf1, 0x90, 'A'})}
	emulated := make(chan error, 1)
	go func() {
		got, e := readFrame(peer)
		if e != nil {
			emulated <- e
			return
		}
		if !bytes.Equal(got, req) {
			emulated <- errors.New("request modified")
			return
		}
		for _, b := range want {
			if e = writeAll(peer, b); e != nil {
				emulated <- e
				return
			}
		}
		emulated <- nil
	}()
	client.SetDeadline(time.Now().Add(3 * time.Second))
	for _, b := range req {
		if _, e := client.Write([]byte{b}); e != nil {
			t.Fatal(e)
		}
	}
	for _, b := range want {
		got, e := readFrame(client)
		if e != nil || !bytes.Equal(got, b) {
			t.Fatalf("response changed: %x %v", got, e)
		}
	}
	if e := <-emulated; e != nil {
		t.Fatal(e)
	}
	client.Close()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("session pumps leaked")
	}
	if st := s.snapshot(); st.Requests != 1 || st.Responses != 2 {
		t.Fatal(st)
	}
}

func TestUnvalidatedWriteRefusesWithoutClosingConnection(t *testing.T) {
	s := newService(defaults())
	client, server := net.Pipe()
	peer, upstream := net.Pipe()
	defer client.Close()
	defer peer.Close()
	done := make(chan error, 1)
	go func() { done <- s.relay(context.Background(), server, gatewaySession{upstream}) }()
	client.SetDeadline(time.Now().Add(3 * time.Second))
	denied := frame(1, []byte{0xf4, 0x12, 0x34, 0})
	client.Write(denied)
	for _, want := range [][]byte{frame(2, denied[6:]), frame(1, []byte{0x12, 0xf4, 0x7f, 0x34, 0x11})} {
		got, e := readFrame(client)
		if e != nil || !bytes.Equal(got, want) {
			t.Fatal("negative reply", got, e)
		}
	}
	read := frame(1, []byte{0xf4, 0x12, 0x22, 0xf1, 0x90})
	go client.Write(read)
	peer.SetReadDeadline(time.Now().Add(time.Second))
	got, e := readFrame(peer)
	if e != nil || !bytes.Equal(got, read) {
		t.Fatal("write reached vehicle or session lost", got, e)
	}
	client.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("session pumps leaked")
	}
}

func TestClientLossDoesNotReconnectOrRetry(t *testing.T) {
	s := newService(defaults())
	client, server := net.Pipe()
	peer, upstream := net.Pipe()
	defer client.Close()
	defer peer.Close()
	done := make(chan error, 1)
	go func() { done <- s.relay(context.Background(), server, gatewaySession{upstream}) }()
	go client.Write(frame(1, []byte{0xf4, 0x12, 0x22, 0xf1, 0x90}))
	if _, e := readFrame(peer); e != nil {
		t.Fatal(e)
	}
	peer.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("disconnect not propagated")
	}
	if _, e := client.Read(make([]byte, 1)); e != io.EOF {
		t.Fatal(e)
	}
}

func TestSingleClientOwnership(t *testing.T) {
	s := newService(defaults())
	ln, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer ln.Close()
	_, network, _ := net.ParseCIDR("127.0.0.0/8")
	s.resolve = func(context.Context) (gateway, error) { return gateway{Address: "127.0.0.2"}, nil }
	var opens atomic.Int32
	opened := make(chan net.Conn, 3)
	s.open = func(context.Context, gateway) (vehicle, error) {
		a, b := net.Pipe()
		opens.Add(1)
		opened <- b
		return gatewaySession{a}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.serveTCP(ctx, ln, network)
	a, e := net.Dial("tcp4", ln.Addr().String())
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	p := <-opened
	defer p.Close()
	b, e := net.Dial("tcp4", ln.Addr().String())
	if e != nil {
		t.Fatal(e)
	}
	defer b.Close()
	b.SetReadDeadline(time.Now().Add(time.Second))
	if _, e = b.Read(make([]byte, 1)); e == nil {
		t.Fatal("second client not rejected")
	} else if ne, ok := e.(net.Error); ok && ne.Timeout() {
		t.Fatal("second client left waiting instead of rejected")
	}
	if opens.Load() != 1 {
		t.Fatal("second vehicle session opened")
	}
	a.Close()
	deadline := time.Now().Add(time.Second)
	for s.snapshot().Client && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	c, e := net.Dial("tcp4", ln.Addr().String())
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	select {
	case p2 := <-opened:
		p2.Close()
	case <-time.After(time.Second):
		t.Fatal("client ownership not released")
	}
}

func TestDiscoveryRelaysActualIdentityAndStaysIdle(t *testing.T) {
	s := newService(defaults())
	pc, e := net.ListenPacket("udp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer pc.Close()
	_, network, _ := net.ParseCIDR("127.0.0.0/8")
	var probes atomic.Int32
	want := testIdentification()
	s.resolve = func(context.Context) (gateway, error) {
		probes.Add(1)
		return gateway{Address: "127.0.0.2", Identification: want}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.serveDiscovery(ctx, pc, network)
	c, e := net.Dial("udp4", pc.LocalAddr().String())
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(time.Second))
	c.Write(discoveryProbe)
	buf := make([]byte, 4096)
	n, e := c.Read(buf)
	if e != nil || !bytes.Equal(buf[:n], want) {
		t.Fatal("identity not transparently relayed", e)
	}
	if probes.Load() != 1 {
		t.Fatal("unexpected discovery count")
	}
	deadline := time.Now().Add(time.Second)
	for s.snapshot().DiscoveryReplies == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	st := s.snapshot()
	if st.DiscoveryRequests != 1 || st.DiscoveryReplies != 1 {
		t.Fatal("discovery counters", st)
	}
	c.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
	c.Write([]byte("not a discovery request"))
	c.Read(buf)
	if probes.Load() != 1 {
		t.Fatal("malformed input triggered vehicle traffic")
	}
}
