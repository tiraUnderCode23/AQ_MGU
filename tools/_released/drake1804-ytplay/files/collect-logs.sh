#!/bin/sh
# Everything needed to see why the YouTube app did not work on a car, in one file to send.
#
#   ssh root@<unit> sh /var/opt/drake1804-ytplay/current/collect-logs.sh "what you saw, and about when" > bube-logs.tgz
#
# On a terminal it writes to /tmp and says where. Sends nothing anywhere: the file is yours to pass on or not.
#
# It only reads. It leaves out the signed-in account's tokens (it never opens the player's state folder), and takes signed links, phone addresses, VIN-shaped words and what yt-dlp quotes of a cookie file out of the logs. Firmware-derived text
# is still in there, so keep it private, and out of the repository.
#
#   --no-probe    leave out the snapshot of how sound moves (tools/audio-research/probe.sh), which takes about 20 seconds

R=${COLLECT_ROOT:-} # tests only: a fake tree. Empty on the car.
TOOL=$R/var/opt/drake1804-ytplay
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
UNITS='drake1804-ytplay mgu-render mgu-uplink mgu-render-hmi mgu-updater carplay avbstreamhandler avbsourcesinkcontroller mediaengine mediaapp'
APP_RE='drake1804|youtube|ytplay|ytaudio|mainapp|oapcontroller'
MAX=2097152

PROBE=yes
NOTE=
for a in "$@"; do
  case "$a" in
    --no-probe) PROBE=no ;;
    *) NOTE="$NOTE$a " ;;
  esac
done

say() { echo "collect-logs: $*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }
cap() { head -c "$MAX" 2>/dev/null || cat; }

redact() {
  sed -e 's/skipping cookie file entry.*/skipping cookie file entry <removed>/' \
    -e 's/invalid Netscape format cookies file.*/invalid Netscape format cookies file <removed>/' \
    -e 's#\(https\{0,1\}://[^/ "'"'"']*\)[^ "'"'"']*#\1/...#g' \
    -e 's/\([0-9A-Fa-f]\{2\}[:-]\)\{5\}[0-9A-Fa-f]\{2\}/<mac>/g' \
    -e 's/[A-HJ-NPR-Z0-9]\{17\}/<17-chars>/g' \
    -e 's/\(token"\{0,1\}[:=] *"\{0,1\}\)[^", ]*/\1<removed>/g'
}

# A file's end, cleaned, if there is one.
copy() {
  [ -f "$1" ] && [ -r "$1" ] || return 0
  { tail -c "$MAX" "$1"; } 2>/dev/null | redact > "$2"
}

TO=
if have timeout; then
  if timeout 5 true 2>/dev/null; then
    TO='timeout 60'
  elif timeout -t 5 true 2>/dev/null; then
    TO='timeout -t 60'
  fi
fi

STAMP=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo now)
BASE=${TMPDIR:-/tmp}
WORK=$BASE/bube-logs-$STAMP-$$
DIR=$WORK/bube-logs-$STAMP
umask 077
mkdir -p "$DIR/player" "$DIR/app" "$DIR/journal" "$DIR/audio" || {
  say "cannot write in $BASE"
  exit 1
}
trap 'rm -rf "$WORK"' EXIT

echo "${NOTE:-no note given}" > "$DIR/note.txt"

say 'the unit'
{
  echo "=== date"; date
  echo "=== uptime"; { cat "$R/proc/uptime"; } 2>/dev/null
  echo "=== uname"; uname -a
  echo "=== uid"; id -u
  echo "=== os-release"; { cat "$R/etc/os-release"; } 2>/dev/null
  echo "=== memory"; { head -n 5 "$R/proc/meminfo"; } 2>/dev/null
  echo "=== disk"; df -k /var/opt /tmp 2>&1
  echo "=== temperature"; { cat "$R"/sys/class/thermal/thermal_zone*/temp; } 2>/dev/null
  echo "=== load"; { cat "$R/proc/loadavg"; } 2>/dev/null
  echo "=== mgu-deploy status"
  if have mgu-deploy; then
    # shellcheck disable=SC2086 # $TO is a command and its arguments
    $TO mgu-deploy status --json 2>&1
  else
    echo 'not on the PATH'
  fi
} 2>&1 | redact > "$DIR/meta.txt"

say 'the player'
copy "$TOOL/log/ytplay.log" "$DIR/player/ytplay.log"
copy "$TOOL/log/ytplay.log.1" "$DIR/player/ytplay.log.1"
copy "$TOOL/log/ytaudio.log" "$DIR/player/ytaudio.log"
copy "$TOOL/log/logship.status" "$DIR/player/logship.status"
copy "$TOOL/current/component.json" "$DIR/player/component.json"
{ ls -la "$TOOL" "$TOOL/current" "$TOOL/log"; } > "$DIR/player/files.txt" 2>&1
# What the player says right now, on its own socket. Only `status`, which changes nothing.
if have node; then
  # shellcheck disable=SC2086
  $TO node -e '
    var s = require("net").connect(process.argv[1]), b = "";
    s.setTimeout(3000, function () { console.log("no answer"); process.exit(0); });
    s.on("connect", function () { s.write("status\n"); });
    s.on("data", function (d) { b += d; if (b.indexOf("\n") >= 0) { process.stdout.write(b); process.exit(0); } });
    s.on("error", function (e) { console.log("not reachable: " + e.message); process.exit(0); });
  ' "$R/run/drake1804-ytplay/ctl.sock" 2>&1 | redact > "$DIR/player/status.txt"
fi
for d in "$R"/proc/[0-9]*; do
  [ -f "$d/comm" ] || continue
  c=
  { read -r c < "$d/comm"; } 2>/dev/null
  case "$c" in
    ytplay | ytaudio | ffmpeg | qjs | mgu-render | carplay | mediaengine | mediaapp | avbstreamhandle* | avbsourcesinkco*)
      echo "${d##*/} $c $({ tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null | cut -c1-200)"
      { grep -E '^(Uid|Groups|VmRSS):' "$d/status"; } 2>/dev/null | tr '\n' ' '
      echo
      ;;
  esac
done 2>&1 | redact > "$DIR/player/processes.txt"

say 'the app'
for f in "$R"/var/opt/public/oap/oap_*/data/app.log "$R"/var/opt/public/oap/oap_*/data/app.log.1; do
  [ -f "$f" ] && copy "$f" "$DIR/app/${f##*/}"
done

say 'the journal'
if have journalctl; then
  for u in $UNITS; do
    # shellcheck disable=SC2086
    $TO journalctl -b --no-pager -o short-monotonic -n 2000 -u "$u.service" 2>&1 | redact | cap > "$DIR/journal/$u.txt"
  done
  # shellcheck disable=SC2086
  $TO journalctl -b --no-pager -o short-monotonic -n 40000 2>&1 | grep -iE "$APP_RE" | tail -n 3000 | redact | cap > "$DIR/journal/app-lines.txt"
  # shellcheck disable=SC2086
  $TO journalctl -b --no-pager -o short-monotonic -p err -n 1500 2>&1 | redact | cap > "$DIR/journal/errors.txt"
  # If the unit restarted, why is at the end of the boot before this one, when the journal keeps that.
  # shellcheck disable=SC2086
  $TO journalctl -b -1 --no-pager -o short-monotonic -n 1500 2>&1 | redact | cap > "$DIR/journal/previous-boot.txt"
  # shellcheck disable=SC2086
  $TO journalctl --list-boots --no-pager 2>&1 | tail -n 20 | redact > "$DIR/journal/boots.txt"
else
  echo 'no journalctl' > "$DIR/journal/none.txt"
fi

say 'sound'
{
  for dir in /run/smartx /dev/shm /dev/snd; do
    echo "=== ls -la $dir"
    ls -la "$R$dir" 2>&1
  done
  echo "=== /proc/asound/cards"
  { cat "$R/proc/asound/cards"; } 2>/dev/null
} > "$DIR/audio/listing.txt" 2>&1
if [ -x "$TOOL/current/ytaudio" ]; then
  # shellcheck disable=SC2086
  YTAUDIO_LOG=/dev/null $TO "$TOOL/current/ytaudio" list > "$DIR/audio/devices.txt" 2>&1
fi
[ -f "$TOOL/state/audio-device" ] && { head -c 200 "$TOOL/state/audio-device"; } > "$DIR/audio/saved-device.txt" 2>/dev/null

if [ "$PROBE" = yes ]; then
  PROBE_SH=
  for p in "$HERE/probe.sh" "$TOOL/current/probe.sh"; do
    [ -f "$p" ] && PROBE_SH=$p && break
  done
  if [ -n "$PROBE_SH" ]; then
    say 'how sound moves (about 20 seconds)'
    PROBE_ROOT=$R sh "$PROBE_SH" -s 3 -o "$DIR/probe" now > "$DIR/audio/probe-output.txt" 2>&1 < /dev/null
  else
    echo 'probe.sh not found' > "$DIR/audio/probe-output.txt"
  fi
fi

if [ -t 1 ]; then
  OUT=$BASE/bube-logs-$STAMP.tgz
  tar czf "$OUT" -C "$WORK" "bube-logs-$STAMP" || {
    say 'tar failed'
    exit 1
  }
  say "done: $OUT"
  say "copy it with: scp root@<unit>:$OUT ."
else
  tar czf - -C "$WORK" "bube-logs-$STAMP" || {
    say 'tar failed'
    exit 1
  }
  say 'done'
fi
