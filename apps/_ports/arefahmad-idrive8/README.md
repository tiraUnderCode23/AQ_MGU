# AQ ID8 adaptations of Aref applications

This is an AQ-maintained source adaptation, recipe revision **aq-aref-id8-2**. It is not a new release by the original author. The original IDs and versions are preserved. [PORT.json](PORT.json) records the exact public source commits and supported features; [PROVENANCE.json](PROVENANCE.json) records each published source file against the frozen snapshot in `apps/_sources/arefahmad-idrive7-apps`.

| Application | Version | Main application | Home-screen widget |
|---|---|---|---|
| Car Explorer (`aref_explorer`) | 0.2.3 | ID7 / ID8 | No widget declared |
| Car Care (`aref_carcare`) | 0.2.4 | ID7 / ID8 | ID7 target only; limitation shown on ID8 |
| Car Lyrics (`aref_carlyrics`) | 0.3.10 | ID7 / ID8 | ID7 target only; limitation shown on ID8 |

## Source and package contracts

The builder generates distinct ID7 and ID8 RHMI descriptions. ID7 resource generation remains identical to the frozen publisher kit. ID8 uses native list labels and buttons, a native renderer with touch routing, and the renderer's application area. It does not try to send an ID7 Graphic resource to ID8. If a suitable renderer is missing, a native label reports the requirement.

Car Explorer retains its existing dual-HMI package contract. Car Care and Car Lyrics use a target-specific package because their original home-screen widget has only ID7 templates. Each package declares the HMI it was built for, carries that main RHMI description, and records its target in `package.json` and runtime metadata. The source recipe supports both targets.

For widget applications, the builder selects the target through **`--target-hmi ID7` / `--target-hmi ID8`**, or through exactly one installed MainApp directory when the original Store runs the builder on the unit:

| Directory present | Inferred build target |
|---|---|
| `/usr/lib/oap-mainapp` only | ID7 |
| `/usr/lib/oap-mainapp21` only | ID8 |
| Neither, or both | Build rejected; supply an explicit target on a host |

SDK major version is never used as an HMI selector. A host build of Car Care or Car Lyrics requires an explicit target. The ID7 target keeps the publisher's widget manifest, resources and runtime configuration. The ID8 target omits all widget declarations/payloads, disables widget startup, and shows the unavailable feature in Settings and package metadata. No ID8 widget template is invented.

The applications require the original **`mgu-render >= 0.6.24`** renderer. The original Store may retain an installed compatible renderer provider; the application still checks native rendering, touch support and application area before showing its canvas. Car Lyrics' full-screen content and hit rectangles use the ID8 area's local width/height and header boundary. The area's absolute screen origin does not shift logical touch bounds. The original ID7 full-screen branch remains unchanged.

SDK files are supplied on the authorized target by the original Store and are not distributed in this source tree. The build and runtime still require the expected target SDK APIs and native services. Offline tests do not establish their availability on a particular unit.

## Application behavior

**Car Explorer** remains a read-only file inspector. It reads the platform interface catalog and the `src-gen` folder belonging to the loaded HMI family: `/usr/lib/oap-mainapp` for ID7 or `/usr/lib/oap-mainapp21` for ID8. Missing or ambiguous paths are reported. It does not subscribe to vehicle services or send vehicle commands.

**Car Care** retains the publisher's maintenance intervals, miles/kilometres, confirmation and cancel controls, and local service-history file. Its ID8 path uses `readonly_signals.js` for the same single odometer field. A successfully decoded current reading is required for mileage-based recording. Missing/invalid data, a failed read, provider loss, or more than three existing 30-second polling intervals without a sample prevents the cached number from being treated as live. The previous odometer remains labelled “last seen”; “Done today” and mileage-based “Done earlier” cannot silently use it. This changes only the app's own local records. BMW service reminders are not written.

**Car Lyrics** retains its original four declared media interfaces, track-selection rules, lyrics/artwork clients, pause/seek behavior, four-second clock interpolation ceiling, manual sync, Probe pages and local report output. Its ID8 reader enumerates fields and instances from the existing local catalog when generated raw configs are unavailable, then reads through the SDK typed member contract. Freshness is per field and per interface instance. A failed/unavailable/stale source cannot leave its old song selected as current. Probe marks cached values as “last seen”, and the main page reports unavailable current media data when no provider has a fresh sample. The original LRCLIB/iTunes clients still require the Store's internet/uplink path; offline tests do not call those services.

The new reader exports field reads and subscriptions only. It has no method-call, setter or raw-proxy export. The unchanged original `signals.js`, `parked.js` and `diag.js` remain available to the original ID7 path; the new application paths do not enable diagnostic calls or vehicle controls. ID8 subscriptions stop when these foreground applications are hidden, restart when opened, and stop at shutdown. Generation checks reject late callbacks; queued visibility events cannot reopen a shut-down app.

## Verification scope

`tests/test_id8_aref_port.py` retains the original Explorer generator, lifecycle, renderer, path and synthetic-package regressions. `tests/test_id8_aref_readonly_apps.py` exercises the additional applications and shared changes:

- Actual full `.tgz` and `.mgu` assembly for Car Care and Car Lyrics on both targets, using an unmistakably synthetic SDK. Target/HMI metadata, resource paths, widget presence/absence and donor licenses are checked.
- Identical ID7 UI output, preserved IDs/versions and action names, ID8 resources, and visible widget limitation.
- Rejection of unknown/ambiguous MainApp targets and an SDK-50 fixture built explicitly as ID7.
- Raw-reader preference, typed fallback, missing SDK/field handling, failed reads, provider loss, stale values, recovery, per-instance isolation, and stopped subscriptions with inert objects.
- The actual Car Care entry's double confirmation, metric/imperial recording, cancel, invalid/stale odometer, late callback and shutdown behavior.
- The actual Car Lyrics media reader and app entry, source changes, pause/clock limits, Sync/Probe/report controls, stale-track removal and shutdown.
- ID8 full-screen touch bounds, nonzero application-area origins and unchanged ID7 geometry.

The focused suite has **24 passing test methods**. It executes no OEM SDK, native binding, socket, installer or vehicle operation. **Actual unit build, head-unit installation/registration and live ID8 operation remain NOT OBSERVED.**

## Remaining Aref applications

Drive Log remains an implementation candidate: its background recording path uses `Car`'s cached multi-field samples and needs a separate freshness-aware trip-recording contract and headless lifecycle tests. Car Watch, Misfire Watch and the superseded Fault Watch also initialize the original diagnostic transport, so adding these read-only field adapters alone does not implement their ID8 backend. Those applications keep their existing source declarations. Tire Setup controls and fixed cluster/HUD features are not promoted by this adaptation.

## Attribution

The Aref applications and their kit retain their original notices. The ID8 resource and renderer adaptation follows the MIT cauliflowermossgrape kit. Lifecycle and typed field-member handling follow the public MIT Perea implementation, with additional AQ freshness, scoping and cleanup. Car Lyrics retains its original lyrics/artwork, JPEG decoder and Inter font licenses. All original and donor notices in this tree are copied into the derived target package. No OEM SDK, proprietary donor app, credentials or target-generated artifact is included.
