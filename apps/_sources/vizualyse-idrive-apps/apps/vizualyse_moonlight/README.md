# vizualyse_moonlight

The iDrive 7 app for [vizualyse-moonlight](../../native/vizualyse-moonlight)
(Moonlight), which streams games from a PC running
[Sunshine](https://github.com/LizardByte/Sunshine) to the central screen.
Pairing, the host and the game are picked on the phone page the tool serves.
The tile is **Moonlight**.

## The touch screen, and the list

Opening the app opens its **touch screen** (drawn by the tool over the app
area) by itself while parked: on its **Stream** tab the phone page's QR code,
the stream (its state, frame rate and decoding, the game, the PC and the
controllers) with **Stop**, **Quit game** and **Resume last**, **Picture on**
(Centre console, Cluster, HUD) and Moonlight on / off; on its **Info** tab
the host, the game, the pictures, the controllers, the uplink and the
renderer; parked or driving (moving stops a stream, not the touch screen).
Its **List** button (top right) or BACK bring the page back: the iDrive list, all of it usable with the controller.
The list's first row, **Touch screen**, opens the touch screen again. The
handling is the platform's `app/touch_mode`.

The HMI still gets every touch on it, so the app first opens an empty screen
state (`ST_OnlineApps_VizualyseMoonlightScreen`, a title and one label,
nothing to press) and sends `touch` once it is visible. Should the HMI not
open it within 3 s, the touch screen goes over the page (its rows disabled)
and the log says why. BACK, HOME, another app, and a pop-up, a call or a
warning taking the focus for 300 ms hide it (`touch` with `on: false`). A
stream on the centre console covers the whole screen: the tool hides the
touch screen while it plays and shows it again when it ends, if the screen
state is still open.

## The page

One `LT_State_Wide` page:

| Row | What it does |
|---|---|
| status | `Ready - scan the QR code to pair and pick a game`, `Starting Forza Horizon 5 from GAMING-PC...`, `Streaming Forza Horizon 5 from GAMING-PC - 20 s`, `Ended: ...`, `Only while parked - the car is moving (19 mph)`, `Waiting for the phone's hotspot`, `The touch screen is up - List (top right) or the back arrow returns here`, `Error: ...` (the stream's, or a failed command's for 10 s), `The Moonlight tool is not running - install Moonlight (the tool) from the Store`. Plain ASCII: names from the PC are, too |
| Touch screen | opens the empty screen state, then `touch`: the tool's touch screen over the app area (above). Off while the car moves (`(only while parked)`) |
| QR code | the phone page's link, an `LT_Label_1Graphic_Scalable` showing a PNG from `/dev/shm/vizualyse_moonlight_qr_<uid>/` |
| link | the same link as text, and how to use it |
| Moonlight: on / off | the whole service (`enable` / `disable`) |
| Picture on | a drop-down (`LT_DropDownMenu_1Row_2Col3070`, as upstream's Waze "Show on"): Centre console, Cluster, HUD (`output`); a stream moves there (the tool reconnects to the game) |
| Stop | stops streaming; the game keeps running on the PC; enabled while a stream starts or plays |
| Quit game | stops streaming and closes the game on the PC; enabled while a stream starts or plays |
| Resume last | starts the last host and game again; enabled while nothing streams and the tool says `canResume` |
| info | while there is a host: host (address), game, fps (GPU or software decoding), controllers; otherwise the uplink, the renderer, the controllers and the last game |

## Only while parked

The app reads the car's speed every second, `Vehicle2.statusCarSpeed2`
(instance `1`, `speedVehicleCentreOfGravity` / 64 = km/h, 65535 invalid;
`manifest.json` asks to read it, the SDK's `someipBuilders.buildTypedProxy`
reads it: `src/vehicle_speed.js`), and sends it to the tool. The tool stops
a stream above 3 km/h and starts none; without any reading (a bench, or the
app not started) it doesn't block.

## The socket

`/dev/shm/vizualyse-moonlight/ctl.sock` (`MOONLIGHT_CTL_SOCKET` overrides
it), a Unix stream socket, newline-delimited JSON. The tool sends
`{"ev":"status", enabled, link, uplink, render, state, host, app, frames,
fps, seconds, pads, canResume, last, error, note, output, outputs, decoder,
speed, moving, touch, touchWanted, …}` on connect, after each command and
once a second, `{"ev":"error","error":…}` for a failed command and
`{"ev":"list"}` when the touch screen's List button is tapped; the app sends
`{"cmd":"enable"}`, `{"cmd":"disable"}`, `{"cmd":"stop"}`, `{"cmd":"quit"}`,
`{"cmd":"resume"}`, `{"cmd":"output","output":"console"|"map"|"hud"}`,
`{"cmd":"touch","on":true|false}` (the touch screen) and, every second,
`{"cmd":"speed","kmh":N}`. The app holds it while it runs
(not only while its page shows: a stream covers the page, and the speed has
to keep coming). `tools/make_page.js` writes the page's
application.xml and uiDescription.json from one list.

## Build and test

```sh
node tools/build.js          # the source package; the unit builds the app
node tools/test_page.js      # the page and the touch screen's states against a fake SDK, HMI and Vehicle2, and a fake tool socket
node tools/make_page.js vizualyse_moonlight@0.3.1
node tools/make_icon.js vizualyse_moonlight@0.3.1/rhmiData/variantGroups/Common/images/vizualyse_moonlight_icon.png
```

The structure (SDK use, tile, visibility, the QR handles) follows
[vizualyse_cast](../vizualyse_cast).
