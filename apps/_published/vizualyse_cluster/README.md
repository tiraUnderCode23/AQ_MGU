# AQ_MGU Store source snapshot: Cluster themes (vizualyse_cluster@0.3.1)

This is a **source-only**, ID7, `build: "unit"` component for the original
MGU Store. It is distinct from the separately released
`vizualyse-cluster` native tool and is not a prebuilt OAP application.

## Public source provenance

- Upstream: [Vizualyse/idrive-apps](https://github.com/Vizualyse/idrive-apps),
  pinned at `13a766b520f17d7871fb9bb0713f658e5e14641b`.
- Original folder:
  `../../_sources/vizualyse-idrive-apps/apps/vizualyse_cluster/`.
- The manifest, three application-specific JS modules, complete staged
  `vizualyse_cluster@0.3.1/` resource tree, and GPL-3.0-or-later license
  are byte-for-byte copies of the existing original public source.
- The following generated platform copies are included explicitly,
  because the original Store packs the source component folder as-is:

| Published JS | Original pinned platform JS | License |
|---|---|---|
| `src/touch_mode.js` | `../../_sources/vizualyse-idrive-apps/platform/app/touch_mode/1.1.0/touch_mode.js` | GPL-3.0-or-later |
| `src/vehicle_speed.js` | `../../_sources/vizualyse-idrive-apps/platform/app/vehicle_speed/1.0.0/vehicle_speed.js` | GPL-3.0-or-later |

The pinned mapping originates from the upstream
`../../_sources/vizualyse-idrive-apps/apps/vizualyse_cluster/release.json`.
No generated app bundle, proprietary BMW SDK, key, OEM binary, or native
cluster tool is included. Installation still requires the original Store's
compatibility, dependency, and post-install checks; the snapshot is not
evidence of success on a car.

Offline validation:
`python -B -m unittest discover -s tests -p test_vizualyse_source_module_copies.py`.
