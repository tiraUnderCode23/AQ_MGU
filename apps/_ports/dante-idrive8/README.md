# E85 Blend — AQ ID7 / ID8 source port

AQ **1.2.2** is derived from Dante1243/dante-idrive-apps **1.2.1**, revision **aq-dante-e85-id8-1**. This is an AQ source adaptation, not an upstream release. The unchanged original is in `apps/_sources/dante-idrive-apps`; its readme is retained here as `README.upstream.md`.

## ID8 behavior

The actual ID8 RHMI resource generator, public SDK lifecycle, native renderer placement, touch settings and text-cell mapping are implemented. The existing 1600×520 logical artwork is placed inside the renderer-reported application area. The original ID7 UI output and the original `blend.js` accounting and `tank.js` implementation are retained.

ID8 has two explicit tank input choices in Settings:

- **Kombi gauge (read only):** the original `statusRangeTankStatus` member on `de.bmw.infotainment.KombiIF`, if the target SDK/provider supplies it. The original median, settling and plausible-consumption logic still processes real readings. A 2-second polling schedule expires readings after 6 seconds. At most one getter per field can remain outstanding; a 3.5-second reporting timeout marks the read unavailable without starting an overlapping SDK request. Unknown, invalid, old, clock-rollback or unavailable-provider data is cleared, including its odometer; provider recovery starts a new settling history. Hiding the main page stops the reader, and late callbacks from that reader are discarded.
- **Manual current litres:** explicit whole litres and tenths settings. These values are labelled **MANUAL TANK** and are usable by the local blend calculator and recorded pump-litre/cost workflow. Recorded guided pours update this explicit manual volume. A manual value has no odometer and cannot become a car-measured fill, automatic level-rise event or tank-size suggestion.

**DME tank diagnostics are unavailable on ID8.** The installed ID8 manifest omits InternalTasu, and the ID8 tank class never constructs the original diagnostic reader. This limitation is displayed on the tank page and in the package metadata. ID7 retains its original source path. ID8 has no automatic demo fallback: only a deliberately selected, visibly labelled demo uses demo data. A missing Kombi member is reported and the manual input option remains available.

The original fuel history, pump adjustments, costs and local blend equations remain. No vehicle control method or setter is introduced.

## Build contract

The builder is `kit/tools/build.py e85 --target-hmi ID7` or `--target-hmi ID8`, with an SDK supplied by the intended target. Without the option, exactly one installed MainApp directory must exist: `/usr/lib/oap-mainapp` or `/usr/lib/oap-mainapp21`. Unknown or ambiguous hosts are rejected; SDK version alone never determines HMI. Each `.tgz` and `.mgu` contains only the chosen HMI resources, matching resource variants, package HMI, explicit AQ revision, dependency fields and feature limitations.

The source requires **mgu-render >= 0.6.24**. Native rendering, touch routing and a valid application area remain prerequisites for the ID8 canvas; otherwise the native RHMI UI explains the unavailable renderer. The source tree includes no OEM SDK, prebuilt donor archive or native renderer binary.

## Offline evidence and limits

From the repository root, `python3 -m unittest discover -s tests -p 'test_id8_dante_e85.py' -v` runs eight focused tests. They exercise the actual target package builder with a conspicuous synthetic SDK, ID7 UI identity, actual main/controller callbacks with an in-memory filesystem, the actual ID8 tank/freshness class with inert fields, pure volume/ethanol/cost accounting, read-only adapter failures/recovery, lifecycle and application-area geometry. Neither network, a real SDK, a native renderer nor a vehicle service is used.

**Target SDK build, head-unit registration and live installation: NOT OBSERVED.** The tests establish source and package behavior under the stated mocks; compatible target field members and providers remain unobserved prerequisites.

Original MIT licenses, donor MIT credits and font notices are retained and copied into installed source packages. `PORT.json` records scope and `PROVENANCE.json` records exact bytes and original comparisons.
