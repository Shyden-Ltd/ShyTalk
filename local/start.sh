#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Starting LiveKit..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

echo "Starting Firebase Emulators..."
cd "$PROJECT_ROOT"
npx firebase emulators:start \
  --project=demo-shytalk \
  --import=local/firebase-emulator-data \
  --export-on-exit=local/firebase-emulator-data &
FIREBASE_PID=$!

# Wait for emulators to be ready
echo "Waiting for emulators..."
until curl -s http://localhost:4000 > /dev/null 2>&1; do sleep 1; done
echo "Emulators ready."

# Seed data on first run
if [ ! -d "local/firebase-emulator-data/firestore_export" ]; then
  echo "First run - seeding data..."
  cd express-api && node ../local/seed.js && cd "$PROJECT_ROOT"
fi

echo ""
echo "Local environment ready:"
echo "  Firebase UI:  http://localhost:4000"
echo "  Firestore:    localhost:8080"
echo "  Auth:         localhost:9099"
echo "  RTDB:         localhost:9000"
echo "  LiveKit:      localhost:7880"
echo ""
echo "Start the API:  cd express-api && npm run local"
echo "Build Android:  ./gradlew installLocalDebug"
echo ""

# Keep running until Ctrl+C — clean shutdown exports emulator data
trap "echo 'Shutting down...'; kill $FIREBASE_PID 2>/dev/null; wait $FIREBASE_PID 2>/dev/null; docker compose -f \"$SCRIPT_DIR/docker-compose.yml\" down; exit 0" INT TERM
wait $FIREBASE_PID
