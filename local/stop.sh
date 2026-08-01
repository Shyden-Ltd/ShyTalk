#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true

# Kill Firebase emulators and Express API.
#
# TERM, THEN VERIFY, THEN KILL. This used to be four `pkill … || true` lines and
# nothing else, which meant the script printed "Local environment stopped."
# whether or not anything had stopped. A WEDGED Firestore emulator does not
# answer SIGTERM — and that is exactly when someone runs stop.sh.
#
# The consequence was expensive and silent: `stop.sh && start.sh` looked like a
# restart, start.sh found the ports still held, reused the same sick JVM, and
# the rules endpoint kept 500ing. Measured 2026-08-02: an emulator reported as
# restarted was 68 minutes old and 1.2 GB, and 160 tests failed against it while
# every diagnostic said the stack was healthy.
if command -v pkill > /dev/null 2>&1; then
  EMULATOR_PATTERNS=(
    "firebase emulators"
    "cloud-firestore-emulator"
    "cloud-datastore-emulator"
    "express-api/src/index.js"
  )

  for pattern in "${EMULATOR_PATTERNS[@]}"; do
    pkill -f "$pattern" 2>/dev/null || true
  done

  # Give a healthy process a chance to exit cleanly; a wedged one will not.
  for _ in $(seq 1 10); do
    still_running=0
    for pattern in "${EMULATOR_PATTERNS[@]}"; do
      pgrep -f "$pattern" > /dev/null 2>&1 && still_running=1
    done
    [ "$still_running" -eq 0 ] && break
    sleep 1
  done

  # Escalate to SIGKILL for whatever ignored the polite request.
  for pattern in "${EMULATOR_PATTERNS[@]}"; do
    if pgrep -f "$pattern" > /dev/null 2>&1; then
      echo "  (still running after SIGTERM, sending SIGKILL: $pattern)"
      pkill -9 -f "$pattern" 2>/dev/null || true
    fi
  done
  sleep 1

  # And SAY SO if anything survived. Reporting a stop that did not happen is
  # what made this worth fixing; exiting non-zero lets a caller chain safely.
  SURVIVORS=""
  for pattern in "${EMULATOR_PATTERNS[@]}"; do
    pids=$(pgrep -f "$pattern" 2>/dev/null | tr '\n' ' ')
    [ -n "$pids" ] && SURVIVORS="$SURVIVORS\n  $pattern -> $pids"
  done
  # PORT SWEEP as a backstop. Identity patterns miss a process started through a
  # wrapper: the local API runs via `npm run local`, whose command line does not
  # contain `express-api/src/index.js`, so it survived every pattern above and
  # then blocked start.sh's pre-flight port check — turning a restart into a
  # confusing failure. These are the stack's OWN declared ports; freeing them is
  # this script's entire job.
  for port in 3000 4000 8080 8888 9000 9099 9150; do
    holder=$(lsof -ti ":$port" 2>/dev/null | head -1)
    if [ -n "$holder" ]; then
      echo "  (freeing port $port held by PID $holder)"
      kill -9 "$holder" 2>/dev/null || true
    fi
  done

  if [ -n "$SURVIVORS" ]; then
    echo "ERROR: local/stop.sh could not stop everything. Survivors:"
    printf "%b\n" "$SURVIVORS"
    echo "The stack is NOT stopped. Do not treat a following start.sh as a restart."
    exit 1
  fi
fi

# Windows fallback: kill java (emulators) and node processes on known ports
if command -v taskkill > /dev/null 2>&1; then
  taskkill //F //IM java.exe 2>/dev/null || true
  # Find and kill processes listening on our known ports
  for port in 3000 4000 9099 8080 9000; do
    pid=$(netstat -ano 2>/dev/null | grep ":${port}.*LISTENING" | awk '{print $5}' | head -1)
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
      taskkill //F //PID "$pid" 2>/dev/null || true
    fi
  done
fi

echo "Local environment stopped."
