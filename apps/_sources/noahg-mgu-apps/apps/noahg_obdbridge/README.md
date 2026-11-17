# OBD Bridge

OBD Bridge exposes a bounded ENET diagnostic connection through the car's
existing Wi-Fi hotspot. Version `1.0.0` includes the ID7 control app and the
Store-managed `mgu-obd-adapter` companion service.

> [!WARNING]
> Version `1.0.0` supports only the observed bootmod3 (BM3) diagnostic
> protocol. Other ENET diagnostic applications and protocol sequences are not
> supported or claimed compatible in this release candidate.

> [!WARNING]
> Vehicle diagnostics can wake control units and alter their active diagnostic
> sessions even when persistent writes are blocked. Use OBD Bridge only while
> the vehicle is stationary, keep a recoverable diagnostic path available, and
> do not treat client discovery as proof that every vehicle or operation is
> supported.

Phones and computers join the car hotspot and connect with the supported BM3
client. OBD Bridge:

- binds discovery and diagnostic listeners only to the selected hotspot
  interface;
- accepts clients from the hotspot subnet and permits one active client;
- relays a real vehicle gateway when one answers discovery;
- can use ID7's TASU service as a virtual route after reading and validating
  the vehicle VIN;
- forwards bounded identification, fault-reading, metadata, session, and
  tester-present operations; and
- refuses coding, clearing, actuator control, security access, ECU reset, and
  programming requests before they reach an ECU.

The UI can enable or disable the service, check the vehicle route, and save a
redacted diagnostic report. Routine status and exports omit VINs, serial
numbers, and raw diagnostic payloads.

The service does not emulate a vendor adapter, implement DoIP or DCAN, or make
other applications compatible. Vehicle support still depends on the BM3
sequence and the diagnostic routes available on that head unit.

## Build and test

Requirements:

- Node.js 24 or later
- Python 3.12 or later
- Go 1.23 or later

From the repository root:

```sh
npm test
npm run test:obd
npm run build:obd
npm run build:apps
```

The app package and Linux amd64 service are committed with source fingerprints
and checksums. Rebuild the affected artifact after changing the app, shared
kit, native service, or TASU worker.

See the [service documentation](../../native/hu-obd-adapter/README.md) for the
network boundary and permitted diagnostic operations.
