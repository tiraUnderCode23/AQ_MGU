package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func (s *service) loadState() error {
	b, e := os.ReadFile(s.config.StateFile)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	var v struct {
		Enabled *bool `json:"enabled"`
	}
	if e = json.Unmarshal(b, &v); e != nil {
		return e
	}
	if v.Enabled == nil {
		return errors.New("missing enabled state")
	}
	s.status.Enabled = *v.Enabled
	return nil
}

func (s *service) setEnabled(enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := os.MkdirAll(filepath.Dir(s.config.StateFile), 0750); e != nil {
		return e
	}
	b, _ := json.Marshal(map[string]bool{"enabled": enabled})
	f, e := os.CreateTemp(filepath.Dir(s.config.StateFile), "settings-*.tmp")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Rename(f.Name(), s.config.StateFile); e != nil {
		return e
	}
	s.status.Enabled = enabled
	if !enabled && s.cancelListeners != nil {
		s.cancelListeners()
		s.cancelListeners = nil
	}
	if !enabled && s.client != nil {
		s.client.Close()
	}
	if !enabled {
		s.status.State = "disabled"
		s.status.Address = ""
	}
	return nil
}

func (s *service) controlHandler() http.Handler {
	mux := http.NewServeMux()
	respond := func(w http.ResponseWriter, code int, v interface{}) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		json.NewEncoder(w).Encode(v)
	}
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		respond(w, 200, s.snapshot())
	})
	mux.HandleFunc("/enabled", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		var v struct {
			Enabled *bool `json:"enabled"`
		}
		d := json.NewDecoder(io.LimitReader(r.Body, 1024))
		d.DisallowUnknownFields()
		if d.Decode(&v) != nil || v.Enabled == nil || d.Decode(new(interface{})) != io.EOF {
			respond(w, 400, map[string]string{"error": "enabled boolean required"})
			return
		}
		if e := s.setEnabled(*v.Enabled); e != nil {
			respond(w, 500, map[string]string{"error": "cannot persist setting"})
			return
		}
		respond(w, 200, s.snapshot())
	})
	mux.HandleFunc("/probe", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		st := s.snapshot()
		if !st.Enabled || st.Client || st.Address == "" {
			respond(w, 409, map[string]string{"error": "adapter disabled, hotspot unavailable, or client active"})
			return
		}
		if _, e := s.probe(r.Context(), true); e != nil {
			if errors.Is(e, errDiagnosticClientActive) {
				respond(w, 409, map[string]string{"error": "diagnostic client active"})
				return
			}
			message := "No unique vehicle diagnostic gateway answered"
			if errors.Is(e, errVehicleUnavailable) {
				message = "Neither the ENET gateway nor a TASU VIN read answered"
			}
			if errors.Is(e, errFirewall) {
				message = "Vehicle diagnostic firewall access failed"
			}
			respond(w, 503, map[string]string{"error": message})
			return
		}
		respond(w, 200, s.snapshot())
	})
	mux.HandleFunc("/export", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		st := s.snapshot()
		s.mu.Lock()
		events := append([]event(nil), s.events...)
		operations := append([]diagnosticOperation(nil), s.operations...)
		s.mu.Unlock()
		respond(w, 200, map[string]interface{}{"status": st, "events": events, "operations": operations, "identifiersRedacted": true})
	})
	return mux
}

func (s *service) startControl(ctx context.Context) error {
	dir := filepath.Dir(s.config.ControlSocket)
	if e := os.MkdirAll(dir, 0750); e != nil {
		return e
	}
	if e := os.Chown(dir, 0, s.config.AppGID); e != nil {
		return e
	}
	if e := os.Chmod(dir, 0750); e != nil {
		return e
	}
	if info, e := os.Lstat(s.config.ControlSocket); e == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return errors.New("control path is not a socket")
		}
		if c, e := net.DialTimeout("unix", s.config.ControlSocket, 200*time.Millisecond); e == nil {
			c.Close()
			return errors.New("adapter already running")
		}
		if e = os.Remove(s.config.ControlSocket); e != nil {
			return e
		}
	}
	ln, e := net.Listen("unix", s.config.ControlSocket)
	if e != nil {
		return e
	}
	if e = os.Chown(s.config.ControlSocket, 0, s.config.AppGID); e != nil {
		ln.Close()
		return e
	}
	if e = os.Chmod(s.config.ControlSocket, 0660); e != nil {
		ln.Close()
		return e
	}
	if e = s.startTASULock(ctx); e != nil {
		ln.Close()
		return e
	}
	server := &http.Server{Handler: s.controlHandler(), ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 100 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 4096}
	go func() { <-ctx.Done(); server.Close() }()
	go server.Serve(ln)
	return nil
}
