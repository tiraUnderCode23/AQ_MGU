package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func mountLine(target, mode string) string {
	escape := strings.NewReplacer(`\`, `\134`, " ", `\040`, "\t", `\011`, "\n", `\012`)
	return "device " + escape.Replace(target) + " ext4 " + mode + ",relatime 0 0\n"
}

func mockMounts(t *testing.T, table string, command func(string, string) error) {
	t.Helper()
	beforeRead, beforeMount := readMountTable, remountFilesystem
	t.Cleanup(func() { readMountTable, remountFilesystem = beforeRead, beforeMount })
	readMountTable = func() ([]byte, error) { return []byte(table), nil }
	remountFilesystem = command
}

func TestPatchOpensMountsBeforeBackupsAndRestoresThem(t *testing.T) {
	original, originalBlock := makeBinary(stockPattern), []byte("original support block")
	loc := testLoc(t, original, nil, false)
	root := filepath.Dir(loc.BinaryPath)
	sf := filepath.Join(root, "persistent data")
	if err := os.Mkdir(sf, 0755); err != nil {
		t.Fatal(err)
	}
	loc.BlockPath = filepath.Join(sf, "block_352")
	if err := os.WriteFile(loc.BlockPath, originalBlock, 0644); err != nil {
		t.Fatal(err)
	}
	loc.Remount = true
	var calls []string
	mockMounts(t, mountLine(root, "ro")+mountLine(sf, "ro"), func(mode, target string) error {
		calls = append(calls, mode+" "+target)
		if mode == "rw" && (fileExists(loc.BinaryPath+binaryBackupSuffix) || fileExists(loc.BlockPath+blockBackupSuffix)) {
			t.Fatal("a backup was written before all required mounts were writable")
		}
		if mode == "ro" && (!bytes.Equal(readBin(t, loc.BinaryPath+binaryBackupSuffix), original) ||
			!bytes.Equal(readBin(t, loc.BlockPath+blockBackupSuffix), originalBlock)) {
			t.Fatal("read-only restoration ran before verified backups existed")
		}
		return nil
	})
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
	want := []string{"rw " + root, "rw " + sf, "ro " + sf, "ro " + root}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("mount calls %v, want %v", calls, want)
	}
	calls = nil
	// Restore uses the same filesystem window.
	remountFilesystem = func(mode, target string) error {
		calls = append(calls, mode+" "+target)
		return nil
	}
	if _, err := restoreBackup(loc); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(calls, want) || !bytes.Equal(readBin(t, loc.BinaryPath), original) ||
		!bytes.Equal(readBin(t, loc.BlockPath), originalBlock) {
		t.Fatalf("restore did not preserve the filesystem window or original data: %v", calls)
	}
}

func TestRemountFailureStopsAllWritesAndRestoresOpenedMounts(t *testing.T) {
	original := makeBinary(stockPattern)
	loc := testLoc(t, original, nil, false)
	root := filepath.Dir(loc.BinaryPath)
	sf := filepath.Join(root, "sf")
	if err := os.Mkdir(sf, 0755); err != nil {
		t.Fatal(err)
	}
	loc.BlockPath = filepath.Join(sf, "block_352")
	loc.Remount = true
	failed := errors.New("mount denied")
	var calls []string
	mockMounts(t, mountLine(root, "ro")+mountLine(sf, "ro"), func(mode, target string) error {
		calls = append(calls, mode+" "+target)
		if mode == "rw" && target == sf {
			return failed
		}
		return nil
	})
	if _, err := applyPatch(loc); !errors.Is(err, failed) {
		t.Fatalf("expected remount failure, got %v", err)
	}
	if !reflect.DeepEqual(calls, []string{"rw " + root, "rw " + sf, "ro " + root}) {
		t.Fatalf("mount rollback did not run: %v", calls)
	}
	if fileExists(loc.BinaryPath+binaryBackupSuffix) || fileExists(loc.BlockPath) ||
		!bytes.Equal(readBin(t, loc.BinaryPath), original) {
		t.Fatal("a failed remount changed files")
	}
}

func TestBackupFailureStillRestoresReadOnlyMount(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), nil, false)
	loc.Remount = true
	if err := os.Mkdir(loc.BinaryPath+binaryBackupSuffix, 0755); err != nil {
		t.Fatal(err)
	}
	root := filepath.Dir(loc.BinaryPath)
	var calls []string
	mockMounts(t, mountLine(root, "ro"), func(mode, target string) error {
		calls = append(calls, mode)
		return nil
	})
	if _, err := applyPatch(loc); err == nil || !strings.Contains(err.Error(), "cannot write backup") {
		t.Fatalf("expected backup error, got %v", err)
	}
	if !reflect.DeepEqual(calls, []string{"rw", "ro"}) {
		t.Fatalf("filesystem was not restored after backup failure: %v", calls)
	}
}

func TestReadOnlyRestorationFailureIsReported(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), nil, false)
	loc.Remount = true
	failed := errors.New("read-only remount failed")
	mockMounts(t, mountLine(filepath.Dir(loc.BinaryPath), "ro"), func(mode, target string) error {
		if mode == "ro" {
			return failed
		}
		return nil
	})
	if _, err := applyPatch(loc); !errors.Is(err, failed) {
		t.Fatalf("read-only remount error was hidden: %v", err)
	}
}

func TestWritableFilesystemIsKeptWritable(t *testing.T) {
	loc := testLoc(t, makeBinary(stockPattern), nil, false)
	loc.Remount = true
	mockMounts(t, mountLine(filepath.Dir(loc.BinaryPath), "rw"), func(mode, target string) error {
		t.Fatal("an already-writable filesystem was remounted")
		return nil
	})
	if _, err := applyPatch(loc); err != nil {
		t.Fatal(err)
	}
}

func TestMountDetectionPrefersContainingMountAndRejectsMissingMounts(t *testing.T) {
	root := t.TempDir()
	child := filepath.Join(root, "child")
	if err := os.Mkdir(child, 0755); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(child, "absent")
	table := mountLine(root, "ro") + mountLine(child, "ro") + mountLine(child, "rw")
	mounts, err := mountsForFiles([]byte(table), []string{filename})
	if err != nil || len(mounts) != 0 {
		t.Fatalf("did not choose the last containing writable mount: %v %v", mounts, err)
	}
	if _, err := mountsForFiles(nil, []string{filename}); err == nil {
		t.Fatal("an unknown filesystem was accepted")
	}
}
