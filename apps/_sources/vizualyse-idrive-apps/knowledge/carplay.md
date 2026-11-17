# CarPlay on this firmware

Measured on one unit (head unit software `I_21w12.2-1-4`, CarPlay `20.40.2`) unless a line says otherwise. Index: [index.md](index.md).

- `/usr/bin/carplay` 20.40.2 and Cinemo's `libNmeCarPlay.so` (built Aug
  2020) support **one screen only**: SETUP takes stream type 110 only, and
  none of Apple's `altScreen` / `viewAreas` / `safeArea` keys exist. There is
  no gate to flip.
- **But the second screen can be added.** Cinemo wraps Apple's own AirPlay
  receiver code (`AirPlay/320.17.6`), and a screen is a self-contained object,
  so a hook can create a second one. `hook111` (`native/hook111`, from `re/`), preloaded into the
  stock `carplay`, gets the phone to stream its cluster view as stream 111:
  Google Maps' cluster map, 1088x480 H.264 at about 16 fps, next to the main
  screen. Details: [`re/STATUS.md`](../re/STATUS.md).
- What the phone (iOS 26.7.1) needs: `enabledFeatures [altScreen]` and a
  second `/info` display record (`features=2`). Offering `viewAreas` without
  the matching records makes it refuse every session. Keyframe requests for
  111 must name the display (`forceKeyFrame {uuid}`). Answering `suggestUI`
  with a guessed `showUI` makes it give up the main screen.
- Day / night reaches CarPlay as one session command, `setNightMode
  {nightMode}` with no display (`AirPlayReceiverSessionSetNightMode`, from
  Cinemo's `SetNightMode`, which the light sensor drives). The cluster stayed
  in the mode it connected in (issue #1). hook111 0.1.6 declares the
  cluster's own `nightMode` in `/info` and repeats the command with its
  `uuid`, as luka-dev/mib2q-carplay-rgi does (untested on this car).
- The library sends one `/command` at a time: the next waits for the
  phone's answer to the last
  ([findings](../re/findings-20.40.2.md), "The scene again, and day / night").
- Swapping the 2022 `carplay` / `libNmeCarPlay` onto this firmware is
  **untested** (`carplay` loads about 90 libraries, many version-tagged to
  this firmware).
- CarPlay does negotiate `turn_by_turn`: route guidance reaches the car (the
  cluster's own direction list during navigation comes from it).
- `carplay` runs as `cia_13002`. A crash in anything preloaded into it takes
  CarPlay down; never restart it by hand, arm and reboot instead.
- Over the air: no update was offered for this unit. A dealer (ISTA) or
  BMW AOS programming would replace the debug image (and root).
- *(ref: upstream `native/waze-on-cluster/patch/PATCH.md:106-317`)* On carplay
  22.28.3 (altScreen built in) upstream patches four sites: variant 7 →
  IC_HIGH, the sink URL, a self-start (`onSuggestUi` → `requestStream`), and
  the geometry (1088x480, 138x61 mm, safe area 504x368+286+72). The stream
  arrives as RTP on AVB stream 15, captured in-process. carplay (uid 13002)
  holds TCP 6031 while alive; the phone sends keyframes only at stream start;
  Waze needs server flag 1006. Changing Central display area can freeze the
  phone's stream (like Cast's grey map).
