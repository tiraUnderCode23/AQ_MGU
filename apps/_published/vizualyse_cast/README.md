# AQ_MGU Store source snapshot: Cast (vizualyse_cast@0.4.1)

This is a **source-only** Store `build: "unit"` snapshot for the iDrive 7
**Cast** app. It is not the `vizualyse-cast` native tool, and is not a
prebuilt `.tgz`. Its dependencies and ID7 restriction remain in
`../../mgu-repo.json` (repository root: `mgu-repo.json`).

## Original public sources and custody

- Upstream: [Vizualyse/idrive-apps](https://github.com/Vizualyse/idrive-apps),
  pinned commit `13a766b520f17d7871fb9bb0713f658e5e14641b`.
- Unmodified source: `../../_sources/vizualyse-idrive-apps/apps/vizualyse_cast/`.
  The `mgu-app.json`, the app-specific `src/*.js`, the complete
  `vizualyse_cast@0.4.1/` source package tree and GPL-3.0-or-later
  `LICENSE` are byte-for-byte copies.
- The Store packs a `build: "unit"` directory as-is. Its
  `mgu-app.json` requires all six `src/*.js` files. The original upstream
  build syncs four shared platform modules into `src/`, but those
  generated copies are intentionally ignored upstream. This independently
  published source snapshot contains the **exact pinned public copies**.

| Snapshot file | Pinned public platform source | License |
|---|---|---|
| `src/touch_mode.js` | `../../_sources/vizualyse-idrive-apps/platform/app/touch_mode/1.1.0/touch_mode.js` | GPL-3.0-or-later |
| `src/vehicle_speed.js` | `../../_sources/vizualyse-idrive-apps/platform/app/vehicle_speed/1.0.0/vehicle_speed.js` | GPL-3.0-or-later |
| `src/qr_png.js` | `../../_sources/vizualyse-idrive-apps/platform/app/qr_png/1.0.0/qr_png.js` | GPL-3.0-or-later |
| `src/qrcode.js` | `../../_sources/vizualyse-idrive-apps/platform/common/qrcode/1.0.0/qrcode.js` | MIT (Kazuhiko Arase) |

The pinned module mapping is defined by the upstream
`../../_sources/vizualyse-idrive-apps/apps/vizualyse_cast/release.json`.
The snapshot has **no BMW OAP SDK, donor code, credentials, keys, or
generated `javascript/app.js`**. The original Store's authorized unit
linker must resolve the OAP SDK on a compatible unit, and its installer
must separately confirm installation and health. This snapshot alone is
not evidence of a live successful install.

Offline integrity checks:
`python -B -m unittest discover -s tests -p test_vizualyse_source_module_copies.py`.
