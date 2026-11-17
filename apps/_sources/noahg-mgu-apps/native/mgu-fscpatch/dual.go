package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"errors"
)

// This profile is deliberately restricted to the inspected and executed build.
// Unknown firmware must never receive instruction offsets from this profile.
const dualStockHash = "b26d18308c0f2ca1edd5aff8c373aa3aa659751e940cb6eed8509873670c1231"
const dualStockSize = 6515808
const dualEntry = 0x1fa100
const dualNote = 64 + 5*56
const dualFile = 0x637000
const dualVA = 0xbc5000
const dualModulus = 0x27c8c4
const dualMagic = "MGU-FSC-OEM-LOCAL-v2\n"
const legacyDualMagic = "MGU-FSC-OEM-LOCAL-v1\n"
const dualLocalModulus = 164

func unhex(s string) []byte {
	b, e := hex.DecodeString(s)
	if e != nil {
		panic(e)
	}
	return b
}

var dualPrologue = unhex("4883ec0849")
var dualOriginalNote = unhex("04000000040000008c020000000000008c020000000000008c02000000000000440000000000000044000000000000000400000000000000")

// Position-independent SysV x86-64 wrapper. The companion payload/dual.c
// documents the source and ABI. It calls the existing CAL verifier, retaining
// all caller-side VIN, application, validity and certificate parsing checks.
var dualPayload = unhex("f30f1efa41564989c841554989fd415455534889cb4883ec20440fb7721a4889fa4429f64a8d2c374489f1440fb7e64889ef4489e6e8566763ff3df90000007545488d15a81d97ff4839d37539833b087534488b43084c8d4424084489f14c89ea48c7442408080000004489e64889ef4889442410488d05240000004889442418e80a6763ff4883c4205b5d415c415d415ec3000000000000000000000000004000000093173e3232aa6a7fe26707f811206fa614f876881cbac409a1a46ffff3dbcb24b80b1bb06025bce52d647912541514c65501546148efd23bec8de9ea5cbf8230a02d63b60804bfd560e7e784d3ab7ea08a6e491191b815ca1c6e58760cee74755334bb6b6c0a97da2586f073321956e02696751cf89dac8763b33d755bbec45930fb3e320e4e4cabc806ee0b613592f86ddb4ebb52caeabf68c05be422e6faba8858d8d0ecfe252f25217479633c1ad1bd8897110e245d83149f08522498a2bbb253765bb3ad6545d353c56d99a8d86c9c828b40e92fc0d5e2b6547ac7d1ef4fc223ab0dda475d5a7bc294cf4eae8a1580e57335f530a00c39175ba9d4bb8eae")

func buildDual(stock []byte) ([]byte, error) { return buildDualProfile(stock, dualStockHash) }

func buildDualProfile(stock []byte, expected string) ([]byte, error) {
	if len(stock) != dualStockSize || fingerprint(stock) != expected ||
		!bytes.Equal(stock[dualEntry:dualEntry+5], dualPrologue) ||
		!bytes.Equal(stock[dualNote:dualNote+56], dualOriginalNote) {
		return nil, errors.New("factory-compatible patch is not validated for this firmware build; no files changed")
	}
	out := make([]byte, dualFile+len(dualPayload)+len(dualMagic))
	copy(out, stock)
	note := out[dualNote : dualNote+56]
	binary.LittleEndian.PutUint32(note, 1)     // PT_LOAD
	binary.LittleEndian.PutUint32(note[4:], 5) // RX, never writable
	for i, v := range []uint64{dualFile, dualVA, dualVA, uint64(len(dualPayload)), uint64(len(dualPayload)), 4096} {
		binary.LittleEndian.PutUint64(note[8+i*8:], v)
	}
	out[dualEntry] = 0xe9
	binary.LittleEndian.PutUint32(out[dualEntry+1:], uint32(dualVA-dualEntry-5))
	copy(out[dualFile:], dualPayload)
	copy(out[dualFile+len(dualPayload):], dualMagic)
	return out, nil
}

func dualOriginal(data []byte) ([]byte, bool) { return dualOriginalProfile(data, dualStockHash) }
func dualOriginalProfile(data []byte, expected string) ([]byte, bool) {
	if len(data) != dualFile+len(dualPayload)+len(dualMagic) || !(bytes.HasSuffix(data, []byte(dualMagic)) || bytes.HasSuffix(data, []byte(legacyDualMagic))) {
		return nil, false
	}
	stock := append([]byte(nil), data[:dualStockSize]...)
	copy(stock[dualEntry:], dualPrologue)
	copy(stock[dualNote:], dualOriginalNote)
	rebuilt, err := buildDualProfile(stock, expected)
	if err != nil {
		return nil, false
	}
	if bytes.Equal(data, rebuilt) {
		return stock, true
	}
	// Validate a previous profile exactly, permitting only its known key and tag.
	start := dualFile + dualLocalModulus
	if !bytes.HasSuffix(data, []byte(legacyDualMagic)) || fingerprint(data[start:start+256]) != legacyModulusSHA256 {
		return nil, false
	}
	normalized := append([]byte(nil), data...)
	copy(normalized[start:], patchedModulus)
	copy(normalized[dualFile+len(dualPayload):], dualMagic)
	return stock, bytes.Equal(normalized, rebuilt)
}

func dualCurrent(data []byte) bool {
	_, ok := dualOriginal(data)
	return ok && bytes.HasSuffix(data, []byte(dualMagic))
}
