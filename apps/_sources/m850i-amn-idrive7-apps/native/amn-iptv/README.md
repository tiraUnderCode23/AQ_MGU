# amn-iptv

The service behind the app **IPTV** (`apps/amn_iptv`): the live channels of your own **Xtream Codes** IPTV account
on an iDrive 7 head unit. A channel's MPEG-TS stream is decoded on the GPU (`tvh-player`) into mgu-render's frame
file, which the app shows, and its sound plays on the car's speakers.

## Your account stays yours

- The app and this repository hold **no server, user or password**. Anyone who installs them gets an empty sign-in.
- Sign-in happens once, from your phone: the app shows a QR code, the phone opens a page the head unit serves on the
  car's own Wi-Fi, and you type the server, user and password there. They go from the phone to the head unit only.
- The head unit keeps them in `/var/opt/amn-iptv/state/account.json`, readable by root only (0600). Sign out
  deletes the file. The app never receives the password; its status shows the server's host and the user name.
- Nothing logs the password or a stream address (which holds it).
- The service's control socket is open to the IPTV app's own group only, not to every app.

## How it runs

| Part | Runs as | Does |
|---|---|---|
| `service.js` | root | the app's control socket, the sign-in page, the account and logos on disk; starts `client.js` |
| `client.js` (`xtream.js`, `netx.js`, `playback.js`) | uid 13161 (mgu-uplink's internet) | the Xtream API: categories, a category's channels, search, now and next, a channel's guide, logos, the stream |
| `tvh-player` (`player.js` starts it) | root, then nobody | MPEG-TS in, the picture on the GPU, the sound into SmartXbar |

Socket activation: the app's first connection starts the service; it ends 10 minutes after the app's last request
while nothing plays. 90 s without a request from the app while a channel plays (the app closed or crashed): the
channel stops.

Xtream accounts are large (21,988 channels on the account this was built against), so nothing is listed whole
unless asked: categories, then one category's channels; search loads every channel once (about 15 s) and keeps the
list 30 minutes; what is on now is asked only for the channels on screen.

## Control

One JSON object per line on `/run/amn-iptv.sock`, one line back: see the header of `service.js`.

## Films and series (0.2.0)

`film.js`, in the client: the account's films (VOD) and series, their categories, details, seasons and episodes
(`xtream.js`), and one playing at a time beside live TV. tvh-player reads the film itself over HTTP from a server
`film.js` keeps on 127.0.0.1: a random port and a random 128-bit path per film, answering only that path, which fetches
the bytes the player asks for (its Range) from the account. The service hands the player only that address and a
start (`MGU_INPUT_URL`, `MGU_START_S`, checked in `service.js`). A skip or a resume is a new player at that second;
pause ends the player and keeps the position; a player that ends early (the connection) is started again where it
was, 3 times in 2 minutes. The app keeps where each film and episode stopped.

## What plays

`tvh-player` takes H.264 or HEVC video (HEVC on the unit's own HEVC decoder plugin, from 0.3.0; 10-bit HEVC Main 10, most 4K films: not yet working in the car (0.3.3 tries P010 with Shift 1, Shift 0, then the header's own setup, and reports the decoder's refusal); HDR is not tone mapped) with AAC, AC-3, E-AC-3, MP2 or MP3 sound; live TV as MPEG-TS, films as MP4, MKV or
MPEG-TS. It is built from `../tvh-player` by `.github/workflows/tvh-player.yml` (GitHub Actions), which also plays
test films and a live stream with it; the binary here is that run's artifact, its sha256 in the commit that added it. HEVC channels and films (usually labelled 4K, UHD or HEVC) play on the hardware decoder when 8-bit; 10-bit is not working in the car yet. An account that allows one
connection plays on one device at a time: a stream the provider refuses (401, 403, 509) says so.

## Credits and licence

GPL-3.0-or-later (`LICENSE`). Built from aurelmarius' **TVH Player service** (`native/aurelm-tvhplayer`) and its
player **tvh-player** (`native/tvh-player`), [aurelmarius/bmw-apps](https://github.com/aurelmarius/bmw-apps) at
commit `921832956f301c0b889c0643a768f05c2b0216df`: `service.js`, `client.js`, `page.js` and `playback.js` changed
for Xtream, `xtream.js` new in place of `tvh.js`, the rest as there with its ids renamed. `tvh-player` is the binary
from that repository's `packages/aurelm-tvhplayer@1.0.1.tgz` (sha256 `2c6e03bd…af32f18`), its source in
`../tvh-player`; it builds on Robert Nisipeanu's waze-on-cluster decoder via Moonride (GPL-3.0-or-later) and FFmpeg
(LGPL-2.1-or-later, `FFMPEG-LICENSE`). `netx.js`'s `cacert.pem` is Mozilla's CA list (via certifi).
