//go:build linux

package main

import (
	"bufio"
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTASULockQueuesDisconnectsAndReleases(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("lease ownership fixture requires root")
	}
	dir, e := os.MkdirTemp("/tmp", "tasu-lock-")
	if e != nil {
		t.Fatal(e)
	}
	defer os.RemoveAll(dir)
	file, lease := filepath.Join(dir, "lock.sock"), filepath.Join(dir, "owner.json")
	ln, e := net.Listen("unix", file)
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go serveTASULock(ctx, ln, lease, os.Getgid())
	dial := func() net.Conn {
		t.Helper()
		c, e := net.Dial("unix", file)
		if e != nil {
			t.Fatal(e)
		}
		return c
	}
	grant := func(c net.Conn) {
		t.Helper()
		c.SetReadDeadline(time.Now().Add(2 * time.Second))
		b, e := bufio.NewReader(c).ReadString('\n')
		if e != nil || b != "ready\n" {
			t.Fatal("missing grant", b, e)
		}
	}
	first := dial()
	defer first.Close()
	grant(first)
	if _, e = os.Stat(lease); e != nil {
		t.Fatal("transaction has no legacy marker", e)
	}
	cancelled := dial()
	cancelled.Close()
	second := dial()
	defer second.Close()
	second.SetReadDeadline(time.Now().Add(30 * time.Millisecond))
	var b [1]byte
	if _, e = second.Read(b[:]); e == nil {
		t.Fatal("overlapping transaction granted")
	}
	first.Close()
	grant(second)
	// A crashed owner releases its turn without an explicit protocol message.
	second.Close()
	third := dial()
	defer third.Close()
	grant(third)
	cancel()
	third.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, e = third.Read(b[:]); e == nil {
		t.Fatal("shutdown retained owner")
	}
	deadline := time.Now().Add(time.Second)
	for {
		_, e = os.Stat(lease)
		if os.IsNotExist(e) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("shutdown leaked marker", e)
		}
		time.Sleep(time.Millisecond)
	}
}
