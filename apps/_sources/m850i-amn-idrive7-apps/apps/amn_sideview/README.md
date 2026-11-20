# Side View

The side you signal, on the instrument cluster.

- **Left signal:** the left side on the cluster. **Right signal:** the right side.
- **Signal off:** it goes 1.5 s later (Settings: 1 to 4 s). **Hazards:** nothing.
- Starts with the car and runs in the background. It never covers the speed, the gear or the warning lamps:
  it sits in the cluster's centre area (where the map goes), and only while a signal is on.

## 0.1: the trigger and the cluster, not the camera yet

Nobody has found where an app can read the car's camera pictures. The windshield camera's picture reaches the
head unit only on cars with Augmented View; the mirror cameras' only with Surround View, and maybe only at
parking speed. So 0.1 builds everything around the camera and shows a panel naming the side instead:

1. **Teach the turn signals once, parked.** BMW's light status has never been mapped, so the app learns it:
   both signals off, tap **Signals off**; signal left (push the stalk all the way), tap **Left is on**;
   signal right, tap **Right is on**. Each recording takes 3 seconds. It is kept across restarts.
2. **Test cluster** shows the panel on the cluster for 4 s (left, then right on the next tap).
3. **Camera check** lists the capture devices and camera processes the app can see. A photo of that page
   is the next step toward the real picture.

When a camera source is found, its picture replaces the panel in the same place, with the same rule: no
fresh picture, nothing shown. It never freezes on an old frame.

## Needs

- The **Cluster renderer** tool from the Store (the same one Waze on Cluster uses).

## Privacy and safety

Read-only toward the car: it reads `Vehicle2.statusLightStatus` and nothing else, and never calls a method
or writes a value. No internet. Its log holds the light status values while teaching, and the cluster
layer's state.
