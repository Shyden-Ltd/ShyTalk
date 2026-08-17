#!/usr/bin/env bash
# check-web-pages-have-lang-resolver.sh (SHY-0181)
#
# Every owned web page MUST load the shared language resolver
# (public/js/language-selector.js) so the site-wide `?lang=` locale flag
# works on it — now and for any page added in the future. This guard fails
# CI if a `public/**/*.html` page omits the resolver, naming each offender.
#
# Why a guard: the `?lang=` flag is a single-point fix in getLanguage(), but
# it only reaches a page that actually includes language-selector.js. Without
# this guard a new page could silently ship untranslatable-by-flag.
#
# Usage: check-web-pages-have-lang-resolver.sh [ROOT]   (ROOT default: public)
# Exit 0 = every page includes the resolver; 1 = one or more don't; 2 = usage.
set -euo pipefail

ROOT="${1:-public}"
RESOLVER='language-selector.js'
# Anchor on an actual <script ... src="...language-selector.js"...> include, so
# a bare filename mention (a comment, a <meta>, prose) does NOT falsely pass.
RESOLVER_INCLUDE='<script[^>]*src="[^"]*language-selector\.js'

if [ ! -d "$ROOT" ]; then
  echo "check-web-pages-have-lang-resolver: root '$ROOT' not found" >&2
  exit 2
fi

missing=0
# -print0 / read -d '' handles any path safely.
while IFS= read -r -d '' page; do
  if ! grep -qE "$RESOLVER_INCLUDE" "$page"; then
    echo "MISSING language resolver ($RESOLVER): ${page}" >&2
    missing=$((missing + 1))
  fi
done < <(find "$ROOT" -type f -name '*.html' -print0)

if [ "$missing" -gt 0 ]; then
  echo "" >&2
  echo "✗ $missing web page(s) do not load $RESOLVER — the ?lang= flag won't work there." >&2
  echo "  Add: <script src=\"/js/$RESOLVER\"></script> (SHY-0181 / feedback-web-urls convention)." >&2
  exit 1
fi

echo "✓ all web pages under '$ROOT' load $RESOLVER"
