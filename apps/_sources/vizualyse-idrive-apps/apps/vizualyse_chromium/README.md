# vizualyse_chromium

The iDrive 7 app for [vizualyse-chromium](../../native/vizualyse-chromium)
(Browser): Chromium on the car, with WebGL 2, WebGPU and WebAssembly JSPI,
on the central screen while parked (WebGL on the CPU, or on the car's own
GPU driver in the experimental GPU mode). Addresses and text are
typed on the phone page the tool serves. The tile is **Browser**.

## The touch screen first

Entered (the tile, or a start in front) with the tool there and the car
parked, the app opens its empty screen state and sends
`{"cmd":"ui","on":true}`: the tool's **touch screen** goes over it, drawn
by the tool in the platform's touch kit (`tool/touch_ui`; the app side is
`app/touch_mode`, copied to `src/touch_mode.js`). *Browse*: the page (title,
address), Show on the screen, Back, Reload, Home, what the GPU offers, the
phone page's QR code; *Settings*: Resolution, Browser on / off, GPU mode,
Game mode. Its **List** corner (the tool sends `{"ev":"list"}`), BACK or the
car moving close the screen state and this page shows; its first row,
**Touch screen**, opens it again.

The touch screen and the browser are the tool's two pictures over the same
screen state, one at a time: the touch screen's Show on the screen swaps
it for the browser, and when the browser goes (the phone's Hide, a
restart) the touch screen comes back while the state is open. This page's
Show on the screen opens the state with the browser at once
(`{"cmd":"ui","on":true,"browser":true}`).

## The page

One `LT_State_Wide` page, all of it usable with the controller:

| Row | What it does |
|---|---|
| status | `Ready - Show puts it on the screen; ...`, `On the screen - the back arrow on the left returns here`, `The touch screen is up - List (top right) or the back arrow returns here`, `Installing the browser (about a minute, once)...`, `Starting the browser...`, `Only while parked - the car is moving (30 km/h)`, `Out of memory - the page needed more than 1536 MB (phone page: Memory)` (for 2 minutes after the tool reports a kill at the cap), `Off - ...`, `Error: ...` (a failed command's for 10 s, or the tool's), `The Browser tool is not running - ...` |
| Touch screen | the screen state, then `ui`: the touch screen, parked or driving |
| QR code | the phone page's link, an `LT_Label_1Graphic_Scalable` showing a PNG from `/dev/shm/vizualyse_chromium_qr_<uid>/` |
| link | the same link as text, and how to use it |
| Show on the screen | opens the empty screen state, then `ui` with `browser`: the browser covers the app area (not the HMI's title bar or left strip); off while moving or not running |
| Browser: on / off | the whole browser (`enable` / `disable`: Chromium runs or not) |
| GPU mode: off / on | `gpu` (experimental): the tool restarts Chromium with WebGL on the unit's own GPU driver (Mesa 19 GLES), and goes back to the CPU by itself if that fails; never kept over a restart of the tool. On needs the browser running; off works any time |
| Resolution: full / 3/4 / 1/2 / 1/3 / 1/4 | `scale` 1, 0.75, 0.5, 1/3, 0.25, round (the tool's list): the tool draws the page with fewer pixels (the same layout) and mgu-render scales it up; the button shows the picture's size. Kept by the tool |
| Game mode: off / on | `game` (experimental): the tool restarts Chromium with WebGPU's checks off (Dawn's validation and robustness), less work for games; for trusted games only; never kept over a restart of the tool. While on, the tool asks the other tools on the bus to make way (a Steam game stops, Cast pauses on the cluster and the HUD). On needs the browser running or paused; off works any time |
| Home page, Reload, Back | `home`, `reload`, `back` |
| page | the page's title and address |
| GPU | what the tool's probe found, one row: `WebGPU: CPU (SwiftShader) \| WebGL 2: CPU (SwiftShader) \| JSPI: ok`, in the GPU mode `WebGPU: GLES compat | WebGL 2: GLES 3.2, Intel HD Graphics 505 (Broxton)`; or `GPU mode: ...`, what became of it (it didn't start, Chromium exited, the last try never ended because the unit restarted) |

Texts are plain ASCII (RHMI Text is not a reliable Unicode transport on this
firmware: knowledge/idrive-app-ui.md); `test_page.js` checks the page's.

## Hiding, and touches under the pictures

The touch screen and the browser are layers over the HMI, and the HMI
still gets every touch on them (the tool only reads a copy). So they go up
only over the screen state (`ST_OnlineApps_VizualyseChromiumScreen`,
ParentState the main page: a title and one label, nothing to press), once
that state is visible. Should the HMI not open it within 3 s, the picture
goes over the main page (every button disabled) and the log says why.

A picture stays up only while the state it went up on is visible and
focused: BACK (the arrow left of it) brings the main page back and hides
it, as do HOME, another app, and a pop-up, a call or a warning taking the
focus for 300 ms (a shorter blip is ignored): the app sends `ui` off. It
also does as it shuts down.

## Only while parked

As vizualyse_moonlight: the app reads `Vehicle2.statusCarSpeed2` every
second (`src/vehicle_speed.js`) and sends `{"cmd":"speed","kmh":N}`; the
tool hides the browser's picture above 3 km/h and won't show it; the
touch screen stays, and comes back in the picture's place (since 0.3.1).

## The socket

`/dev/shm/vizualyse-chromium/ctl.sock` (`CHROMIUM_CTL_SOCKET` overrides it),
a Unix stream socket, newline-delimited JSON, open to this app's group only.
The tool sends `{"ev":"status", enabled, link, uplink, bundle, browser,
shown, touch, touchWanted, url, title, home, gpu, speed, moving, pictures,
decodeMs, view, error}` on connect, after each command and once a second,
`{"ev":"error","error":...}` for a failed command and `{"ev":"list"}` for
the touch screen's List corner; the app sends `ui`, `enable`, `disable`,
`show`, `hide`, `home`, `reload`, `back` and, every second, `speed`. The
app holds it while it runs.

## Build and test

```sh
node tools/build.js          # the source package; the unit builds the app
node tools/test_page.js      # the page against a fake SDK, HMI and Vehicle2, and a fake tool socket
node tools/make_page.js vizualyse_chromium@0.3.1
node tools/make_icon.js vizualyse_chromium@0.3.1/rhmiData/variantGroups/Common/images/vizualyse_chromium_icon.png
```

The structure follows [vizualyse_moonlight](../vizualyse_moonlight).
