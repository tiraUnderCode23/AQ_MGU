# MGU Storage Monitor — AQ ID7 / ID8 source port

AQ **1.2.4** derives from BMWEnthusiastUK/mgu-storage-monitor **1.2.3**, revision **aq-storage-id8-1**. This is an AQ source adaptation, not an upstream publisher release. The original snapshot stays unchanged in `apps/_sources/bmwenthusiast-storage-monitor`; its readme is retained as `README.upstream.md`.

## What changed

The builder generates actual target-specific ID8 RHMI resources, platform declarations and matching text/icon variants. The runtime implements the public ID8 lifecycle and loaded-resource marker, native renderer application-area placement, text cells and touch routing. ID7 UI output is compared to the original generator. The source requires **mgu-render >= 0.6.24**.

The application still reads filesystem space only. There is no vehicle signal backend, network activity or deletion capability. Its original asynchronous `df -Pk -- <path>` argument contract, 2.5-second process deadline, parser, duplicate-mount treatment and KiB-to-GB conversion are retained. The path is passed as a separate argument; there is no shell interpolation.

The original **manual start** declaration remains in generated packages. A visible page performs one asynchronous read batch at a time, refreshing every 15 seconds. Hidden pages start no read batches. Hiding or shutting down invalidates pending results and stops the timer; a late visibility event after shutdown cannot restart it. If MAIN is already visible when the app attaches, it gets its initial frame. The publisher's original `Life` ACTIVE/INACTIVE implementation is retained and connected to both loaded HMI families, preserving inactive status when hidden and active status when shown again.

The app has no home-screen widget, so no widget is removed. Native ID8 canvas rendering, touch routing and a valid renderer-reported application area remain prerequisites. Missing renderer support is reported through native RHMI text. Free filesystem space is not a guarantee of app-install capacity; that existing limitation remains on screen.

## Build and notices

Build with `kit/tools/build.py ab_storage --target-hmi ID7` or `--target-hmi ID8` and the intended target's supplied SDK. Without an explicit option, exactly one MainApp family must exist: `/usr/lib/oap-mainapp` or `/usr/lib/oap-mainapp21`. Unknown or ambiguous hosts are rejected. SDK version alone never selects the build target. Both archive formats contain only the chosen HMI, matching resources, explicit AQ/original versions and dependency metadata.

The original root MIT license, `THIRD_PARTY_LICENSES`, kit MIT license, donor MIT licenses and font notices are included in generated source packages. No OEM SDK, native renderer binary or prebuilt donor package is included in this source tree. `PORT.json` and `PROVENANCE.json` document the derivation and exact bytes.

## Evidence and limits

`python3 -m unittest discover -s tests -p 'test_id8_storage_port.py' -v` runs seven focused offline tests from the repository root. They exercise actual target package assemblers with a synthetic SDK, original ID7 UI equality, the actual parser and asynchronous reader using inert process callbacks, hidden/visible/shutdown behavior, initial visibility, real platform lifecycle/entry flow, ACTIVE/INACTIVE transitions and application-area geometry with mocks. No host `df`, real SDK, socket, renderer or vehicle service is executed.

**Actual target build, registration and live installation: NOT OBSERVED.** The target must provide its SDK, native renderer and accessible filesystem/process capability. Tests demonstrate source behavior and archive structure under the stated fixtures; they are not a live installation receipt.
