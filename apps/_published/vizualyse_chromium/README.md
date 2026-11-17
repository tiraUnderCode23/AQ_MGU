# AQ_MGU Store source snapshot: Browser (vizualyse_chromium@0.3.1)

This is a **source-only** Store `build: "unit"` snapshot for the iDrive 7
**Browser** app. It is not the separately published
`vizualyse-chromium` native tool and contains no Chromium binary.

## Original public sources and custody

- Upstream: [Vizualyse/idrive-apps](https://github.com/Vizualyse/idrive-apps),
  pinned commit `13a766b520f17d7871fb9bb0713f658e5e14641b`.
- Unmodified source:
  `../../_sources/vizualyse-idrive-apps/apps/vizualyse_chromium/`.
  The `mgu-app.json`, the app-specific `src/*.js`, the entire
  `vizualyse_chromium@0.3.1/` source package tree and GPL-3.0-or-later
  `LICENSE` are byte-for-byte copies.
- The original upstream builder generates shared platform copies in the
  app's `src/` folder, but does not commit those copies. The original Store
  packs a `build: "unit"` source tree as-is without running that sync,
  so the separately published snapshot contains the required pinned
  **publicly licensed** source modules.

| Snapshot file | Pinned public platform source | License |
|---|---|---|
| `src/touch_mode.js` | `../../_sources/vizualyse-idrive-apps/platform/app/touch_mode/1.1.0/touch_mode.js` | GPL-3.0-or-later |
| `src/vehicle_speed.js` | `../../_sources/vizualyse-idrive-apps/platform/app/vehicle_speed/1.0.0/vehicle_speed.js` | GPL-3.0-or-later |
| `src/qr_png.js` | `../../_sources/vizualyse-idrive-apps/platform/app/qr_png/1.0.0/qr_png.js` | GPL-3.0-or-later |
| `src/qrcode.js` | `../../_sources/vizualyse-idrive-apps/platform/common/qrcode/1.0.0/qrcode.js` | MIT (Kazuhiko Arase) |

The authoritative pinned version-to-file mapping is in
`../../_sources/vizualyse-idrive-apps/apps/vizualyse_chromium/release.json`.
No BMW SDK, OEM artifacts, credentials, keys, or generated
`javascript/app.js` are included. The original Store must build the
installable app against an authorized OAP SDK donor and verify deployment
and runtime state separately; this snapshot is not a live-install receipt.

Offline integrity checks:
`python -B -m unittest discover -s tests -p test_vizualyse_source_module_copies.py`.
