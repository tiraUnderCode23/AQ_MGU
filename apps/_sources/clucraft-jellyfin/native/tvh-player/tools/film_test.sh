#!/bin/sh
# Plays test films through a built tvh-player off the car (MGU_VIDEO_OFF: pictures timed and counted, sound to null),
# in ubuntu:18.04 as the unit: an MP4 with its index at the end and an MKV (H.264 + AAC, 20 s) from second 8 over
# HTTP with Range, as the IPTV service serves them, and a live MPEG-TS on stdin. Needs ffmpeg, python3 and Docker.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
t="$here/build/filmtest"; rm -rf "$t"; mkdir -p "$t"
ffmpeg -loglevel error -f lavfi -i testsrc2=size=640x360:rate=25 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 20 \
    -c:v libx264 -profile:v high -g 50 -bf 2 -c:a aac -b:a 128k "$t/end.mp4"
ffmpeg -loglevel error -i "$t/end.mp4" -c copy "$t/film.mkv"
ffmpeg -loglevel error -i "$t/end.mp4" -t 6 -c copy -f mpegts "$t/live.ts"
# HEVC (8-bit Main, as most FHD HEVC films): an MP4 with its index at the end, an MKV, a live TS
ffmpeg -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=25 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 20 \
    -c:v libx265 -x265-params log-level=error:keyint=50 -tag:v hvc1 -c:a aac -b:a 128k "$t/hevc.mp4"
ffmpeg -loglevel error -i "$t/hevc.mp4" -c copy "$t/hevc.mkv"
ffmpeg -loglevel error -i "$t/hevc.mp4" -t 6 -c copy -f mpegts "$t/hevc.ts"
python3 "$here/tools/range_server.py" "$t" 8099 & srv=$!
trap 'kill $srv 2>/dev/null' EXIT
sleep 1
play() {   # $1 name, then env assignments; stdin from $IN (or nothing)
    name=$1; shift
    docker run --rm --network host -v "$here:/w" -v "$t:/t" ubuntu:18.04 sh -c \
        "ln -sf /lib/x86_64-linux-gnu/ld-2.27.so /lib/ld-linux-x86-64.so.2 && cat ${IN:-/dev/null} | env MGU_VIDEO_OFF=1 MGU_AUDIO=null LD_LIBRARY_PATH=/w/build/stub $* timeout 60 /w/build/tvh-player" \
        > "$t/$name.out" 2> "$t/$name.err" || true
    echo "== $name"; grep -E '"ev":"(open|error|end)"' "$t/$name.out" || true; grep '"ev":"tick"' "$t/$name.out" | tail -1
}
check() {   # $1 name, $2 min duration, $3 min first pos, $4 the codec the open event must say (default h264) (a film starts on the key frame at or before its start: MKV cues may name the one before)
    python3 - "$t/$1.out" "$2" "$3" "${4:-h264}" <<'PY'
import json, sys
ev = [json.loads(l[4:]) for l in open(sys.argv[1]) if l.startswith('MGU {')]
codec = sys.argv[4] if len(sys.argv) > 4 else 'h264'
o = [e for e in ev if e['ev'] == 'open']; ticks = [e for e in ev if e['ev'] == 'tick' and e['state'] == 'playing']
end = [e for e in ev if e['ev'] == 'end']; err = [e for e in ev if e['ev'] == 'error']
fail = []
if err: fail.append('error: %s' % err[0].get('error'))
if not o: fail.append('no open')
elif o[0].get('duration', 0) < float(sys.argv[2]): fail.append('duration %s' % o[0].get('duration'))
if o and (o[0].get('video') or {}).get('codec') != codec: fail.append('codec %s' % (o[0].get('video') or {}).get('codec'))
if not ticks: fail.append('no playing tick')
elif ticks[0]['pos'] < float(sys.argv[3]): fail.append('first pos %.2f' % ticks[0]['pos'])
if not end: fail.append('no end')
elif end[0]['shown'] < 50 or end[0]['aplayed'] < 50: fail.append('shown %s aplayed %s' % (end[0]['shown'], end[0]['aplayed']))
print(sys.argv[1].rsplit('/', 1)[-1], 'FAIL: ' + '; '.join(fail) if fail else 'ok')
sys.exit(1 if fail else 0)
PY
}
rc=0
play mp4 MGU_INPUT_URL=http://127.0.0.1:8099/end.mp4 MGU_START_S=8; check mp4 19 5.5 || rc=1
play mkv MGU_INPUT_URL=http://127.0.0.1:8099/film.mkv MGU_START_S=8; check mkv 19 5.5 || rc=1
IN=/t/live.ts play live; check live 0 0 || rc=1
play hevcmp4 MGU_INPUT_URL=http://127.0.0.1:8099/hevc.mp4 MGU_START_S=8; check hevcmp4 19 5.5 hevc || rc=1
play hevcmkv MGU_INPUT_URL=http://127.0.0.1:8099/hevc.mkv MGU_START_S=8; check hevcmkv 19 5.5 hevc || rc=1
IN=/t/hevc.ts play hevclive; check hevclive 0 0 hevc || rc=1
exit $rc
