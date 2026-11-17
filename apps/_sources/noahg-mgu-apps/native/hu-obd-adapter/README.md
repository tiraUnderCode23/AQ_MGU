# OBD Bridge service

The `mgu-obd-adapter` service is the native companion for OBD Bridge
`1.0.0`. It provides ENET discovery on UDP 6811 and diagnostic transport on
TCP 6801 over the car hotspot. The committed Linux amd64 binary is built from
this directory with the Go standard library.

Version `1.0.0` supports only the observed bootmod3 (BM3) diagnostic protocol.
The allowlist and compatibility tests cover that sequence; other ENET clients
and protocol sequences are outside this release's supported surface.

## Security boundary

- Listeners bind to the selected hotspot interface. Non-bridge wireless
  interfaces must report AP, AP-VLAN, or P2P-GO mode.
- Only same-subnet peers are accepted, and one external client owns the
  diagnostic connection at a time.
- Tagged nftables rules permit only the required hotspot and vehicle traffic.
  They are reconciled after firewall reloads and removed when the service is
  disabled or stopped.
- Administrative HTTP is available only through the group-restricted
  `/run/mgu-obd-adapter/control.sock` Unix socket.
- Frames, queues, discovery attempts, and timeouts are bounded. Requests are
  never replayed automatically after a lost connection.
- Status and diagnostic exports exclude VINs, serial numbers, and raw vehicle
  replies.

The forwarding policy permits UDS services `01`, `09`, `19`, `1A`,
`21`, and `22`; default or extended diagnostic sessions; tester-present;
and a small allowlist of BMW read setup operations required for DME metadata.
The allowlisted dynamic-DID windows and metadata routines are exact byte
sequences. Other routines, memory requests, coding, clearing, actuator
control, security access, ECU reset, and programming requests receive a
negative response without reaching the vehicle backend.

When an ENET gateway does not answer discovery, the service can use ID7's TASU
provider. It accepts only a syntactically valid VIN returned by the vehicle,
serializes requests through a local lease, filters replies by ECU and echoed
identifier, and does not synthesize a successful ECU response.

> [!WARNING]
> This boundary reduces risk but cannot make an arbitrary diagnostic client or
> vehicle safe. A permitted request reaches the real vehicle backend. Validate
> compatibility before relying on OBD Bridge for service or recovery work.

## Build and validation

From the repository root:

```sh
npm run test:obd
npm run build:obd
npm test
```

`npm run build:obd` cross-compiles a static Linux amd64 binary with
`-trimpath`, strips build metadata, updates its SHA-256, and records a source
fingerprint in `prebuilt/component.json`. Repository validation rejects stale
source or binary metadata.

The test suite covers protocol parsing, operation allowlisting, single-client
ownership, subnet and interface confinement, firewall lifecycle, Unix-socket
permissions, redacted exports, TASU request serialization, reply matching,
timeouts, cancellation, and shutdown cleanup. BM3 compatibility remains
dependent on the specific vehicle and software version. Other diagnostic
clients are not supported by this release.
