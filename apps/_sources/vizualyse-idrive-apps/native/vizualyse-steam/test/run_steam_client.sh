#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Yousaf Khan
#
# The Windows Steam client in the tool's Wine, off the car (test/steam_client.js
# says why and how): the head unit's root filesystem, /var/opt the Docker
# volume steam-client-varopt (a copy of the play bench's runtime, Proton and
# prefix: never the play bench's own), the internet, the GPU bench's stand-in GPU.
#   sh native/vizualyse-steam/test/run_steam_client.sh start ['C:\prog.exe args']   starts it, runs that first
#   sh native/vizualyse-steam/test/run_steam_client.sh run 'C:\prog.exe args'       another program in the same Wine
#   sh native/vizualyse-steam/test/run_steam_client.sh tap X Y | move X Y           the pointer, on the picture
#   sh native/vizualyse-steam/test/run_steam_client.sh mark TEXT                    a line in the memory log
#   sh native/vizualyse-steam/test/run_steam_client.sh freeze|thaw|kill PROG.exe    SIGSTOP / SIGCONT / SIGKILL by name
#   sh native/vizualyse-steam/test/run_steam_client.sh reclaim MB                   the client's cgroup pushed out to swap
#   sh native/vizualyse-steam/test/run_steam_client.sh mem [N]                      the memory log (its last N lines)
#   sh native/vizualyse-steam/test/run_steam_client.sh log [N] | shot FILE.png | sh [CMD...] | stop
# SC_W / SC_H: the picture's size (1280x800). GPU_BENCH / VKT: where the stand-in GPU's
# builds are (this checkout's tools/gpu-bench/build and tools/vk-trial/build by default).
set -eu
export MSYS_NO_PATHCONV=1
HERE=$(cd "$(dirname "$0")/.." && pwd)
WIN_HERE=$(cd "$HERE" && (pwd -W 2>/dev/null || pwd))
GPU_BENCH=${GPU_BENCH:-$HERE/../../tools/gpu-bench/build}
VKT=${VKT:-$HERE/../../tools/vk-trial/build}
IMG=idrive-rootfs:I_21w12.2-1-4
NAME=steam-client
VOL=${SC_VOLUME:-steam-client-varopt}
win() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }
cmd() { printf '%s\n' "$*" | docker exec -i $NAME sh -c 'cat >> /tmp/sc.cmd'; }
case "${1:-start}" in
    start)
        [ -f "$HERE/build/launch.json" ] || { echo "run_steam_client: no build/launch.json (sh build.sh, or copy another checkout's)" >&2; exit 1; }
        docker volume inspect "$VOL" >/dev/null 2>&1 || { echo "run_steam_client: no volume $VOL (a copy of steam-play-varopt's runtime, proton, prefix ...)" >&2; exit 1; }
        docker rm -f $NAME >/dev/null 2>&1 || true
        docker run -d --name $NAME --platform linux/amd64 --shm-size=2g --cap-add SYS_ADMIN --cap-add SYS_PTRACE \
            -v "$VOL:/var/opt" -v "$WIN_HERE:/t:ro" -v "$(win "$GPU_BENCH"):/g:ro" -v "$(win "$VKT"):/vkt:ro" \
            -e SC_RUN="${2:-}" ${SC_CA:+-e SC_CA="$SC_CA"} ${SC_W:+-e SC_W="$SC_W"} ${SC_H:+-e SC_H="$SC_H"} ${STEAM_WINEDEBUG:+-e STEAM_WINEDEBUG="$STEAM_WINEDEBUG"} $IMG \
            /bin/sh -c "mkdir -p /tmp /run && chmod 1777 /tmp && ulimit -c 0 && ulimit -n 524288 2>/dev/null; exec /usr/bin/node /t/test/steam_client.js /t" >/dev/null
        sleep 3
        docker logs --tail 20 $NAME 2>&1
        ;;
    run) shift; cmd "run $*" ;;
    tap) cmd "sink d $2 $3"; sleep 0.1; cmd "sink u $2 $3" ;;
    move) cmd "sink m $2 $3" ;;
    mark) shift; cmd "mark $*" ;;
    freeze|thaw|kill) cmd "$1 $2" ;;
    reclaim) cmd "reclaim $2" ;;
    mem) docker exec $NAME tail -n "${2:-20}" /tmp/sc-mem.log ;;
    log) docker logs --tail "${2:-60}" $NAME 2>&1 ;;
    shot) docker exec $NAME /usr/bin/node /t/test/play_input.js shot > "$2" ;;
    sh) shift; if [ $# -gt 0 ]; then docker exec $NAME "$@"; else docker exec -it $NAME /bin/sh; fi ;;
    stop) docker stop -t 20 $NAME >/dev/null 2>&1 || true; docker rm -f $NAME >/dev/null 2>&1 || true ;;
    *) sed -n '5,17p' "$0" >&2; exit 2 ;;
esac
