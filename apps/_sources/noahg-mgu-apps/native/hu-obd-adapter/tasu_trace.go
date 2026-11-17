package main

import "fmt"

// Only protocol metadata is exported. No diagnostic data bytes, VIN, native
// exception text, firmware identities, or client identifiers are retained.
type tasuTrace struct {
	Requests   uint64 `json:"requests"`
	Events     uint64 `json:"events"`
	Matched    uint64 `json:"matched"`
	Ignored    uint64 `json:"ignored"`
	Unowned    uint64 `json:"unowned"`
	Target     string `json:"target,omitempty"`
	Service    string `json:"service,omitempty"`
	Verdict    string `json:"verdict,omitempty"`
	LastEvent  string `json:"lastEvent,omitempty"`
	LastIgnore string `json:"lastIgnore,omitempty"`
}

type workerMessage struct {
	Type       string `json:"type"`
	Hex        string `json:"hex"`
	Code       string `json:"code"`
	Stage      string `json:"stage"`
	Target     uint8  `json:"target"`
	SID        uint8  `json:"sid"`
	Identifier uint16 `json:"identifier"`
	Size       uint32 `json:"size"`
}

func (s *service) observeTASU(m workerMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t := &s.status.TASUTrace
	switch m.Stage {
	case "request":
		*t = tasuTrace{Requests: t.Requests + 1, Unowned: t.Unowned, Target: fmt.Sprintf("0x%02X", m.Target), Service: fmt.Sprintf("0x%02X", m.SID)}
	case "verdict":
		switch m.Code {
		case "NO_ERROR", "REQUEST_PENDING", "TAS_CONNECTION_ERROR", "TIMEOUT_ERROR", "DEACTIVATED", "INVALID_REQUEST", "INVALID_LENGTH", "APP_REQUEST_TEMPORARILY_NOT_ACCEPTED", "INVALID_SESSION", "EXCLUSIVE_MODE_REQUESTED", "EXCLUSIVE_MODE_OCCUPIED", "EXCLUSIVE_MODE_ACTIVE", "EXCLUSIVE_MODE_PENDING", "WRONG_IDENTIFIER", "INVALID_VERDICT":
			t.Verdict = m.Code
		}
	case "event":
		if m.Size > maxFrame+6 {
			return
		}
		t.Events++
		t.LastEvent = fmt.Sprintf("ECU 0x%02X / SID 0x%02X / %d bytes", m.Target, m.SID, m.Size)
		if m.SID == 0x62 {
			t.LastEvent += fmt.Sprintf(" / DID 0x%04X", m.Identifier)
		}
	case "matched":
		t.Matched++
	case "provider_pending":
		t.LastEvent = "provider pending (awaiting ECU reply)"
	case "other_ecu", "other_reply":
		t.Ignored++
		t.LastIgnore = m.Stage
	case "unowned":
		t.Unowned++
	}
}
