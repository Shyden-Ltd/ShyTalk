#!/usr/bin/env bash
# lib.sh — shared helpers for the ShyTalk gauntlet scripts. Source it, don't run it.
#
# Central knobs (all optional):
#   SHYTALK_REPO   repo checkout (default: auto-detected from this file's location)
#   GAUNTLET_TMP   run artifacts root (default /tmp/shytalk-gauntlet)

# Scripts live at express-api/scripts/gauntlet/ → repo root is three dirs up.
REPO="${SHYTALK_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
GAUNTLET_TMP="${GAUNTLET_TMP:-/tmp/shytalk-gauntlet}"

# TCP ports the local stack owns (same list as local/start.sh step 0).
# 4000 emulator-UI · 8080 Firestore · 9000 RTDB · 9099 Auth · 3000 Express
# 7880 LiveKit · 9002 MinIO · 8025 Mailpit · 8888 static web
# shellcheck disable=SC2034  # consumed by the sourcing scripts (10/90)
STACK_TCP_PORTS=(4000 8080 9000 9099 3000 7880 9002 8025 8888)
# shellcheck disable=SC2034  # consumed by the sourcing scripts (40/90)
APPIUM_PORT=4723

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  WARN\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m  FAIL %s\033[0m\n' "$*" >&2; exit 1; }

# wait_http <url> <timeout_s> <label> — poll until 2xx/3xx or timeout.
wait_http() {
  local url="$1" timeout="${2:-60}" label="${3:-$1}" i
  for i in $(seq 1 "$timeout"); do
    if curl -fs -m 2 -o /dev/null "$url" 2>/dev/null; then
      ok "$label ready (${i}s)"
      return 0
    fi
    sleep 1
  done
  return 1
}

# port_pids <tcp_port> — PIDs listening on the port (empty if free).
port_pids() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u | tr '\n' ' '; }

# kill_port <tcp_port> <label> — kill listeners BY PORT (never pkill -f),
# escalate to -9, verify freed. No-op when the port is already free.
kill_port() {
  local port="$1" label="${2:-port $1}" pids
  pids="$(port_pids "$port")"
  [ -z "${pids// /}" ] && return 0
  warn "stale ${label} listener(s) on :$port (pid ${pids}) — killing"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  pids="$(port_pids "$port")"
  if [ -n "${pids// /}" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
  [ -z "$(port_pids "$port" | tr -d ' ')" ] || die "could not free :$port (${label})"
  ok "freed :$port (${label})"
}

require_repo() { [ -d "$REPO/.git" ] || die "repo not found at $REPO (set SHYTALK_REPO)"; }

# docker_ready — true when the Docker daemon answers.
docker_ready() { docker info >/dev/null 2>&1; }

# android_serial — wireless _adb-tls-connect device first, USB fallback.
# Prints the serial; empty when nothing usable. Never picks 'unauthorized'.
android_serial() {
  adb devices 2>/dev/null | awk '
    /_adb-tls-connect/ && $2=="device" { print $1; exit }
  ' | head -1
}
android_serial_any() {
  local s
  s="$(android_serial)"
  [ -n "$s" ] && { echo "$s"; return; }
  adb devices 2>/dev/null | awk 'NR>1 && $2=="device" { print $1; exit }'
}
