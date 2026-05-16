#!/usr/bin/env bash
# dev-runner-deploy-and-run.sh — one-shot driver for the dev manual-qa cycle.
#
# Runs the four steps that were previously four separate `!` commands:
#   1. Idempotently ensure FIREBASE_DEV_API_KEY is in the server's .env.
#   2. scp the dev-runner-bootstrap.sh to the server.
#   3. scp the .project/test-plans/manual/ journey plan to the server.
#   4. Execute the bootstrap on the server (which provisions personas and
#      runs the manual-qa cycle against dev).
#
# Self-contained — no operator input needed beyond running this script.
# Designed to be invoked from the laptop, drives the dev Oracle Cloud VM.
#
# Exit status:
#   0 — bootstrap completed; cycle report exists at /tmp/manual-qa-cycle-1.md
#   1+ — any phase failure (network, scp, remote bootstrap)
#
# Configuration via env (sensible defaults baked in):
#   DEV_HOST           — default 145.241.224.13 (Oracle Cloud dev VM)
#   SSH_KEY            — default ~/.ssh/shytalk-oci
#   DEV_API_KEY        — default value from app/src/dev/google-services.json

set -euo pipefail

DEV_HOST="${DEV_HOST:-145.241.224.13}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/shytalk-oci}"
# Firebase Web API key for the dev project. Public client identifier (ships
# in every Android APK), but the repo secret scanner flags any AIza-prefixed
# string, so the value is sourced from env. Pull it from
# app/src/dev/google-services.json field `current_key`:
#   export DEV_API_KEY="$(jq -r '.client[0].api_key[0].current_key' \
#     "$(git rev-parse --show-toplevel)/app/src/dev/google-services.json")"
if [ -z "${DEV_API_KEY:-}" ]; then
  echo "✗ DEV_API_KEY env var not set" >&2
  echo "  Source it from app/src/dev/google-services.json:" >&2
  echo "    export DEV_API_KEY=\"\$(jq -r '.client[0].api_key[0].current_key' \\" >&2
  echo "      \"\$(git rev-parse --show-toplevel)/app/src/dev/google-services.json\")\"" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

ssh_cmd() {
  ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "ubuntu@${DEV_HOST}" "$@"
}
scp_cmd() {
  scp -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "$@"
}

# ── Phase 1 — ensure required keys in remote .env ───────────────────
echo "== Phase 1: ensure required env keys in ~/express-api/.env =="
# Idempotent appends — only adds a key if missing. Values are public-ish:
#   - FIREBASE_DEV_API_KEY: ships in Android APK (public client identifier)
#   - GOOGLE_APPLICATION_CREDENTIALS: filesystem path on the server (not a secret)
#   - FIREBASE_PROJECT_ID: project name (public)
ssh_cmd "grep -q '^FIREBASE_DEV_API_KEY=' ~/express-api/.env || echo 'FIREBASE_DEV_API_KEY=${DEV_API_KEY}' >> ~/express-api/.env"
ssh_cmd "grep -q '^GOOGLE_APPLICATION_CREDENTIALS=' ~/express-api/.env || echo 'GOOGLE_APPLICATION_CREDENTIALS=/home/ubuntu/express-api/shytalk-dev-firebase-adminsdk.json' >> ~/express-api/.env"
ssh_cmd "grep -q '^FIREBASE_PROJECT_ID=' ~/express-api/.env || echo 'FIREBASE_PROJECT_ID=shytalk-dev' >> ~/express-api/.env"
echo "✓ required keys ensured in .env"

# ── Phase 2 — upload runner + provisioner + bootstrap scripts ───────
# The dev VM's express-api may not have the latest runner v2 matchers
# (deploys lag). scp the scripts that the bootstrap will exec.
echo "== Phase 2: upload runner + provisioner + bootstrap scripts =="
scp_cmd \
  "${REPO_ROOT}/express-api/scripts/dev-runner-bootstrap.sh" \
  "${REPO_ROOT}/express-api/scripts/manual-qa-runner.js" \
  "${REPO_ROOT}/express-api/scripts/provision-test-personas.js" \
  "ubuntu@${DEV_HOST}:~/express-api/scripts/"
echo "✓ scripts uploaded"

# ── Phase 3 — upload journey plan ────────────────────────────────────
echo "== Phase 3: upload .project/test-plans/manual/ =="
ssh_cmd "mkdir -p ~/express-api/.project/test-plans/manual"
scp_cmd -r "${REPO_ROOT}/.project/test-plans/manual/" "ubuntu@${DEV_HOST}:~/express-api/.project/test-plans/"
echo "✓ journey plan uploaded"

# ── Phase 4 — run bootstrap on the server ───────────────────────────
echo "== Phase 4: execute dev-runner-bootstrap on the server =="
echo "(this will provision 19 personas + run cycle 1 against dev — ~3-5 min)"
ssh_cmd "bash ~/express-api/scripts/dev-runner-bootstrap.sh"
echo "✓ bootstrap finished — cycle report on server at /tmp/manual-qa-cycle-1.md"

# ── Phase 5 — pull the cycle report back ────────────────────────────
echo "== Phase 5: pull cycle report back =="
scp_cmd "ubuntu@${DEV_HOST}:/tmp/manual-qa-cycle-1.md" /tmp/manual-qa-cycle-1.md 2>/dev/null \
  && echo "✓ report saved to /tmp/manual-qa-cycle-1.md" \
  || echo "⚠ report not found on server — bootstrap may have errored early"
