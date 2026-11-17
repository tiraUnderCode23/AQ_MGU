//go:build linux

package main

import (
	"context"
	"net"
	"syscall"
)

// UDP discovery receives limited and directed broadcasts, but SO_BINDTODEVICE
// confines both ingress and egress to the car hotspot, including with a
// wildcard UDP address. Scoped firewall management is separate from sockets.
func socketControl(device string) func(string, string, syscall.RawConn) error {
	return func(_, _ string, c syscall.RawConn) error {
		var e error
		err := c.Control(func(fd uintptr) {
			if device != "" {
				e = syscall.SetsockoptString(int(fd), syscall.SOL_SOCKET, syscall.SO_BINDTODEVICE, device)
			}
			if e == nil {
				e = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_BROADCAST, 1)
			}
		})
		if err != nil {
			return err
		}
		return e
	}
}

func listenPacket(ctx context.Context, device, address string) (net.PacketConn, error) {
	lc := net.ListenConfig{Control: socketControl(device)}
	return lc.ListenPacket(ctx, "udp4", address)
}
