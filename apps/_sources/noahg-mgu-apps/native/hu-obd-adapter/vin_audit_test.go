package main

import (
	"context"
	"errors"
	"io"
	"net"
	"testing"
	"time"
)

type malformedVINVehicle struct{ *vinVehicle }

func (v *malformedVINVehicle) WriteFrame(b []byte) error {
	source := b[7]
	if source == 0xdf {
		source = 0x12
	}
	v.responses <- frame(1, []byte{source, b[6], 0x62, 0xf1, 0x90, 'W', 'B', 'A'})
	return nil
}
func TestMatchingTruncatedVINFailsInsteadOfWaitingForAnotherResponse(t *testing.T) {
	v := &malformedVINVehicle{newVINVehicle("")}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, _, e := readVINAttempt(ctx, v, 0x12)
	if tasuErrorCode(e) != "vin_invalid" {
		t.Fatalf("truncated matching reply misreported: %v", e)
	}
}
func TestBufferedVINFramesPrecedeWorkerExit(t *testing.T) {
	for i := 0; i < 100; i++ {
		s := &tasuSession{frames: make(chan []byte, 2), done: make(chan struct{}), err: io.EOF}
		s.frames <- frame(2, []byte{0xf4, 0x12, 0x22, 0xf1, 0x90})
		s.frames <- frame(1, append([]byte{0x12, 0xf4, 0x62, 0xf1, 0x90}, []byte("WBA12345678901234")...))
		close(s.done)
		for j := 0; j < 2; j++ {
			if _, e := s.ReadFrame(); e != nil {
				t.Fatalf("queued response discarded on exit: %v", e)
			}
		}
		if _, e := s.ReadFrame(); !errors.Is(e, io.EOF) {
			t.Fatal(e)
		}
	}
}
func TestRouteProbeCannotConsumeAnActiveClientsTASUReplies(t *testing.T) {
	s := newService(defaults())
	c, peer := net.Pipe()
	defer c.Close()
	defer peer.Close()
	s.client = c
	calls := 0
	s.resolve = func(context.Context) (gateway, error) { calls++; return gateway{Address: "tasu", Backend: "tasu"}, nil }
	if _, e := s.probe(context.Background(), true); e == nil || calls != 0 {
		t.Fatal("active client did not exclude a competing route reader", e, calls)
	}
}

func TestMalformedFunctionalVINDoesNotPreventPhysicalVINRead(t *testing.T) {
	s := newService(defaults())
	s.tasuContext = context.Background()
	opens := 0
	s.newTASU = func(context.Context) (vehicle, error) {
		opens++
		v := newVINVehicle("WBA12345678901234")
		if opens == 1 {
			return &malformedVINVehicle{v}, nil
		}
		return v, nil
	}
	s.hotspotMAC = func() (net.HardwareAddr, error) { return net.HardwareAddr{2, 0, 0, 0, 0, 1}, nil }
	defer s.closeTASU()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	g, e := s.discoverTASU(ctx)
	if e != nil || opens != 2 || g.Backend != "tasu" {
		t.Fatal("malformed functional reply blocked physical fallback", opens, e)
	}
}

func TestProbeWaitingForResponseOwnershipHonorsCancellation(t *testing.T) {
	s := newService(defaults())
	if e := s.lockProbe(context.Background()); e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, e := s.probe(ctx, true); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
	s.unlockProbe()
	s.resolve = func(context.Context) (gateway, error) { return gateway{Address: "tasu", Backend: "tasu"}, nil }
	if _, e := s.probe(context.Background(), true); e != nil {
		t.Fatal("cancelled waiter leaked ownership", e)
	}
}
