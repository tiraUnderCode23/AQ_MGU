//go:build !linux

package main

import (
	"errors"
	"os/exec"
)

func workerCredentials(_ *exec.Cmd, _, _ int, _ ...string) error {
	return errors.New("TASU helper requires Linux OAP credentials")
}
