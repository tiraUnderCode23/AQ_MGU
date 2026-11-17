package main

import (
	"encoding/binary"
	"fmt"
	"time"
)

type dmeReadEvidence struct {
	Identification  string `json:"identification"`
	ManufactureDate string `json:"manufactureDate"`
	ROMMemory       string `json:"romMemory"`
	SWEMetadata     string `json:"sweMetadata"`
}
type diagnosticOperation struct {
	Time        string `json:"time"`
	Direction   string `json:"direction"`
	ECU         byte   `json:"ecu"`
	Tester      byte   `json:"tester"`
	Service     string `json:"service"`
	Identifier  string `json:"identifier,omitempty"`
	Subfunction byte   `json:"subfunction,omitempty"`
	Bytes       int    `json:"bytes"`
	Result      string `json:"result"`
	NRC         string `json:"nrc,omitempty"`
}

func evidenceKey(u []byte) byte {
	if len(u) == 3 && u[0] == 0x22 {
		switch binary.BigEndian.Uint16(u[1:]) {
		case 0xf101:
			return 1
		case 0xf18b:
			return 2
		case 0xf301:
			return 4
		}
	}
	if len(u) == 12 && u[0] == 0x31 && u[1] == 1 && u[2] == 2 && u[3] == 5 {
		return 8
	}
	return 0
}
func (e *dmeReadEvidence) field(key byte) *string {
	switch key {
	case 1:
		return &e.Identification
	case 2:
		return &e.ManufactureDate
	case 4:
		return &e.ROMMemory
	case 8:
		return &e.SWEMetadata
	}
	return nil
}

// Pending bits are confined to one relay and the validated tester range.
// Positive evidence requires a matching request and an actual backend frame.
func (s *service) noteDMERequest(pending map[byte]byte, b []byte) {
	if len(b) < 9 || b[7] != 0x12 {
		return
	}
	key := evidenceKey(b[8:])
	if key == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	pending[b[6]] |= key
	f := s.status.DME.field(key)
	if *f != "positive_reply" {
		*f = "requested"
	}
}
func (s *service) noteDMEReply(pending map[byte]byte, b []byte) {
	if len(b) < 12 || b[6] != 0x12 || binary.BigEndian.Uint16(b[4:]) != 1 {
		return
	}
	u := b[8:]
	var key byte
	if u[0] == 0x62 && len(u) > 3 {
		key = evidenceKey([]byte{0x22, u[1], u[2]})
	}
	if len(u) > 4 && u[0] == 0x71 && u[1] == 1 && u[2] == 2 && u[3] == 5 {
		key = 8
	}
	if key == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if pending[b[7]]&key == 0 {
		return
	}
	pending[b[7]] &^= key
	*s.status.DME.field(key) = "positive_reply"
}

func (s *service) logOperation(b []byte, direction, result string) {
	if len(b) < 9 || binary.BigEndian.Uint16(b[4:]) != 1 {
		return
	}
	u := b[8:]
	o := diagnosticOperation{Time: time.Now().UTC().Format(time.RFC3339), Direction: direction, ECU: b[7], Tester: b[6], Service: fmt.Sprintf("0x%02X", u[0]), Bytes: len(u), Result: result}
	if direction == "response" {
		o.ECU, o.Tester = b[6], b[7]
	}
	switch u[0] {
	case 0x22, 0x62:
		if len(u) >= 3 {
			o.Identifier = fmt.Sprintf("0x%04X", binary.BigEndian.Uint16(u[1:]))
		}
	case 0x2c, 0x6c, 0x31, 0x71:
		if len(u) >= 4 {
			o.Subfunction = u[1]
			o.Identifier = fmt.Sprintf("0x%04X", binary.BigEndian.Uint16(u[2:]))
		}
	case 0x7f:
		if len(u) == 3 {
			o.Service = fmt.Sprintf("0x%02X", u[1])
			o.NRC = fmt.Sprintf("0x%02X", u[2])
			o.Result = "negative"
			if u[2] == 0x78 {
				o.Result = "pending"
			}
		}
	}
	// No raw request/response bytes, VINs, serials or memory contents are stored.
	s.mu.Lock()
	defer s.mu.Unlock()
	s.operations = append(s.operations, o)
	if len(s.operations) > 64 {
		s.operations = s.operations[len(s.operations)-64:]
	}
}
