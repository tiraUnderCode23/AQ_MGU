# idrive7-apps (vendored)

The runtime, GPU renderer, emulator and installer of
[idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) by cauliflowermossgrape (MIT, see LICENSE),
shared by every app of this collection (True Time, ECU Live Data, ...). Left out to keep the repository small
(the MGU Store downloads it to the car): the kit's own apps (`apps/`, where each app's `tools/setup.js` links
its `app/` on a PC and the Store's build copies it on the car), its documentation (`docs/`), Doom's sources
(`third_party/`) and the translated diagnostic texts (`kit/localization/diagnostic-full.*.json`), none of which
these apps use. The patch in `../../patches/idrive7-apps/` (the emulator on Windows and its diagnostics hook)
is applied.
