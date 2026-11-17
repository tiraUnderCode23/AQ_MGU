package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func patchedFixture(original []byte) []byte {
	result := append([]byte(nil), original...)
	offset := bytes.Index(result, stockPattern)
	copy(result[offset:offset+len(patchedModulus)], patchedModulus)
	return result
}

func TestDetectionRejectsPartialKeyAndAmbiguousSites(t *testing.T) {
	partial := makeBinary(patchedModulus)
	partial[fixtureSite+200] ^= 1
	_, state, fp := scanBinary(partial)
	if state != statePatternMissing || fp != fingerprint(partial[fixtureSite:fixtureSite+256]) {
		t.Fatal("partial key was classified as fully patched or reported the wrong fingerprint")
	}
	duplicate := makeBinary(stockPattern)
	copy(duplicate[4096:], stockPattern)
	if _, state, _ := scanBinary(duplicate); state != statePatternMissing {
		t.Fatal("ambiguous patch sites were accepted")
	}
}

func TestAbsentSupportBlockRestoresAbsenceAcrossRetries(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), nil, false)
	// A stale backup must not override an explicitly recorded absence.
	if err := os.WriteFile(loc.BlockPath+blockBackupSuffix, []byte("old block"), 0644); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		status, err := applyPatch(loc)
		if err != nil || !status.BlockBackup {
			t.Fatalf("patch did not record original absence: %+v %v", status, err)
		}
		status, err = restoreBackup(loc)
		if err != nil || status.Block.State != blockAbsent || !status.RestartRequired {
			t.Fatalf("restore did not return to an absent block: %+v %v", status, err)
		}
		if _, err := os.Stat(loc.BlockPath); !os.IsNotExist(err) {
			t.Fatal("support block remains after restore", err)
		}
	}
}

func TestInterruptedPatchCanCompleteFromMatchingBackup(t *testing.T) {
	original := makeBinary(stockPattern)
	loc := testLoc(t, patchedFixture(original), []byte("original block"), true)
	if err := os.WriteFile(loc.BinaryPath+binaryBackupSuffix, original, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := applyPatch(loc); err != nil {
		t.Fatal("retry could not complete the support block", err)
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath+binaryBackupSuffix), original) {
		t.Fatal("retry changed the original binary backup")
	}
	if _, err := restoreBackup(loc); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath), original) ||
		!bytes.Equal(readBin(t, loc.BlockPath), []byte("original block")) {
		t.Fatal("retry did not retain restorable original data")
	}
}

func TestStaleBuildBackupIsReplacedAndForeignRestoreIsRefused(t *testing.T) {
	original := makeBinary(stockPattern)
	loc := testLoc(t, original, []byte("original block"), true)
	stale := append([]byte(nil), original...)
	stale[600] ^= 1
	if err := os.WriteFile(loc.BinaryPath+binaryBackupSuffix, stale, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath+binaryBackupSuffix), original) {
		t.Fatal("stale build backup was retained")
	}
	beforeBinary, beforeBlock := readBin(t, loc.BinaryPath), readBin(t, loc.BlockPath)
	if err := os.WriteFile(loc.BinaryPath+binaryBackupSuffix, stale, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := restoreBackup(loc); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("foreign build restore was accepted: %v", err)
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath), beforeBinary) || !bytes.Equal(readBin(t, loc.BlockPath), beforeBlock) {
		t.Fatal("invalid restore modified a live file")
	}
}

func TestInvalidBlockBackupFailsBeforeAnyLiveReplacement(t *testing.T) {
	original := makeBinary(stockPattern)
	loc := testLoc(t, original, []byte("original block"), true)
	if err := os.Mkdir(loc.BlockPath+blockBackupSuffix, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := applyPatch(loc); err == nil {
		t.Fatal("invalid block backup was ignored")
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath), original) ||
		!bytes.Equal(readBin(t, loc.BlockPath), []byte("original block")) {
		t.Fatal("failed backup changed live files")
	}
}

func TestMultiFileFailureRollsBackEarlierReplacement(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "first")
	if err := os.WriteFile(first, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	err := applyFileUpdates([]fileUpdate{
		{path: first, before: []byte("original"), after: []byte("replacement"), mode: 0644},
		{path: filepath.Join(dir, "missing", "second"), before: nil, after: []byte("data"), mode: 0644},
	})
	if err == nil || !bytes.Equal(readBin(t, first), []byte("original")) {
		t.Fatalf("earlier replacement was not rolled back: %v", err)
	}
	created := filepath.Join(dir, "created")
	err = applyFileUpdates([]fileUpdate{
		{path: created, before: nil, after: []byte("new"), mode: 0644},
		{path: filepath.Join(dir, "missing", "second"), before: nil, after: []byte("data"), mode: 0644},
	})
	if err == nil || fileExists(created) {
		t.Fatalf("rollback failed to restore absence: %v", err)
	}
}

func TestEmptyOriginalBlockIsPreservedAsAnEmptyFile(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), []byte{}, true)
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
	if _, err := restoreBackup(loc); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(loc.BlockPath)
	if err != nil || info.Size() != 0 {
		t.Fatal("empty original block became absent or changed", err)
	}
}

func TestHTTPRoutesPatchRestoreAndSerializeWrites(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), nil, false)
	server := &patchServer{loc: loc, root: true}
	handler := server.handler()
	for _, endpoint := range []string{"/patch", "/restore"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, endpoint, nil))
		var status Status
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &status) != nil || !status.RestartRequired {
			t.Fatalf("%s failed: %d %s", endpoint, w.Code, w.Body)
		}
	}
	server.op.Lock()
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/status", nil))
	server.op.Unlock()
	if w.Code != http.StatusConflict {
		t.Fatal("concurrent operation was accepted")
	}
	denied := &patchServer{loc: loc, root: false}
	w = httptest.NewRecorder()
	denied.handler().ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/patch", nil))
	if w.Code != http.StatusForbidden {
		t.Fatal("non-root write was accepted")
	}
}

func TestReplacementRequiresExpectedAbsence(t *testing.T) {
	name := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(name, []byte("existing"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := replaceFileSync(name, []byte("new"), 0644, nil); err == nil ||
		!bytes.Equal(readBin(t, name), []byte("existing")) {
		t.Fatal("unexpected existing file was replaced")
	}
}
