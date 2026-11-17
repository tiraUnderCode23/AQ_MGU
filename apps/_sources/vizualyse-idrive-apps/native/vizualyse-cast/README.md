# vizualyse-cast

A tech demo for the iDrive 7 head unit: play a stream URL from your phone on
the instrument cluster or the HUD, with its sound through the speakers.

1. The head unit is on your phone's hotspot (mgu-uplink).
2. Open **Cast** (the iDrive app, apps/vizualyse_cast) and scan its QR code
   with the phone. The cluster can show the QR code while idle too (off by
   default: with navigation up the cluster's direction list covers it).
3. On the page, either a **Stream URL** (a file, HLS `.m3u8`, `rtsp://`,
   `rtmp://`) to **Cluster map**, **HUD**, **Media console** or **Audio only**,
   with sound on or off and the volume; or the **CarPlay second screen** to
   the cluster map or the HUD. Then **Play**.

**Cast to cluster: on / off** on the iDrive page turns the whole service off
(nothing plays, no QR code, the phone page closed) and is kept across restarts.

## The touch screen

Since 0.4.0 the iDrive app opens on this tool's **touch screen**, built
from the platform's touch kit (`tool/touch_ui`, shared by every app's
touch screen), in mgu-render's app area (1790x638 at +108+82: the HMI's
title bar and back strip stay the HMI's). The app opens its empty screen
state, then `{"cmd":"touch","on":true}`; BACK, HOME, another app or a
pop-up make it send `on: false`. The **List** button (top right) hides it
and sends the app `{"ev":"list"}`: the app goes back to its iDrive list,
which keeps every control.

- **Only where mgu-render is installed**: the tool doesn't require it (this
  screen's output is optional); `touchAvailable` in the status says whether
  its client is on the unit, and without it the app stays on its list.
- **Parked or driving** (since 0.4.1): the app sends the car's speed once a
  second (`{"cmd":"speed","kmh":N}`), shown on the Info tab; the touch
  screen stays while driving (the map's settings on the move, as the car's
  own controls). The list does it all too.
- **A stream on this screen** (the media console output) uses mgu-render
  under the same client name: the touch screen hides first, and comes back
  when that stream ends if the app still wants it (`touchWanted`).
- **The screen** (`src/touch_view.js`, pure): three tabs in the kit's frame.
  *Cast*: the phone page's QR code (drawn by the kit's `qr` widget from the
  platform's `common/qrcode`, made once per link) and link; the stream's
  card (what plays, where, for how long) with **Stop**; **Play the last
  stream again on** Cluster map / HUD / This screen; **Cast to cluster** and
  **QR code on the cluster**. *CarPlay*: a live preview of the CarPlay map
  (below), **Map on Cluster / Map on HUD**, zoom − / +, and the five
  switches (second screen, directions card, time and distance card, centre
  the map, HUD alternate mode). *Info*: the uplink, the phone page, the
  cluster renderer, hook111, the last stream, the speed (mph). The status
  line says what plays and the hotspot's address. Every action is the same
  command the iDrive list sends.
- **Its model comes from memory**: the last status, made once a second (the
  socket's broadcast or the touch screen's tick) and after every action; a
  frame never reads a file.
- **The CarPlay preview**: while the CarPlay map plays, its ffmpeg has a
  second, small output (`carplay_screen.previewArgs`): 760x370 RGBA, 4
  pictures a second, on fd 4, the rate cut before scaling, the phone's
  picture fitted (black either side). The tool reads fd 4 all the time
  (a full pipe would hold the cluster's output back too) and keeps the
  pictures only while the touch screen shows its CarPlay tab, into two
  buffers made once; a picture redraws the preview's rectangle alone (Node 8
  on one desktop core: ~3 ms). Off the car the cluster's output is the same
  with and without it (`test/carplay_test.js`). It is only added where the
  touch screen can show it (mgu-render installed); `CAST_CARPLAY_PREVIEW=0`
  in the service's environment leaves the CarPlay ffmpeg as before 0.4.0.
  "Not playing" (and why) when there is no picture.
- **Touch** (`touch_reader.py`, mgu-python, from the kit): read passively,
  never claimed; targets are 64 px or more (`test/touch_test.js` lints every
  tab in every state).

## The CarPlay second screen

CarPlay's own instrument-cluster view (Google Maps' or Apple Maps' cluster
map), which the phone draws next to the main CarPlay screen. On this head
unit's 2020 `carplay` it needs **hook111** ([`native/hook111`](../hook111), from the Store) armed
for the current start, in mode `alt`. The hook hands the stream out as H.264
to a consumer on `127.0.0.1:6111`; the tool's ffmpeg is that consumer
(`carplay_screen.js`). It listens, the hook connects and asks the phone for a
keyframe, and the picture follows in about 0.2 s. If the connection ends,
ffmpeg listens again.

| Output | The phone draws | Sent to cluster-render |
|---|---|---|
| Cluster map | 984x480, placed at x 52-1036 of the 1088x480 `map` target (calibrated on the car: the cluster's soft vignette hides the outer ~130 px each side; the map reaches 60 px into it for a wider picture). Safe area 340x435 at 322,20 when centring | as drawn, 984x480 at up to 20 fps (cluster-render's governor keeps the link within its cap) |
| HUD | by default the cluster map's picture (984x480, its safe area); in the HUD's alternate mode 1056x384, the band's own shape, no safe area | 528x192 at 15 fps, fitted (black either side by default), in the band (17-83 % of the width, 25-65 % of the height) |

**The switch** (the iDrive page and the phone page, "CarPlay second screen:
on / off") sets hook111's mode: `alt` (on) or `off`. The tool runs as root, so
it does what the app can't: it saves `HOOK111_MODE=` in
`/var/opt/hook111/config` (its other lines kept) for later starts, and when
the hook is armed this start, sets it now with hook111's own
`hook111-arm.sh mode`; the phone sees it at its next connection. Not armed, or
fallen back to off this start: it applies from the next start, and the pages
say so. Off also stops a second screen that's playing. `full` isn't offered:
`viewAreas` without its records made the phone refuse every session (centring,
below, sends both).

The tool writes the wanted size to `/run/hook111/display`; the phone gets it
at its next connection, and until then the stream is scaled to fit. The page
and the iDrive page show whether hook111 is ready, and why not.

**The cluster cards** ("CarPlay directions card" / "CarPlay time / distance
card" on the iDrive page, two checkboxes on the phone page; both on by
default): the tool writes the scene for them to `/run/hook111/url`
(`carplay_screen.sceneUrl`), and hook111 0.1.5 sends it to the phone as
`showUI` while the stream runs: at once, no reconnect. Found on the car
(2026-11-04, Google Maps): `?showETA=yes` both cards, `?showETA=no`
directions only, `?showETA=yes&maneuverLayout=topAligned` the time /
distance card only on the centred area (on a wide area that shows both, so
there `/map?showETA=yes`: the card bottom right), `/map` neither. The
options only apply through `showUI`, not `/info`'s `initialURL`; the view
/info names (`/run/hook111/view`) follows the directions card. The commands
are `{"cmd":"carplayCards","directions":…,"eta":…}` and
`POST /api/carplay-cards`. hook111 0.1.6 sends the scene again 1, 4 and 10 s
after each new stream or change (0.1.5's single send, with the stream's first
frame, often didn't take: issue #1), and says when the phone answered
(`ui_acked`); the cards stay "pending" until then.

**Day / night** (hook111 0.1.6): the cluster map follows the car's own
day / night (its light sensor, which already switches the main screen in a
tunnel). Nothing to set in the tool; `/api/status` shows it as
`carplay.night` (`now`, what the `car` last said, whether the phone
`acked`). For a test on the car, `echo night > /run/hook111/night` (or
`day`) forces it until the file is removed.

**Zoom** ("CarPlay map: zoom in / out", "−" / "+" on the phone page): a
request in `/run/hook111/zoom` that hook111 sends as `changeMapZoomLevel`.
`{"cmd":"carplayZoom","dir":"in"|"out"}`, `POST /api/carplay-zoom`.

**Centring** ("CarPlay: centre the map" on the iDrive page, "Centre the map"
on the phone page; on by default): the tool writes the target's safe area to
`/run/hook111/safearea` (`x,y,w,h`; the map's 340x435 at y 20, centred across
its width; the HUD uses the map's) with the size when it plays, and the view
area to `/run/hook111/viewarea`: 0 centred, 1 Maps' own layout. hook111 0.1.5
offers both view areas and switches between them at once (`updateViewArea`).
On the car the directions card follows the area's top edge and the time /
distance card its bottom; 340x435 at y 20 was the owner's pick. hook111 (0.1.4) puts it into `/info` as `viewAreas` and
answers `viewAreas` at SETUP; the phone centres its view on it from its next
connection. On the car (2026-11-04, Google Maps): the car centred, the
directions card above it. Without a safe area Google Maps puts the car low
and a quarter across, the card top right. The commands are
`{"cmd":"carplayCentre","on":…}` and `POST /api/carplay-centre`.

**The HUD's alternate mode** ("CarPlay HUD alternate mode" / "HUD alternate
mode"; off by default): with it, the CarPlay picture on the HUD is the wide
1056x384 that fills the HUD's band, not centred, with the time / distance
card only (bottom right); without, the HUD shows the
cluster's centred picture, fitted into the band. Written at once while the
picture is on the HUD (the phone takes it when it reconnects). The commands
are `{"cmd":"carplayHudAlt","on":…}` and `POST /api/carplay-hud-alt`.

0.3.5's shape setting (a taller picture squeezed back) and its vignette are
gone: on the car the squeeze looked squashed and moved nothing.

The central-screen mirror (BMW's `winston-grabber` and the Google Maps
layouts) was removed in 0.3.0.

**Other tools' asks (0.3.11):** on the tools' bus
([native/vizualyse-bus](../vizualyse-bus/README.md)), while another tool asks
for `cluster-video` off, a play on the cluster map pauses (ffmpeg stopped, the
layer dropped; state `paused`, the status's `note` says who asks and why),
and `hud-video` the same for the HUD; it starts again once no tool asks. A
play started meanwhile waits paused; a stop forgets it. Steam asks for both
while a game runs. A URL stream starts again from where the stream is then (a
live one) or from its start. The Browser asks the same while in game mode.

## How it works

| Part | Runs as | Does |
|---|---|---|
| `server.js` | root | the page on port 8480 (token in the QR link), the QR code and the video layer through cluster-render, starts ffmpeg and the audio player |
| `proxy.js` | uid 12999 | an HTTP/CONNECT proxy on 127.0.0.1:8481; mgu-uplink routes this uid (never root) through the phone, and names resolve through the uplink's DNS, since the head unit's own resolver does not resolve internet names |
| `ffmpeg` | root | static build, reads the stream through the proxy and writes I420 frames (stdout) and S16LE 48 kHz stereo (fd 3) |
| `pcm_play.py` | root, mgu-python | plays the audio into SmartXbar's `CarPlayMain_CF_48_STEREO` source; makes the stream's lock as the system does first (since 0.3.9, the platform's player: before, a lock first made by root could silence CarPlay until a restart) |
| `console_out.js` | root | the media console output: frames into mgu-render's frame file `/dev/shm/mgu-video-vizualyse_cast` (MGVF, 3 slots), drawn by an mgu-render client in layer mode in the screen's app area |
| `firewall.js` | root | one in-memory nftables rule letting the phone reach port 8480 on `wlan0`; added at start (while on), removed at stop, when turned off and by the tool's `deactivate` |
| `control.js` | root | the iDrive app's socket, `/dev/shm/vizualyse-cast/ctl.sock`, mode 0660 in the Cast app's own group (found by its package name under `/var/opt/public/oap`; root only until it is installed; every Store app shares `tm_oap_app`, so that group was open to all of them before 0.3.8): status, stop, replay, carplay, hook111, carplayCards, carplayZoom, carplayCentre, carplayHudAlt, enable, disable, the cluster QR code, touch, speed; `{"ev":"list"}` to the app |
| `carplay_screen.js` | root | the CarPlay second screen: hook111's state, the size and the cluster view to ask for, ffmpeg's arguments (the preview's too) |
| `touch.js`, `touch_view.js` | root | the touch screen (above): its model from the last status, the QR code, the CarPlay preview's pictures, its actions; its three tabs as the kit's widgets |
| `ui_*.js`, `ui.*`, `touch_reader.py` | root (the reader: mgu-python, then `nobody`) | copies of the platform's touch kit (`tool/touch_ui`; synced, not committed) |

Frame sizes keep within cluster-render's 5500 KB/s upload ceiling: for a
stream URL 512x288 at 15 fps on the map and 480x270 at 15 fps on the HUD,
there in the band between its clipped top and the car's speed (25 % to 65 %
of the height); for the CarPlay second screen, the table above. The CarPlay
map is the exception: it goes at the phone's own size, and cluster-render's
governor (it sends only changed tiles, and a frame it can't cover packed,
then exact) keeps the link to the cluster within the cap. On the car
(2026-11-04, 936x480 at 20 fps, parked): ~14.5 fps reached the cluster, no
budget holds, 19 frames packed in 15 s. The cap protects that link: on a car
the cluster flashed black at 8000 KB/s. ffmpeg
decodes in software on the Atom A3960's four cores.

`test/carplay_test.js` (Node 8, the kit's ffmpeg) checks the second-screen
source off the car: a fake hook111, a real x264 stream through the tool's
ffmpeg arguments (with the touch screen's preview output too), and
server.js end to end. `test/touch_test.js` (Node 8) checks the touch screen:
every tab in every state lint clean, PNGs of the tabs, the preview's
buffers, and server.js end to end against a fake mgu-render client and
touch reader (`test/fake_*.js`): shown, a toggle, moving, List, a stream on
this screen and back, the CarPlay map's live preview (with ffmpeg:
`CAST_FFMPEG=...`; the end-to-end part on Linux).

Sound reaches the speakers while the audio manager has `CarPlayMain`
connected (CarPlay the source, or nothing else playing); the first play
after the head unit starts can take a while to connect.

## Build and install

`node tools/fetch_ffmpeg.js` (the tool's `build`) downloads the pinned
static ffmpeg into `build/`. `release/release.js` packs the tool kit and
publishes it in the fork's `catalog` release; add the fork as a Store source
on **Releases** and install **Cast to cluster**. It requires cluster-render,
mgu-python and mgu-uplink.

## Licenses

GPL-3.0-or-later (`LICENSE`). `cluster_render_client.js` is MPL-2.0
(`LICENSES/MPL-2.0.txt`), Robert Nisipeanu's client for
[cluster-render](https://github.com/robertnisipeanu/idrive-apps/tree/main/native/cluster-render). `qrcode.js` is Kazuhiko Arase's QR Code Generator,
MIT. The bundled ffmpeg is John Van Sickle's static build, GPLv3
(`ffmpeg-GPLv3.txt`). [THIRD-PARTY.md](THIRD-PARTY.md), shipped in the kit,
names the exact build, its libraries and where their source is.
