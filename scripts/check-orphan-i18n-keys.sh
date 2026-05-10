#!/usr/bin/env bash
# Reject any HTML data-i18n key that isn't defined in at least one JS
# translation file.
#
# Background: applyLegalTranslations / applyPortalTranslations etc. all
# follow the pattern `if (t[key]) el.innerHTML = t[key];` — silently
# no-opping on undefined keys. That means a `data-i18n="foo"` attribute
# in HTML with no matching `foo:` definition in a JS translation file
# renders as the inline HTML default forever, indistinguishable from
# the intended translation. Three instances bit us 2026-05-09:
#   1. footer_privacy referenced in 5 legal pages, undefined for all
#      20 locales (PR #573 fixed)
#   2. footer_do_not_sell never defined (PR #573 added)
#   3. PORTAL_T.en drifted from HTML defaults in 18 places (PR #576
#      first attempt broke 5 portal-dashboard tests)
#
# This guard greps every public/**/*.html for data-i18n attributes,
# greps every public/**/*.js for `keyname:` object-property syntax in
# files that look like translation modules (contain LEGAL_T / PORTAL_T
# / a translations object), and reports any HTML key with no JS match.
#
# False-negative scope: if an HTML page loads JS file A but the only
# definition of its key is in JS file B, the guard reports OK. For
# ShyTalk this is fine — the namespaces (footer_*, portal_*,
# dashboard_*, security_*, not_found_*, etc.) are distinct enough that
# cross-file matches are practically all valid.
#
# Run from project root.

set -euo pipefail

# Translation files to scan for key definitions. Restricting the JS
# scope avoids false positives from random object literals in app code.
TRANSLATION_FILES=(
  "public/js/legal-translations.js"
  "public/portal/portal-translations.js"
  "public/admin/translations.js"
  "public/js/suggestions-i18n.js"
  "public/js/roadmap-app.js"
  "public/js/event-translations.js"
  "public/js/homepage-translations.js"
)

# Aggregate every `keyname:` definition from translation files. Match
# only lower_snake_case keys (ShyTalk's i18n key convention) to filter
# out noise like `width:` or `color:` from inline style strings.
defined_keys=$(
  for f in "${TRANSLATION_FILES[@]}"; do
    [ -f "$f" ] && grep -hoE '\b[a-z][a-z0-9_]+:' "$f" || true
  done | sed 's/:$//' | sort -u
)

# Aggregate every `data-i18n="key"` AND `data-i18n-aria-label="key"`
# attribute from public HTML files. Both forms route through the same
# silent-no-op pattern in applyLegalTranslations + applyPortalTranslations
# etc., so an undefined aria-label key has the same screen-reader-visible
# regression class as an undefined visual key.
referenced_keys=$(
  {
    grep -rhoE 'data-i18n="[a-z][a-z0-9_]+"' public --include='*.html' \
      | sed -E 's/data-i18n="([^"]+)"/\1/'
    grep -rhoE 'data-i18n-aria-label="[a-z][a-z0-9_]+"' public --include='*.html' \
      | sed -E 's/data-i18n-aria-label="([^"]+)"/\1/'
  } | sort -u
)

# Diff — any HTML key not present in JS keys is an orphan.
all_orphans=$(comm -23 <(echo "$referenced_keys") <(echo "$defined_keys"))

# Filter against the legacy allowlist (pre-existing orphans we haven't
# yet retired — see scripts/i18n-orphan-allowlist.txt for context).
ALLOWLIST="scripts/i18n-orphan-allowlist.txt"
if [ -f "$ALLOWLIST" ]; then
  allowlist_keys=$(grep -vE '^\s*(#|$)' "$ALLOWLIST" | sort -u)
  orphans=$(comm -23 <(echo "$all_orphans") <(echo "$allowlist_keys"))
else
  orphans=$all_orphans
fi

if [ -n "$orphans" ]; then
  echo "::error::Orphan data-i18n keys found in HTML — referenced but not defined in any JS translation file:"
  echo ""
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    echo "  $key"
    # Show which HTML files reference the orphan, to help the dev fix.
    # Match both `data-i18n="key"` and `data-i18n-aria-label="key"`.
    grep -rlE "data-i18n(-aria-label)?=\"${key}\"" public --include='*.html' 2>/dev/null \
      | head -3 \
      | while read -r match_file; do echo "    referenced by: $match_file"; done
  done <<< "$orphans"
  echo ""
  echo "Why this matters: applyLegalTranslations / applyPortalTranslations"
  echo "etc. silently no-op on undefined keys (\`if (t[key]) ...\`), so the"
  echo "HTML inline default renders forever — undetectable without active"
  echo "language-switch testing. Add the missing keys to the appropriate"
  echo "translation file (legal-translations.js / portal-translations.js /"
  echo "admin/translations.js etc.) for ALL 20 locales."
  exit 1
fi

# Also report referenced-key count for visibility (helpful for tracking
# the project's i18n surface area over time).
ref_count=$(echo "$referenced_keys" | grep -c . || echo 0)
def_count=$(echo "$defined_keys" | grep -c . || echo 0)
echo "✓ All $ref_count HTML data-i18n keys have JS definitions ($def_count keys defined across translation files)."
