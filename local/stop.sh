#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true
pkill -f "firebase emulators" 2>/dev/null || true
pkill -f "express-api/src/index.js" 2>/dev/null || true
echo "Local environment stopped."
