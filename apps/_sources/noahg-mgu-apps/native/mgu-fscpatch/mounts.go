package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var readMountTable = func() ([]byte, error) {
	return os.ReadFile("/proc/self/mounts")
}

var remountFilesystem = func(mode, target string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "mount", "-o", "remount,"+mode, target).CombinedOutput()
	if err != nil {
		return fmt.Errorf("remount %s %s: %w (%s)", target, mode, err, strings.TrimSpace(string(output)))
	}
	return nil
}

type filesystemMount struct {
	target   string
	readOnly bool
}

func mountsForFiles(table []byte, paths []string) ([]filesystemMount, error) {
	decode := strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`)
	var mounts []filesystemMount
	for _, line := range strings.Split(string(table), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		target := filepath.Clean(decode.Replace(fields[1]))
		mounts = append(mounts, filesystemMount{
			target:   target,
			readOnly: strings.Contains(","+fields[3]+",", ",ro,"),
		})
	}
	var selected []filesystemMount
	seen := make(map[string]bool)
	for _, filename := range paths {
		resolved, err := filepath.EvalSymlinks(filename)
		if err != nil {
			// A support block can be absent. Its existing parent determines the mount.
			resolved, err = filepath.EvalSymlinks(filepath.Dir(filename))
			if err != nil {
				return nil, fmt.Errorf("resolve filesystem for %s: %w", filename, err)
			}
		}
		var match *filesystemMount
		for i := range mounts {
			mount := &mounts[i]
			prefix := strings.TrimRight(mount.target, string(filepath.Separator)) + string(filepath.Separator)
			if resolved == mount.target || strings.HasPrefix(resolved, prefix) {
				if match == nil || len(mount.target) >= len(match.target) {
					match = mount
				}
			}
		}
		if match == nil {
			return nil, fmt.Errorf("cannot determine filesystem for %s", filename)
		}
		if match.readOnly && !seen[match.target] {
			selected = append(selected, *match)
			seen[match.target] = true
		}
	}
	return selected, nil
}

// writableFiles opens each read-only filesystem before any backup or payload
// write. The returned function restores those filesystems to read-only.
func writableFiles(loc Locations, paths ...string) (func() error, error) {
	if !loc.Remount {
		return func() error { return nil }, nil
	}
	table, err := readMountTable()
	if err != nil {
		return nil, fmt.Errorf("cannot read filesystem mounts: %w", err)
	}
	mounts, err := mountsForFiles(table, paths)
	if err != nil {
		return nil, err
	}
	var changed []filesystemMount
	restore := func() error {
		var failures []error
		for i := len(changed) - 1; i >= 0; i-- {
			if err := remountFilesystem("ro", changed[i].target); err != nil {
				failures = append(failures, fmt.Errorf("cannot restore read-only filesystem: %w", err))
			}
		}
		return errors.Join(failures...)
	}
	for _, mount := range mounts {
		if err := remountFilesystem("rw", mount.target); err != nil {
			return nil, errors.Join(fmt.Errorf("cannot make filesystem writable: %w", err), restore())
		}
		changed = append(changed, mount)
	}
	return restore, nil
}
