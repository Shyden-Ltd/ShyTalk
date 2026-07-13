#!/usr/bin/env bash
# check-app-web-urls-env-derived.sh (SHY-0182 / EPIC-0007)
#
# The app must build every web-page URL it opens from BuildVariant.environment
# (via WebUrls), never a hardcoded cross-environment literal — the hard rule
# [[feedback-web-urls-env-derived-never-cross]]. This guard fails CI if any
# app RUNTIME source hardcodes a web-page URL that should be env-derived,
# naming each offender.
#
# What it forbids (outside the WebUrls single-source-of-truth + test sources):
#   1. the dev web host `dev.shytalk.shyden.co.uk` — its ONLY legitimate use is
#      inside WebUrls; anywhere else is a cross-env leak. (Note: `dev-api.` is a
#      different host and is NOT matched — the `dev\.` anchor requires the dot.)
#   2. a legal page URL on the shytalk web host —
#      `shytalk.shyden.co.uk/{privacy,terms,community-guidelines,cyber-bullying}.html`
#      — these must come from WebUrls.legal(), not a literal.
#
# Deliberately NOT matched (out of scope for this guard): `roadmap.html`
# (roadmap-notification feature, its own concern), `*-api.shytalk...`,
# `images.shytalk...`, `livekit*.shytalk...`, and the bare domain used as an
# email link domain — none are app-opened web PAGES this story owns.
#
# Usage: check-app-web-urls-env-derived.sh [ROOT...]   (default roots below)
# Exit 0 = clean; 1 = one or more hardcoded literals found; 2 = usage/config.
set -euo pipefail

# App RUNTIME source roots (no test sources — tests legitimately assert the
# literal hosts). iosApp holds the Swift entrypoint + AppEnvironment.
DEFAULT_ROOTS=(
  "shared/src/commonMain"
  "shared/src/androidMain"
  "shared/src/iosMain"
  "app/src/main"
  "iosApp"
)
ROOTS=("$@")
if [ "${#ROOTS[@]}" -eq 0 ]; then
  ROOTS=("${DEFAULT_ROOTS[@]}")
fi

# The single source of truth is allowed to hold the host literals.
SSOT_BASENAME='WebUrls.kt'

# Forbidden literals (extended regex). Kept as an explicit list so each match
# is self-documenting and the legal-page set is exact.
FORBIDDEN='dev\.shytalk\.shyden\.co\.uk|shytalk\.shyden\.co\.uk/(privacy|terms|community-guidelines|cyber-bullying)\.html'

found=0
for root in "${ROOTS[@]}"; do
  [ -d "$root" ] || continue
  # Kotlin + Swift runtime sources only; exclude any test source set + the SSOT.
  while IFS= read -r -d '' file; do
    case "$file" in
      *"/$SSOT_BASENAME") continue ;;
      */test/*|*Test.kt|*Tests.swift|*/androidTest/*|*/commonTest/*|*/jvmTest/*|*/androidHostTest/*) continue ;;
    esac
    # grep -n each offending line; -E extended regex, -H always show file.
    if matches=$(grep -HnE "$FORBIDDEN" "$file"); then
      echo "$matches" | while IFS= read -r line; do
        echo "HARDCODED cross-env web URL: $line" >&2
      done
      found=$((found + 1))
    fi
  done < <(find "$root" -type f \( -name '*.kt' -o -name '*.swift' \) -print0)
done

if [ "$found" -gt 0 ]; then
  echo "" >&2
  echo "✗ $found file(s) hardcode a web-page URL that must be env-derived." >&2
  echo "  Build it via WebUrls.legal(doc, BuildVariant.environment, locale) /" >&2
  echo "  WebUrls.legalForCurrentBuild(doc) instead (SHY-0182)." >&2
  exit 1
fi

echo "✓ no hardcoded cross-env web-page URLs in app runtime source"
