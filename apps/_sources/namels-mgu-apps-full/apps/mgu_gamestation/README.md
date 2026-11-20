# MGU GameStation 0.3.0 - experimental

An offline retro console for BMW iDrive 7 (MGU, Node 8 OAP runtime), distributed
as an independent MGU Store app in `NamelsMissing/mgu-apps`.

## What's included

- **NES**: `nes-js` MIT engine, headless, software pixel rendering.
- **SNES**: `jssnes` MIT engine, headless, full JavaScript CPU and video; heavier
  games may exceed the headunit's CPU budget (GameStation then pauses them, see below).
- **Game Boy / Game Boy Color**: `serverboy.js` GPL-2.0 engine, native colour
  palette support; only player one controls GB cartridges.
- **Arcade**: original two-player Pong. No ROM required.
- **In-game saves**: battery RAM of NES, SNES and Game Boy cartridges is loaded when a
  game starts and written when it is paused, left, quit, every 20 s while playing and when
  the app exits (only when it changed). Stored in `data/saves/<console>/<game>.sav`.
- **Continue**: the last game played is offered on the Games page and on the bar's
  **Play / Pause** button.
- **Two phone controllers**: phone browsers open a local, token-authenticated
  controller on the BMW Wi-Fi (player 1 and player 2 have different QR codes).
- **iDrive as a controller**: solo, or player 1 while a phone controls player 2. When
  solo, Pong has a deliberately beatable CPU opponent.
- **Game management**: add (or replace) and delete games from the phone's **Games** panel;
  delete them on the car as well (Games → Delete games, press Delete twice).

The phone provides controls and game transfer only. Emulation and display frames
run directly on the MGU; no mobile emulator, Internet service or external PC is
needed. No commercial ROMs or BIOS images are included.

## Screens (kit style, 0.3.0)

The header carries three tabs (plus **Settings** where the kit runs the screen) and a
PARKED / MOVING / NO SPEED SIGNAL badge. Everything on a page is reachable with the iDrive
knob (turn to move, press to choose) as well as by touch.

- **Games**: console chips with the number of games, the game list (six per page,
  Previous / Next), Continue, Delete games.
- **Playing**: the picture in the middle; left who plays (P1 / P2 and their state) and
  the iDrive help; right Pause / Resume, Games, Controllers, Quit game, save state and FPS.
  Switching tabs keeps the game (held, not running); **Quit game** ends it.
- **Controllers**: the two QR codes with their role in the current setup, a check list
  (Wi-Fi port, phone server, iDrive, vehicle, game) and **Change setup**.

Bar buttons (standard layout and the slim bar): **Next console**, **Play / Pause**,
**Controllers**, **Settings**.

## Safety and operation

Game execution is **always blocked unless a real valid Vehicle2 speed signal**
was received within the last 5 seconds and indicates 0.5 km/h or less. If the
signal stops arriving or the car moves, the game holds, its save is written and the
iDrive knob is released. It also holds while GameStation is not in front (another screen,
a popup, the Settings sheet). A game never changes vehicle ECU data. For use only while
the vehicle is parked. Do not interact with the display as the driver while the car is
moving.

1. Install `mgu_gamestation` from MGU Store using this source repository. It requires
   `idrive7-renderd`, `mgu-inputgate` and **`mgu-game-net`** (GameStation Phone Port),
   which the Store installs with it.
2. Open **MGU GameStation** while parked. Pong works right away (Games → Arcade).
3. To use phones: connect them to the car's Wi-Fi, open **Controllers** and scan the
   Player 1 / Player 2 QR code with each phone. No Internet needed.
4. On a phone, **Games** (top right) → choose a game file you own → **Upload to the car**.
   The console is taken from the file extension. A file with the same name can be replaced.
5. Pick the game on the BMW screen.

### Phone controller page

- Works upright and sideways; L / R shoulder buttons for SNES.
- The D-pad is one touch area: slide the thumb for direction changes and diagonals.
- Short vibration on each press (Android; iOS browsers ignore it).
- The header shows the game the car is running and a **Pause / Resume** button.
- Reconnects by itself. A phone that reloads the page gets its player slot back
  (a slot silent for more than 2.5 s may be taken over; a live one never).

### Phones and BMW's firewall (`mgu-game-net`)

BMW's firewall drops Wi-Fi connections to apps. The root helper **mgu-game-net**
(`native/game-net`, same design as Video Hub's and Custom Cluster's helpers) inserts one
tagged `nftables` rule `iifname "wlan_bridge" tcp dport 18878 accept comment "mgu-game-net"`
only while GameStation's server answers its loopback probe
`127.0.0.1:18878/.mgu-gamestation-health`, restores it after BMW firewall reloads and removes
it when GameStation stops. Rules of other tools are never touched. Its state is on
`127.0.0.1:18978/status`; the Controllers page shows it as **Wi-Fi port**.

```sh
systemctl status mgu-game-net.service
curl -s http://127.0.0.1:18978/status
curl -i http://127.0.0.1:18878/          # 403 Invalid pairing link = GameStation listens
```

The QR address is re-read every 3 s (the hotspot may come up after the app); the server
restarts itself if its port was still held by an old instance.

### Controller modes (Settings → Controller setup, or Controllers → Change setup)

| Setting | Player 1 | Player 2 |
| --- | --- | --- |
| iDrive singleplayer | iDrive controller | CPU in Pong / unused in console games |
| Phone singleplayer | Phone with Player 1 QR | CPU in Pong / unused |
| Two phones (default) | Phone with Player 1 QR | Phone with Player 2 QR |
| iDrive P1 + Phone P2 | iDrive controller | Phone with Player 2 QR |

A QR code whose player is not a phone controller in the current setup still works for
adding and deleting games.

**iDrive gameplay** (only while the game is visible, in front, running and parked):

- Tilt knob in four directions: D-pad up / down / left / right (held while tilted).
- Press and hold central knob button: A.
- Rotate clockwise: a momentary B (configurable in settings).
- Rotate counterclockwise: a momentary X (configurable in settings).
- Double press knob within 350ms: a brief START input.
- Hold knob down for at least 650ms: SELECT while held instead of A.
- Pong: rotating clockwise/counterclockwise moves the left paddle down/up;
  tilting up/down also works.
- The car's hardware BACK/MENU navigation stays available. Pausing, switching away,
  losing focus or moving releases the exclusive claim on the knob, so it navigates the
  page again (e.g. to Resume).

The controller's centre button does not physically provide separate held A/B
buttons. Many games work, but simultaneous A+B and full SNES button combos are
limited. Phone controllers remain the better option for action games.

## Frame pacing and overload protection

The emulators run at their native ~60 frames per second, paced by real time: when the
renderer falls behind, up to two emulated frames run per screen frame (the rest is
dropped, so a slow moment never turns into a burst), and only the newest picture is
uploaded. If the average JavaScript time per emulated frame stays above 45 ms over 90
frames, or a single frame takes 1.5 s, the game is **paused** with "Too heavy for the head
unit" instead of being thrown away; its save is kept and Resume tries again. An emulator
exception pauses the same way with its message. The SNES and Game Boy engines' debug
`console.log` lines are muted.

## Limitations / verification status

- The NES, Game Boy/Color and SNES engines, battery saves, the phone server, the car UI and
  the app wiring pass offline tests in Node.js on a PC.
- **Headunit compatibility, game compatibility, FPS, audio output, BMW Wi-Fi
  reachability through mgu-game-net and the phone page on real phones are not yet
  verified on the real MGU**.
- Sound output is not yet connected to the vehicle audio system (silent games).
- iDrive FrontCCU event reception and the native renderer's input capture have
  only been tested offline.
- Game Boy real-time clocks (MBC3 RTC) are not saved; mapper support is that of the engines.
- The MGU Store must run its SDK-dependent build on the unit; the SDK is not
  committed to GitHub. This source package does not contain an installable TGZ.

## Files

| File | Job |
| --- | --- |
| `main.js` | wiring: speed gate, iDrive capture, pages, actions, phone events |
| `ui.js` | everything drawn on the centre display (view model in, targets out) |
| `session.js` | the running game: pacing, pause, overload, saves |
| `library.js` | games, saves and the last game on disk |
| `controller_server.js`, `phone_page.js` | phone pads, game upload / list / delete |
| `nes_core.js`, `snes_core.js`, `gb_core.js`, `arcade.js` | engines behind one interface (`tick`, `sram`, `stop`) |
| `idrive_pad.js` | iDrive knob → gamepad |
| `../../native/game-net` | root firewall helper `mgu-game-net` |

## Local tests

```
node tests/gamestation.test.js
node tests/gamestation_app.test.js        # GAMESTATION_UI_DUMP=<dir> writes the pages as PNG
node tests/gamestation_net.test.js
python3 -c "import json,sys;sys.path.insert(0,'kit/tools');from build import build_ui;build_ui(json.load(open('apps/mgu_gamestation/app.json')))"
```

## Core source and licenses

All vendored engines are in readable `*_vendor.js` bundles and included in the
repository along with their full license texts:

- NES: MIT, https://github.com/takahirox/nes-js
- SNES: MIT, https://github.com/deepneko/jssnes
- GB/GBC: GPL-2.0, https://github.com/danShumway/serverboy.js
- QR: MIT, https://github.com/kazuhikoarase/qrcode-generator

The GameStation app itself is GPL-2.0 (see `LICENSE`); the other BMW apps
are separate packages. The source bundler is `tools/vendor_retro_cores.py`.
