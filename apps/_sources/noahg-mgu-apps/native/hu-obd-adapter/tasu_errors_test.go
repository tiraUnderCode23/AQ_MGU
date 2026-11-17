package main

import (
	"context"
	"errors"
	"os"
	"syscall"
	"testing"
)

func TestWorkerStartupErrorsAreSpecificWithoutPrivatePaths(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code string
	}{
		{os.ErrPermission, "worker_permission_denied"}, {os.ErrNotExist, "worker_missing_path"},
		{syscall.EAGAIN, "worker_resource_limit"}, {syscall.ENOMEM, "worker_resource_limit"},
		{syscall.EMFILE, "worker_resource_limit"}, {syscall.E2BIG, "worker_argument_limit"},
		{errors.New("private text"), "worker_start_failed"},
	} {
		wrapped := &os.PathError{Op: "fork/exec", Path: "/private/app/identity", Err: tc.err}
		if code := tasuErrorCode(workerStartFailure(wrapped)); code != tc.code {
			t.Fatal(code, tc.code)
		}
	}
}

func TestTASUErrorStatusIsSpecificAndRedacted(t *testing.T) {
	s := newService(defaults())
	s.newTASU = func(context.Context) (vehicle, error) { return nil, tasuFailure("module_load_failed") }
	if _, e := s.ensureTASU(context.Background()); e == nil {
		t.Fatal("failure ignored")
	}
	st := s.snapshot()
	if st.TASU != "unavailable" || st.TASUError != "module_load_failed" {
		t.Fatal(st)
	}
	if tasuErrorCode(errors.New("private VIN or filename")) != "transport_failed" || tasuErrorCode(tasuFailure("private text")) != "transport_failed" {
		t.Fatal("private error leaked")
	}
	s.newTASU = func(context.Context) (vehicle, error) { return newVINVehicle("WBA12345678901234"), nil }
	if _, e := s.ensureTASU(context.Background()); e != nil {
		t.Fatal(e)
	}
	defer s.closeTASU()
	if st = s.snapshot(); st.TASU != "ready" || st.TASUError != "" {
		t.Fatal("stale failure after recovery", st)
	}
}
