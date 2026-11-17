package main

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"time"
)

// A separate local socket arbitrates complete request/reply transactions.
// Merely keeping an ENET connection or SOME/IP proxy open owns nothing.
func serveTASULock(ctx context.Context, ln net.Listener, lease string, gid int) {
	type waiter struct {
		conn net.Conn
		gone chan struct{}
	}
	queue := make(chan waiter, 32)
	go func() { <-ctx.Done(); ln.Close() }()
	go func() {
		defer func() {
			for w := range queue {
				w.conn.Close()
			}
		}()
		for {
			select {
			case <-ctx.Done():
				return
			case w, ok := <-queue:
				if !ok {
					return
				}
				if ctx.Err() != nil {
					w.conn.Close()
					return
				}
				select {
				case <-w.gone:
					w.conn.Close()
					continue
				default:
				}
				if writeLease(lease, gid) != nil {
					w.conn.Close()
					continue
				}
				w.conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
				_, e := io.WriteString(w.conn, "ready\n")
				if e == nil {
					tick := time.NewTicker(time.Second)
					deadline := time.NewTimer(90 * time.Second)
				owned:
					for {
						select {
						case <-ctx.Done():
							break owned
						case <-w.gone:
							break owned
						case <-deadline.C:
							break owned
						case <-tick.C:
							if writeLease(lease, gid) != nil {
								break owned
							}
						}
					}
					tick.Stop()
					deadline.Stop()
				}
				os.Remove(lease)
				w.conn.Close()
			}
		}
	}()
	defer close(queue)
	for {
		c, e := ln.Accept()
		if e != nil {
			return
		}
		w := waiter{c, make(chan struct{})}
		// EOF, unexpected input, and a crashed waiter all cancel ownership.
		go func() { var b [1]byte; c.Read(b[:]); close(w.gone) }()
		select {
		case queue <- w:
		case <-ctx.Done():
			c.Close()
			return
		default:
			c.Close() // bounded admission, never unbounded goroutines
		}
	}
}

func (s *service) startTASULock(ctx context.Context) error {
	file := filepath.Join(filepath.Dir(s.config.ControlSocket), "tasu-lock.sock")
	if info, e := os.Lstat(file); e == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return errors.New("TASU lock path is not a socket")
		}
		if c, e := net.DialTimeout("unix", file, 200*time.Millisecond); e == nil {
			c.Close()
			return errors.New("TASU lock already running")
		}
		if e := os.Remove(file); e != nil {
			return e
		}
	}
	ln, e := net.Listen("unix", file)
	if e != nil {
		return e
	}
	if e = os.Chown(file, 0, s.config.AppGID); e == nil {
		e = os.Chmod(file, 0660)
	}
	if e != nil {
		ln.Close()
		return e
	}
	lease := filepath.Join(filepath.Dir(file), "tasu-owner.json")
	os.Remove(lease) // a previous daemon cannot own this new socket
	go serveTASULock(ctx, ln, lease, s.config.AppGID)
	return nil
}
