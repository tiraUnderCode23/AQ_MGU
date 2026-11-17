package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func emptyBlock() []byte { return make([]byte, slotCount*slotSize) }
func certificateSlot(id uint16, upgrade uint16, payload string) []byte {
	s := make([]byte, slotSize)
	binary.BigEndian.PutUint16(s[8:], id)
	binary.BigEndian.PutUint16(s[10:], upgrade)
	copy(s[12:], payload)
	binary.LittleEndian.PutUint16(s[fscLengthOffset:], uint16(len(payload)))
	return s
}
func TestMergePreservesFactoryAndRecoversBackupCertificates(t *testing.T) {
	current := emptyBlock()
	factory := certificateSlot(0x173, 1, "current factory certificate")
	copy(current[7*slotSize:], factory)
	backup := emptyBlock()
	copy(backup, certificateSlot(0x173, 1, "older factory certificate"))
	recovered := certificateSlot(0x154, 1, "original factory certificate")
	copy(backup[slotSize:], recovered)
	merged, err := mergeSupportBlock(current, backup)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(merged[7*slotSize:8*slotSize], factory) || !bytes.Contains(merged, recovered) {
		t.Fatal("factory records lost or overwritten")
	}
	if !supportConfigured(merged) {
		t.Fatal("merged configuration not recognized")
	}
	again, err := mergeSupportBlock(merged, backup)
	if err != nil || !bytes.Equal(again, merged) {
		t.Fatal("merge not idempotent", err)
	}
}
func TestMergeRefusesFullOrMalformedBlockWithoutMutatingIt(t *testing.T) {
	full := emptyBlock()
	for i := 0; i < slotCount; i++ {
		copy(full[i*slotSize:], certificateSlot(uint16(0x700+i), 1, "OEM certificate"))
	}
	before := append([]byte(nil), full...)
	if _, err := mergeSupportBlock(full, nil); err == nil {
		t.Fatal("full block accepted")
	}
	if !bytes.Equal(before, full) {
		t.Fatal("input changed")
	}
	if _, err := mergeSupportBlock([]byte("unexpected layout"), nil); err == nil {
		t.Fatal("invalid layout accepted")
	}
	binary.LittleEndian.PutUint16(full[fscLengthOffset:], 500)
	if _, err := mergeSupportBlock(full, nil); err == nil {
		t.Fatal("invalid certificate length accepted")
	}
}
func TestStrictDualProfileAndTamperDetection(t *testing.T) {
	stock := make([]byte, dualStockSize)
	copy(stock[dualNote:], dualOriginalNote)
	copy(stock[dualEntry:], dualPrologue)
	hash := fingerprint(stock)
	patched, err := buildDualProfile(stock, hash)
	if err != nil {
		t.Fatal(err)
	}
	restored, ok := dualOriginalProfile(patched, hash)
	if !ok || !bytes.Equal(restored, stock) {
		t.Fatal("normalization failed")
	}
	if binary.LittleEndian.Uint32(patched[dualNote:]) != 1 || binary.LittleEndian.Uint32(patched[dualNote+4:]) != 5 {
		t.Fatal("payload not mapped RX")
	}
	patched[dualFile+30] ^= 1
	if _, ok := dualOriginalProfile(patched, hash); ok {
		t.Fatal("corrupt payload accepted")
	}
	if _, err := buildDual(stock); err == nil {
		t.Fatal("unknown firmware accepted by production profile")
	}
	loc := testLoc(t, makeBinary(stockPattern), emptyBlock(), true)
	loc.patchBinary = nil
	loc.mergeBlock = nil
	before := readBin(t, loc.BinaryPath)
	if _, err := applyPatch(loc); err == nil || !strings.Contains(err.Error(), "not validated") {
		t.Fatal("unknown firmware not refused", err)
	}
	if !bytes.Equal(before, readBin(t, loc.BinaryPath)) || fileExists(loc.BinaryPath+binaryBackupSuffix) {
		t.Fatal("refusal changed files")
	}
}
func TestPendingBlockSurvivesOldNVMFlushAndCommitsOnce(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), emptyBlock(), true)
	loc.PendingPath = filepath.Join(filepath.Dir(loc.BinaryPath), "state", "pending.json")
	loc.mergeBlock = nil
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
	// The running verifier flushes its old cache at shutdown, including a newly
	// installed OEM certificate. Startup must retain that certificate too.
	cached := emptyBlock()
	factory := certificateSlot(0x173, 1, "installed before shutdown")
	copy(cached[2*slotSize:], factory)
	if err := os.WriteFile(loc.BlockPath, cached, 0644); err != nil {
		t.Fatal(err)
	}
	if err := commitPendingBlock(loc); err != nil {
		t.Fatal(err)
	}
	committed := readBin(t, loc.BlockPath)
	if !supportConfigured(committed) || !bytes.Contains(committed, factory) {
		t.Fatal("startup commit lost support or factory records")
	}
	if fileExists(loc.PendingPath) {
		t.Fatal("completed job retained")
	}
	if err := commitPendingBlock(loc); err != nil {
		t.Fatal("missing job not harmless", err)
	}
	if !bytes.Equal(committed, readBin(t, loc.BlockPath)) {
		t.Fatal("no-job startup modified block")
	}
}
func TestPendingRefusesFirmwareDriftAndRestoreOverridesPatch(t *testing.T) {
	originalBlock := emptyBlock()
	copy(originalBlock, certificateSlot(0x173, 1, "OEM"))
	loc := testLoc(t, makeBinary(stockPattern), originalBlock, true)
	loc.PendingPath = filepath.Join(filepath.Dir(loc.BinaryPath), "pending.json")
	loc.mergeBlock = nil
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
	installed := readBin(t, loc.BinaryPath)
	drift := append([]byte(nil), installed...)
	drift[800] ^= 1
	os.WriteFile(loc.BinaryPath, drift, 0755)
	if err := commitPendingBlock(loc); err == nil || !fileExists(loc.PendingPath) {
		t.Fatal("stale firmware job applied", err)
	}
	os.WriteFile(loc.BinaryPath, installed, 0755)
	if _, err := restoreBackup(loc); err != nil {
		t.Fatal(err)
	}
	raw := readBin(t, loc.PendingPath)
	var job pendingBlock
	if json.Unmarshal(raw, &job) != nil || job.Merge {
		t.Fatal("restore retained patch job")
	}
	os.WriteFile(loc.BlockPath, block352, 0644)
	if err := commitPendingBlock(loc); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(readBin(t, loc.BlockPath), originalBlock) {
		t.Fatal("restore job did not recover original block")
	}
}
func TestRetryKeepsOriginalSupportBackup(t *testing.T) {
	original := makeBinary(stockPattern)
	pristine := emptyBlock()
	copy(pristine, certificateSlot(0x173, 1, "pristine OEM"))
	loc := testLoc(t, patchedFixture(original), emptyBlock(), true)
	os.WriteFile(loc.BinaryPath+binaryBackupSuffix, original, 0644)
	os.WriteFile(loc.BlockPath+blockBackupSuffix, pristine, 0644)
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(readBin(t, loc.BlockPath+blockBackupSuffix), pristine) {
		t.Fatal("retry overwrote pristine backup")
	}
}
func TestRestartRequiresPostRootLockAndHandlesNSMRefusal(t *testing.T) {
	calls := 0
	s := &patchServer{root: true, restart: func() error { calls++; return nil }}
	run := func(method string) int {
		w := httptest.NewRecorder()
		s.handler().ServeHTTP(w, httptest.NewRequest(method, "/restart", nil))
		return w.Code
	}
	if run(http.MethodGet) != 405 || calls != 0 {
		t.Fatal("GET restarted unit")
	}
	s.root = false
	if run(http.MethodPost) != 403 || calls != 0 {
		t.Fatal("nonroot restarted unit")
	}
	s.root = true
	s.op.Lock()
	code := run(http.MethodPost)
	s.op.Unlock()
	if code != 409 || calls != 0 {
		t.Fatal("concurrent restart accepted")
	}
	if run(http.MethodPost) != 200 || calls != 1 {
		t.Fatal("restart not requested")
	}
	s.restart = func() error { return errors.New("NSM refused") }
	if run(http.MethodPost) != 400 {
		t.Fatal("restart failure hidden")
	}
	if checkRestartResult([]byte("[Error. Busy]"), nil) == nil || checkRestartResult(nil, errors.New("timeout")) == nil || checkRestartResult([]byte("accepted"), nil) != nil {
		t.Fatal("NSM result parsing failed")
	}
}

func TestKnownFirmwareCompatibilityRoundTrip(t *testing.T) {
	fixture := os.Getenv("FSC_VERIFIER_FIXTURE")
	if fixture == "" {
		t.Skip("requires owner's firmware fixture")
	}
	stock := readBin(t, fixture)
	if fingerprint(stock) != dualStockHash {
		t.Fatal("unexpected firmware fixture")
	}
	factory := certificateSlot(0x173, 1, "factory record retained byte-for-byte")
	initial := emptyBlock()
	copy(initial[3*slotSize:], factory)
	legacy := append([]byte(nil), stock...)
	copy(legacy[dualModulus:], patchedModulus)
	loc := testLoc(t, legacy, block352, true)
	loc.patchBinary = nil
	loc.mergeBlock = nil
	loc.PendingPath = filepath.Join(filepath.Dir(loc.BinaryPath), "pending.json")
	os.WriteFile(loc.BinaryPath+binaryBackupSuffix, stock, 0644)
	os.WriteFile(loc.BlockPath+blockBackupSuffix, initial, 0644)
	status, err := applyPatch(loc)
	if err != nil {
		t.Fatal(err)
	}
	if status.Binary.Trust != "oem-and-local" || !status.BlockPending || !status.RestartRequired {
		t.Fatal("incorrect migration status", status)
	}
	patched := readBin(t, loc.BinaryPath)
	if !bytes.Equal(patched[dualModulus:dualModulus+256], stock[dualModulus:dualModulus+256]) {
		t.Fatal("factory key changed")
	}
	if !bytes.Contains(readBin(t, loc.BlockPath), factory) || !bytes.Equal(readBin(t, loc.BlockPath+blockBackupSuffix), initial) {
		t.Fatal("original FSC or backup lost")
	}
	if destination := os.Getenv("FSC_BUILT_OUTPUT"); destination != "" {
		if err := os.WriteFile(destination, patched, 0755); err != nil {
			t.Fatal(err)
		}
	}
	os.WriteFile(loc.BlockPath, initial, 0644)
	if err := commitPendingBlock(loc); err != nil {
		t.Fatal(err)
	}
	if _, err := restoreBackup(loc); err != nil {
		t.Fatal(err)
	}
	if err := commitPendingBlock(loc); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath), stock) || !bytes.Equal(readBin(t, loc.BlockPath), initial) {
		t.Fatal("full restore failed")
	}
}
