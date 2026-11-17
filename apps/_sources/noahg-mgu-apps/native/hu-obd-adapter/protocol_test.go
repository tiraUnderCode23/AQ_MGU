package main

import (
	"bytes"
	"encoding/binary"
	"io"
	"testing"
)

type fragments struct{ b []byte }

func (r *fragments) Read(p []byte) (int, error) {
	if len(r.b) == 0 {
		return 0, io.EOF
	}
	p[0] = r.b[0]
	r.b = r.b[1:]
	return 1, nil
}

func TestHSFZStream(t *testing.T) {
	a := frame(1, []byte{0xf4, 0x12, 0x22, 0xf1, 0x90})
	b := frame(0x43, nil)
	r := &fragments{append(append([]byte(nil), a...), b...)}
	for _, want := range [][]byte{a, b} {
		got, e := readFrame(r)
		if e != nil || !bytes.Equal(got, want) {
			t.Fatalf("frame mismatch: %x %v", got, e)
		}
	}
	if _, e := readFrame(r); e != io.EOF {
		t.Fatal(e)
	}
	for _, bad := range [][]byte{{0, 0, 0}, {0, 0, 0, 1, 0, 1, 0xf4}, {0, 0x10, 0, 1, 0, 1}, a[:len(a)-1]} {
		if _, e := readFrame(bytes.NewReader(bad)); e == nil {
			t.Fatalf("accepted malformed frame %x", bad)
		}
	}
}

func testIdentification() []byte {
	return frame(0x11, []byte("DIAGADR80BMWMAC001122334455BMWVINWBA12345678901234"))
}

func TestDiscoveryIdentification(t *testing.T) {
	vin, ok := identification(testIdentification())
	if !ok || vin != "WBA12345678901234" {
		t.Fatal(vin, ok)
	}
	for _, bad := range [][]byte{discoveryProbe, frame(1, []byte("BMWVINWBA12345678901234")), frame(0x11, []byte("BMWVINshort")), frame(0x11, []byte("BMWVINWBA1234567890123Q"))} {
		if _, ok := identification(bad); ok {
			t.Fatalf("accepted %x", bad)
		}
	}
	b := testIdentification()
	binary.BigEndian.PutUint32(b, 0)
	if _, ok := identification(b); ok {
		t.Fatal("length mismatch accepted")
	}
}

func TestDevelopmentCapabilityPolicy(t *testing.T) {
	for _, sid := range []byte{1, 9, 0x19, 0x1a, 0x21, 0x22, 0x3e} {
		if e := checkRequest(frame(1, []byte{0xf4, 0x12, sid, 0})); e != nil {
			t.Fatal(e)
		}
	}
	for _, sid := range []byte{0x10, 0x11, 0x14, 0x23, 0x27, 0x28, 0x2c, 0x2e, 0x2f, 0x31, 0x34, 0x36, 0x37, 0x85} {
		if checkRequest(frame(1, []byte{0xf4, 0x12, sid, 0})) == nil {
			t.Fatalf("unvalidated service %x permitted", sid)
		}
	}
	for _, uds := range [][]byte{{0x10, 1}, {0x10, 3}, {0x10, 0x83}, {0x3e, 0}, {0x3e, 0x80}} {
		if e := checkRequest(frame(1, append([]byte{0xf4, 0x12}, uds...))); e != nil {
			t.Fatal(e)
		}
	}
	for _, uds := range [][]byte{{0x10, 2}, {0x10, 0x82}, {0x10, 3, 0}, {0x3e, 1}} {
		if checkRequest(frame(1, append([]byte{0xf4, 0x12}, uds...))) == nil {
			t.Fatal("unsafe session accepted", uds)
		}
	}
	if checkRequest(frame(1, []byte{0x12, 0x12, 0x22, 0})) == nil {
		t.Fatal("ECU used as tester")
	}
	if checkRequest(frame(1, []byte{0xf4, 0x12})) == nil {
		t.Fatal("empty request")
	}
	if checkRequest(frame(0x11, nil)) == nil {
		t.Fatal("TCP discovery accepted")
	}
}

func TestConfigValidation(t *testing.T) {
	c := defaults()
	if e := c.validate(); e != nil {
		t.Fatal(e)
	}
	for _, mutate := range []func(*config){
		func(c *config) { c.HotspotInterface = "" }, func(c *config) { c.VehicleInterfaces = []string{c.HotspotInterface} },
		func(c *config) { c.HotspotInterface = "wlan0;id" }, func(c *config) { c.TCPPort = 0 },
		func(c *config) { c.DiscoveryTimeoutMS = 0 }, func(c *config) { c.ControlSocket = "relative.sock" },
	} {
		c := defaults()
		mutate(&c)
		if c.validate() == nil {
			t.Fatal("invalid config accepted")
		}
	}
}

func FuzzHSFZ(f *testing.F) {
	f.Add(frame(1, []byte{0xf4, 0x12, 0x22, 0xf1, 0x90}))
	f.Add(discoveryProbe)
	f.Fuzz(func(t *testing.T, b []byte) {
		got, e := readFrame(bytes.NewReader(b))
		if e == nil {
			if len(got) < 6 || len(got) > maxFrame+6 {
				t.Fatal("unbounded frame")
			}
			checkRequest(got)
			identification(got)
		}
	})
}
