#!/usr/bin/env bash
# check-podfile-lock-sync.sh — refuse a Podfile that its Podfile.lock does not
# describe (SHY-0305).
#
# Why this exists as a separate, dependency-free check:
#
# CI already installs pods with `pod install --deployment`, which fails on a
# lock mismatch. That guard is skipped on a Pods cache hit, and the cache key
# hashes Podfile.LOCK only — so editing the PODFILE leaves the key untouched,
# the cache hits, and the guard is skipped by exactly the condition it exists
# to catch. SHY-0300 shipped `pod 'FirebaseAppCheck'` with a stale lock, every
# iOS build failed with "Unable to resolve module dependency", and nothing
# noticed until a deploy reached the Swift compiler an hour later.
#
# This check needs no CocoaPods, no macOS and no network, so it runs in lint on
# every PR on the ubuntu runner — where the mistake is actually made.
#
# Two assertions, because either alone is insufficient:
#   1. PODFILE CHECKSUM == sha1(Podfile). This is CocoaPods' own invariant,
#      verified empirically against a known-good commit before being relied on.
#      It catches an un-regenerated lock.
#   2. Every pod the Podfile declares appears in the lock's DEPENDENCIES. This
#      catches a hand-edited checksum, and it is the assertion that would have
#      named FirebaseAppCheck directly — a grep for "AppCheck" in the lock
#      looks reassuring because the transitive `FirebaseAppCheckInterop` and
#      `AppCheckCore` are present while the pod itself is not.
#
# Known limitation, stated rather than discovered later: this reads the Podfile
# as TEXT and cannot evaluate Ruby. A pod declared inside a conditional
# (`if ENV['X'] … end`) is counted even when CocoaPods would not install it, so
# a legitimately-absent entry would be reported as missing; a pod declared
# dynamically (`%w[A B].each { |p| pod p }`) carries no literal `pod 'Name'`
# token and is invisible here. Neither shape exists in iosApp/Podfile today.
# If one is ever introduced, this check must move to `pod ipc podfile-json`
# (which asks CocoaPods itself) rather than being loosened — the whole point is
# that it costs nothing and runs on every PR.
#
# It is also deliberately not a substitute for `pod install --deployment`: a
# lock hand-crafted with a genuine checksum and a fabricated DEPENDENCIES line
# would pass here. That remains caught for real in every iOS build job. This is
# the cheap check that runs where the mistake is MADE.
#
# Usage: bash scripts/check-podfile-lock-sync.sh
#        SHYTALK_REPO=/path/to/repo bash scripts/check-podfile-lock-sync.sh
set -uo pipefail

REPO="${SHYTALK_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PODFILE="$REPO/iosApp/Podfile"
LOCK="$REPO/iosApp/Podfile.lock"

fail() {
  printf '\033[1;31mFAIL\033[0m %s\n' "$*" >&2
  return 1
}

remedy() {
  cat >&2 <<'EOF'

  Fix:  cd iosApp && pod install
  Then commit BOTH iosApp/Podfile and iosApp/Podfile.lock.

  Committing a Podfile without its regenerated lock breaks every iOS build:
  the Pods cache key is derived from the lock, so an unchanged lock means the
  stale Pods directory is restored and the new pod is never installed.
EOF
}

[ -f "$PODFILE" ] || { fail "no Podfile at $PODFILE"; exit 1; }
[ -f "$LOCK" ] || { fail "no Podfile.lock at $LOCK (Podfile exists)"; remedy; exit 1; }

# --- 1. checksum ------------------------------------------------------------
# `shasum -a 1` on macOS, `sha1sum` on Linux; both print "<hex>  <file>".
if command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 1 "$PODFILE" | awk '{print $1}')"
elif command -v sha1sum >/dev/null 2>&1; then
  ACTUAL="$(sha1sum "$PODFILE" | awk '{print $1}')"
else
  fail "neither shasum nor sha1sum is available — cannot verify the Podfile checksum"
  exit 1
fi

RECORDED="$(sed -n 's/^PODFILE CHECKSUM: \([0-9a-f]\{40\}\)$/\1/p' "$LOCK" | tail -1)"

STATUS=0
if [ -z "$RECORDED" ]; then
  fail "Podfile.lock has no PODFILE CHECKSUM line"
  STATUS=1
elif [ "$RECORDED" != "$ACTUAL" ]; then
  fail "Podfile.lock was generated from a DIFFERENT Podfile"
  printf '  recorded: %s\n  actual:   %s\n' "$RECORDED" "$ACTUAL" >&2
  STATUS=1
fi

# --- 2. every declared pod is resolved --------------------------------------
# The `^[[:space:]]*pod` anchor is what excludes a commented-out `# pod 'Foo'`
# — a comment is not a declaration, and counting one would turn every
# explanatory note in the Podfile into a build failure (iosApp/Podfile
# documents the LiveKit-to-SPM migration in exactly that shape). An explicit
# comment-stripping grep was tried here first and mutation testing showed it
# to be dead code: the anchor already did the job, and the redundant filter
# meant the mutant could not redden anything.
#
# Subspecs (`pod 'A/B'`) resolve under their parent, so only the portion
# before the slash is compared.
DECLARED="$(sed -n "s/^[[:space:]]*pod[[:space:]]*['\"]\([^'\"\/]*\).*/\1/p" "$PODFILE" | sort -u)"

# The DEPENDENCIES section only — the full PODS list includes every transitive
# dependency, which is what makes a naive grep look reassuring.
RESOLVED="$(awk '/^DEPENDENCIES:/{f=1;next} f&&/^[A-Z]/{f=0} f' "$LOCK" \
  | sed -n 's/^[[:space:]]*-[[:space:]]*"\{0,1\}\([^[:space:]"(]*\).*/\1/p' \
  | sed 's|/.*||' | sort -u)"

MISSING=""
while IFS= read -r pod; do
  [ -n "$pod" ] || continue
  printf '%s\n' "$RESOLVED" | grep -qxF "$pod" || MISSING="$MISSING $pod"
done <<EOF
$DECLARED
EOF

if [ -n "$MISSING" ]; then
  fail "Podfile.lock does not resolve:$MISSING"
  STATUS=1
fi

if [ "$STATUS" -ne 0 ]; then
  remedy
  exit 1
fi

printf '\033[1;32m  ok\033[0m Podfile.lock is in sync with Podfile\n'
