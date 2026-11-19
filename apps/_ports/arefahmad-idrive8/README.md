# AQ ID8 adaptation of Car Explorer

This is an AQ-maintained source adaptation of **aref_explorer 0.2.3**, recipe revision **aq-aref-id8-1**. It is not a new release by the original author. [PORT.json](PORT.json) records the exact upstream commits and the adapted parts. The original snapshot remains under `apps/_sources/arefahmad-idrive7-apps`.

The builder generates separate ID7 and ID8 RHMI resources. The ID7 resources retain their original state identifiers and layout. ID8 uses native list labels and buttons, a native renderer with touch routing, and the renderer's reported application area. It does not try to send an ID7 Graphic resource to ID8. If a suitable renderer is missing, the native label reports that requirement.

Car Explorer remains a read-only file inspector. It reads the platform's interface catalog and the `src-gen` folder belonging to the loaded HMI family: `/usr/lib/oap-mainapp` for ID7 or `/usr/lib/oap-mainapp21` for ID8. Missing or ambiguous paths are reported rather than silently combining both families. It does not subscribe to vehicle services or send vehicle commands.

The package requires the original `mgu-render >= 0.6.24` renderer. The original Store may retain an installed compatible renderer provider; the application still checks native rendering, touch support and application area before showing its canvas. SDK files are supplied on the authorized target by the original Store and are not distributed in this source tree.

## Verification scope

`tests/test_id8_aref_port.py` exercises the actual generator, ID7 regression behavior, ID8 cells and settings, lifecycle with an inert SDK-shaped mock, renderer bounds and visibility, MainApp paths, and package assembly. Temporary packaging fixtures are explicitly synthetic. They do not establish BMW SDK execution, installation, registration or functionality on a head unit. Those results remain **NOT OBSERVED**.

Only Car Explorer is promoted by this adaptation. The other Aref applications retain their existing declarations. In particular, the Tire Setup prototype is excluded because its cached vehicle-state guards and provider freshness need separate verification before an ID8 control path can be qualified. ID7 home-screen widgets and fixed cluster/HUD layouts are not silently represented as ID8 features.

## Attribution

The Aref application and its existing kit retain their original notices. The ID8 resource and geometry adaptation follows the MIT cauliflowermossgrape kit. Lifecycle handling follows the public MIT Perea implementation. Their notices are kept in this tree and copied into the derived target package. No OEM SDK, proprietary donor application, credentials or target-generated artifacts are included.
