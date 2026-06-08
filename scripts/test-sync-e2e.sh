#!/usr/bin/env bash
# test-sync-e2e.sh — end-to-end integration test for sync-shy-to-roadmap-data.mjs.
#
# Spec: .project/stories/SHY-0038-public-roadmap-gh-project-link.md Test Plan + DoD.
#
# Verifies the full mutate → sync → diff → revert → sync → no-diff cycle that the
# CI workflow exercises in production. Catches issues the Jest unit tests cannot:
# the `git diff --quiet` no-op guard in the workflow, and the script's behaviour
# on the real SHY corpus.
#
# Usage:
#   bash scripts/test-sync-e2e.sh
#
# Exit codes:
#   0   all assertions pass
#   1   any assertion fails (mutate didn't produce a diff, revert didn't return
#       to byte-identical, no-op run produced a diff, sync script failed)
#   2   precondition failure (script missing, not in a git repo, etc.)

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SYNC_SCRIPT="scripts/sync-shy-to-roadmap-data.mjs"
DATA_FILE="public/roadmap-data.json"
FIXTURE_SHY="$(ls .project/stories/SHY-0038-*.md 2>/dev/null | head -n 1)"

# === Preconditions ===
if [ ! -f "$SYNC_SCRIPT" ]; then
  printf '[e2e] FAIL: sync script not found at %s\n' "$SYNC_SCRIPT" >&2
  exit 2
fi
if [ ! -f "$DATA_FILE" ]; then
  printf '[e2e] FAIL: data file not found at %s\n' "$DATA_FILE" >&2
  exit 2
fi
if [ -z "$FIXTURE_SHY" ] || [ ! -f "$FIXTURE_SHY" ]; then
  printf '[e2e] FAIL: SHY-0038 fixture file not found in .project/stories/\n' >&2
  exit 2
fi

# Helper: SHA of the file with timestamp fields masked. The script
# legitimately updates generatedAt + lastUpdated when content changes;
# a revert produces a file that's SEMANTICALLY identical to baseline
# but carries the post-mutation timestamp. Use the masked SHA for
# semantic comparisons; the raw SHA for byte-determinism checks.
masked_sha() {
  sed -E 's/"(generatedAt|lastUpdated)": "[^"]*"/"\1": "MASKED"/g' "$1" \
    | shasum -a 256 | awk '{print $1}'
}

# === Step 1: Establish baseline (run sync; capture state) ===
printf '[e2e] step 1: establish baseline\n'
node "$SYNC_SCRIPT" >/dev/null
BASELINE_SHA="$(shasum -a 256 "$DATA_FILE" | awk '{print $1}')"
BASELINE_SEMANTIC_SHA="$(masked_sha "$DATA_FILE")"
BASELINE_SHY_HASH="$(shasum -a 256 "$FIXTURE_SHY" | awk '{print $1}')"
printf '[e2e]   baseline %s sha=%s semantic=%s\n' "$DATA_FILE" "${BASELINE_SHA:0:12}" "${BASELINE_SEMANTIC_SHA:0:12}"

# === Step 2: Idempotent no-op (run sync again; assert byte-identical) ===
printf '[e2e] step 2: idempotent no-op run\n'
node "$SYNC_SCRIPT" >/dev/null
SECOND_SHA="$(shasum -a 256 "$DATA_FILE" | awk '{print $1}')"
if [ "$BASELINE_SHA" != "$SECOND_SHA" ]; then
  printf '[e2e] FAIL: two consecutive runs produced different output\n' >&2
  printf '[e2e]   baseline: %s\n' "$BASELINE_SHA" >&2
  printf '[e2e]   second:   %s\n' "$SECOND_SHA" >&2
  printf '[e2e]   determinism is required for the workflow''s `git diff --quiet` no-op guard\n' >&2
  exit 1
fi
printf '[e2e]   PASS: byte-identical output across consecutive runs\n'

# === Step 3: Mutate fixture SHY → sync → assert diff appeared ===
printf '[e2e] step 3: mutate fixture + assert diff\n'
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"; cp "${SCRATCH}/SHY-0038-backup.md" "$FIXTURE_SHY" 2>/dev/null || true' EXIT
cp "$FIXTURE_SHY" "${SCRATCH}/SHY-0038-backup.md"

# Mutate: change SHY-0038's title to something detectable in the JSON.
SENTINEL="SHY-0038-E2E-MUTATION-$$"
sed -i.bak "s|# SHY-0038:.*|# SHY-0038: ${SENTINEL}|" "$FIXTURE_SHY"
rm -f "${FIXTURE_SHY}.bak"

node "$SYNC_SCRIPT" >/dev/null
MUTATED_SHA="$(shasum -a 256 "$DATA_FILE" | awk '{print $1}')"
if [ "$BASELINE_SHA" = "$MUTATED_SHA" ]; then
  printf '[e2e] FAIL: mutated fixture did not change the output JSON\n' >&2
  exit 1
fi
if ! grep -q "$SENTINEL" "$DATA_FILE"; then
  printf '[e2e] FAIL: sentinel %s not found in regenerated JSON\n' "$SENTINEL" >&2
  exit 1
fi
printf '[e2e]   PASS: mutation propagated (sentinel found in JSON; sha changed)\n'

# === Step 4: Revert + sync → assert byte-identical to baseline ===
printf '[e2e] step 4: revert + assert no-diff\n'
cp "${SCRATCH}/SHY-0038-backup.md" "$FIXTURE_SHY"
# Confirm revert restored the fixture exactly.
REVERTED_SHY_HASH="$(shasum -a 256 "$FIXTURE_SHY" | awk '{print $1}')"
if [ "$BASELINE_SHY_HASH" != "$REVERTED_SHY_HASH" ]; then
  printf '[e2e] FAIL: fixture revert did not restore original SHY content\n' >&2
  exit 1
fi

node "$SYNC_SCRIPT" >/dev/null
RESTORED_SEMANTIC_SHA="$(masked_sha "$DATA_FILE")"
if [ "$BASELINE_SEMANTIC_SHA" != "$RESTORED_SEMANTIC_SHA" ]; then
  printf '[e2e] FAIL: post-revert sync did not return to semantic baseline\n' >&2
  printf '[e2e]   baseline semantic:  %s\n' "$BASELINE_SEMANTIC_SHA" >&2
  printf '[e2e]   restored semantic:  %s\n' "$RESTORED_SEMANTIC_SHA" >&2
  exit 1
fi
# Note: byte-level SHA may differ — the script's smart timestamp logic preserves
# the post-mutation `generatedAt` because the post-revert content is semantically
# identical to the post-mutation state. This is the correct behavior (idempotent
# w.r.t. last-written state, not w.r.t. ever-seen-baseline state).
printf '[e2e]   PASS: post-revert semantically matches baseline (mutate → revert is round-trip safe)\n'

trap - EXIT
rm -rf "$SCRATCH"
printf '[e2e] all assertions passed\n'
exit 0
