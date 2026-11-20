# idrive7-apps

Apps for BMW head units with **iDrive 7** (MGU), installed from the car through
[robertnisipeanu/mgu-store](https://github.com/robertnisipeanu/mgu-store).

| App | What it does |
|---|---|
| [IPTV](apps/amn_iptv/README.md) | Your own Xtream Codes IPTV account's live channels on the centre screen, UHF-style: favourites, TV guide, categories, search, full-screen player. Needs the **IPTV service** (same source). Your login stays on your car. |
| [HUD](apps/amn_hudlyrics/README.md) | Synced lyrics for the song playing over CarPlay, one line at a time in the head-up display (experimental, off until switched on), and a Now Playing page on the centre screen. In Sport a rev tach replaces the lyrics (Redline's Ramp layout, after the G80 M3 / M4), back to the lyrics in Comfort, Eco Pro and Adaptive. |
| [Side View](apps/amn_sideview/README.md) | The camera on the side you signal, on the instrument cluster: left signal, the left camera; right signal, the right camera; hazards, nothing. Turn signals read from the car's light module. Needs the 360 cameras (Surround View) and the **Cluster renderer** and **Side View camera** tools (the camera tool is Robert Nisipeanu's waze-on-cluster, GPL, with Side View's settings). |

## Install

1. In the Store: **Settings > Add source**, type `M850i-amn/idrive7-apps`, pick **Branch main**.
2. Pick **HUD** and tap **Install**. The head unit builds it from this repository.
3. Restart the head unit once (Store **Settings > Restart head unit**).

Needs root access, mgu-store, the Store's **Cluster renderer** tool for the HUD, and internet through the Store's uplink for the lyrics.

## Safety

HUD: 
Read-only toward the car: it subscribes to and reads signals, and never writes, codes, clears or controls
anything. One internet host: `lrclib.net`. No accounts, analytics or crash-report uploads.

IPTV: talks only to the IPTV provider you sign in to, through the IPTV service. The service runs as root (it plays video and opens
the sign-in page on the car Wi-Fi for 10 minutes); its internet goes through mgu-uplink as its own uid. The app calls the
audio manager to put the TV sound on the speakers, and nothing else in the car.

## Credits

See [NOTICE.md](NOTICE.md). Built on arefahmad, nickgcode, cauliflowermossgrape and robertnisipeanu's work (MIT).

Unofficial. Not made, endorsed or supported by BMW. Use at your own risk.
