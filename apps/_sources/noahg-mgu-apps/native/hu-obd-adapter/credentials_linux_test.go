//go:build linux

package main

import (
	"os/exec"
	"testing"
)

func TestSOMEIPCredentialsMatchPerAppACL(t *testing.T) {
	cmd := &exec.Cmd{}
	if e := workerCredentials(cmd, 12451, 12202); e != nil {
		t.Fatal(e)
	}
	c := cmd.SysProcAttr.Credential
	if c.Uid != 12451 || c.Gid != 12451 {
		t.Fatal("credentials differ from MainApp's userId/groupId ACL", c)
	}
	if len(c.Groups) != 1 || c.Groups[0] != 12202 {
		t.Fatal("shared socket group missing or daemon groups inherited", c.Groups)
	}
}
