#!/usr/bin/env bash
# check-node-version.sh — fail-fast guard: the local `node` major must match
# the repo's `.nvmrc`. Delivered by SHY-0069 after brew's floating `node`
# formula silently upgraded to 26.3.0 (2026-06-09) and wedged every full
# Jest suite run (0% CPU, no output, no timeout). CI pins node 24; local
# verification must run the same major or its results can't be trusted.
#
# Usage: scripts/check-node-version.sh [--help]
#   Takes no other arguments. Reads `.nvmrc` from the git work-tree root
#   (CWD-independent within the work-tree). Silent on success.
#
# Exit codes:
#   0  local node major matches .nvmrc major (no output)
#   1  major mismatch (actionable message on stderr)
#   2  .nvmrc missing/unreadable/non-numeric, or not inside a git work-tree
#   3  node not found on PATH
set -euo pipefail

usage() {
  cat <<'EOF'
check-node-version.sh — fail-fast guard: the local `node` major must match
the repo's `.nvmrc`. Reads `.nvmrc` from the git work-tree root
(CWD-independent within the work-tree). Silent on success.

Usage: scripts/check-node-version.sh [--help]

Exit codes:
  0  local node major matches .nvmrc major (no output)
  1  major mismatch (actionable message on stderr)
  2  .nvmrc missing/unreadable/non-numeric, or not inside a git work-tree
  3  node not found on PATH
EOF
}

if [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "node-version-guard: not inside a git work-tree; cannot locate .nvmrc" >&2
  exit 2
}

nvmrc="$root/.nvmrc"
if [ ! -r "$nvmrc" ]; then
  echo "node-version-guard: missing or unreadable .nvmrc at $nvmrc" >&2
  exit 2
fi

want=$(tr -d '[:space:]' <"$nvmrc")
want=${want#v}
want=${want%%.*}
case "$want" in
  '' | *[!0-9]*)
    echo "node-version-guard: unreadable .nvmrc — expected a numeric Node major, got '$(head -c 40 "$nvmrc" | tr -d '\n')'" >&2
    exit 2
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "node-version-guard: node not found on PATH (expected major $want per .nvmrc)" >&2
  exit 3
fi

have=$(node -v)
have=${have#v}
have=${have%%.*}

if [ "$have" = "$want" ]; then
  exit 0
fi

cat >&2 <<EOF
node-version-guard: local node major is $have but .nvmrc expects $want.
  Local test runs on a drifted major are unreliable (node 26.3.0 wedged the full Jest suite on 2026-06-09).
  Fix:     brew unlink node 2>/dev/null; brew link --overwrite --force node@$want
  Upgrade: bump .nvmrc + express-api/package.json engines in the same PR that validates the new major.
EOF
exit 1
