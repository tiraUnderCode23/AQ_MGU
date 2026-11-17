package main

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"
)

type delayedVINVehicle struct{ *vinVehicle }

func (v *delayedVINVehicle) WriteFrame(request []byte) error {
	v.writes++
	go func() {
		timer := time.NewTimer(3100 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-v.done:
			return
		case <-timer.C:
		}
		v.responses <- frame(2, request[6:])
		source := request[7]
		if source == 0xdf {
			source = 0x12
		}
		v.responses <- frame(1, append([]byte{source, request[6], 0x62, 0xf1, 0x90}, []byte(v.vin)...))
		if request[7] == 0xdf {
			v.responses <- nil
		}
	}()
	return nil
}

func TestVINReadAllowsReplyBeyondThreeSeconds(t *testing.T) {
	s := newService(defaults())
	v := &delayedVINVehicle{newVINVehicle("WBA12345678901234")}
	s.newTASU = func(context.Context) (vehicle, error) { return v, nil }
	s.hotspotMAC = func() (net.HardwareAddr, error) { return net.HardwareAddr{2, 0, 0, 0, 0, 1}, nil }
	defer s.closeTASU()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	gateway, err := s.discoverTASU(ctx)
	if err != nil || gateway.Backend != "tasu" || v.writes != 1 {
		t.Fatal("VIN discovery ended before the ECU reply", gateway.Backend, err, v.writes)
	}
}

type refusingVINVehicle struct{ *vinVehicle }

func (v *refusingVINVehicle) WriteFrame(request []byte) error {
	source := request[7]
	if source == 0xdf {
		source = 0x12
	}
	v.responses <- frame(1, []byte{source, request[6], 0x7f, 0x22, 0x33})
	if request[7] == 0xdf {
		v.responses <- nil
	}
	return nil
}

func TestVINFailureSurvivesHelperWarmupAndClearsOnSuccessfulRead(t *testing.T) {
	s := newService(defaults())
	s.newTASU = func(context.Context) (vehicle, error) {
		return &refusingVINVehicle{newVINVehicle("WBA12345678901234")}, nil
	}
	if _, err := s.discoverTASU(context.Background()); !errors.Is(err, errVINRefused) {
		t.Fatal(err)
	}
	state := s.snapshot()
	if state.TASUVINError != "vin_refused" || state.TASUVINTarget != "0x10" || state.TASUVINNRC != "0x33" {
		t.Fatal(state)
	}
	s.closeTASU()
	s.newTASU = func(context.Context) (vehicle, error) { return newVINVehicle("WBA12345678901234"), nil }
	defer s.closeTASU()
	if _, err := s.ensureTASU(context.Background()); err != nil {
		t.Fatal(err)
	}
	if state = s.snapshot(); state.TASU != "ready" || state.TASUVINError != "vin_refused" {
		t.Fatal("provider readiness erased the ECU failure", state)
	}
	s.hotspotMAC = func() (net.HardwareAddr, error) { return net.HardwareAddr{2, 0, 0, 0, 0, 1}, nil }
	if _, err := s.discoverTASU(context.Background()); err != nil {
		t.Fatal(err)
	}
	if state = s.snapshot(); state.TASUVINError != "" || state.TASUVINTarget != "" || state.TASUVINNRC != "" {
		t.Fatal("successful VIN read did not clear the failure", state)
	}
}
