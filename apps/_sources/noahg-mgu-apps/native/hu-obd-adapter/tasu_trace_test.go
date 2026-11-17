package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTASUTraceSeparatesNoEventAndIgnoredReply(t *testing.T) {
	s := newService(defaults())
	s.observeTASU(workerMessage{Stage: "request", Target: 0x12, SID: 0x22})
	s.observeTASU(workerMessage{Stage: "verdict", Code: "NO_ERROR"})
	if trace := s.snapshot().TASUTrace; trace.Requests != 1 || trace.Verdict != "NO_ERROR" || trace.Events != 0 {
		t.Fatal(trace)
	}
	s.observeTASU(workerMessage{Stage: "event", Target: 0x40, SID: 0x62, Identifier: 0xf190, Size: 29})
	s.observeTASU(workerMessage{Stage: "other_ecu"})
	trace := s.snapshot().TASUTrace
	if trace.Events != 1 || trace.Matched != 0 || trace.Ignored != 1 || trace.LastIgnore != "other_ecu" || !strings.Contains(trace.LastEvent, "ECU 0x40") {
		t.Fatal(trace)
	}
	s.observeTASU(workerMessage{Stage: "event", Target: 0x12, SID: 0x62, Identifier: 0xf190, Size: 29})
	s.observeTASU(workerMessage{Stage: "matched"})
	if s.snapshot().TASUTrace.Matched != 1 {
		t.Fatal(s.snapshot())
	}
	s.observeTASU(workerMessage{Stage: "unowned"})
	s.observeTASU(workerMessage{Stage: "request", Target: 0x10, SID: 0x22})
	trace = s.snapshot().TASUTrace
	if trace.Requests != 2 || trace.Events != 0 || trace.Verdict != "" || trace.LastEvent != "" || trace.Unowned != 1 {
		t.Fatal(trace)
	}
}

func TestTASUTraceExportsOnlyBoundedProtocolMetadata(t *testing.T) {
	s := newService(defaults())
	private := "WBA12345678901234"
	s.observeTASU(workerMessage{Stage: "verdict", Code: private})
	s.observeTASU(workerMessage{Stage: private, Code: private, Hex: private})
	s.observeTASU(workerMessage{Stage: "event", Size: maxFrame + 7})
	b, e := json.Marshal(s.snapshot())
	if e != nil || strings.Contains(string(b), private) || s.snapshot().TASUTrace.Events != 0 {
		t.Fatal(string(b), e)
	}
}
