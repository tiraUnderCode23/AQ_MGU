# AQ ID8 adaptation of Engine Vitals

This is the AQ source recipe **pinguinooo-idrive8, revision 1**, for `adam_vitals@0.2.0`. It keeps the original application ID and version. It is a separately attributed adaptation, not a new Pinguino release. [AQ_PORT.json](AQ_PORT.json) records the original commits, modified kit files and validation boundaries; the frozen original remains in `apps/_sources/pinguinooo-idrive7-apps`.

The supported dual-HMI route is the original Store's source build into the npm `.tgz` package. That package includes separate ID7 and ID8 RHMI resources. The inherited standalone `.mgu` staging layout remains ID7 and is not an ID8 installation route.

ID8 uses native list controls and a native renderer with touch routing and a valid reported application area. The source descriptor requires the original `mgu-render >= 0.6.24` and the installed renderer capability. A compatible installed provider may be retained by the original Store; an unsuitable provider does not enable the canvas. ID8 has no fallback to an ID7 Graphic resource.

The SDK typed adapter is enabled only when the loaded resources identify ID8. It uses the target SDK's existing interfaces, preserves the raw ID7 backend, and introduces no new vehicle methods. Failed typed reads, provider loss and expired existing poll streams hide stale telemetry and show a native explanation until the affected reads recover. Settings remain accessible. Silence on an event-only interface cannot by itself prove provider availability and remains a target verification limit.

All twelve original application files remain byte-identical. Source and donor licenses are included in the installed package. Tests exercise the actual resource writer, complete temporary package assembly, original ID7 output, lifecycle and renderer behavior with inert mocks, and typed/raw adapter failure and recovery. Temporary SDK-shaped packaging fixtures are synthetic and are never distributed. No actual BMW SDK execution, target installation, HU registration or live telemetry has been observed.

MTrack and Shiftlights are separate applications. This port does not qualify their fixed ID7 cluster/HUD layouts for ID8.
