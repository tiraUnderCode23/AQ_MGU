package main

import (
	"encoding/json"
	"mime"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestControlRoutesEnforceMethods(t *testing.T) {
	server := &patchServer{loc: testLoc(t, makeBinary(stockPattern), nil, false), root: true}
	handler := server.handler()

	for _, tc := range []struct {
		method, path, allow string
	}{
		{http.MethodGet, "/patch", http.MethodPost},
		{http.MethodGet, "/restore", http.MethodPost},
		{http.MethodPost, "/status", http.MethodGet},
	} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		var body map[string]string
		kind, _, _ := mime.ParseMediaType(w.Header().Get("Content-Type"))
		if w.Code != http.StatusMethodNotAllowed || w.Header().Get("Allow") != tc.allow ||
			kind != "application/json" || json.Unmarshal(w.Body.Bytes(), &body) != nil || body["error"] == "" {
			t.Fatalf("%s %s: got %d %v %s", tc.method, tc.path, w.Code, w.Header(), w.Body)
		}
	}

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/status", nil))
	var status Status
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &status) != nil ||
		status.Binary.State != stateStockVariant || status.BinaryBackup {
		t.Fatalf("unexpected status: %d %s", w.Code, w.Body)
	}
}

func TestControlRejectsInvalidWriteBodiesBeforeLocking(t *testing.T) {
	server := &patchServer{root: true}
	server.op.Lock()
	defer server.op.Unlock()
	for _, tc := range []struct {
		body string
		code int
	}{
		{"", http.StatusConflict},
		{"{}", http.StatusConflict},
		{"{} {}", http.StatusBadRequest},
		{"{} garbage", http.StatusBadRequest},
		{"null", http.StatusBadRequest},
		{`{"unexpected":true}`, http.StatusBadRequest},
		{"{}" + strings.Repeat(" ", 4096), http.StatusBadRequest},
	} {
		w := httptest.NewRecorder()
		handler := server.handler()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/restore", strings.NewReader(tc.body)))
		if w.Code != tc.code {
			t.Fatalf("body of %d bytes: got %d %s, want %d", len(tc.body), w.Code, w.Body, tc.code)
		}
	}
}
