# Hexlay apps: AQ source port for ID7 and ID8

This directory contains a derived source build of **System Monitor 1.0.4**, **Spotify 1.0.30** and **M-Copilot 1.0.31**. Application IDs and upstream versions are unchanged. The AQ build revision is `aq-hexlay-id8-1`; it is recorded in `PORT.json` and in each generated package's `aqSourcePort` field. The original snapshots remain in `apps/_sources/hexlay-idrive7-apps`.

## Implemented changes

The builder emits separate ID7 and ID8 RHMI descriptions inside the npm `.tgz` package. ID8 uses the original Store's list, media-entry button and scroll-label templates, appropriate text cells, and an explicit resource marker. Its platform manifest includes the corresponding second-generation HMI interfaces. ID7 resources are identical to the original generator for all three apps in English and Chinese.

The runtime uses the resource marker to select the HMI behavior after startup. The SDK version is only an early lifecycle hint. ID8 entry points receive resources, initialization, state mapping and availability before foreground initialization. Tile callbacks and cold foreground entry opening are covered by inert SDK tests; no fixed applet ID or unit UID is introduced.

The canvas uses a touch-capable `mgu-render/1` provider. Reported app-area coordinates take priority, including a nonzero horizontal origin. The known 2880 × 960 profile has a bounded default area of `(0, 76, 2880, 764)` when the renderer reports no area. An unknown display or an invalid reported area does not receive an overlay. The ID8 touch header owns Settings without requiring a controller gate. A renderer without the required capabilities leaves native ID8 controls available and displays a waiting message; the runtime does not allocate unsupported native Graphic resources.

The fork's panel sizing, text sizing, touch target handling, scrolling, cloud integration and application code are retained, with the M-Copilot guard change described below. Spotify authentication, network access and playback were not exercised.

## M-Copilot data and read-state guard

The typed SDK adapter is enabled only after the loaded UI identifies ID8, and only when a native interface configuration is unavailable. The native path remains preferred. A constructed typed proxy is not enough to mark a subscription live: a received field or a successful getter is required. Failed getters expose an error and mark the subscription unavailable; existing polling can recover after a successful read. If the SDK exposes availability and shutdown methods, they are forwarded. Original polling cleanup is preserved.

M-Copilot remains read-only. Its derived `steady()` guard requires the RPM and vehicle-condition providers to be available, with valid decoded samples no older than five seconds. Unknown, stale, demo and transition states pause diagnostic reading and display **“Vehicle state unavailable; diagnostic reading paused.”** Existing declared RPM and condition getters are polled every two seconds on ID8. This is a narrow change in `apps/m_copilot/main.js`, supported by per-field timestamps in `kit/runtime/car.js` and the pure `id8_read_guard.js` helper. No new vehicle method or write operation is added.

Availability of a particular SDK typed interface, field, getter or diagnostic service remains a target prerequisite. If it is missing, the application reports unavailable data. These tests do not establish actual vehicle telemetry or diagnostic behavior.

## Install contract

The supported ID8 route is the **original MGU Store source builder and npm `.tgz` installer**, which select the appropriate resources and perform ID8 registration. Store must provide a compatible local SDK and the unit's interface catalog. The old `.mgu` staging layout produced by this inherited builder remains ID7; it is not an ID8 installation route.

The derived recipes require `mgu-render >= 0.6.24`. Store's installed-provider substitution can retain a different renderer, so runtime capabilities remain necessary. The source port keeps native controls available when the retained provider cannot support the canvas. Use the repository's Store installation documentation for the native sources and queued ID8 installation contract.

## Validation and limits

Run the self-contained local contract suite from the repository root:

```sh
python -B apps/_ports/hexlay-idrive8/tests/test_port.py -v
```

The suite checks ID7 resource equality in two languages, ID8 resources and state IDs, three actual `.tgz` builds with a synthetic SDK, embedded license notices, generated icons and package metadata. It also runs 82 JavaScript assertions against inert SDK, renderer and signal mocks, including actual runtime entry callbacks, touch Settings, label text, geometry bounds, typed getter failure and recovery, and the M-Copilot read guard. Synthetic SDK files and generated packages exist only in a temporary directory and are deleted by the test.

**Target SDK50 behavior, live UI rendering, Store installation, online services and vehicle providers: NOT_OBSERVED.** Passing offline checks means the source and generated package contracts were exercised; it does not certify a particular head unit.

## Source and licenses

The base source is [Hexlay at `04a42559a6d94d52d5a17bb2a7231e2142b26079`](https://github.com/hexlay/idrive7-custom-apps/tree/04a42559a6d94d52d5a17bb2a7231e2142b26079), under GPL-3.0-or-later with its retained MIT notices. The narrowly adapted dual-HMI generator, cells and display protocol come from [cauliflowermossgrape at `422957a85461826c1e8654d37c8ec66a94849f9c`](https://github.com/cauliflowermossgrape/idrive7-apps/tree/422957a85461826c1e8654d37c8ec66a94849f9c). Lifecycle and typed SDK adapter patterns come from [Alex Perea at `5b758fad17761b8696989e2a4ffbfbfab4926b6f`](https://github.com/alexpereap/pereaperformance-idrive7-apps/tree/5b758fad17761b8696989e2a4ffbfbfab4926b6f).

`LICENSE`, `LICENSE.MIT`, `LICENSE.PEREA` and `PORT.json` are copied into each installed npm payload. Font notices remain beside their source data. `PROVENANCE.json` records exact original and derived hashes, identifies modified files and preserves the pinned donor references. No OEM SDK, generated deployment archive or renderer binary is included here.
