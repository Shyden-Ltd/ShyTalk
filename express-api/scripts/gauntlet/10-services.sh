#!/usr/bin/env bash
# 10-services.sh — cold-boot service bring-up. Idempotent: a healthy running
# stack is left alone; a dead/partial one is swept (kill-by-port, never pkill)
# and restarted via the canonical local/start.sh (which itself starts Docker
# compose services, Firebase emulators, seeds, Express API, and the :8888
# static web server).
#
# Usage: 10-services.sh [--fresh]
#   --fresh   tear everything down first (90-stop.sh) before bringing up
#
# What this adds over bare local/start.sh (the true cold-boot gaps):
#   1. Starts the Docker DESKTOP app itself and waits for the daemon.
#   2. Sweeps stale listeners off the stack's TCP ports (a crashed previous
#      run leaves orphans; start.sh step 0 ABORTS on occupied ports).
#   3. Sweeps UDP squatters off LiveKit's 52000-52100 range (macOS ephemeral
#      range overlap — random apps squat and docker compose fails to bind).
#   4. Launches start.sh DETACHED (it idles forever in the foreground) and
#      polls every service to a named readiness verdict.
set -uo pipefail
source "$(dirname "$0")/lib.sh"
require_repo

FRESH=0
[ "${1:-}" = "--fresh" ] && FRESH=1

mkdir -p "$GAUNTLET_TMP"
STACK_LOG="$GAUNTLET_TMP/stack-$(date +%Y%m%d-%H%M%S).log"

# --- 0. optional full teardown ------------------------------------------
if [ "$FRESH" = "1" ]; then
  log "--fresh: tearing down first"
  bash "$(dirname "$0")/90-stop.sh" || true
fi

# --- 1. Docker Desktop ----------------------------------------------------
if docker_ready; then
  ok "Docker daemon already running"
else
  log "starting Docker Desktop…"
  open -a Docker || die "could not launch Docker Desktop (open -a Docker)"
  DOCKER_UP=0
  for _ in $(seq 1 120); do
    docker_ready && { DOCKER_UP=1; break; }
    sleep 2
  done
  [ "$DOCKER_UP" = "1" ] || die "Docker daemon not ready after 240s"
  ok "Docker daemon ready"
fi

# --- 2. healthy-stack short-circuit ---------------------------------------
stack_healthy() {
  curl -fs -m 2 -o /dev/null http://localhost:4000 2>/dev/null \
    && curl -fs -m 2 -o /dev/null http://localhost:8080 2>/dev/null \
    && curl -fs -m 2 -o /dev/null "http://localhost:3000/api/health" 2>/dev/null \
    && curl -fs -m 2 -o /dev/null http://localhost:8888 2>/dev/null
}
if stack_healthy && docker ps --format '{{.Names}}' 2>/dev/null | grep -q livekit; then
  log "stack already healthy — leaving it alone (use --fresh to force a restart)"
  exit 0
fi

# --- 3. stale TCP-port sweep ----------------------------------------------
log "sweeping stale listeners off stack ports (${STACK_TCP_PORTS[*]})"
for p in "${STACK_TCP_PORTS[@]}"; do
  kill_port "$p" "stack"
done

# --- 4. LiveKit UDP squatter sweep ----------------------------------------
# LiveKit's RTC range 52000-52100/udp sits INSIDE the macOS ephemeral port
# range, so any app can transiently squat it and break `docker compose up`.
SQUATTERS="$(lsof -nP -iUDP 2>/dev/null | awk '$9 ~ /:(520[0-9][0-9]|52100)$/ {print $2}' | sort -u | tr '\n' ' ')"
if [ -n "${SQUATTERS// /}" ]; then
  warn "UDP squatter(s) inside LiveKit range 52000-52100: pid ${SQUATTERS} — killing"
  # shellcheck disable=SC2086
  kill $SQUATTERS 2>/dev/null || true
  sleep 1
else
  ok "LiveKit UDP range clear"
fi

# --- 5. launch the canonical stack (detached; it never returns) -----------
log "launching local/start.sh detached → $STACK_LOG"
( cd "$REPO" && nohup bash local/start.sh >"$STACK_LOG" 2>&1 </dev/null & )

# --- 6. readiness verdicts -------------------------------------------------
log "waiting for services…"
wait_http http://localhost:4000 180 "Firebase emulator UI (:4000)" || die "emulator UI not ready — see $STACK_LOG"
wait_http http://localhost:8080 60  "Firestore emulator (:8080)"   || die "Firestore emulator not ready — see $STACK_LOG"
wait_http http://localhost:9099 60  "Auth emulator (:9099)"        || die "Auth emulator not ready — see $STACK_LOG"
wait_http "http://localhost:3000/api/health" 120 "Express API (:3000)" || die "Express API not ready — see $STACK_LOG"
wait_http http://localhost:8888 60  "static web (:8888)"           || die "static web server not ready — see $STACK_LOG"

# start.sh's cleanup() can kill Docker containers if it aborted mid-way while
# emulators survived as orphans — re-assert compose services (idempotent).
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q livekit; then
  warn "LiveKit container missing after start.sh — re-running docker compose up"
  (cd "$REPO" && docker compose -f local/docker-compose.yml up -d) || die "docker compose up failed"
fi
for svc in livekit minio mailpit; do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qi "$svc"; then
    ok "container: $svc"
  else
    warn "container '$svc' not visible (check: docker ps)"
  fi
done

log "services up. Stack log: $STACK_LOG"
