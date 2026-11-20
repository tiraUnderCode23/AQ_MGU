# Track Mode — AQ ID7 / ID8 source port

AQ **1.0.1** derives from DimonPrograms/dimonprograms-apps **1.0.0**, revision **aq-dimon-track-id8-1**. The publisher snapshot remains unchanged in `apps/_sources/dimonprograms-apps`; its readme is retained as `README.upstream.md`. This family contains **Track Mode only**. Dimon Battery's diagnostic backend is not ported here.

## Implemented behavior

The builder generates real target-specific ID8 RHMI resources and public platform declarations. The runtime uses the loaded HMI marker, ID8 lifecycle, native renderer application area and touch routing. ID8's canvas has an actual **Start lap / Lap / next lap** touch button. The original lap timer, sector logic, demo generator, artwork and ID7 UI output are retained.

ID8 reads only the original Vehicle2 `statusCarSpeed2` field through a read-only SDK adapter. Polling is at 1 second, readings expire at 3 seconds, and one getter per field remains outstanding even after a reporting timeout. Provider loss, invalid/sentinel values, expiry and clock rollback make speed unavailable. Hiding MAIN stops its reader; late values from that reader cannot return. The original >5 km/h automatic-start rule runs only after a fresh actual sample. Missing SDK members or providers never qualify speed.

Manual lap/sector timing stays usable without speed. A lap with an observed reading gap or no speed samples saves **null** speed statistics and an explicit incomplete marker; it displays the limitation. No old speed or invented zero is presented as a complete lap's maximum/average. The original sample-mean calculation is retained for laps with available samples. Lap boundaries remain manual; this app gains no GPS positioning or automatic lap recognition.

ID8 has no automatic demo fallback. Explicit demo remains labelled and its laps are not saved to the real lap history. The original unused CDS2 acceleration declaration is omitted from the ID8 package; no new vehicle method, setter or control permission is introduced.

## Build contract

Use `kit/tools/build.py dimon_track_mode --target-hmi ID7` or `--target-hmi ID8` with the intended target's supplied SDK. Otherwise exactly one of `/usr/lib/oap-mainapp` and `/usr/lib/oap-mainapp21` must exist; unknown/ambiguous hosts are rejected. SDK major does not select HMI. Generated `.tgz` and `.mgu` packages contain the chosen HMI only, matching resource variants, AQ/source versions, dependency fields and limitations.

The source requires **mgu-render >= 0.6.24**. Native rendering, touch routing and a valid application area remain required for the ID8 canvas. The source includes no OEM SDK, donor binary or compiled renderer. Original MIT, donor MIT and font notices are retained in generated source packages.

## Verification

`python3 -m unittest discover -s tests -p 'test_id8_dimon_track.py' -v` runs seven focused offline tests from the repository root. They cover original ID7 UI equality, real package assemblers with synthetic SDK input, actual main/touch/sector/save callbacks in an in-memory filesystem, automatic-start and unavailable statistics, provider loss/expiry/cleanup, original timer logic, bounded read-only adapter failures, actual platform lifecycle and geometry under inert mocks.

**Actual target SDK build, registration and live installation: NOT OBSERVED.** Compatible target SDK field definitions/provider and native renderer remain prerequisites. Offline tests are not a live vehicle receipt. Source derivation and file hashes are recorded in `PORT.json` and `PROVENANCE.json`.
