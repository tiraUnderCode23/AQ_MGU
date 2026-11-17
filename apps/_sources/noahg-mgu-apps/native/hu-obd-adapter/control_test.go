package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestControlEnabledStateAndRedactedExport(t *testing.T) {
	c := defaults()
	c.StateFile = filepath.Join(t.TempDir(), "settings.json")
	s := newService(c)
	h := s.controlHandler()
	for _, body := range []string{`{}`, `{"enabled":null}`, `{"enabled":"false"}`, `{"enabled":false,"command":"run"}`, `{"enabled":false} {}`} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/enabled", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatal(w.Code, body)
		}
	}
	for _, enabled := range []bool{false, true} {
		b, _ := json.Marshal(map[string]bool{"enabled": enabled})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/enabled", bytes.NewReader(b)))
		if w.Code != 200 || s.snapshot().Enabled != enabled {
			t.Fatal(w.Code, w.Body.String())
		}
		other := newService(c)
		if e := other.loadState(); e != nil || other.snapshot().Enabled != enabled {
			t.Fatal("state not durable", e)
		}
	}
	s.current = gateway{Identification: testIdentification()}
	s.record("client_connected")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/export", nil))
	if w.Code != 200 || strings.Contains(w.Body.String(), "WBA12345678901234") || !strings.Contains(w.Body.String(), "client_connected") {
		t.Fatal(w.Body.String())
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/enabled", nil))
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/probe", nil))
	if w.Code != 409 {
		t.Fatal("probe without hotspot")
	}
	for i := 0; i < 150; i++ {
		s.record("bounded")
	}
	if len(s.events) != 100 {
		t.Fatal("unbounded event log")
	}
}

func TestBadStateDoesNotSilentlyEnable(t *testing.T) {
	c := defaults()
	c.StateFile = filepath.Join(t.TempDir(), "settings.json")
	for _, text := range []string{`{}`, `bad json`, `{"enabled":null}`} {
		os.WriteFile(c.StateFile, []byte(text), 0600)
		if newService(c).loadState() == nil {
			t.Fatal("corrupt enabled state accepted")
		}
	}
}
