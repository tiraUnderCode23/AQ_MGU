# vizualyse_steam

The iDrive 7 app for [vizualyse-steam](../../native/vizualyse-steam)
(Steam): Windows games from your Steam library running on the car through
Proton, on the central screen while parked. Signing in to Steam and
installing games happen on the phone page the tool serves. The tile is
**Steam**.

## The touch screen, and the list

Opening the app opens its **touch screen** (the tool's, [its
README](../../native/vizualyse-steam/README.md#the-touch-screen)) by itself
while parked: the running game with **Show on the screen** and **Stop the
game**, the library four games a page, the download, and Settings (the
picture's shape and size, Upscaling, Steam on / off, the phone page's QR
code), parked or driving (the game's picture is parked only). Its **List**
button (top right) or BACK bring the page back: the iDrive list, all of it usable with the controller.
The list's first row, **Touch screen**, opens the touch screen again. The
handling is the platform's `app/touch_mode`.

## The page

One `LT_State_Wide` page, all of it usable with the iDrive controller:

| Row | What it does |
|---|---|
| status | `Ready - pick a game`, `Starting <game> (this can take a minute)...`, `<game> is running - Show puts it on the screen`, `On the screen - the back arrow on the left returns here`, `The touch screen is up - List (top right) or the back arrow returns here`, `Installing Steam on the car (a few minutes, once)...`, `Only while parked - the car is moving (30 km/h)`, `Out of memory - ...` (2 minutes after a kill at the cap), `Note: the unit restarted while <game> ran (...)`, `No games yet - scan the QR code ...`, `Off - ...`, `Error: ...` (a failed command's for 10 s, or the tool's), `The Steam tool is not running - ...` |
| Touch screen | opens the empty screen state, then `ui`: the tool's touch screen over the app area. Off while the car moves (`(only while parked)`) |
| game | what plays (`<game>: 28 pictures/s`) or how the last one ended |
| Show on the screen | opens the empty screen state, then `show` and `ui`: the game covers the app area (not the HMI's title bar or left strip), the touch screen waiting under it; on while a game draws, parked |
| Stop the game | `stop`: Wine and everything it started end |
| Play: <game> (up to four) | `play` with its app id; the game shows by itself once it draws, if this page is still in front. Off while a game runs, while moving, or when no program was found in its folder (`(no program found)`) |
| download | what the tool's download does (`Downloading <game>: 42 %`, `Steam Guard asks for a code - answer on the phone page`, ...) |
| QR code | the phone page's link, an `LT_Label_1Graphic_Scalable` showing a PNG from `/dev/shm/vizualyse_steam_qr_<uid>/` |
| link, hint | the same link as text, and what the phone page is for |
| Picture: 1280x720 | `resolution`: the next size the game draws at (from the next game) |
| Upscaling: off / FSR / FSR, no sharpening | `upscale`: how a picture smaller than the screen is enlarged: Winston's bilinear, or FSR 1 on the GPU (tool 0.1.11; at once) |
| Steam: on / off | `enable` / `disable` (off stops a game and a download, closes the phone page) |

Texts are plain ASCII (RHMI Text is not a reliable Unicode transport on this
firmware: knowledge/idrive-app-ui.md); game names are made ASCII.

## One picture over the screen state, and touches under it

The HMI still gets every touch on the touch screen and on the game (the tool
reads its copy of them), so the app first opens the screen state
(`ST_OnlineApps_VizualyseSteamScreen`, a title and one label, nothing to
press) and asks once it is visible: `ui` for the touch screen (entered, or
Touch screen), `show` then `ui` for the game (Show, and Play's own show).
The tool keeps exactly one of the two up while the state is open: Show (on
the list or on the touch screen) puts the game in the touch screen's place;
when the game's picture goes (it stops, or is hidden) the touch screen comes
back. Should the HMI not open the screen state within 3 s, the picture goes
over the main page (its buttons disabled) and the log says why. BACK, HOME,
another app, and a pop-up, a call or a warning taking the focus for 300 ms
hide both (`ui` off first, then `hide`: the game hidden while the touch
screen is still wanted would bring it back); the game keeps running until
Stop. The tool's `{"ev":"list"}` (its List button) and the car starting to
move close the screen state (`closeState`, or the page opened if that
fails). The app also hides both as it shuts down.

## Only while parked

The app reads `Vehicle2.statusCarSpeed2` every second (`src/vehicle_speed.js`)
and sends `{"cmd":"speed","kmh":N}`; the tool hides the game and the touch
screen above 3 km/h and won't show them; the app then shows its list.

## The socket

`/dev/shm/vizualyse-steam/ctl.sock` (`STEAM_CTL_SOCKET` overrides it), a
Unix stream socket, newline-delimited JSON, open to this app's group only.
The tool sends `{"ev":"status", ...}` (its phone page's status: `enabled`,
`link`, `bundle`, `library`, `game`, `running`, `shown`, `ui`, `uiWanted`,
`moving`, `download`, `settings`, `memory`, ...) on connect, after each
command and once a second, `{"ev":"error","error":...}` for a failed command
and `{"ev":"list"}` for the touch screen's List button; the app sends
`enable`, `disable`, `play` (`appId`), `stop`, `show`, `hide`, `ui` (`on`),
`resolution`, `upscale` and, every second, `speed`.

## Building and testing

- `node tools/make_page.js vizualyse_steam@0.2.1` writes `application.xml`
  and `uiDescription.json` from one list; `node tools/make_icon.js <png>`
  the tile icon (a game controller outline).
- `node tools/test_page.js` runs the app against a fake SDK, HMI and tool
  socket (what it covers is at its top).
- `node tools/build.js` packs the source package
  (`vizualyse_steam@<version>.src.tgz`) the head unit builds.

GPL-3.0-or-later. `src/qr_png.js`, `src/vehicle_speed.js`, `src/touch_mode.js` and `src/qrcode.js` are
copies of the platform's (`release.json` "platform", [platform/](../../platform)); `qrcode.js` is Kazuhiko Arase's QR Code Generator
(MIT, its notice in the file).
