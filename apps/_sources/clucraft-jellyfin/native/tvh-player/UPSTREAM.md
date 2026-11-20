# Where this folder comes from

This is `native/tvh-player` of [M850i-amn/idrive7-apps](https://github.com/M850i-amn/idrive7-apps) at commit
`0dfa583151e0c59ba8d2a8d9272a1d8685b66d2a`, unchanged: the source of the player binary
`native/clucraft-jellyfin/tvh-player` (sha256 `40b6d5403c537d61e21aa1275bc1620e198a10a700ebe4cab19c0d57d709d05f`,
that repository's `native/amn-iptv/tvh-player`). GPL-3.0-or-later (`LICENSE`).

Its own README speaks of the services it was written for (aurelmarius' TVH Player, M850i-amn's IPTV). Drivefin uses
the same binary the same way: MPEG-TS on its stdin, started by `native/clucraft-jellyfin/player.js`.

To build it yourself: `sh native/tvh-player/build.sh` (needs git, python3 and Docker), then copy
`native/tvh-player/build/tvh-player` over `native/clucraft-jellyfin/tvh-player`.
