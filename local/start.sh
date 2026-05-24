#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

API_PID=""
FIREBASE_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."

  # 1. Stop Express API
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    echo "Stopping Express API..."
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi

  # 2. Stop Firebase Emulators (graceful -- exports data)
  if [ -n "$FIREBASE_PID" ] && kill -0 "$FIREBASE_PID" 2>/dev/null; then
    echo "Stopping Firebase Emulators (exporting data)..."
    kill "$FIREBASE_PID" 2>/dev/null || true
    wait "$FIREBASE_PID" 2>/dev/null || true
  fi

  # 3. Stop Docker containers
  echo "Stopping Docker containers..."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true

  echo "Local environment stopped."
}

trap 'cleanup; exit 0' INT TERM

# =============================================================================
# Step 1: Docker Compose up (LiveKit + MinIO + Mailpit)
# =============================================================================
echo "==> Step 1/8: Starting Docker containers (LiveKit, MinIO, Mailpit)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

# =============================================================================
# Step 2: Start Firebase Emulators (background)
# =============================================================================
echo "==> Step 2/8: Starting Firebase Emulators..."
cd "$PROJECT_ROOT"
# Resource diet 2026-05-21: cap the Firebase emulator JVM heap at 1g.
# Default heap on macOS is ~4 GB which is overkill for fixture-sized
# Firestore + Auth data. `env VAR=val cmd` scopes JAVA_TOOL_OPTIONS to
# the firebase CLI process ONLY — it must NOT leak into later steps
# like Step 7's `./gradlew assembleLocalDebug` which needs the full
# Gradle daemon heap (Kotlin compile peaks at 2-4 GB; capping it to
# 1g would OOM the build). `$!` after `env … cmd &` still captures
# the right PID because env exec()s into cmd via execvp.
# Pinned by tests/scripts/local-stack-resource-diet.test.js.
env JAVA_TOOL_OPTIONS="-Xmx1g" npx firebase emulators:start \
  --project=demo-shytalk \
  --import=local/firebase-emulator-data \
  --export-on-exit=local/firebase-emulator-data &
FIREBASE_PID=$!

# =============================================================================
# Step 3: Wait for readiness (emulators + MinIO)
# =============================================================================
echo "==> Step 3/8: Waiting for emulators and MinIO..."

echo "  Waiting for Firebase Emulators (localhost:4000)..."
MAX_WAIT=120; WAITED=0
until curl -s http://localhost:4000 > /dev/null 2>&1; do
  sleep 1; WAITED=$((WAITED+1))
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "ERROR: Firebase Emulators did not start within ${MAX_WAIT}s"
    cleanup
    exit 1
  fi
done
echo "  Firebase Emulators ready."

echo "  Waiting for MinIO (localhost:9002)..."
MAX_WAIT=120; WAITED=0
until curl -s http://localhost:9002/minio/health/live > /dev/null 2>&1; do
  sleep 1; WAITED=$((WAITED+1))
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "ERROR: MinIO did not start within ${MAX_WAIT}s"
    cleanup
    exit 1
  fi
done
echo "  MinIO ready."

# =============================================================================
# Step 4: Seed data (Firestore + MinIO bucket)
# =============================================================================
echo "==> Step 4/8: Seeding data..."
(cd "$PROJECT_ROOT/express-api" && NODE_PATH=./node_modules node ../local/seed.js)

# =============================================================================
# Step 5: Start Express API (background)
# =============================================================================
echo "==> Step 5/8: Starting Express API..."
# Use process substitution `> >(sed ...)` instead of a pipe so the
# colour-prefix on stdout doesn't make `$!` capture sed's PID
# instead of node's. The pre-substitution form (`node ... | sed ... &`)
# made `API_PID=$!` capture sed; cleanup's `kill "$API_PID"` killed
# sed but orphaned node, leaving port 3000 held open across runs.
# With process substitution, node remains the operative backgrounded
# process and $! captures it. Pinned by
# tests/scripts/local-stack-resource-diet.test.js (round 3 fix).
cd "$PROJECT_ROOT/express-api" && NODE_ENV=local TEST_API_KEY=local-test-key node src/index.js > >(sed 's/^/[API] /') 2>&1 &
API_PID=$!
cd "$PROJECT_ROOT"

# =============================================================================
# Step 6: Wait for API ready
# =============================================================================
echo "==> Step 6/8: Waiting for Express API (localhost:3000)..."
MAX_WAIT=120; WAITED=0
until curl -s http://localhost:3000/api/health > /dev/null 2>&1; do
  sleep 1; WAITED=$((WAITED+1))
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "ERROR: Express API did not start within ${MAX_WAIT}s"
    cleanup
    exit 1
  fi
done
echo "  Express API ready."

# =============================================================================
# Step 7: Build Android APK
# =============================================================================
APK_PATH="app/build/outputs/apk/local/debug/app-local-debug.apk"
echo "==> Step 7/8: Building Android APK..."
cd "$PROJECT_ROOT" && ./gradlew assembleLocalDebug

# =============================================================================
# Step 8: Install on device if connected
# =============================================================================
echo "==> Step 8/8: Checking for connected device..."
DEVICE_NAME="No device connected"
if adb devices 2>/dev/null | grep -q "device$"; then
  DEVICE_NAME=$(adb devices -l 2>/dev/null | grep "device " | head -1 | sed 's/.*model:\([^ ]*\).*/\1/' || echo "connected device")
  echo "  Installing on $DEVICE_NAME..."
  adb install -r "$PROJECT_ROOT/$APK_PATH" 2>/dev/null && echo "  Installed." || echo "  Install failed -- APK path shown below."
else
  echo "  No device connected -- skipping install."
fi

# =============================================================================
# Ready message
# =============================================================================
echo ""
echo "========================================================"
echo "  Local environment ready (fully offline):"
echo "========================================================"
echo ""
echo "  Services:"
echo "    Firebase UI:    http://localhost:4000"
echo "    Express API:    http://localhost:3000"
echo "    Mailpit UI:     http://localhost:8025"
echo "    MinIO Console:  http://localhost:9001"
echo "    LiveKit:        localhost:7880"
echo ""
echo "  Credentials:"
echo "    Test admin:     claude-test@shytalk.dev / localdev123"
echo "    Test user:      user@test.com / localdev123"
echo "    MinIO:          minioadmin / minioadmin"
echo ""
echo "  Android:"
echo "    APK path:       $APK_PATH"
echo "    Installed on:   $DEVICE_NAME"
echo ""
echo "  iOS: Supported but not covered here -- development focuses on Android."
echo ""
echo "  Run tests:        bash local/test.sh"
echo "  View Allure:      npx allure serve allure-results"
echo ""
echo "Press Ctrl+C to stop..."

# Keep running until Ctrl+C. The `|| true` is required: this script
# runs under `set -e` (line 2), and `wait` returns Firebase's exit
# code on natural Firebase termination. On a Firebase crash (non-zero
# exit), the unguarded `wait` would abort the shell via set -e BEFORE
# reaching the cleanup() call below — leaving Docker containers
# (LiveKit, MinIO, Mailpit) running indefinitely. The existing INT/TERM
# trap covers Ctrl+C, not set-e-induced exits. `|| true` makes the
# wait fall through to the cleanup line regardless of Firebase's
# exit code. Pinned by tests/scripts/local-stack-resource-diet.test.js.
wait $FIREBASE_PID || true
echo "Firebase emulators exited."
cleanup
