# AQ_MGU source import: M Arcade

Original repository: https://github.com/iAbadia/idrive-games

Pinned commit: `247324d718be76d5380ce148561676d495c61d26`.
Upstream tree: `feb709b2029f9cfded2d32f7b5aedba6e0b5b851`.

This is a selected, byte-for-byte source snapshot. `UPSTREAM_IMPORT.json`
records the upstream Git blob ID, byte length and SHA-256 of every imported
upstream file. `AQ_IMPORT.md` and `UPSTREAM_IMPORT.json` are AQ_MGU provenance
records, not original upstream files.

## Included component

`iabadia_m_arcade` version **0.1.3** contains six games in one application:
2048, Minesweeper, Snake, Tetris, Space Invaders and Breakout. The upstream
branch exposes only this app. The older standalone applications are frozen
reference material and are not additional Store entries.

The source manifest declares `build: unit`, `mguHmi: ["ID7"]` and
`requires: {"mgu-render": "0.6.9"}`. The app's `mgu-app.json` lists 42
JavaScript modules and its staged package tree. All listed modules, RHMI
descriptions, icons, configuration and license notices are included.

The Store's original source linker obtains required SDK modules from the
authorized target environment. No BMW SDK, firmware, `node_modules`, ready
`.mgu`/`.tgz` package, or GitHub Actions workflow is included. Presence of
the source is not proof of a completed build or an installation on a unit.

## Source and licenses

The application and packaging tools are GPL-3.0-or-later. The original root
`LICENSE`, `THIRD_PARTY.md`, and package-level GPL, MIT kit and SIL OFL font
notices are retained. The legacy 2048 leaderboard helper is included because
the current app's explicit offline save importer uses it. Its corresponding
referenced font and kit notices are retained at their original paths; the
legacy app itself is not offered by the source feed.

The root upstream `package.json` is intentionally omitted because its test
scripts target the entire historical repository. The original READMEs are
preserved as upstream documentation. Within this selected snapshot, use
these focused local commands instead:

```sh
node apps/iabadia_m_arcade/tools/test.js
node apps/iabadia_m_arcade/tools/test_app.js
node apps/iabadia_m_arcade/tools/build.js
```

The first two commands exercise pure game, persistence, fake SDK and local
socket behavior. The build command without `--sdk` creates a source archive;
it does not prove target SDK compatibility or perform a head-unit install.
Keep generated archives out of this source snapshot. The original app's
`tools/build.js` and shared `tools/oap_link.js`/`oap_pack.js` remain unchanged.

## Verification on 2026-11-19

- All 141 upstream files still match their recorded Git blob IDs, sizes and
  SHA-256 values after verification.
- All 42 declared modules, the package identity, ID7 RHMI tree and retained
  license files are present. No ID8 support is inferred.
- The upstream M Arcade integration suite passed **31 tests** under Node.js
  v24.22.3.
- The separate native-lifecycle test passed its initial mocked startup and
  navigation groups, then stopped because this execution environment refused
  creation of a local Unix socket (`listen EPERM`). That test suite is not
  reported as a full pass, and its behavior was not changed to hide the error.
- The original source packer created a temporary archive with 63 members,
  342,209 bytes and SHA-256
  `101fcc617ddf389d8254a82c94576433d5dce66787344de306fcf61605ab15f3`.
  This archive is an offline source-packaging check, not a ready release
  package. No real SDK build or head-unit installation was performed.
