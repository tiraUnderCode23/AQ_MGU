package main

import (
	"errors"
	"os"
	"syscall"
)

// Only fixed codes cross the local management boundary. Native exception
// text, ECU payloads and filenames never become status/export fields.
type tasuFailure string

func (e tasuFailure) Error() string { return string(e) }
func tasuErrorCode(e error) string {
	var failure tasuFailure
	if errors.As(e, &failure) {
		switch string(failure) {
		case "helper_not_installed", "config_missing", "config_invalid", "multiple_helpers", "module_load_failed", "proxy_init_failed", "subscribe_failed", "availability_timeout", "worker_start_failed", "worker_permission_denied", "worker_missing_path", "worker_resource_limit", "worker_argument_limit", "helper_permissions", "worker_exited", "request_refused", "transport_failed", "vin_refused", "vin_invalid":
			return string(failure)
		case "tas_connection_error", "invalid_request", "invalid_length", "wrong_identifier":
			return string(failure)
		case "request_busy", "method_timeout", "ecu_timeout", "request_timeout", "diagnostics_deactivated", "invalid_session", "exclusive_mode", "transport_rejected", "malformed_reply", "provider_unavailable", "coordinator_unavailable", "coordinator_lost", "method_verdict_invalid":
			return string(failure)
		}
	}
	if errors.Is(e, errVINRefused) {
		return "vin_refused"
	}
	return "transport_failed"
}

func workerStartFailure(e error) error {
	switch {
	case errors.Is(e, os.ErrPermission):
		return tasuFailure("worker_permission_denied")
	case errors.Is(e, os.ErrNotExist):
		return tasuFailure("worker_missing_path")
	case errors.Is(e, syscall.EAGAIN), errors.Is(e, syscall.ENOMEM), errors.Is(e, syscall.EMFILE), errors.Is(e, syscall.ENFILE):
		return tasuFailure("worker_resource_limit")
	case errors.Is(e, syscall.E2BIG):
		return tasuFailure("worker_argument_limit")
	default:
		return tasuFailure("worker_start_failed")
	}
}
