# mgu-apps-id8

> [!WARNING]
> **Not yet tested on an iDrive 8 car.** These apps have been built and tried only on a PC, in an emulator of the iDrive 8 screen. Nobody has run them on a real iDrive 8 head unit yet: they may not open, may draw in the wrong place, or may not react to touch or the controller. Install them only if you are ready to try and report back ([issues](https://github.com/giuseppesalatino-boop/mgu-apps-id8/issues)), and remove them from the Store if they misbehave.
>
> **They need the MGU Store's Renderer (mgu-render).** Each app requires it: the Store installs it first if it isn't there.

The **iDrive 8** versions of the apps in [mgu-apps](https://github.com/giuseppesalatino-boop/mgu-apps) by [giuseppesalatino-boop](https://github.com/giuseppesalatino-boop). They do what the iDrive 7 apps do; only their screens are laid out for iDrive 8. The iDrive 7 apps stay as they are, in their own repository.

| App | Folder | Id | What it does |
|---|---|---|---|
| **True Time** | [`true-time/`](true-time) | `true_time_id8` | Acceleration and braking times, measured and corrected for the road's slope (the DSC's acceleration sensor) |
| **ECU Live Data** | [`ecu-live-data/`](ecu-live-data) | `boostline_id8` | Live engine data from the DDE (diesel) or DME (petrol), CSV logs, road dyno and drag timer, read-only. A fork of [boostline-idrive](https://github.com/clucraft/boostline-idrive) (MIT) |
| **DPF Monitoring** | [`dpf-monitoring/`](dpf-monitoring) | `dpf_id8` | The diesel particulate filter: soot and ash load, regenerations, differential pressure and exhaust temperatures from the DDE, read-only |

## Install from the MGU Store

1. In the [MGU Store](https://github.com/robertnisipeanu/mgu-store), on its phone page (the QR code on the car's screen), add the GitHub source:
   ```
   giuseppesalatino-boop/mgu-apps-id8
   ```
   on the branch **main**.
2. The Store lists the three apps as *(iDrive 8, untested)*. Each one's description says it hasn't been tested on an iDrive 8 car and that it needs the Store's Renderer.
3. Install the ones you want. The Store installs the Renderer (mgu-render) first if it's missing. Then the head unit downloads only that app's files and the shared kit, and builds the app with the oap-sdk it takes from a BMW app already on the unit. No SDK, no PC, no cable.

The Store won't install them on an iDrive 7 head unit (they say `mguHmi: ["ID8"]`): iDrive 7 cars use [mgu-apps](https://github.com/giuseppesalatino-boop/mgu-apps).

## How they draw on iDrive 8

The apps are built with the MGU App Kit of [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) (cauliflowermossgrape, MIT), vendored in `vendor/idrive7-apps` at a newer version than mgu-apps uses, one that knows iDrive 8:

- **Screens.** The kit writes the HMI's screen description for both head units (`rhmiData/uiDescriptions/ID7` and `ID8`). On iDrive 8 each screen is an `LT_State_Wide_List` with its buttons as `LT_Button_MediaEntry_1Row` rows: the widgets the MGU Store's own app uses there.
- **Drawing.** As on iDrive 7, the apps don't send pictures: they send drawing commands to a GPU renderer, which draws them at the display's rate. On iDrive 8 that renderer is the MGU Store's **mgu-render** (its `/run/mgu-render/render.sock`, protocol `mgu-render/1`), which draws the app on its own layer over the area under the HMI's status bar: 2880 x 764 of the 2880 x 960 screen (the climate bar stays below). Each app says so in its package: `mguHmi: ["ID8"]`, `mguNeeds: ["renderer"]`.
- **The wide page.** On iDrive 7 an app draws a 1600 x 520 page that the kit scales into the screen. iDrive 8's area is much wider, so that page would sit in the middle with about 400 px empty on each side. This repository's kit patch ([`patches/idrive7-apps/id8-wide-page-emulator-manifest.patch`](patches/idrive7-apps/id8-wide-page-emulator-manifest.patch)) gives a screen marked `"wide": true` a page as high as before (520) and as wide as the area allows (about 2200). Each app reads the width with `ctx.pageWidth()` and lays its pages out across it.
- **Header and bar.** The kit draws the app's name and its pages as tabs at the top, and a slim button bar at the bottom, as in the iDrive 7 apps' full-screen layout. iDrive 8 has only this layout: the *Screen layout* setting is gone.

The patch also writes `mguHmi`, `mguNeeds` and `mguRequires` from `app.json` into the package's `package.json`, and gives the emulator an iDrive 8 screen (`--id8`). Everything changed in the vendored kit is listed in [VENDORED.md](vendor/idrive7-apps/VENDORED.md).

## What was checked on a PC

- **Builds.** Each app builds with `tools/build_unit.py` (the build the MGU Store runs on the car) with the emulator's SDK placeholder: the package has both screen descriptions and `mguHmi: ["ID8"]` in its `package.json`.
- **Tests.**
  - True Time: 20 of 20 (`npm test` in `true-time`).
  - ECU Live Data: 23 of 23 (`npm test` in `ecu-live-data`).
  - The kit's iDrive 8 screen check (`python kit/tools/test_id8_ui.py`): 15 of 15.
  - The kit's runtime tests (`node kit/tools/test_runtime.js`): 15 of 15. On Windows they need a named pipe in place of the Unix socket the script makes.
- **Emulator, iDrive 8 screen.** Every page of the three apps was opened in the emulator's 2880 x 960 screen and fills the width:
  - True Time: Acceleration, Setup.
  - DPF Monitoring: Overview, Live data, History.
  - ECU Live Data, on the emulator's fake DME: its live tiles, Channels and the channel picker, Dyno, Drag.

## What still needs a car

Nobody has run these apps on an iDrive 8 head unit yet. To be checked there:

- **The screens open.** iDrive 8's HMI (Hmi8) opens the apps' `ID8` screens. The kit's Warm-Up app opened on a G20 with iDrive 8 ([idrive7-apps issue #152](https://github.com/cauliflowermossgrape/idrive7-apps/issues/152)), but these apps haven't been tried.
- **The picture.** It sits where it should, under the status bar and above the climate bar, and the text has a sensible size. The area (0,76 2880x764) is the default mgu-render reports on iDrive 8, not a measurement on a car.
- **Touch.** Tabs, bar buttons and page buttons react where they are drawn.
- **The iDrive controller.** iDrive 8 has no controller gate, so the controller stays with the HMI and moves through the screen's rows. Whether the slim bar follows its focus is open.
- **The renderer.** mgu-render took at most 16 apps at a time in issue #152, so an app opened after 16 others may fall back to the HMI's plain image.
- **The car's signals.** Speed and the DSC's acceleration (True Time), the engine's values on the bus (ECU Live Data's dyno and Power page), and the road gradient signal (`VehicleModel.LaneSlope`, True Time's Setup page). IterioDev's iDrive 8 apps use the same `Vehicle2`, `CDS`, `CDS2` and `FES` services, but our fields haven't been checked there.
- **Diagnostics.** The DDE/DME answering over the head unit's TASU link (HSFZ: ECU Live Data, DPF Monitoring). IterioDev's Car Data uses the same `InternalTasu` instance on iDrive 8.

### Trying one on a car

1. **From the MGU Store,** as [above](#install-from-the-mgu-store): the head unit builds the app with the SDK of its own iDrive 8 firmware. The build on an iDrive 8 unit is untested too: if it fails, the Store shows why.
2. **From a PC.** Put an oap-sdk extracted from an **iDrive 8** head unit in `vendor/idrive7-apps/oap-sdk/` and build the app (`npm run build:car` in its folder). Copy `vendor/idrive7-apps/dist/<id>@<version>.tgz` to the car and install it with the Store's deploy tool: `sh /var/opt/mgu-deploy/mgu-deploy.sh install --artifact /tmp/<id>@<version>.tgz --yes`. The package contains BMW's SDK: never publish it.

Either way, the app's log (`/var/opt/public/oap/oap_<uid>/data/<id>.log`) and mgu-render's journal (`journalctl -b -u mgu-render`) say what happened.

## Layout

```
mgu-repo.json         the Store's list of the apps (repo tree layout): iDrive 8 only, the Renderer required
tools/build_unit.py   the Store's build of one app on the head unit (shared by every app)
vendor/idrive7-apps   the MGU App Kit: runtime, renderer client, emulator, installer (MIT, shared)
vendor/boostline      Boostline's engine code for ECU Live Data (MIT)
patches/              the kit's patches (the emulator on Windows; iDrive 8's wide page, manifest, emulator)
true-time/            True Time: app/, tools/ (setup, emu, build-car), test/, README
ecu-live-data/        ECU Live Data: app/, core/, emu/, tools/, test/, README
dpf-monitoring/       DPF Monitoring: app/, tools/ (setup, emu, build-car), README
```

Each app is worked on from its own folder: `cd true-time` (or `ecu-live-data`, `dpf-monitoring`), then `npm run setup` (ECU Live Data: `npm install` first), `npm run emu` (an iDrive 8 screen; `-- --id7` for iDrive 7's), `npm test`, `npm run build:car`.

**No BMW software in this repository.** BMW's oap-sdk, built car packages (`.mgu`, `dist/`) and BMW's DME data (`bmw-dme-data.json`) are never committed (see `.gitignore`).

## Credits

- [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) by cauliflowermossgrape (MIT): the kit, its iDrive 8 screens and placement, the emulator and the installer. Its renderer and the emulator's draw engine come from mgu-render (GPL-3.0-or-later, see the kit's `kit/renderd`).
- [mgu-store](https://github.com/robertnisipeanu/mgu-store) by Robert Nisipeanu (GPL-3.0): mgu-render, the renderer the apps draw with on iDrive 8, and the Store's publishing rules. Nothing of the Store is copied here; the apps talk to its renderer through the kit.
- [Boostline](https://github.com/clucraft/Boostline) and [boostline-idrive](https://github.com/clucraft/boostline-idrive) (MIT): ECU Live Data's engine code.
- Ideas for iDrive 8, no code: IterioDev's [car-apps](https://github.com/IterioDev/car-apps) (PolyForm Strict) and iDrive Labs' [Sideways](https://github.com/idrive-labs/sideways) (GPL-3.0) showed how apps draw on iDrive 8's screen.

## Disclaimer

- **Not affiliated with BMW.** This is an independent, non-commercial project. It is not made, endorsed, supported or approved by BMW AG or any of its companies. BMW, iDrive and the names of BMW's models and control units are trademarks of BMW AG, used here only to say which cars and head units the software is for. No BMW logo, BMW software, BMW SDK or BMW data is part of this repository.
- **Read-only.** The apps only read values the car already provides; they never write to, code or flash a control unit, and they do not unlock or bypass any paid or protected function of the car.
- **At your own risk.** The software is provided "as is", without warranty of any kind (see LICENSE). Installing custom apps needs a modified head unit, which may affect the vehicle's warranty, and the values shown are estimates from the car's sensors. Use it only where it is legal and safe: performance runs only on closed courses, never on public roads, and don't operate the screen while driving.

## Licence

MIT ([LICENSE](LICENSE)). Each app keeps its own LICENSE in its folder (ECU Live Data keeps Boostline's original copyright); the vendored kit and Boostline keep theirs. Not affiliated with or endorsed by BMW. All trademarks belong to their owners.
