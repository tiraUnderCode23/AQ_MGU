package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
)

const slotSize = 512
const slotCount = 30
const fscLengthOffset = 0x1fa

func slotLength(slot []byte) int { return int(binary.LittleEndian.Uint16(slot[fscLengthOffset:])) }
func slotID(slot []byte) uint16  { return binary.BigEndian.Uint16(slot[8:]) }

func validateBlock(data []byte) error {
	if data == nil {
		return nil
	}
	if len(data) != slotSize*slotCount {
		return errors.New("unsupported support-block layout; refusing to discard stored FSCs")
	}
	for i := 0; i < slotCount; i++ {
		if slotLength(data[i*slotSize:(i+1)*slotSize]) > fscLengthOffset-12 {
			return fmt.Errorf("invalid FSC length in support slot %d", i)
		}
	}
	return nil
}

// Keep every existing slot with an FSC byte-for-byte. Recover missing original
// records from a backup, then add template entries only to empty slots. Running
// out of slots aborts the entire operation before any live replacement.
func mergeSupportBlock(current, backup []byte) ([]byte, error) {
	if err := validateBlock(current); err != nil {
		return nil, err
	}
	if err := validateBlock(backup); err != nil {
		return nil, fmt.Errorf("original backup: %w", err)
	}
	out := make([]byte, len(block352))
	copy(out, current)
	free := func() int {
		for i := 0; i < slotCount; i++ {
			s := out[i*slotSize : (i+1)*slotSize]
			if slotID(s) == 0 && slotLength(s) == 0 {
				return i
			}
		}
		return -1
	}
	if backup != nil {
		for i := 0; i < slotCount; i++ {
			original := backup[i*slotSize : (i+1)*slotSize]
			if slotLength(original) == 0 {
				continue
			}
			found := -1
			for j := 0; j < slotCount; j++ {
				s := out[j*slotSize : (j+1)*slotSize]
				if bytes.Equal(s[8:12], original[8:12]) {
					found = j
					break
				}
			}
			if found >= 0 && slotLength(out[found*slotSize:(found+1)*slotSize]) > 0 {
				continue
			}
			if found < 0 {
				found = free()
			}
			if found < 0 {
				return nil, errors.New("no free support slots; original FSCs were preserved and nothing was patched")
			}
			copy(out[found*slotSize:], original)
		}
	}
	for i := 0; i < slotCount; i++ {
		target := block352[i*slotSize : (i+1)*slotSize]
		if slotID(target) == 0 {
			continue
		}
		found := -1
		for j := 0; j < slotCount; j++ {
			if slotID(out[j*slotSize:]) == slotID(target) {
				found = j
				break
			}
		}
		if found < 0 {
			found = free()
		}
		if found < 0 {
			return nil, errors.New("no free support slots; original FSCs were preserved and nothing was patched")
		}
		slot := out[found*slotSize : (found+1)*slotSize]
		if slotLength(slot) > 0 {
			continue
		}
		upgrade := binary.BigEndian.Uint16(slot[10:12])
		copy(slot, target)
		if upgrade > binary.BigEndian.Uint16(slot[10:12]) {
			binary.BigEndian.PutUint16(slot[10:12], upgrade)
		}
	}
	return out, nil
}

func supportConfigured(data []byte) bool {
	if data == nil || validateBlock(data) != nil {
		return false
	}
	for i := 0; i < slotCount; i++ {
		target := block352[i*slotSize : (i+1)*slotSize]
		if slotID(target) == 0 {
			continue
		}
		found := false
		for j := 0; j < slotCount; j++ {
			s := data[j*slotSize : (j+1)*slotSize]
			if slotID(s) == slotID(target) && (slotLength(s) > 0 || binary.LittleEndian.Uint32(s) == 2) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
