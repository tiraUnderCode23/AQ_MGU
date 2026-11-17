//go:build !linux

package main

import (
	"context"
	"errors"
	"net"
	"syscall"
)

func socketControl(device string) func(string, string, syscall.RawConn) error {
	return func(_, _ string, _ syscall.RawConn) error {
		if device != "" {
			return errors.New("interface confinement requires Linux")
		}
		return nil
	}
}

func isHotspotAP(_ string) (bool, error) {
	return false, errors.New("wireless mode query requires Linux")
}

func listenPacket(ctx context.Context, device, address string) (net.PacketConn, error) {
	lc := net.ListenConfig{Control: socketControl(device)}
	return lc.ListenPacket(ctx, "udp4", address)
}
