# Drivefin

**An unofficial Jellyfin client for the BMW iDrive 7 (MGU) head unit, installed through the MGU Store.** Your Jellyfin server's films and series on the centre screen: continue watching, recently added, every library's posters, seasons and episodes, search, and a full-screen player. The sound plays on the car's speakers.

![The home page: continue watching and recently added, the libraries on the left](docs/home.png)

*The app in the app kit's emulator, with an invented library and abstract posters. Every screenshot here is the emulator's own: the head unit's 1920 x 720 screen, drawn by the car's draw engine.*

> **Status: runs in the app kit's emulator and passes its tests on a PC. Not yet run on a car, and not yet run against a real Jellyfin server.** The app runs in the [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) kit's emulator with the real Drivefin service behind it, against a stand-in Jellyfin server and a stand-in for the player. The requests follow Jellyfin's published API description. What only a car and a real server can show is listed under [What still needs a car](#what-still-needs-a-car); a real server can be tried from the emulator first ([A real server in the emulator](#a-real-server-in-the-emulator)). Expect a first evening of fixing.

> **Parked by default.** The picture shows while the car is parked. Out of P, or moving, the picture goes off and the sound plays on. A setting lets a passenger watch while driving; it does nothing until its disclaimer has been accepted, with the car parked. See [Video while driving](#video-while-driving).

> **Your head unit must be rooted.** BMW's head unit only runs apps BMW installs. Like every MGU Store app, this one needs root (SSH) access to the unit. Rooting can wipe the head unit's coding, delete BMW Digital Key pairings and, at worst, brick the unit. This is an independent hobby project, not affiliated with or endorsed by the Jellyfin project or BMW.

Its sibling for Plex is [Drive-In](https://github.com/clucraft/plex-idrive). The two are separate apps, made to be installed side by side: their ids, sockets and files differ.

---

## What it does

| | |
|---|---|
| Sign in | your server's address, typed once on the screen; then Jellyfin's **Quick Connect**: six digits to enter in a Jellyfin you are already signed in to. No password is typed in the car (a name and password are asked only where a server has Quick Connect switched off, or if you prefer them) |
| Home | *Continue watching* (what you began, then each show's next episode; a tap resumes) and *Recently added* |
| Libraries | every movie and TV library of the server, as posters; sort by title, recently added, year or last watched; unwatched only |
| Shows | seasons and episodes, with what is watched and where each one stopped |
| A film's page | resume or play from the start, mark watched, choose the sound track and subtitles |
| Search | an on-screen keyboard; films, shows and episodes |
| Player | over the whole screen; a progress bar you can drag, 10 s back, 30 s on, pause, the next episode by itself (with the sound and subtitle languages of the one before) |
| Controls | touch; the iDrive controller (press: pause, turn: skip 10 s a click, push right: 30 s on, push left: back); the steering wheel's skip buttons (30 s on, 10 s back) |
| Watch state | the resume point and the watched mark are the server's own, the same as in any other Jellyfin app |

Not in this version: music, photo and live TV libraries, collections, a choice between several versions of one film.

![A library](docs/library.png)

![A show's episodes](docs/show.png)

![A film's page](docs/film.png)

![Choosing the subtitles](docs/subtitles.png)

![Search](docs/search.png)

![The player in the emulator, parked](docs/player.png)

*The emulator's renderer shows no video and has no audio manager, which is what the two notes on this page say. In the car the film is behind these controls.*

## What you need

- A BMW with the **iDrive 7** head unit (MGU), rooted, with the [MGU Store](https://github.com/robertnisipeanu/mgu-store) installed.
- **Internet for the head unit** through the Store's uplink (Store, *Settings*): Wi-Fi, a phone on USB, or an LTE stick. A film at the default quality is about 4 Mbit/s, roughly 1.8 GB an hour.
- **A GPU renderer that shows video.** The Store's own renderer (`mgu-render`) does. The app says so on the player page when the renderer in use does not.
- **A Jellyfin server the car can reach** (10.8 or newer): an address that works from outside your home (a domain with a reverse proxy, a forwarded port, a VPN the uplink is part of). An address that only works on your home network answers only while the car is on that network.
- **https with a certificate from a public authority** (Let's Encrypt and the like), or plain `http`. A self-signed certificate is refused. Over `http` nothing is encrypted, and the app says so where it matters.
- **Transcoding allowed** for your Jellyfin user. Everything is asked for as H.264 with stereo AAC, so the server converts HEVC, HDR, DTS and the like; a film that already fits is passed on as it is. Several streams at once need a server that can keep up.

## Install

1. In the Store, open **Settings**, choose **Add source** and enter `clucraft/jellyfin-idrive`. Pick the branch **main**.
2. Install **Drivefin** from that source. The Store installs the **Drivefin service** with it.
3. **Restart the head unit once.** The service's socket starts at the next boot, and is opened to the app then.
4. Open **Drivefin**, type your server's address and tap **Connect**.
5. Tap **Get a code**, and enter the six digits in Jellyfin on your phone or computer: your user menu, **Quick Connect**.

![Step one: the server's address](docs/signin-server.png)

- Type the address as in a browser. Without `http://` or `https://` in front, `https` is tried first, then Jellyfin's own port 8096.
- Quick Connect has to be switched on at the server (Dashboard, *General*). Where it is off, the app asks for your name and password instead.

![Step two: Quick Connect](docs/signin.png)

![A name and password instead](docs/signin-password.png)

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
| Sign out of Jellyfin on this car | deletes the sign-in from the head unit |

## Video while driving

- **Parked** means all of: a speed the car sent in the last 10 seconds, under 1 km/h, and the selector in P. Anything unknown counts as not parked: no speed yet, no selector signal, a speed that stopped arriving. There is no "assume parked".
- **Not parked:** the film's picture is replaced by a plain page with the controls. The sound plays on. At a red light in D the picture stays off, so it does not pop up at every stop.
- **The setting** *Video while driving* is off when the app is installed. Switching it on shows the disclaimer below, and the setting counts only once *I understand* has been tapped there. That button works only while the car is parked. Switching the setting off forgets the acceptance, so switching it on again asks again.
- The centre screen is in the driver's line of sight, and a checkbox does not change that. In many places it is illegal for a video to be visible to the driver of a moving vehicle. Check the law where you drive before you switch this on.

![The disclaimer](docs/disclaimer.png)

![Driving with the setting off: the sound plays on](docs/player-driving.png)

## Your sign-in

- The app and this repository hold no server, user or token. Whoever installs them gets an empty sign-in.
- Quick Connect gives the car a token of its own. The service keeps it, with the server's address, in a file only root can read (`/var/opt/clucraft-jellyfin/state/account.json`). The app never receives it. It is sent in a request header only, never in an address, and nothing logs it.
- A name and password, where they are used, go to the server once and are kept and logged nowhere. The password leaves the page the moment it is sent.
- The service talks to the one server whose address you typed, and to nothing else. Its internet goes through the Store's uplink under a user id of its own.
- *Sign out* deletes the token and the posters kept on the head unit, and asks the server to drop the token. The server's address stays, so signing in again is one code; *Other server* on the sign-in page forgets it too. You can also remove the device ("BMW iDrive 7") under *Devices* in your Jellyfin dashboard.

## Try it on a PC

You need **Node.js 18+**. No car, no Jellyfin server and no npm packages. Python 3 is needed for one test (the kit's build).

```bash
git clone https://github.com/clucraft/jellyfin-idrive.git
```

```bash
cd jellyfin-idrive
```

```bash
npm test
```

- `npm run emu` is the app in the kit's emulator: see below.
- `npm test` runs the service against a stand-in Jellyfin server (`tools/mock-jellyfin.js`) with a stand-in player, drives the app's pages by their touch targets, and starts `main.js` on a stand-in head unit from the package the kit's build stages.
- `npm run test:node8` runs the same on Node 8.17.0, the Node.js line the head unit runs apps on. It downloads that Node once from nodejs.org and checks it against the release's checksums.
- `npm run shots` draws every page as a PNG with the kit's software canvas, into `.cache/shots` (a quick look without a browser; the pictures in `docs/` are the emulator's).
- `npm run mock` runs the stand-in server by itself, for trying the service by hand.

### In the emulator

```bash
npm run emu
```

Then open **http://localhost:8077**. This also needs **Python 3** and **git**.

![The emulator page: the head unit's screen with the app's home page on the left; the app's buttons, the vehicle signals and the settings on the right](docs/emulator.png)

This is the emulator of the [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) app kit: the app as the head unit runs it, with the kit's real runtime, drawn in the browser by the car's GPU draw engine built as WebAssembly. Behind it run the real Drivefin service, a stand-in Jellyfin server with the invented library, and the stand-in player (`tools/dev-backend.js`).

- **Mouse = touch.** The wheel or `[` `]` turn the controller, `Enter` presses it, `Backspace` is BACK, `H` is HOME, `O` opens the app again.
- **The sign-in page opens at Quick Connect** for the stand-in server, and **Get a code** signs in at once: nobody has to enter the code anywhere. *Other server* shows the address page; `localhost` typed there finds the stand-in again. Its name and password are `Driver` and `open-sesame`.
- **Vehicle signals, Manual**: the speed slider and the gear selector are what the app's driving gate reads. `P` and 0 km/h is parked. Anything else takes the picture away and locks the disclaimer's switch, as in the car. (*Demo drive*, the page's default, is a drive: the picture is off.)
- **The player page says *Waiting for the picture***: the emulator's renderer shows no video, and nothing decodes one here. The film's time, pause, skip, the progress bar, the next episode and the driving gate all work. ***No sound: emulator: no SOME/IP*** is the emulator having no audio manager to ask.
- **Screenshot** in the page's panel saves the screen as shown, 1920 x 720: the pictures in `docs/` were made with it.
- Saving a file under `apps/clucraft_jellyfin/` builds and restarts the app while the page stays open. Settings and the accepted disclaimer are kept in `.cache/emu/preview/emu/clucraft_jellyfin/`.

The emulator is not in this repository. `npm run emu` fetches the kit once into `vendor/idrive7-apps` (not committed), at the commit named in `tools/emu.js`; `node tools/emu.js --kit <folder>` uses a checkout you already have. This repository's `kit/` is another branch of the same kit, so the tool puts the two together in `.cache/emu` and teaches the emulator's stand-in head unit three things this kit has (the list is at the top of `tools/emu.js`), and Windows two (a named pipe for the renderer, `python` for Python).

### A real server in the emulator

The service in the emulator is the real one, with this PC's own internet. *Other server* on the sign-in page takes your Jellyfin server's address, and Quick Connect then works as it will in the car: the code is entered in your own Jellyfin, and no password of yours is typed anywhere here.

- The libraries, posters, search, seasons and episodes, the tracks, and the server's answer to *play this* (its transcoder's playlist and segments) are then the real thing.
- Nothing is decoded: the stand-in player reads the stream's own time stamps, so the film's time runs as fast as the film, and the place the server is told is the true one. Your resume points and watched marks do change, as with any player.
- `BACKEND_LOG=1 npm run emu` shows the service's log lines (`hls: N segments ...`, `playback: ...`) in the terminal.
- The sign-in lives in a temporary folder and is gone when the emulator ends. `DEV_STATE=<folder> npm run emu` keeps it in a folder of yours instead (the token is in it: keep it out of any repository).

## What still needs a car

None of this could be run where the app was written. Each is something to look at on the first evening, with the place to look.

- **A real Jellyfin server.** The requests are the ones Jellyfin's OpenAPI description lists, and the mapping of its answers is tested against a stand-in that answers in the same shapes. A real server's `PlaybackInfo` answer and its HLS playlist show in the service's log lines `hls: N segments, ... from segment K` and in the player page's error text. Try it from the emulator first (above).
- **The player on the real GPU and speakers.** `tvh-player` is the IPTV service's player, unchanged; there it plays live MPEG-TS on its stdin, and a Jellyfin HLS stream is MPEG-TS segments handed over the same way. It was not run here. The service log's `player N: {"ev":"open" ...}` line names the codecs it found; `decoder` and `audio` lines say whether the GPU and the sound device took them.
- **A skip.** A skip reads the same stream from another segment, and the player starts on a segment that begins in the middle of the film. Whether the picture and the sound start cleanly there, and whether the film's time is right after it, is the first thing to try.
- **The sound's route** (the audio manager's source 287 to the front speakers), as IPTV uses it. The player page says *No sound: ...* with the reason when the connection is refused.
- **The renderer.** Whether the renderer on your unit shows video and pictures on the app's connections, and whether the full-screen layer sits in front. The app's log (`clucraft_jellyfin.log` in its data folder) says `video: ... named to the renderer` once it has.
- **The selector and the speed** as your car reports them. Until both arrive the car counts as not parked, so if the picture stays off while parked, the player page's text and the disclaimer page's *Now: ...* line say what the gate sees.
- **The controller and the steering wheel buttons**: which way a turn counts, and that the wheel's skip arrives under the name the app listens for.
- **Typing on the screen.** The address and the search are typed on the app's own keyboard by touch. Whether its keys are comfortable on the car's screen, and whether the controller reaches them, wants a look.
- **Speed on the head unit's processor**: the posters are decoded by the service, not the app, but a library's first page still means a dozen of them.

## How it works

```
 apps/clucraft_jellyfin/        the app (the screen), on the kit                          MIT
   main.js        the kit's loop, the settings, the drive gate, the sound's route, the full view
     ├─ store.js      what the app knows and does: pages, lists, posters, signing in, play / pause / skip
     ├─ ui.js         the pages, drawn from the store
     ├─ drivegate.js  parked or not; the passenger disclaimer's consent
     ├─ svc.js        one JSON line to the service and one back
     ├─ caraudio.js   the audio manager: the player's source to the front speakers
     └─ fullview.js   a second renderer connection: the player over the whole screen
        │  /run/clucraft-jellyfin.sock (the app's own group only)
        ▼
 native/clucraft-jellyfin/      the service (a root tool the Store installs)              GPL-3.0-or-later
   service.js     root: the socket, the token (0600), the posters kept, the player's start
     ├─ client.js     the internet user id: the server
     │    ├─ jellyfin.js  the requests and what comes back
     │    ├─ session.js   the film that plays: the stream, its tracks, position, what the server is told
     │    ├─ hls.js       the playlist and its segments, read ahead of the player
     │    └─ art.js       a poster decoded and scaled to the pixels the app draws
     └─ player.js     tvh-player: MPEG-TS in, the picture into mgu-render's frame file, the sound into SmartXbar
```

- **The server converts, the car decodes one thing.** The server is asked what it offers a device that takes only H.264 with stereo AAC in MPEG-TS, as HLS, which is what the player decodes on the GPU. A film that already fits is passed on untouched by the server.
- **A skip reads the same stream elsewhere.** Jellyfin's playlist lists the whole film, and the server converts from whichever segment is asked for.
- **The stream is read ahead** (24 MiB or 90 s at most), so a weak patch of road is bridged without a pause. A stream that breaks is asked for anew where the film was.
- **The app never decodes anything.** Posters arrive as pixels; the film arrives as a file the renderer reads. The app's process only draws.

[`native/clucraft-jellyfin/README.md`](native/clucraft-jellyfin/README.md) lists the requests the server is sent.

## Repository layout

```
apps/clucraft_jellyfin/     the app: app.json, main.js, store.js, ui.js, drivegate.js, svc.js, caraudio.js,
                            fullview.js, keyboard.js, qrcodegen.js, icon.png, data/fonts
native/clucraft-jellyfin/   the service: component.json, its scripts, systemd units, the player's binary
native/tvh-player/          the player's source (as M850i-amn/idrive7-apps has it), for the binary above
kit/                        the MGU App Kit's build files and runtime (a copy; kit/UPSTREAM.json names its commit)
mgu-repo.json               tells the MGU Store what is here and how to build the app
test/                       run.js (the tests), fake-player.js (the stand-in player)
tools/                      emu.js and dev-backend.js (the emulator), mock-jellyfin.js, stage.js, shots.js,
                            make-icon.js, node8.js
docs/                       screenshots (the emulator's)
```

## Licence

See [NOTICE](NOTICE) for every part and where it comes from.

- The app, the tools and the tests are MIT ([LICENSE](LICENSE)).
- The service and the player are GPL-3.0-or-later (`native/clucraft-jellyfin/LICENSE`): the player is M850i-amn's IPTV player, from aurelmarius' TVH Player, on Moonride's and Robert Nisipeanu's decoder and FFmpeg.
- `kit/` is the MGU App Kit as M850i-amn's repository has it, MIT.
- The emulator (`npm run emu`) is the idrive7-apps kit's; its draw engine is GPL-3.0-or-later. It is fetched when you run it and is not in this repository.
- BMW's app SDK is BMW's. It is not in this repository and may not be published.
- Not affiliated with or endorsed by the Jellyfin project or BMW AG.
