# clucraft-plex

The service behind the app **Drive-In** (`apps/clucraft_plex`): the films and series of your own **Plex Media
Server** on an iDrive 7 head unit. The server's transcode of a film is read as HLS, decoded on the GPU
(`tvh-player`) into mgu-render's frame file, which the app shows, and its sound plays on the car's speakers.

An unofficial client: not affiliated with or endorsed by Plex.

## Your account stays yours

- The app and this repository hold **no account, server or token**. Anyone who installs them gets an empty sign-in.
- Sign-in is Plex's own link code: the app shows four characters, you type them at **plex.tv/link** on a phone or
  computer, and plex.tv hands this service a token for the account. No password is ever typed in the car or passes
  through the head unit.
- The head unit keeps the token in `/var/opt/clucraft-plex/state/account.json`, readable by root only (0600). Sign
  out deletes the file. The app never receives the token; its status shows the account's name and the server's.
- The token is sent in a request header only, never in an address, and nothing logs it.
- The service's control socket is open to the Drive-In app's own group only, not to every app.
- It talks to plex.tv and to the server plex.tv lists for the account, and to nothing else.

## How it runs

| Part | Runs as | Does |
|---|---|---|
| `service.js` | root | the app's control socket, the account and the posters on disk; starts `client.js` and the player |
| `client.js` (`plex.js`, `session.js`, `hls.js`, `art.js`, `netx.js`) | uid 13271 (mgu-uplink's internet) | plex.tv and the server: signing in, the libraries, search, the posters (decoded and scaled here), the film's stream |
| `tvh-player` (`player.js` starts it) | root, then nobody | MPEG-TS in, the picture on the GPU, the sound into SmartXbar |

Socket activation: the app's first connection starts the service; it ends 10 minutes after the app's last request
while nothing plays. 90 s without a request from the app while a film plays (the app closed or crashed): the film
stops, and the server is told.

## Control

One JSON object per line on `/run/clucraft-plex.sock`, one line back: see the header of `service.js`.

## What plays

The server is asked for its universal transcoder's HLS stream: **H.264 (8 bits) with stereo AAC in MPEG-TS**, at
the size and bitrate of the app's *Picture quality* setting (720p at 4 Mbit/s unless changed). A film that already
is H.264 within that is passed on as it is (the server's "direct stream"); everything else (HEVC, 10-bit, HDR, DTS,
other containers) the server converts, so the head unit never meets a film it cannot decode. Subtitles chosen on the
film's page are burnt into the picture by the server.

`hls.js` reads the playlist and its segments ahead of the player (24 MiB or 90 s at most) and hands them to
`tvh-player`'s stdin a whole segment at a time. A skip is a new transcode at that second. The film's position is the
stream's start plus what the player has played; the server is told every 10 s (its *timeline*), so the resume point
and the watched mark are the server's own, the same as in any other Plex app.

Not here yet: music and photo libraries, a managed user's PIN, direct play of the file itself.

## Credits and licence

GPL-3.0-or-later (`LICENSE`).

- `tvh-player` is the binary of M850i-amn's **IPTV service** ([M850i-amn/idrive7-apps](https://github.com/M850i-amn/idrive7-apps)
  at commit `0dfa583151e0c59ba8d2a8d9272a1d8685b66d2a`, `native/amn-iptv/tvh-player`, sha256
  `40b6d5403c537d61e21aa1275bc1620e198a10a700ebe4cab19c0d57d709d05f`), unchanged; its source is in `../tvh-player`
  in this repository. It began as aurelmarius' TVH Player ([aurelmarius/bmw-apps](https://github.com/aurelmarius/bmw-apps))
  and builds on Robert Nisipeanu's waze-on-cluster decoder via Moonride (GPL-3.0-or-later) and FFmpeg
  (LGPL-2.1-or-later, `FFMPEG-LICENSE`).
- `player.js`, `netx.js`, `sockgroup.js`, `check.js` and the systemd units are amn-iptv's, with this tool's names;
  `service.js` and `client.js` are built the way amn-iptv's are. The Plex parts (`plex.js`, `session.js`, `hls.js`,
  `art.js`) are this project's own.
- `jpeg_decoder.js` is jpeg-js 0.4.4's decoder (BSD-3-Clause; its decoder core Apache-2.0: `LICENSE.jpeg-js`).
- `cacert.pem` is Mozilla's CA list (via certifi, MPL-2.0).
