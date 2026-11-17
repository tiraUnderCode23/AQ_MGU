#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Yousaf Khan
#
# The touch screen's test (test/touch_test.js) in Node 8 as on the unit, as
# root (the tool's folders are under /var/opt), in the ml-unit:18.04-node8
# image; no Chromium needed.
#   sh native/vizualyse-chromium/test/run_touch_test.sh [out dir for the PNGs]
set -eu
export MSYS_NO_PATHCONV=1
HERE=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(cd "$HERE/../.." && (pwd -W 2>/dev/null || pwd))
OUT=${1:-}
if [ -n "$OUT" ]; then mkdir -p "$OUT"; OUT=$(cd "$OUT" && (pwd -W 2>/dev/null || pwd)); fi
docker run --rm -v "$REPO:/w:ro" ${OUT:+-v "$OUT:/out"} ml-unit:18.04-node8 sh -c \
    "mkdir -p /x/native && cp -r /w/platform /x/ && cp -r /w/native/vizualyse-chromium /x/native/ && cd /x && node native/vizualyse-chromium/test/touch_test.js ${OUT:+/out}"
