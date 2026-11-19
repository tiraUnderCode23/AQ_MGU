# Car Lyrics

Synced lyrics for whatever the car is playing: Apple Music over CarPlay, Bluetooth or USB. No Spotify
account and no app on the phone.

Version 0.3.10 · AQ source adaptation for ID7 / ID8 · package `aref_carlyrics` · [port contract](../../README.md)

## AQ ID8 adaptation

This derived source keeps the original application ID and version. It is recipe revision
`aq-aref-id8-2`, not a new publisher release. Main-app ID7 and ID8 resource paths, target SDK lifecycle,
and native renderer touch bounds are handled by the derived kit. Live unit execution remains
**NOT OBSERVED**; the tests use inert field providers and a visibly synthetic SDK package.

**Home-screen widget:** available only in the ID7 target build. The original widget has ID7 templates;
the ID8 package excludes its declaration and payload, disables widget startup, and displays the
limitation in Settings. Open the ID8 application from its app-list entry. This is an explicit feature
limitation, not an ID8 widget implementation.

A host build needs `--target-hmi ID7` or `--target-hmi ID8`. On a target, the builder accepts exactly one
of `/usr/lib/oap-mainapp` and `/usr/lib/oap-mainapp21`. Neither or both directories cause a build error;
SDK major version is never used to guess the HMI family. Each generated package declares only its
selected HMI. Car Explorer keeps its existing dual-package behavior.

On ID8 the same four declared media interfaces are read through the SDK typed field contract when
raw generated definitions are absent. Discovery enumerates only their fields and instances from the
local unit catalog. The adapter exports no method-call or field-setter capability. Freshness is tracked
per field and per interface instance; an unavailable source cannot keep a cached song selected. The
original 30-second getter cadence is retained, with a 90-second stale limit and a visible unavailable
state. Probe labels cached values “last seen”. The original four-second interpolation ceiling, pause,
seek, song-change, manual sync, report and artwork/lyrics logic remain in the application.

Lyrics/artwork still use the original LRCLIB and iTunes clients and require the Store's internet path.
Offline tests replace those clients with inert fixtures and do not verify those services or actual
CarPlay/Bluetooth providers. ID8 touch rectangles use the renderer's local application area rather
than the original fixed ID7 screen coordinates.

## Who it's for

Apple Music listeners. G's Music shows synced lyrics, but it plays through Spotify's Web API and needs
Spotify Premium. Apple offers no API for another device to read or control what an iPhone is playing.
Car Lyrics takes the track from the head unit instead: the car already receives the title, artist and
time in the song from CarPlay to show them in its own media screens.

## What it does

- **Full screen, drawn like Apple Music on a Mac:** two blurred layers of the album art flowing behind
  the page, the cover with the title, artist and a progress line centred on the left, and the lyrics on
  the right in big bold type (Inter Display, the open look-alike of Apple's SF Pro). The line being sung
  is full white; the lines to come show at 40 % and the ones sung at 25 %, softly blurred, more the
  further they are. The lyrics glide up line by line, and instrumental breaks show three dots that fill
  up until the next line.
- **Timing from the car:** CarPlay sends the time in the song about once a second. The app runs its own
  clock between those updates, so the lyrics move smoothly, and it stops when you pause. Skips, seeks
  and new songs are picked up on their own.
- **Album art:** from Apple's iTunes Search API, the same artwork Apple Music shows (the car doesn't pass
  CarPlay's artwork on to apps).
- **Lyrics:** from [LRCLIB](https://lrclib.net), a free, open database of synced lyrics.
- **Lyrics timing** (Settings): moves the lyrics up to 3 s earlier or later.
- **Song just started:** only for a source that sends no time (some Bluetooth players). Tap it when the
  song starts to sync the lyrics.

Needs internet through the Store's uplink (Wi-Fi or a phone hotspot), for the lyrics and the artwork.
Full screen needs the GPU renderer that G's Dash and G's Music use. Without it, the page shows in the
standard frame with the HMI's buttons.

## Screens

Screens rendered on a PC from the app's own drawing code with made-up data (`tools/screens.js`), not photos of a car.

### Lyrics

![Lyrics](../../docs/screenshots/aref_carlyrics/lyrics.png)

The song, its cover and its lyrics here are made up.

### Probe

![Probe](../../docs/screenshots/aref_carlyrics/probe.png)

The **Probe** tab: every value the car sends from the CarPlay and media interfaces.

### Home-screen widget (ID7 target only)

![Home-screen widget](../../docs/screenshots/aref_carlyrics/widget.png)

Add it to the iDrive home screen like BMW's own widgets: the song and the lyric line playing, with a progress bar. The small size shows the same as two lines of text.

## The probe

The track comes from BMW's `MediaPlayer` interface (CarPlay is its instance `CarPlayMedia`):
`currentItemMetadata` for the title, artist and album, `currentItemTime` for the time in the song, and
`playerState` for play and pause. The app also subscribes to every field of `CarPlayManager`,
`HmiMediaState` and `DynamicMediaPlayer`, for other sources. The **Probe** screen has three pages:

- **Values the car sends:** every field and its latest value.
- **Media interfaces in the catalog:** interfaces in the unit's SOME/IP catalog whose definitions name a
  title, an artist or now-playing data.
- **Subscriptions:** which interfaces answered.

**Save report** writes all of it to `carlyrics-probe.txt` in the app's data folder; it is also written
every minute. A report from a car playing Apple Music tells the next version exactly which field to use.

## Safety

Read-only toward the car: it subscribes to and reads fields, and never calls a method or writes a value. It
draws only on the centre screen.

## Credits

The lyrics client (`stage/lyrics.js`) and the artwork resampling are from nickgcode's G's Music (MIT).
The JPEG decoder (`vendor/jpeg_decoder.js`) is jpeg-js (BSD-3-Clause) with pdf.js's decoder core
(Apache 2.0), as vendored in G's Music. The fonts in `data/fonts/` are baked from
[Inter](https://github.com/rsms/inter) (SIL Open Font License 1.1, `data/fonts/LICENSE-Inter.txt`) by
`tools/bake_fonts.py`. See `LICENSE`.
