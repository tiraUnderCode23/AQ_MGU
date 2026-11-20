# Parked Games — AQ ID7 / ID8 source port

This is an AQ-derived source package for the eight original MaxxxFoka games. The unchanged publisher snapshot remains in `apps/_sources/maxxxfoka-idrive7games`; the original readme is `README.upstream.md` here. AQ version **0.2.3** derives from publisher **0.2.2**, revision **aq-parked-games-id8-1**. This patch version lets the original Store distinguish the source adaptation from an already installed original package.

## Actual changes

The builder generates real ID8 RHMI resources, platform declarations and target-specific application resources. The runtime uses the public ID8 lifecycle, native renderer application area, ID8 text cells and touch coordinates. The original game directory structure, game data, locales and identity are retained. ID7 UI generation and original game tests are checked for regression.

On ID8, the existing Vehicle2 speed field uses a read-only public SDK field adapter. Games remain paused until a valid current sample is available. Unknown values, invalid sentinels, getter failure, provider loss, old samples and clock rollback close the game gate. The threshold is the original shell's stricter **3 km/h** threshold. The existing 2-second poll gives a 6-second expiry bound; each frame and game input rechecks the gate. No diagnostic or vehicle control methods are added.

ID8 uses touch for all eight single-player games. Raw FrontCCU controller fallback is omitted from the ID8 manifest and code path. Chess's friend mode and Paddle Duel's two-player mode are visibly unavailable unless the native renderer actually exposes its controller gate; a saved multiplayer game is checked again. The ordinary menu, single-player input and game artwork are preserved.

## Build target and package

Use the publisher builder `kit/tools/build.py parked_games --target-hmi ID7` or `--target-hmi ID8` with the SDK supplied by the intended target. When the option is omitted, the builder accepts exactly one installed MainApp family: `/usr/lib/oap-mainapp` for ID7 or `/usr/lib/oap-mainapp21` for ID8. An unknown or ambiguous host is rejected. SDK major version is never used to choose HMI. Each generated package declares only its selected target and contains matching RHMI resources, strings and icon variants.

The source requires **mgu-render >= 0.6.24**. ID8 canvas also requires native rendering, touch routing and a valid renderer-reported application area. Absent prerequisites produce a visible native message, not an invented software graphics path. The original preview-only mode remains non-installable. This repository contains no OEM SDK or generated installation archive.

## Verification and limits

`python3 -m unittest discover -s tests -p 'test_id8_parked_games.py' -v` runs seven focused tests from the repository root: both target package assemblers with a synthetic SDK, original ID7 UI comparisons, all eight publisher pure game test programs, actual-shell stationary/freshness/input tests, multiplayer capability checks and synthetic platform lifecycle/geometry tests. They use inert transports and temporary outputs.

**Actual target build, registration and live installation: NOT OBSERVED.** A matching target SDK/provider and native renderer remain installation prerequisites. Offline package structure and simulation do not prove an installed vehicle session.

Original MIT notices, donor MIT notices and font licenses are retained and copied into generated packages. Exact derivation and file hashes are in `PORT.json` and `PROVENANCE.json`.
