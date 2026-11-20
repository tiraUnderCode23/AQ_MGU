# IPTV

The live TV channels of **your own Xtream Codes IPTV account** on the centre screen, in the style of UHF.
iDrive 7 · package `amn_iptv` · version 0.3.1 · needs the **IPTV service** (`amn-iptv`, same Store source) and a GPU
renderer (mgu-render) from the Store.

## Your account stays yours

The app and this repository contain **no server, user name or password**. Install it and you get an empty sign-in
page: you need your own subscription. Sign-in happens once from your phone: the app shows a QR code, the phone
opens a page the head unit serves on the car's own Wi-Fi, and the login goes from the phone to the head unit,
where only the system can read it. Sign out (Settings) deletes it. See `native/amn-iptv/README.md`.

## Pages

| Page | What it shows |
|---|---|
| Home | Your favourites (each logo on a plate tinted by its own colour, what is on now, a progress line) and their TV guide: what is on, how far it is, what comes next |
| Live TV | Every category (the ones your favourites come from first) and its channels |
| Search | An on-screen keyboard; results by channel name, whole words first |
| Player | The picture full screen. A tap shows the channel, the programme, what is next, and Guide, Channels, Favourite, Stop |
| Series, Movies | A later version (they need a player for their file types) |

The picture shows while parked (under 1 km/h and in P). **Settings > Video while driving** lets a passenger watch
while driving; it is off by default, and in Quebec a driver may not have video in view. The sound plays either way.
The steering wheel's skip changes the channel. 4K / HEVC channels and films play when they are 8-bit. 10-bit (HEVC Main 10, most 4K films) does not show a picture in the car yet: 0.3.3 showed why: the decoder ran out of video memory for its 10-bit picture buffers; 0.3.4 asks for the fewest it can work with, and if that still fails says how many it asked for. HDR films look flatter than on an HDR TV (no tone mapping).

## Screens

Rendered on a computer from the app's own drawing code, with a real account's channels (the Mac has no GPU
renderer, so the player shows no picture).

![Home](../../docs/screenshots/amn_iptv/home.png)
![Live TV](../../docs/screenshots/amn_iptv/live.png)
![Search](../../docs/screenshots/amn_iptv/search.png)
![Player and guide](../../docs/screenshots/amn_iptv/player-guide.png)
![Sign in](../../docs/screenshots/amn_iptv/signin.png)

## Credits

The look follows UHF (an iPhone IPTV player). Third-party code in `lib/` keeps its licence (`LICENSE.third-party`):
leschi's MGU Media Client (park check, keyboard, PNG decoder; MIT), jpeg-js (BSD-3-Clause / Apache-2.0), Project
Nayuki's QR code generator (MIT); fonts: Inter (OFL). The sound route (source 287 to the front speakers) is
Moonride's, as aurelmarius' TVH Player uses it. The service is built from aurelmarius' TVH Player service
(GPL-3.0-or-later).
