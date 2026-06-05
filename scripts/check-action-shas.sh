#!/usr/bin/env bash
# Reject any workflow / composite action that references a third-party
# GitHub Action by mutable tag (e.g. @v6) rather than a 40-char commit
# SHA. Background: a tag can be re-pointed by the action owner at any
# time, so a tagged dependency is a supply-chain attack surface — the
# code that runs in CI today may not be the code that ran yesterday.
# SHA-pinning makes the dependency immutable and auditable.
#
# Local action references (./.github/actions/...) are exempt because
# they version with the repo. The convention is to append `# vX.Y.Z`
# after the SHA so a human reader can see the intent at a glance.
#
# Add new exemptions by extending ALLOW_RE below.

set -euo pipefail

# Match `uses: <owner>/<repo>[/path]@<ref>` lines. We accept either
# (a) a local action (./...) or (b) a 40-char lowercase hex SHA.
# Everything else is rejected.
ALLOW_RE='uses:[[:space:]]+(\./|[A-Za-z0-9._/-]+@[0-9a-f]{40}([[:space:]]|$))'

# Scan all workflow YAML and composite action YAML. Match both YAML
# forms — the standalone `uses:` step and the inline list form
# `- uses: ...` — by allowing an optional `- ` before `uses:`.
hits=$(
  grep -rEn --include='*.yml' --include='*.yaml' '^[[:space:]]*(-[[:space:]]+)?uses:' \
    .github/workflows .github/actions 2>/dev/null \
    | grep -vE "$ALLOW_RE" || true
)

if [ -n "$hits" ]; then
  echo "::error::Third-party action references must be pinned to a 40-char commit SHA, not a tag."
  echo "$hits"
  echo ""
  echo "Fix each line above by replacing the tag with the corresponding"
  echo "commit SHA from the action's repo. Example:"
  echo "  uses: actions/checkout@v6"
  echo "  → uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6"
  echo ""
  echo "Get the SHA via:"
  echo "  gh api repos/<owner>/<repo>/git/refs/tags/<tag> --jq '.object.sha'"
  exit 1
fi

echo "✓ All third-party action references are SHA-pinned."
