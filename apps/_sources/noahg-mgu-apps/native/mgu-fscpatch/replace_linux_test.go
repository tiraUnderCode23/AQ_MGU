package main

import (
	"bytes"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
)

func startFixture(t *testing.T, name string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(name, "60")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	return cmd
}

func TestPatchAndRestoreExecutingBinary(t *testing.T) {
	sleep, err := exec.LookPath("sleep")
	if err != nil {
		t.Fatal(err)
	}
	elf, err := os.ReadFile(sleep)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(elf, stockPattern) {
		t.Fatal("fixture executable already contains the stock pattern")
	}
	// Appended fixture data leaves the real Linux executable's code unchanged.
	original := append(elf, makeBinary(stockPattern)...)
	loc := testLoc(t, original, []byte("original block"), true)
	if err := os.Chmod(loc.BinaryPath, 0751); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(loc.BinaryPath)
	if err != nil {
		t.Fatal(err)
	}
	runningOriginal := startFixture(t, loc.BinaryPath)
	handle, err := os.OpenFile(loc.BinaryPath, os.O_WRONLY, 0)
	if handle != nil {
		handle.Close()
	}
	if !errors.Is(err, syscall.ETXTBSY) {
		t.Fatalf("test requires the reported Linux failure, got %v", err)
	}
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
	status, err := fullStatus(loc)
	if err != nil || !status.RestartRequired {
		t.Fatal("restart requirement was lost during a status refresh", err)
	}
	after, err := os.Stat(loc.BinaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if os.SameFile(before, after) || after.Mode().Perm() != before.Mode().Perm() {
		t.Fatal("patch did not replace the inode while preserving executable permissions")
	}
	if err := runningOriginal.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatal("the executing original was stopped", err)
	}
	beforeOwner, afterOwner := before.Sys().(*syscall.Stat_t), after.Sys().(*syscall.Stat_t)
	if beforeOwner.Uid != afterOwner.Uid || beforeOwner.Gid != afterOwner.Gid {
		t.Fatal("binary ownership changed")
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath+binaryBackupSuffix), original) {
		t.Fatal("original backup changed")
	}

	runningPatched := startFixture(t, loc.BinaryPath)
	if _, err := restoreBackup(loc); err != nil {
		t.Fatal(err)
	}
	restored, err := os.Stat(loc.BinaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath), original) || restored.Mode().Perm() != 0751 {
		t.Fatal("restore did not preserve the original bytes and executable mode")
	}
	if err := runningPatched.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatal("the executing patched copy was stopped", err)
	}
}

func TestRestoreRepairsMissingExecutePermissions(t *testing.T) {
	original := makeBinary(stockPattern)
	loc := testLoc(t, original, nil, false)
	if err := os.WriteFile(loc.BinaryPath+binaryBackupSuffix, original, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := restoreBackup(loc); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(loc.BinaryPath)
	if err != nil || info.Mode().Perm() != 0755 {
		t.Fatalf("restored binary is not executable: %v %v", info, err)
	}
}

func TestReplacementPreservesSymbolicLinkAndTargetMode(t *testing.T) {
	dir := t.TempDir()
	target, link := filepath.Join(dir, "target"), filepath.Join(dir, "link")
	original := []byte("original")
	if err := os.WriteFile(target, original, 0751); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := replaceFileSync(link, []byte("replacement"), 0751, original); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Readlink(link); err != nil {
		t.Fatal("symbolic link was replaced", err)
	}
	info, err := os.Stat(target)
	if err != nil || info.Mode().Perm() != 0751 || !bytes.Equal(readBin(t, target), []byte("replacement")) {
		t.Fatal("symbolic link target was not replaced correctly", err)
	}
}

func TestReplacementKeepsOpenOriginalAndInstallsVerifiedBytes(t *testing.T) {
	name := filepath.Join(t.TempDir(), "executable")
	original, replacement := []byte("original bytes"), []byte("replacement bytes")
	if err := os.WriteFile(name, original, 0755); err != nil {
		t.Fatal(err)
	}
	openOriginal, err := os.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer openOriginal.Close()
	if err := replaceFileSync(name, replacement, 0755, original); err != nil {
		t.Fatal(err)
	}
	oldBytes, err := io.ReadAll(openOriginal)
	if err != nil || !bytes.Equal(oldBytes, original) || !bytes.Equal(readBin(t, name), replacement) {
		t.Fatal("replacement changed the open original or installed incorrect bytes")
	}
}
