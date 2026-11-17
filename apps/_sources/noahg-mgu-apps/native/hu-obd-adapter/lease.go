package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// Legacy readers see ownership only during a complete diagnostic transaction.
// Updated app-kit callers queue on tasu-lock.sock instead of refusing work.
func writeLease(file string, gid int) error {
	b, _ := json.Marshal(map[string]interface{}{"expiresAt": time.Now().Add(5 * time.Second).UnixMilli(), "coordinated": true})
	f, e := os.CreateTemp(filepath.Dir(file), "tasu-*.tmp")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if e = f.Chmod(0640); e != nil {
		f.Close()
		return e
	}
	if e = f.Chown(0, gid); e != nil {
		f.Close()
		return e
	}
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	return os.Rename(f.Name(), file)
}
