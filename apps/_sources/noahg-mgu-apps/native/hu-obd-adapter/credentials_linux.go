//go:build linux

package main

import (
	"os"
	"os/exec"
	"syscall"
)

func workerCredentials(cmd *exec.Cmd, uid, sharedGID int, accessDirs ...string) error {
	// MainApp provisions SOME/IP ACLs as userId/groupId=userId. The shared
	// tm_oap_app group grants local socket access; it is supplementary.
	groups := []uint32{uint32(sharedGID)}
	for _, dir := range accessDirs {
		info, e := os.Stat(dir)
		if e != nil || !info.IsDir() {
			return tasuFailure("helper_permissions")
		}
		st, ok := info.Sys().(*syscall.Stat_t)
		if !ok {
			return tasuFailure("helper_permissions")
		}
		// Parent persistence storage is group-only on ID7 (mgu_persist).
		// Keep the app UID and include only these installed directories'
		// owning groups, never the root group or the daemon's full group set.
		if st.Gid == 0 {
			continue
		}
		found := false
		for _, g := range groups {
			if g == st.Gid {
				found = true
				break
			}
		}
		if !found {
			groups = append(groups, st.Gid)
		}
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: uint32(uid), Gid: uint32(uid), Groups: groups}}
	return nil
}
