# AQ_MGU original-source README and installation eligibility matrix

This index is based on the pinned upstream README or closest available parent/family README for **every** catalog component. It records only **documented prerequisites** and **source/build identity**, not a live install result. No SSH, ECU write, firmware flashing, on-car Store install or head-unit acceptance test was performed while producing it.

Use [Install with original MGU Store](INSTALL.md) first. The original Store accepts one GitHub `branch:main` source and one **HTTPS** release catalog source; adding the same GitHub repository twice is not supported. The Store must verify dependencies, package identity and format before making any change, and then independently verify installed status. A `README` link is not permission to run an incompatible or security-sensitive component.

The package ID/version, channel, HMI and dependencies are from `mgu-repo.json` (40 branch entries) and `release/catalog.json` (21 published entries). `Not declared` means no supported HMI was specified; it must **not** be interpreted as universal support. `NOT_OBSERVED` means no head-unit install/error receipt was collected for this entry.

**Readme evidence:** 61 component-to-document links, 44 distinct READMEs; some refer to the **family** instead of the individual component. Refer to the linked source instructions before deciding whether a particular vehicle is compatible. No proprietary OAP SDK or credentials are hosted by this index.

## Source-built branch entries (40)

| ID and version | Kind / preparation | HMI | Declared dependencies | Original README | Review note |
|---|---|---|---|---|---|
| `ambient_config@2.6.2` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.18; mgu-inputgate>=1.1.0 | [family](../apps/_sources/idrive7-apps/README.md#L120) | Review original README and vehicle compatibility |
| `brake_test@1.5.21` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.18; mgu-inputgate>=1.1.0 | [family](../apps/_sources/idrive7-apps/README.md#L112) | Review original README and vehicle compatibility |
| `car_vitals@2.27.6` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.18; mgu-inputgate>=1.1.0 | [family](../apps/_sources/idrive7-apps/README.md#L74) | Review original README and vehicle compatibility |
| `carplay_map_toggle@0.1.0` | app / unit_linker | ID7 | carplay-map>=0.2.0 | [family](../apps/_sources/isaak-carplay-map-cluster/README.md#L11) | Firmware/CarPlay-specific; require original compatibility checks |
| `cluster_themes@0.19.0` | app / python_source_builder | ID7 | none declared | [direct](../apps/_sources/bimmer-lab-apps/apps/cluster_themes/README.md#L174) | Review original README and vehicle compatibility |
| `doom@1.7.22` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.18; mgu-inputgate>=1.1.0 | [family](../apps/_sources/idrive7-apps/README.md#L209) | Review original README and vehicle compatibility |
| `draggy@2.6.0` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.18; mgu-inputgate>=1.1.0 | [family](../apps/_sources/idrive7-apps/README.md#L29) | Review original README and vehicle compatibility |
| `dtc_scanner@2.9.8` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.18; mgu-inputgate>=1.1.0 | [family](../apps/_sources/idrive7-apps/README.md#L37) | Vehicle/diagnostic-specific; review safety and compatibility |
| `dyno@1.6.3` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.15 | [family](../apps/_sources/idrive7-apps/README.md#L29) | Review original README and vehicle compatibility |
| `edrive@2.10.1` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.15 | [family](../apps/_sources/idrive7-apps/README.md#L75) | Review original README and vehicle compatibility |
| `ethanol_mix@0.1.5` | app / python_source_builder | ID7 | none declared | [family](../apps/_sources/turnkey-ethanol-blend/README.md#L5) | Use pinned 0.1.5 only; later versions documented as withdrawn |
| `gforce@1.6.22` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.15 | [family](../apps/_sources/idrive7-apps/README.md#L76) | Review original README and vehicle compatibility |
| `idrive7-renderd@2.1.19` | tool / tool_component | ID7/ID8 | mgu-deploy>=0.6.1 | [parent](../apps/_sources/idrive7-apps/kit/renderd/README.md#L49) | Review original README and vehicle compatibility |
| `idrive_hud_widgets@0.15.0` | app / python_source_builder | ID7 | none declared | [direct](../apps/_sources/bimmer-lab-apps/apps/idrive_hud_widgets/README.md#L141) | Review original README and vehicle compatibility |
| `idv7lol@0.2.14` | app / python_source_builder | ID7 | cluster-render>=0.6.7; mgu-deploy>=0.8.21 | [direct](../apps/_sources/idv7lol/apps/idv7lol/README.md#L4) | Review original README and vehicle compatibility |
| `jap_waze_cluster@1.0.2` | app / unit_linker | ID7 | jap-waze-on-cluster>=1.1.1 | [direct](../apps/_sources/waze-hud/apps/jap_waze_cluster/README.md#L11) | Review original README and vehicle compatibility |
| `live_adjustments@0.9.8` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.18; mgu-inputgate>=1.1.0 | [direct](../apps/_sources/idrive7-apps/apps/live_adjustments/README.md#L11) | Vehicle/diagnostic-specific; review safety and compatibility |
| `live_data@1.0.16` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.18; mgu-inputgate>=1.1.0 | [direct](../apps/_sources/idrive7-apps/apps/live_data/README.md#L55) | Review original README and vehicle compatibility |
| `m_copilot@1.0.31` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.7; mgu-inputgate>=1.0.0 | [family](../apps/_sources/hexlay-idrive7-apps/README.md#L152) | Review original README and vehicle compatibility |
| `mgu-fscpatch@1.0.0` | tool / tool_component | not specified | mgu-deploy>=0.3.2 | [parent](../apps/_sources/noahg-mgu-apps/native/mgu-fscpatch/README.md#L27) | Security-sensitive FSC changes; not for bulk installation |
| `mgu-inputgate@1.2.0` | tool / tool_component | ID7/ID8 | none declared | [direct](../apps/_sources/idrive7-apps/kit/renderd/inputgate/tool/README.md#L11) | Review original README and vehicle compatibility |
| `mgu-obd-adapter@1.0.0` | tool / tool_component | not specified | mgu-deploy>=0.4.0 | [parent](../apps/_sources/noahg-mgu-apps/native/hu-obd-adapter/README.md#L66) | Vehicle/diagnostic-specific; review safety and compatibility |
| `noahg_fscpatcher@1.0.0` | app / node_source_builder | ID7 | mgu-fscpatch>=1.0.0 | [direct](../apps/_sources/noahg-mgu-apps/apps/noahg_fscpatcher/README.md#L9) | Security-sensitive FSC changes; not for bulk installation |
| `noahg_obdbridge@1.0.0` | app / node_source_builder | ID7 | mgu-obd-adapter>=1.0.0 | [direct](../apps/_sources/noahg-mgu-apps/apps/noahg_obdbridge/README.md#L16) | Vehicle/diagnostic-specific; review safety and compatibility |
| `perea_mhd_flex@1.6.0` | app / python_source_builder | ID7/ID8 | none declared | [direct](../apps/_sources/alexpereap-idrive7-apps/apps/perea_mhd_flex/README.md#L17) | Vehicle/diagnostic-specific; review safety and compatibility |
| `redline@2.0.44` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.15 | [direct](../apps/_sources/idrive7-apps/apps/redline/README.md#L30) | Review original README and vehicle compatibility |
| `robertn_store@0.9.40` | app / unit_linker | ID7/ID8 | mgu-deploy>=0.8.12; mgu-updater>=0.8.28; mgu-render>=0.3.1 | [direct](../tools/_sources/mgu-store/apps/robertn_store/README.md#L95) | Review original README and vehicle compatibility |
| `robertn_waze_cluster@0.6.12` | app / unit_linker | ID7 | waze-on-cluster>=0.10.8 | [direct](../apps/_sources/idrive-apps/apps/robertn_waze_cluster/README.md#L99) | Review original README and vehicle compatibility |
| `service@1.6.2` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.15 | [family](../apps/_sources/idrive7-apps/README.md#L30) | Review original README and vehicle compatibility |
| `spotify@1.0.30` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.7; mgu-inputgate>=1.0.0 | [family](../apps/_sources/hexlay-idrive7-apps/README.md#L152) | Review original README and vehicle compatibility |
| `sys_monitor@1.0.4` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.7; mgu-inputgate>=1.0.0 | [family](../apps/_sources/hexlay-idrive7-apps/README.md#L110) | Review original README and vehicle compatibility |
| `vizualyse_cast@0.4.1` | app / unit_linker | ID7 | vizualyse-cast>=0.4.0 | [direct](../apps/_sources/vizualyse-idrive-apps/apps/vizualyse_cast/README.md#L18) | Review original README and vehicle compatibility |
| `vizualyse_chromium@0.3.1` | app / unit_linker | ID7 | vizualyse-chromium>=0.3.0 | [direct](../apps/_sources/vizualyse-idrive-apps/apps/vizualyse_chromium/README.md#L6) | Review original README and vehicle compatibility |
| `vizualyse_cluster@0.3.1` | app / unit_linker | ID7 | vizualyse-cluster>=0.4.0 | [direct](../apps/_sources/vizualyse-idrive-apps/apps/vizualyse_cluster/README.md#L10) | Review original README and vehicle compatibility |
| `vizualyse_moonlight@0.3.1` | app / unit_linker | ID7 | vizualyse-moonlight>=0.3.0 | [direct](../apps/_sources/vizualyse-idrive-apps/apps/vizualyse_moonlight/README.md#L38) | Review original README and vehicle compatibility |
| `vizualyse_steam@0.2.1` | app / unit_linker | ID7 | vizualyse-steam>=0.3.0 | [direct](../apps/_sources/vizualyse-idrive-apps/apps/vizualyse_steam/README.md#L5) | Review original README and vehicle compatibility |
| `vlad-carplay-mirror@0.1.3` | tool / tool_component | ID7 | mgu-deploy>=0.7.0; cluster-render>=0.3.7 | [family](../apps/_sources/vlad-mgu-apps/README.md#L3) | Review original README and vehicle compatibility |
| `vlad_carplay_mirror@0.1.3` | app / unit_linker | ID7 | vlad-carplay-mirror>=0.1.3; app-privacy>=0.1.0 | [family](../apps/_sources/vlad-mgu-apps/README.md#L3) | Firmware/CarPlay-specific; require original compatibility checks |
| `warmup@1.9.0` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.15 | [family](../apps/_sources/idrive7-apps/README.md#L29) | Review original README and vehicle compatibility |
| `zf8hp@1.5.7` | app / python_source_builder | ID7 | idrive7-renderd>=2.1.18; mgu-inputgate>=1.1.0 | [direct](../apps/_sources/idrive7-apps/apps/zf8hp/README.md#L3) | Vehicle/diagnostic-specific; review safety and compatibility |

## Published release packages (21)

| ID and version | Kind / compressed bytes | HMI | Declared dependencies | Original README | Review note |
|---|---|---|---|---|---|
| `airplay-rx@1.0.0` | tool / 3313575 bytes | ID7 | mgu-deploy>=0.7.0 | [family](../apps/_sources/noth4m4d-mgu-hamadstools/README.md#L7) | Review original README and vehicle compatibility |
| `apm_airplay@1.0.6` | app / 802852 bytes | ID7 | mgu-deploy>=0.7.0; airplay-rx>=1.0.0 | [family](../apps/_sources/noth4m4d-mgu-hamadstools/README.md#L7) | Review original README and vehicle compatibility |
| `app-privacy@1.7.2` | tool / 19586 bytes | ID7/ID8 | mgu-deploy>=0.6.3 | [related_source](../tools/_sources/mgu-store/native/app-privacy/README.md#L6) | Review original README and vehicle compatibility |
| `carplay-map@0.2.0` | tool / 32499 bytes | ID7 | mgu-deploy>=0.6.3; cluster-render>=0.2.0 | [related_source](../apps/_sources/isaak-carplay-map-cluster/README.md#L42) | Review original README and vehicle compatibility |
| `cluster-render@0.6.7` | tool / 10422485 bytes | ID7/ID8 | mgu-deploy>=0.4.0 | [related_source](../apps/_sources/idrive-apps/native/cluster-render/README.md#L7) | Review original README and vehicle compatibility |
| `hook111@0.1.6` | tool / 43298 bytes | ID7 | mgu-deploy>=0.7.0 | [related_source](../apps/_sources/vizualyse-idrive-apps/native/hook111/README.md#L3) | Firmware/CarPlay-specific; require original compatibility checks |
| `jap-waze-on-cluster@1.2.0` | tool / 2590020 bytes | ID7 | mgu-deploy>=0.7.11; cluster-render>=0.3.7 | [related_source](../apps/_sources/waze-hud/native/jap-waze-on-cluster/README.md#L39) | Firmware/CarPlay-specific; require original compatibility checks |
| `mgu-deploy@0.8.22` | tool / 163282 bytes | not specified | none declared | [related_source](../tools/_sources/mgu-store/deploy/README.md#L96) | Review original README and vehicle compatibility |
| `mgu-python@1.0.3` | tool / 14441404 bytes | ID7/ID8 | none declared | [related_source](../tools/_sources/mgu-store/native/mgu-python/README.md#L5) | Review original README and vehicle compatibility |
| `mgu-render@0.6.23` | tool / 103250 bytes | ID7/ID8 | mgu-deploy>=0.6.9 | [related_source](../tools/_sources/mgu-store/native/mgu-render/README.md#L13) | Review original README and vehicle compatibility |
| `mgu-updater@0.8.47` | tool / 139415 bytes | not specified | mgu-deploy>=0.8.4; mgu-python>=1.0.2 | [related_source](../tools/_sources/mgu-store/native/mgu-updater/README.md#L67) | Review original README and vehicle compatibility |
| `mgu-uplink@0.7.12` | tool / 3604053 bytes | not specified | mgu-updater>=0.7.2 | [related_source](../tools/_sources/mgu-store/native/mgu-uplink/README.md#L13) | Review original README and vehicle compatibility |
| `vizualyse-bus@0.1.0` | tool / 122314 bytes | ID7 | mgu-deploy>=0.7.0 | [related_source](../apps/_sources/vizualyse-idrive-apps/native/vizualyse-bus/README.md#L37) | Review original README and vehicle compatibility |
| `vizualyse-cast@0.4.1` | tool / 30059154 bytes | ID7 | mgu-deploy>=0.7.0; cluster-render>=0.4.2; mgu-python>=1.0.0; mgu-uplink>=0.7.0; vizualyse-bus>=0.1.0 | [related_source](../apps/_sources/vizualyse-idrive-apps/native/vizualyse-cast/README.md#L29) | Review original README and vehicle compatibility |
| `vizualyse-chromium@0.3.1` | tool / 188979233 bytes | ID7 | mgu-deploy>=0.7.0; mgu-python>=1.0.0; mgu-render>=0.6.11; vizualyse-bus>=0.1.0 | [related_source](../apps/_sources/vizualyse-idrive-apps/native/vizualyse-chromium/README.md#L7) | Large experimental tool; verify disk/memory and published bytes |
| `vizualyse-cluster@0.4.1` | tool / 10991905 bytes | ID7 | mgu-deploy>=0.7.0; mgu-python>=1.0.0; mgu-render>=0.6.11; cluster-render>=0.5.4 | [related_source](../apps/_sources/vizualyse-idrive-apps/native/vizualyse-cluster/README.md#L18) | Review original README and vehicle compatibility |
| `vizualyse-moonlight@0.3.1` | tool / 943274 bytes | ID7 | mgu-deploy>=0.7.0; cluster-render>=0.4.2; mgu-python>=1.0.0; mgu-render>=0.6.11 | [related_source](../apps/_sources/vizualyse-idrive-apps/native/vizualyse-moonlight/README.md#L6) | Review original README and vehicle compatibility |
| `vizualyse-steam@0.3.2` | tool / 531208182 bytes | ID7 | mgu-deploy>=0.7.0; mgu-python>=1.0.0; mgu-render>=0.6.11; vizualyse-bus>=0.1.0 | [related_source](../apps/_sources/vizualyse-idrive-apps/native/vizualyse-steam/README.md#L7) | Large experimental tool; verify disk/memory and published bytes |
| `waze-on-cluster@0.10.8` | tool / 2539325 bytes | ID7 | mgu-deploy>=0.7.17; cluster-render>=0.5.3 | [related_source](../apps/_sources/idrive-apps/native/waze-on-cluster/README.md#L43) | Review original README and vehicle compatibility |
| `wazecard@1.0.0` | tool / 12552 bytes | ID7 | mgu-deploy>=0.7.0 | [family](../apps/_sources/noth4m4d-mgu-hamadstools/README.md#L9) | Review original README and vehicle compatibility |
| `wzc_wazecards@1.0.1` | app / 801428 bytes | ID7 | mgu-deploy>=0.7.0; wazecard>=1.0.0 | [family](../apps/_sources/noth4m4d-mgu-hamadstools/README.md#L9) | Review original README and vehicle compatibility |

## Before installing an individual component

1. Confirm the intended head unit family and firmware, the original component README, the package/source identity and available space. Do not infer ID8 compatibility from a missing HMI field.
2. Resolve **only** the documented dependencies for that same publisher and channel. Branch Python builds may need an OAP SDK donor supplied by the **authorized vehicle**; the proprietary SDK is not present in this public repository.
3. For a release entry, use the published `.tgz` size and SHA-256 unchanged. HTTP 200 or a matching `Content-Length` alone is not a verified full download. For source builds, a GitHub ZIP of source is not an already installable package.
4. Let the original Store perform its normal compatibility/preflight and install receipt checks. A zero command exit or a staged file does not prove registration or a working UI. Identify missing dependencies, pending reboot, stale installation and denied permissions separately.
5. Avoid unattended/bulk installation of security-related, diagnostic, vehicle-control, firmware- or CarPlay-sensitive components. Their authorization, safety implications and compatibility must be evaluated individually. Do not suppress real DTC, Check Control or vehicle warnings to make an application appear successful.

**Evidence state:** no independent live head-unit install success or failure has been observed for these 61 catalog entries in this documentation audit. The two very large published packages (`vizualyse-chromium`, `vizualyse-steam`) also lacked full-byte SHA-256 GET proof in the earlier release audit; they are **unverified, not declared corrupt**.
