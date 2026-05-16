#!/usr/bin/env bash
# dev-runner-bootstrap.sh — diagnose dev Firebase access, then run the
# manual-qa runner against dev with zero further operator input.
#
# Designed to run ON the dev express-api server, where the dev SA file
# and PERSONAS_PASSWORD already live (or will be set).
#
# Phases:
#   1. Verify .env env keys are set
#   2. Probe firebase-admin init + Firestore read (20s timeout)
#   3. Run provisioner with line-buffered output (so progress is visible)
#   4. Run manual-qa runner against dev journeys
#
# Exits non-zero on first phase failure so problems surface clearly.

set -euo pipefail
cd "$(dirname "$0")/.."  # express-api root

# Helpers -------------------------------------------------------------
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

# Phase 1 — env-key presence ------------------------------------------
step "Phase 1: env keys present in .env"
for key in GOOGLE_APPLICATION_CREDENTIALS FIREBASE_PROJECT_ID PERSONAS_PASSWORD; do
  if grep -q "^${key}=" .env 2>/dev/null; then
    ok "$key set"
  else
    fail "$key missing in .env"
  fi
done

# Phase 2 — firebase-admin can authenticate + read Firestore ----------
step "Phase 2: firebase-admin connectivity probe (20s timeout)"
cat > ./probe.js <<'PROBE_EOF'
require('dotenv').config();
const a = require('firebase-admin');
a.initializeApp();
const projectId = a.app().options.projectId
  || process.env.FIREBASE_PROJECT_ID
  || process.env.GCLOUD_PROJECT;
console.log('project=' + projectId);
if (projectId && projectId.includes('prod')) {
  console.error('ABORT: project ID resolved to a prod-looking value');
  process.exit(2);
}
// Probe both endpoints the provisioner depends on:
//  - firestore.googleapis.com (Firestore Admin)
//  - identitytoolkit.googleapis.com (Firebase Auth Admin)
async function main() {
  const t0 = Date.now();
  try {
    const snap = await a.firestore().collection('users').limit(1).get();
    console.log('firestore_ok docs=' + snap.size + ' elapsed=' + (Date.now() - t0) + 'ms');
  } catch (e) {
    console.error('firestore_err ' + (e.message || e));
    process.exit(3);
  }
  const t1 = Date.now();
  try {
    // listUsers is the lightest Auth admin call — paginated, returns first 1 user.
    await a.auth().listUsers(1);
    console.log('auth_ok elapsed=' + (Date.now() - t1) + 'ms');
  } catch (e) {
    console.error('auth_err ' + (e.message || e));
    process.exit(4);
  }
  process.exit(0);
}
main();
PROBE_EOF
if ! timeout 25 node ./probe.js; then
  fail "probe failed or timed out — check SA + project + network to googleapis.com"
fi
ok "firebase-admin authenticated, Firestore + Auth both reachable"

# Phase 3 — run provisioner with line-buffered output -----------------
step "Phase 3: provision 19 personas against dev"
# `script` makes node treat stdout as a TTY → line buffering, real-time output.
# Fallback to plain node if `script` is missing.
if command -v script >/dev/null 2>&1; then
  script -qc 'node -r dotenv/config scripts/provision-test-personas.js' /dev/null
else
  node -r dotenv/config scripts/provision-test-personas.js
fi
ok "provisioner finished"

# Phase 4 — run manual-qa runner --------------------------------------
step "Phase 4: manual-qa runner cycle 1 against dev"
# Requires the journey plan dir to exist on the server. If it doesn't, the
# operator must scp .project/test-plans/manual/ here first.
PLAN_DIR="${PLAN_DIR:-${HOME}/express-api/.project/test-plans/manual}"
if [ ! -d "$PLAN_DIR" ]; then
  fail "PLAN_DIR not found at $PLAN_DIR — scp .project/test-plans/manual/ here first"
fi
# FIREBASE_DEV_API_KEY is the Web API key from app/src/dev/google-services.json
# `current_key` — a public client identifier, not a secret. The runner needs
# it to call Firebase Auth REST identitytoolkit for password sign-in.
# Extract via grep+cut rather than `source .env` so values with shell-special
# chars elsewhere in .env (e.g. SMTP_PASS) don't break parsing.
if [ -z "${FIREBASE_DEV_API_KEY:-}" ]; then
  FIREBASE_DEV_API_KEY="$(grep -E '^FIREBASE_DEV_API_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2-)"
  export FIREBASE_DEV_API_KEY
fi
if [ -z "${FIREBASE_DEV_API_KEY:-}" ]; then
  fail "FIREBASE_DEV_API_KEY not found in .env and not exported"
fi
node -r dotenv/config scripts/manual-qa-runner.js \
  --target dev \
  --plan-dir "$PLAN_DIR" \
  --cycle 1 \
  2>&1 | tee /tmp/manual-qa-cycle-1.log
ok "runner finished — report at /tmp/manual-qa-cycle-1.md and log at /tmp/manual-qa-cycle-1.log"
