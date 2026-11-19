# Vitals: water, oil, gearbox and tyre temperatures in the iDrive 8 cluster

A cluster widget for BMW iDrive 8, styled to match the car's own displays, installed from **MGU Store**.

![Vitals widget](tool/preview.png)

- **Water**, **engine oil** and **gearbox oil** temperature on bars of forward-slanted segments, like the
  iDrive 8 cluster's own gauges, with a blue fill. A bar turns red once its temperature passes a warning point you choose (the red tick).
- **Tyres**: the four tyres, front at the top, each coloured by its temperature (blue = cold, green = normal,
  orange = warm, red = hot), with its temperature and pressure beside it, each with its unit.
- °C / °F and bar / psi / kPa follow the car's own unit settings, or you can pick them yourself.
- **No background of its own**: everything between the bars, tyres and numbers is transparent.
- Its own **Vitals** entry in the cluster's widget menu, with no backdrop of the cluster's own behind it (no dark
  square or outline in any view, the sport view included).
- Move it up or down and make it bigger or smaller from the app.
- The **Vitals** app (Apps menu) reads the car's data and holds the settings. With MGU Store's **Renderer**
  (`mgu-render`) installed, it has its own screen: the live values and tyres on the left, the settings as tiles on
  the right, for touch or the controller. Without it, it shows the head unit's plain list.

> **⚠️ Experimental: not yet tested on a car.** The package follows the documented MGU Store and cluster-render
> formats and the car's documented data fields. Its code passes desktop tests against stand-ins for BMW's SDK
> and the renderer, and the shader compiles and renders under WebGL 1 / GLSL ES 1.00. But it hasn't run on a
> real iDrive 8 head unit yet, and MGU Store's own iDrive 8 support is also marked untested.
> Install at your own risk.

## How it fits together

```
 car (SOME/IP)          Vitals app (app/)                         widget service (tool/)                       cluster
 CDS  engine temps      -->  reads via BMW's SDK, decodes to C/bar  -->  view + text + shader               -->  cluster-render
 BasicDataSet gearbox oil
 TPMS tyre temps/pressures   settings screen (Apps menu)   <-->     /run/ida-vitals-cluster/ctl.sock            widget "Vitals"
 Vehicle  display units
```

- **The app** runs as an ordinary iDrive app with BMW's SDK, so it can read the car's data. It declares
  `CDS.statusEngineTemperature`, `BasicDataSet.basicDataSet` (gearbox oil), `TPMS.statusTyreTemperature`, `TPMS.statusTyrePressure` and
  `Vehicle.statusNewCurrentUnitsStatusExt` in its `manifest.json`, and reads them through typed proxies.
  TPMS is also read every 5 s, because some cars answer reads but never send updates.
- **The widget service** runs as a root tool without the SDK. It draws every shape on the GPU with one
  fragment shader, and draws the numbers and labels into two 8-bit textures using a baked Barlow font.
  When a value changes, only that value's small rectangle is re-uploaded.

On iDrive 8, cluster-render can't replace the whole cluster. It draws a **widget in the middle, between
BMW's own gauges**. BMW keeps drawing the speedometer, rev counter, warning lights and driver assistance.

## Install (MGU Store)

1. Install **Cluster renderer** (`cluster-render`) 0.6.9 or newer from the official `robertnisipeanu/idrive-apps` source.
2. In MGU Store, go to **Settings → Add source**, enter `grabandrey/idrive-apps`, and pick the `main` branch
   (skip this if you already added it).
3. Install **Vitals Cluster** (`ida-vitals-cluster`) and **Vitals** (`ida_vitals`). For the app's own screen, also
   install **Renderer** (`mgu-render`) from MGU Store's own source.
4. **Restart the head unit once.** cluster-render reads the Vitals widget entry only when it starts, and its
   README advises against restarting the service on its own on iDrive 8.
5. Open the **Vitals** app once, so it starts reading the car. Then pick **Vitals** in the cluster's widget menu.

Until the restart, the widget draws on cluster-render's generic `widget` entry (listed as "Cluster renderer").

**Data needs the app running.** The widget service has no access to the car's data itself. If the gauges show
dashes, open the Vitals app: its status line says whether engine, gearbox and tyre data are arriving. Engine values go
to dashes 15 s after the last update (for example, with the car off), gearbox oil after a minute. Tyre values
last 3 minutes, because the tyre sensors report slowly and, on some cars, only while driving.

**Gearbox oil** comes from `BasicDataSet.valueTemperatureTransmissionOil`, which the car sends only now and then
(on some cars only when it changes), so it stays on screen as long as the engine data is live. It shows as soon as
the first plausible value arrives. Some cars never fill it in and send one fixed number: when it hasn't moved once
while the engine oil warmed by 25 °C, the app takes it for that and shows dashes. The raw values are in the app's
log (`VTLS`, "gearbox oil raw"), and while it shows no value the app's screen says what the car sends for it
(the data set's state, how many updates came, the last raw value).

## Settings (the Vitals app)

| Row | A press… |
|---|---|
| Temperature unit | Car setting → °C → °F |
| Pressure unit | Car setting → bar → psi → kPa |
| Water warning | 95 → 130 °C in 5° steps (default 115) |
| Engine oil warning | 110 → 150 °C in 5° steps (default 135) |
| Gearbox oil warning | 100 → 140 °C in 5° steps (default 120) |
| Gauge colour | Blue → Light blue → White |
| Tyre pressures | Shown / Hidden |
| Move widget up / down (Position ▲ ▼) | 10 px a press, from 100 px higher to 200 px lower |
| Widget bigger / smaller (Size + −) | 5 % a press, 70 … 150 % (it grows downwards from its top) |
| Demo values | On / Off: a warm-up and a hot lap, to check the widget without driving |
| Reset to defaults | everything back |

Settings are stored in `/var/opt/ida-vitals-cluster/settings.json`. The file is kept over updates, can be edited by
hand, and is reloaded within 2 s. The service checks every value before using it, whoever sends it.

Logs: `journalctl -u ida-vitals-cluster` for the widget; the app logs under `VTLS`.

## Package layout

```
tool/                               the widget service (a root tool kit, id ida-vitals-cluster)
  component.json                    files, systemd unit, requirements, mguHmi ID8
  vitals.js                         the service (Node 8): settings, control socket, cluster-render layer + textures
  view.js                           settings + car data -> uniforms and text (units, warnings, staleness, demo)
  layout.js                         the geometry, shared by the shader and the text
  shader.js                         builds the GLSL ES 1.00 fragment shader from layout.js
  text.js                           text (a unit right after its number) into 8-bit textures, with per-field dirty rectangles
  font.js                           baked Barlow glyphs (generated by scripts/bake_font.py)
  ida-vitals-cluster.service        systemd unit
  cluster-render.d/vitals.conf      cluster-render drop-in: the "Vitals" widget-menu entry
  preview.png                       widget-menu picture
app/                                the Vitals app (source package, id ida_vitals, built on the head unit)
  mgu-app.json                      id, version, modules, the oap-sdk modules it uses
  src/ida_vitals.js                 the app: settings screen, car data -> widget
  src/car_data.js                   CDS / BasicDataSet / TPMS / Vehicle through typed SOME/IP proxies
  src/decode.js                     the car's raw values -> C and bar
  src/settings_model.js             the settings rows
  src/ui.js, src/ui_font.js         the app's own screen (draw ops for the renderer) and its glyphs
  src/gpu.js                        the connection to the head unit's renderer (mgu-render)
  src/ctl_client.js                 the widget service's control socket
  package/                          the staged package tree (generated by tools/gen_package.js)
  tools/test_model.js               tests: rows, the service's checks, decoding, the view
design/widget_preview.html          the widget in a browser, with the car's own code (demo data)
design/app_preview.html             the app's own screen in a browser (tools/preview_ui.js writes it)
```

## Develop

- `node scripts/test_all.js` (from the repository root): all tests.
- `node packages/vitals/app/tools/gen_package.js`: after changing the app's screen, manifest or version.
- `python scripts/bake_font.py`: after changing the font styles (needs Pillow).
- Open `design/widget_preview.html` to see the widget with demo data. Add `?still&state=warm|cold|hot|nodata`
  for fixed states, `&t=F&p=psi&accent=lightblue` for other settings, and `&bg=checker` to see the transparency.

## Credits

Built on [cluster-render](https://github.com/robertnisipeanu/idrive-apps/tree/main/native/cluster-render) and
[MGU Store](https://github.com/robertnisipeanu/mgu-store). The data fields and their scaling are as documented by the
MIT-licensed [BMW cluster themes](https://github.com/shezj/bmw-cluter-themes) kit; the gearbox oil field as the
[idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) kit reads it. Font: [Barlow](https://github.com/jpt/barlow)
(SIL OFL 1.1).

Not affiliated with BMW. No BMW artwork, fonts, logos or trademarks are used. The look is inspired by the car's own
displays, not copied from them.

MIT licensed (the fonts keep their own licence).
