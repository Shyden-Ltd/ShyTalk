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
if command -v lsof > /dev/null 2>&1; then
  for port in $STACK_PORTS; do
    for pid in $(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null); do
      kill "$pid" 2>/dev/null || true
    done
  done
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
