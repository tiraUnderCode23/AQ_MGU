# AQ ID8 adaptations of Engine Vitals and Shift Lights

This is the separately attributed AQ source family **pinguinooo-idrive8**. [AQ_PORT.json](AQ_PORT.json) records original commits, file hashes, changes and validation boundaries. The frozen original remains in `apps/_sources/pinguinooo-idrive7-apps`. See [the Arabic implementation report](README_AQ_ID8.md) for detailed behavior and limitations.

| Application | Derived version | Original version | AQ recipe | HMI |
|---|---|---|---|---|
| `adam_vitals` | `0.2.0` | `0.2.0` | `1` | ID7, ID8 |
| `adam_shiftlights` | `0.4.6` | `0.4.5` | `2` | ID7, ID8 |

The Shift Lights patch version makes the changed source upgrade visible to the Store's semantic-version comparison. It is an AQ-derived release, not a release claimed on behalf of Pinguino. The twelve original Vitals application files remain byte-identical and its runtime behavior is unchanged by the Shift Lights extension.

The supported dual-HMI route is the original Store's source build into the npm `.tgz` package. That package includes separate ID7 and ID8 RHMI resources. The inherited standalone `.mgu` staging layout remains ID7 and is not an ID8 installation route.

ID8 uses native list controls and a native renderer with touch routing and a valid reported application area. Both source descriptors require original `mgu-render >= 0.6.24` and the installed renderer capability. Shift Lights also requires original `cluster-render >= 0.6.9`. A compatible installed provider may be retained by the original Store; an unsuitable provider does not enable the canvas. ID8 has no fallback to an ID7 Graphic resource.

The SDK typed adapter is enabled only when the loaded resources identify ID8. It uses the target SDK's existing interfaces, preserves the raw ID7 backend, and introduces no new vehicle methods. Failed typed reads, provider loss and expired existing poll streams hide stale telemetry and show a native explanation until the affected reads recover. Settings remain accessible. Silence on an event-only interface cannot by itself prove provider availability and remains a target verification limit.

## Shift Lights on ID8

The application waits for the original cluster-render protocol's `hello`, checks `backend: id8`, and parses its advertised `map` and `hud` target sizes. It never requests `panel` on ID8 and never assumes the dimensions of a particular vehicle. The cluster lights use `map`, which is a different placement from ID7's strip under the M logo. Original virtual geometry and shader uniforms remain intact; destination rectangles are scaled with preserved aspect ratio, and image layers retain their original raster dimensions with bilinear sampling.

On disconnection, cached ID8 layer references are removed before the original client's automatic reconnect can replay them. A new hello triggers a fresh application decision and geometry calculation. Missing or malformed targets remain explicitly unavailable. Renderer readback, target ownership and the original guarded, bounded self-heal remain distinct from merely connecting or creating a layer; physical HUD visibility is unverified.

**Open Shift Lights after every head-unit start on ID8.** The original background/no-RHMI lifecycle initializes without starting the app implementation. Its ID8 startup setting is explanatory text, cannot be toggled and overrides any saved `autoStart: true`. ID7 retains its original autostart behavior.

ID8 output requires fresh valid RPM and oil-temperature readings from the already-declared read/subscribe fields. Invalid values, stale readings, provider loss or errors stop output. There is at most one unresolved getter per field; local timeouts do not accumulate new pending requests, and late or previous-provider responses cannot revive cached data. Kill-file, error-budget, demo and existing enablement guards are retained. No vehicle methods or vehicle permissions are added.

## Offline verification

Source and donor licenses, the original client notice and its MPL-2.0 license are included in the installed package. Tests exercise actual resource writers, complete temporary package assembly, original ID7 output, actual Shift Lights `main.js`, lifecycle and renderer behavior with inert mocks, and typed/raw adapter failure and recovery. Temporary SDK-shaped packaging fixtures are synthetic and are never distributed.

```sh
python -m unittest discover -s tests -p test_pinguino_id8_port.py -v
python -m unittest discover -s tests -p test_shiftlights_id8_port.py -v
```

Run the commands from the AQ_MGU repository root. No actual BMW SDK execution, target installation, HU registration, rendered car display or live telemetry has been observed. These source changes do not confirm or repair an earlier installation whose transport ended with `ECONNRESET`.

MTrack remains outside this source port. Its full-panel dependency has no corresponding ID8 target in the reviewed renderer contract.
