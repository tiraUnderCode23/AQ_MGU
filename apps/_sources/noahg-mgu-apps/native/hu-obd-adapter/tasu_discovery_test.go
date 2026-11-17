package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"runtime"
	"sync"
	"testing"
	"time"
)

func TestBootmod3DiscoveryFitsIts56ByteReceiver(t *testing.T) {
	identity, e := tasuIdentification("WBA12345678901234", 0x12, net.HardwareAddr{2, 0, 0, 0, 0, 1})
	if e != nil {
		t.Fatal(e)
	}
	received := make([]byte, 56)
	copy(received, identity)
	vin, ok := identification(received)
	if len(identity) != 56 || !ok || vin != "WBA12345678901234" || bytes.IndexByte(identity[6:], 0) >= 0 {
		t.Fatalf("bootmod3 truncates discovery: bytes=%d VIN=%q valid=%v", len(identity), vin, ok)
	}
}

type vinVehicle struct {
	responses     chan []byte
	done          chan struct{}
	once          sync.Once
	writes        int
	vin           string
	rejectGateway bool
}

func TestSuccessfulVINProbeCancellationKeepsReusableTransport(t *testing.T) {
	previous := runtime.GOMAXPROCS(1)
	defer runtime.GOMAXPROCS(previous)
	for i := 0; i < 100; i++ {
		s := newService(defaults())
		s.tasuContext = context.Background()
		v := newVINVehicle("WBA12345678901234")
		s.newTASU = func(context.Context) (vehicle, error) { return v, nil }
		s.hotspotMAC = func() (net.HardwareAddr, error) { return net.HardwareAddr{2, 0, 0, 0, 0, 1}, nil }
		ctx, cancel := context.WithCancel(context.Background())
		_, e := s.discoverTASU(ctx)
		cancel()
		if e != nil {
			t.Fatal(e)
		}
		runtime.Gosched()
		select {
		case <-v.done:
			t.Fatal("successful discovery cancelled reusable helper", i)
		default:
		}
		s.closeTASU()
	}
}

type silentVINVehicle struct{ *vinVehicle }

func (v *silentVINVehicle) WriteFrame(b []byte) error { v.writes++; return nil }

func TestSilentVINSourceDoesNotPreventAlternateSource(t *testing.T) {
	s := newService(defaults())
	s.tasuContext = context.Background()
	s.vinAttemptTimeout = 15 * time.Millisecond
	first := &silentVINVehicle{newVINVehicle("WBA12345678901234")}
	second := newVINVehicle("WBA12345678901234")
	opens := 0
	s.newTASU = func(context.Context) (vehicle, error) {
		opens++
		if opens == 1 {
			return first, nil
		}
		return second, nil
	}
	s.hotspotMAC = func() (net.HardwareAddr, error) { return net.HardwareAddr{2, 0, 0, 0, 0, 1}, nil }
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	g, e := s.discoverTASU(ctx)
	if e != nil || opens != 2 || g.Backend != "tasu" {
		t.Fatalf("silent ECU blocked alternative: opens=%d error=%v", opens, e)
	}
	select {
	case <-first.done:
	default:
		t.Fatal("timed-out transport was reused")
	}
	s.closeTASU()
}

func TestDiscoveryDeadlineDoesNotWaitForSlowIdleWarmup(t *testing.T) {
	s := newService(defaults())
	s.tasuContext = context.Background()
	started, finish := make(chan struct{}), make(chan struct{})
	v := newVINVehicle("WBA12345678901234")
	s.newTASU = func(context.Context) (vehicle, error) { close(started); <-finish; return v, nil }
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { _, e := s.waitForTASU(ctx); result <- e }()
	<-started
	cancel()
	select {
	case e := <-result:
		if !errors.Is(e, context.Canceled) {
			t.Fatal(e)
		}
	case <-time.After(time.Second):
		t.Fatal("probe ignored deadline during warmup")
	}
	close(finish)
	if got, e := s.ensureTASU(context.Background()); e != nil || got != v {
		t.Fatal("idle warmup was lost", e)
	}
	if v.writes != 0 {
		t.Fatal("cancelled probe generated diagnostics")
	}
	s.closeTASU()
}

func newVINVehicle(vin string) *vinVehicle {
	return &vinVehicle{responses: make(chan []byte, 8), done: make(chan struct{}), vin: vin}
}
func (v *vinVehicle) Close() error { v.once.Do(func() { close(v.done) }); return nil }
func (v *vinVehicle) ReadFrame() ([]byte, error) {
	select {
	case b := <-v.responses:
		if b == nil {
			return nil, errVINBatchDone
		}
		return b, nil
	case <-v.done:
		return nil, io.EOF
	}
}
func (v *vinVehicle) WriteFrame(b []byte) error {
	v.writes++
	if len(b) != 11 || b[8] != 0x22 || b[9] != 0xf1 || b[10] != 0x90 {
		return errors.New("unexpected VIN request")
	}
	v.responses <- frame(2, b[6:])
	if v.rejectGateway && b[7] == 0x10 {
		v.responses <- frame(1, []byte{0x10, b[6], 0x7f, 0x22, 0x31})
		return nil
	}
	source := b[7]
	if source == 0xdf {
		source = 0x12
	}
	v.responses <- frame(1, []byte{source, b[6], 0x7f, 0x22, 0x78})
	v.responses <- frame(1, append([]byte{source, b[6], 0x62, 0xf1, 0x90}, []byte(v.vin)...))
	if b[7] == 0xdf {
		v.responses <- nil
	}
	return nil
}

func TestTASUFallbackDiscoveryUsesRealVINAndNoIdleRequests(t *testing.T) {
	c := defaults()
	c.VehicleInterfaces = []string{"no_such_link"}
	s := newService(c)
	v := newVINVehicle("WBA12345678901234")
	s.newTASU = func(context.Context) (vehicle, error) { return v, nil }
	s.hotspotMAC = func() (net.HardwareAddr, error) { return net.HardwareAddr{2, 0, 0, 0, 0, 1}, nil }
	if _, e := s.ensureTASU(context.Background()); e != nil {
		t.Fatal(e)
	}
	if v.writes != 0 {
		t.Fatal("warmup sent diagnostic traffic")
	}
	g, e := s.resolveVehicle(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	vin, ok := identification(g.Identification)
	if !ok || vin != v.vin || g.Backend != "tasu" || v.writes != 1 {
		t.Fatal(g, vin, v.writes)
	}
	if binary.BigEndian.Uint16(g.Identification[4:]) != 0x11 {
		t.Fatal("bad discovery type")
	}
	s.closeTASU()
}

func TestTASUVINRefusalTriesDMEAndRejectsBadIdentity(t *testing.T) {
	v := newVINVehicle("WBA12345678901234")
	v.rejectGateway = true
	vin, ecu, e := readTASUVIN(context.Background(), v)
	if e != nil || ecu != 0x12 || vin != v.vin || v.writes != 2 {
		t.Fatal(vin, ecu, e)
	}
	bad := newVINVehicle("WBA1234567890123Q")
	if _, _, e := readTASUVIN(context.Background(), bad); e == nil {
		t.Fatal("invalid VIN accepted")
	}
	if _, e := tasuIdentification("short", 0x10, make(net.HardwareAddr, 6)); e == nil {
		t.Fatal("invented identity")
	}
	if _, e := tasuIdentification(v.vin, 0x10, nil); e == nil {
		t.Fatal("missing actual MAC accepted")
	}
}

func TestTASUUsesHotspotLifetimeRatherThanProbeDeadline(t *testing.T) {
	s := newService(defaults())
	life, cancelLife := context.WithCancel(context.Background())
	defer cancelLife()
	s.tasuContext = life
	probe, cancel := context.WithCancel(context.Background())
	var received context.Context
	s.newTASU = func(c context.Context) (vehicle, error) { received = c; return newVINVehicle("WBA12345678901234"), nil }
	if _, e := s.ensureTASU(probe); e != nil {
		t.Fatal(e)
	}
	cancel()
	if received.Err() != nil {
		t.Fatal("successful probe killed reusable TASU helper")
	}
	s.closeTASU()
}

type functionalVINVehicle struct {
	*vinVehicle
	frames [][]byte
}

func (v *functionalVINVehicle) WriteFrame(b []byte) error {
	v.writes++
	if !bytes.Equal(b, frame(1, []byte{0xf4, 0xdf, 0x22, 0xf1, 0x90})) {
		return errors.New("functional VIN required")
	}
	v.responses <- frame(2, b[6:])
	for _, f := range v.frames {
		v.responses <- f
	}
	v.responses <- nil
	return nil
}

func TestFunctionalVINDrainsRepliesAndRejectsConflictingIdentity(t *testing.T) {
	positive := func(ecu byte, vin string) []byte {
		return frame(1, append([]byte{ecu, 0xf4, 0x62, 0xf1, 0x90}, []byte(vin)...))
	}
	for _, tc := range []struct {
		name   string
		frames [][]byte
		want   string
	}{
		{"consistent", [][]byte{frame(1, []byte{0x40, 0xf4, 0x7f, 0x22, 0x31}), positive(0x12, "WBA12345678901234"), positive(0x10, "WBA12345678901234")}, "WBA12345678901234"},
		{"refusal_only", [][]byte{frame(1, []byte{0x40, 0xf4, 0x7f, 0x22, 0x31})}, ""},
		{"no_reply", nil, ""},
		{"conflict", [][]byte{positive(0x12, "WBA12345678901234"), positive(0x10, "WBA12345678901235")}, ""},
		{"invalid", [][]byte{positive(0x12, "WBA1234567890123Q")}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := &functionalVINVehicle{newVINVehicle(""), tc.frames}
			defer v.Close()
			vin, ecu, e := readTASUVIN(context.Background(), v, 0xdf)
			if tc.want == "" {
				if e == nil {
					t.Fatal("unverified identity accepted", vin)
				}
				return
			}
			if e != nil || vin != tc.want || ecu != 0x12 || len(v.responses) != 0 {
				t.Fatal("functional VIN did not drain all replies", vin, ecu, e, len(v.responses))
			}
		})
	}
}
