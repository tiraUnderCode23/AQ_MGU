package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type pendingBlock struct {
	Version      int    `json:"version"`
	BinarySHA256 string `json:"binarySha256"`
	Data         []byte `json:"data"`
	Merge        bool   `json:"merge"`
}

func pendingUpdate(loc Locations, binary, block []byte, merge bool) (*fileUpdate, error) {
	if loc.PendingPath == "" {
		return nil, nil
	}
	if err := os.MkdirAll(filepath.Dir(loc.PendingPath), 0700); err != nil {
		return nil, err
	}
	before, err := readOptionalFile(loc.PendingPath)
	if err != nil {
		return nil, err
	}
	after, err := json.Marshal(pendingBlock{Version: 1, BinarySHA256: fingerprint(binary), Data: block, Merge: merge})
	if err != nil {
		return nil, err
	}
	return &fileUpdate{path: loc.PendingPath, before: before, after: after, mode: 0600}, nil
}

// ExecStartPre runs after persistency-fs.target and before the verifier reads
// its NVM cache. The unit ignores a failure so the head unit can always boot.
// Jobs are one-shot, fixed-path, and bound to the installed verifier hash.
func commitPendingBlock(loc Locations) (err error) {
	if loc.PendingPath == "" {
		return nil
	}
	raw, err := readOptionalFile(loc.PendingPath)
	if err != nil || raw == nil {
		return err
	}
	var job pendingBlock
	if json.Unmarshal(raw, &job) != nil || job.Version != 1 || len(job.BinarySHA256) != 64 {
		return errors.New("invalid pending support-block job")
	}
	installed, err := os.ReadFile(loc.BinaryPath)
	if err != nil {
		return err
	}
	if fingerprint(installed) != job.BinarySHA256 {
		return errors.New("pending support block belongs to a different verifier; job retained")
	}
	current, err := readOptionalFile(loc.BlockPath)
	if err != nil {
		return err
	}
	desired := job.Data
	if job.Merge {
		desired, err = mergeSupportBlock(current, job.Data)
		if err != nil {
			return err
		}
	}
	restore, err := writableFiles(loc, loc.BlockPath, loc.PendingPath)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, restore()) }()
	if err := applyFileUpdates([]fileUpdate{
		{path: loc.BlockPath, before: current, after: desired, mode: fileMode(loc.BlockPath, 0770)},
		{path: loc.PendingPath, before: raw, after: nil, mode: 0600},
	}); err != nil {
		return fmt.Errorf("commit pending support block: %w", err)
	}
	return nil
}
