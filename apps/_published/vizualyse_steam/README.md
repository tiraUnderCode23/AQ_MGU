# AQ_MGU Store source snapshot: Steam (vizualyse_steam@0.2.1)

Public ID7 `build: "unit"` source component for MGU Store. It contains
only the iDrive application source and resources; **not** the large
`vizualyse-steam` native tool, Steam, Wine or game data.

## Provenance and license

- Upstream [Vizualyse/idrive-apps](https://github.com/Vizualyse/idrive-apps),
  pinned at `13a766b520f17d7871fb9bb0713f658e5e14641b`.
- Original source:
  `../../_sources/vizualyse-idrive-apps/apps/vizualyse_steam/`.
- This snapshot's `mgu-app.json`, two app-specific JS modules,
  `vizualyse_steam@0.2.1/` resource tree and GPL-3.0-or-later license
  are byte-for-byte copies of the original public source.
- The platform modules below match the source's pinned
  `../../_sources/vizualyse-idrive-apps/apps/vizualyse_steam/release.json`.

| Published JS | Pinned public platform implementation | License |
|---|---|---|
| `src/touch_mode.js` | `../../_sources/vizualyse-idrive-apps/platform/app/touch_mode/1.1.0/touch_mode.js` | GPL-3.0-or-later |
| `src/vehicle_speed.js` | `../../_sources/vizualyse-idrive-apps/platform/app/vehicle_speed/1.0.0/vehicle_speed.js` | GPL-3.0-or-later |
| `src/qr_png.js` | `../../_sources/vizualyse-idrive-apps/platform/app/qr_png/1.0.0/qr_png.js` | GPL-3.0-or-later |
| `src/qrcode.js` | `../../_sources/vizualyse-idrive-apps/platform/common/qrcode/1.0.0/qrcode.js` | MIT (Kazuhiko Arase) |

No proprietary BMW OAP SDK, OEM material, credentials, binary Steam tool,
or generated application bundle is included. This source snapshot does
not verify availability of the separate large tool package or sufficient
head-unit resources. Store preflight and installed-status verification
remain required.

Offline validation:
`python -B -m unittest discover -s tests -p test_vizualyse_source_module_copies.py`.
