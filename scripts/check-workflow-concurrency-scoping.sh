#!/usr/bin/env bash
# Reject unscoped concurrency groups on workflows that accept cross-PR
# triggers (workflow_call, pull_request, push) but don't intentionally
# serialize on a shared physical resource.
#
# Background: 2026-05-09 — `playwright-tests.yml` had `group: playwright-tests`
# (no `${{ github.ref }}` interpolation), serializing every PR through one
# slot. GitHub Actions allows at most ONE pending run per group, so a 3rd
# PR's arrival cancelled the 2nd's queued run, surfacing as
# `playwright-web / Resolve Inputs: CANCELLED → PR Gate: FAILURE` on PRs
# that did nothing wrong (#568, #570). Fix was to scope the group per ref.
#
# Some workflows INTENTIONALLY use a global group because they contend on
# shared infrastructure (gh-pages, single deploy env, release pipeline,
# emulator/simulator runner). Those are listed in INTENTIONAL_GLOBALS below.
# Any new global group must either join that allowlist (with a comment in
# the workflow explaining why) or use ref interpolation.
#
# Run from project root.

set -euo pipefail

INTENTIONAL_GLOBALS=(
  "e2e-tests"           # Android emulator resource contention on gh-hosted runner
  "ios-tests"           # iOS simulator resource contention on gh-hosted runner
  "gh-pages-deploy"     # only one gh-pages deploy can land at a time
  "deploy-prod"         # single prod environment, no parallel deploys
  "release-main"        # single release pipeline owns version bump + tag
)

violations=0

for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$wf" ] || continue

  # Find every `group:` value under a `concurrency:` block (one-pass awk;
  # naive but workflow files are small and concurrency blocks are flat).
  group_value=$(awk '
    /^concurrency:/ { in_block = 1; next }
    in_block && /^[^[:space:]]/ { in_block = 0 }
    in_block && /^[[:space:]]+group:/ {
      sub(/^[[:space:]]+group:[[:space:]]*/, "")
      sub(/[[:space:]]*#.*$/, "")
      print
      exit
    }
  ' "$wf")

  # No concurrency block? OK.
  [ -z "$group_value" ] && continue

  # Has `${{` interpolation? Per-ref scoped (or some other dynamic key) — OK.
  if echo "$group_value" | grep -q '\${{'; then
    continue
  fi

  # Static group value. Strip quotes for allowlist comparison.
  bare=$(echo "$group_value" | sed -e "s/^['\"]//; s/['\"]$//")

  intentional=false
  for allowed in "${INTENTIONAL_GLOBALS[@]}"; do
    if [ "$bare" = "$allowed" ]; then
      intentional=true
      break
    fi
  done

  if [ "$intentional" = false ]; then
    echo "::error file=$wf::Unscoped concurrency group '$bare'. Use \`group: ${bare}-\${{ github.ref }}\` (or \`inputs.ref\` for workflow_call), or add '$bare' to INTENTIONAL_GLOBALS in scripts/check-workflow-concurrency-scoping.sh with a comment explaining the shared resource."
    violations=$((violations + 1))
  fi
done

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "Found $violations unscoped concurrency group(s)."
  echo "Why this matters: GitHub Actions only queues ONE pending run per group."
  echo "A 3rd PR arrival cancels the 2nd's pending run — PRs fail for no reason."
  exit 1
fi

echo "✓ All workflow concurrency groups are either ref-scoped or intentionally global."
