package main

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

var errVehicleUnavailable = errors.New("ENET gateway and TASU VIN read unavailable")
var errVINRefused = errors.New("vehicle VIN unavailable through TASU")

type vinNegativeReply struct{ nrc byte }

func (e vinNegativeReply) Error() string { return "ECU refused VIN read" }
func (e vinNegativeReply) Unwrap() error { return errVINRefused }

func (s *service) tasuAllowed() bool { return s.config.TASUFallback || s.config.ExperimentalTASU }

// Availability subscriptions are idle; no diagnostic request or lease is sent
// while warming the helper. A diagnostic client must trigger the VIN read.
func (s *service) ensureTASU(ctx context.Context) (vehicle, error) {
	s.tasuMu.Lock()
	defer s.tasuMu.Unlock()
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	if s.tasu != nil {
		if t, ok := s.tasu.(*tasuSession); ok {
			select {
			case <-t.done:
				t.Close()
				s.tasu = nil
			default:
			}
		}
		if s.tasu != nil {
			return s.tasu, nil
		}
	}
	s.mu.Lock()
	lifetime := s.tasuContext
	s.mu.Unlock()
	if lifetime == nil {
		lifetime = ctx
	}
	if e := lifetime.Err(); e != nil {
		return nil, e
	}
	v, e := s.newTASU(lifetime)
	s.mu.Lock()
	if e == nil {
		s.status.TASU = "ready"
		s.status.TASUError = ""
	} else {
		s.status.TASU = "unavailable"
		s.status.TASUError = tasuErrorCode(e)
	}
	s.mu.Unlock()
	if e == nil {
		s.tasu = v
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return v, e
}

// The availability warmup belongs to the hotspot lifetime. A short discovery
// request can stop waiting without destroying a helper another request can use.
func (s *service) waitForTASU(ctx context.Context) (vehicle, error) {
	type result struct {
		v vehicle
		e error
	}
	done := make(chan result, 1)
	go func() { v, e := s.ensureTASU(ctx); done <- result{v, e} }()
	select {
	case r := <-done:
		return r.v, r.e
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *service) discardTASU(v vehicle) {
	s.tasuMu.Lock()
	defer s.tasuMu.Unlock()
	v.Close()
	if s.tasu == v {
		s.tasu = nil
		s.mu.Lock()
		s.status.TASU = "idle"
		s.mu.Unlock()
	}
}

func (s *service) closeTASU() {
	s.tasuMu.Lock()
	defer s.tasuMu.Unlock()
	if s.tasu != nil {
		s.tasu.Close()
		s.tasu = nil
	}
	s.mu.Lock()
	s.status.TASU = "idle"
	s.mu.Unlock()
}

func readTASUVIN(ctx context.Context, v vehicle, targets ...byte) (string, byte, error) {
	// Physical reads require the requested ECU. Functional reads collect all
	// replies through the private completion marker and reject conflicting VINs.
	if len(targets) == 0 {
		targets = []byte{0x10, 0x12}
	}
	var refused error = errVINRefused
	for _, ecu := range targets {
		var writeErr error
		if writer, ok := v.(interface{ WriteVINRequest(byte) error }); ok {
			writeErr = writer.WriteVINRequest(ecu)
		} else {
			writeErr = v.WriteFrame(frame(1, []byte{0xf4, ecu, 0x22, 0xf1, 0x90}))
		}
		if writeErr != nil {
			return "", 0, writeErr
		}
		var found string
		var source byte
		for {
			if e := ctx.Err(); e != nil {
				return "", 0, e
			}
			b, e := v.ReadFrame()
			if ecu == 0xdf && errors.Is(e, errVINBatchDone) {
				if found != "" {
					return found, source, nil
				}
				break
			}
			if e != nil {
				return "", 0, e
			}
			if len(b) < 9 || b[4] != 0 || b[5] != 1 || (ecu != 0xdf && b[6] != ecu) || b[7] != 0xf4 || b[6] >= 0xdf {
				continue
			}
			u := b[8:]
			if len(u) >= 2 && u[0] == 0x7f && u[1] == 0x22 {
				if len(u) != 3 {
					return "", 0, tasuFailure("malformed_reply")
				}
				if u[2] == 0x78 {
					continue
				}
				refused = vinNegativeReply{nrc: u[2]}
				if ecu == 0xdf {
					continue
				}
				break
			}
			if len(u) < 3 || u[0] != 0x62 || u[1] != 0xf1 || u[2] != 0x90 {
				continue
			}
			if len(u) != 20 {
				return "", 0, tasuFailure("vin_invalid")
			}
			vin := string(u[3:])
			if !validVIN(vin) {
				return "", 0, tasuFailure("vin_invalid")
			}
			if ecu != 0xdf {
				return vin, b[6], nil
			}
			if found != "" && found != vin {
				return "", 0, tasuFailure("vin_invalid")
			}
			if found == "" {
				found, source = vin, b[6]
			}
		}
	}
	return "", 0, refused
}

func validVIN(vin string) bool {
	if len(vin) != 17 {
		return false
	}
	for _, c := range []byte(vin) {
		if !((c >= 'A' && c <= 'Z' && c != 'I' && c != 'O' && c != 'Q') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}

func tasuIdentification(vin string, ecu byte, mac net.HardwareAddr) ([]byte, error) {
	if !validVIN(vin) || len(mac) != 6 {
		return nil, errors.New("real VIN and hotspot MAC required")
	}
	// bootmod3 receives at most 56 bytes: six header bytes plus the three
	// fixed-width ASCII fields. Separators would truncate the actual VIN.
	return frame(0x11, []byte(fmt.Sprintf("DIAGADR%02XBMWMAC%sBMWVIN%s", ecu, strings.ToUpper(hex.EncodeToString(mac)), vin))), nil
}

func readVINAttempt(ctx context.Context, v vehicle, target byte) (string, byte, error) {
	// Join the cancellation watcher before returning, so a caller cancelling
	// its completed probe cannot accidentally close the reusable connection.
	done := make(chan struct{})
	exited := make(chan struct{})
	go func() {
		defer close(exited)
		select {
		case <-ctx.Done():
			v.Close()
		case <-done:
		}
	}()
	vin, ecu, e := readTASUVIN(ctx, v, target)
	close(done)
	<-exited
	if ctx.Err() != nil {
		return "", 0, ctx.Err()
	}
	return vin, ecu, e
}

func (s *service) discoverTASU(ctx context.Context) (_ gateway, resultErr error) {
	var vinTarget byte
	defer func() {
		if errors.Is(resultErr, context.Canceled) {
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		s.status.TASUVINError = ""
		s.status.TASUVINTarget = ""
		s.status.TASUVINNRC = ""
		if resultErr != nil {
			s.status.TASUVINError = tasuErrorCode(resultErr)
			if errors.Is(resultErr, context.DeadlineExceeded) {
				s.status.TASUVINError = "vin_timeout"
			}
			s.status.TASUVINTarget = fmt.Sprintf("0x%02X", vinTarget)
			var negative vinNegativeReply
			if errors.As(resultErr, &negative) {
				s.status.TASUVINNRC = fmt.Sprintf("0x%02X", negative.nrc)
			}
		}
	}()
	limit := s.vinAttemptTimeout
	if limit == 0 {
		// Allow the eight-second method call, a normal ten-second ECU reply
		// window, and the existing HU diagnostic client's busy backoff.
		limit = 30 * time.Second
	}
	var vin string
	var ecu byte
	var failure error
	// Fault Scanner demonstrates functional TASU access on the owner's car.
	// Try that addressing mode first; a VIN reply does not verify physical DME
	// access. Silence/refusal must still allow the two physical alternatives.
	for _, target := range []byte{0xdf, 0x12, 0x10} {
		vinTarget = target
		v, e := s.waitForTASU(ctx)
		if e != nil {
			return gateway{}, e
		}
		attempt, cancel := context.WithTimeout(ctx, limit)
		vin, ecu, e = readVINAttempt(attempt, v, target)
		cancel()
		if e == nil {
			failure = nil
			break
		}
		failure = e
		// An explicit ECU negative reply completes a healthy request. Reuse
		// that worker for the other ECU; only a timeout/fault needs a reset.
		if !errors.Is(e, errVINRefused) || target == 0x10 {
			s.discardTASU(v)
		}
		if ctx.Err() != nil {
			return gateway{}, ctx.Err()
		}
	}
	if failure != nil {
		s.mu.Lock()
		s.status.TASUError = tasuErrorCode(failure)
		s.mu.Unlock()
		return gateway{}, failure
	}
	mac, e := s.hotspotMAC()
	if e != nil {
		return gateway{}, e
	}
	s.record(fmt.Sprintf("tasu_vin_source_0x%02X", ecu))
	// The adapter presents the standard ENET gateway address. This is a
	// virtual gateway, independent of which physical ECU supplied the VIN.
	identity, e := tasuIdentification(vin, 0x10, mac)
	if e != nil {
		return gateway{}, e
	}
	return gateway{Address: "tasu", Backend: "tasu", Identification: identity}, nil
}

func tasuGatewayVIN(g gateway) string {
	if g.Backend != "tasu" {
		return ""
	}
	vin, ok := identification(g.Identification)
	if !ok {
		return ""
	}
	return vin
}

func (s *service) resolveVehicle(ctx context.Context) (gateway, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	g, gatewayError := discover(ctx, links(s.config.VehicleInterfaces), s.config.DiscoveryPort, time.Duration(s.config.DiscoveryTimeoutMS)*time.Millisecond, s.firewall)
	if gatewayError == nil {
		return g, nil
	}
	if !s.tasuAllowed() {
		return gateway{}, gatewayError
	}
	g, e := s.discoverTASU(ctx)
	if e != nil {
		return gateway{}, fmt.Errorf("%w: %v", errVehicleUnavailable, e)
	}
	return g, nil
}
