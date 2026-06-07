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
# Per-action exemptions: ALLOW_RE is a GLOBAL allow pattern, not a
# per-action list. To allow a non-SHA ref for a specific trusted
# action, add a second narrowing `grep -vE` pass below — do NOT
# broaden ALLOW_RE itself, which would silently weaken the guard
# across every action ref in the repo.

set -euo pipefail

# Match `uses: <owner>/<repo>[/path]@<ref>` lines. We accept either
# (a) a local action (./...) or (b) a 40-char lowercase hex SHA
# followed by any non-hex character (so `@SHA # v6` and `@SHA#v6`
# both pass, while `@SHAabc...` — a hypothetical 41+ hex extension
# of a future SHA-256-style attack vector — is still rejected).
ALLOW_RE='uses:[[:space:]]+(\./|[A-Za-z0-9._/-]+@[0-9a-f]{40}([^0-9a-f]|$))'

# Scan workflow YAML, composite action YAML, and CodeQL config YAML.
# CodeQL `uses:` semantics differ (they reference query packs, not
# action repos), but the audit-surface argument is the same — any
# tag-pointed reference is mutable. Match both YAML forms — the
# standalone `uses:` step and the inline list form `- uses: ...` —
# by allowing an optional `- ` before `uses:`.
hits=$(
  grep -rEn --include='*.yml' --include='*.yaml' '^[[:space:]]*(-[[:space:]]+)?uses:' \
    .github/workflows .github/actions .github/codeql 2>/dev/null \
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
