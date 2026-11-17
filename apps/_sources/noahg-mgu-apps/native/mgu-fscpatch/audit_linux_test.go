package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"
)

func TestPatchAndRestoreOnReadOnlyFilesystems(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("requires private Linux mount privileges")
	}
	root := t.TempDir()
	binaryDir, blockDir := filepath.Join(root, "binary"), filepath.Join(root, "block")
	for _, directory := range []string{binaryDir, blockDir} {
		if err := os.Mkdir(directory, 0755); err != nil {
			t.Fatal(err)
		}
		if err := syscall.Mount("tmpfs", directory, "tmpfs", 0, "size=16m"); err != nil {
			if errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.ENOSYS) {
				t.Skip("mount namespaces are unavailable on this test host")
			}
			t.Fatal(err)
		}
		path := directory
		t.Cleanup(func() { _ = syscall.Unmount(path, 0) })
	}
	sleep, err := exec.LookPath("sleep")
	if err != nil {
		t.Fatal(err)
	}
	elf, err := os.ReadFile(sleep)
	if err != nil {
		t.Fatal(err)
	}
	original := append(elf, makeBinary(stockPattern)...)
	loc := Locations{BinaryPath: filepath.Join(binaryDir, "verifier"), BlockPath: filepath.Join(blockDir, "block"), Remount: true, patchBinary: func(b []byte) ([]byte, error) { return patchedFixture(b), nil }, mergeBlock: func(_, _ []byte) ([]byte, error) { return block352, nil }}
	if err := os.WriteFile(loc.BinaryPath, original, 0751); err != nil {
		t.Fatal(err)
	}
	for _, directory := range []string{binaryDir, blockDir} {
		if err := syscall.Mount("", directory, "", syscall.MS_REMOUNT|syscall.MS_RDONLY, ""); err != nil {
			t.Fatal(err)
		}
	}
	running := startFixture(t, loc.BinaryPath)
	if err := os.WriteFile(loc.BinaryPath+binaryBackupSuffix, original, 0644); !errors.Is(err, syscall.EROFS) {
		t.Fatalf("test did not reproduce read-only backup failure: %v", err)
	}
	if _, err := applyPatch(loc); err != nil {
		t.Fatal("patch failed on real read-only filesystems", err)
	}
	for _, directory := range []string{binaryDir, blockDir} {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(directory, &stat); err != nil || stat.Flags&syscall.MS_RDONLY == 0 {
			t.Fatal("filesystem was left writable after patch", directory, err)
		}
	}
	if err := running.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatal("patch stopped the executing original", err)
	}
	startFixture(t, loc.BinaryPath)
	if _, err := restoreBackup(loc); err != nil {
		t.Fatal("restore failed on real read-only filesystems", err)
	}
	if !bytes.Equal(readBin(t, loc.BinaryPath), original) || fileExists(loc.BlockPath) {
		t.Fatal("restore did not recover the original binary and absent block")
	}
	for _, directory := range []string{binaryDir, blockDir} {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(directory, &stat); err != nil || stat.Flags&syscall.MS_RDONLY == 0 {
			t.Fatal("filesystem was left writable after restore", directory, err)
		}
	}
}

func TestReplacementPreservesExtendedAttributes(t *testing.T) {
	name := filepath.Join(t.TempDir(), "binary")
	if err := os.WriteFile(name, []byte("original"), 0751); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Setxattr(name, "user.fsc-audit", []byte("metadata"), 0); err != nil {
		if errors.Is(err, syscall.ENOTSUP) {
			t.Skip("test filesystem has no extended attributes")
		}
		t.Fatal(err)
	}
	if err := replaceFileSync(name, []byte("replacement"), 0751, []byte("original")); err != nil {
		t.Fatal(err)
	}
	value := make([]byte, 32)
	size, err := syscall.Getxattr(name, "user.fsc-audit", value)
	if err != nil || string(value[:size]) != "metadata" {
		t.Fatal("extended attributes were lost", err)
	}
}

func TestControlSocketPermissionsSingleInstanceAndStaleRecovery(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("requires service ownership privileges")
	}
	socket := filepath.Join(t.TempDir(), "run", "control.sock")
	first, err := openControlSocket(socket, os.Getgid())
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	info, err := os.Stat(socket)
	if err != nil || info.Mode().Perm() != 0660 {
		t.Fatal("unexpected socket permissions", err)
	}
	directory, err := os.Stat(filepath.Dir(socket))
	if err != nil || directory.Mode().Perm() != 0750 {
		t.Fatal("unexpected socket directory permissions", err)
	}
	second, err := openControlSocket(socket, os.Getgid())
	if second != nil {
		second.Close()
	}
	if err == nil {
		t.Fatal("second service replaced the live socket")
	}
	connection, err := net.DialTimeout("unix", socket, time.Second)
	if err != nil {
		t.Fatal("existing service lost its control socket", err)
	}
	connection.Close()
	first.Close()

	stale, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	stale.SetUnlinkOnClose(false)
	stale.Close()
	recovered, err := openControlSocket(socket, os.Getgid())
	if err != nil {
		t.Fatal("stale socket was not recovered", err)
	}
	recovered.Close()
	if err := os.WriteFile(socket, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if listener, err := openControlSocket(socket, os.Getgid()); err == nil {
		listener.Close()
		t.Fatal("non-socket control path was overwritten")
	}
	if string(readBin(t, socket)) != "keep" {
		t.Fatal("non-socket file changed")
	}
}

func TestControlServiceChild(t *testing.T) {
	if os.Getenv("FSC_AUDIT_CHILD") != "1" {
		return
	}
	os.Args = []string{os.Args[0], "--socket", os.Getenv("FSC_AUDIT_SOCKET"), "--app-gid", "0"}
	main()
}

func TestControlServiceStartsAnswersAndShutsDown(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("requires service ownership privileges")
	}
	socket := filepath.Join(t.TempDir(), "run", "control.sock")
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^TestControlServiceChild$")
	cmd.Env = append(os.Environ(), "FSC_AUDIT_CHILD=1", "FSC_AUDIT_SOCKET="+socket)
	var output bytes.Buffer
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill() }()
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: time.Second}
	var response *http.Response
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		response, err = client.Get("http://local/status")
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatal("service did not answer status", err)
	}
	var status Status
	err = json.NewDecoder(response.Body).Decode(&status)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || status.Version != toolVersion {
		t.Fatal("unexpected real service status", status, err)
	}
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal("service shutdown failed", err, output.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("service did not stop gracefully")
	}
	if fileExists(socket) {
		t.Fatal("shutdown left its control socket behind")
	}
}

func TestRetainedExecutableCleanupKeepsThisBootAndUnrelatedFiles(t *testing.T) {
	directory := t.TempDir()
	name := filepath.Join(directory, "binary")
	if err := os.WriteFile(name, []byte("original"), 0755); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(name)
	if err != nil {
		t.Fatal(err)
	}
	boot, err := retentionBoot()
	if err != nil {
		t.Fatal(err)
	}
	inode := strconv.FormatUint(info.Sys().(*syscall.Stat_t).Ino, 10)
	prefix := filepath.Join(directory, executableRetentionPrefix(name))
	current := prefix + boot + "-" + inode
	stale := prefix + "0000000000000000-" + inode
	for _, link := range []string{current, stale} {
		if err := os.Link(name, link); err != nil {
			t.Fatal(err)
		}
	}
	unrelated := prefix + "not-a-generated-link"
	if err := os.WriteFile(unrelated, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := cleanupPreviousExecutables(name); err != nil {
		t.Fatal(err)
	}
	if fileExists(stale) || !fileExists(current) || !fileExists(unrelated) {
		t.Fatal("cleanup removed the wrong retained files")
	}
}
