# mgu-apps

Apps for the BMW iDrive 7 (MGU) head unit by [giuseppesalatino-boop](https://github.com/giuseppesalatino-boop), in one repository: **one MGU Store source lists them all**, and each app installs and updates on its own.

| App | Folder | What it does |
|---|---|---|
| **True Time** | [`true-time/`](true-time) | Acceleration and braking times, measured and corrected for the road's slope (the DSC's acceleration sensor) |
| **ECU Live Data** | [`ecu-live-data/`](ecu-live-data) | Live engine data from the DDE (diesel) or DME (petrol), CSV logs, road dyno and drag timer, read-only. A fork of [boostline-idrive](https://github.com/clucraft/boostline-idrive) (MIT) |
| **DPF Monitoring** | [`dpf-monitoring/`](dpf-monitoring) | The diesel particulate filter in the iDrive 7 look: soot and ash load, regenerations, differential pressure and exhaust temperatures from the DDE, read-only. [sas46's DPF Monitor](https://github.com/sas46/idrive7_dpf_app) (MIT) |

## Install from the MGU Store

1. In the [MGU Store](https://github.com/robertnisipeanu/mgu-store), on its phone page (the QR code on the car's screen), add the GitHub source:
   ```
   giuseppesalatino-boop/mgu-apps
   ```
   on **Tags** (only the collection's releases) or on the branch **main** (every change).
2. Every app of the collection is listed: install the ones you want. The head unit downloads only the files of the app it builds (its folder and the shared kit) and builds it with the oap-sdk it takes from a BMW app already on the unit. No SDK, no PC, no cable.
3. An app updates when its own files change (on **main**) or when its version goes up in a new release (on **Tags**). The others are left alone.

A new app added to the collection shows up in the same source: nothing to add on the car.

## Layout

```
mgu-repo.json         the Store's list of the apps (repo tree layout)
tools/build_unit.py   the Store's build of one app on the head unit (shared by every app)
vendor/idrive7-apps   the MGU app kit: runtime, GPU renderer, emulator, installer (MIT, shared)
vendor/boostline      Boostline's engine code for ECU Live Data (MIT)
patches/              the kit's patch (the emulator on Windows, its diagnostics hook)
true-time/            True Time: app/, tools/ (setup, emu, build-car), test/, README
ecu-live-data/        ECU Live Data: app/, core/, emu/, tools/, test/, README
dpf-monitoring/       DPF Monitoring: app/, tools/ (setup, emu, build-car), README
```

Each app is worked on from its own folder, as before: `cd true-time` (or `ecu-live-data`, `dpf-monitoring`), then `npm install` (ECU Live Data only), `npm run emu`, `npm test`, `npm run build:car`. See each app's README.

**No BMW software in this repository.** BMW's oap-sdk, built car packages (`.mgu`, `dist/`) and BMW's DME data (`bmw-dme-data.json`) are never committed (see `.gitignore`).

## Adding an app

1. Put it in its own folder with its `app/` (the kit's `app.json` and code), as the others.
2. Add an entry to `mgu-repo.json` with the app's id, its `path` (`<folder>/app`) and the same `build` as the others.
3. Commit, push and, for the **Tags** channel, tag a new release (`git tag v1.1.0 && git push --tags`).

## Disclaimer

- **Not affiliated with BMW.** This is an independent, non-commercial project. It is not made, endorsed, supported or approved by BMW AG or any of its companies. BMW, iDrive and the names of BMW's models and control units are trademarks of BMW AG, used here only to say which cars and head units the software is for. No BMW logo, BMW software, BMW SDK or BMW data is part of this repository.
- **Read-only.** The apps only read values the car already provides; they never write to, code or flash a control unit, and they do not unlock or bypass any paid or protected function of the car.
- **At your own risk.** The software is provided "as is", without warranty of any kind (see LICENSE). Installing custom apps needs a modified head unit, which may affect the vehicle's warranty, and the values shown are estimates from the car's sensors. Use it only where it is legal and safe: performance runs only on closed courses, never on public roads, and don't operate the screen while driving.

## Licence

MIT ([LICENSE](LICENSE)). Each app keeps its own LICENSE in its folder (ECU Live Data keeps Boostline's original copyright); the vendored kit and Boostline keep theirs. Not affiliated with or endorsed by BMW. All trademarks belong to their owners.
