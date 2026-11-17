package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fixtureSite = 0x100

// makeBinary builds a plausible BAC4x stand-in: deterministic filler bytes
// with an optional patch site at fixtureSite carrying site bytes (the stock
// pattern by default).
func makeBinary(site []byte) []byte {
	data := make([]byte, 8192)
	for i := range data {
		data[i] = byte(i*7 + 3)
	}
	copy(data[fixtureSite:fixtureSite+len(site)], site)
	return data
}

func testLoc(t *testing.T, binary []byte, block []byte, withBlock bool) Locations {
	t.Helper()
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "BAC4x_VSTAR_i386_Eth_Application.out")
	if err := os.WriteFile(binaryPath, binary, 0644); err != nil {
		t.Fatal(err)
	}
	loc := Locations{BinaryPath: binaryPath, BlockPath: filepath.Join(dir, "block_352"), Remount: false, patchBinary: func(b []byte) ([]byte, error) { return patchedFixture(b), nil }, mergeBlock: func(_, _ []byte) ([]byte, error) { return block352, nil }}
	if withBlock {
		if err := os.MkdirAll(filepath.Dir(loc.BlockPath), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(loc.BlockPath, block, 0644); err != nil {
			t.Fatal(err)
		}
	}
	return loc
}

func readBin(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestInspectClassifiesStockVariantAndPatched(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), nil, false)
	st, err := inspectBinary(loc)
	if err != nil {
		t.Fatal(err)
	}
	if st.State != stateStockVariant || st.Offset != fixtureSite || !st.Present {
		t.Fatalf("unexpected stock-variant classification: %+v", st)
	}
	if st.ModulusSHA256 == "" || st.SHA256 == "" {
		t.Fatalf("missing fingerprints: %+v", st)
	}

	loc = testLoc(t, makeBinary(patchedModulus), nil, false)
	st, err = inspectBinary(loc)
	if err != nil {
		t.Fatal(err)
	}
	if st.State != statePatched || st.Offset != fixtureSite {
		t.Fatalf("unexpected patched classification: %+v", st)
	}

	loc = testLoc(t, makeBinary(bytes.Repeat([]byte{0xAA}, 300)), nil, false)
	st, err = inspectBinary(loc)
	if err != nil {
		t.Fatal(err)
	}
	if st.State != statePatternMissing || st.Offset != -1 {
		t.Fatalf("unexpected pattern-missing classification: %+v", st)
	}
}

func TestInspectBlockStates(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), []byte("original block"), true)
	block, err := inspectBlock(loc)
	if err != nil {
		t.Fatal(err)
	}
	if block.State != blockOther || !block.Present {
		t.Fatalf("unexpected other classification: %+v", block)
	}
	if err := os.WriteFile(loc.BlockPath, block352, 0644); err != nil {
		t.Fatal(err)
	}
	block, err = inspectBlock(loc)
	if err != nil {
		t.Fatal(err)
	}
	if block.State != statePatched || block.SHA256 != fingerprint(block352) {
		t.Fatalf("unexpected patched classification: %+v", block)
	}
}

func TestPatchRoundTripAndRestore(t *testing.T) {
	original := makeBinary(stockPattern)
	originalBlock := []byte("original block content")
	loc := testLoc(t, original, originalBlock, true)

	patched, err := applyPatch(loc)
	if err != nil {
		t.Fatal(err)
	}
	if !patched.RestartRequired || patched.Message == "" {
		t.Fatalf("patch result should demand a restart: %+v", patched)
	}
	now := readBin(t, loc.BinaryPath)
	if !bytes.Equal(now[fixtureSite:fixtureSite+256], patchedModulus) {
		t.Fatal("binary does not carry the patched modulus")
	}
	if !bytes.Equal(now[:fixtureSite], original[:fixtureSite]) || !bytes.Equal(now[fixtureSite+256:], original[fixtureSite+256:]) {
		t.Fatal("patch touched bytes outside the modulus")
	}
	backup, err := os.ReadFile(loc.BinaryPath + binaryBackupSuffix)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(backup, original) {
		t.Fatal("binary backup is not the pristine stock content")
	}
	block, err := os.ReadFile(loc.BlockPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(block, block352) {
		t.Fatal("support block was not installed")
	}
	if blockBackup, err := os.ReadFile(loc.BlockPath + blockBackupSuffix); err != nil || !bytes.Equal(blockBackup, originalBlock) {
		t.Fatal("support block backup missing or wrong")
	}
	if _, err := os.Stat(loc.BlockPath + ".new"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("temporary block file left behind")
	}

	// Second patch must refuse.
	if _, err := applyPatch(loc); err == nil || err.Error() != "already patched; nothing to do" {
		t.Fatalf("expected already-patched refusal, got: %v", err)
	}

	restored, err := restoreBackup(loc)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(restored.Message, "Restored binary and support block") || !restored.RestartRequired {
		t.Fatalf("unexpected restore message: %q", restored.Message)
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath), original) {
		t.Fatal("binary was not restored byte-for-byte")
	}
	if !bytes.Equal(readBin(t, loc.BlockPath), originalBlock) {
		t.Fatal("support block was not restored")
	}
}

func TestPatchRefusesIncompatibleBuild(t *testing.T) {
	loc := testLoc(t, makeBinary(bytes.Repeat([]byte{0x55}, 300)), nil, false)
	_, err := applyPatch(loc)
	if err == nil || err.Error() != "stock pattern not found; this BAC4x build is incompatible and needs the matching-SWFL flow" {
		t.Fatalf("expected incompatible-build refusal, got: %v", err)
	}
	loc2 := Locations{BinaryPath: filepath.Join(t.TempDir(), "absent.out"), BlockPath: filepath.Join(t.TempDir(), "block_352"), Remount: false}
	if _, err := applyPatch(loc2); err == nil {
		t.Fatal("expected missing-binary error")
	}
}

func TestPatchRefusesDriftedSite(t *testing.T) {
	// A binary whose pattern prefix is present only in part at the site must
	// not be classified patchable; scanBinary gates on the full pattern.
	drifted := makeBinary(stockPattern)
	copy(drifted[fixtureSite+30:fixtureSite+40], bytes.Repeat([]byte{0x11}, 10))
	loc := testLoc(t, drifted, nil, false)
	_, err := applyPatch(loc)
	if err == nil {
		t.Fatal("expected refusal for a drifted patch site")
	}
}

func TestPatchKeepsPristineBackupAndReplacesForeignOne(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), nil, false)
	// A foreign "backup" without the stock pattern must be replaced.
	if err := os.WriteFile(loc.BinaryPath+binaryBackupSuffix, []byte("garbage"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
	backup, err := os.ReadFile(loc.BinaryPath + binaryBackupSuffix)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Index(backup, stockPattern) < 0 {
		t.Fatal("backup was not replaced with pristine stock content")
	}

	// Re-patching from stock again must keep the existing pristine backup.
	loc = testLoc(t, makeBinary(stockPattern), nil, false)
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
	pristine := readBin(t, loc.BinaryPath+binaryBackupSuffix)
	if _, err := restoreBackup(loc); err != nil {
		t.Fatal(err)
	}
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath+binaryBackupSuffix), pristine) {
		t.Fatal("pristine backup was clobbered by a re-patch")
	}
}

func TestRestoreRefusals(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), nil, false)
	if _, err := restoreBackup(loc); err == nil || err.Error() != "no backup present; nothing to restore" {
		t.Fatalf("expected no-backup refusal, got: %v", err)
	}
	// A backup without the stock pattern is refused.
	if err := os.WriteFile(loc.BinaryPath+binaryBackupSuffix, []byte("garbage"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := restoreBackup(loc); err == nil || err.Error() != "binary backup does not contain the stock pattern; refusing to restore it" {
		t.Fatalf("expected garbage-backup refusal, got: %v", err)
	}
}

func TestPatchSkipsAlreadyPatchedBlock(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), block352, true)
	status, err := applyPatch(loc)
	if err != nil {
		t.Fatal(err)
	}
	if status.Block.State != statePatched {
		t.Fatalf("block should stay patched: %+v", status.Block)
	}
	if status.BlockBackup {
		t.Fatal("no backup should be created for an already-patched block")
	}
}
