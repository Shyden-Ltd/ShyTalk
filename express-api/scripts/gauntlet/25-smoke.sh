#!/usr/bin/env bash
# 25-smoke.sh — pre-flight DATA-PLANE liveness smoke for Gauntlet v2 (SHY-0240).
#
# A few-second round-trip that proves the real data plane is alive BEFORE the
# hours-long device matrix is dispatched — so a dead API / Auth / Firestore is
# caught in seconds, not discovered after the phones have burned through cell
# timeouts. Any failed leg `die`s (exit 1) → the caller's ERR trap writes the
# FAIL sentinel and the whole run aborts early.
#
# The legs prove, end to end:
#   1. API health          — the Express API is up (unauthenticated GET).
#   2. persona sign-in      — Firebase Auth is up + personas are seeded (idToken).
#   3. authenticated read   — an owner GET reflects the user (captures the prior
#                             value so the smoke leaves state as it found it).
#   4. authenticated write  — the API accepts an owner-gated PATCH to Firestore.
#   5. read-back            — that write is durable + served back through the API.
#   6. restore (best-effort)— the prior value is written back, so the smoke is
#                             idempotent (it does not permanently mutate a shared
#                             journey persona — reseed's merge-write never heals
#                             a field it doesn't itself set).
# For this API-only backend (clients never read Firestore directly) the read
# legs ARE the "propagation-readable" proof the device journeys depend on.
#
# Usage: 25-smoke.sh [local|dev]     (default: local)
#   Local personas sign in with the baked `localdev123`; dev uses the
#   PERSONAS_PASSWORD secret (the local-vs-dev password trap — see 20-reseed.sh).
set -uo pipefail
# shellcheck source=/dev/null
source "$(dirname "$0")/lib.sh"

# ── testable predicates (library mode: sourced by the unit tests) ───────────
# Extract a top-level JSON string field's value (empty if absent/parse error).
# node for robust parsing — the values here (idToken, lastRoomName) are strings
# that may contain characters grep/sed would mishandle.
smoke_json_field() { # <json> <field>
  printf '%s' "$1" | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c)).on("end", () => {
      try { const v = JSON.parse(d)[process.argv[1]]; process.stdout.write(v == null ? "" : String(v)); }
      catch { /* leave empty on non-JSON / missing */ }
    });' "$2"
}

# Build a JSON body with proper escaping — email/password/values may be overridden
# or a dev secret with punctuation; raw interpolation would malform the JSON and
# FALSE-ABORT on a healthy stack.
smoke_signin_body() { # <email> <password>
  node -e 'process.stdout.write(JSON.stringify({ email: process.argv[1], password: process.argv[2], returnSecureToken: true }))' "$1" "$2"
}
smoke_lastroom_body() { # <lastRoomName-value>
  node -e 'process.stdout.write(JSON.stringify({ lastRoomName: process.argv[1] }))' "$1"
}

# Leg predicates (exit 0 = the good/expected condition holds).
smoke_invalid_password() { printf '%s' "$1" | grep -q 'INVALID_PASSWORD'; } # wrong seeded pw
smoke_write_ok() { printf '%s' "$1" | grep -q '"success" *: *true'; }        # write accepted
smoke_roundtrip_ok() { printf '%s' "$1" | grep -qF "$2"; }                   # nonce echoed (literal)

# Library mode: the unit tests source this file to drive the predicates above
# with literal fixtures, without running the round-trip. MUST precede any
# orchestration side effect.
[ -n "${GAUNTLET_SMOKE_LIB:-}" ] && return 0 2>/dev/null

# ── orchestration ───────────────────────────────────────────────────────────
TARGET="${1:-local}"
PERSONA_EMAIL="${SMOKE_PERSONA_EMAIL:-adult-power@shytalk.dev}"
PERSONA_UNIQUEID="${SMOKE_PERSONA_UNIQUEID:-50000010}"
HEALTH_TIMEOUT="${SMOKE_HEALTH_TIMEOUT:-10}"

# Resolve API base, Auth base, web API key, and the persona password by target.
# The local↔dev password differs: local personas are baked with `localdev123`
# (the .local app flavour), dev uses the ~/.shytalk PERSONAS_PASSWORD secret.
case "$TARGET" in
  local)
    API_BASE="${LOCAL_API_BASE:-http://localhost:3000}"
    AUTH_BASE="${FIREBASE_LOCAL_AUTH_BASE:-http://localhost:9099/identitytoolkit.googleapis.com}"
    API_KEY="${FIREBASE_LOCAL_API_KEY:-fake-local-key}"
    PERSONA_PW="${SMOKE_LOCAL_PASSWORD:-localdev123}"
    ;;
  dev)
    API_BASE="${DEV_API_BASE:-https://dev-api.shytalk.shyden.co.uk}"
    AUTH_BASE="${FIREBASE_DEV_AUTH_BASE:-https://identitytoolkit.googleapis.com}"
    API_KEY="${FIREBASE_DEV_API_KEY:?FIREBASE_DEV_API_KEY required for --target dev}"
    PERSONA_PW="${PERSONAS_PASSWORD:?PERSONAS_PASSWORD required for --target dev}"
    ;;
  *)
    die "unknown target: $TARGET (expected: local | dev)"
    ;;
esac

USER_URL="$API_BASE/api/users/$PERSONA_UNIQUEID"

log "pre-flight smoke ($TARGET) — proving the data plane is alive before the matrix"

# ── 1. API health (unauthenticated) ─────────────────────────────────────────
wait_http "$API_BASE/api/health" "$HEALTH_TIMEOUT" "API health ($API_BASE)" \
  || die "API health check failed at $API_BASE/api/health — is the API/stack up?"

# ── 2. persona sign-in → idToken (Auth alive + personas seeded) ─────────────
SIGNIN="$(curl -s -m 10 "$AUTH_BASE/v1/accounts:signInWithPassword?key=$API_KEY" \
  -H 'Content-Type: application/json' \
  -d "$(smoke_signin_body "$PERSONA_EMAIL" "$PERSONA_PW")" 2>/dev/null)"
IDTOKEN="$(smoke_json_field "$SIGNIN" idToken)"
if [ -z "$IDTOKEN" ]; then
  if smoke_invalid_password "$SIGNIN"; then
    die "persona sign-in got INVALID_PASSWORD for $PERSONA_EMAIL ($TARGET) — wrong seeded password (local wants localdev123, dev wants \$PERSONAS_PASSWORD)"
  fi
  die "persona sign-in failed for $PERSONA_EMAIL ($TARGET): $(printf '%s' "$SIGNIN" | head -c 200)"
fi
ok "persona sign-in ($PERSONA_EMAIL) → idToken"

# ── 3. authenticated READ (capture the prior value for restore) ─────────────
BEFORE="$(curl -s -m 10 "$USER_URL" -H "Authorization: Bearer $IDTOKEN" 2>/dev/null)"
OLD_LASTROOM="$(smoke_json_field "$BEFORE" lastRoomName)"

# ── 4. authenticated WRITE → Firestore (owner-gated PATCH) ──────────────────
NONCE="smoke-$(date +%s)-$$"
WRITE="$(curl -s -m 10 -X PATCH "$USER_URL" \
  -H "Authorization: Bearer $IDTOKEN" -H 'Content-Type: application/json' \
  -d "$(smoke_lastroom_body "$NONCE")" 2>/dev/null)"
smoke_write_ok "$WRITE" \
  || die "authenticated write failed (PATCH /api/users/$PERSONA_UNIQUEID): $(printf '%s' "$WRITE" | head -c 200)"
ok "authenticated write accepted (PATCH /api/users/$PERSONA_UNIQUEID)"

# ── 5. READ back → the write must round-trip ────────────────────────────────
AFTER="$(curl -s -m 10 "$USER_URL" -H "Authorization: Bearer $IDTOKEN" 2>/dev/null)"
smoke_roundtrip_ok "$AFTER" "$NONCE" \
  || die "data-plane round-trip FAILED: wrote lastRoomName=$NONCE but the read-back did not return it — the API/Firestore write is not durable"
ok "data-plane round-trip verified ($NONCE written → read back via the API)"

# ── 6. restore the prior value (best-effort — liveness already proven) ──────
# Leaves the shared persona as we found it: the reseed's merge-write does NOT
# clear lastRoomName, so without this the nonce would persist permanently.
curl -s -m 10 -X PATCH "$USER_URL" \
  -H "Authorization: Bearer $IDTOKEN" -H 'Content-Type: application/json' \
  -d "$(smoke_lastroom_body "$OLD_LASTROOM")" >/dev/null 2>&1 \
  || warn "could not restore lastRoomName for $PERSONA_UNIQUEID (benign — reseed will not clear the smoke nonce)"

log "pre-flight smoke PASSED ($TARGET) — API + Auth + Firestore round-trip all alive"
