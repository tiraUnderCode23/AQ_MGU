# amn-sideview-cam — Side View's camera

For the app **Side View**: while you signal, the left (or right) camera in the instrument cluster's centre.

- The camera unit sends its pictures as H.264 on BMW's media bus (`media_transport.avb_streaming.1`, the stream
  Drive Recorder and the parking cameras use; found on the car 16 Nov 2026).
- This tool joins that stream as one more receiver, decodes it on the GPU (Intel Media SDK) and draws it in the
  cluster's central map area through **Cluster renderer**. It shows a picture only while the camera unit sends one.
- The **Side View** app asks the camera unit for one side (ICAM2Proxy, Drive Recorder's view 3 = left, 4 = right)
  while a turn signal is on, and gives the camera back after it.

## Whose code

The program is **Robert Nisipeanu's waze-on-cluster** (`vendor/woc`, GPL-3.0-or-later, Copyright (C) 2026 Robert
Nisipeanu) with the client and kit of his **cluster-render** (`vendor/cr`, GPL-3.0-or-later / MPL-2.0 for the client
library), copied from github.com/robertnisipeanu/idrive-apps at the commit in `vendor/UPSTREAM`. One change (0.2.0, marked in each file's header): the night look in `vendor/woc/src/video_producer.cpp` (a contrast curve on the luma, the colour removed) and its control command `{"cmd":"look","on":"0"|"1"}` in `vendor/woc/src/main.cpp`. Side View
runs it with its own settings (`amn-sideview-cam.conf`): the camera stream instead of CarPlay's, no CarPlay
connection to watch, the picture down a second after the camera stops. Their licences are in `vendor/woc/LICENSE`,
`vendor/cr/LICENSE` and `vendor/cr/LICENSES`.

Built by `.github/workflows/sideview-cam.yml` (Ubuntu 18.04, the unit's glibc and libstdc++, linked against stubs of
the unit's libmfxhw64, libva and IAS AVB bridge); the binary is committed here by a commit that names the run.

License: GPL-3.0-or-later.
