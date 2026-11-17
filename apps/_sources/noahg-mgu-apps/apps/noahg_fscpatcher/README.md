# FSC Patch

FSC Patch inspects, patches, or restores the FSC verifier on a supported BMW
MGU head unit. Version `1.0.0` recognizes one inspected BAC4x verifier build;
unknown or modified builds are refused before a live change.

> [!WARNING]
> Patching changes a system binary and persistent FSC data. An interruption,
> incompatible firmware, or incorrect recovery can make navigation or other
> head-unit functions unavailable. Review the source and keep a recoverable
> backup before making changes.

For the supported build, FSC Patch:

- keeps the factory verification key and factory FSC path intact;
- adds a fallback verification path for the intentionally public local key;
- preserves existing FSC records while merging the local support certificate;
- creates and verifies backups before changing the verifier or support block;
- supports restoring the original files; and
- stages persistence changes for the next head-unit restart.

The app uses the Store-managed
[`mgu-fscpatch` service](../../native/mgu-fscpatch/README.md). Its local
root-only control socket performs patch, restore, and restart operations after
confirmation in the UI.

The separate [FSC generator](../../scripts/fsc_generator/README.md) creates
application and ID7 Live-map FSC files for the local key accepted by the
patch. Its signing key is deliberately public interoperability material, not
an access credential.

## Build and test

Requirements:

- Node.js 24 or later
- Python 3.12 or later
- Go 1.23 or later

From the repository root:

```sh
npm test
npm run test:fsc
npm run test:generator
npm run build:fscpatch
npm run build:apps
```

The app package and native service are committed with source fingerprints and
checksums. Rebuild the affected artifact after changing the app, shared kit,
service, or native payload.
