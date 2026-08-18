#!/usr/bin/env bash
# deploy-scope.sh — decide which deploy areas a change set touches (SHY-0347).
#
# Reads changed paths on STDIN, one per line, and writes `area=true|false`
# lines to STDOUT in GitHub Actions output format.
#
#   git diff --name-only "$BASE" "$HEAD" | scripts/deploy-scope.sh
#
# Why a script and not inline YAML: this is the logic that decides whether an
# hour of macOS runner time is spent, so it has to be testable without
# dispatching a workflow.
#
# FAIL-SAFE BY DESIGN. Empty input means "I could not work out what changed",
# not "nothing changed" — a caller that cannot resolve a baseline must deploy
# EVERYTHING rather than silently skip. A deploy that runs when it needn't costs
# runner minutes; one that is skipped when it was needed ships nothing and
# nobody notices.
set -euo pipefail

backend=false
web=false
android=false
ios=false
saw_any=false

# `|| [ -n "$path" ]` catches a final line with NO trailing newline, which
# `read` otherwise discards — the caller pipes `git diff --name-only`, and a
# dropped last path would silently under-deploy.
while IFS= read -r path || [ -n "$path" ]; do
  [ -z "$path" ] && continue
  saw_any=true
  case "$path" in
    # ── backend ────────────────────────────────────────────────────────────
    express-api/src/*|express-api/package.json|express-api/package-lock.json|firestore.rules|firestore.indexes.json|functions/*|database.rules.json)
      backend=true ;;
    # ── web ────────────────────────────────────────────────────────────────
    public/*)
      web=true ;;
    # ── shared Kotlin: BOTH apps ───────────────────────────────────────────
    shared/src/commonMain/*|shared/build.gradle.kts|gradle/libs.versions.toml|gradle/wrapper/*|build.gradle.kts|settings.gradle.kts|gradle.properties)
      android=true; ios=true ;;
    shared/src/androidMain/*)
      android=true ;;
    shared/src/iosMain/*)
      ios=true ;;
    # ── per-platform app code ──────────────────────────────────────────────
    app/*)
      android=true ;;
    iosApp/*)
      ios=true ;;
    # Everything else — stories, tests, workflows, README — deploys nothing.
    *) ;;
  esac
done

# No input at all: the caller could not produce a diff. Fail safe.
if [ "$saw_any" = false ]; then
  echo "backend=true"; echo "web=true"; echo "android=true"; echo "ios=true"
  echo "reason=no-diff-available-failing-safe"
  exit 0
fi

echo "backend=$backend"
echo "web=$web"
echo "android=$android"
echo "ios=$ios"
echo "reason=derived-from-diff"
