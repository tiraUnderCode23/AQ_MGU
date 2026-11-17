package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

type patchServer struct {
	op      sync.Mutex
	loc     Locations
	root    bool
	restart func() error
}

func (s *patchServer) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		fail := func(code int, message string) {
			w.WriteHeader(code)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
		}

		var method string
		switch r.URL.Path {
		case "/status":
			method = http.MethodGet
		case "/patch", "/restore", "/restart":
			method = http.MethodPost
		default:
			fail(http.StatusNotFound, "unknown request")
			return
		}
		if r.Method != method {
			w.Header().Set("Allow", method)
			fail(http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		if method == http.MethodPost {
			d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
			d.DisallowUnknownFields()
			var in *struct{}
			err := d.Decode(&in)
			// Existing clients send an empty body. Also accept exactly one empty object.
			if err != io.EOF && (err != nil || in == nil || d.Decode(&in) != io.EOF) {
				fail(http.StatusBadRequest, "invalid request")
				return
			}
			if !s.root {
				fail(http.StatusForbidden, "FSC patch service requires root")
				return
			}
		}
		if !s.op.TryLock() {
			fail(http.StatusConflict, "Another operation is in progress")
			return
		}
		defer s.op.Unlock()

		var result Status
		var err error
		switch r.URL.Path {
		case "/status":
			result, err = fullStatus(s.loc)
		case "/patch":
			result, err = applyPatch(s.loc)
		case "/restore":
			result, err = restoreBackup(s.loc)
		case "/restart":
			restart := s.restart
			if restart == nil {
				restart = requestHeadUnitRestart
			}
			err = restart()
			result = Status{Version: toolVersion, Message: "Restart requested"}
		}
		if err != nil {
			fail(http.StatusBadRequest, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(result)
	})
}

func openControlSocket(socket string, gid int) (net.Listener, error) {
	directory := filepath.Dir(socket)
	if err := os.MkdirAll(directory, 0750); err != nil {
		return nil, err
	}
	if err := os.Chown(directory, 0, gid); err != nil {
		return nil, err
	}
	if err := os.Chmod(directory, 0750); err != nil {
		return nil, err
	}
	if info, err := os.Lstat(socket); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, errors.New("control path is not a socket")
		}
		connection, err := net.DialTimeout("unix", socket, time.Second)
		if err == nil {
			connection.Close()
			return nil, errors.New("FSC patch service is already running")
		}
		if !errors.Is(err, syscall.ECONNREFUSED) {
			return nil, fmt.Errorf("cannot check existing control socket: %w", err)
		}
		if err := os.Remove(socket); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return nil, err
	}
	if err := os.Chown(socket, 0, gid); err != nil {
		listener.Close()
		return nil, err
	}
	if err := os.Chmod(socket, 0660); err != nil {
		listener.Close()
		return nil, err
	}
	return listener, nil
}

func main() {
	socket := flag.String("socket", "/run/mgu-fscpatch/control.sock", "control socket")
	gid := flag.Int("app-gid", 12202, "OAP application group")
	commit := flag.Bool("commit-block", false, "commit staged support block before verifier startup")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(toolVersion)
		return
	}
	if os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "FSC patch service requires root for head-unit file access")
		os.Exit(1)
	}
	if *commit {
		if err := commitPendingBlock(unitLocations()); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	s := &patchServer{loc: unitLocations(), root: true}
	ln, e := openControlSocket(*socket, *gid)
	if e != nil {
		panic(e)
	}
	defer ln.Close()
	server := &http.Server{Handler: s.handler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 60 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 4096}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	done := make(chan struct{})
	go func() {
		defer close(done)
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
		_ = server.Shutdown(ctx)
		cancel()
	}()
	if e = server.Serve(ln); e != nil && e != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, "FSC patch control service stopped")
		os.Exit(1)
	}
	<-done
}
