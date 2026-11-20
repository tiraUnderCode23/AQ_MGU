# Changelog

## 0.1.26

Restore visibility when RHMI returns to the app or accepts a new tile open without intervening focus loss.

## 0.1.25

Refresh when opening a tab and move the confirmed RWD action to Drive, replacing simulation controls.

## 0.1.24

Accept a fresh explicit Park indication from Selector PT2 when the legacy signal is missing or agrees.

## 0.1.23

Keep parking brake telemetry in Diagnostics and remove it from the app-side front-drive checks.

## 0.1.22

Log HMI reopen transitions and show only Selector PT2 in Diagnostics.

## 0.1.21

Display engaged gears 1–9 in Selector PT2 diagnostics.

## 0.1.20

Show the DataPowerTrain2 selector event separately in Diagnostics.

## 0.1.19

Label vehicle signal getter results as reads. Subscription events retain their own label.

## 0.1.18

Keep delayed readback in its original view session. Cancel confirmation when the graphical screen loses interaction.

## 0.1.17

Keep complete diagnostic freshness separate from torque polling. Block repeated action while its result is being verified.

## 0.1.16

Ignition state and selector now count only if an event for them arrived within the last 10 s; the
app no longer assumes that no change event was lost. A background read of rpm, speed or parking
brake is discarded if the provider became unavailable and available again while it was in flight, or
if an event for the same signal arrived meanwhile, and its timestamp is the moment the request was
sent. npm-shrinkwrap.json carries the same version as the rest of the package.

## 0.1.15

Add an experimental "Front drive OFF" button on the Diagnostics tab. It sends the single
write `2E DB E1 00` (LMV_FUNKTION off for the current terminal-15 cycle) to the DSC at 0x29,
retrying once after `10 03` if the DSC asks for the extended session. Only on DSC 0F2510 with
LMV 0F29E0, with ignition state 7, engine speed fresh and below 50 rpm, selector in P, parking
brake applied and speed zero, and only after a second confirming press in the same visit of the
app. Engine speed, speed and parking brake must have been received within 2.5 s (they are re-read
once a second); ignition state and selector are change-driven. The conditions are checked again
before the extended session request and before the repeated write. The result line only reports
what the LMV says (DB32 qualifier 0xE8); it is not a torque measurement, and the return of
all-wheel drive after an ignition cycle is not checked by the app. There is no "on" command.
The transport accepts nothing else beyond the existing reads.

## 0.1.13

Add an isolated AWD/RWD simulator switch to the graphical Drive tab.

## 0.1.12

Use a black background and refresh front axle torque on Drive.

## 0.1.11

Reopen the graphical layer on an explicit tile press and limit the live transport to reads.

## 0.1.10

Add graphical Drive and Diagnostics screens and an isolated simulation tab.

## 0.1.9

Open the tile after setup if pressed while the app was starting.

## 0.1.8

Refresh diagnostic data after reopening the app while a previous read is still in progress.

## 0.1.7

Show the author credit as secondary text at the end of both tabs.

## 0.1.6

Put Drive and Diagnostics on a single screen with tab buttons and a shared refresh action.

## 0.1.5

Keep valid signal readings if availability monitoring fails. Ignore events
while the provider reports that it is unavailable.

## 0.1.4

Show Vehicle Signals directly in Diagnostics, without a separate screen.

## 0.1.3

Add a read-only Vehicle Signals page with raw values and update ages.

## 0.1.2

Wait for the TASU SOME/IP provider before sending diagnostic reads.

## 0.1.1

Show the diagnostic read status on both screens, bound TASU setup waits and
keep completed reads visible if a later request fails.

## 0.1.0

Add xDriveRemover with English Drive and Diagnostics screens for iDrive 7 and iDrive 8.
