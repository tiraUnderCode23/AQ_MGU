# Drive-In

**An unofficial Plex client for the BMW iDrive 7 (MGU) head unit, installed through the MGU Store.** Your Plex server's films and series on the centre screen: continue watching, recently added, every library's posters, seasons and episodes, search, and a full-screen player. The sound plays on the car's speakers.

![The home page: continue watching and recently added, the libraries on the left](docs/home.png)

*Drawn on a PC by `npm run shots`, with an invented library and abstract posters. The app on the head unit's 1920 x 720 screen looks the same; the HMI's own title strip and back arrow are stand-ins here.*

> **Status: runs in the app kit's emulator and passes its tests on a PC. Not yet run on a car, and not yet run against a real Plex server.** The app runs in the [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) kit's emulator, drawn by the car's draw engine, with the service against a stand-in for plex.tv and a Plex Media Server and a stand-in for the player. What only a car and a real server can show is listed under [What still needs a car](#what-still-needs-a-car). Expect a first evening of fixing.

> **Parked by default.** The picture shows while the car is parked. Out of P, or moving, the picture goes off and the sound plays on. A setting lets a passenger watch while driving; it does nothing until its disclaimer has been accepted, with the car parked. See [Video while driving](#video-while-driving).

> **Your head unit must be rooted.** BMW's head unit only runs apps BMW installs. Like every MGU Store app, this one needs root (SSH) access to the unit. Rooting can wipe the head unit's coding, delete BMW Digital Key pairings and, at worst, brick the unit. This is an independent hobby project, not affiliated with or endorsed by Plex or BMW.

---

## What it does

| | |
|---|---|
| Sign in | Plex's own link code: four characters to type at **plex.tv/link** on your phone. No password is typed in the car |
| Home | *Continue watching* (a tap resumes) and *Recently added* |
| Libraries | every movie and TV library of the server, as posters; sort by title, recently added, year or last watched; unwatched only |
| Shows | seasons and episodes, with what is watched and where each one stopped |
| A film's page | resume or play from the start, mark watched, choose the sound track and subtitles |
| Search | an on-screen keyboard; films, shows and episodes |
| Player | over the whole screen; a progress bar you can drag, 10 s back, 30 s on, pause, the next episode by itself |
| Controls | touch; the iDrive controller (press: pause, turn: skip 10 s a click, push right: 30 s on, push left: back); the steering wheel's skip buttons (30 s on, 10 s back) |
| Watch state | the resume point and the watched mark are the server's own, the same as in any other Plex app |

Not in this version: music and photo libraries, a managed user's PIN, live TV.

![A library](docs/library.png)

![A show's episodes](docs/show.png)

![A film's page](docs/film.png)

![The player, parked](docs/player.png)

## What you need

- A BMW with the **iDrive 7** head unit (MGU), rooted, with the [MGU Store](https://github.com/robertnisipeanu/mgu-store) installed.
- **Internet for the head unit** through the Store's uplink (Store, *Settings*): Wi-Fi, a phone on USB, or an LTE stick. A film at the default quality is about 4 Mbit/s, roughly 1.8 GB an hour.
- **A GPU renderer that shows video.** The Store's own renderer (`mgu-render`) does. The app says so on the player page when the renderer in use does not.
- **A Plex Media Server the car can reach from outside your home**: Remote Access switched on (or a custom server address), or Plex's relay, which is slow (1 to 2 Mbit/s: pick a lower quality). Plex requires a Plex Pass on the server's account, or a Remote Watch Pass on yours, for remote playback.
- The server does the converting. Everything is asked for as H.264 with stereo AAC, so the server transcodes HEVC, HDR, DTS and the like. Several streams at once need a server that can keep up.

## Install

1. In the Store, open **Settings**, choose **Add source** and enter `clucraft/plex-idrive`. Pick the branch **main**.
2. Install **Drive-In** from that source. The Store installs the **Drive-In service** with it.
3. **Restart the head unit once.** The service's socket starts at the next boot, and is opened to the app then.
4. Open **Drive-In**, tap **Get a code**, and type the four characters at **plex.tv/link** on your phone.

![Signing in](docs/signin.png)

The MGU Store builds the app from this repository on the head unit itself, so nothing is built on a PC and BMW's SDK never leaves the car.

## Settings

They are the app's *Settings* tab on the head unit.

| Setting | Choices (default first) |
|---|---|
| Video while driving | off; on (asks for the disclaimer) |
| Picture quality | 720p at 4 Mbit/s; Original (up to 1080p, 20 Mbit/s); 1080p at 8; 720p at 2; 480p at 1.5; 360p at 0.7 |
| Play the next episode by itself | on; off |
| Steering wheel skip | on; off |
| Sound level | +6 dB; as the film has it; +9 dB; +12 dB |
| Sign out of Plex on this car | deletes the sign-in from the head unit |

## Video while driving

- **Parked** means all of: a speed the car sent in the last 10 seconds, under 1 km/h, and the selector in P. Anything unknown counts as not parked: no speed yet, no selector signal, a speed that stopped arriving. There is no "assume parked".
- **Not parked:** the film's picture is replaced by a plain page with the controls. The sound plays on. At a red light in D the picture stays off, so it does not pop up at every stop.
- **The setting** *Video while driving* is off when the app is installed. Switching it on shows the disclaimer below, and the setting counts only once *I understand* has been tapped there. That button works only while the car is parked. Switching the setting off forgets the acceptance, so switching it on again asks again.
- The centre screen is in the driver's line of sight, and a checkbox does not change that. In many places it is illegal for a video to be visible to the driver of a moving vehicle. Check the law where you drive before you switch this on.

![The disclaimer](docs/disclaimer.png)

![Driving with the setting off: the sound plays on](docs/player-driving.png)

## Your account

- The app and this repository hold no account, server or token. Whoever installs them gets an empty sign-in.
- The token plex.tv gives the car is kept by the service, in a file only root can read (`/var/opt/clucraft-plex/state/account.json`). The app never receives it. It is sent in a request header only, never in an address, and nothing logs it.
- The service talks to plex.tv and to the server plex.tv lists for your account, and to nothing else. Its internet goes through the Store's uplink under a user id of its own.
- *Sign out* deletes the token and the posters kept on the head unit. You can also remove the device ("BMW iDrive 7") under *Authorized devices* in your Plex account.

## Try it on a PC

You need **Node.js 18+**. No car, no Plex account and no npm packages. Python 3 is needed for one test (the kit's build).

```bash
git clone https://github.com/clucraft/plex-idrive.git
```

```bash
cd plex-idrive
```

```bash
npm test
```

```bash
npm run shots
```

- `npm run emu` is the app in the kit's emulator: see below.
- `npm test` runs the service against a stand-in for plex.tv and a server (`tools/mock-plex.js`) with a stand-in player, drives the app's pages by their touch targets, and starts `main.js` on a stand-in head unit from the package the kit's build stages.
- `npm run test:node8` runs the same on Node 8.17.0, the Node.js line the head unit runs apps on. It downloads that Node once from nodejs.org and checks it against the release's checksums.
- `npm run shots` draws every page into `docs/` as a PNG.
- `npm run mock` runs the stand-in server by itself, for trying the service by hand.

### In the emulator

```bash
npm run emu
```

Then open **http://localhost:8077**. This also needs **Python 3** and **git**.

![The emulator page: the head unit's screen with the app's home page on the left; the app's buttons, the vehicle signals and the settings on the right](docs/emulator.png)

This is the emulator of the [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) app kit: the app as the head unit runs it, with the kit's real runtime, drawn in the browser by the car's GPU draw engine built as WebAssembly. Behind it run the real Drive-In service, against the stand-in plex.tv and server with the invented library, and the stand-in player (`tools/dev-backend.js`).

- **Mouse = touch.** The wheel or `[` `]` turn the controller, `Enter` presses it, `Backspace` is BACK, `H` is HOME, `O` opens the app again.
- **Get a code** signs in at once: nobody has to type the code anywhere.
- **Vehicle signals, Manual**: the speed slider and the gear selector are what the app's driving gate reads. `P` and 0 km/h is parked. Anything else takes the picture away and locks the disclaimer's switch, as in the car.
- **The player page says *Waiting for the picture***: the emulator's renderer shows no video, and nothing decodes one here. The film's time, pause, skip, the progress bar, the next episode and the driving gate all work. ***No sound: emulator: no SOME/IP*** is the emulator having no audio manager to ask.
- Saving a file under `apps/clucraft_plex/` builds and restarts the app while the page stays open. Settings and the accepted disclaimer are kept in `.cache/emu/preview/emu/clucraft_plex/`.

![The player in the emulator with the gear selector in D at 60 km/h: the picture is off while driving](docs/emulator-driving.png)

The emulator is not in this repository. `npm run emu` fetches the kit once into `vendor/idrive7-apps` (not committed), at the commit named in `tools/emu.js`; `node tools/emu.js --kit <folder>` uses a checkout you already have. This repository's `kit/` is another branch of the same kit, so the tool puts the two together in `.cache/emu` and teaches the emulator's stand-in head unit three things this kit has (the list is at the top of `tools/emu.js`). The Windows parts (a named pipe for the renderer, `python` for Python) are the ones [swarm-idrive](https://github.com/clucraft/swarm-idrive) uses; they were not run on Windows for this app.

## What still needs a car

None of this could be run where the app was written, and the emulator cannot show it either. Each is something to look at on the first evening, with the place to look.

- **A real Plex server's transcoder.** The requests follow what other open clients send (the universal transcoder's HLS, a `generic` client profile limited to H.264 8-bit and stereo AAC). Whether your server answers the decision and the playlist as expected shows in the service's log lines `hls: N segments, ... from segment K` and in the player page's error text. Both shapes of playlist (the whole film, or only what follows the resume point) are handled.
- **The player on the real GPU and speakers.** `tvh-player` is the IPTV service's player, unchanged; there it plays live MPEG-TS on its stdin, and a Plex HLS stream is MPEG-TS segments handed over the same way. It was not run here. The service log's `player N: {"ev":"open" ...}` line names the codecs it found; `decoder` and `audio` lines say whether the GPU and the sound device took them.
- **The sound's route** (the audio manager's source 287 to the front speakers), as IPTV uses it. The player page says *No sound: ...* with the reason when the connection is refused.
- **The renderer.** Whether the renderer on your unit shows video and pictures on the app's connections, and whether the full-screen layer sits in front. The app's log (`clucraft_plex.log` in its data folder) says `video: ... named to the renderer` once it has.
- **The selector and the speed** as your car reports them. Until both arrive the car counts as not parked, so if the picture stays off while parked, the player page's text and the disclaimer page's *Now: ...* line say what the gate sees.
- **The controller and the steering wheel buttons**: which way a turn counts, and that the wheel's skip arrives under the name the app listens for.
- **Speed on the head unit's processor**: the posters are decoded by the service, not the app, but a library's first page still means a dozen of them.
- **Node 8 itself.** Every script parses as ES2017 and avoids newer library calls, but the tests ran on a current Node here: run `npm run test:node8` once.

## How it works

```
 apps/clucraft_plex/            the app (the screen), on the kit                          MIT
   main.js        the kit's loop, the settings, the drive gate, the sound's route, the full view
     ├─ store.js      what the app knows and does: pages, lists, posters, play / pause / skip
     ├─ ui.js         the pages, drawn from the store
     ├─ drivegate.js  parked or not; the passenger disclaimer's consent
     ├─ svc.js        one JSON line to the service and one back
     ├─ caraudio.js   the audio manager: the player's source to the front speakers
     └─ fullview.js   a second renderer connection: the player over the whole screen
        │  /run/clucraft-plex.sock (the app's own group only)
        ▼
 native/clucraft-plex/          the service (a root tool the Store installs)              GPL-3.0-or-later
   service.js     root: the socket, the token (0600), the posters kept, the player's start
     ├─ client.js     the internet user id: plex.tv, the server
     │    ├─ plex.js      the requests and what comes back
     │    ├─ session.js   the film that plays: transcode, position, timeline, restarts
     │    ├─ hls.js       the playlist and its segments, read ahead of the player
     │    └─ art.js       a poster decoded and scaled to the pixels the app draws
     └─ player.js     tvh-player: MPEG-TS in, the picture into mgu-render's frame file, the sound into SmartXbar
```

- **The server converts, the car decodes one thing.** Every film is asked for as H.264 with AAC in MPEG-TS, which is what the player decodes on the GPU. A film that already fits is passed on untouched by the server.
- **A skip is a new transcode at that second**, which a server does faster than a player could read its way there.
- **The stream is read ahead** (24 MiB or 90 s at most), so a weak patch of road is bridged without a pause. A stream that breaks is started again where the film was.
- **The app never decodes anything.** Posters arrive as pixels; the film arrives as a file the renderer reads. The app's process only draws.

## Repository layout

```
apps/clucraft_plex/     the app: app.json, main.js, store.js, ui.js, drivegate.js, svc.js, caraudio.js,
                        fullview.js, keyboard.js, qrcodegen.js, icon.png, data/fonts
native/clucraft-plex/   the service: component.json, its scripts, systemd units, the player's binary
native/tvh-player/      the player's source (as M850i-amn/idrive7-apps has it), for the binary above
kit/                    the MGU App Kit's build files and runtime (a copy; kit/UPSTREAM.json names its commit)
mgu-repo.json           tells the MGU Store what is here and how to build the app
test/                   run.js (the tests), fake-player.js (the stand-in player)
tools/                  emu.js and dev-backend.js (the emulator), mock-plex.js, stage.js, shots.js, make-icon.js, node8.js
docs/                   screenshots
```

## Licence

See [NOTICE](NOTICE) for every part and where it comes from.

- The app, the tools and the tests are MIT ([LICENSE](LICENSE)).
- The service and the player are GPL-3.0-or-later (`native/clucraft-plex/LICENSE`): the player is M850i-amn's IPTV player, from aurelmarius' TVH Player, on Moonride's and Robert Nisipeanu's decoder and FFmpeg.
- `kit/` is the MGU App Kit as M850i-amn's repository has it, MIT.
- The emulator (`npm run emu`) is the idrive7-apps kit's; its draw engine is GPL-3.0-or-later. It is fetched when you run it and is not in this repository.
- BMW's app SDK is BMW's. It is not in this repository and may not be published.
- Not affiliated with or endorsed by Plex, Inc. or BMW AG.
