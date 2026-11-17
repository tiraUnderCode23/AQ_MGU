# vizualyse_cast

The iDrive 7 app for [vizualyse-cast](../../native/vizualyse-cast) (Cast to
cluster), which plays a stream URL from the phone on the cluster map, the
HUD or the media console, with its sound through the speakers. The tile is
**Cast**.

## The touch screen, and the list

Opening the app opens its **touch screen** (the tool's, below) by itself
while parked. Its **List** button (top right), BACK or the car starting to
move bring the page back: the iDrive list, all of it usable with the
controller. The list's first row, **Touch screen**, opens the touch screen
again. The handling is the platform's `app/touch_mode`.

Cast is used while driving: the touch screen hides then (decided), and the
list keeps every control. Cast does not require mgu-render (its "this
screen" output is optional): the touch screen is offered only where the
tool reports mgu-render's client on the unit (`touchAvailable`); elsewhere
the app opens on its list and the row reads `Touch screen (needs
mgu-render)`.

## The page

One `LT_State_Wide` page, all of it usable with the iDrive controller:

| Row | What it does |
|---|---|
| status | `Ready - scan the QR code with your phone`, `Playing on the cluster map, with sound - 12 s`, `Paused on ...`, `Waiting for the phone's hotspot`, `The touch screen is up - List (top right) or the back arrow returns here`, `Error: ...` (a refused command's, for 8 s, or the stream's), `Cast service not running - install Cast to cluster in the Store` |
| Touch screen | opens the empty screen state, then `touch`: the tool's touch screen over the app area. Off while the car moves (`(only while parked)`) and without mgu-render (`(needs mgu-render)`) |
| QR code | the phone page's link (`http://<hotspot address>:8480/?t=<token>`), an `LT_Label_1Graphic_Scalable` showing a PNG from `/dev/shm/vizualyse_cast_qr_<uid>/` |
| link | the same link as text, and how to use it |
| Cast to cluster: on / off | the whole service: off stops what plays, hides the QR code and closes the phone page; kept across restarts |
| Stop | stops the stream; enabled while one plays |
| CarPlay second screen: on / off | hook111's mode (`alt` / `off`), set by the tool now and for later starts; says when a change applies only from the phone's next connection or the next start; disabled without hook111 |
| CarPlay directions card: on / off | the directions card on the cluster; applies at once (hook111 0.1.5); disabled without hook111 |
| CarPlay time / distance card: on / off | arrival time, time and distance left; applies at once; on the HUD in its alternate mode the only card |
| CarPlay map: zoom in / zoom out | zooms the cluster map, while the CarPlay picture plays |
| CarPlay: centre the map: on / off | the phone centres the car between the directions card (top) and the time / distance card (bottom), a safe area through hook111; off: Maps' own layout; switches at once; on by default |
| CarPlay HUD alternate mode: on / off | on the HUD, the wide picture that fills its band, not centred; off (the default): the cluster's centred picture, fitted into the band; disabled without hook111 |
| CarPlay map on the cluster / on the HUD | CarPlay's own second screen (its cluster map) on the cluster map or the HUD; enabled while hook111 is armed and ready (the tool's `carplay.ready`) |
| Play last on the cluster map / the HUD / this screen | plays the last stream the phone started again (its URL stays in the tool); this screen needs mgu-render and is hidden without it |
| QR code on the cluster | the tool's idle QR code on the cluster on or off (off by default: the cluster's navigation list covers it) |
| info | the uplink, the cluster renderer and the last stream (without its query) |

Texts are plain ASCII (RHMI Text is not a reliable Unicode transport on this
firmware: knowledge/idrive-app-ui.md). Every row has its place on the touch
screen too ([the tool's README](../../native/vizualyse-cast/README.md#the-touch-screen)).

## The touch screen, and touches under it

The HMI still gets every touch on the tool's picture, so the app first
opens the screen state (`ST_OnlineApps_VizualyseCastScreen`, a title and
one label, nothing to press) and sends `touch` once it is visible. Should
the HMI not open the screen state within 3 s, the touch screen goes over
the main page (its buttons disabled) and the log says why. BACK, HOME,
another app, and a pop-up taking the focus for 300 ms hide it (`touch`
with `on: false`). The tool's `{"ev":"list"}` (its List button) closes the
screen state. A stream played on this screen
hides the touch screen until it ends (the tool's; the screen state stays).

The app reads `Vehicle2.statusCarSpeed2` every second (`src/vehicle_speed.js`,
the platform's `app/vehicle_speed`) and sends `{"cmd":"speed","kmh":N}`;
the touch screen shows it. The touch screen stays while driving (map
settings on the move, as the car's own controls; since 0.4.1).

## The socket

`/dev/shm/vizualyse-cast/ctl.sock` (the tool's `control.js`), a Unix stream
socket in the Cast app's own group (only it and root can connect), newline-delimited JSON. The tool sends
`{"ev":"status", state, output, audio, seconds, error, uplink, render, qr,
link, canReplay, outputs, url, touch, touchWanted, touchAvailable, moving,
speed}` on connect, after each command and once a second (with `enabled`
and `carplay`), `{"ev":"error","error":...}` for a refused command and
`{"ev":"list"}` from the touch screen's List button; the app sends
`{"cmd":"stop"}`, `{"cmd":"replay","output":...}`,
`{"cmd":"carplay","output":"map"|"hud"}`, `{"cmd":"hook111","mode":"off"|"alt"}`,
`{"cmd":"carplayCards","directions":...,"eta":...}`, `{"cmd":"carplayZoom","dir":"in"|"out"}`,
`{"cmd":"carplayCentre","on":...}`, `{"cmd":"carplayHudAlt","on":...}`,
`{"cmd":"enable"}`, `{"cmd":"disable"}`, `{"cmd":"qr","show":...}`,
`{"cmd":"touch","on":...}` and `{"cmd":"speed","kmh":...}`. The app holds it
while it runs (the speed goes on with the page hidden). `tools/make_page.js`
writes the page's application.xml and uiDescription.json from one list.

## Build and test

```sh
node tools/build.js          # the source package; the unit builds the app
node tools/test_page.js      # the page against a fake SDK and HMI and the tool's real control socket
node tools/make_page.js vizualyse_cast@0.4.1
node tools/make_icon.js vizualyse_cast@0.4.1/rhmiData/variantGroups/Common/images/vizualyse_cast_icon.png
```

The structure (SDK use, tile, visibility, the QR handles) follows
robertn_waze_cluster and robertn_store; the touch screen's handling,
vizualyse_cluster.
