# DPF Monitoring

The diesel particulate filter of a BMW diesel on the iDrive 7 (MGU) head unit, in the look of BMW's own screens: soot and ash load, regenerations (live, interrupted, history), differential pressure and exhaust temperatures, read from the diesel engine unit (DDE) with UDS `0x22` ReadDataByIdentifier only. Nothing is ever written to the car.

- **Overview:** soot load and exhaust temperature as bars, a drawing of the filter with soot, ash, heat and the pressure difference, and the status (filter OK / regeneration due / running).
- **Live data:** soot, pressure difference and both exhaust temperatures with their last 5 minutes; every other value as a list, with the raw replies on request.
- **History:** the regenerations the app has watched and the intervals from the engine unit's memory.
- **Regeneration** (off by default; Settings > Experimental): the coolant and exhaust temperatures, the distance since the last regeneration and the lock status, against reference values. Information only: its button is a placeholder, and no regeneration is ever requested.

**1.1.0 is [sas46's DPF Monitor](https://github.com/sas46/idrive7_dpf_app) 0.1.6** (MIT), with this collection's icon, id and name. Over 1.0.0 it brings:
- the regeneration request (`44BB` = 6, *Regeneration requested*, waiting for the right conditions) told apart from a running regeneration (`44BB` = 4); this mapping was observed on sas46's car (X5 G05 25d) and may differ on other DDEs, so from 1.1.1 any other value but 0 still counts as a running regeneration, as in 1.0.0 (seen, timed and logged), with the value shown under it;
- the engine coolant temperature from the car's bus (`CDS.statusEngineTemperature`);
- the experimental Regeneration page above;
- in the full-screen layout, the pages only as tabs (no second row of the same buttons at the bottom); Full screen is now the default layout.

The identifiers are in `app/app.json` (`config.dpf`), from the public SGBD reference of the G-series DDE 8.3 (B37 / B47 / B57).

## Install

From the MGU Store: add the source **`giuseppesalatino-boop/mgu-apps`** and install **DPF Monitoring** (see the [collection's README](../README.md)).

From a PC, with BMW's SDK in the collection's `vendor/idrive7-apps/oap-sdk/`: `npm run build:car` writes `dist/dpf_id7@<version>.mgu` (it contains BMW's SDK: for your own car only, never publish it), then install it with the kit's installer in `vendor/idrive7-apps/deploy`.

## Emulator

From this folder: `npm run emu`, then open http://localhost:8077. Without a DDE to answer, the app shows its demo values.

## Disclaimer

- **Not affiliated with BMW.** This is an independent, non-commercial project. It is not made, endorsed, supported or approved by BMW AG or any of its companies. BMW, iDrive and the names of BMW's models and control units are trademarks of BMW AG, used here only to say which cars and head units the software is for. No BMW logo, BMW software, BMW SDK or BMW data is part of this repository.
- **Read-only.** The apps only read values the car already provides; they never write to, code or flash a control unit, and they do not unlock or bypass any paid or protected function of the car.
- **At your own risk.** The software is provided "as is", without warranty of any kind (see LICENSE). Installing custom apps needs a modified head unit, which may affect the vehicle's warranty, and the values shown are estimates from the car's sensors. Use it only where it is legal and safe: performance runs only on closed courses, never on public roads, and don't operate the screen while driving.

## Licence

MIT ([LICENSE](LICENSE)). The app is [sas46's DPF Monitor](https://github.com/sas46/idrive7_dpf_app) (MIT, © sas46), grown from 2bhacker9's original DPF prototype ([idrive7-apps issue #88](https://github.com/cauliflowermossgrape/idrive7-apps/issues/88)); both copyright notices are in [LICENSE](LICENSE). Built on [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) by cauliflowermossgrape (MIT). Not affiliated with or endorsed by BMW.
