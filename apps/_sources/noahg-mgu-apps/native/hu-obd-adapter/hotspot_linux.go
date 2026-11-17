//go:build linux

package main

import (
	"encoding/binary"
	"errors"
	"net"
	"os"
	"path/filepath"
	"syscall"
)

// Read-only nl80211 queries distinguish the car hotspot from wlan0 operating
// as a station on another Wi-Fi network. Linux UAPI enum values are stable:
// CTRL_CMD_GETFAMILY=3; NL80211_CMD_GET_INTERFACE=5; AP=3; AP_VLAN=4.
func attributes(b []byte) (map[uint16][]byte, error) {
	out := make(map[uint16][]byte)
	for len(b) > 0 {
		if len(b) < 4 {
			return nil, errors.New("short netlink attribute")
		}
		n := int(binary.NativeEndian.Uint16(b))
		if n < 4 || n > len(b) {
			return nil, errors.New("invalid netlink attribute")
		}
		out[binary.NativeEndian.Uint16(b[2:])&0x3fff] = b[4:n]
		step := (n + 3) &^ 3
		if step > len(b) {
			return nil, errors.New("missing netlink padding")
		}
		b = b[step:]
	}
	return out, nil
}

func attribute(t uint16, b []byte) []byte {
	n := len(b) + 4
	out := make([]byte, (n+3)&^3)
	binary.NativeEndian.PutUint16(out, uint16(n))
	binary.NativeEndian.PutUint16(out[2:], t)
	copy(out[4:], b)
	return out
}

func genericQuery(fd int, family uint16, command byte, seq uint32, attrs []byte) (map[uint16][]byte, error) {
	b := make([]byte, 20+len(attrs))
	binary.NativeEndian.PutUint32(b, uint32(len(b)))
	binary.NativeEndian.PutUint16(b[4:], family)
	binary.NativeEndian.PutUint16(b[6:], syscall.NLM_F_REQUEST)
	binary.NativeEndian.PutUint32(b[8:], seq)
	b[16] = command
	b[17] = 1
	copy(b[20:], attrs)
	if e := syscall.Sendto(fd, b, 0, &syscall.SockaddrNetlink{Family: syscall.AF_NETLINK}); e != nil {
		return nil, e
	}
	buf := make([]byte, 16384)
	for {
		n, _, e := syscall.Recvfrom(fd, buf, 0)
		if e != nil {
			return nil, e
		}
		messages, e := syscall.ParseNetlinkMessage(buf[:n])
		if e != nil {
			return nil, e
		}
		for _, m := range messages {
			if m.Header.Seq != seq {
				continue
			}
			if m.Header.Type == syscall.NLMSG_ERROR || m.Header.Type == syscall.NLMSG_DONE {
				return nil, errors.New("wireless interface query unavailable")
			}
			if len(m.Data) < 4 {
				return nil, errors.New("short generic netlink reply")
			}
			return attributes(m.Data[4:])
		}
	}
}

func isCarHotspotBridge(sysfs, device string) bool {
	// The car's IP endpoint is its dedicated WLAN bridge, not the parent
	// station radio. A kernel bridge has no nl80211 interface type.
	if device != "wlan_bridge" {
		return false
	}
	st, e := os.Stat(filepath.Join(sysfs, device, "bridge"))
	return e == nil && st.IsDir()
}

func isHotspotAP(device string) (bool, error) {
	if isCarHotspotBridge("/sys/class/net", device) {
		return true, nil
	}
	i, e := net.InterfaceByName(device)
	if e != nil {
		return false, e
	}
	fd, e := syscall.Socket(syscall.AF_NETLINK, syscall.SOCK_RAW|syscall.SOCK_CLOEXEC, syscall.NETLINK_GENERIC)
	if e != nil {
		return false, e
	}
	defer syscall.Close(fd)
	if e = syscall.Bind(fd, &syscall.SockaddrNetlink{Family: syscall.AF_NETLINK}); e != nil {
		return false, e
	}
	if e = syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &syscall.Timeval{Sec: 1}); e != nil {
		return false, e
	}
	control, e := genericQuery(fd, 0x10, 3, 1, attribute(2, []byte("nl80211\x00")))
	if e != nil {
		return false, e
	}
	if len(control[1]) != 2 {
		return false, errors.New("wireless family unavailable")
	}
	index := make([]byte, 4)
	binary.NativeEndian.PutUint32(index, uint32(i.Index))
	attrs, e := genericQuery(fd, binary.NativeEndian.Uint16(control[1]), 5, 2, attribute(3, index))
	if e != nil {
		return false, e
	}
	if len(attrs[5]) != 4 {
		return false, errors.New("wireless mode unavailable")
	}
	mode := binary.NativeEndian.Uint32(attrs[5])
	return mode == 3 || mode == 4 || mode == 9, nil
}
