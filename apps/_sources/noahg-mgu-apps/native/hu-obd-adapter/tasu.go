package main

import (
	"bufio"
	"context"
	_ "embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed tasu-worker.js
var tasuWorker string

//go:embed tasu-lock.js
var tasuLockWorker string

type tasuSession struct {
	cmd    *exec.Cmd
	input  io.WriteCloser
	frames chan []byte
	done   chan struct{}
	mu     sync.Mutex
	closed sync.Once
	err    error
}

var errVINBatchDone = errors.New("functional VIN response window completed")

func installedApp(root string) (string, int, error) {
	entries, e := os.ReadDir(root)
	if e != nil {
		return "", 0, tasuFailure("helper_not_installed")
	}
	var found string
	var uid int
	matched := false
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "oap_") {
			continue
		}
		n, e := strconv.Atoi(strings.TrimPrefix(entry.Name(), "oap_"))
		if e != nil || n < 1000 {
			continue
		}
		p := filepath.Join(root, entry.Name())
		var pkg struct {
			Name string `json:"name"`
		}
		b, e := os.ReadFile(filepath.Join(p, "source", "package.json"))
		if e != nil || json.Unmarshal(b, &pkg) != nil || pkg.Name != "noahg_obdbridge" {
			continue
		}
		matched = true
		cfg := filepath.Join(p, "someipInterfaces", "com_harman_infotainment_systemfunctions_tasu_tasu_InternalTasu.json")
		if _, e = os.Stat(cfg); e != nil {
			continue
		}
		if found != "" {
			return "", 0, tasuFailure("multiple_helpers")
		}
		found = p
		uid = n
	}
	if found == "" {
		if matched {
			return "", 0, tasuFailure("config_missing")
		}
		return "", 0, tasuFailure("helper_not_installed")
	}
	return found, uid, nil
}

func (s *service) openTASU(ctx context.Context) (vehicle, error) {
	root, uid, e := installedApp(s.config.OAPDirectory)
	if e != nil {
		return nil, e
	}
	worker := "const sharedTASU = (function(){const module={exports:{}};\n" + tasuLockWorker + "\nreturn module.exports;})();\n" + tasuWorker
	cmd := exec.CommandContext(ctx, "/usr/bin/node", "-e", worker, root)
	cmd.Dir = filepath.Join(root, "source")
	cmd.Env = append(os.Environ(), "HOME="+filepath.Join(root, "data"))
	cmd.Env = append(cmd.Env, "HUOBD_TASU_LOCK_SOCKET="+filepath.Join(filepath.Dir(s.config.ControlSocket), "tasu-lock.sock"))
	if e = workerCredentials(cmd, uid, s.config.AppGID, s.config.OAPDirectory, root); e != nil {
		return nil, e
	}
	in, e := cmd.StdinPipe()
	if e != nil {
		return nil, e
	}
	out, e := cmd.StdoutPipe()
	if e != nil {
		in.Close()
		return nil, e
	}
	// Native module output is never exported: it may contain vehicle identity.
	cmd.Stderr = io.Discard
	if e = cmd.Start(); e != nil {
		in.Close()
		out.Close()
		return nil, workerStartFailure(e)
	}
	t := &tasuSession{cmd: cmd, input: in, frames: make(chan []byte, 32), done: make(chan struct{})}
	ready := make(chan bool, 1)
	outputDone := make(chan struct{})
	go func() {
		defer close(outputDone)
		scan := bufio.NewScanner(out)
		scan.Buffer(make([]byte, 4096), 2*maxFrame+1024)
		for scan.Scan() {
			line := scan.Text()
			if !strings.HasPrefix(line, "HUOBD:") {
				continue
			}
			var m workerMessage
			if json.Unmarshal([]byte(line[6:]), &m) != nil {
				t.stop(errors.New("malformed TASU worker message"))
				return
			}
			switch m.Type {
			case "tasu_trace":
				s.observeTASU(m)
			case "ready":
				select {
				case ready <- true:
				default:
				}
			case "probe_done":
				select {
				case t.frames <- nil:
				case <-t.done:
					return
				}
			case "frame":
				b, e := hex.DecodeString(m.Hex)
				if e != nil || len(b) < 6 || len(b) > maxFrame+6 || int(binary.BigEndian.Uint32(b)) != len(b)-6 {
					t.stop(errors.New("malformed TASU frame"))
					return
				}
				select {
				case t.frames <- b:
				case <-t.done:
					return
				default:
					t.stop(errors.New("TASU response queue exhausted"))
					return
				}
			case "error":
				t.stop(tasuFailure(tasuErrorCode(tasuFailure(m.Code))))
				return
			}
		}
		t.stop(tasuFailure("worker_exited"))
	}()
	go func() {
		// Consume protocol output before Wait closes its pipe, preserving a
		// specific startup failure emitted immediately before process exit.
		<-outputDone
		cmd.Wait()
		t.stop(tasuFailure("worker_exited"))
	}()
	select {
	case <-ready:
		s.record("tasu_helper_ready")
		return t, nil
	case <-t.done:
		t.mu.Lock()
		e := t.err
		t.mu.Unlock()
		return nil, e
	case <-ctx.Done():
		t.Close()
		return nil, ctx.Err()
	case <-time.After(8 * time.Second):
		t.Close()
		return nil, tasuFailure("availability_timeout")
	}
}

func (t *tasuSession) stop(e error) {
	t.closed.Do(func() {
		t.mu.Lock()
		t.err = e
		close(t.done)
		t.mu.Unlock()
		t.input.Close()
		if t.cmd.Process != nil {
			t.cmd.Process.Kill()
		}
	})
}
func (t *tasuSession) Close() error { t.stop(io.EOF); return nil }
func (t *tasuSession) ReadFrame() ([]byte, error) {
	b, e := t.readFrame()
	if e == nil && b == nil {
		return nil, errVINBatchDone
	}
	return b, e
}

func (t *tasuSession) readFrame() ([]byte, error) {
	// Preserve pipe ordering when a worker exits after emitting its final
	// response. A closed done channel must not win over buffered frames.
	select {
	case b := <-t.frames:
		return b, nil
	default:
	}
	select {
	case b := <-t.frames:
		return b, nil
	case <-t.done:
		select {
		case b := <-t.frames:
			return b, nil
		default:
		}
		t.mu.Lock()
		defer t.mu.Unlock()
		return nil, t.err
	}
}

func (t *tasuSession) WriteVINRequest(target byte) error {
	b := frame(1, []byte{0xf4, target, 0x22, 0xf1, 0x90})
	if target != 0xdf {
		return t.WriteFrame(b)
	}
	v, _ := json.Marshal(map[string]interface{}{"hex": hex.EncodeToString(b), "reportComplete": true})
	return writeAll(t.input, append(v, '\n'))
}
func (t *tasuSession) WriteFrame(b []byte) error {
	select {
	case <-t.done:
		return io.ErrClosedPipe
	default:
	}
	if len(b) >= 6 && binary.BigEndian.Uint16(b[4:]) == 0x12 {
		return nil
	}
	v, _ := json.Marshal(map[string]string{"hex": hex.EncodeToString(b)})
	return writeAll(t.input, append(v, '\n'))
}
