package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func executableRetentionPrefix(path string) string {
	return "." + filepath.Base(path) + ".fsc-retained-"
}

func retentionBoot() (string, error) {
	id, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return "", err
	}
	return fingerprint(id)[:16], nil
}

// A linked original avoids an unlinked executing inode keeping the mount busy.
// Originals retained during this boot remain linked until a later boot.
func replaceDestination(temporary, path string, info os.FileInfo, mode os.FileMode) error {
	if info == nil || (info.Mode()|mode).Perm()&0111 == 0 {
		return os.Rename(temporary, path)
	}
	boot, err := retentionBoot()
	if err != nil {
		return err
	}
	stat := info.Sys().(*syscall.Stat_t)
	retained := filepath.Join(filepath.Dir(path), executableRetentionPrefix(path)+boot+"-"+strconv.FormatUint(stat.Ino, 10))
	if err := os.Link(path, retained); err != nil {
		other, statErr := os.Stat(retained)
		if !os.IsExist(err) || statErr != nil || !os.SameFile(info, other) {
			return fmt.Errorf("cannot retain executing original: %w", err)
		}
	}
	if err := os.Rename(temporary, path); err != nil {
		// The original still has its normal path, so this extra link can go.
		_ = os.Remove(retained)
		return err
	}
	return nil
}

func cleanupPreviousExecutables(path string) error {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	boot, err := retentionBoot()
	if err != nil {
		return err
	}
	directory, prefix := filepath.Dir(path), executableRetentionPrefix(path)
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	changed := false
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), prefix) {
			continue
		}
		suffix := strings.TrimPrefix(entry.Name(), prefix)
		parts := strings.Split(suffix, "-")
		if len(parts) != 2 || len(parts[0]) != 16 || parts[0] == boot {
			continue
		}
		if _, err := strconv.ParseUint(parts[0], 16, 64); err != nil {
			continue
		}
		inode, err := strconv.ParseUint(parts[1], 10, 64)
		if err != nil {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Ino != inode {
			continue
		}
		if err := os.Remove(filepath.Join(directory, entry.Name())); err != nil {
			return err
		}
		changed = true
	}
	if changed {
		return syncDirectory(directory)
	}
	return nil
}

func restartPending(path string) bool {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	boot, err := retentionBoot()
	if err != nil {
		return false
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		return false
	}
	prefix := executableRetentionPrefix(path) + boot + "-"
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), prefix) {
			continue
		}
		inode, err := strconv.ParseUint(strings.TrimPrefix(entry.Name(), prefix), 10, 64)
		if err != nil {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.Mode().IsRegular() && info.Sys().(*syscall.Stat_t).Ino == inode {
			return true
		}
	}
	return false
}
