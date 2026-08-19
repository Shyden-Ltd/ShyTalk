#!/usr/bin/env bash
# adb-tap.sh — drive the Android app by testTag, for hand-verification walks.
#
# The UI-dump-then-tap dance is the same six commands every time, and getting
# it wrong quietly taps empty space, which reads as "the button does nothing"
# — the exact symptom SHY-0272 was reported as. Doing it in one place means a
# missing control is reported as a missing control.
#
# Usage:
#   scripts/dev/adb-tap.sh tap <resource-id>       tap the centre of a control
#   scripts/dev/adb-tap.sh desc <resource-id>      print its content-desc
#   scripts/dev/adb-tap.sh ids                     list every id on screen
#   scripts/dev/adb-tap.sh text                    list every visible string
#
# Env: PKG (default com.shyden.shytalk.local)

set -euo pipefail

PKG="${PKG:-com.shyden.shytalk.local}"
DUMP=/sdcard/_walk.xml

dump() {
  adb shell uiautomator dump "$DUMP" >/dev/null 2>&1 || {
    echo "ERROR: uiautomator dump failed (device asleep or app not foreground?)" >&2
    exit 2
  }
  adb shell cat "$DUMP"
}

case "${1:-}" in
  tap)
    id="${2:?resource-id required}"
    bounds=$(dump | tr '<' '\n<' | grep "resource-id=\"$id\"" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1)
    if [ -z "$bounds" ]; then
      echo "NOT-FOUND: $id" >&2
      exit 1
    fi
    read -r x1 y1 x2 y2 <<<"$(echo "$bounds" | grep -oE '[0-9]+' | tr '\n' ' ')"
    adb shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
    echo "tapped $id at $(((x1 + x2) / 2)),$(((y1 + y2) / 2))"
    ;;
  desc)
    id="${2:?resource-id required}"
    # The label usually sits on the CHILD of the tagged container, so report
    # the tagged node and the node after it.
    dump | tr '<' '\n<' | grep -A1 "resource-id=\"$id\"" | grep -oE 'content-desc="[^"]*"' | grep -v 'content-desc=""' | head -2
    ;;
  ids)
    dump | tr '<' '\n<' | grep -oE 'resource-id="[^"]+"' | sed 's/resource-id=//' | sort -u
    ;;
  text)
    dump | tr '<' '\n<' | grep -oE 'text="[^"]{1,70}"' | grep -v 'text=""' | sed 's/text=//' | sort -u
    ;;
  *)
    grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -18
    exit 2
    ;;
esac
