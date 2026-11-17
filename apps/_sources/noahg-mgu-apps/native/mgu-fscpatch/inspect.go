package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"runtime"
)

// Locations names the unit files this tool inspects and patches. Tests build
// their own Locations over temporary directories; Remount stays off there.
type Locations struct {
	BinaryPath  string
	BlockPath   string
	Remount     bool
	PendingPath string
	patchBinary func([]byte) ([]byte, error) // transaction-test dependency; nil uses strict production profile
	mergeBlock  func([]byte, []byte) ([]byte, error)
}

func unitLocations() Locations {
	return Locations{
		BinaryPath:  "/usr/bin/BAC4x_VSTAR_i386_Eth_Application.out",
		BlockPath:   "/var/sys/sf/aol/BLOCKS/block_352",
		Remount:     runtime.GOOS == "linux",
		PendingPath: "/var/opt/mgu-fscpatch/pending-block.json",
	}
}

const (
	binaryBackupSuffix = ".bak"
	blockBackupSuffix  = ".bup"

	// FSC verification states.
	stateMissing        = "missing"
	stateStock          = "stock"
	stateStockVariant   = "stock-variant"
	statePatched        = "patched"
	statePatternMissing = "pattern-missing"

	// FSC support block states.
	blockAbsent = "absent"
	blockOther  = "other"
)

type BinaryStatus struct {
	Trust             string `json:"trust"`
	SigningKeySHA256  string `json:"signingKeySha256"`
	KeyUpdateRequired bool   `json:"keyUpdateRequired"`
	Path              string `json:"path"`
	Present           bool   `json:"present"`
	Size              int64  `json:"size"`
	SHA256            string `json:"sha256"`
	Offset            int64  `json:"offset"`
	ModulusSHA256     string `json:"modulusSha256"`
	State             string `json:"state"`
}

type BlockStatus struct {
	Path    string `json:"path"`
	Present bool   `json:"present"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256"`
	State   string `json:"state"`
}

type Status struct {
	BlockPending    bool         `json:"blockPending"`
	Version         string       `json:"version"`
	Binary          BinaryStatus `json:"binary"`
	Block           BlockStatus  `json:"block"`
	BinaryBackup    bool         `json:"binaryBackup"`
	BlockBackup     bool         `json:"blockBackup"`
	RestartRequired bool         `json:"restartRequired"`
	Message         string       `json:"message"`
}

func fingerprint(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// scanBinary classifies the BAC4x application binary. The stock pattern is the
// anti-drift prefix of the FSC verification modulus; when it is present the
// following 256 bytes are the live modulus and their fingerprint decides
// between stock and a variant build. When the stock prefix is gone but the
// patched modulus prefix is present the binary is already patched.
func scanBinary(data []byte) (offset int64, state string, modulusSHA string) {
	if _, ok := dualOriginal(data); ok {
		return dualModulus, statePatched, stockModulusSHA256
	}
	stock := bytes.Index(data, stockPattern)
	patched := bytes.Index(data, patchedModulus[:60])
	legacy := bytes.Index(data, legacyModulusPrefix)
	if bytes.Count(data, stockPattern) > 1 || bytes.Count(data, patchedModulus[:60]) > 1 ||
		stock >= 0 && patched >= 0 || bytes.Count(data, legacyModulusPrefix) > 1 || legacy >= 0 && (stock >= 0 || patched >= 0) {
		return -1, statePatternMissing, ""
	}
	if stock >= 0 && stock+len(patchedModulus) <= len(data) {
		fp := fingerprint(data[stock : stock+len(patchedModulus)])
		state := stateStockVariant
		if fp == stockModulusSHA256 {
			state = stateStock
		}
		return int64(stock), state, fp
	}
	if patched >= 0 && patched+len(patchedModulus) <= len(data) {
		modulus := data[patched : patched+len(patchedModulus)]
		state := statePatternMissing
		if bytes.Equal(modulus, patchedModulus) {
			state = statePatched
		}
		return int64(patched), state, fingerprint(modulus)
	}
	if legacy >= 0 && legacy+256 <= len(data) {
		fp := fingerprint(data[legacy : legacy+256])
		state := statePatternMissing
		if fp == legacyModulusSHA256 {
			state = statePatched
		}
		return int64(legacy), state, fp
	}
	return -1, statePatternMissing, ""
}

func inspectBinary(loc Locations) (BinaryStatus, error) {
	st := BinaryStatus{Path: loc.BinaryPath, Offset: -1}
	data, err := os.ReadFile(loc.BinaryPath)
	if errors.Is(err, os.ErrNotExist) {
		st.State = stateMissing
		return st, nil
	}
	if err != nil {
		return st, err
	}
	st.Present = true
	st.Size = int64(len(data))
	st.SHA256 = fingerprint(data)
	st.Offset, st.State, st.ModulusSHA256 = scanBinary(data)
	if _, ok := dualOriginal(data); ok {
		st.Trust = "oem-and-local"
		st.SigningKeySHA256 = fingerprint(data[dualFile+dualLocalModulus : dualFile+dualLocalModulus+256])
		st.KeyUpdateRequired = !dualCurrent(data)
	} else if st.State == statePatched {
		st.Trust = "replacement-only"
		st.SigningKeySHA256 = st.ModulusSHA256
		st.KeyUpdateRequired = true
	} else if st.State == stateStock || st.State == stateStockVariant {
		st.Trust = "factory"
	}
	return st, nil
}

func inspectBlock(loc Locations) (BlockStatus, error) {
	st := BlockStatus{Path: loc.BlockPath, State: blockAbsent}
	data, err := os.ReadFile(loc.BlockPath)
	if errors.Is(err, os.ErrNotExist) {
		return st, nil
	}
	if err != nil {
		return st, err
	}
	st.Present = true
	st.Size = int64(len(data))
	st.SHA256 = fingerprint(data)
	if supportConfigured(data) {
		st.State = statePatched
	} else {
		st.State = blockOther
	}
	return st, nil
}

func fullStatus(loc Locations) (Status, error) {
	binary, err := inspectBinary(loc)
	if err != nil {
		return Status{}, err
	}
	block, err := inspectBlock(loc)
	if err != nil {
		return Status{}, err
	}
	return Status{
		Version:         toolVersion,
		RestartRequired: restartPending(loc.BinaryPath) || loc.PendingPath != "" && fileExists(loc.PendingPath),
		BlockPending:    loc.PendingPath != "" && fileExists(loc.PendingPath),
		Binary:          binary,
		Block:           block,
		BinaryBackup:    fileExists(loc.BinaryPath + binaryBackupSuffix),
		BlockBackup:     fileExists(loc.BlockPath+blockBackupSuffix) || fileExists(loc.BlockPath+blockAbsentSuffix),
	}, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
