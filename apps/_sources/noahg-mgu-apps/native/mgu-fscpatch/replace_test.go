package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReplacementRefusesChangedBinaryAndCleansTemporaryFile(t *testing.T) {
	dir := t.TempDir()
	name := filepath.Join(dir, "binary")
	original := []byte("current binary")
	if err := os.WriteFile(name, original, 0755); err != nil {
		t.Fatal(err)
	}
	err := replaceFileSync(name, []byte("replacement"), 0755, []byte("older binary"))
	if err == nil || !strings.Contains(err.Error(), "changed during verification") {
		t.Fatalf("expected a refusal for a changed binary, got %v", err)
	}
	if !bytes.Equal(readBin(t, name), original) {
		t.Fatal("a changed binary was overwritten")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != "binary" {
		t.Fatalf("temporary replacement left behind: %v %v", entries, err)
	}
}
