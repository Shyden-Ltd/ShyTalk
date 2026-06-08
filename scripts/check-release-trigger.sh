#!/usr/bin/env bash
# Verify release.yml is workflow_dispatch-only and never auto-fires on push.
#
# Background: every merge to main used to auto-bump the semver and create a
# tagged release. With small-PR cadence, that produced one "release" per
# unrelated change. The agreed flow is: merge freely to main, manually
# trigger Release when a stable batch is ready. This guard prevents the
# `push: branches: [main]` trigger from sneaking back in.
#
# Run from project root.

set -euo pipefail

RELEASE_YML=".github/workflows/release.yml"
DEPLOY_DEV_YML=".github/workflows/deploy-dev.yml"

if [ ! -f "$RELEASE_YML" ]; then
  echo "::error::$RELEASE_YML not found"
  exit 1
fi

# Parse the `on:` block. We accept workflow_dispatch and manual triggers
# only — no `push:` trigger of any kind. This deliberately rejects ALL
# push triggers, not just push-to-main, since any auto-fire-on-merge
# defeats the manual-release purpose.
#
# Use yq if available (more robust against YAML quirks), fall back to grep.
# Allowed triggers: workflow_dispatch (the manual flow) and schedule
# (kept for forward compatibility — we don't currently use it but a
# future cron'd "weekly stable cut" would be reasonable). Any other
# trigger is rejected.
if command -v yq >/dev/null 2>&1; then
  triggers=$(yq '.on | keys | .[]' "$RELEASE_YML")
  if [ -z "$triggers" ]; then
    echo "::error::release.yml has no 'on:' triggers — workflow would be unreachable"
    exit 1
  fi
  while IFS= read -r trigger; do
    case "$trigger" in
      workflow_dispatch|schedule) ;;
      *)
        echo "::error::release.yml has unsupported trigger '$trigger' — must be workflow_dispatch (or schedule) only"
        exit 1
        ;;
    esac
  done <<< "$triggers"
else
  # Grep-based POSITIVE-allowlist check. Enumerate every trigger key
  # found and reject any that isn't in the allowlist. A denylist (eg.
  # `push|pull_request|...`) would silently accept any new GitHub event
  # type added in the future — `merge_group` was a recent example.
  #
  # We refuse inline `on: { key1: ..., key2: ... }` form entirely. It's
  # rare in practice, brace-counting in pure shell is brittle, and
  # forcing block form keeps the parsing logic here trivial. If a real
  # need arises, install `yq` locally (the script's faster path).
  if grep -qE '^on:[[:space:]]*\{' "$RELEASE_YML"; then
    echo "::error::release.yml uses inline 'on: { ... }' which this guard refuses to parse. Use block form (one trigger key per line) — or install yq locally."
    exit 1
  fi

  # Block-style: extract keys at exactly the first indent level under
  # `on:`. The awk script tracks the base indent of the first child
  # encountered and skips anything deeper (which would be sub-keys like
  # `branches:`, `inputs:`, etc.).
  # Run awk + sort + grep without `|| true` so a real pipeline error
  # (locale issue, awk crash) propagates instead of being conflated
  # with the legitimate "no triggers found" case below.
  raw_triggers=$(awk '
    /^on:[[:space:]]*$/ { in_on=1; next }
    in_on && /^[a-z]/ { in_on=0 }
    in_on && /^[[:space:]]+[a-z_]+:/ {
      match($0, /^[[:space:]]+/)
      indent = RLENGTH
      if (!base_indent) base_indent = indent
      if (indent == base_indent) {
        match($0, /[a-z_]+/)
        print substr($0, RSTART, RLENGTH)
      }
    }
  ' "$RELEASE_YML")
  # Sort + dedupe, drop blank lines. `grep -v '^$' ' returns 1 if every
  # line is blank — that's a legitimate "no triggers" outcome, NOT an
  # error. Use `|| [ $? -eq 1 ]` to swallow only that specific exit.
  triggers=$(printf '%s\n' "$raw_triggers" | sort -u | { grep -v '^$' || [ $? -eq 1 ]; })

  if [ -z "$triggers" ]; then
    echo "::error::release.yml has no parseable 'on:' triggers — workflow would be unreachable"
    exit 1
  fi

  while IFS= read -r trigger; do
    case "$trigger" in
      workflow_dispatch|schedule) ;;
      *)
        echo "::error::release.yml has unsupported trigger '$trigger' — must be workflow_dispatch (or schedule) only"
        exit 1
        ;;
    esac
  done <<< "$triggers"
fi

# Verify workflow_dispatch is present (otherwise the workflow can never fire).
if ! grep -qE '^\s*workflow_dispatch:' "$RELEASE_YML"; then
  echo "::error::release.yml is missing 'workflow_dispatch:' trigger — would be unreachable"
  exit 1
fi

# Verify deploy-dev.yml injects an iOS build number from GITHUB_RUN_NUMBER
# so each dev build gets a unique CFBundleVersion (TestFlight rejects
# duplicates). Without this, dropping the auto-release trigger leaves iOS
# stuck on whatever CFBundleVersion is committed in project.pbxproj.
if [ -f "$DEPLOY_DEV_YML" ]; then
  if ! grep -qE 'CFBundleVersion|CURRENT_PROJECT_VERSION' "$DEPLOY_DEV_YML"; then
    echo "::error::deploy-dev.yml does not bump CFBundleVersion / CURRENT_PROJECT_VERSION — iOS dev uploads will hit duplicate-build-number rejections from TestFlight"
    exit 1
  fi
  if ! grep -qE 'GITHUB_RUN_NUMBER|github\.run_number' "$DEPLOY_DEV_YML"; then
    echo "::error::deploy-dev.yml does not reference GITHUB_RUN_NUMBER for build numbering — iOS CFBundleVersion will not be unique per run"
    exit 1
  fi
fi

# Verify the tag-only release shape (SHY-0034, 2026-06-08).
#
# History: the prior 2026-05-10 fix established a PR-based flow
# (Option A from that era): open a release/v* branch PR, auto-merge to
# main, then release-tag.yml creates the tag + Release. That fix solved
# the 2026-05-10 GH013 failure (direct push to main blocked by `PR Gate`
# aggregator) but introduced a different problem: every failed/cancelled
# release run left an orphan release/v* branch, contributing 6 of the
# 506 branches SHY-0033 cleaned up.
#
# SHY-0034 (2026-06-08) refactored release.yml to eliminate the
# ephemeral branch entirely. The new shape:
#   1. createCommitOnBranch GraphQL mutation targets `main` DIRECTLY
#      via the Release App's `bypass_actors` entry on ruleset 12613584
#   2. release-tag.yml then reacts to the push event on main and
#      creates the tag + GitHub Release (unchanged from prior flow)
#
# This guard enforces the new shape so a future regression to the
# PR-based flow OR the original direct-git-push flow trips loudly.

# Reject any `git push` to main from release.yml (still applies — even
# with the bypass actor, push-from-git produces UNSIGNED commits which
# required_signatures rule blocks). createCommitOnBranch is the only
# allowed write path to main from release.yml.
if grep -nE 'git push' "$RELEASE_YML" | grep -qE '\bmain\b|HEAD:main'; then
  echo "::error::release.yml contains a 'git push' targeting main. SHY-0034 mandates that release commits be written via GraphQL createCommitOnBranch (which produces signed commits), NOT via 'git push' (which would produce unsigned commits that required_signatures blocks)."
  grep -nE 'git push' "$RELEASE_YML"
  exit 1
fi

# SHY-0034: release.yml must NOT create release/v* branches anywhere.
# This catches any regression to the prior ephemeral-branch flow.
if grep -qE 'BRANCH="release/v' "$RELEASE_YML"; then
  echo "::error::release.yml contains 'BRANCH=\"release/v...' — SHY-0034 eliminated ephemeral release/v* branches. createCommitOnBranch now targets main directly via the App bypass actor. See [[feedback-no-release-branches-use-tags]]."
  grep -nE 'BRANCH="release/v' "$RELEASE_YML"
  exit 1
fi

# SHY-0034: release.yml must NOT contain `gh pr create` (no release PR
# is opened in the new flow; the signed commit lands on main directly).
if grep -qE 'gh pr create' "$RELEASE_YML"; then
  echo "::error::release.yml contains 'gh pr create' — SHY-0034 removed the release-PR ceremony. createCommitOnBranch targets main directly via the App bypass actor; no PR is opened."
  exit 1
fi

# SHY-0034: release.yml must NOT contain `gh pr merge --auto` (no PR
# to auto-merge in the new flow).
if grep -qE 'gh pr merge.*--auto' "$RELEASE_YML"; then
  echo "::error::release.yml contains 'gh pr merge --auto' — SHY-0034 removed the release-PR + auto-merge ceremony. The signed commit lands on main directly via createCommitOnBranch."
  exit 1
fi

# SHY-0034: positive assertion that createCommitOnBranch targets main.
# The variable assignment `BRANCH="main"` is the canonical anchor.
if ! grep -qE 'BRANCH="main"' "$RELEASE_YML"; then
  echo "::error::release.yml is missing the SHY-0034 canonical anchor 'BRANCH=\"main\"' in the create-commit step. The createCommitOnBranch mutation must target main directly via the Release App's bypass_actors entry on ruleset 12613584."
  exit 1
fi

# The release commit MUST be created server-side via GraphQL
# `createCommitOnBranch`, NOT via `git commit` + `git push`. The latter
# produces UNSIGNED commits regardless of token, which the
# `required_signatures` rule on ruleset 12613584 blocks from being
# squash-merged into main. We hit this exact failure mode on 2026-05-10
# with PR #608 (release/v0.97.6 stuck MERGEABLE/BLOCKED with all
# checks green; gh api revealed `verified: false, reason: "unsigned"`).
if ! grep -qE 'createCommitOnBranch' "$RELEASE_YML"; then
  echo "::error::release.yml does not use GraphQL 'createCommitOnBranch' — release commits would be unsigned and blocked by branch protection's required_signatures rule. Use the GraphQL mutation, not 'git commit' + 'git push'."
  exit 1
fi
# Confirm we're NOT also doing a plain `git commit` of the release
# bump — that would either be dead code OR produce a parallel unsigned
# commit that races the signed one.
if grep -qE '^[[:space:]]+git commit -m "chore: release v' "$RELEASE_YML"; then
  echo "::error::release.yml still contains 'git commit -m \"chore: release v...\"' — that produces an unsigned commit. Remove it; createCommitOnBranch is the source of truth."
  exit 1
fi

# Verify the companion workflow exists and is wired correctly.
RELEASE_TAG_YML=".github/workflows/release-tag.yml"
if [ ! -f "$RELEASE_TAG_YML" ]; then
  echo "::error::$RELEASE_TAG_YML not found. The tag-only release flow (SHY-0034) requires this companion workflow to fire on push to main when the signed 'chore: release vX.Y.Z' commit lands directly via createCommitOnBranch. Without it, releases would land on main but no tag + GitHub Release would ever be created."
  exit 1
fi
# release-tag.yml must trigger on push to main.
if ! grep -qE '^[[:space:]]+- main$' "$RELEASE_TAG_YML"; then
  echo "::error::$RELEASE_TAG_YML must trigger on push to main (look for 'branches: [main]' or '- main')."
  exit 1
fi
# It must short-circuit on non-release commits — match the release-
# commit subject pattern. Without this guard it would try to tag every
# commit on main.
if ! grep -qE 'chore: release v' "$RELEASE_TAG_YML"; then
  echo "::error::$RELEASE_TAG_YML does not look for the 'chore: release v' commit subject pattern. Without that guard it would attempt to tag every push to main."
  exit 1
fi
# It must call gh release create.
if ! grep -qE 'gh release create' "$RELEASE_TAG_YML"; then
  echo "::error::$RELEASE_TAG_YML does not call 'gh release create' — the workflow would never publish a GitHub Release."
  exit 1
fi

echo "✓ release.yml is workflow_dispatch-only and uses tag-only flow (SHY-0034: createCommitOnBranch targets main directly); release-tag.yml fires on release commits; deploy-dev.yml injects unique iOS build number."
