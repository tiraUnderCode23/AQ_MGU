# Light Logger: find what switches the seat logos off, and keep them on

An iDrive 8 app for the illuminated logos in the seats (G87 M2 headrests), which go dark once the car is started.
It watches the car's interior lights and logs every change next to the engine and the car's speed, so you can
find the body controller lamp output that switches the logos. Then **Keep on** can hold that output on while the
car is on. Everything is read only except Keep on, which is off until you switch it on.

> **⚠️ Experimental: not yet tested on a car.** It follows the documented MGU Store format and reads the light
> modules the way the MIT-licensed [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) kit's Ambient
> config app does (tested there on a G20). It passes desktop tests against stand-ins for BMW's SDK, but hasn't run on
> a G87 yet. **The seat logos may not be on these buses at all.** Whether they are is what the log is for.

![Light Logger screen](design/app_preview.png)

## What it does

- Every 4 s it reads, through the head unit's own diagnostic link (`InternalTasu`):
  - both LIN buses of the body controller (BDC, `22 DA5F` and `22 E3D1`): every **RGB ambient light module**, each
    with its place, colour, brightness and faults;
  - the BDC's **lamp outputs** (`22 E3B9`, or `22 4500` on older BDCs): one value per switched light output, the
    lights that aren't RGB modules. No public table says which output is which, so they're numbered;
  - any value you pinned from the finder.
- It follows the engine (`CDS.statusEngineSpeed2`) and the car's speed (`Vehicle2.statusCarSpeed2`).
- Each change becomes an event: a module found, switched **ON** or **OFF**, dimmed or recoloured, or gone; the
  engine running or off; the car moving or standing still. Lights in or on a seat (driver / passenger seat back,
  and the second row's) are marked **SEAT** (`>>` on the screen).
- **Mark this moment**: press it the second you see the logo go dark. A MARK line lands in the log, so you can
  line it up with what the car did.
- **Only the seat lights on screen.** Of all the modules, it shows only the ones that may be the logos, each with
  why:

  | Tag | Why it's shown |
  |---|---|
  | **PINNED** | you pinned it as a logo (tap **Pin**; kept across restarts) |
  | **SEAT** | its location is a seat in the BDC_G05 table (driver / passenger seat back, second row) |
  | **CHANGED AT MARK** | it switched on or off, or changed, from 25 s before a mark to 15 s after it |
  | **UNKNOWN CODE** | the table doesn't know its location. The G87's logos may be one of these |

  The log beside them shows only those lights' events, the car's and your marks. **All** shows every module, and
  the text file keeps everything.
- **It starts with the head unit**, so the welcome light at unlocking is logged before you open the app.
- **Find**: when the logos aren't among those lights (they may hang off a seat module, or a BDC output with no
  number here), the finder looks through **every value** the body controller and the seat modules (`0x6D`–`0x6F`)
  report:
  1. **Learn** (once, car on): asks each unit for every identifier in `4000–4FFF` and `D000–EFFF`, eight a request,
     and keeps the ones it answers, with their lengths. A few minutes a unit; it resumes where it stopped.
  2. **Logos ON**: a snapshot of every learned value while the logos glow.
  3. **Logos OFF**: another once they're dark.
  4. The values that are the same in every ON snapshot, the same in every OFF one, and different between the two
     are listed, seat modules first. Starting the engine changes lots of values, so take **two of each**: anything
     that moves on its own drops out. **Pin** the likeliest: from then on it's read every round and its changes are
     in the seat light log, like a light.

  The candidates also go to `lightlog.txt`. What's learned and the snapshots are kept in `lightlog-find.json`.

### The screen

With MGU Store's **Renderer** (`mgu-render`) installed, the app draws its own screen (above): the seat lights on
the left (**Seat**, **All** or **Find**), the seat light log on the right, **Read now** and **Mark this moment** at
the top. Touch works, and the controller moves between the buttons. Without the Renderer it shows the head unit's
plain list. **Show** steps through *Seat lights now*, *Seat light log*, *All lights now* and *Finder*, and the
three Finder rows do the finder's steps.

**Read only, except Keep on.** Logging and the finder send nothing but `ReadDataByIdentifier` (22). `uds.js`
refuses anything else before it reaches the car, and the tests check that no module but `uds.js` builds requests.

## Keep on

Once you've found the logos' **lamp output** (on the G87 tested so far: **lamp output 45**), pin it under **All**.
The **Keep on** panel at the bottom of **Seat** then offers:

- **Test 10 s**: asks the body controller to hold that output on for 10 seconds, then hands it back. Press it with
  the logos dark (engine running): they should light for 10 s. The first time, it also finds the **record layout**
  your body controller takes (see below). The panel and the log (`KEEP` lines) say what it tried and what the body
  controller answered.
- **Keep on: ON / OFF**: with it ON, the output is held on from the engine's first start until the engine has been
  off for 2 minutes (so auto start-stop at the lights doesn't drop it), every drive. Your choice is kept.

How, the way the MIT-licensed idrive7-apps kit drives these outputs:

| Step | Request |
|---|---|
| the body controller's extended diagnostic session | `10 03` |
| hold the output on | `2F E3B5 <layout, on>` (`2F 4501 …` on older body controllers) |
| keep the session, every 2 s | `3E 00` |
| hand it back, then the default session | `2F E3B5 <layout, back>`, `10 01` |

The kit's layout is `03 <element> 01` (back: `00 <element> 00`). The G87 answered that with **"bad length"**
(NRC 13), so Test tries these in turn, for the pinned output only, and keeps the first that works:

| Layout | On | Back |
|---|---|---|
| 1, the kit's | `03 2C 01` | `00 2C 00` |
| 2, a 2-byte element | `03 00 2C 01` | `00 00 2C 00` |
| 3, a trailing byte | `03 2C 01 00` | `00 2C 00 00` |
| 4, a 2-byte state | `03 2C 00 01` | `00 2C 00 00` |

(shown for output 45, element `0x2C`). It only tests with the output reading OFF. A refusal that means "not this
layout" (bad length, out of range, sub-function not supported) moves on to the next. Any other refusal stops it. A
layout counts only if the body controller takes it **and** the output then reads ON **and** no other output
switched on. If another one did, everything is handed back and it stops. The layout found is saved, and Keep on
holds only with a layout Test found.

The element is the output number minus one: **output 45 is element 44 (`0x2C`)**. The control identifier
follows the one the lamp outputs were read with (`E3B9` → `E3B5`, `4500` → `4501`).

`uds.js` allows exactly these requests, to the body controller only, and for the one output you pinned only;
anything else is refused before it reaches the car (the tests try writes, routines, resets, other outputs and
other units).

What happens when:

| Situation | What the app does |
|---|---|
| the output reads OFF twice while held | asks again (at most every 10 s) |
| the session is lost (tester present refused) | opens it and asks again |
| 5 refusals in a row | gives up and says so; switch Keep on off and on to try again |
| Keep on is ON but no layout found yet | holds nothing, and asks for Test 10 s |
| engine off for 2 minutes, Keep on switched off, the app stopping | hands the output back and leaves the session |
| the app crashes or the head unit stops | nothing is sent any more: the body controller ends the session after a few seconds and takes the output back by itself |

> **⚠️ Untested on a car.** The body controller stays in a diagnostic session for the whole drive, which the kit only
> ever does for seconds. It may refuse it, drop it, or log a fault; if anything behaves oddly, switch Keep on off.
> If another lamp shares the output, it stays on too. Don't use a diagnostic tool on the car while Keep on holds.

## Install (MGU Store)

1. In MGU Store, **Settings → Add source**, enter `grabandrey/idrive-apps`, branch `main` (skip if already added).
2. Install **Light Logger** (`ida_lightlog`). It needs nothing else.
3. Open **Light Logger** from the Apps menu. It logs while it runs.

## How to use it on the G87

1. Lock the car, wait a minute, unlock it and get in. Open Light Logger before you start the engine. The seat
   logos should be lit (welcome light).
2. Look at **Seat lights**. If it says *No seat light so far*, no module has a seat location or an unknown code:
   the G87 may give its logos a code the table names as something else, or they may not be on these buses.
3. Start the engine, and drive off if that's when the logos go dark. Press **Mark this moment** the instant they do.
4. Any light that changed around the mark now shows as **CHANGED AT MARK**. If it's the logo, **Pin** it: from then
   on it's always listed first and its changes stay in the seat light log.
5. Read the seat light log around the mark: what went **OFF**, and right after what (engine running, moving, a
   number of seconds after unlocking).
6. **Nothing in Seat or All changes with the logos?** Use **Find**: Learn (car on, logos lit, a few minutes), then
   two **Logos ON** snapshots, start the engine, two **Logos OFF** snapshots. Pin what it lists and check it follows
   the logos over the next starts.

What the answer means:

| What the log shows | What it means |
|---|---|
| A `SEAT` (or `Light 0x..`) module goes OFF at the mark | The logos are BDC ambient light modules. An app could switch them on again over the same link, and that's the next step |
| A lamp output changes at the mark | The BDC switches the logos through a lamp output: pin it and use **Keep on** |
| Find lists a value that follows the logos | The unit that reports it (BDC or a seat module) knows the logos' state; pin it to confirm. Reading it doesn't switch anything, but it says where the switching happens |
| Nothing changes anywhere | The logos are switched where the head unit can't see (wired straight to a seat or another unit). Coding or wiring is the route |
| `the body controller refuses the read` / `stopped answering` | This car's BDC doesn't offer these reads (or another app holds the link). The log says which |

## Where the log goes

- On the screen: the seat lights and their events (or every module, with **All**).
- A text file, `lightlog.txt`, in the first writable folder of the app's home, its working folder and the temp
  folder. The status line shows the path. It is restarted (the old one kept as `.1`) past 1 MB.
- The app's log (`LTLG`), each line starting `LIGHT`, plus each bus's raw reply whenever it changes. Keep on's
  steps are in it too, starting `KEEP`.

## Good to know

- Don't run it together with an ambient light app that writes these modules (Ambient config, IterioDev's
  Comfort). The diagnostic link takes one request at a time, and their colours would show up as changes here.
- The BDC answers each read after a second or two (`7F 22 78`, then the reply), so a change shows up within about
  5–10 s, not instantly.
- The location names come from the BDC_G05 description through the idrive7-apps kit. The G87's may differ.

## Package layout

```
app/                         the app (source package, id ida_lightlog, built on the head unit)
  mgu-app.json               id, version, modules, the oap-sdk modules it uses
  src/ida_lightlog.js        the app: polling, the screen, the log
  src/uds.js                 the diagnostic link (read only)
  src/lin.js                 the BDC's light module records -> modules
  src/lamps.js               the BDC's lamp outputs, and pinned values, as modules
  src/finder.js              learn the units' values, snapshots ON / OFF, the values that follow the logos
  src/keeper.js              keep on: holds the pinned lamp output on through the body controller
  src/journal.js             reads and car data -> events
  src/screen_model.js        what the screen shows: the seat lights, their log, the plain list's rows
  src/ui.js, src/ui_font.js  the drawn screen (draw ops for the renderer) and its glyphs (scripts/bake_font.py)
  src/gpu.js                 the connection to the head unit's renderer (mgu-render), from Vitals, with pictures (IMAGE)
  src/someip_link.js         BMW's typed SOME/IP proxies
  src/log_file.js            the text file
  package/                   the staged package tree (generated by tools/gen_package.js)
  tools/test_lightlog.js     tests: records, the read-only link, the journal, the seat filter, the screens, the manifest
  tools/preview_ui.js        writes design/app_preview.html: the drawn screen with a sample drive
design/app_preview.html      the drawn screen in a browser (add  seat | empty | all  to preview_ui.js for the others)
```

`node packages/lightlog/app/tools/gen_package.js` after changing the screen, the manifest or the version.

## Credits

The diagnostic link's request format, the BDC's light module identifiers and their location names follow the
MIT-licensed [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) kit (`kit/runtime/diag.js`,
`apps/ambient_config/lin.js`). Not affiliated with BMW. MIT licensed.
