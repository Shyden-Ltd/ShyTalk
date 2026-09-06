#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true

# Kill Firebase emulators and Express API
# Try pkill first (Linux/macOS), fall back to taskkill (Windows/Git Bash)
if command -v pkill > /dev/null 2>&1; then
  pkill -f "firebase emulators" 2>/dev/null || true
  pkill -f "cloud-firestore-emulator" 2>/dev/null || true
  pkill -f "cloud-datastore-emulator" 2>/dev/null || true
fi

# Release every port start.sh's pre-flight guards, BY PORT. The API used to be
# matched by the pattern `express-api/src/index.js`, and start.sh launches it
# as `node src/index.js` from inside express-api/ -- so it never matched, the
# API outlived every stop, and the next start refused at pre-flight with
# "port 3000 held by PID ... (node)" (2026-09-04). This list must equal the
# pre-flight list in start.sh; a test pins the two together.
STACK_PORTS="4000 8080 9000 9099 3000 7880 9002 8025 8888"
# Only the stack's own process kinds are stopped: the emulators are java, the
# API, the web server and the emulator UI are node. Anything else on one of
# these ports -- Docker's port proxy for LiveKit and MailHog, an unrelated dev
# server on 8080 -- is left alone and NAMED, because a listener that survives
# is exactly why the next start refuses at pre-flight (review, 2026-09-04).
if command -v lsof > /dev/null 2>&1; then
  for port in $STACK_PORTS; do
    for pid in $(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null); do
      comm="$(basename "$(ps -o comm= -p "$pid" 2>/dev/null)" 2>/dev/null)"
      case "$comm" in
        node|java|firebase)
          if kill "$pid" 2>/dev/null; then
            echo "stop.sh: stopped ${comm} (pid ${pid}) on port ${port}"
          fi
          ;;
        "")
          ;;
        *)
          echo "stop.sh: left ${comm} (pid ${pid}) on port ${port} alone -- not part of the stack"
          ;;
      esac
    done
  done

  # kill(1) returns before the process has exited. `stop.sh && start.sh` hit
  # start.sh's pre-flight while the emulators were still shutting down
  # ("port 9000 held by PID ... (java)", 2026-09-04): a stop that returns while
  # its ports are still held has not stopped anything yet. Wait, bounded, for
  # every stack port to close; name whatever is still there at the end.
  STACK_PORTS_RELEASE_TIMEOUT_S=15
  waited=0
  held=""
  while [ "$waited" -lt "$STACK_PORTS_RELEASE_TIMEOUT_S" ]; do
    held=""
    for port in $STACK_PORTS; do
      if [ -n "$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null)" ]; then
        held="${held} ${port}"
      fi
    done
    [ -z "$held" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  if [ -n "$held" ]; then
    echo "stop.sh: ports${held} still held after ${STACK_PORTS_RELEASE_TIMEOUT_S}s -- a listener that is not part of the stack, or one that ignored SIGTERM" >&2
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
