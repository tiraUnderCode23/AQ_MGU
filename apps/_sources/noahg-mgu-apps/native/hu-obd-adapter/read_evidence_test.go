package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDiagnosticOperationExportIsBoundedAndRedacted(t *testing.T) {
	s := newService(defaults())
	vin := "WBA12345678901234"
	for i := 0; i < 100; i++ {
		s.logOperation(frame(1, append([]byte{0x12, 0xf4, 0x62, 0xf1, 0x90}, []byte(vin)...)), "response", "received")
	}
	s.logOperation(frame(1, []byte{0xf4, 0x12, 0x31, 1, 2, 5, 6, 0, 0, 0x42, 0x95, 1, 45, 1}), "request", "allowed")
	s.logOperation(frame(1, []byte{0x12, 0xf4, 0x7f, 0x31, 0x78}), "response", "received")
	if len(s.operations) != 64 {
		t.Fatal("operation log unbounded", len(s.operations))
	}
	b, e := json.Marshal(s.operations)
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(b), vin) || strings.Contains(string(b), "4295") {
		t.Fatal("vehicle payload leaked", string(b))
	}
	op := s.operations[len(s.operations)-2]
	if op.Identifier != "0x0205" || op.Subfunction != 1 || op.Service != "0x31" || op.Bytes != 12 {
		t.Fatal("operation metadata lost", op)
	}
	if last := s.operations[len(s.operations)-1]; last.Result != "pending" || last.NRC != "0x78" {
		t.Fatal(last)
	}
}
