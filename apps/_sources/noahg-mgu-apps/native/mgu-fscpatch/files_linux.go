package main

import (
	"errors"
	"os"
	"os/user"
	"strconv"
	"strings"
	"syscall"
)

func preserveFileMetadata(file *os.File, source string, info os.FileInfo) error {
	if info == nil {
		if source == unitLocations().BlockPath {
			u, err := user.Lookup("sf_autosaronlinux")
			if err != nil {
				return err
			}
			g, err := user.LookupGroup("mgu_persist")
			if err != nil {
				return err
			}
			uid, err := strconv.Atoi(u.Uid)
			if err != nil {
				return err
			}
			gid, err := strconv.Atoi(g.Gid)
			if err != nil {
				return err
			}
			return file.Chown(uid, gid)
		}
		return nil
	}
	stat := info.Sys().(*syscall.Stat_t)
	if err := file.Chown(int(stat.Uid), int(stat.Gid)); err != nil {
		return err
	}
	size, err := syscall.Listxattr(source, nil)
	if errors.Is(err, syscall.ENOTSUP) {
		return nil
	}
	if err != nil {
		return err
	}
	names := make([]byte, size)
	size, err = syscall.Listxattr(source, names)
	if err != nil {
		return err
	}
	for _, name := range strings.Split(string(names[:size]), "\x00") {
		if name == "" {
			continue
		}
		size, err := syscall.Getxattr(source, name, nil)
		if err != nil {
			return err
		}
		value := make([]byte, size)
		size, err = syscall.Getxattr(source, name, value)
		if err != nil {
			return err
		}
		if err := syscall.Setxattr(file.Name(), name, value[:size], 0); err != nil {
			return err
		}
	}
	return nil
}

func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
