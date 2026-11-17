package main

import (
	"bytes"
	"encoding/binary"
)

// These are independently observed BMW read operations. Dynamic DID F301
// points at a bounded memory window; it does not program ECU memory.
func checkBMWReadOperation(b []byte) error {
	u := b[8:]
	// The unchanged bootmod3 agent sends this exact gateway setup before its
	// DME identification sequence. Forward it instead of fabricating a local
	// refusal, but keep every other BDC routine unavailable.
	if b[7] == 0x40 && bytes.Equal(u, []byte{0x31, 1, 0x10, 1, 0x0a, 0x0a, 0x43}) {
		return nil
	}
	if b[7] != 0x12 {
		return requestDenied{0x31}
	}
	switch u[0] {
	case 0x2c:
		if bytes.Equal(u, []byte{0x2c, 3, 0xf3, 1}) {
			return nil
		}
		if len(u) != 11 || !bytes.Equal(u[:5], []byte{0x2c, 2, 0xf3, 1, 0x24}) || u[9] != 0 || u[10] != 0xff {
			return requestDenied{0x31}
		}
		switch binary.BigEndian.Uint32(u[5:9]) {
		case 0x807ffe50, 0x0977fe4c, 0x801ffdac, 0x8005fe1e:
			return nil
		}
	case 0x31:
		// readSWEDevelopmentInfo: one complete BTLD/SWFL SGBM descriptor.
		// Other routines, including erase/programming and gateway controls, remain
		// unavailable. No success reply is generated locally.
		if len(u) == 12 && bytes.Equal(u[:4], []byte{0x31, 1, 2, 5}) && (u[4] == 6 || u[4] == 8) && binary.BigEndian.Uint32(u[5:9]) != 0 {
			return nil
		}
	}
	return requestDenied{0x31}
}
