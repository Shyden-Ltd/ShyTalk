#!/usr/bin/env bash
# scripts/check-large-files.sh — block >5MB files from landing on main.
#
# Background: SHY-0035 (2026-06-08) audit found 12.74 GiB pack +
# 6 Allure-pattern directories ever-committed totalling ~42 GiB. History
# rewrite is deferred to a future explicit-auth SHY; this lint closes the
# prevention loop so no new >5MB file can land without an explicit
# operator-authored marker in the PR description.
#
# Threshold: 5,242,880 bytes (= 5 MiB exactly). A file at exactly the
# threshold is acceptable; one byte more fails.
#
# Modes:
#   default (no flags)      — scan every tracked blob at HEAD. Used for the
#                             baseline audit; lists pre-existing large files.
#   --against <ref>         — scan only files added/modified in the diff
#                             vs <ref> (typically `origin/main`). This is
#                             the PR-lint mode.
#
# Escape hatch: PR description may contain
#   [allow-large-file: <path> reason: <reason>]
# for each legitimate large addition. CI passes the PR body via
# ALLOW_LARGE_FILE_BODY env-var; matching paths are exempted.
#
# Exit codes:
#   0  no large files (or all exempted)
#   1  large files detected
#   2  usage error
#   3  git not available / not a git repo
#   4  --against ref unreachable locally (fetch origin first)
#
# Usage:
#   scripts/check-large-files.sh
#   scripts/check-large-files.sh --against origin/main
#   ALLOW_LARGE_FILE_BODY="$(gh pr view --json body --jq .body)" \
#     scripts/check-large-files.sh --against origin/main

set -euo pipefail

THRESHOLD_BYTES=5242880   # 5 MiB
MODE="head"
AGAINST_REF=""

usage() {
  cat <<EOF
Usage: $0 [--against <ref>] [--help]

  --against <ref>   Scan only files added/modified vs <ref>.
                    Typically --against origin/main for PR lint.
  --help            Show this help and exit 0.

Exit codes: 0 OK · 1 large files found · 2 usage error · 3 git missing/no-repo · 4 --against ref unreachable.

Escape hatch: set ALLOW_LARGE_FILE_BODY env-var to a string containing
  [allow-large-file: <path> reason: <reason>]
markers; matching paths are exempted from the >5MB rule.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --against)
      shift
      [ $# -gt 0 ] || { echo "::error::--against requires a ref argument" >&2; exit 2; }
      AGAINST_REF="$1"
      MODE="diff"
      shift
      ;;
    --against=*)
      # `--against=foo` equals-form, common shell convention. Reject
      # empty value so `--against=` is still a usage error.
      AGAINST_REF="${1#--against=}"
      if [ -z "$AGAINST_REF" ]; then
        echo "::error::--against requires a ref argument" >&2
        exit 2
      fi
      MODE="diff"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "::error::unknown flag: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v git >/dev/null 2>&1; then
  echo "::error::git not found on PATH" >&2
  exit 3
fi
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "::error::not inside a git work-tree" >&2
  exit 3
fi

# Parse allow-list markers once.
EXEMPT_PATHS=()
if [ -n "${ALLOW_LARGE_FILE_BODY:-}" ]; then
  # Regex matches `[allow-large-file: <path> reason: <reason>]` lines.
  # The reason capture is documentary; only the path is consumed here.
  while IFS= read -r path; do
    [ -n "$path" ] && EXEMPT_PATHS+=("$path")
  done < <(printf '%s\n' "$ALLOW_LARGE_FILE_BODY" \
    | grep -oE '\[allow-large-file:[[:space:]]*[^[:space:]]+' \
    | sed -E 's/^\[allow-large-file:[[:space:]]*//' || true)
fi

is_exempt() {
  local candidate="$1"
  # Explicit array-length guard for portability under `set -u` on
  # bash 3.2 (macOS default shell). `${arr[@]:-}` is technically safe
  # when arr was declared `arr=()` (set, not unset), but the explicit
  # length check is unambiguous and survives any future refactor that
  # might leave EXEMPT_PATHS undeclared in a code path.
  if [ "${#EXEMPT_PATHS[@]}" -eq 0 ]; then
    return 1
  fi
  for p in "${EXEMPT_PATHS[@]}"; do
    [ "$p" = "$candidate" ] && return 0
  done
  return 1
}

# In --against mode, verify the ref is reachable locally. A shallow
# clone (CI default) won't have main resolvable unless explicitly
# fetched — fail loud rather than silently promoting to HEAD-mode,
# because HEAD-mode would falsely report pre-existing large files
# (e.g. room_background.gif) as "added" and break every PR.
if [ "$MODE" = "diff" ]; then
  if ! git rev-parse --verify "$AGAINST_REF" >/dev/null 2>&1; then
    echo "::error::--against ref '$AGAINST_REF' not found locally. In CI, fetch it explicitly: 'git fetch --depth=1 origin main' BEFORE running this script. Locally, 'git fetch origin'." >&2
    exit 4
  fi
fi

# Enumerate candidate paths into stdin of the size-loop.
list_paths() {
  if [ "$MODE" = "diff" ]; then
    # Added or modified vs <ref>. Excludes deletions ('D').
    git diff --name-only --diff-filter=AM "$AGAINST_REF"...HEAD
  else
    git ls-tree -r HEAD --name-only
  fi
}

scanned=0
large=0
errors=0
declare -a OFFENDERS

while IFS= read -r path; do
  [ -z "$path" ] && continue
  scanned=$((scanned + 1))

  # Resolve blob size via cat-file -s — fast, works for both modes.
  blob_sha=$(git ls-tree HEAD -- "$path" 2>/dev/null | awk '{print $3}' | head -1)
  if [ -z "$blob_sha" ] && [ "$MODE" = "diff" ]; then
    # File may exist on the diff but not yet committed (rare); use
    # working-tree size as a fallback.
    if [ -f "$path" ]; then
      size=$(wc -c <"$path" | tr -d ' ')
    else
      errors=$((errors + 1))
      continue
    fi
  elif [ -n "$blob_sha" ]; then
    size=$(git cat-file -s "$blob_sha" 2>/dev/null || echo 0)
  else
    errors=$((errors + 1))
    continue
  fi

  if [ "$size" -gt "$THRESHOLD_BYTES" ]; then
    if is_exempt "$path"; then
      printf '::notice::%s is %s MiB — exempted by [allow-large-file] marker\n' \
        "$path" "$(awk -v s="$size" 'BEGIN{printf "%.1f", s/1048576}')" >&2
    else
      large=$((large + 1))
      OFFENDERS+=("$size|$path")
    fi
  fi
done < <(list_paths)

printf '[check-large-files] mode: %s, scanned: %d files, large: %d, errors: %d\n' \
  "$MODE" "$scanned" "$large" "$errors" >&2

if [ "$large" -gt 0 ]; then
  echo "::error::Found $large file(s) >5 MiB that are not exempted. See SHY-0035 audit (.project/audit/repo-size-audit-2026-06-08.md) for the 5 MiB threshold rationale." >&2
  echo "" >&2
  echo "Offending files (size · path):" >&2
  for entry in "${OFFENDERS[@]}"; do
    size="${entry%%|*}"
    p="${entry#*|}"
    mb=$(awk -v s="$size" 'BEGIN{printf "%.2f", s/1048576}')
    printf '  %s MiB  %s\n' "$mb" "$p" >&2
  done
  echo "" >&2
  echo "Remediation options:" >&2
  echo "  1. Move the asset to a CDN and load at runtime." >&2
  echo "  2. Use Git LFS (operator authorisation required — see CLAUDE.md)." >&2
  echo "  3. Add this exact line to the PR description (escape hatch):" >&2
  echo "       [allow-large-file: <path> reason: <one-line reason>]" >&2
  echo "     where <path> EXACTLY matches the offending file path above." >&2
  exit 1
fi

exit 0
