# AQ AppStudio ID8 source adaptations

This source family adapts **Bimmer Blocks** and **Bimmer Pass** from MGU App Studio 2.4.0 to the original Store's dual-resource npm package route. Both AQ-derived versions are **1.1.1**, based on original **1.1.0**. The version increment makes the changed source visible to the Store's upgrade comparison. It is not an AppStudio publisher release.

The original project files remain unchanged in `apps/_sources/app-studio-custom`. [AQ_PORT.json](AQ_PORT.json) records source hashes, the local snapshot, license evidence, donor commits, changed files and validation limits. The snapshot was collected through the approved TUF connector on 2026-11-19. It was not a Git repository, and no public repository URL or Git commit is attributed to it. [The Arabic report](README_AQ_ID8.md) explains the result and target limitations.

| Application | AQ version | Original version | Vehicle access | HMI resources |
|---|---|---|---|---|
| `bimmer_blocks` | `1.1.1` | `1.1.0` | Original read/subscribe speed field only | ID7, ID8 |
| `vehicle_pass` | `1.1.1` | `1.1.0` | None; local manually entered records | ID7, ID8 |

## Actual ID8 changes

The generator writes separate ID7/ID8 RHMI resources with the same state IDs, native ID8 list/buttons and correctly mapped text cells. ID8 uses the public entry-resource, initialization, mapping and availability lifecycle. It requires the native renderer's touch support and a valid advertised application area; an incompatible renderer leaves native settings and an explicit explanation. It does not allocate an ID7 Graphic resource on ID8.

Both package manifests and source descriptors require **`mgu-render >= 0.6.24`** and the installed **`renderer`** capability. Controller capture remains conditional on the renderer's controller/input-gate support; native controls and supported touch interaction are separate from exclusive knob capture. The installed package uses relative RHMI resources and the platform-provided data directory, with no hardcoded ID7 MainApp path substituted for ID8 MainApp21.

The retained standalone `.mgu` staging tree remains ID7. **ID8 uses the Store source build into `.tgz`** with both RHMI descriptions. The genuine target SDK remains a separate prerequisite; this repository contains no SDK or generated installation package for these applications.

## Stationary game guard

Bimmer Blocks retains its original valid-speed, at-most-0.5km/h, under-ten-seconds guard, visibility checks, manual pause, local scores and game engine. On ID8, the same declared speed field is read through a read-only adapter. Its health must also be fresh: two-second polling, six-second freshness, and immediate loss of freshness on provider loss or read errors. A read's 3.5-second reporting deadline does not release its pending slot; there is at most one unresolved getter for the field. Late, timed-out and previous-provider responses cannot revive a stationary value. Shutdown disposes the reader and its timers.

The game stays paused when speed or its backend is unknown. Recovering a connection alone does not resume play. No driving-function method or vehicle write is added. The original ID7 path and game decisions are retained.

## Local records and languages

Vehicle Pass's `main.js`, data model, profile/history migrations, backup and corruption handling, supplemental font and notices remain byte-identical. Mileage, pressures and parts information are manually entered records. The application has no declared vehicle signal or diagnostic dependency and does not change CBS values. English/German behavior, German glyphs even with English display language, and source language resources are retained.

## License and validation

The AppStudio project supplies an MIT license in `PROJEKT-LIZENZ.txt`; its third-party notice identifies it as the Apps project license. The custom application sources have no separate restrictive exception. Vehicle Pass's `NOTICE` scopes its separate `LICENSE` to the bundled DejaVu font. The original generic builder's hardcoded `UNLICENSED` marker is replaced by the project MIT app-code grant, while all font, project and adaptation notices are installed separately. Public cauliflowermossgrape/Perea compatibility contracts and the Pinguino-based adaptation delta retain their MIT notices.

From the AQ_MGU repository root:

```sh
python -m unittest discover -s tests -p test_appstudio_id8_port.py -v
```

The tests cover real builders, ID7 equivalence, dual resources, actual runtime lifecycle/cells/geometry, actual application entry code, the bounded reader, original game/model tests and four complete English/German temporary package assemblies. A throwing synthetic SDK-shaped fixture is used only for packaging and deleted afterward. File handles are closed and package construction is checked for `ResourceWarning`.

**Actual target SDK execution, HU installation/registration, physical touch/controller/display behavior and vehicle signal compatibility are NOT_OBSERVED.** Missing SDK members, providers, native renderer or application area remain explicit runtime limitations.
