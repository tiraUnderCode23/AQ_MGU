# Car Care

Your own service intervals, tracked by the car's odometer and kept separate from BMW's Condition Based
Service (CBS) reminders.

Version 0.2.4 · AQ source adaptation for ID7 / ID8 · package `aref_carcare` · [port contract](../../README.md)

> [!NOTE]
> Not tested on a car yet. The odometer comes from the same instrument-cluster signal that
> cauliflowermossgrape's Live Data reads (`KombiIF.statusRangeTankStatus.mileageKilometre`).

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

On ID8 the odometer uses a read-only field adapter. A successful current field read/event is required;
provider loss, failed reads, invalid odometer values and more than 90 seconds without a fresh sample
leave the stored odometer labelled **last seen**. “Done today” and mileage-based “Done earlier” cannot
save using that stale value. The existing 30-second read cadence is retained. Subscriptions stop when
the app is hidden and restart on opening; shutdown cannot be undone by queued visibility events.
BMW service reminders are never written. Local maintenance records and the original unit choices,
confirmation and cancel controls remain intact.

## Who it's for

Owners who service their car more often than BMW's schedule asks, and don't want to lose what BMW
provides.

The common case: you change your own oil every 3,000 miles, but your car is also on a BMW maintenance plan
(BMW Ultimate Care, or a dealer's prepaid plan) that pays for an oil service only when CBS says it's due.
Resetting CBS after your own change would push that free service further out, or lose it. So CBS stays as
it is, and you need a second counter for your own interval. Car Care is that counter, on the car's own
screen, reading the car's own odometer.

It's also for anyone who tracks maintenance BMW's CBS doesn't show at all: spark plugs on a tuned engine,
ignition coils, differential and transfer case fluid, transmission fluid.

## What it does

- **Items:** engine oil, spark plugs, ignition coils, differential fluid, transfer case fluid,
  transmission fluid, brake fluid, engine air filter, cabin filter.
- **Intervals you set:** each item has its own interval in Settings, in miles or in months. Engine oil is
  due at 3,000 miles or 12 months by default, whichever comes first.
- **Done today:** records the current odometer reading and today's date for the selected item. Press it
  twice to confirm.
- **Done earlier:** records a service from before you installed the app, in miles and months ago.
- **At a glance:** each item shows a bar of the interval used and what is left, in amber when due soon
  (from 90 %) and red when overdue.

## Screens

Screens rendered on a PC from the app's own drawing code with made-up data (`tools/screens.js`), not photos of a car.

### Items

![Items](../../docs/screenshots/aref_carcare/items.png)

Each item, the interval used, and what is left. Due soon in amber, overdue in red.

### Done earlier

![Done earlier](../../docs/screenshots/aref_carcare/done-earlier.png)

Recording a service from before the app: miles and months ago.

### Home-screen widget (ID7 target only)

![Home-screen widget](../../docs/screenshots/aref_carcare/widget.png)

Add it to the iDrive home screen like BMW's own widgets: the item closest to due, with what is left and a bar. The small size shows the same as two lines of text.

## What it doesn't do

- It never resets, changes or reads BMW's CBS items. Your dealer's reminders stay exactly as they are.
- It doesn't send anything to the car: the only data it uses is the odometer the instrument cluster
  already sends to the head unit.

## Settings

| Setting | Values | Default |
|---|---|---|
| Units | Miles, Kilometres | Miles |
| Engine oil every | 2,000 to 10,000 mi | 3,000 mi |
| Spark plugs every | 15,000 to 60,000 mi | 30,000 mi |
| Ignition coils every | 30,000 to 100,000 mi | 60,000 mi |
| Diff fluid every | 20,000 to 60,000 mi | 50,000 mi |
| Transfer case fluid every | 20,000 to 60,000 mi | 50,000 mi |
| Transmission fluid every | 30,000 to 80,000 mi | 60,000 mi |
| Brake fluid every | 12, 24, 36 months | 24 months |
| Air filter every | 15,000 to 45,000 mi | 30,000 mi |
| Cabin filter every | 6, 12, 24 months | 12 months |

The defaults are starting points, not recommendations. Use the intervals your tuner, your oil and your
driving call for.

## Data

Kept in `carcare.json` in the app's data folder: each item's last odometer reading and date, and the last
odometer reading seen. Removing the app removes it.
