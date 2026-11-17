//go:build !linux

package main

import "os"

func preserveFileMetadata(file *os.File, source string, info os.FileInfo) error { return nil }
func syncDirectory(path string) error                                           { return nil }

func replaceDestination(temporary, path string, info os.FileInfo, mode os.FileMode) error {
	return os.Rename(temporary, path)
}
func cleanupPreviousExecutables(path string) error { return nil }

func restartPending(path string) bool { return false }
