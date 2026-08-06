#!/usr/bin/env bash
# 20-reseed.sh — (re)seed the LOCAL emulator stack and PROVE it took.
#
# Idempotent (create-if-absent), so safe to run any time. Run it:
#   - after a stack restart (emulators start EMPTY — no data import),
#   - after any Jest run against the emulators (Jest wipes users + Auth),
#   - before any Playwright/journey run (hard rule: never run web suites
#     against an unseeded stack — every persona sign-in 400s and each cell
#     burns its full timeout).
#
# Seeds: local/seed.js (admin + base user + Firestore + MinIO bucket) then
# express-api/scripts/seed-personas-local.js (journey personas P-02..P-19).
#
# ⚠ PERSONAS_PASSWORD is FORCED to localdev123: the .local app flavour bakes
#   DEV_QA_PERSONAS_PASSWORD='localdev123', and Node's --env-file does NOT
#   override an exported shell var — an inherited dev-password export would
#   silently seed the WRONG password (≈200 INVALID_PASSWORD cascade, 2026-07-11).
set -uo pipefail
source "$(dirname "$0")/lib.sh"
require_repo

SEED_LOG="$GAUNTLET_TMP/seed-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$GAUNTLET_TMP"

curl -fs -m 2 -o /dev/null http://localhost:9099 2>/dev/null \
  || die "Auth emulator (:9099) is down — run 10-services.sh first"

log "seeding base data (local/seed.js)…"
(
  cd "$REPO/express-api" \
    && FIRESTORE_EMULATOR_HOST=localhost:8080 \
       FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
       FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000 \
       STORAGE_EMULATOR_HOST=http://localhost:9002 \
       GCLOUD_PROJECT=demo-shytalk GOOGLE_CLOUD_PROJECT=demo-shytalk \
       NODE_PATH=./node_modules \
       node ../local/seed.js >>"$SEED_LOG" 2>&1
) || warn "seed.js exited non-zero — see $SEED_LOG (continuing to persona seed)"

log "seeding journey personas (seed-personas-local.js, password FORCED localdev123)…"
(
  cd "$REPO/express-api" \
    && NODE_PATH=./node_modules PERSONAS_PASSWORD=localdev123 \
       node --env-file=.env.local scripts/seed-personas-local.js >>"$SEED_LOG" 2>&1
) || die "seed-personas-local.js failed — see $SEED_LOG"

# --- verify 1: user count (grep -o: Auth emulator returns ONE json line) ---
USERS="$(curl -s -m5 \
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/projects/demo-shytalk/accounts:query" \
  -H 'Authorization: Bearer owner' -H 'Content-Type: application/json' -d '{}' 2>/dev/null \
  | grep -oE '"email"' | wc -l | tr -d ' ')"
[ "${USERS:-0}" -ge 10 ] \
  || die "only ${USERS:-0} auth users after seeding (expected ~38) — see $SEED_LOG"
ok "auth users present: $USERS"

# --- verify 2: a persona can actually SIGN IN with the baked password ------
IDTOKEN="$(curl -s -m5 \
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-local-key" \
  -H 'Content-Type: application/json' \
  -d '{"email":"officia@shytalk.dev","password":"localdev123","returnSecureToken":true}' 2>/dev/null)"
if echo "$IDTOKEN" | grep -q '"idToken"'; then
  ok "persona sign-in verified (officia@shytalk.dev / localdev123 → idToken)"
elif echo "$IDTOKEN" | grep -q 'INVALID_PASSWORD'; then
  die "personas seeded with the WRONG password (INVALID_PASSWORD) — a dev PERSONAS_PASSWORD leaked into the seed; see $SEED_LOG"
else
  die "persona sign-in verification failed (no idToken): $(echo "$IDTOKEN" | head -c 200)"
fi

log "reseed complete + verified. Log: $SEED_LOG"
