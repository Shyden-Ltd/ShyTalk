#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true

# Kill Firebase emulators and Express API
# Try pkill first (Linux/macOS), fall back to taskkill (Windows/Git Bash)
if command -v pkill > /dev/null 2>&1; then
  pkill -f "firebase emulators" 2>/dev/null || true
  pkill -f "cloud-firestore-emulator" 2>/dev/null || true
  pkill -f "cloud-datastore-emulator" 2>/dev/null || true
  pkill -f "express-api/src/index.js" 2>/dev/null || true
fi

# Windows fallback: kill java (emulators) and node (API/firebase) processes
if command -v taskkill > /dev/null 2>&1; then
  taskkill //F //IM java.exe 2>/dev/null || true
  # Kill node processes selectively using WMIC (matches command line)
  taskkill //F //FI "IMAGENAME eq node.exe" //FI "WINDOWTITLE eq npm*" 2>/dev/null || true
  # Fallback: find node PIDs listening on our known ports and kill them
  for port in 3000 4000 9099 8080 9000; do
    pid=$(netstat -ano 2>/dev/null | grep ":${port}.*LISTENING" | awk '{print $5}' | head -1)
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
      taskkill //F //PID "$pid" 2>/dev/null || true
    fi
  done
fi

echo "Local environment stopped."
