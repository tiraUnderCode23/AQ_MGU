package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func readOptionalFile(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%s is not a regular file", path)
	}
	return os.ReadFile(path)
}

func sameFileData(a, b []byte) bool {
	return (a == nil) == (b == nil) && bytes.Equal(a, b)
}

func saveBackup(path string, data []byte) error {
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular backup file", path)
	}
	before, err := readOptionalFile(path)
	if err != nil {
		return err
	}
	if sameFileData(before, data) {
		return nil
	}
	return replaceFileSync(path, data, 0644, before)
}

type fileUpdate struct {
	path          string
	before, after []byte
	mode          os.FileMode
}

func writeFileUpdate(update fileUpdate) error {
	if sameFileData(update.before, update.after) {
		if update.after != nil {
			info, err := os.Stat(update.path)
			if err != nil {
				return err
			}
			if info.Mode() != update.mode {
				return os.Chmod(update.path, update.mode)
			}
		}
		return nil
	}
	if update.after == nil {
		return removeFileSync(update.path, update.before)
	}
	return replaceFileSync(update.path, update.after, update.mode, update.before)
}

// applyFileUpdates restores any changed files if a later replacement fails.
// Durable backups also permit recovery after a power loss between replacements.
func applyFileUpdates(updates []fileUpdate) error {
	for i, update := range updates {
		if err := writeFileUpdate(update); err != nil {
			failures := []error{fmt.Errorf("cannot update %s: %w", update.path, err)}
			for j := i; j >= 0; j-- {
				prior := updates[j]
				current, err := readOptionalFile(prior.path)
				if err != nil {
					failures = append(failures, err)
					continue
				}
				if sameFileData(current, prior.before) {
					continue
				}
				if !sameFileData(current, prior.after) {
					failures = append(failures, fmt.Errorf("%s changed during rollback", prior.path))
					continue
				}
				if err := writeFileUpdate(fileUpdate{
					path: prior.path, before: prior.after, after: prior.before, mode: prior.mode,
				}); err != nil {
					failures = append(failures, fmt.Errorf("cannot roll back %s: %w", prior.path, err))
				}
			}
			return errors.Join(failures...)
		}
	}
	return nil
}

func removeFileSync(path string, expected []byte) error {
	current, err := readOptionalFile(path)
	if err != nil {
		return err
	}
	if !sameFileData(current, expected) {
		return fmt.Errorf("%s changed during verification; refusing to remove it", path)
	}
	if current == nil {
		return nil
	}
	if err := os.Remove(path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

// replaceFileSync verifies both the temporary bytes and the expected original
// before replacing the destination. A nil expected value requires an absent file.
func replaceFileSync(path string, data []byte, mode os.FileMode, expected []byte) error {
	info, err := os.Stat(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if info != nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("%s is not a regular file", path)
		}
		path, err = filepath.EvalSymlinks(path)
		if err != nil {
			return err
		}
	}
	file, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".replace-")
	if err != nil {
		return err
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	defer file.Close()
	if _, err := file.Write(data); err != nil {
		return err
	}
	if err := preserveFileMetadata(file, path, info); err != nil {
		return err
	}
	if err := file.Chmod(mode); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	staged, err := os.ReadFile(tmp)
	if err != nil {
		return err
	}
	if !bytes.Equal(staged, data) {
		return errors.New("replacement file read-back verification failed")
	}
	current, err := readOptionalFile(path)
	if err != nil {
		return err
	}
	if !sameFileData(current, expected) {
		return errors.New("binary changed during verification; refusing to replace it")
	}
	if err := replaceDestination(tmp, path, info, mode); err != nil {
		return err
	}
	if err := syncDirectory(filepath.Dir(path)); err != nil {
		return err
	}
	installed, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if !bytes.Equal(installed, data) {
		return errors.New("installed file read-back verification failed")
	}
	return nil
}
