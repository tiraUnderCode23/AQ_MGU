package main

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var nsmError = regexp.MustCompile(`\[Error\.\s*([^\]]*)\]`)

func requestHeadUnitRestart() error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "/usr/bin/nsm_control", "--requestRestart", "7", "--normal").CombinedOutput()
	return checkRestartResult(output, err)
}
func checkRestartResult(output []byte, err error) error {
	if match := nsmError.FindSubmatch(output); match != nil {
		return fmt.Errorf("head unit refused restart: %s", strings.TrimSpace(string(match[1])))
	}
	if err != nil {
		return fmt.Errorf("head unit restart request failed: %w", err)
	}
	return nil
}
