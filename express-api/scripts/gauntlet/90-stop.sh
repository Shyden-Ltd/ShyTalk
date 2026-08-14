#!/usr/bin/env bash
# 90-stop.sh — full teardown of everything the gauntlet starts.
#
# Order: canonical local/stop.sh first (compose down + its own children),
# then a kill-BY-PORT sweep for orphans (never pkill -f — that pattern has
# killed our own waiters before), then gradle daemons. Verifies every port
# actually freed.
set -uo pipefail
source "$(dirname "$0")/lib.sh"
require_repo

log "running canonical local/stop.sh…"
(cd "$REPO" && bash local/stop.sh) >/dev/null 2>&1 || warn "local/stop.sh exited non-zero (continuing with port sweep)"

log "sweeping remaining listeners (stack ports + Appium)…"
for p in "${STACK_TCP_PORTS[@]}" "$APPIUM_PORT"; do
  kill_port "$p" "teardown"
done

# compose down again in case stop.sh aborted before reaching it (idempotent)
docker_ready && (cd "$REPO" && docker compose -f local/docker-compose.yml down >/dev/null 2>&1) || true

log "stopping gradle daemons…"
(cd "$REPO" && ./gradlew --stop >/dev/null 2>&1) || true

RESIDUE=0
for p in "${STACK_TCP_PORTS[@]}" "$APPIUM_PORT"; do
  PIDS="$(port_pids "$p" | tr -d ' ')"
  [ -n "$PIDS" ] && { warn "port :$p still occupied (pid $PIDS)"; RESIDUE=1; }
done
if [ "$RESIDUE" = "0" ]; then ok "all gauntlet ports free"; else die "residue remains — inspect with lsof"; fi

log "teardown complete"
