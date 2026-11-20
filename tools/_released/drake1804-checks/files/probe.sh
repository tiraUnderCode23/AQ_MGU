#!/bin/sh
# Read-only snapshot of how sound moves on an MGU head unit, for docs/AUDIO_CARPLAY.md.
#
#   sh probe.sh idle       nothing playing
#   sh probe.sh playing    CarPlay playing music
#   sh probe.sh            both, asking you to start the music in between
#
#   -o DIR   output folder, default /tmp/bube-audio-probe. Copy it back with scp -r.
#   -s N     seconds between the two counter samples of a snapshot, default 5
#
# It reads files under /proc, /sys, /etc, /lib, /usr and the journal, and lists directories.
#
# It never signals, stops or restarts anything. It never talks to systemd, D-Bus, SOME/IP or DLT. It never
# attaches to a process: no ptrace, no strace, no /proc/<pid>/mem. It opens nothing in /dev, and no FIFO or
# shared memory file: those are only listed, because reading a FIFO takes the byte its owner is waiting for.
# It never runs aplay, amixer or any other ALSA tool, which would load the plugin under test. It writes only
# inside its folder.
#
# The folder holds firmware-derived text and may name phones. Keep it private and out of this repository.

# Low priority, and if the tool exists, no core dump: a crash's dump goes to the crash handler, which restarts the
# head unit for a program it does not list, and the kernel pipes none for a limit of exactly 1 byte. A shell's
# ulimit -c counts in blocks and cannot set that.
if [ -z "${BUBE_PROBE_READY:-}" ]; then
  BUBE_PROBE_READY=1
  export BUBE_PROBE_READY
  wrap=
  if command -v prlimit >/dev/null 2>&1; then wrap='prlimit --core=1'; fi
  if command -v nice >/dev/null 2>&1; then wrap="$wrap nice -n 10"; fi
  # shellcheck disable=SC2086 # $wrap is a command and its arguments
  exec $wrap sh "$0" "$@"
fi

set -u
umask 077
LC_ALL=C
export LC_ALL

R=${PROBE_ROOT:-} # tests only: a fake tree. Empty on the car.
OUT=/tmp/bube-audio-probe
APART=5
MAX_TEXT=262144
MAX_LOG=1048576
MAX_TARGETS=40
MIN_FREE_KB=20480
MAX_CATALOG=33554432
KNOWN_CARPLAY=ddb33e33161387c6479c391684b3d019b0de54ecfcee8d6877eca94aa62f3e50

MAIN='carplay mediaengine mediaapp'
UNITS="$MAIN mediaddpserver avbstreamhandler avbsourcesinkcontroller gptp"
NAME_RE='avb|smartx|audio|alsa|pulse|sound|media|cinemo|gptp|daemon_cl|ptp4l'
MAP_RE='asound|pulse|smartx|libias|tinyalsa|cinemo|libnme|audio|ufipc|/dev/shm|/run/'
OPEN_RE='/dev/snd|smartx|igb_avb|/dev/ptp|/dev/shm|asound|ufipc|/run/.*(audio|avb|pulse)'
FILE_RE='alsa|asound|smartx|libias|ias_|avb|pulse|cinemo|libnme|audio|aplay|arecord|amixer|carplay|mediaengine|mediaapp'
UNIT_RE='carplay|mediaengine|mediaapp|mediaddp|avb|smartx|audio|alsa|sound|pulse|gptp|cinemo'
JOURNAL_RE='audio|alsa|smartx|avb|1722|cinemo|carplay|mediaengine|mediaapp|pcm|amplifier|volume'
IF_RE='audio|sound|volume|mute|mixer|speaker|amplif|chime|gong|speech|avb|media|entertainment|carplay|projection|tuner|radio'
MEMBER_RE='audio|sound|volume|mute|mixer|speaker|amplif|chime|gong|avb|carplay|playback|playfile|playurl'
STRINGS_RE='alsa|asound|smartx|snd_pcm|plughw|hw:[0-9]|avb:|media_transport|mime_type=|audio.?(sink|source|out|route|focus|render|stream|device)|pcm\.|/run/|/dev/shm'
ENV_RE='^(ALSA|LD_LIBRARY_PATH|LD_PRELOAD|IAS|AVB|SMARTX|PULSE|AUDIO|CINEMO|NME|DLT)'
GROUP_RE='audio|ias|ufipc|avb|media|carplay'
LOOKED_FOR='lsof ss netstat strace ltrace gdb fuser aplay arecord amixer alsactl pactl busctl node sha256sum diff timeout'

die() {
  echo "probe: $*" >&2
  exit 1
}

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit "$1"
}

have() { command -v "$1" >/dev/null 2>&1; }

# A head without -c fails before it reads anything, so cat still gets the whole stream.
cap() { head -c "${1:-$MAX_TEXT}" 2>/dev/null || cat; }

# Regular files only: anything else in these trees may be a FIFO or a device.
dump() {
  for f in "$@"; do
    [ -f "$f" ] && [ -r "$f" ] || continue
    echo "=== ${f#"$R"}"
    { cap < "$f"; } 2>/dev/null
    echo
  done
}

redact() {
  sed -e 's/skipping cookie file entry.*/skipping cookie file entry <removed>/' \
    -e 's/invalid Netscape format cookies file.*/invalid Netscape format cookies file <removed>/' \
    -e 's/\([0-9A-Fa-f]\{2\}[:-]\)\{5\}[0-9A-Fa-f]\{2\}/<mac>/g' \
    -e 's/[A-HJ-NPR-Z0-9]\{17\}/<17-chars>/g'
}

set_timeout() {
  TO=
  have timeout || return 0
  if timeout 5 true 2>/dev/null; then
    TO='timeout 60'
  elif timeout -t 5 true 2>/dev/null; then
    TO='timeout -t 60'
  fi
}

prepare_out() {
  if [ -e "$OUT" ] || [ -L "$OUT" ]; then
    [ -d "$OUT" ] && [ ! -L "$OUT" ] && [ -f "$OUT/.bube-audio-probe" ] ||
      die "$OUT exists and is not this probe's folder; name another with -o"
  else
    mkdir -p "$OUT" || die "cannot create $OUT"
    : > "$OUT/.bube-audio-probe" || die "cannot write in $OUT"
    echo 'Firmware-derived and may name phones. Keep it private and out of the repository.' > "$OUT/NOTICE.txt"
  fi
  free_kb=$(df -kP "$OUT" 2>/dev/null | awk 'NR == 2 { print $4 }')
  case "$free_kb" in
    '' | *[!0-9]*) ;;
    *) [ "$free_kb" -ge "$MIN_FREE_KB" ] || die "$OUT has only $free_kb KB free, needs $MIN_FREE_KB" ;;
  esac
}

list_procs() {
  for d in "$R"/proc/[0-9]*; do
    [ -d "$d" ] || continue
    p=${d##*/}
    c=
    { read -r c < "$d/comm"; } 2>/dev/null
    a=$({ tr '\0' ' ' < "$d/cmdline" | cut -c1-300; } 2>/dev/null)
    case "$a" in *probe.sh*) continue ;; esac
    u=$(awk '/^Uid:/ { print $2; exit }' "$d/status" 2>/dev/null)
    echo "$p ${u:-?} $c | $a"
  done
}

# Mapped files, not only open ones: a process may close a shared memory file after mapping it.
who_maps() {
  for d in "$R"/proc/[0-9]*; do
    p=${d##*/}
    c=
    { read -r c < "$d/comm"; } 2>/dev/null
    { grep -iE "$MAP_RE" "$d/maps"; } 2>/dev/null | awk -v p="$p" -v c="$c" 'NF >= 6 { print p, c, $6 }' | sort -u
  done
}

who_opens() {
  for d in "$R"/proc/[0-9]*; do
    p=${d##*/}
    c=
    { read -r c < "$d/comm"; } 2>/dev/null
    { ls -l "$d/fd"; } 2>/dev/null | grep -E "$OPEN_RE" | sed -n 's/.* -> //p' |
      awk -v p="$p" -v c="$c" '{ print p, c, $0 }' | sort -u
  done
}

# targets.txt: "<pid> <name>". The three named services first, so the limit cannot drop them.
select_targets() {
  m=$(echo "$MAIN" | tr ' ' '|')
  named=" ($m) \\| | \\| ([^ ]*/)?($m)( |\$)"
  {
    grep -E "$named" processes.txt
    grep -iE "$NAME_RE" processes.txt
    awk '{ print $1 }' who-maps-asound.txt | while read -r p; do
      grep -E "^$p " processes.txt
    done
  } 2>/dev/null | awk '!seen[$1]++ { n = $3; gsub(/[^A-Za-z0-9_.-]/, "_", n); print $1, n }' |
    head -n "$MAX_TARGETS" > targets.txt
  for n in $MAIN; do
    grep -qE " $n \\| | \\| ([^ ]*/)?$n( |\$)" processes.txt || echo "$n"
  done > missing.txt
}

# The lines of /proc/<pid>/net/* that name this process's sockets. Per process, as a service may have its
# own network namespace.
sockets_of() {
  d="$R/proc/$1"
  inodes=$({ ls -l "$d/fd"; } 2>/dev/null | sed -n 's/.*socket:\[\([0-9]*\)\].*/\1/p' | sort -u | tr '\n' ' ')
  [ -n "$inodes" ] || return 0
  for n in unix tcp tcp6 udp udp6 raw raw6 packet netlink; do
    [ -f "$d/net/$n" ] || continue
    { cap "$MAX_LOG" < "$d/net/$n"; } 2>/dev/null | awk -v want="$inodes" -v file="$n" '
      BEGIN { split(want, a, " "); for (i in a) w[a[i]] = 1 }
      { for (i = 1; i <= NF; i++) if ($i in w) { print file ": " $0; break } }'
  done
}

capture_proc() {
  d="$R/proc/$1"
  dir=$2
  mkdir -p "$dir"
  { tr '\0' ' ' < "$d/cmdline"; echo; } 2>/dev/null | redact > "$dir/cmdline.txt"
  for f in status maps cgroup limits; do
    [ -f "$d/$f" ] || continue
    { cap "$MAX_LOG" < "$d/$f"; } > "$dir/$f.txt" 2>/dev/null
  done
  { ls -l "$d/fd"; } > "$dir/fd.txt" 2>/dev/null
  { ls -l "$d/ns"; } > "$dir/ns.txt" 2>/dev/null
  { ls -l "$d/exe"; } > "$dir/exe.txt" 2>/dev/null
  { tr '\0' '\n' < "$d/environ" | grep -E "$ENV_RE"; } > "$dir/environ-filtered.txt" 2>/dev/null
  sockets_of "$1" > "$dir/sockets.txt"
}

capture_alsa() {
  a="$R/proc/asound"
  [ -d "$a" ] || {
    echo "no /proc/asound"
    return 0
  }
  ls -lR "$a" 2>&1
  dump "$a"/cards "$a"/devices "$a"/pcm "$a"/version "$a"/timers "$a"/modules "$a"/hwdep "$a"/card[0-9]*/id \
    "$a"/card[0-9]*/pcm*/info "$a"/card[0-9]*/pcm*/sub*/info "$a"/card[0-9]*/pcm*/sub*/status \
    "$a"/card[0-9]*/pcm*/sub*/hw_params "$a"/card[0-9]*/pcm*/sub*/sw_params
}

capture_listings() {
  for dir in /dev/snd /run/smartx /dev/shm /run; do
    echo "=== ls -la $dir"
    ls -la "$R$dir" 2>&1
  done
  echo "=== audio and AVB devices"
  ls -l "$R"/dev/igb_avb* "$R"/dev/ptp* 2>&1
  echo "=== /sys/class/sound"
  ls -l "$R/sys/class/sound" 2>&1
  echo "=== /sys/class/net"
  ls -l "$R/sys/class/net" 2>&1
}

capture_modules() {
  { grep -iE 'snd|avb|igb|audio|sound|ptp' "$R/proc/modules"; } 2>/dev/null
  dump "$R"/sys/module/igb_avb/parameters/*
}

capture_net() {
  for n in unix packet tcp tcp6 udp udp6 raw raw6 netlink igmp; do
    f="$R/proc/net/$n"
    [ -f "$f" ] || continue
    { cap "$MAX_LOG" < "$f"; } > "net-$n.txt" 2>/dev/null
  done
  # shellcheck disable=SC2086 # $TO is a command and its arguments
  if have ss; then
    { $TO ss -xanp; $TO ss -tuanp; } > ss.txt 2>&1
  fi
  # shellcheck disable=SC2086
  if have netstat; then
    $TO netstat -anp > netstat.txt 2>&1
  fi
  if have lsof; then
    while read -r p n; do
      # shellcheck disable=SC2086
      $TO lsof -n -P -p "$p" > "lsof-$n-$p.txt" 2>&1
    done < targets.txt
  fi
}

# Lines of "<kind> <pid> <process> <id> <name> <value>": bytes read and written, CPU ticks per thread, bytes
# per interface. The value's growth between two samples shows what is moving the sound.
sample() {
  while read -r p n; do
    d="$R/proc/$p"
    { awk -v p="$p" -v n="$n" '/^rchar/ { print "rchar", p, n, "-", "-", $2 } /^wchar/ { print "wchar", p, n, "-", "-", $2 }' "$d/io"; } 2>/dev/null
    { cat "$d"/task/[0-9]*/stat; } 2>/dev/null | awk -v p="$p" -v n="$n" '{
      t = $0; sub(/^[^(]*\(/, "", t); name = t; sub(/\)[^)]*$/, "", name); gsub(/ /, "_", name)
      sub(/^.*\) /, "", t); split(t, f, " ")
      print "cpu", p, n, $1, name, f[12] + f[13] }'
  done < targets.txt
  { sed -e 's/:/ /' "$R/proc/net/dev"; } 2>/dev/null | awk 'NF >= 11 && $2 ~ /^[0-9]+$/ {
    print "netrx", "-", "-", "-", $1, $2
    print "nettx", "-", "-", "-", $1, $10 }'
}

activity() {
  awk 'NR == FNR { a[$1 " " $2 " " $3 " " $4 " " $5] = $6; next }
    { k = $1 " " $2 " " $3 " " $4 " " $5; if (k in a && $6 - a[k] > 0) print $6 - a[k], k }' sample-0.txt sample-1.txt |
    sort -rn | head -n 200
}

capture_journal() {
  have journalctl || {
    echo "no journalctl" > journal-audio.txt
    return 0
  }
  for u in $UNITS; do
    # shellcheck disable=SC2086
    $TO journalctl -b --no-pager -o short-monotonic -n 1500 -u "$u.service" 2>&1 | redact | cap "$MAX_LOG" > "journal-$u.txt"
  done
  # shellcheck disable=SC2086
  $TO journalctl -b --no-pager -o short-monotonic -n 50000 2>&1 | grep -iE "$JOURNAL_RE" | tail -n 4000 | redact | cap "$MAX_LOG" > journal-audio.txt
}

summarize() {
  echo "snapshot: $1"
  echo "taken: $(date 2>/dev/null)"
  echo
  echo "--- named services not running (a different name on this firmware, or no phone connected)"
  cat missing.txt
  echo
  echo "--- processes looked at"
  cat targets.txt
  echo
  echo "--- who has audio files open"
  grep -E '/dev/snd|smartx|igb_avb|asound' who-opens.txt
  echo
  echo "--- who maps an ALSA, PulseAudio, SmartX or IAS library"
  cat who-maps-asound.txt
  echo
  echo "--- kernel ALSA streams"
  grep -E '^=== .*status|^state:|^hw_ptr' alsa-proc.txt
  echo
  echo "--- most active in the $APART seconds (growth, kind, pid, process, thread id, name)"
  head -n 40 activity.txt
}

identity() {
  dump "$R/etc/os-release" "$R/proc/version"
  echo "=== uname"
  uname -a 2>&1
  echo "=== uid"
  id -u 2>&1
  echo "=== tools on this unit (found, not run, unless named in probe.sh)"
  for t in $LOOKED_FOR; do
    if have "$t"; then echo "$t yes"; else echo "$t no"; fi
  done
  echo "=== binaries"
  ls -l "$R/usr/bin/carplay" "$R/usr/bin/mediaengine" "$R/usr/bin/mediaapp" 2>&1
  for b in carplay mediaengine mediaapp; do
    [ -f "$R/usr/bin/$b" ] || continue
    if have sha256sum; then
      sha256sum "$R/usr/bin/$b" 2>&1
    elif have node; then
      node -e 'var c=require("crypto").createHash("sha256");c.update(require("fs").readFileSync(process.argv[1]));console.log(c.digest("hex")+"  "+process.argv[1])' "$R/usr/bin/$b" 2>&1
    fi
  done > hashes.txt
  cat hashes.txt
  if grep -q "^$KNOWN_CARPLAY " hashes.txt; then
    echo "carplay is the build the public patches name (P18_23w44.2-1-3)"
  else
    echo "carplay is NOT the build the public patches name"
  fi
}

file_names() {
  for dir in /usr/lib /usr/bin /usr/sbin /lib /opt /etc /usr/share/alsa; do
    find "$R$dir" -maxdepth 4 \( -type f -o -type l \) 2>/dev/null
  done | grep -iE "$FILE_RE" | sort -u | head -n 5000
}

config_files() {
  dump "$R/etc/asound.conf" "$R/usr/share/alsa/alsa.conf" "$R"/usr/share/alsa/alsa.conf.d/* "$R"/etc/alsa/conf.d/* \
    "$R"/etc/tmpfiles.d/*smartx* "$R"/usr/lib/tmpfiles.d/*smartx* "$R"/etc/cinemo/* \
    "$R/etc/recmgr-restartlist.conf" "$R/etc/crashhandler-restartlist.conf" "$R/etc/crashhandler.ini" \
    "$R/proc/sys/kernel/core_pattern"
  echo "=== /etc/group, audio-related lines"
  { grep -iE "$GROUP_RE" "$R/etc/group"; } 2>/dev/null
}

unit_files() {
  for dir in /lib/systemd/system /usr/lib/systemd/system /etc/systemd/system /run/systemd/system; do
    find "$R$dir" -maxdepth 2 \( -type f -o -type l \) 2>/dev/null
  done | grep -iE "$UNIT_RE" | sort -u > unit-names.txt
  grep -v '\.wants/' unit-names.txt | head -n 80 | while read -r f; do dump "$f"; done > units.txt
}

# The catalog's top level is { interfaces, datatypes, instanceIDs }. The members of an interface are read by
# shape, because only "fields" is publicly documented. Without node, with another shape, or if parsing it
# would take too much of the unit's memory, only names.
catalog() {
  c="$R/etc/oap/someip/someip-interfaces.json"
  [ -f "$c" ] || {
    echo "no $c" > catalog-note.txt
    return 0
  }
  ls -l "$c" > catalog-note.txt 2>&1
  size=$(wc -c < "$c" 2>/dev/null | tr -d ' ')
  case "$size" in
    '' | *[!0-9]*) size=$MAX_CATALOG ;;
  esac
  if [ "$size" -lt "$MAX_CATALOG" ] && have node && node -e '
    var fs = require("fs"), db = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    var nameRe = new RegExp(process.argv[2], "i"), memberRe = new RegExp(process.argv[3], "i"), limit = +process.argv[4];
    if (!db.interfaces) process.exit(3);
    var dt = db.datatypes || {}, ids = db.instanceIDs || {}, names = Object.keys(db.interfaces).sort(), picked = {}, types = {};
    function members(i) {
      var out = [];
      Object.keys(i || {}).forEach(function (k) {
        var v = i[k];
        if (Array.isArray(v)) v.forEach(function (m) { if (m && m.name) out.push(m.name); });
        else if (v && typeof v === "object") out = out.concat(Object.keys(v));
      });
      return out;
    }
    function walk(o) {
      if (typeof o === "string") { if (dt[o] && !types[o]) { types[o] = dt[o]; walk(dt[o]); } }
      else if (o && typeof o === "object") Object.keys(o).forEach(function (k) { walk(o[k]); });
    }
    names.forEach(function (n) {
      var i = db.interfaces[n], hit = members(i).filter(function (m) { return memberRe.test(m); });
      if (nameRe.test(n) || hit.length) { picked[n] = { matched: nameRe.test(n) ? "name" : hit, instance: ids[n], definition: i }; walk(i); }
    });
    fs.writeFileSync("catalog-names.txt", names.join("\n") + "\n");
    var text = JSON.stringify({ interfaces: picked, datatypes: types }, null, 1);
    if (text.length > limit) text = JSON.stringify({ interfaces: picked, datatypes: "left out: over the size limit" }, null, 1);
    fs.writeFileSync("catalog-audio.json", text.slice(0, limit));
  ' "$c" "$IF_RE" "$MEMBER_RE" 8388608 2>> catalog-note.txt; then
    return 0
  fi
  echo "names only: no node, or an unknown shape" >> catalog-note.txt
  { grep -oiE "\"[^\"]*($IF_RE)[^\"]*\"" "$c"; } 2>/dev/null | sort -u | head -n 5000 > catalog-names.txt
}

# Printable runs that name an audio device or sink, as "strings | grep" would: the public patches found
# CarPlay's video sink URL the same way. Streamed, so a large library costs no memory.
binary_strings() {
  have node || {
    echo "no node" > strings-note.txt
    return 0
  }
  {
    for b in carplay mediaengine mediaapp; do
      [ -f "$R/usr/bin/$b" ] && echo "$R/usr/bin/$b"
    done
    grep -iE '(nme|smartx|ias-audio|ias-media|avb|cinemo)[^/]*\.so' file-names.txt | head -n 16
  } | while read -r f; do
    [ -f "$f" ] || continue
    node -e '
      var fs = require("fs"), f = process.argv[1], re = new RegExp(process.argv[2], "i"), left = 2000;
      var fd = fs.openSync(f, "r"), buf = Buffer.alloc(1048576), carry = "", seen = new Set(), n, total = 0;
      function take(s) { if (left > 0 && re.test(s) && !seen.has(s)) { seen.add(s); left--; console.log(s); } }
      while (total < 134217728 && (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
        total += n;
        var text = carry + buf.toString("latin1", 0, n), m, runs = /[\x20-\x7e]{6,}/g, end = 0;
        while ((m = runs.exec(text))) {
          end = m.index + m[0].length;
          if (end === text.length) { carry = m[0].slice(-65536); break; }
          take(m[0]);
        }
        if (end !== text.length) carry = "";
      }
      if (carry) take(carry);
    ' "$f" "$STRINGS_RE" > "strings-$(echo "${f##*/}" | tr -c 'A-Za-z0-9_.\n-' '_').txt" 2>&1
  done
}

capture_static() {
  s="$OUT/static"
  [ -f "$s/.done" ] && return 0
  mkdir -p "$s" || die "cannot create $s"
  (
    cd "$s" || exit 1
    echo "probe: this firmware's files, once"
    identity > identity.txt 2>&1
    file_names > file-names.txt
    config_files > config.txt
    unit_files
    catalog
    binary_strings
    : > .done
  )
}

snapshot() {
  snap="$OUT/$1"
  n=2
  while [ -e "$snap" ]; do
    snap="$OUT/$1-$n"
    n=$((n + 1))
  done
  capture_static
  mkdir -p "$snap/proc" || die "cannot create $snap"
  (
    cd "$snap" || exit 1
    echo "probe: snapshot $1"
    list_procs | redact > processes.txt
    who_maps > who-maps.txt
    who_opens > who-opens.txt
    grep -iE 'asound|pulse|smartx|libias|tinyalsa|libnme|cinemo' who-maps.txt > who-maps-asound.txt
    select_targets
    while read -r p n; do
      capture_proc "$p" "proc/$n-$p"
    done < targets.txt
    capture_alsa > alsa-proc.txt 2>&1
    capture_listings > listings.txt 2>&1
    capture_modules > modules.txt 2>&1
    capture_net
    sample > sample-0.txt 2>/dev/null
    { cat "$R/proc/interrupts"; } > interrupts-0.txt 2>/dev/null
    sleep "$APART"
    sample > sample-1.txt 2>/dev/null
    { cat "$R/proc/interrupts"; } > interrupts-1.txt 2>/dev/null
    capture_alsa > alsa-proc-1.txt 2>&1
    activity > activity.txt
    capture_journal
    summarize "$1" > summary.txt 2>&1
  )
}

compare() {
  [ -d "$OUT/idle" ] && [ -d "$OUT/playing" ] || return 0
  have diff || {
    echo "no diff on this unit; compare the two folders later" > "$OUT/compare.txt"
    return 0
  }
  for f in who-opens.txt who-maps.txt missing.txt targets.txt listings.txt modules.txt; do
    echo "=== $f: idle, then playing"
    diff "$OUT/idle/$f" "$OUT/playing/$f"
  done > "$OUT/compare.txt" 2>&1
}

MODE=
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage 0 ;;
    -o)
      [ $# -ge 2 ] || usage 1
      OUT=$2
      shift 2
      ;;
    -s)
      [ $# -ge 2 ] || usage 1
      APART=$2
      shift 2
      ;;
    -*) usage 1 ;;
    *)
      [ -z "$MODE" ] || usage 1
      MODE=$1
      shift
      ;;
  esac
done
case "$APART" in '' | *[!0-9]*) die "-s needs a number of seconds" ;; esac
case "$MODE" in *[!A-Za-z0-9_-]*) die "a snapshot's name may hold letters, digits, - and _" ;; esac

set_timeout
prepare_out
if [ -n "$MODE" ]; then
  snapshot "$MODE"
else
  snapshot idle
  echo "Start music in CarPlay, wait 20 seconds, then press Enter."
  read -r _ || die "no answer. Run: sh $0 playing"
  snapshot playing
fi
compare
echo "probe: done. Copy back: scp -r root@<unit>:$OUT <a folder outside the repository>"
