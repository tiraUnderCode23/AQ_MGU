package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
)

const toolVersion = "1.0.0"
const blockAbsentSuffix = ".bup.absent"

var absentBlockBackup = []byte("absent\n")

// applyPatch verifies the current binary, saves both original states, and
// commits verified replacements. A retry can complete an interrupted patch.
func applyPatch(loc Locations) (result Status, err error) {
	original, err := os.ReadFile(loc.BinaryPath)
	if err != nil {
		return Status{}, fmt.Errorf("cannot read %s: %w", loc.BinaryPath, err)
	}
	offset, state, _ := scanBinary(original)
	if state == statePatternMissing || offset < 0 || int(offset)+len(patchedModulus) > len(original) {
		return Status{}, errors.New("stock pattern not found; this BAC4x build is incompatible and needs the matching-SWFL flow")
	}
	block, err := readOptionalFile(loc.BlockPath)
	if err != nil {
		return Status{}, fmt.Errorf("cannot read support block: %w", err)
	}
	dualInstalled := dualCurrent(original)
	if state == statePatched {
		if (dualInstalled || loc.patchBinary != nil) && supportConfigured(block) {
			return Status{}, errors.New("already patched; nothing to do")
		}
		backup, err := readOptionalFile(loc.BinaryPath + binaryBackupSuffix)
		if err != nil || !matchingStockBackup(original, backup) {
			return Status{}, errors.New("incomplete patch requires a matching stock binary backup")
		}
	}
	stock := original
	if state == statePatched {
		stock, err = readOptionalFile(loc.BinaryPath + binaryBackupSuffix)
		if err != nil {
			return Status{}, err
		}
	}
	builder := loc.patchBinary
	if builder == nil {
		builder = buildDual
	}
	patched, err := builder(stock)
	if err != nil {
		return Status{}, err
	}
	backupBlock, err := readOptionalFile(loc.BlockPath + blockBackupSuffix)
	if err != nil {
		return Status{}, err
	}
	// Only an installed patch with its matching binary backup can recover
	// records from an older support-block backup.
	if state != statePatched {
		backupBlock = nil
	}
	merger := loc.mergeBlock
	if merger == nil {
		merger = mergeSupportBlock
	}
	desiredBlock, err := merger(block, backupBlock)
	if err != nil {
		return Status{}, err
	}
	pending, err := pendingUpdate(loc, patched, desiredBlock, true)
	if err != nil {
		return Status{}, err
	}
	restoreMounts, err := writableFiles(loc, loc.BinaryPath, loc.BinaryPath+binaryBackupSuffix,
		loc.BlockPath, loc.BlockPath+blockBackupSuffix, loc.BlockPath+blockAbsentSuffix)
	if err != nil {
		return Status{}, err
	}
	defer func() { err = errors.Join(err, restoreMounts()) }()
	if err := cleanupPreviousExecutables(loc.BinaryPath); err != nil {
		return Status{}, err
	}

	if state != statePatched {
		if err := saveBackup(loc.BinaryPath+binaryBackupSuffix, original); err != nil {
			return Status{}, fmt.Errorf("cannot write backup: %w", err)
		}
	}
	if err := saveBlockBackup(loc, block, state == statePatched); err != nil {
		return Status{}, err
	}
	updates := []fileUpdate{{
		path: loc.BlockPath, before: block, after: desiredBlock, mode: fileMode(loc.BlockPath, 0770),
	}}
	if !bytes.Equal(original, patched) {
		updates = append(updates, fileUpdate{
			path: loc.BinaryPath, before: original, after: patched, mode: fileMode(loc.BinaryPath, 0755),
		})
	}
	if pending != nil {
		updates = append(updates, *pending)
	}
	if err := applyFileUpdates(updates); err != nil {
		return Status{}, err
	}
	status, err := fullStatus(loc)
	if err != nil {
		return Status{}, err
	}
	status.RestartRequired = true
	status.Message = "Patch applied. Restart required"
	return status, nil
}

func saveBlockBackup(loc Locations, original []byte, preserve bool) error {
	if preserve {
		b, e := readOptionalFile(loc.BlockPath + blockBackupSuffix)
		if e != nil {
			return e
		}
		a, e := readOptionalFile(loc.BlockPath + blockAbsentSuffix)
		if e != nil {
			return e
		}
		if a != nil && !bytes.Equal(a, absentBlockBackup) {
			return errors.New("invalid absent support block backup")
		}
		if b != nil || a != nil {
			return nil
		}
	}
	if bytes.Equal(original, block352) {
		return nil
	}
	marker := loc.BlockPath + blockAbsentSuffix
	if original == nil {
		if err := saveBackup(marker, absentBlockBackup); err != nil {
			return fmt.Errorf("cannot record absent support block: %w", err)
		}
		return nil
	}
	if err := saveBackup(loc.BlockPath+blockBackupSuffix, original); err != nil {
		return fmt.Errorf("cannot back up support block: %w", err)
	}
	absent, err := readOptionalFile(marker)
	if err != nil {
		return err
	}
	if absent != nil {
		if err := removeFileSync(marker, absent); err != nil {
			return err
		}
	}
	return nil
}

func matchingStockBackup(current, backup []byte) bool {
	offset, state, _ := scanBinary(backup)
	if state != stateStock && state != stateStockVariant {
		return false
	}
	if stock, ok := dualOriginal(current); ok {
		return bytes.Equal(stock, backup)
	}
	if current == nil {
		return true
	}
	end := int(offset) + len(patchedModulus)
	return len(current) == len(backup) && bytes.Equal(current[:int(offset)], backup[:int(offset)]) &&
		bytes.Equal(current[end:], backup[end:])
}

// restoreBackup validates every available backup before modifying either file.
// An absence marker restores a support block that did not originally exist.
func restoreBackup(loc Locations) (result Status, err error) {
	binary, err := readOptionalFile(loc.BinaryPath)
	if err != nil {
		return Status{}, err
	}
	block, err := readOptionalFile(loc.BlockPath)
	if err != nil {
		return Status{}, err
	}
	backup, err := readOptionalFile(loc.BinaryPath + binaryBackupSuffix)
	if err != nil {
		return Status{}, err
	}
	blockBackup, err := readOptionalFile(loc.BlockPath + blockBackupSuffix)
	if err != nil {
		return Status{}, err
	}
	absent, err := readOptionalFile(loc.BlockPath + blockAbsentSuffix)
	if err != nil {
		return Status{}, err
	}
	var updates []fileUpdate
	var restored []string
	if backup != nil {
		_, state, _ := scanBinary(backup)
		if state != stateStock && state != stateStockVariant {
			return Status{}, errors.New("binary backup does not contain the stock pattern; refusing to restore it")
		}
		if !matchingStockBackup(binary, backup) {
			return Status{}, errors.New("binary backup does not match the installed build; refusing to restore it")
		}
		mode := fileMode(loc.BinaryPath, 0755)
		if mode.Perm()&0111 == 0 {
			mode = 0755
		}
		updates = append(updates, fileUpdate{path: loc.BinaryPath, before: binary, after: backup, mode: mode})
		restored = append(restored, "binary")
	}
	if absent != nil {
		if !bytes.Equal(absent, absentBlockBackup) {
			return Status{}, errors.New("invalid absent support block backup")
		}
		updates = append(updates, fileUpdate{path: loc.BlockPath, before: block, after: nil, mode: 0644})
		restored = append(restored, "support block")
	} else if blockBackup != nil {
		updates = append(updates, fileUpdate{
			path: loc.BlockPath, before: block, after: blockBackup, mode: fileMode(loc.BlockPath, 0644),
		})
		restored = append(restored, "support block")
	}
	if len(updates) == 0 {
		return Status{}, errors.New("no backup present; nothing to restore")
	}
	desiredBinary := binary
	if backup != nil {
		desiredBinary = backup
	}
	var pending *fileUpdate
	if absent != nil || blockBackup != nil {
		desired := blockBackup
		if absent != nil {
			desired = nil
		}
		pending, err = pendingUpdate(loc, desiredBinary, desired, false)
		if err != nil {
			return Status{}, err
		}
	} else if loc.PendingPath != "" {
		raw, e := readOptionalFile(loc.PendingPath)
		if e != nil {
			return Status{}, e
		}
		pending = &fileUpdate{path: loc.PendingPath, before: raw, after: nil, mode: 0600}
	}
	if pending != nil {
		updates = append(updates, *pending)
	}
	restoreMounts, err := writableFiles(loc, loc.BinaryPath, loc.BlockPath)
	if err != nil {
		return Status{}, err
	}
	defer func() { err = errors.Join(err, restoreMounts()) }()
	if err := cleanupPreviousExecutables(loc.BinaryPath); err != nil {
		return Status{}, err
	}
	if err := applyFileUpdates(updates); err != nil {
		return Status{}, err
	}
	status, err := fullStatus(loc)
	if err != nil {
		return Status{}, err
	}
	status.Message = "Restored " + restored[0]
	if len(restored) == 2 {
		status.Message = "Restored binary and support block"
	}
	status.RestartRequired = status.RestartRequired || backup != nil && !sameFileData(binary, backup)
	if status.RestartRequired {
		status.Message += ". Restart required"
	}
	return status, nil
}

func fileMode(path string, fallback os.FileMode) os.FileMode {
	if info, err := os.Stat(path); err == nil {
		return info.Mode()
	}
	return fallback
}
