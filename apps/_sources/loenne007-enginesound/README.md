# Engine Sound for iDrive 7

A synthesized engine sound on your BMW's speakers, driven live by the car's **real rpm, gear and engine load**.
Five sounds: an **Inline 6** (B58 / S58 style), a cross-plane **V8** and a **V12**, each a whole synthesized engine,
and **Inline 6 Diesel** and **V8 TDI**, which give the car's own diesel the depth of a big six or V8 TDI. The sound
is generated in real time on the head unit, not played back from recordings.

Made for the BMW iDrive 7 head unit (MGU), installed through the [MGU Store](https://github.com/robertnisipeanu/mgu-store).
Developed for a G20 320d (B47 diesel, ZF 8HP).

> **Use at your own risk.** An unofficial hobby project, not affiliated with BMW. It changes nothing in the car's
> control units; it only plays audio. Keep the volume sensible: you still need to hear the road, sirens and the
> car's warnings.

## Install

1. In the MGU Store: **Settings → Add source**, type `loenne007/idrive-enginesound`, choose the branch **main**.
2. Install **Engine Sound**. The Store installs its service (**Engine Sound service**, `lfb-enginesound`) with it.
3. Restart the head unit when the Store asks (the service starts at the next start).
4. Start the engine. The app starts with the head unit; open its tile to pick the sound.

Updating keeps your settings: the sound engine chosen in an earlier version (`a` / `b` / `c` / `d`, `pulse` / `bass`)
becomes Waveguide / Replica / Simulate / Enhance, Simulate / Enhance.

## How it works

```
 car (SOME/IP)                    app lfb_enginesound (Node 8, autostart)           service lfb-enginesound
 rpm, gear, torque, speed,  ──▶  maps the car's rpm onto the engine's rev range, ──▶ esd.js ──▶ es-synth-<id> (C)
 driving mode                     load from torque, on/off logic, audio routing      Unix socket    │
                                  (GENIVI AudioManager: a source → the speakers)                    ▼
                                                                                ALSA → SmartX → car speakers
```

- **rpm**: the car sends its engine speed only 10–20 times a second; the app estimates it in between, so the sound
  neither steps nor trails. The engine's rpm is the car's times a fixed ratio per preset (*Rev range → locked*) that
  puts its firing order on a harmonic of the car's own four-cylinder, so the two blend at every rpm. *Scaled*
  stretches the diesel's idle-to-max range over the engine's idle-to-redline range instead; *real* passes the car's
  rpm on. Enhance always gets the real rpm.
- **load**: crankshaft torque against the car's max torque (*Car's max torque*, 400 Nm for a 320d). Pulling hard
  makes it louder and harder-edged; negative torque (engine braking) gives the overrun character.
- **gear**: a gear change of the automatic (ZF 8HP) is sent to the synth (shift character, no ignition cut).
- It plays while it is switched on and the engine runs (with *Only in Sport mode*: only in Sport). Otherwise it
  fades out and, a few seconds later, the audio route is released.

## Sound engines

Four synthesizers ("sound engines") are installed side by side; each plays four presets. The app's five sounds are
**Simulate**'s i6, v8 and v12 and **Enhance**'s i6 and v8. With *Settings → Legacy* the page offers every sound
engine and preset, the older **Waveguide** and **Replica** included.

| Id | Title | |
|---|---|---|
| `simulate` | **Simulate** (default) | Light and quick. Per cylinder an exhaust and an intake pressure pulse at its crank angle, with the load's rasp riding on each pulse, through quarter-wave pipes, a collector and muffler chambers; an explicit level map (off the gas about 4 dB under full load). Follows a step in rpm within ~26 ms, runs at 300x+ realtime. [synth/simulate](synth/simulate/README.md) |
| `waveguide` | **Waveguide** (legacy) | Engine_Sim's sound path rewritten in C: combustion events into delay-line waveguide pipes, muffler, Helmholtz airbox, a sub layer, a turbo layer, cabin filter, small room and three-band dynamics. Fuller and darker. [synth/waveguide](synth/waveguide/README.md) |
| `replica` | **Replica** (legacy) | The Engine_Sim website's sound engine ported 1:1 to C (its Web Audio nodes rebuilt as Chrome runs them), driven by the car's data, with automatic-gearbox shifts and a quiet turbo. The heaviest on the CPU (~35x realtime on a Mac). [synth/replica](synth/replica/README.md) |
| `enhance` | **Enhance** | An Active Sound Design emulation: it does not play a foreign engine but adds rpm-locked low engine orders (mostly 30–150 Hz) under the car's own diesel, from the **real** rpm. Its presets are diesel characters: **Inline 6 Diesel** (i6, B57 style), **V8 TDI** (v8), **V6 TDI** (v10), **V6 TDI Sport** (v12). [synth/enhance](synth/enhance/README.md) |

Each is a folder `synth/<id>/` with its own C source and tests, built into `tool/lfb-enginesound/es-synth-<id>`.
[samples/](samples/) has the five sounds as recordings (40 s demo drives; the two Enhance ones are only the added
bass, so use headphones or real speakers). All share one command line and control protocol
([synth/PROTOCOL.md](synth/PROTOCOL.md)).

## The page

Left: playing / standby and why, on / off, **Test sound** (10 s of beeps through the route the engine plays on, also
with the engine off) and the audio mode (tap: over the music / instead of it). Middle: live car rpm, the engine's
rpm, load, gear and speed. Right: the five sounds.

With *Settings → Legacy: all engines, Sound and Audio pages* the page offers the sound engine and its four presets
instead of the five sounds, and two more pages show:

- **Sound**: sliders (0–200 %, 100 % = the sound engine's own default) for **Off the gas** (idle, coasting, light
  load), **Turbo**, **Blow-off**, **Pops & bangs** and **Bass**; **Reset all**. The same values are in Settings,
  with or without Legacy. Whatever they are set to, the speaker protection (below) keeps the output safe.
- **Audio**: the audio route (below), its state, the mix route candidates with a test each, and **Diagnose**: a
  report of the car's audio sources, sinks, connections and SmartX files (also written to `audio-report.txt` in the
  app's data folder).

## Audio: exclusive or mix

**Exclusive** (default): the engine plays as its own source on the main speakers, the AudioManager source
`CarLifeMedia` (287, China-only and free elsewhere) into SmartX `CarLifeMedia_CF_48_STEREO`, the route
[Moonride](https://github.com/JustAnotherPU/moonride) uses on iDrive 7. The music pauses while the engine plays and
comes back a few seconds after it stops.

**Mix** (*Play over music (mix)* in Settings, or the audio mode button on the page): the engine plays over the
music, as a navigation prompt does (the car decides whether it mixes or ducks the music). The car's prompt and
overlay channels are 24 kHz mono; the synth opens them in that format and converts (mono sum, low-pass, every second
sample), so mix sounds a little duller and narrower than exclusive.

The default mix route is the AudioManager source `OAPGenericOverlay` (1048), BMW's overlay source for apps, to the
front speakers (`MediaSink_Front`, 1024). It has no SmartX endpoint of its own: its audio enters through
`Media_Overlay_Converter_Source_CF_24_MONO`. The alternatives are China-only channels that are free elsewhere, as
CarLifeMedia is: `TencentOverlay`, `CarLifeNavigation`, `TencentTTS`, `CarLifeSpeech`; like CarLifeMedia they are
marked available only while the engine plays. BMW's own navigation, speech, phone, CarPlay and Android Auto channels
are never used.

In the car (1.2.1) the default route plays over the music; the engine is mixed in before the car's volume, so the
volume knob moves both. The **Audio** page shows the playing output's format and its **dropouts** (an underrun the
device reported, or its queue found empty; after the first one the whole buffer is kept queued) and the **car
volume** per sink as the AudioManager lists it. To try another route:

1. Switch *Settings → Legacy* on and open the **Audio** page. It reads the AudioManager's sources and the SmartX
   endpoints (**Refresh** reads them again) and lists the **mix routes**: each source above that the car has, to the
   front speakers and, on the second page, to the main sink.
2. Play some music, then press **Test** on a route: 10 s of beeps through it. The line under the list says what the
   car did with them: *the car takes the sound*, or *the car does not read this channel*. If you also hear the beeps
   with the music still playing (perhaps quieter), that route mixes.
3. Press **Use for mix** on it (kept in the app's data folder, `mix-route.json`) and switch to **Over the music**.

If the AudioManager or the SmartX list is unavailable, the default is used and the page says so. A mix route that
the AudioManager refuses, or that does not reach `CS_CONNECTED` within 6 s, is released and shown as failed (also in
the app's log). No connection and no "available" mark is ever left behind: a mark is set only on a China-only
channel and only while it plays; leftovers of a crash or a power-off are removed at the next start.

## Speaker protection

The last stage of every sound engine (`synth/common/protect.h`). In the car it first raises the engine by 6 dB to
the loudness of radio and music, so the volume knob can stay where the radio is comfortable (and the radio isn't
deafening when the engine sound stops). Then: no DC or infrasound (30 Hz high-pass), nothing above 16 kHz, the bass
below ~150 Hz held under -3 dBFS, the long-term power held under -8 dBFS RMS (loud mastered music), peaks under
-1 dBFS, and a fade-in at start. `make -C synth test` tests it.

## Settings

| Setting | |
|---|---|
| Engine sound | on / off (also the **On / Off** button) |
| Engine | the sound engine's preset: Inline 6, V8, V10, V12 (with Enhance: Inline 6 Diesel, V8 TDI, V6 TDI, V6 TDI Sport) |
| Sound engine | Simulate, Enhance, and the legacy Waveguide, Replica |
| Legacy: all engines, Sound and Audio pages | the page offers every sound engine and preset instead of the five sounds; the Sound and Audio pages show |
| Volume | 10–100 %, default 50 %; the car's own volume knob applies on top. 50 % is the 90 % of versions before 1.1 (plus the 6 dB above), 100 % about 4 dB more |
| Only in Sport mode | plays only while the driving mode is Sport |
| Play over music (mix) | the mix route instead of the exclusive one (above) |
| Turbo sound | the turbo whistle and blow-off of the turbo presets |
| Sound: … | the Sound page's sliders |
| Rev range, Car's max rpm, Car's max torque | the mapping above |
| Colour theme, Screen layout, Renderer, Demo data | the app kit's display settings |

## Repository

| Path | |
|---|---|
| `apps/lfb_enginesound/` | the app: `main.js` (pages, background), `core.js` (mapping, on/off, sound engines), `route.js` (AudioManager routes), `daemon.js` (service socket client), `app.json` |
| `tool/lfb-enginesound/` | the service: `esd.js`, the prebuilt `es-synth-<id>` (x86-64, glibc ≤ 2.27, loader `/lib/ld-linux-x86-64.so.2`), `check.js` (the Store's health check), its systemd unit and `component.json` |
| `synth/<id>/` | each sound engine: C source, tests |
| `synth/common/` | shared by the engines: the speaker protection and its test, the ALSA output, the build (`engine.mk`) |
| `samples/` | the five sounds as recordings (`make -C synth samples`) |
| `synth/PROTOCOL.md` | the shared command line and control lines |
| `tools/` | `check_glibc.py` (a car binary's glibc versions and loader), `make_es_icon.js` (the app icon) |
| `test/` | `core.test.js` (the app's logic and routes, with a fake service and AudioManager), `track.test.js` (the rpm estimate), `service.test.js` (the service with a fake synth, driven by the app's client) |
| `kit/` | the MGU app kit from [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) (MIT): runtime, `tools/build.py`, previews |
| `mgu-repo.json` | the Store's repo-tree manifest: the head unit builds the app from source (`kit/tools/build.py`), the service's files are prebuilt |

## Development

```sh
node test/core.test.js && node test/track.test.js   # the app's logic, audio routes and rpm estimate
node test/service.test.js                    # the service: control lines reach the synth, kept ones are replayed
make -C synth test                           # every sound engine (renders, checks, bench) and the protection
make -C synth car                            # the head unit's binaries (zig 0.17), checked by tools/check_glibc.py
synth/simulate/build/es-synth-host --out wav:v8.wav --demo 40 --preset v8   # listen to a demo drive

python3 kit/tools/build.py --preview-only lfb_enginesound        # stage the app without BMW's SDK
node kit/tools/preview.js dist/lfb_enginesound preview wait=8 render --set demo=on   # its page as PNGs
```

The service runs locally too: `ES_RUN_DIR=<dir> ES_SYNTH_DIR=<dir with es-synth-<id>> ES_SHM=<dir> node
tool/lfb-enginesound/esd.js`, and the app's `ES_CTL_SOCK` points at its socket. An installable package needs BMW's
`oap-sdk` from your own head unit (`kit/tools/extract_sdk.js`; never commit it).

A new sound engine: a folder `synth/<id>/` with the shared command line and control lines
([synth/PROTOCOL.md](synth/PROTOCOL.md)), `protect.h` as its last stage and a Makefile that includes
`common/engine.mk`; then its binary in `component.json` `files`, its entry in `SOUND_ENGINES` (`core.js`) and in the
`soundEngine` setting (`app.json`).

## Credits

- [Engine_Sim](https://github.com/YigitSalihEmecen/Engine_Sim) by Yigit Salih Emecen (MIT): the Waveguide engine
  re-implements its sound path; Simulate uses its pipe, muffler and airbox values; Replica ports it 1:1; firing orders and crank angles.
- [DasEtwas/enginesound](https://github.com/DasEtwas/enginesound) (MIT) and
  [Antonio-R1/engine-sound-generator](https://github.com/Antonio-R1/engine-sound-generator) (MIT): ideas (valve and
  waveguide engine model after Baldan et al. 2015).
- [ange-yaghi/engine-sim](https://github.com/ange-yaghi/engine-sim) (MIT): ideas (noise multiplied onto the pressure
  signal).
  No code was copied from these three.
- App kit: [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) by cauliflowermossgrape (MIT).
- The audio route: [Moonride](https://github.com/JustAnotherPU/moonride) and [RideTube](https://github.com/JustAnotherPU/ridetube)
  by JustAnotherPU showed the SmartX / AudioManager path; [NamelsMissing/mgu-apps](https://github.com/NamelsMissing/mgu-apps)
  published the AudioManager's source list.

## License

MIT (`LICENSE`). The kit keeps its own notice (`LICENSE.idrive7-apps`); the Engine_Sim licence text is in the
sound engines' READMEs.
