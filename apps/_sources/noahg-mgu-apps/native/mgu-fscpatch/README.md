# FSC patch service

Version 1.0.0 supports the inspected BAC4x build with stock SHA-256
`b26d18308c0f2ca1edd5aff8c373aa3aa659751e940cb6eed8509873670c1231`.
Unknown builds are refused before live changes. A matching stock binary backup
is required to repair an incomplete patch.

The factory modulus stays intact. A position-independent x86-64 wrapper calls
the original CAL signature verifier with the factory key first. Only an invalid
signature (`0xf9`) for the FSC key descriptor permits a second call with the
local public key. The original caller retains parsing, VIN, application,
upgrade and validity policy. Other key descriptors do not use the fallback.
The entire patched image must match the reconstructed known-stock profile,
including the payload, program header, detour, padding and trailer.

Support configuration is merged into the 30-record NVM block. Existing FSC
records are preserved byte-for-byte; missing originals can be recovered from
the retained support-block backup. Current certificates take priority over
backups of the same software identifier. A malformed block or insufficient
space aborts the operation. Deleted certificates cannot be recreated without
an original record or backup.

The service writes a one-time, root-owned pending job tied to the installed
binary's SHA-256. An autosaronlinux.service ExecStartPre drop-in commits it
after persistence mounts and before NVM is loaded. It merges certificates
flushed by the old running verifier during shutdown. Restore stages the
original block instead. Completed jobs are removed, firmware mismatches leave
the job for inspection, and a hook failure never prevents AUTOSAR startup.
`blockPending` and `restartRequired` expose the staged state to the app.

The app's Restart head unit action needs a second press within eight seconds.
POST /restart requests `/usr/bin/nsm_control --requestRestart 7 --normal`, using
the same unit restart mechanism as the Store. NSM refusal and timeout are
reported. Restart shares the operation mutex and root/method/body checks.

Validation: the native suite runs under Linux 4.14.328 in QEMU with a temporary
ext4 disk, read-only tmpfs mounts and executing ELF fixtures. A production-code
round trip patches the captured known build and restores it byte-for-byte.
An offline harness executes the patched image's original CAL routines with
four captured factory FSCs and rejects altered copies. A disposable RSA test
key exercises the same fallback instructions with its public modulus
substituted only in the test image. No private key or vehicle file is packaged
in the app or service. The separate offline generator intentionally publishes
the matching local signing key under `scripts/fsc_generator/`.
Physical head-unit restart/persistence validation remains pending.

The custom wrapper source is in payload/dual.c and payload/dual.ld. It was
built with GCC 11 (`-Os -fPIC -fno-stack-protector
-fno-asynchronous-unwind-tables -ffreestanding -fno-builtin`), linked with GNU
ld using dual.ld, and extracted using objcopy -O binary. The embedded payload
SHA-256 is `e3b729890e619d1c5e24d069c301facbd4df35699cee48d3f040075ceb0fbe6d`.

The local key's little-endian modulus SHA-256 is
`d4f1ebaece4e4dbc1536a28eaa15b6b9f80f50213bd485ba01495fb2c6c469e0`.
The installed verifier accepts OEM and local signatures; factory FSCs keep the
OEM verification path.
