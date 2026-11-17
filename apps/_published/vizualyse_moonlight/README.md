# AQ_MGU Store source snapshot: Moonlight (vizualyse_moonlight@0.3.1)

Public ID7 `build: "unit"` source component for the original MGU Store.
This is **not** the native `vizualyse-moonlight` streaming tool or a
ready-to-install `.tgz`.

## Source and license

- Upstream [Vizualyse/idrive-apps](https://github.com/Vizualyse/idrive-apps),
  pinned commit `13a766b520f17d7871fb9bb0713f658e5e14641b`.
- Original source:
  `../../_sources/vizualyse-idrive-apps/apps/vizualyse_moonlight/`.
- The `mgu-app.json`, the two app-specific `src/*.js`, complete
  `vizualyse_moonlight@0.3.1/` OAP resource tree and GPL-3.0-or-later
  `LICENSE` are unmodified copies.
- Additional JS modules are the exact versions pinned by upstream
  `../../_sources/vizualyse-idrive-apps/apps/vizualyse_moonlight/release.json`:

| Published JS | Original pinned public platform JS | License |
|---|---|---|
| `src/touch_mode.js` | `../../_sources/vizualyse-idrive-apps/platform/app/touch_mode/1.1.0/touch_mode.js` | GPL-3.0-or-later |
| `src/vehicle_speed.js` | `../../_sources/vizualyse-idrive-apps/platform/app/vehicle_speed/1.0.0/vehicle_speed.js` | GPL-3.0-or-later |
| `src/qr_png.js` | `../../_sources/vizualyse-idrive-apps/platform/app/qr_png/1.0.0/qr_png.js` | GPL-3.0-or-later |
| `src/qrcode.js` | `../../_sources/vizualyse-idrive-apps/platform/common/qrcode/1.0.0/qrcode.js` | MIT (Kazuhiko Arase) |

No proprietary SDK, SDK donor material, binary streaming tool, credentials
or generated `javascript/app.js` is present. The original Store's
on-unit linker must prepare and verify installation separately.

Offline validation:
`python -B -m unittest discover -s tests -p test_vizualyse_source_module_copies.py`.
