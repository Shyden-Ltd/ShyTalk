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

# Verify the PR-based release shape (Option A from 2026-05-10's
# release-bug fix). Direct push from CI to main is blocked by classic
# branch protection's `PR Gate` required check (a `pull_request`-only
# aggregator that no direct push can ever satisfy). release.yml must
# instead:
#   1. Open a PR with the version-bump commit on a release/* branch
#   2. Enable auto-merge so the PR squashes into main once CI passes
#   3. release-tag.yml then reacts to the squashed commit and creates
#      the tag + GitHub Release
#
# Without these, the next manual Release dispatch would rediscover the
# 2026-05-10 GH013 failure.

# Reject any `git push` line in release.yml that pushes to main. We
# match `git push` followed by anything that includes `main` either as
# a direct refspec or `HEAD:main`. Pushes to `release/v*` branches are
# the only allowed shape — those don't trip branch protection.
# `grep -P` for a Perl-compatible negative-match pattern would be
# cleaner but isn't portable; use a two-step grep instead.
if grep -nE 'git push' "$RELEASE_YML" | grep -qE '\bmain\b|HEAD:main'; then
  echo "::error::release.yml contains a 'git push' targeting main. Direct pushes to main from CI are blocked by branch protection's PR Gate aggregator. Push to release/* branches only and let auto-merge handle the merge."
  grep -nE 'git push' "$RELEASE_YML"
  exit 1
fi

# Verify release.yml uses the PR-based flow.
if ! grep -qE 'gh pr create' "$RELEASE_YML"; then
  echo "::error::release.yml does not contain 'gh pr create' — it should open a release PR rather than push directly."
  exit 1
fi
if ! grep -qE 'gh pr merge.*--auto' "$RELEASE_YML"; then
  echo "::error::release.yml does not enable auto-merge ('gh pr merge --auto'). Without auto-merge the release PR would sit indefinitely waiting for human action."
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
  echo "::error::$RELEASE_TAG_YML not found. The PR-based release flow needs a separate workflow that fires AFTER the release PR merges to create the tag + GitHub Release. Without it, releases would land on main but no tag/release would ever be created."
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

echo "✓ release.yml is workflow_dispatch-only and uses PR-based flow; release-tag.yml fires on release commits; deploy-dev.yml injects unique iOS build number."
