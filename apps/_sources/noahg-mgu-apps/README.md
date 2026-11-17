# MGU Apps

Open-source apps and companion services for BMW MGU head units (iDrive 7).

This repository is the public source catalog for apps distributed through
[MGU Store](https://github.com/robertnisipeanu/mgu-store). Apps are added with
their source, documentation, tests, and release artifacts when they are ready
for public release.

> [!WARNING]
> These are unofficial hobby projects. They are not affiliated with or
> supported by BMW AG. Some apps can modify head-unit or vehicle data. Read an
> app's documentation, compatibility notes, and recovery procedure before
> installing or using it.

## Published apps

| App | Version | Support | Description |
|---|---:|---|---|
| [**FSC Patch**](apps/noahg_fscpatcher/README.md) | `1.0.0` | iDrive 7 | Inspect, patch, or restore a supported FSC verifier. |
| [**OBD Bridge**](apps/noahg_obdbridge/README.md) | `1.0.0` | iDrive 7 | Bridge the supported BM3 diagnostic protocol over the car hotspot. |

Each app documents its own requirements, companion services, build commands,
and validation status. Component dependencies and minimum versions are
declared in [mgu-repo.json](mgu-repo.json).

## Install with MGU Store

1. Install and configure
   [MGU Store](https://github.com/robertnisipeanu/mgu-store) on the head unit.
2. Add the GitHub source `Noahbg/mgu-apps`.
3. Select an app and review its documentation and compatibility notes.
4. Install it through the Store and restart the head unit if prompted.

MGU Store installs declared companion components in dependency order, verifies
their checksums, and supplies BMW's app SDK locally from the owner's own head
unit.

## Development

Use Node.js 24 or later. Run the repository tests and source validation with:

```sh
npm test
```

Individual apps and native components may require additional toolchains and
tests. Their READMEs contain the relevant commands.

Build all registered SDK-free app packages:

```sh
npm run build:apps
```

Generate a hosted catalog or an offline USB source:

```sh
npm run export:public
npm run export:usb
```

To refresh a USB stick directly, pass its root. The exporter replaces only
`mgu-repo/noahg-apps`, removing stale packages from earlier exports while
leaving other Store sources untouched:

```powershell
npm run export:usb -- G:\
```

Builds are checked against source fingerprints. Generated distributions go
under `dist/` and are excluded from version control.

## Repository layout

```text
apps/<id>/                    App source, documentation, icon and package
apps/<id>/prebuilt/           Audited Store-ready app artifact and metadata
native/<component>/           Native companion source and audited artifact
scripts/<tool>/               Standalone tools associated with released apps
kit/                          Shared SDK-free app build and runtime components
tools/                        Repository validation, build and export tooling
test/                         Repository-wide tests
mgu-repo.json                 MGU Store source index and dependency graph
```

## Transparency and licensing

The repository is MIT licensed. Vendored runtime, font, and Go notices are
retained in place and summarized in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Audited prebuilt artifacts
are committed alongside their source so users can inspect exactly what MGU
Store distributes; validation checks their checksums and source fingerprints.

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) before
submitting a change.
