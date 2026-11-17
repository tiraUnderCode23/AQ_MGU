package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalKeyBindings(t *testing.T) {
	if fingerprint(patchedModulus) != localModulusSHA256 || localModulusSHA256 == legacyModulusSHA256 {
		t.Fatal("local key binding is invalid")
	}
	if !bytes.Equal(dualPayload[dualLocalModulus:dualLocalModulus+256], patchedModulus) {
		t.Fatal("payload and local key differ")
	}
	if len(legacyModulusPrefix) != 60 || bytes.Equal(legacyModulusPrefix, patchedModulus[:60]) {
		t.Fatal("legacy recognition is ambiguous")
	}
}

func legacyDualFixture(t *testing.T) []byte {
	t.Helper()
	path := os.Getenv("FSC_LEGACY_DUAL_FIXTURE")
	if path == "" {
		t.Skip("requires previous-profile fixture")
	}
	data := readBin(t, path)
	if _, ok := dualOriginal(data); !ok || dualCurrent(data) {
		t.Fatal("legacy fixture not recognized strictly")
	}
	return data
}

func TestLegacyProfileRejectsTamperingAndMixedTags(t *testing.T) {
	legacy := legacyDualFixture(t)
	for _, offset := range []int{0, dualEntry + 1, dualNote + 16, dualFile + 55, dualFile + dualLocalModulus + 5, len(legacy) - 2} {
		data := append([]byte(nil), legacy...)
		data[offset] ^= 1
		if _, ok := dualOriginal(data); ok {
			t.Fatalf("accepted legacy tampering at %x", offset)
		}
	}
	mixed := append([]byte(nil), legacy...)
	copy(mixed[len(mixed)-len(dualMagic):], dualMagic)
	if _, ok := dualOriginal(mixed); ok {
		t.Fatal("old key with current tag accepted")
	}
	mixed = append([]byte(nil), legacy...)
	copy(mixed[dualFile+dualLocalModulus:], patchedModulus)
	if _, ok := dualOriginal(mixed); ok {
		t.Fatal("new key with old tag accepted")
	}
}

func TestRotateLegacyKeyPreservesFactoryBackupAndRestores(t *testing.T) {
	legacy := legacyDualFixture(t)
	stock, ok := dualOriginal(legacy)
	if !ok {
		t.Fatal("stock reconstruction failed")
	}
	raw := append([]byte(nil), stock...)
	copy(raw[dualModulus:], legacy[dualFile+dualLocalModulus:dualFile+dualLocalModulus+256])
	for name, installed := range map[string][]byte{"previous dual profile": legacy, "previous replacement-only profile": raw} {
		t.Run(name, func(t *testing.T) {
			loc := testLoc(t, installed, block352, true)
			loc.patchBinary = nil
			loc.mergeBlock = nil
			loc.PendingPath = filepath.Join(filepath.Dir(loc.BinaryPath), "pending.json")
			if err := os.WriteFile(loc.BinaryPath+binaryBackupSuffix, stock, 0644); err != nil {
				t.Fatal(err)
			}
			factory := emptyBlock()
			copy(factory, certificateSlot(0x173, 1, "original factory record"))
			if err := os.WriteFile(loc.BlockPath+blockBackupSuffix, factory, 0644); err != nil {
				t.Fatal(err)
			}
			before, err := inspectBinary(loc)
			if err != nil || !before.KeyUpdateRequired || before.SigningKeySHA256 != legacyModulusSHA256 {
				t.Fatal("key update not reported", before, err)
			}
			status, err := applyPatch(loc)
			if err != nil {
				t.Fatal(err)
			}
			if status.Binary.KeyUpdateRequired || status.Binary.SigningKeySHA256 != localModulusSHA256 || !dualCurrent(readBin(t, loc.BinaryPath)) {
				t.Fatal("new key not installed", status)
			}
			current := readBin(t, loc.BinaryPath)
			if !bytes.Equal(current[dualModulus:dualModulus+256], stock[dualModulus:dualModulus+256]) || !bytes.Equal(readBin(t, loc.BinaryPath+binaryBackupSuffix), stock) {
				t.Fatal("factory key or backup changed")
			}
			if !bytes.Contains(readBin(t, loc.BlockPath), factory[:slotSize]) {
				t.Fatal("original FSC record lost")
			}
			if err := commitPendingBlock(loc); err != nil {
				t.Fatal(err)
			}
			if _, err := applyPatch(loc); err == nil || !strings.Contains(err.Error(), "already patched") {
				t.Fatal("current profile was not idempotent", err)
			}
			if _, err := restoreBackup(loc); err != nil {
				t.Fatal(err)
			}
			if err := commitPendingBlock(loc); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(readBin(t, loc.BinaryPath), stock) || !bytes.Equal(readBin(t, loc.BlockPath), factory) {
				t.Fatal("rotation restore lost original data")
			}
		})
	}
}
