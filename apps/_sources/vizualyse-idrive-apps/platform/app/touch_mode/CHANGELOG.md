# app/touch_mode

A version is frozen once a newer one exists. A component moves to a new
one with `node platform/platform.js use app/touch_mode <version>`.

## 1.1.0

The touch screen stays while the car moves: the car starting to move no
longer closes the screen state, and the touch screen opens (entered, the
list's row, back after a pop-up) whatever the speed. `tool.moving()` is no
longer called. A tool still hides its video (a game, a stream, a web page)
while driving: that is the tool's own gate.

## 1.0.0

New: `touch_mode.js`, an iDrive app's touch screen and its list (the touch
kit's app side), grown from vizualyse_cluster's picker handling: entered,
the app opens its empty screen state and asks the tool for its touch
screen; the tool's List corner (`{"ev":"list"}`), BACK or the car starting
to move bring the page (the iDrive list) back with `closeState` (or by
opening the page); the picture hides when its state is left or covered by a
pop-up, and comes back when the pop-up gives the focus back; without a
screen state it goes over the page. `pageFront()`: the page visible and
focused. Used by vizualyse_cluster 0.3.0, vizualyse_cast 0.4.0,
vizualyse_moonlight 0.3.0, vizualyse_steam 0.2.0 and vizualyse_chromium
0.3.0.
