package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
)

const maxFrame = 1024 * 1024

var discoveryProbe = []byte{0, 0, 0, 0, 0, 0x11}

// HSFZ lengths exclude the six-byte header. Control frames need not carry
// addresses, unlike diagnostic requests and transfer acknowledgements.
func readFrame(r io.Reader) ([]byte, error) {
	h := make([]byte, 6)
	if _, err := io.ReadFull(r, h); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(h)
	if n > maxFrame {
		return nil, errors.New("HSFZ frame exceeds limit")
	}
	t := binary.BigEndian.Uint16(h[4:])
	if (t == 1 || t == 2) && n < 2 {
		return nil, errors.New("HSFZ addresses missing")
	}
	b := make([]byte, 6+int(n))
	copy(b, h)
	_, err := io.ReadFull(r, b[6:])
	return b, err
}

func frame(t uint16, body []byte) []byte {
	b := make([]byte, 6+len(body))
	binary.BigEndian.PutUint32(b, uint32(len(body)))
	binary.BigEndian.PutUint16(b[4:], t)
	copy(b[6:], body)
	return b
}

func identification(b []byte) (string, bool) {
	if len(b) < 6 || binary.BigEndian.Uint16(b[4:]) != 0x11 {
		return "", false
	}
	if int(binary.BigEndian.Uint32(b)) != len(b)-6 {
		return "", false
	}
	i := bytes.Index(b[6:], []byte("BMWVIN"))
	if i < 0 || len(b) < 6+i+6+17 {
		return "", false
	}
	v := b[12+i : 12+i+17]
	for _, c := range v {
		if !((c >= 'A' && c <= 'Z' && c != 'I' && c != 'O' && c != 'Q') || (c >= '0' && c <= '9')) {
			return "", false
		}
	}
	return string(v), true
}

// The forwarding core is application independent. This release carries reads
// only; coding and programming stay unavailable until measured
// target-specific continuity and recovery evidence is available.
func checkRequest(b []byte) error {
	if len(b) < 6 || int(binary.BigEndian.Uint32(b)) != len(b)-6 {
		return errors.New("short HSFZ frame")
	}
	t := binary.BigEndian.Uint16(b[4:])
	if t != 1 {
		if t == 0x12 && len(b) <= 8 {
			return nil
		} // client-originated alive response
		return errors.New("unsupported client control word")
	}
	if len(b) < 9 {
		return errors.New("empty diagnostic request")
	}
	if b[6] < 0xf0 || b[6] > 0xfe {
		return errors.New("invalid tester address")
	}
	switch b[8] {
	case 0x2c, 0x31:
		return checkBMWReadOperation(b)
	case 0x01, 0x09, 0x19, 0x1a, 0x21, 0x22:
		return nil
	case 0x10:
		if len(b) == 10 && (b[9]&0x7f == 1 || b[9]&0x7f == 3) {
			return nil
		}
		return requestDenied{0x12}
	case 0x3e:
		if len(b) == 10 && b[9]&0x7f == 0 {
			return nil
		}
		return requestDenied{0x12}
	default:
		return requestDenied{0x11}
	}
}

// An unsupported operation gets a transport acknowledgement and a UDS negative
// reply. It never reaches an ECU and does not tear down a healthy connection.
type requestDenied struct{ nrc byte }

func (e requestDenied) Error() string { return "operation unavailable in connection-only build" }
