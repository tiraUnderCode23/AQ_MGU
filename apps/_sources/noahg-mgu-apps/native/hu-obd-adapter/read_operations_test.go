package main

import (
	"encoding/hex"
	"testing"
)

func TestBMWIdentificationReadProfile(t *testing.T) {
	for _, payload := range []string{
		"2c03f301", "2c02f30124807ffe5000ff", "2c02f301240977fe4c00ff",
		"2c02f30124801ffdac00ff", "2c02f301248005fe1e00ff",
		"310102050600004295012d01", "31010205080000637532dc01",
	} {
		u, _ := hex.DecodeString(payload)
		if e := checkRequest(frame(1, append([]byte{0xf4, 0x12}, u...))); e != nil {
			t.Fatal(payload, e)
		}
	}
	routing, _ := hex.DecodeString("310110010a0a43")
	if e := checkRequest(frame(1, append([]byte{0xf4, 0x40}, routing...))); e != nil {
		t.Fatal("observed bootmod3 gateway setup blocked", e)
	}
	for _, payload := range []string{
		"2c03", "2c03f302", "2c02f30124807ffe500100", "2c02f30124807ffe5100ff",
		"2c02f30224807ffe5000ff", "2c02f30124807ffe5000ff00", "2c01f301f1010101",
		"3101020500000000", "310102050500004295012d01", "310102050600000000012d01",
		"310302050600004295012d01", "3101ff000600004295012d01",
		"3400440000000000000001", "3d24807ffe500001ff",
	} {
		u, _ := hex.DecodeString(payload)
		if checkRequest(frame(1, append([]byte{0xf4, 0x12}, u...))) == nil {
			t.Fatal("unvalidated operation allowed", payload)
		}
	}
	u, _ := hex.DecodeString("2c03f301")
	if checkRequest(frame(1, append([]byte{0xf4, 0x18}, u...))) == nil {
		t.Fatal("DME profile applied to another ECU")
	}
	for _, attempt := range []struct {
		target  byte
		payload string
	}{
		{0x40, "310110010a0a42"},
		{0x40, "310110020a0a43"},
		{0x40, "31011001"},
		{0x41, "310110010a0a43"},
	} {
		u, _ := hex.DecodeString(attempt.payload)
		if checkRequest(frame(1, append([]byte{0xf4, attempt.target}, u...))) == nil {
			t.Fatalf("unobserved gateway routine allowed: target=%02x payload=%s", attempt.target, attempt.payload)
		}
	}
}

func TestObservedBootmod3DMEReadBranchesAreForwardable(t *testing.T) {
	// Unique frames from the positive CustomROM path and the marker-miss
	// fallback. Repetitions are intentionally omitted; ordering is exercised by
	// the TASU session test.
	requests := []string{
		"f440310110010a0a43",
		"f4122c03f301",
		"f4122c02f30124807ffe5000ff",
		"f4122c02f301240977fe4c00ff",
		"f4122c02f30124801ffdac00ff",
		"f4122c02f301248005fe1e00ff",
		"f41222f301",
		"f41222f101",
		"f41231010205080000637532dc01",
		"f412310102050600004295012d01",
		"f41222f103",
		"f41822f101",
		"f41222f186",
		"f412224098",
		"f41022f190",
	}
	for _, body := range requests {
		b, e := hex.DecodeString(body)
		if e != nil {
			t.Fatal(e)
		}
		if e = checkRequest(frame(1, b)); e != nil {
			t.Fatalf("observed bootmod3 request blocked: %s: %v", body, e)
		}
	}
}

func TestLiveDMEReadEvidenceRequiresRequestedBackendReply(t *testing.T) {
	s := newService(defaults())
	pending := make(map[byte]byte)
	response := frame(1, []byte{0x12, 0xf4, 0x62, 0xf1, 0x01, 1})
	s.noteDMEReply(pending, response)
	if s.snapshot().DME.Identification != "" {
		t.Fatal("unsolicited data became evidence")
	}
	s.noteDMERequest(pending, frame(1, []byte{0xf4, 0x12, 0x22, 0xf1, 1}))
	s.noteDMEReply(pending, frame(1, []byte{0x10, 0xf4, 0x62, 0xf1, 1, 1}))
	s.noteDMEReply(pending, frame(1, []byte{0x12, 0xf5, 0x62, 0xf1, 1, 1}))
	s.noteDMEReply(pending, frame(1, []byte{0x12, 0xf4, 0x7f, 0x22, 0x31}))
	if s.snapshot().DME.Identification != "requested" {
		t.Fatal("wrong ECU/tester or negative reply verified DME")
	}
	s.noteDMEReply(pending, response)
	if s.snapshot().DME.Identification != "positive_reply" {
		t.Fatal("real reply not recorded")
	}
	s.noteDMERequest(pending, frame(1, []byte{0xf4, 0x10, 0x22, 0xf1, 0x90}))
	if s.snapshot().DME.ManufactureDate != "" || s.snapshot().DME.ROMMemory != "" {
		t.Fatal("VIN verified unrelated metadata")
	}
}
