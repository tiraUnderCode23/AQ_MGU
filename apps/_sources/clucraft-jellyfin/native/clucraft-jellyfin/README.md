# clucraft-jellyfin

The service behind the app **Drivefin** (`apps/clucraft_jellyfin`): the films and series of your own **Jellyfin**
server on an iDrive 7 head unit. The server's conversion of a film is read as HLS, decoded on the GPU (`tvh-player`)
into mgu-render's frame file, which the app shows, and its sound plays on the car's speakers.

An unofficial client: not affiliated with or endorsed by the Jellyfin project.

## Your sign-in stays yours

- The app and this repository hold **no server, user or token**. Anyone who installs them gets an empty sign-in.
- Sign-in is Jellyfin's **Quick Connect**: the app shows six digits, you enter them in a Jellyfin you are already
  signed in to (the phone app, a browser), and the server hands this service a token of its own. No password is typed
  in the car or passes through the head unit.
- Where a server has Quick Connect switched off, the app asks for a name and password instead. They go to the server
  once (`/Users/AuthenticateByName`) and are kept and logged nowhere; over a plain `http` address they travel
  unencrypted, which the page says.
- The head unit keeps the server's address and the token in `/var/opt/clucraft-jellyfin/state/account.json`,
  readable by root only (0600). Sign out deletes the file and asks the server to drop the token
  (`/Sessions/Logout`). The app never receives the token; its status shows the user's name and the server's.
- The token is sent in the `Authorization` header only, never in an address, and nothing logs it. The addresses the
  server itself hands out for a film carry it (`api_key=`): it is taken out of each before the address is used.
- The service's control socket is open to the Drivefin app's own group only, not to every app.
- It talks to the one server whose address was typed, and to nothing else.

## How it runs

| Part | Runs as | Does |
|---|---|---|
| `service.js` | root | the app's control socket, the sign-in and the posters on disk; starts `client.js` and the player |
| `client.js` (`jellyfin.js`, `session.js`, `hls.js`, `art.js`, `netx.js`) | uid 13272 (mgu-uplink's internet) | the server: signing in, the libraries, search, the posters (decoded and scaled here), the film's stream |
| `tvh-player` (`player.js` starts it) | root, then nobody | MPEG-TS in, the picture on the GPU, the sound into SmartXbar |

Socket activation: the app's first connection starts the service; it ends 10 minutes after the app's last request
while nothing plays. 90 s without a request from the app while a film plays (the app closed or crashed): the film
stops, and the server is told.

## Control

One JSON object per line on `/run/clucraft-jellyfin.sock`, one line back: see the header of `service.js`.

## What the server is asked

The addresses are those of Jellyfin's API as its OpenAPI description has them (10.9 and later). Four requests had
another address before (a user's views, resume list, latest items and played mark): a server that answers 404 to the
new one is asked at the old one, so a 10.8 server is served too.

| For | Request |
|---|---|
| the server at a typed address | `GET /System/Info/Public`, `GET /QuickConnect/Enabled` (no sign-in) |
| Quick Connect | `POST /QuickConnect/Initiate`, `GET /QuickConnect/Connect`, `POST /Users/AuthenticateWithQuickConnect` |
| the libraries and the home page | `GET /UserViews`, `/UserItems/Resume`, `/Shows/NextUp`, `/Items/Latest` |
| a library, search, one item | `GET /Items` |
| a show | `GET /Shows/{id}/Seasons`, `/Shows/{id}/Episodes` |
| a poster | `GET /Items/{id}/Images/Primary` (a JPEG, scaled by the server) |
| watched / unwatched | `POST` / `DELETE /UserPlayedItems/{id}` |
| a film | `POST /Items/{id}/PlaybackInfo`, then the HLS playlist it names and its segments |
| where the film is | `POST /Sessions/Playing`, `/Sessions/Playing/Progress`, `/Sessions/Playing/Stopped`, `/Sessions/Playing/Ping` |

## What plays

The server is asked what it offers this device (`PlaybackInfo`, with a device profile that takes nothing but
**H.264 (8 bits, SDR) with stereo AAC in MPEG-TS, as HLS**), at the size and bitrate of the app's *Picture quality*
setting (720p at 4 Mbit/s unless changed). A film whose picture already is H.264 within that is passed on as it is
(the dashboard's "direct stream"); everything else (HEVC, 10-bit, HDR, DTS, other containers) the server converts, so
the head unit never meets a film it cannot decode. The sound track and the subtitles are those chosen on the film's
page; subtitles are drawn into the picture by the server. The next episode of a show keeps the languages chosen for
the one before.

`hls.js` reads the playlist and its segments ahead of the player (24 MiB or 90 s at most) and hands them to
`tvh-player`'s stdin a whole segment at a time. Jellyfin's playlist lists the whole film and the server converts from
whichever segment is asked for, so a skip reads the same stream from another segment. The film's position is that
segment's start plus what the player has played; the server is told every 10 s, so the resume point and the watched
mark are the server's own, the same as in any other Jellyfin app.

Not here yet: music, photo and live TV libraries, collections, a choice between several versions of one film, direct
play of the file itself.

## Credits and licence

GPL-3.0-or-later (`LICENSE`).

- `tvh-player` is the binary of M850i-amn's **IPTV service** ([M850i-amn/idrive7-apps](https://github.com/M850i-amn/idrive7-apps)
  at commit `0dfa583151e0c59ba8d2a8d9272a1d8685b66d2a`, `native/amn-iptv/tvh-player`, sha256
  `40b6d5403c537d61e21aa1275bc1620e198a10a700ebe4cab19c0d57d709d05f`), unchanged; its source is in `../tvh-player`
  in this repository. It began as aurelmarius' TVH Player ([aurelmarius/bmw-apps](https://github.com/aurelmarius/bmw-apps))
  and builds on Robert Nisipeanu's waze-on-cluster decoder via Moonride (GPL-3.0-or-later) and FFmpeg
  (LGPL-2.1-or-later, `FFMPEG-LICENSE`).
- `player.js`, `netx.js`, `sockgroup.js`, `check.js` and the systemd units are amn-iptv's, with this tool's names;
  `service.js`, `client.js`, `session.js`, `hls.js` and `art.js` come from this project's Plex client
  ([clucraft/plex-idrive](https://github.com/clucraft/plex-idrive)), which is built the way amn-iptv's service is.
  `jellyfin.js` is this project's own.
- `jpeg_decoder.js` is jpeg-js 0.4.4's decoder (BSD-3-Clause; its decoder core Apache-2.0: `LICENSE.jpeg-js`).
- `cacert.pem` is Mozilla's CA list (via certifi, MPL-2.0).
