<div align="center">

# AQ MGU — BMW iDrive 7 & 8 App Store

![Apps](https://img.shields.io/badge/Apps-214-0066B1?style=for-the-badge) ![iDrive 8](https://img.shields.io/badge/iDrive_8_Declared-58-1C69D4?style=for-the-badge) ![Helper Tools](https://img.shields.io/badge/Helper_Tools-80-2B3137?style=for-the-badge)

**Branches:** [`main` — All & iDrive 7](https://github.com/tiraUnderCode23/AQ_MGU) · [`id8` — iDrive 8](https://github.com/tiraUnderCode23/AQ_MGU/branches) · [`games` — Games](https://github.com/tiraUnderCode23/AQ_MGU/branches) · [`Releases` — Prebuilt Catalog](https://github.com/tiraUnderCode23/AQ_MGU/releases/tag/catalog)

[Cluster & HUD](#cluster--hud) · [Performance & Motorsport](#performance--motorsport) · [Diagnostics & Telemetry](#diagnostics--telemetry) · [Media, Video & Casting](#media-video--casting) · [Lighting, Cameras & Comfort](#lighting-cameras--comfort) · [Utilities & System](#utilities--system) · [Games](#games) · [Helper Tools](#helper-tools)

</div>

> HMI labels are publisher/source declarations. ID8 distribution eligibility is reviewed separately in [the ID8 report](docs/ID8_ELIGIBILITY_20261120_AR.md). Physical installation and runtime remain NOT OBSERVED.

Restored legacy versions, forks and prototypes remain listed with their original descriptions; their inclusion does not replace newer alternatives.

---

<details>
<summary><strong>➕ Add AQ MGU to MGU Store</strong></summary>

| Source | URL | Branch / Channel |
|---|---|---|
| **AQ MGU (iDrive 7 + All)** | `https://github.com/tiraUnderCode23/AQ_MGU` | `main` |
| **AQ MGU (iDrive 8 Only)** | `https://github.com/tiraUnderCode23/AQ_MGU` | `id8` |
| **AQ MGU (Games Only)** | `https://github.com/tiraUnderCode23/AQ_MGU` | `games` |
| **AQ MGU (Prebuilt Releases)** | `https://github.com/tiraUnderCode23/AQ_MGU` | `releases` |
| **AQ Extra Release Catalog** | `https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/main/release/catalog.json` | HTTPS |
| **IterioDev Companion** | `https://github.com/IterioDev/car-apps` | `main` |

```json
{
  "schema": 1,
  "sources": [
    {
      "id": "aq-mgu-apps",
      "type": "github",
      "repo": "tiraUnderCode23/AQ_MGU",
      "channel": "branch:main"
    },
    {
      "id": "aq-mgu-catalog",
      "type": "https",
      "url": "https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/main/release/catalog.json"
    },
    {
      "id": "aq-mgu-iteriodev",
      "type": "github",
      "repo": "IterioDev/car-apps",
      "channel": "branch:main"
    }
  ]
}
```

</details>

## Cluster & HUD

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/carplay_map_toggle/icon.png" width="48" height="48" alt="CarPlay Map Toggle" /></td>
<td><strong>CarPlay Map Toggle</strong> <code>v0.1.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/carplay_map_toggle/preview-01.webp" height="150" alt="CarPlay Map Toggle" /> <img src="docs/assets/apps/carplay_map_toggle/screen_2.webp" height="150" alt="CarPlay Map Toggle" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/mx_classic_cluster/icon.png" width="48" height="48" alt="Classic Cluster" /></td>
<td><strong>Classic Cluster</strong> <code>v0.14.2</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/mx_classic_cluster/screen_1.png" height="150" alt="Classic Cluster" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/cluster_themes/icon.png" width="48" height="48" alt="Cluster Themes" /></td>
<td><strong>Cluster Themes</strong> <code>v0.19.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/cluster_themes/preview-01.png" height="150" alt="Cluster Themes" /> <img src="docs/assets/apps/cluster_themes/preview-02.png" height="150" alt="Cluster Themes" /> <img src="docs/assets/apps/cluster_themes/preview-03.png" height="150" alt="Cluster Themes" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/perea_cluster_themes/icon.png" width="48" height="48" alt="Cluster Themes" /></td>
<td><strong>Cluster Themes</strong> <code>v0.19.1</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/perea_cluster_themes/screen_1.png" height="150" alt="Cluster Themes" /> <img src="docs/assets/apps/perea_cluster_themes/screen_2.png" height="150" alt="Cluster Themes" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/custom_hud/icon.png" width="48" height="48" alt="Custom HUD" /></td>
<td><strong>Custom HUD</strong> <code>v0.1.58</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/custom_hud/screen_1.gif" height="150" alt="Custom HUD" /> <img src="docs/assets/apps/custom_hud/screen_2.gif" height="150" alt="Custom HUD" /> <img src="docs/assets/apps/custom_hud/screen_3.gif" height="150" alt="Custom HUD" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/apex_dash/icon.png" width="48" height="48" alt="E39 M5 Cluster (Marko DEV)" /></td>
<td><strong>E39 M5 Cluster (Marko DEV)</strong> <code>v1.2.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/apex_dash/screen_1.png" height="150" alt="E39 M5 Cluster (Marko DEV)" /> <img src="docs/assets/apps/apex_dash/screen_2.png" height="150" alt="E39 M5 Cluster (Marko DEV)" /> <img src="docs/assets/apps/apex_dash/screen_3.gif" height="150" alt="E39 M5 Cluster (Marko DEV)" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/esagono_settings/icon.png" width="48" height="48" alt="Esagono Settings" /></td>
<td><strong>Esagono Settings</strong> <code>v0.1.0</code> &nbsp;·&nbsp; <code>ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/esagono_settings/screen_1.png" height="150" alt="Esagono Settings" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/eva_hud/icon.png" width="48" height="48" alt="EVA" /></td>
<td><strong>EVA</strong> <code>v0.5.3</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/eva_hud/screen_1.png" height="150" alt="EVA" /> <img src="docs/assets/apps/eva_hud/screen_2.png" height="150" alt="EVA" /> <img src="docs/assets/apps/eva_hud/screen_3.png" height="150" alt="EVA" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/f30_cluster/icon.png" width="48" height="48" alt="F30 Cluster" /></td>
<td><strong>F30 Cluster</strong> <code>v0.7.22</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/f30_cluster/screen_1.png" height="150" alt="F30 Cluster" /> <img src="docs/assets/apps/f30_cluster/screen_2.png" height="150" alt="F30 Cluster" /> <img src="docs/assets/apps/f30_cluster/screen_3.png" height="150" alt="F30 Cluster" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/idrive_hud_widgets/icon.png" width="48" height="48" alt="HUD Widgets" /></td>
<td><strong>HUD Widgets</strong> <code>v0.15.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/idrive_hud_widgets/preview-01.png" height="150" alt="HUD Widgets" /> <img src="docs/assets/apps/idrive_hud_widgets/preview-02.png" height="150" alt="HUD Widgets" /> <img src="docs/assets/apps/idrive_hud_widgets/preview-03.png" height="150" alt="HUD Widgets" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/idv7lol/icon.png" width="48" height="48" alt="idv7lol" /></td>
<td><strong>idv7lol</strong> <code>v0.2.15</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/idv7lol/preview-01.jpg" height="150" alt="idv7lol" /> <img src="docs/assets/apps/idv7lol/preview-02.jpg" height="150" alt="idv7lol" /> <img src="docs/assets/apps/idv7lol/preview-03.jpg" height="150" alt="idv7lol" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/redline/icon.png" width="48" height="48" alt="Redline" /></td>
<td><strong>Redline</strong> <code>v2.0.45</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/redline/preview-01.png" height="150" alt="Redline" /> <img src="docs/assets/apps/redline/preview-02.png" height="150" alt="Redline" /> <img src="docs/assets/apps/redline/preview-03.gif" height="150" alt="Redline" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/jap_waze_cluster/icon.png" width="48" height="48" alt="Waze HUD" /></td>
<td><strong>Waze HUD</strong> <code>v1.0.2</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/jap_waze_cluster/screen_1.png" height="150" alt="Waze HUD" /> <img src="docs/assets/apps/jap_waze_cluster/screen_2.png" height="150" alt="Waze HUD" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/robertn_waze_cluster/icon.png" width="48" height="48" alt="Waze on cluster" /></td>
<td><strong>Waze on cluster</strong> <code>v0.6.12</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/robertn_waze_cluster/preview-01.jpg" height="150" alt="Waze on cluster" /> <img src="docs/assets/apps/robertn_waze_cluster/preview-02.jpg" height="150" alt="Waze on cluster" /> <img src="docs/assets/apps/robertn_waze_cluster/preview-03.jpg" height="150" alt="Waze on cluster" /></td>
</tr></table>

<table>
<tr>
<td width="50%"><img src="docs/assets/apps/mdq_carlink/icon.png" width="36" height="36" align="left" alt="CarLink (experimental)" />&nbsp;&nbsp;<strong>CarLink (experimental)</strong><br>&nbsp;&nbsp;<code>v0.1.4</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/vlad_carplay_mirror/icon.png" width="36" height="36" align="left" alt="CarPlay Map Mirror" />&nbsp;&nbsp;<strong>CarPlay Map Mirror</strong><br>&nbsp;&nbsp;<code>v0.1.3</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/owner_cluster_control/icon.png" width="36" height="36" align="left" alt="Cluster" />&nbsp;&nbsp;<strong>Cluster</strong><br>&nbsp;&nbsp;<code>v0.4.1</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/cluster_lyrics/icon.png" width="36" height="36" align="left" alt="Cluster Lyrics" />&nbsp;&nbsp;<strong>Cluster Lyrics</strong><br>&nbsp;&nbsp;<code>v0.1.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/cluster_metrics/icon.png" width="36" height="36" align="left" alt="Cluster Metrics" />&nbsp;&nbsp;<strong>Cluster Metrics</strong><br>&nbsp;&nbsp;<code>v0.8.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/vizualyse_cluster/icon.png" width="36" height="36" align="left" alt="Cluster themes" />&nbsp;&nbsp;<strong>Cluster themes</strong><br>&nbsp;&nbsp;<code>v0.3.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/custom_cluster/icon.png" width="36" height="36" align="left" alt="Custom Cluster" />&nbsp;&nbsp;<strong>Custom Cluster</strong><br>&nbsp;&nbsp;<code>v0.6.10</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/woodr_devhud/icon.png" width="36" height="36" align="left" alt="Dev HUD" />&nbsp;&nbsp;<strong>Dev HUD</strong><br>&nbsp;&nbsp;<code>v0.1.4</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/drive_hud_full/icon.png" width="36" height="36" align="left" alt="Drive HUD" />&nbsp;&nbsp;<strong>Drive HUD</strong><br>&nbsp;&nbsp;<code>v0.1.6</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/aref_eta/icon.png" width="36" height="36" align="left" alt="ETA Bar" />&nbsp;&nbsp;<strong>ETA Bar</strong><br>&nbsp;&nbsp;<code>v1.20.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/rubenrios_gearhud/icon.png" width="36" height="36" align="left" alt="GearHUD" />&nbsp;&nbsp;<strong>GearHUD</strong><br>&nbsp;&nbsp;<code>v1.0.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/amn_hudlyrics/icon.png" width="36" height="36" align="left" alt="HUD" />&nbsp;&nbsp;<strong>HUD</strong><br>&nbsp;&nbsp;<code>v0.7.2</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/woodr_hud/icon.png" width="36" height="36" align="left" alt="HUD" />&nbsp;&nbsp;<strong>HUD</strong><br>&nbsp;&nbsp;<code>v0.9.5</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/adam_mtrack/icon.png" width="36" height="36" align="left" alt="M Track Cluster" />&nbsp;&nbsp;<strong>M Track Cluster</strong><br>&nbsp;&nbsp;<code>v0.1.7</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/front_camera_cluster/icon.png" width="36" height="36" align="left" alt="Night Vision Cluster" />&nbsp;&nbsp;<strong>Night Vision Cluster</strong><br>&nbsp;&nbsp;<code>v0.2.1</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/adam_shiftlights/icon.png" width="36" height="36" align="left" alt="Shift Lights" />&nbsp;&nbsp;<strong>Shift Lights</strong><br>&nbsp;&nbsp;<code>v0.4.6</code> · <code>ID7 / ID8</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/zekai_cluster_themes/icon.png" width="36" height="36" align="left" alt="TJM Instrument Themes" />&nbsp;&nbsp;<strong>TJM Instrument Themes</strong><br>&nbsp;&nbsp;<code>v0.8.7</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/cluster_nav_card/icon.png" width="36" height="36" align="left" alt="TJM Nav Card" />&nbsp;&nbsp;<strong>TJM Nav Card</strong><br>&nbsp;&nbsp;<code>v0.9.2</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/manuk_retro_cluster/icon.png" width="36" height="36" align="left" alt="TJM Retro Cluster" />&nbsp;&nbsp;<strong>TJM Retro Cluster</strong><br>&nbsp;&nbsp;<code>v0.3.4</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/twin_dial/icon.png" width="36" height="36" align="left" alt="Twin Dial" />&nbsp;&nbsp;<strong>Twin Dial</strong><br>&nbsp;&nbsp;<code>v0.1.5</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/woodr_warmhud/icon.png" width="36" height="36" align="left" alt="Warm-Up HUD" />&nbsp;&nbsp;<strong>Warm-Up HUD</strong><br>&nbsp;&nbsp;<code>v0.7.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/wzc_wazecards/icon.png" width="36" height="36" align="left" alt="Waze Cards" />&nbsp;&nbsp;<strong>Waze Cards</strong><br>&nbsp;&nbsp;<code>v1.0.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/waze_hud/icon.png" width="36" height="36" align="left" alt="Waze HUD" />&nbsp;&nbsp;<strong>Waze HUD</strong><br>&nbsp;&nbsp;<code>v0.3.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/marku_daily_hud/icon.png" width="36" height="36" align="left" alt="Только важное" />&nbsp;&nbsp;<strong>Только важное</strong><br>&nbsp;&nbsp;<code>v0.2.0</code> · <code>ID7</code></td>
</tr>
</table>

## Performance & Motorsport

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/advokat_live_adjustments/icon.png" width="48" height="48" alt="Advokat Engine Config" /></td>
<td><strong>Advokat Engine Config</strong> <code>v10.17.1</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/advokat_live_adjustments/screen_1.png" height="150" alt="Advokat Engine Config" /> <img src="docs/assets/apps/advokat_live_adjustments/screen_2.png" height="150" alt="Advokat Engine Config" /> <img src="docs/assets/apps/advokat_live_adjustments/screen_3.png" height="150" alt="Advokat Engine Config" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aq_flap/icon.png" width="48" height="48" alt="AQ Flap" /></td>
<td><strong>AQ Flap</strong> <code>v2.6.1</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aq_flap/screen_1.png" height="150" alt="AQ Flap" /> <img src="docs/assets/apps/aq_flap/screen_2.png" height="150" alt="AQ Flap" /> <img src="docs/assets/apps/aq_flap/screen_3.gif" height="150" alt="AQ Flap" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/brake_test/icon.png" width="48" height="48" alt="Brake Test" /></td>
<td><strong>Brake Test</strong> <code>v1.5.21</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/brake_test/preview-01.png" height="150" alt="Brake Test" /> <img src="docs/assets/apps/brake_test/preview-02.gif" height="150" alt="Brake Test" /> <img src="docs/assets/apps/brake_test/screen_3.gif" height="150" alt="Brake Test" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/draggy/icon.png" width="48" height="48" alt="Drag Timer" /></td>
<td><strong>Drag Timer</strong> <code>v2.6.0</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/draggy/preview-01.png" height="150" alt="Drag Timer" /> <img src="docs/assets/apps/draggy/preview-02.gif" height="150" alt="Drag Timer" /> <img src="docs/assets/apps/draggy/screen_3.gif" height="150" alt="Drag Timer" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_draggy/icon.png" width="48" height="48" alt="Drag Timer" /></td>
<td><strong>Drag Timer</strong> <code>v1.2.0</code> &nbsp;·&nbsp; <code>ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_draggy/screen_1.png" height="150" alt="Drag Timer" /> <img src="docs/assets/apps/iteriodev_draggy/screen_2.png" height="150" alt="Drag Timer" /> <img src="docs/assets/apps/iteriodev_draggy/screen_3.png" height="150" alt="Drag Timer" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/e85/icon.png" width="48" height="48" alt="E85 Blend" /></td>
<td><strong>E85 Blend</strong> <code>v1.2.2</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/e85/screen_1.gif" height="150" alt="E85 Blend" /> <img src="docs/assets/apps/e85/screen_2.gif" height="150" alt="E85 Blend" /> <img src="docs/assets/apps/e85/screen_3.gif" height="150" alt="E85 Blend" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/live_adjustments/icon.png" width="48" height="48" alt="Engine Config" /></td>
<td><strong>Engine Config</strong> <code>v0.9.10</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/live_adjustments/preview-01.png" height="150" alt="Engine Config" /> <img src="docs/assets/apps/live_adjustments/preview-02.png" height="150" alt="Engine Config" /> <img src="docs/assets/apps/live_adjustments/preview-03.png" height="150" alt="Engine Config" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/perea_mhd_flex/icon.png" width="48" height="48" alt="Flex Fuel" /></td>
<td><strong>Flex Fuel</strong> <code>v1.6.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/perea_mhd_flex/preview-01.png" height="150" alt="Flex Fuel" /> <img src="docs/assets/apps/perea_mhd_flex/preview-02.png" height="150" alt="Flex Fuel" /> <img src="docs/assets/apps/perea_mhd_flex/screen_3.png" height="150" alt="Flex Fuel" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/gforce/icon.png" width="48" height="48" alt="G-Force" /></td>
<td><strong>G-Force</strong> <code>v1.6.22</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/gforce/preview-01.png" height="150" alt="G-Force" /> <img src="docs/assets/apps/gforce/preview-02.gif" height="150" alt="G-Force" /> <img src="docs/assets/apps/gforce/screen_3.gif" height="150" alt="G-Force" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_liveadjust/icon.png" width="48" height="48" alt="Live Adjustments" /></td>
<td><strong>Live Adjustments</strong> <code>v1.2.0</code> &nbsp;·&nbsp; <code>ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_liveadjust/screen_1.png" height="150" alt="Live Adjustments" /> <img src="docs/assets/apps/iteriodev_liveadjust/screen_2.png" height="150" alt="Live Adjustments" /> <img src="docs/assets/apps/iteriodev_liveadjust/screen_3.png" height="150" alt="Live Adjustments" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/andrei_mdrive/icon.png" width="48" height="48" alt="M Drive" /></td>
<td><strong>M Drive</strong> <code>v0.4.0</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/andrei_mdrive/screen_1.png" height="150" alt="M Drive" /> <img src="docs/assets/apps/andrei_mdrive/screen_2.png" height="150" alt="M Drive" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/bm3_live_id8/icon.png" width="48" height="48" alt="MGU Bm3 Live Adjustments for IDrive 8" /></td>
<td><strong>MGU Bm3 Live Adjustments for IDrive 8</strong> <code>v0.1.1</code> &nbsp;·&nbsp; <code>ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/bm3_live_id8/screen_1.png" height="150" alt="MGU Bm3 Live Adjustments for IDrive 8" /> <img src="docs/assets/apps/bm3_live_id8/screen_2.png" height="150" alt="MGU Bm3 Live Adjustments for IDrive 8" /> <img src="docs/assets/apps/bm3_live_id8/screen_3.png" height="150" alt="MGU Bm3 Live Adjustments for IDrive 8" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/sideways/icon.png" width="48" height="48" alt="Sideways" /></td>
<td><strong>Sideways</strong> <code>v0.6.6</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/sideways/screen_1.png" height="150" alt="Sideways" /> <img src="docs/assets/apps/sideways/screen_2.png" height="150" alt="Sideways" /> <img src="docs/assets/apps/sideways/screen_3.png" height="150" alt="Sideways" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/zf8hp/icon.png" width="48" height="48" alt="Transmission Config" /></td>
<td><strong>Transmission Config</strong> <code>v1.5.8</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/zf8hp/preview-01.png" height="150" alt="Transmission Config" /> <img src="docs/assets/apps/zf8hp/preview-02.png" height="150" alt="Transmission Config" /> <img src="docs/assets/apps/zf8hp/preview-03.png" height="150" alt="Transmission Config" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/ethanol_mix/icon.png" width="48" height="48" alt="TurnKey E Blend" /></td>
<td><strong>TurnKey E Blend</strong> <code>v0.1.5</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/ethanol_mix/preview-01.png" height="150" alt="TurnKey E Blend" /> <img src="docs/assets/apps/ethanol_mix/preview-02.png" height="150" alt="TurnKey E Blend" /> <img src="docs/assets/apps/ethanol_mix/preview-03.png" height="150" alt="TurnKey E Blend" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/dyno/icon.png" width="48" height="48" alt="Virtual Dyno" /></td>
<td><strong>Virtual Dyno</strong> <code>v1.6.3</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/dyno/preview-01.png" height="150" alt="Virtual Dyno" /> <img src="docs/assets/apps/dyno/screen_2.png" height="150" alt="Virtual Dyno" /></td>
</tr></table>

<table>
<tr>
<td width="50%"><img src="docs/assets/apps/lfb_enginesound/icon.png" width="36" height="36" align="left" alt="Engine Sound" />&nbsp;&nbsp;<strong>Engine Sound</strong><br>&nbsp;&nbsp;<code>v1.2.2</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/woodr_launch/icon.png" width="36" height="36" align="left" alt="Launch" />&nbsp;&nbsp;<strong>Launch</strong><br>&nbsp;&nbsp;<code>v0.7.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/mazzahaker_xdrive_remover/icon.png" width="36" height="36" align="left" alt="mazzahaker_xdrive_remover" />&nbsp;&nbsp;<strong>mazzahaker_xdrive_remover</strong><br>&nbsp;&nbsp;<code>v0.1.26</code> · <code>ID7 / ID8</code></td>
<td width="50%"><img src="docs/assets/apps/ride_height/icon.png" width="36" height="36" align="left" alt="Ride Height Studio" />&nbsp;&nbsp;<strong>Ride Height Studio</strong><br>&nbsp;&nbsp;<code>v0.6.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/xdrive_offroad_pro/icon.png" width="36" height="36" align="left" alt="Terrain Monitor" />&nbsp;&nbsp;<strong>Terrain Monitor</strong><br>&nbsp;&nbsp;<code>v0.1.3</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/xtraboost_guard/icon.png" width="36" height="36" align="left" alt="TJM XtraBoost Guard" />&nbsp;&nbsp;<strong>TJM XtraBoost Guard</strong><br>&nbsp;&nbsp;<code>v1.3.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/dimon_track_mode/icon.png" width="36" height="36" align="left" alt="Track Mode" />&nbsp;&nbsp;<strong>Track Mode</strong><br>&nbsp;&nbsp;<code>v1.0.1</code> · <code>ID7 / ID8</code></td>
<td width="50%"><img src="docs/assets/apps/true_time/icon.png" width="36" height="36" align="left" alt="True Time" />&nbsp;&nbsp;<strong>True Time</strong><br>&nbsp;&nbsp;<code>v1.0.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/true_time_id8/icon.png" width="36" height="36" align="left" alt="True Time (iDrive 8, untested)" />&nbsp;&nbsp;<strong>True Time (iDrive 8, untested)</strong><br>&nbsp;&nbsp;<code>v1.0.0</code> · <code>ID8</code></td>
<td width="50%"><img src="docs/assets/apps/xdrive_studio/icon.png" width="36" height="36" align="left" alt="xDrive Studio" />&nbsp;&nbsp;<strong>xDrive Studio</strong><br>&nbsp;&nbsp;<code>v0.1.5</code> · <code>ID7</code></td>
</tr>
</table>

## Diagnostics & Telemetry

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/ahg_control_center/icon.png" width="48" height="48" alt="AHG Control Center" /></td>
<td><strong>AHG Control Center</strong> <code>v1.4.2</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/ahg_control_center/screen_1.png" height="150" alt="AHG Control Center" /> <img src="docs/assets/apps/ahg_control_center/screen_2.png" height="150" alt="AHG Control Center" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/ahg_digital_garage/icon.png" width="48" height="48" alt="AHG Digital Garage" /></td>
<td><strong>AHG Digital Garage</strong> <code>v0.1.1</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/ahg_digital_garage/screen_1.png" height="150" alt="AHG Digital Garage" /> <img src="docs/assets/apps/ahg_digital_garage/screen_2.png" height="150" alt="AHG Digital Garage" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_cardash/icon.png" width="48" height="48" alt="Car Data" /></td>
<td><strong>Car Data</strong> <code>v1.4.1</code> &nbsp;·&nbsp; <code>ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_cardash/screen_1.png" height="150" alt="Car Data" /> <img src="docs/assets/apps/iteriodev_cardash/screen_2.png" height="150" alt="Car Data" /> <img src="docs/assets/apps/iteriodev_cardash/screen_3.png" height="150" alt="Car Data" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/idrive7_dpf_app/icon.png" width="48" height="48" alt="DPF Monitor" /></td>
<td><strong>DPF Monitor</strong> <code>v0.1.6</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/idrive7_dpf_app/screen_1.png" height="150" alt="DPF Monitor" /> <img src="docs/assets/apps/idrive7_dpf_app/screen_2.png" height="150" alt="DPF Monitor" /> <img src="docs/assets/apps/idrive7_dpf_app/screen_3.png" height="150" alt="DPF Monitor" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/dpf/icon.png" width="48" height="48" alt="DPF Status" /></td>
<td><strong>DPF Status</strong> <code>v0.1.33</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/dpf/screen_1.png" height="150" alt="DPF Status" /> <img src="docs/assets/apps/dpf/screen_2.png" height="150" alt="DPF Status" /> <img src="docs/assets/apps/dpf/screen_3.png" height="150" alt="DPF Status" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/edrive/icon.png" width="48" height="48" alt="eDrive" /></td>
<td><strong>eDrive</strong> <code>v2.11.0</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/edrive/preview-01.png" height="150" alt="eDrive" /> <img src="docs/assets/apps/edrive/preview-02.png" height="150" alt="eDrive" /> <img src="docs/assets/apps/edrive/preview-03.png" height="150" alt="eDrive" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_edrive/icon.png" width="48" height="48" alt="eDrive" /></td>
<td><strong>eDrive</strong> <code>v1.1.0</code> &nbsp;·&nbsp; <code>ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_edrive/screen_1.png" height="150" alt="eDrive" /> <img src="docs/assets/apps/iteriodev_edrive/screen_2.png" height="150" alt="eDrive" /> <img src="docs/assets/apps/iteriodev_edrive/screen_3.png" height="150" alt="eDrive" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_engine_care/icon.png" width="48" height="48" alt="Engine Care" /></td>
<td><strong>Engine Care</strong> <code>v1.5.2</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_engine_care/screen_1.png" height="150" alt="Engine Care" /> <img src="docs/assets/apps/aurelm_engine_care/screen_2.png" height="150" alt="Engine Care" /> <img src="docs/assets/apps/aurelm_engine_care/screen_3.png" height="150" alt="Engine Care" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/adam_vitals/icon.png" width="48" height="48" alt="Engine Vitals" /></td>
<td><strong>Engine Vitals</strong> <code>v0.2.0</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/adam_vitals/screen_1.png" height="150" alt="Engine Vitals" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_dtcscan/icon.png" width="48" height="48" alt="Fault Codes" /></td>
<td><strong>Fault Codes</strong> <code>v1.2.0</code> &nbsp;·&nbsp; <code>ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_dtcscan/screen_1.png" height="150" alt="Fault Codes" /> <img src="docs/assets/apps/iteriodev_dtcscan/screen_2.png" height="150" alt="Fault Codes" /> <img src="docs/assets/apps/iteriodev_dtcscan/screen_3.png" height="150" alt="Fault Codes" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/dtc_scanner/icon.png" width="48" height="48" alt="Fault Scanner" /></td>
<td><strong>Fault Scanner</strong> <code>v2.9.8</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/dtc_scanner/preview-01.png" height="150" alt="Fault Scanner" /> <img src="docs/assets/apps/dtc_scanner/preview-02.png" height="150" alt="Fault Scanner" /> <img src="docs/assets/apps/dtc_scanner/screen_3.png" height="150" alt="Fault Scanner" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_hybrid_cost/icon.png" width="48" height="48" alt="Hybrid Cost" /></td>
<td><strong>Hybrid Cost</strong> <code>v1.1.2</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_hybrid_cost/screen_1.png" height="150" alt="Hybrid Cost" /> <img src="docs/assets/apps/aurelm_hybrid_cost/screen_2.png" height="150" alt="Hybrid Cost" /> <img src="docs/assets/apps/aurelm_hybrid_cost/screen_3.png" height="150" alt="Hybrid Cost" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/live_data/icon.png" width="48" height="48" alt="Live Data" /></td>
<td><strong>Live Data</strong> <code>v1.0.18</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/live_data/preview-01.png" height="150" alt="Live Data" /> <img src="docs/assets/apps/live_data/preview-02.png" height="150" alt="Live Data" /> <img src="docs/assets/apps/live_data/preview-03.png" height="150" alt="Live Data" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/car_vitals/icon.png" width="48" height="48" alt="M Vitals" /></td>
<td><strong>M Vitals</strong> <code>v2.27.9</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/car_vitals/preview-01.png" height="150" alt="M Vitals" /> <img src="docs/assets/apps/car_vitals/preview-02.png" height="150" alt="M Vitals" /> <img src="docs/assets/apps/car_vitals/preview-03.png" height="150" alt="M Vitals" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/osa/icon.png" width="48" height="48" alt="Oil Service Assistant" /></td>
<td><strong>Oil Service Assistant</strong> <code>v0.2.51</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/osa/screen_1.png" height="150" alt="Oil Service Assistant" /> <img src="docs/assets/apps/osa/screen_2.png" height="150" alt="Oil Service Assistant" /> <img src="docs/assets/apps/osa/screen_3.png" height="150" alt="Oil Service Assistant" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_service/icon.png" width="48" height="48" alt="Service" /></td>
<td><strong>Service</strong> <code>v1.0.0</code> &nbsp;·&nbsp; <code>ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_service/screen_1.png" height="150" alt="Service" /> <img src="docs/assets/apps/iteriodev_service/screen_2.png" height="150" alt="Service" /> <img src="docs/assets/apps/iteriodev_service/screen_3.png" height="150" alt="Service" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/service/icon.png" width="48" height="48" alt="Service" /></td>
<td><strong>Service</strong> <code>v1.6.3</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/service/preview-01.png" height="150" alt="Service" /> <img src="docs/assets/apps/service/screen_2.png" height="150" alt="Service" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/spritmonitor/icon.png" width="48" height="48" alt="Spritmonitor" /></td>
<td><strong>Spritmonitor</strong> <code>v0.1.45</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/spritmonitor/screen_1.png" height="150" alt="Spritmonitor" /> <img src="docs/assets/apps/spritmonitor/screen_2.png" height="150" alt="Spritmonitor" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/ida_vitals/icon.png" width="48" height="48" alt="Vitals" /></td>
<td><strong>Vitals</strong> <code>v1.3.1</code> &nbsp;·&nbsp; <code>ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/ida_vitals/screen_1.png" height="150" alt="Vitals" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/warmup/icon.png" width="48" height="48" alt="Warm-Up" /></td>
<td><strong>Warm-Up</strong> <code>v1.9.0</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/warmup/preview-01.png" height="150" alt="Warm-Up" /> <img src="docs/assets/apps/warmup/preview-02.gif" height="150" alt="Warm-Up" /> <img src="docs/assets/apps/warmup/preview-03.png" height="150" alt="Warm-Up" /></td>
</tr></table>

<table>
<tr>
<td width="50%"><img src="docs/assets/apps/dimon_battery/icon.png" width="36" height="36" align="left" alt="Battery &amp; Electrical" />&nbsp;&nbsp;<strong>Battery &amp; Electrical</strong><br>&nbsp;&nbsp;<code>v1.0.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/marku_x3_coding/icon.png" width="36" height="36" align="left" alt="Bimmer Code" />&nbsp;&nbsp;<strong>Bimmer Code</strong><br>&nbsp;&nbsp;<code>v0.2.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/vehicle_pass/icon.png" width="36" height="36" align="left" alt="Bimmer Pass" />&nbsp;&nbsp;<strong>Bimmer Pass</strong><br>&nbsp;&nbsp;<code>v1.1.1</code> · <code>ID7 / ID8</code></td>
<td width="50%"><img src="docs/assets/apps/aref_carcare/icon.png" width="36" height="36" align="left" alt="Car Care" />&nbsp;&nbsp;<strong>Car Care</strong><br>&nbsp;&nbsp;<code>v0.2.4</code> · <code>ID7 / ID8</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/aref_carwatch/icon.png" width="36" height="36" align="left" alt="Car Watch" />&nbsp;&nbsp;<strong>Car Watch</strong><br>&nbsp;&nbsp;<code>v0.1.3</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/f44_traffic_diag/icon.png" width="36" height="36" align="left" alt="Diagnostic panneaux F44" />&nbsp;&nbsp;<strong>Diagnostic panneaux F44</strong><br>&nbsp;&nbsp;<code>v0.1.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/woodr_diag/icon.png" width="36" height="36" align="left" alt="Diagnostics" />&nbsp;&nbsp;<strong>Diagnostics</strong><br>&nbsp;&nbsp;<code>v0.2.2</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/dpf_monitor/icon.png" width="36" height="36" align="left" alt="DPF Monitor" />&nbsp;&nbsp;<strong>DPF Monitor</strong><br>&nbsp;&nbsp;<code>v0.2.8</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/dpf_id7/icon.png" width="36" height="36" align="left" alt="DPF Monitoring" />&nbsp;&nbsp;<strong>DPF Monitoring</strong><br>&nbsp;&nbsp;<code>v1.1.1</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/dpf_id8/icon.png" width="36" height="36" align="left" alt="DPF Monitoring (iDrive 8, untested)" />&nbsp;&nbsp;<strong>DPF Monitoring (iDrive 8, untested)</strong><br>&nbsp;&nbsp;<code>v1.0.0</code> · <code>ID8</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/c365_drive/icon.png" width="36" height="36" align="left" alt="Drive" />&nbsp;&nbsp;<strong>Drive</strong><br>&nbsp;&nbsp;<code>v1.9.3</code> · <code>ID7 / ID8</code></td>
<td width="50%"><img src="docs/assets/apps/aref_drivelog/icon.png" width="36" height="36" align="left" alt="Drive Log" />&nbsp;&nbsp;<strong>Drive Log</strong><br>&nbsp;&nbsp;<code>v0.3.2</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/woodr_drivelog/icon.png" width="36" height="36" align="left" alt="Drive Log" />&nbsp;&nbsp;<strong>Drive Log</strong><br>&nbsp;&nbsp;<code>v0.1.1</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/boostline/icon.png" width="36" height="36" align="left" alt="ECU Live Data" />&nbsp;&nbsp;<strong>ECU Live Data</strong><br>&nbsp;&nbsp;<code>v1.0.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/boostline_id8/icon.png" width="36" height="36" align="left" alt="ECU Live Data (iDrive 8, untested)" />&nbsp;&nbsp;<strong>ECU Live Data (iDrive 8, untested)</strong><br>&nbsp;&nbsp;<code>v1.0.0</code> · <code>ID8</code></td>
<td width="50%"><img src="docs/assets/apps/noahg_fscpatcher/icon.png" width="36" height="36" align="left" alt="FSC Patch" />&nbsp;&nbsp;<strong>FSC Patch</strong><br>&nbsp;&nbsp;<code>v1.0.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/mgu_audio_diagnostics/icon.png" width="36" height="36" align="left" alt="MGU Audio Diagnostics" />&nbsp;&nbsp;<strong>MGU Audio Diagnostics</strong><br>&nbsp;&nbsp;<code>v0.1.2</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/benspa_vitals/icon.png" width="36" height="36" align="left" alt="Mon Vitals" />&nbsp;&nbsp;<strong>Mon Vitals</strong><br>&nbsp;&nbsp;<code>v0.9.6</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/km_motordaten/icon.png" width="36" height="36" align="left" alt="Motordaten" />&nbsp;&nbsp;<strong>Motordaten</strong><br>&nbsp;&nbsp;<code>v0.4.1</code> · <code>ID7 / ID8</code></td>
<td width="50%"><img src="docs/assets/apps/noahg_obdbridge/icon.png" width="36" height="36" align="left" alt="OBD Bridge" />&nbsp;&nbsp;<strong>OBD Bridge</strong><br>&nbsp;&nbsp;<code>v1.0.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/pps_gauges/icon.png" width="36" height="36" align="left" alt="Proven Gauges" />&nbsp;&nbsp;<strong>Proven Gauges</strong><br>&nbsp;&nbsp;<code>v1.0.3</code> · <code>ID7 / ID8</code></td>
<td width="50%"><img src="docs/assets/apps/pps_warmup/icon.png" width="36" height="36" align="left" alt="Proven Warm-Up" />&nbsp;&nbsp;<strong>Proven Warm-Up</strong><br>&nbsp;&nbsp;<code>v1.2.1</code> · <code>ID7 / ID8</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/road_trip_computer/icon.png" width="36" height="36" align="left" alt="Road Trip Computer" />&nbsp;&nbsp;<strong>Road Trip Computer</strong><br>&nbsp;&nbsp;<code>v1.0.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/start_stop_insight/icon.png" width="36" height="36" align="left" alt="Start/Stop Insight" />&nbsp;&nbsp;<strong>Start/Stop Insight</strong><br>&nbsp;&nbsp;<code>v0.1.3</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/telemetry_studio/icon.png" width="36" height="36" align="left" alt="Telemetry Studio" />&nbsp;&nbsp;<strong>Telemetry Studio</strong><br>&nbsp;&nbsp;<code>v0.2.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/aref_tires/icon.png" width="36" height="36" align="left" alt="Tire Setup" />&nbsp;&nbsp;<strong>Tire Setup</strong><br>&nbsp;&nbsp;<code>v0.2.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/vehicle_health/icon.png" width="36" height="36" align="left" alt="Vehicle Health Center" />&nbsp;&nbsp;<strong>Vehicle Health Center</strong><br>&nbsp;&nbsp;<code>v0.1.9</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/vehicle_network/icon.png" width="36" height="36" align="left" alt="Vehicle Network" />&nbsp;&nbsp;<strong>Vehicle Network</strong><br>&nbsp;&nbsp;<code>v0.1.3</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/marku_x3_health/icon.png" width="36" height="36" align="left" alt="Здоровье X3" />&nbsp;&nbsp;<strong>Здоровье X3</strong><br>&nbsp;&nbsp;<code>v0.2.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/marku_x3_trips/icon.png" width="36" height="36" align="left" alt="Поездки и расходы" />&nbsp;&nbsp;<strong>Поездки и расходы</strong><br>&nbsp;&nbsp;<code>v0.2.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/marku_x3_warm/icon.png" width="36" height="36" align="left" alt="Тёплый старт" />&nbsp;&nbsp;<strong>Тёплый старт</strong><br>&nbsp;&nbsp;<code>v0.2.0</code> · <code>ID7</code></td>
<td width="50%"></td>
</tr>
</table>

## Media, Video & Casting

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/clucraft_plex/icon.png" width="48" height="48" alt="Drive-In" /></td>
<td><strong>Drive-In</strong> <code>v0.1.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/clucraft_plex/screen_1.png" height="150" alt="Drive-In" /> <img src="docs/assets/apps/clucraft_plex/screen_2.png" height="150" alt="Drive-In" /> <img src="docs/assets/apps/clucraft_plex/screen_3.png" height="150" alt="Drive-In" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/clucraft_jellyfin/icon.png" width="48" height="48" alt="Drivefin" /></td>
<td><strong>Drivefin</strong> <code>v0.1.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/clucraft_jellyfin/screen_1.png" height="150" alt="Drivefin" /> <img src="docs/assets/apps/clucraft_jellyfin/screen_2.png" height="150" alt="Drivefin" /> <img src="docs/assets/apps/clucraft_jellyfin/screen_3.png" height="150" alt="Drivefin" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/jap_moonride/icon.png" width="48" height="48" alt="Moonride" /></td>
<td><strong>Moonride</strong> <code>v0.3.4</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/jap_moonride/screen_1.png" height="150" alt="Moonride" /> <img src="docs/assets/apps/jap_moonride/screen_2.png" height="150" alt="Moonride" /> <img src="docs/assets/apps/jap_moonride/screen_3.png" height="150" alt="Moonride" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_myairplay/icon.png" width="48" height="48" alt="myAirPlay" /></td>
<td><strong>myAirPlay</strong> <code>v1.0.1</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_myairplay/screen_1.png" height="150" alt="myAirPlay" /> <img src="docs/assets/apps/aurelm_myairplay/screen_2.png" height="150" alt="myAirPlay" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/pllana_airplay/icon.png" width="48" height="48" alt="PllanaCast for BMW" /></td>
<td><strong>PllanaCast for BMW</strong> <code>v0.6.3</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/pllana_airplay/screen_1.png" height="150" alt="PllanaCast for BMW" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/jap_ridetube/icon.png" width="48" height="48" alt="RideTube" /></td>
<td><strong>RideTube</strong> <code>v0.4.5</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/jap_ridetube/screen_1.png" height="150" alt="RideTube" /> <img src="docs/assets/apps/jap_ridetube/screen_2.png" height="150" alt="RideTube" /> <img src="docs/assets/apps/jap_ridetube/screen_3.png" height="150" alt="RideTube" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/spotify/icon.png" width="48" height="48" alt="Spotify" /></td>
<td><strong>Spotify</strong> <code>v1.0.30</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/spotify/preview-01.png" height="150" alt="Spotify" /> <img src="docs/assets/apps/spotify/preview-02.png" height="150" alt="Spotify" /> <img src="docs/assets/apps/spotify/preview-03.png" height="150" alt="Spotify" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_tvhplayer/icon.png" width="48" height="48" alt="TVH Player" /></td>
<td><strong>TVH Player</strong> <code>v1.0.4</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_tvhplayer/screen_1.png" height="150" alt="TVH Player" /> <img src="docs/assets/apps/aurelm_tvhplayer/screen_2.png" height="150" alt="TVH Player" /> <img src="docs/assets/apps/aurelm_tvhplayer/screen_3.png" height="150" alt="TVH Player" /></td>
</tr></table>

<table>
<tr>
<td width="50%"><img src="docs/assets/apps/apm_airplay/icon.png" width="36" height="36" align="left" alt="AirPlay" />&nbsp;&nbsp;<strong>AirPlay</strong><br>&nbsp;&nbsp;<code>v1.0.6</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/base_player/icon.png" width="36" height="36" align="left" alt="Base Player" />&nbsp;&nbsp;<strong>Base Player</strong><br>&nbsp;&nbsp;<code>v0.2.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/vizualyse_chromium/icon.png" width="36" height="36" align="left" alt="Browser" />&nbsp;&nbsp;<strong>Browser</strong><br>&nbsp;&nbsp;<code>v0.3.1</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/mgu_browser/icon.png" width="36" height="36" align="left" alt="Browser (experimental)" />&nbsp;&nbsp;<strong>Browser (experimental)</strong><br>&nbsp;&nbsp;<code>v0.16.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/drake1804_youtube/icon.png" width="36" height="36" align="left" alt="Bube" />&nbsp;&nbsp;<strong>Bube</strong><br>&nbsp;&nbsp;<code>v0.1.10</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/aref_carlyrics/icon.png" width="36" height="36" align="left" alt="Car Lyrics" />&nbsp;&nbsp;<strong>Car Lyrics</strong><br>&nbsp;&nbsp;<code>v0.3.10</code> · <code>ID7 / ID8</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/vizualyse_cast/icon.png" width="36" height="36" align="left" alt="Cast" />&nbsp;&nbsp;<strong>Cast</strong><br>&nbsp;&nbsp;<code>v0.4.1</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/aurelm_emby/icon.png" width="36" height="36" align="left" alt="Emby" />&nbsp;&nbsp;<strong>Emby</strong><br>&nbsp;&nbsp;<code>v0.3.14</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/equalizer/icon.png" width="36" height="36" align="left" alt="Equalizer" />&nbsp;&nbsp;<strong>Equalizer</strong><br>&nbsp;&nbsp;<code>v0.2.4</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/amn_iptv/icon.png" width="36" height="36" align="left" alt="IPTV" />&nbsp;&nbsp;<strong>IPTV</strong><br>&nbsp;&nbsp;<code>v0.4.2</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/mgu_video_hub/icon.png" width="36" height="36" align="left" alt="MGU Video Hub" />&nbsp;&nbsp;<strong>MGU Video Hub</strong><br>&nbsp;&nbsp;<code>v0.2.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/vizualyse_moonlight/icon.png" width="36" height="36" align="left" alt="Moonlight" />&nbsp;&nbsp;<strong>Moonlight</strong><br>&nbsp;&nbsp;<code>v0.3.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/aurelm_music/icon.png" width="36" height="36" align="left" alt="Music Assistant" />&nbsp;&nbsp;<strong>Music Assistant</strong><br>&nbsp;&nbsp;<code>v0.1.17</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/mdq_ridetube/icon.png" width="36" height="36" align="left" alt="RideTube (fork by 7amoody1985)" />&nbsp;&nbsp;<strong>RideTube (fork by 7amoody1985)</strong><br>&nbsp;&nbsp;<code>v0.4.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/vizualyse_steam/icon.png" width="36" height="36" align="left" alt="Steam" />&nbsp;&nbsp;<strong>Steam</strong><br>&nbsp;&nbsp;<code>v0.2.1</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/oussem_youtube/icon.png" width="36" height="36" align="left" alt="YouTube (experimental)" />&nbsp;&nbsp;<strong>YouTube (experimental)</strong><br>&nbsp;&nbsp;<code>v0.2.2</code> · <code>ID7</code></td>
</tr>
</table>

## Lighting, Cameras & Comfort

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/ambient_config/icon.png" width="48" height="48" alt="Ambient config" /></td>
<td><strong>Ambient config</strong> <code>v2.7.13</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/ambient_config/preview-01.png" height="150" alt="Ambient config" /> <img src="docs/assets/apps/ambient_config/screen_2.png" height="150" alt="Ambient config" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/dorin_ambientdrive/icon.png" width="48" height="48" alt="Ambient Drive" /></td>
<td><strong>Ambient Drive</strong> <code>v0.2.7</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/dorin_ambientdrive/screen_1.png" height="150" alt="Ambient Drive" /> <img src="docs/assets/apps/dorin_ambientdrive/screen_2.png" height="150" alt="Ambient Drive" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_ambient/icon.png" width="48" height="48" alt="Ambient Light" /></td>
<td><strong>Ambient Light</strong> <code>v1.4.3</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_ambient/screen_1.png" height="150" alt="Ambient Light" /> <img src="docs/assets/apps/iteriodev_ambient/screen_2.png" height="150" alt="Ambient Light" /> <img src="docs/assets/apps/iteriodev_ambient/screen_3.png" height="150" alt="Ambient Light" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/bimmervision/icon.png" width="48" height="48" alt="BimmerVision" /></td>
<td><strong>BimmerVision</strong> <code>v0.2.78</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/bimmervision/screen_1.gif" height="150" alt="BimmerVision" /> <img src="docs/assets/apps/bimmervision/screen_2.png" height="150" alt="BimmerVision" /> <img src="docs/assets/apps/bimmervision/screen_3.png" height="150" alt="BimmerVision" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/oap-driverecorder-next/icon.png" width="48" height="48" alt="Drive Recorder" /></td>
<td><strong>Drive Recorder</strong> <code>v2.5.1</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/oap-driverecorder-next/screen_1.png" height="150" alt="Drive Recorder" /> <img src="docs/assets/apps/oap-driverecorder-next/screen_2.png" height="150" alt="Drive Recorder" /> <img src="docs/assets/apps/oap-driverecorder-next/screen_3.png" height="150" alt="Drive Recorder" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/mdev_homeassistant/icon.png" width="48" height="48" alt="Home Assistant" /></td>
<td><strong>Home Assistant</strong> <code>v0.1.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/mdev_homeassistant/screen_1.png" height="150" alt="Home Assistant" /> <img src="docs/assets/apps/mdev_homeassistant/screen_2.png" height="150" alt="Home Assistant" /> <img src="docs/assets/apps/mdev_homeassistant/screen_3.png" height="150" alt="Home Assistant" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_overlays/icon.png" width="48" height="48" alt="Overlays" /></td>
<td><strong>Overlays</strong> <code>v1.4.0</code> &nbsp;·&nbsp; <code>ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_overlays/screen_1.png" height="150" alt="Overlays" /> <img src="docs/assets/apps/iteriodev_overlays/screen_2.png" height="150" alt="Overlays" /> <img src="docs/assets/apps/iteriodev_overlays/screen_3.png" height="150" alt="Overlays" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_seats/icon.png" width="48" height="48" alt="Seats" /></td>
<td><strong>Seats</strong> <code>v1.6.3</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_seats/screen_1.png" height="150" alt="Seats" /> <img src="docs/assets/apps/iteriodev_seats/screen_2.png" height="150" alt="Seats" /> <img src="docs/assets/apps/iteriodev_seats/screen_3.png" height="150" alt="Seats" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/gs_ambient/icon.png" width="48" height="48" alt="TJM Ambient Colour Wheel" /></td>
<td><strong>TJM Ambient Colour Wheel</strong> <code>v0.1.10</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/gs_ambient/screen_1.png" height="150" alt="TJM Ambient Colour Wheel" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_turnview/icon.png" width="48" height="48" alt="Turn View" /></td>
<td><strong>Turn View</strong> <code>v1.6.0</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_turnview/screen_1.png" height="150" alt="Turn View" /> <img src="docs/assets/apps/iteriodev_turnview/screen_2.png" height="150" alt="Turn View" /> <img src="docs/assets/apps/iteriodev_turnview/screen_3.png" height="150" alt="Turn View" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_wheel_heat/icon.png" width="48" height="48" alt="Wheel Heating" /></td>
<td><strong>Wheel Heating</strong> <code>v1.0.6</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_wheel_heat/screen_1.png" height="150" alt="Wheel Heating" /> <img src="docs/assets/apps/aurelm_wheel_heat/screen_2.png" height="150" alt="Wheel Heating" /></td>
</tr></table>

<table>
<tr>
<td width="50%"><img src="docs/assets/apps/ambient_studio_full/icon.png" width="36" height="36" align="left" alt="Ambient Studio" />&nbsp;&nbsp;<strong>Ambient Studio</strong><br>&nbsp;&nbsp;<code>v0.1.5</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/woodr_ambient/icon.png" width="36" height="36" align="left" alt="Ambient Studio" />&nbsp;&nbsp;<strong>Ambient Studio</strong><br>&nbsp;&nbsp;<code>v0.1.7</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/woodr_dashcam/icon.png" width="36" height="36" align="left" alt="Dashcam" />&nbsp;&nbsp;<strong>Dashcam</strong><br>&nbsp;&nbsp;<code>v0.4.4</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/g21_ambient/icon.png" width="36" height="36" align="left" alt="G21 Ambient Lighting" />&nbsp;&nbsp;<strong>G21 Ambient Lighting</strong><br>&nbsp;&nbsp;<code>v0.4.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/g21_wheelheat/icon.png" width="36" height="36" align="left" alt="G21 Heating Comfort" />&nbsp;&nbsp;<strong>G21 Heating Comfort</strong><br>&nbsp;&nbsp;<code>v0.5.2</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/gif_home/icon.png" width="36" height="36" align="left" alt="GIF Home" />&nbsp;&nbsp;<strong>GIF Home</strong><br>&nbsp;&nbsp;<code>v0.3.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/green_light_alert/icon.png" width="36" height="36" align="left" alt="Green Light Alert" />&nbsp;&nbsp;<strong>Green Light Alert</strong><br>&nbsp;&nbsp;<code>v0.2.5</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/woodr_hass/icon.png" width="36" height="36" align="left" alt="Home Assistant" />&nbsp;&nbsp;<strong>Home Assistant</strong><br>&nbsp;&nbsp;<code>v0.8.2</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/light_flasher/icon.png" width="36" height="36" align="left" alt="Light Flasher" />&nbsp;&nbsp;<strong>Light Flasher</strong><br>&nbsp;&nbsp;<code>v0.1.15</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/ida_lightlog/icon.png" width="36" height="36" align="left" alt="Light Logger" />&nbsp;&nbsp;<strong>Light Logger</strong><br>&nbsp;&nbsp;<code>v1.3.1</code> · <code>ID8</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/light_show/icon.png" width="36" height="36" align="left" alt="Light Show" />&nbsp;&nbsp;<strong>Light Show</strong><br>&nbsp;&nbsp;<code>v0.4.5</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/parking_clearance/icon.png" width="36" height="36" align="left" alt="Parking &amp; Clearance" />&nbsp;&nbsp;<strong>Parking &amp; Clearance</strong><br>&nbsp;&nbsp;<code>v0.1.8</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/rear_comfort/icon.png" width="36" height="36" align="left" alt="Rear Comfort" />&nbsp;&nbsp;<strong>Rear Comfort</strong><br>&nbsp;&nbsp;<code>v0.5.6</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/ida_seatlights/icon.png" width="36" height="36" align="left" alt="Seat Lights" />&nbsp;&nbsp;<strong>Seat Lights</strong><br>&nbsp;&nbsp;<code>v1.3.2</code> · <code>ID8</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/amn_sideview/icon.png" width="36" height="36" align="left" alt="Side View" />&nbsp;&nbsp;<strong>Side View</strong><br>&nbsp;&nbsp;<code>v0.5.4</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/marku_kaluga_cameras/icon.png" width="36" height="36" align="left" alt="Waze Стрелка" />&nbsp;&nbsp;<strong>Waze Стрелка</strong><br>&nbsp;&nbsp;<code>v0.9.3</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/marku_x3_home/icon.png" width="36" height="36" align="left" alt="X3 ↔ Дом" />&nbsp;&nbsp;<strong>X3 ↔ Дом</strong><br>&nbsp;&nbsp;<code>v0.2.0</code> · <code>ID7</code></td>
<td width="50%"></td>
</tr>
</table>

## Utilities & System

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/climate-comfort/icon.png" width="48" height="48" alt="Climate Comfort" /></td>
<td><strong>Climate Comfort</strong> <code>v0.1.60</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/climate-comfort/screen_1.png" height="150" alt="Climate Comfort" /> <img src="docs/assets/apps/climate-comfort/screen_2.png" height="150" alt="Climate Comfort" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/jap_sysmon/icon.png" width="48" height="48" alt="iDrive Monitor" /></td>
<td><strong>iDrive Monitor</strong> <code>v1.0.6</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/jap_sysmon/screen_1.png" height="150" alt="iDrive Monitor" /> <img src="docs/assets/apps/jap_sysmon/screen_2.png" height="150" alt="iDrive Monitor" /> <img src="docs/assets/apps/jap_sysmon/screen_3.png" height="150" alt="iDrive Monitor" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/m_copilot/icon.png" width="48" height="48" alt="M-Copilot" /></td>
<td><strong>M-Copilot</strong> <code>v1.0.31</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/m_copilot/preview-01.png" height="150" alt="M-Copilot" /> <img src="docs/assets/apps/m_copilot/preview-02.png" height="150" alt="M-Copilot" /> <img src="docs/assets/apps/m_copilot/preview-03.png" height="150" alt="M-Copilot" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/jap_ridewatch/icon.png" width="48" height="48" alt="RideWatch" /></td>
<td><strong>RideWatch</strong> <code>v0.3.2</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/jap_ridewatch/screen_1.png" height="150" alt="RideWatch" /> <img src="docs/assets/apps/jap_ridewatch/screen_2.png" height="150" alt="RideWatch" /> <img src="docs/assets/apps/jap_ridewatch/screen_3.png" height="150" alt="RideWatch" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/robertn_store/icon.png" width="48" height="48" alt="Store" /></td>
<td><strong>Store</strong> <code>v0.9.41</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/robertn_store/preview-01.png" height="150" alt="Store" /> <img src="docs/assets/apps/robertn_store/screen_2.png" height="150" alt="Store" /> <img src="docs/assets/apps/robertn_store/screen_3.png" height="150" alt="Store" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/sys_monitor/icon.png" width="48" height="48" alt="System Monitor" /></td>
<td><strong>System Monitor</strong> <code>v1.0.4</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/sys_monitor/preview-01.png" height="150" alt="System Monitor" /> <img src="docs/assets/apps/sys_monitor/preview-02.png" height="150" alt="System Monitor" /> <img src="docs/assets/apps/sys_monitor/preview-03.png" height="150" alt="System Monitor" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iteriodev_tailscale/icon.png" width="48" height="48" alt="Tailscale" /></td>
<td><strong>Tailscale</strong> <code>v1.2.0</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iteriodev_tailscale/screen_1.png" height="150" alt="Tailscale" /> <img src="docs/assets/apps/iteriodev_tailscale/screen_2.png" height="150" alt="Tailscale" /> <img src="docs/assets/apps/iteriodev_tailscale/screen_3.png" height="150" alt="Tailscale" /></td>
</tr></table>

<table>
<tr>
<td width="50%"><img src="docs/assets/apps/adas_feature_probe/icon.png" width="36" height="36" align="left" alt="ADAS Feature Probe" />&nbsp;&nbsp;<strong>ADAS Feature Probe</strong><br>&nbsp;&nbsp;<code>v0.1.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/aref_explorer/icon.png" width="36" height="36" align="left" alt="Car Explorer" />&nbsp;&nbsp;<strong>Car Explorer</strong><br>&nbsp;&nbsp;<code>v0.2.3</code> · <code>ID7 / ID8</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/driver_profiles/icon.png" width="36" height="36" align="left" alt="Driver Profiles" />&nbsp;&nbsp;<strong>Driver Profiles</strong><br>&nbsp;&nbsp;<code>v0.2.2</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/eldrive/icon.png" width="36" height="36" align="left" alt="elDrive" />&nbsp;&nbsp;<strong>elDrive</strong><br>&nbsp;&nbsp;<code>v1.1.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/aref_faultwatch/icon.png" width="36" height="36" align="left" alt="Fault Watch" />&nbsp;&nbsp;<strong>Fault Watch</strong><br>&nbsp;&nbsp;<code>v0.2.2</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/hotspot_studio/icon.png" width="36" height="36" align="left" alt="Hotspot Studio" />&nbsp;&nbsp;<strong>Hotspot Studio</strong><br>&nbsp;&nbsp;<code>v0.1.5</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/woodr_inputlab/icon.png" width="36" height="36" align="left" alt="Input Lab" />&nbsp;&nbsp;<strong>Input Lab</strong><br>&nbsp;&nbsp;<code>v0.1.3</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/kombikraft/icon.png" width="36" height="36" align="left" alt="KombiKraft Lab — Offline prototype" />&nbsp;&nbsp;<strong>KombiKraft Lab — Offline prototype</strong><br>&nbsp;&nbsp;<code>v0.1.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/kombikraft_test/icon.png" width="36" height="36" align="left" alt="KombiKraft Themes" />&nbsp;&nbsp;<strong>KombiKraft Themes</strong><br>&nbsp;&nbsp;<code>v0.1.28</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/woodr_link/icon.png" width="36" height="36" align="left" alt="Link" />&nbsp;&nbsp;<strong>Link</strong><br>&nbsp;&nbsp;<code>v0.1.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/aurelm_mediaprobe/icon.png" width="36" height="36" align="left" alt="Media Probe" />&nbsp;&nbsp;<strong>Media Probe</strong><br>&nbsp;&nbsp;<code>v0.1.3</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/ab_storage/icon.png" width="36" height="36" align="left" alt="MGU Storage Monitor" />&nbsp;&nbsp;<strong>MGU Storage Monitor</strong><br>&nbsp;&nbsp;<code>v1.2.4</code> · <code>ID7 / ID8</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/mgu_unified/icon.png" width="36" height="36" align="left" alt="MGU Tools" />&nbsp;&nbsp;<strong>MGU Tools</strong><br>&nbsp;&nbsp;<code>v0.1.11</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/aref_misfire/icon.png" width="36" height="36" align="left" alt="Misfire Watch" />&nbsp;&nbsp;<strong>Misfire Watch</strong><br>&nbsp;&nbsp;<code>v0.1.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/mgu_phone_terminal/icon.png" width="36" height="36" align="left" alt="Phone Terminal" />&nbsp;&nbsp;<strong>Phone Terminal</strong><br>&nbsp;&nbsp;<code>v0.1.7</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/woodr_screenlab/icon.png" width="36" height="36" align="left" alt="Screen Lab" />&nbsp;&nbsp;<strong>Screen Lab</strong><br>&nbsp;&nbsp;<code>v0.2.3</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/signal_probe/icon.png" width="36" height="36" align="left" alt="Signal Probe" />&nbsp;&nbsp;<strong>Signal Probe</strong><br>&nbsp;&nbsp;<code>v0.4.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/bcs_store/icon.png" width="36" height="36" align="left" alt="Store" />&nbsp;&nbsp;<strong>Store</strong><br>&nbsp;&nbsp;<code>v3.4.5</code> · <code>ID7 / ID8</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/turnkey_e_blend_id8/icon.png" width="36" height="36" align="left" alt="TurnKey E Blend" />&nbsp;&nbsp;<strong>TurnKey E Blend</strong><br>&nbsp;&nbsp;<code>v0.5.0</code> · <code>ID8</code></td>
<td width="50%"><img src="docs/assets/apps/drake1804_checks/icon.png" width="36" height="36" align="left" alt="YouTube Checks" />&nbsp;&nbsp;<strong>YouTube Checks</strong><br>&nbsp;&nbsp;<code>v0.1.0</code> · <code>ID7</code></td>
</tr>
</table>

## Games

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_apex_chase/icon.png" width="48" height="48" alt="Apex Chase" /></td>
<td><strong>Apex Chase</strong> <code>v1.0.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_apex_chase/screen_1.png" height="150" alt="Apex Chase" /> <img src="docs/assets/apps/aurelm_apex_chase/screen_2.png" height="150" alt="Apex Chase" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_blackjack/icon.png" width="48" height="48" alt="Blackjack" /></td>
<td><strong>Blackjack</strong> <code>v1.0.1</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_blackjack/screen_1.png" height="150" alt="Blackjack" /> <img src="docs/assets/apps/aurelm_blackjack/screen_2.png" height="150" alt="Blackjack" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/doom/icon.png" width="48" height="48" alt="Doom" /></td>
<td><strong>Doom</strong> <code>v1.7.22</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/doom/preview-01.png" height="150" alt="Doom" /> <img src="docs/assets/apps/doom/screen_2.png" height="150" alt="Doom" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_lap_record/icon.png" width="48" height="48" alt="Lap Record" /></td>
<td><strong>Lap Record</strong> <code>v1.0.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_lap_record/screen_1.png" height="150" alt="Lap Record" /> <img src="docs/assets/apps/aurelm_lap_record/screen_2.png" height="150" alt="Lap Record" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_lucky_sevens/icon.png" width="48" height="48" alt="Lucky Sevens" /></td>
<td><strong>Lucky Sevens</strong> <code>v1.1.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_lucky_sevens/screen_1.png" height="150" alt="Lucky Sevens" /> <img src="docs/assets/apps/aurelm_lucky_sevens/screen_2.png" height="150" alt="Lucky Sevens" /> <img src="docs/assets/apps/aurelm_lucky_sevens/screen_3.png" height="150" alt="Lucky Sevens" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/iabadia_m_arcade/icon.png" width="48" height="48" alt="M Arcade" /></td>
<td><strong>M Arcade</strong> <code>v0.1.3</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/iabadia_m_arcade/screen_1.gif" height="150" alt="M Arcade" /> <img src="docs/assets/apps/iabadia_m_arcade/screen_2.png" height="150" alt="M Arcade" /> <img src="docs/assets/apps/iabadia_m_arcade/screen_3.png" height="150" alt="M Arcade" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_pinball/icon.png" width="48" height="48" alt="M Pinball" /></td>
<td><strong>M Pinball</strong> <code>v1.0.1</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_pinball/screen_1.png" height="150" alt="M Pinball" /> <img src="docs/assets/apps/aurelm_pinball/screen_2.png" height="150" alt="M Pinball" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/parked_games/icon.png" width="48" height="48" alt="Parked Games" /></td>
<td><strong>Parked Games</strong> <code>v0.2.3</code> &nbsp;·&nbsp; <code>ID7 / ID8</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/parked_games/screen_1.png" height="150" alt="Parked Games" /> <img src="docs/assets/apps/parked_games/screen_2.png" height="150" alt="Parked Games" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_pit_wall/icon.png" width="48" height="48" alt="Pit Wall" /></td>
<td><strong>Pit Wall</strong> <code>v1.0.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_pit_wall/screen_1.png" height="150" alt="Pit Wall" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_ridge_duel/icon.png" width="48" height="48" alt="Ridge Duel" /></td>
<td><strong>Ridge Duel</strong> <code>v1.0.1</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_ridge_duel/screen_1.png" height="150" alt="Ridge Duel" /> <img src="docs/assets/apps/aurelm_ridge_duel/screen_2.png" height="150" alt="Ridge Duel" /> <img src="docs/assets/apps/aurelm_ridge_duel/screen_3.png" height="150" alt="Ridge Duel" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/mx_road_hopper/icon.png" width="48" height="48" alt="Road Hopper" /></td>
<td><strong>Road Hopper</strong> <code>v0.1.1</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/mx_road_hopper/screen_1.png" height="150" alt="Road Hopper" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_snake/icon.png" width="48" height="48" alt="Snake" /></td>
<td><strong>Snake</strong> <code>v1.0.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_snake/screen_1.png" height="150" alt="Snake" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_solitaire/icon.png" width="48" height="48" alt="Solitaire" /></td>
<td><strong>Solitaire</strong> <code>v1.0.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_solitaire/screen_1.png" height="150" alt="Solitaire" /> <img src="docs/assets/apps/aurelm_solitaire/screen_2.png" height="150" alt="Solitaire" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_street_siege/icon.png" width="48" height="48" alt="Street Siege" /></td>
<td><strong>Street Siege</strong> <code>v1.1.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_street_siege/screen_1.png" height="150" alt="Street Siege" /> <img src="docs/assets/apps/aurelm_street_siege/screen_2.png" height="150" alt="Street Siege" /></td>
</tr></table>

<table><tr>
<td width="64" align="center"><img src="docs/assets/apps/aurelm_track_defender/icon.png" width="48" height="48" alt="Track Defender" /></td>
<td><strong>Track Defender</strong> <code>v1.0.0</code> &nbsp;·&nbsp; <code>ID7</code></td>
</tr><tr>
<td colspan="2"><img src="docs/assets/apps/aurelm_track_defender/screen_1.png" height="150" alt="Track Defender" /></td>
</tr></table>

<table>
<tr>
<td width="50%"><img src="docs/assets/apps/bimmer_blocks/icon.png" width="36" height="36" align="left" alt="Bimmer Blocks" />&nbsp;&nbsp;<strong>Bimmer Blocks</strong><br>&nbsp;&nbsp;<code>v1.1.1</code> · <code>ID7 / ID8</code></td>
<td width="50%"><img src="docs/assets/apps/kxrxh_doodle_jump/icon.png" width="36" height="36" align="left" alt="Doodle Jump" />&nbsp;&nbsp;<strong>Doodle Jump</strong><br>&nbsp;&nbsp;<code>v0.9.0</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/mgu_gamestation/icon.png" width="36" height="36" align="left" alt="MGU GameStation" />&nbsp;&nbsp;<strong>MGU GameStation</strong><br>&nbsp;&nbsp;<code>v0.3.0</code> · <code>ID7</code></td>
<td width="50%"><img src="docs/assets/apps/dk_backgammon/icon.png" width="36" height="36" align="left" alt="Нарды" />&nbsp;&nbsp;<strong>Нарды</strong><br>&nbsp;&nbsp;<code>v0.1.1</code> · <code>ID7</code></td>
</tr>
<tr>
<td width="50%"><img src="docs/assets/apps/dk_tetris/icon.png" width="36" height="36" align="left" alt="Тетрис" />&nbsp;&nbsp;<strong>Тетрис</strong><br>&nbsp;&nbsp;<code>v0.1.1</code> · <code>ID7</code></td>
<td width="50%"></td>
</tr>
</table>

## Helper Tools

<details>
<summary><strong>Show all 80 helper tools</strong></summary>

| Tool | Version | HMI |
|---|---|---|
| **AirPlay receiver** (`airplay-rx`) | `v1.0.0` | `ID7` |
| **IPTV service** (`amn-iptv`) | `v0.3.7` | `ID7` |
| **Side View camera** (`amn-sideview-cam`) | `v0.2.0` | `ID7` |
| **App privacy** (`app-privacy`) | `v1.7.2` | `ID7 / ID8` |
| **Emby cast service** (`aurelm-emby`) | `v0.3.13` | `ID7` |
| **Media Probe service** (`aurelm-mediaprobe`) | `v0.1.3` | `ID7` |
| **Music Assistant service** (`aurelm-music`) | `v0.1.9` | `ID7` |
| **myAirPlay service** (`aurelm-myairplay`) | `v1.0.1` | `ID7` |
| **TVH Player service** (`aurelm-tvhplayer`) | `v1.0.2` | `ID7` |
| **Base Player receiver** (`base-player-receiver`) | `v0.2.1` | `ID7` |
| **BimmerVision Recorder** (`bimmervision-recorder`) | `v0.2.78` | `ID7` |
| **Camera inspector** (`camera-inspect`) | `v0.1.1` | `ID7` |
| **CarPlay Map Producer** (`carplay-map`) | `v0.2.0` | `ID7` |
| **Drivefin service** (`clucraft-jellyfin`) | `v0.1.0` | `ID7` |
| **Drive-In service** (`clucraft-plex`) | `v0.1.0` | `ID7` |
| **Cluster renderer** (`cluster-render`) | `v0.6.9` | `ID7 / ID8` |
| **Doodle Jump GPU support** (`doodle-gpu`) | `v1.0.0` | `ID7` |
| **Ambient Drive Service** (`dorin-ambient`) | `v0.2.5` | `ID7` |
| **YouTube Checks helper** (`drake1804-checks`) | `v0.1.2` | `ID7` |
| **YouTube player** (`drake1804-ytplay`) | `v0.1.16` | `ID7` |
| **Esagono Cluster** (`esagono-cluster`) | `v0.2.1` | `ID8` |
| **F44 HUD experimental** (`f44-hud-bridge`) | `v0.12.0` | `ID7` |
| **Night Vision cluster helper** (`front-camera-cluster-helper`) | `v0.2.1` | `ID7` |
| **CarPlay cluster map (stream 111)** (`hook111`) | `v0.1.6` | `ID7` |
| **Hotspot Studio helper** (`hotspot-studio-helper`) | `v0.1.7` | `ID7` |
| **Vitals Cluster** (`ida-vitals-cluster`) | `v1.3.3` | `ID8` |
| **GPU renderer** (`idrive7-renderd`) | `v2.1.19` | `ID7 / ID8` |
| **iteriodev-comfort** (`iteriodev-comfort`) | `v0.6.3` | `ID7 / ID8` |
| **iteriodev-drplay** (`iteriodev-drplay`) | `v1.2.6` | `ID7 / ID8` |
| **iteriodev-overlays** (`iteriodev-overlays`) | `v0.5.0` | `ID8` |
| **iteriodev-screencast** (`iteriodev-screencast`) | `v1.0.9` | `ID7 / ID8` |
| **iteriodev-tailscale** (`iteriodev-tailscale`) | `v1.104.6` | `ID7 / ID8` |
| **iteriodev-turnview** (`iteriodev-turnview`) | `v0.9.1` | `ID7 / ID8` |
| **Moonride streaming service** (`jap-moonride`) | `v0.3.4` | `ID7` |
| **Node.js 22** (`jap-node22`) | `v22.23.4` | `ID7` |
| **RideTube service** (`jap-ridetube-d`) | `v0.4.2` | `ID7` |
| **RideWatch service** (`jap-ridewatch`) | `v0.3.2` | `ID7` |
| **Waze HUD on cluster** (`jap-waze-on-cluster`) | `v1.2.0` | `ID7` |
| **wireproxy** (`jap-wireproxy`) | `v1.1.3` | `ID7` |
| **Engine Sound service** (`lfb-enginesound`) | `v1.2.2` | `ID7` |
| **X3 Home bridge** (`marku-home-bridge`) | `v0.1.0` | `ID7` |
| **Waze Strelka camera service** (`marku-kaluga-cameras`) | `v0.9.3` | `ID7` |
| **Android Auto log (for CarLink)** (`mdq-aapd-log`) | `v0.1.1` | `ID7` |
| **RideTube service (fork by 7amoody1985)** (`mdq-ridetube-d`) | `v0.4.2` | `ID7` |
| **Browser runtime (experimental)** (`mgu-browser`) | `v0.16.1` | `ID7` |
| **Browser Chromium engine (experimental)** (`mgu-browser-engine`) | `v0.1.0` | `ID7` |
| **Custom Cluster Phone Port** (`mgu-cluster-net`) | `v0.1.0` | `ID7` |
| **Deploy tool** (`mgu-deploy`) | `v0.8.27` | `ID7 / ID8` |
| **Equalizer PCM DSP** (`mgu-equalizer-dsp`) | `v0.2.1` | `ID7` |
| **FSC patch service** (`mgu-fscpatch`) | `v1.0.0` | `ID7` |
| **GameStation Phone Port** (`mgu-game-net`) | `v0.1.0` | `ID7` |
| **Controller gate** (`mgu-inputgate`) | `v1.2.2` | `ID7 / ID8` |
| **Light Show Phone Port** (`mgu-light-net`) | `v0.1.0` | `ID7` |
| **OBD Bridge service** (`mgu-obd-adapter`) | `v1.0.0` | `ID7` |
| **Phone Terminal Bridge** (`mgu-phone-bridge`) | `v0.1.6` | `ID7` |
| **Python** (`mgu-python`) | `v1.0.3` | `ID7 / ID8` |
| **Renderer** (`mgu-render`) | `v0.6.25` | `ID7 / ID8` |
| **Full-width touch** (`mgu-render-id7-touch`) | `v1.4.0` | `ID7` |
| **Updater** (`mgu-updater`) | `v0.8.51` | `ID7 / ID8` |
| **Internet uplink** (`mgu-uplink`) | `v0.7.13` | `ID7 / ID8` |
| **Video Hub Network Bridge** (`mgu-video-net`) | `v0.1.0` | `ID7` |
| **HUD signals** (`mlurker-hud-signals`) | `v0.5.0` | `ID7` |
| **YouTube browser companion (experimental)** (`oussem-browser`) | `v0.1.2` | `ID7` |
| **PllanaCast for BMW Empfänger** (`pllana-airplay-receiver`) | `v0.6.3` | `ID7` |
| **Remote telemetry bridge** (`remote-telemetry-bridge`) | `v0.3.0` | `ID7` |
| **Vehicle network observer** (`vehicle-network-observer`) | `v0.1.2` | `ID7` |
| **Vizualyse bus** (`vizualyse-bus`) | `v0.1.0` | `ID7` |
| **Cast to cluster** (`vizualyse-cast`) | `v0.4.1` | `ID7` |
| **Browser** (`vizualyse-chromium`) | `v0.3.1` | `ID7` |
| **Cluster themes** (`vizualyse-cluster`) | `v0.4.1` | `ID7` |
| **Moonlight** (`vizualyse-moonlight`) | `v0.3.1` | `ID7` |
| **Steam** (`vizualyse-steam`) | `v0.4.0` | `ID7` |
| **CarPlay Map Mirror service** (`vlad-carplay-mirror`) | `v0.1.3` | `ID7` |
| **Waze HUD controller** (`waze-hud-control`) | `v0.3.0` | `ID7` |
| **Maps on cluster** (`waze-on-cluster`) | `v0.10.12` | `ID7` |
| **Waze Cards service** (`wazecard`) | `v1.0.0` | `ID7` |
| **Dashcam clip keeper** (`woodr-dashkeep`) | `v0.2.0` | `ID7` |
| **Woody Link service** (`woodr-link`) | `v0.1.0` | `ID7` |
| **Terrain Monitor: камеры** (`xop-camera-bridge`) | `v0.1.3` | `ID7` |
| **Terrain Monitor: приёмник камер** (`xop-camrx`) | `v0.1.3` | `ID7` |

</details>
