# Pipeline Redesign — Split Monolith Into Focused Workflows

**Date:** 2026-03-19
**Status:** Spec
**Goal:** Replace the 1232-line `release.yml` monolith (9.5% PR success rate) with 6 focused workflows that are independently debuggable and reliable.

---

## Current Problems

- `release.yml` handles PR checks, dev deploys, `/deploy` distribution, production approval, E2E tests, version bumps, merges, prod deploys, and failure alerts — all in one file.
- 9.5% PR success rate (17/179 runs), 71% cancelled, 19.5% failure.
- SonarCloud configured two ways (Gradle plugin + standalone scanner), both broken differently.
- Android E2E has never run successfully in CI.
- Playwright tests fail with 401 auth errors on `test/setup`.
- Complex `if`/`always()` chains make failures cascade unpredictably.
- Build retry hack (`|| retry`) masks real failures.
- `environment.properties` has leading whitespace breaking Allure parsing (both Android and Playwright heredocs).
- Comment-based triggers (`/deploy`, `/run-e2e`) add parsing complexity.

## Architecture Overview

```
PR push ─────→ pr-checks.yml       (lint, build, test, sonar, E2E smoke)
Manual ──────→ deploy-dev.yml      (deploy to dev + distribute to testers)
Manual ──────→ e2e-tests.yml       (full device matrix)
Merge to main → release.yml        (semver bump, GitHub release + tag — no deploy)
Manual ──────→ deploy-prod.yml     (deploy a chosen release tag to production)
Dependabot ──→ dependabot-auto-merge.yml (unchanged)
```

All manual triggers use `workflow_dispatch`. No comment-based triggers anywhere.

**PR merge model:** The developer merges PRs manually via the GitHub UI (or `gh pr merge`). Merging creates a versioned GitHub release automatically. Production deployment is a separate, deliberate action — you choose which release tag to deploy.

---

## Workflow 1: `pr-checks.yml`

**Trigger:** `pull_request → main` (opened, synchronize, reopened)
**Purpose:** Fast feedback — is this code good enough to merge?

**Concurrency:**
```yaml
concurrency:
  group: pr-checks-${{ github.head_ref }}
  cancel-in-progress: true
```

### Jobs

```
detect-changes ──┬── lint (conditional on app/backend changes)
                 ├── sonarcloud (workflow_call, blocking, if not workflow-only)
                 ├── build-and-test (unit tests + devRelease APK, if app changed)
                 ├── test-backend (Jest, if backend changed)
                 └── android-e2e-smoke (needs build-and-test, single device, if app changed)
```

### Details

- **detect-changes**: Same logic as today. Outputs: `app_changed`, `backend_changed`, `web_changed`, `workflow_only`.
- **lint**: Calls existing `lint.yml` (workflow_call). Conditional on app or backend changes.
- **sonarcloud**: Calls rewritten `sonarcloud.yml` (workflow_call). Depends on `build-and-test` so that Kotlin JUnit reports exist for coverage. Uses Gradle plugin only. Blocking — failure prevents merge, but does NOT cascade to other parallel jobs.
- **build-and-test**: Runs `./gradlew testDevDebugUnitTest assembleDevRelease`. Requires keystore decode step (same as current `release.yml` lines 230-233: decode `KEYSTORE_BASE64` secret to `keystore.jks`). Also requires `GOOGLE_SERVICES_DEV_BASE64` decode. No retry. Uploads APK as artifact. Publishes unit test report via `EnricoMi/publish-unit-test-result-action`.
- **test-backend**: Calls existing `test-backend.yml` (workflow_call, passing `ref: ${{ github.event.pull_request.head.sha }}`). If backend changed.
- **android-e2e-smoke**: Calls `e2e-tests.yml` (workflow_call) with `android: '33-phone'`, `ios: 'none'`, `web: 'none'`, `parallel: true`, `ref: ${{ github.event.pull_request.head.sha }}`. Single device smoke test. Needs `build-and-test` to complete first (APK built). Runs only if app changed. Uses `secrets: inherit`.

### Cross-workflow APK sharing

The `build-and-test` job uploads the APK via `actions/upload-artifact` with name `dev-release-apk`. The `deploy-dev.yml` workflow can download it cross-workflow using `actions/download-artifact` with the `run-id` parameter. To find the right run:

```bash
# Find latest successful pr-checks run for the given ref
RUN_ID=$(gh api "repos/$REPO/actions/workflows/pr-checks.yml/runs?head_sha=${REF}&status=success&per_page=5" \
  --jq '.workflow_runs[0].id // empty')
```

If no cached artifact is found, `deploy-dev.yml` builds from scratch (fallback).

---

## Workflow 2: `deploy-dev.yml`

**Trigger:** `workflow_dispatch` only.
**Purpose:** On-demand deploy to dev environment and/or distribute to testers.

### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `backend` | boolean | true | Deploy Express API to London dev server |
| `web` | boolean | true | Deploy web to Cloudflare Pages dev |
| `android-testers` | boolean | true | Build APK + distribute via Firebase App Distribution |
| `ios-testers` | boolean | true | Archive + upload to TestFlight |
| `playwright` | boolean | true | Run Playwright tests after deploy |

**Note:** `ref` defaults to the branch selected in the GitHub UI when triggering `workflow_dispatch`. No explicit input needed — `github.ref` provides this automatically.

### Jobs

```
deploy-backend-dev ── verify-health
deploy-web-dev
distribute-android (try download artifact → build if miss → Firebase App Distribution)
distribute-ios (archive → TestFlight)
playwright-tests (after deploy-backend-dev + deploy-web-dev, if enabled)
```

### Details

- **deploy-backend-dev**: SSH to London (145.241.224.13), tar + deploy + `pm2 restart`. Health check with 5 retries. Deploys Firestore + RTDB rules to dev.
- **deploy-web-dev**: `wrangler pages deploy` to Cloudflare. Injects `DEV_FIREBASE_API_KEY`.
- **distribute-android**: Attempts to download APK artifact from the latest successful `pr-checks.yml` run matching the current ref (using `gh api` + `actions/download-artifact` with `run-id`). If no artifact found, falls back to building `assembleDevRelease` from scratch (requires keystore + google-services decode). Uploads to Firebase App Distribution with auto-generated release notes.
- **distribute-ios**: Full Xcode archive → export IPA → `altool` upload to TestFlight. Skips if no app changes detected vs main.
- **playwright-tests**: Calls `e2e-tests.yml` (workflow_call) with `android: 'none'`, `ios: 'none'`, `web: 'all'`, `ref: ${{ github.sha }}`. Uses `secrets: inherit` so environment secrets (`TEST_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) propagate correctly to the called workflow's `environment: dev` jobs. Runs after backend + web deploys complete.

---

## Workflow 3: `e2e-tests.yml`

**Trigger:** `workflow_call` + `workflow_dispatch`.
**Purpose:** Run E2E tests across device/browser matrices.
**Changes:** Bug fixes only, no structural changes.

### Bug fixes

1. **environment.properties whitespace (Android)**: Remove leading spaces from heredoc content at lines 208-213. Use unindented heredoc or `sed` to strip leading whitespace.
2. **environment.properties whitespace (Playwright)**: Same fix needed at lines 326-331 — identical leading whitespace bug in the Playwright section.
3. **Playwright 401**: Ensure `TEST_API_KEY` secret is configured in the `dev` GitHub Environment (not just repo-level secrets). The `test-playwright` job already references `environment: dev` (line 278), which is correct. Verify the secret exists in that environment.
4. **Allure environment merge**: No changes needed (already fixed in PR #166).

### Inputs (unchanged)

- `android`: Device filter (all, none, or specific like `33-phone`)
- `ios`: Device filter
- `web`: Browser filter
- `parallel`: Boolean (default: true)
- `ref`: Git ref (required for workflow_call)

### Secret propagation

When called via `workflow_call`, the caller must use `secrets: inherit`. The `test-playwright` job's `environment: dev` declaration handles environment-scoped secret access within the called workflow — this is supported by GitHub Actions.

---

## Workflow 4: `release.yml`

**Trigger:** `push → main`
**Purpose:** Version bump and GitHub release creation only. No deployment.

### Skip condition

Skip the entire workflow if the commit message starts with `chore: release v` (the version bump commit message pattern). This avoids re-triggering on the version bump commit.

**Note on tokens:** The version bump push uses `RELEASE_TOKEN` (a fine-grained PAT) to bypass branch protection on main. Unlike `GITHUB_TOKEN`, PAT pushes DO trigger other workflows. The `check-skip` job is therefore the **primary** guard against infinite loops — it skips when the commit message matches `chore: release v*`.

```yaml
on:
  push:
    branches: [main]

jobs:
  check-skip:
    runs-on: ubuntu-latest
    outputs:
      should_skip: ${{ steps.check.outputs.skip }}
    steps:
      - name: Check if release commit
        id: check
        env:
          COMMIT_MSG: ${{ github.event.head_commit.message }}
        run: |
          if [[ "$COMMIT_MSG" == chore:\ release\ v* ]]; then
            echo "skip=true" >> "$GITHUB_OUTPUT"
          else
            echo "skip=false" >> "$GITHUB_OUTPUT"
          fi
```

Uses `github.event.head_commit.message` (available on `push` events without checkout).

### Jobs

```
check-skip
detect-changes (if not skipped, if not workflow-only)
prepare-release (semver bump + release notes + commit + GitHub release + tag)
```

That's it. No approval gate, no deploy, no alert. Just versioning and release creation.

### Semantic versioning

**Starting version:** 0.54.0 (preserves current minor, starts patch at 0).

The `build.gradle.kts` version must be updated to three-part semver (`0.54.0`) as part of the migration PR — this is a prerequisite for the first `release.yml` run. The version parsing logic will always expect `MAJOR.MINOR.PATCH` format.

**Bump rules** — parsed from the squashed commit message:

| Commit prefix | Bump | Example |
|---------------|------|---------|
| `feat:` | MINOR | 0.54.0 → 0.55.0 |
| `fix:` | PATCH | 0.54.0 → 0.54.1 |
| `BREAKING CHANGE` (in body or footer) | MAJOR | 0.54.0 → 1.0.0 |
| `feat!:` (breaking feat) | MAJOR | 0.54.0 → 1.0.0 |
| Anything else (`chore:`, `docs:`, `ci:`, etc.) | PATCH | 0.54.0 → 0.54.1 |

**Implementation:**
- Parse the HEAD commit message on main.
- Extract current version from `app/build.gradle.kts` (`versionName` — expects `"X.Y.Z"` format).
- Apply bump. Update both `versionName` (semver string) and `versionCode` (integer, +1 each release).
- Commit: `chore: release v{NEW_VERSION}` by `github-actions[bot]`.
- Push using `RELEASE_TOKEN` (a fine-grained PAT that bypasses branch protection). Since PAT pushes DO re-trigger workflows, the `check-skip` job is the primary guard against infinite loops — the version bump commit message `chore: release v*` matches the skip condition.
- Create GitHub release with tag `v{NEW_VERSION}` pointing at the version bump commit.

### Release notes

Generated from the squashed commit message.

**Prerequisite:** Repository squash merge settings must be configured to include individual commit messages in the squash commit body (GitHub repo settings → Pull Requests → "Default commit message" → "Pull request title and commit details"). If configured to use "Pull request title" only, release notes will contain just the PR title.

Release notes generation:
- PR title becomes the release title.
- Individual commit messages (from the squash body) become bullet points.
- `chore:`, `ci:`, `build:` prefixed lines filtered out.
- Truncated to 500 chars for Google Play `internal.txt`.
- Full notes attached to the GitHub release.

---

## Workflow 5b: `deploy-prod.yml` (new)

**Trigger:** `workflow_dispatch` only.
**Purpose:** Deploy a chosen release to production. Fully manual and deliberate.

**Concurrency:**
```yaml
concurrency:
  group: deploy-prod
  cancel-in-progress: false  # don't cancel — let the current deploy finish, queue the next
```

### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `release-tag` | string | (required) | Release tag to deploy (e.g. `v0.55.0`) |
| `backend` | boolean | true | Deploy Express API to Singapore prod server |
| `web` | boolean | true | Deploy web to Cloudflare Pages prod |
| `android` | boolean | true | Build prodRelease + upload to Play Store internal track |
| `ios` | boolean | true | Build iOS + upload to App Store Connect |

### Jobs

```
validate-release (verify the tag exists and points to a commit on main)
deploy-backend-prod (SSH to Singapore, deploy API + Firestore/RTDB rules)
deploy-web-prod (Cloudflare Pages prod)
deploy-android-prod (build prodRelease from tag → Play Store internal track)
deploy-ios-prod (Xcode archive from tag → App Store Connect)
alert-desync (create issue if any deploy fails)
```

### Details

- **validate-release**: Checks out the tag, verifies it exists and is on main. Extracts the version for downstream jobs. Fails fast if the tag doesn't exist.
- **deploy-backend-prod**: SSH to Singapore (213.35.98.160). Archives previous version first (rollback safety). Tar + deploy + `pm2 restart`. Health check with 5 retries. Deploys Firestore + RTDB rules to prod project (`shytalk-7ba69`).
- **deploy-web-prod**: `wrangler pages deploy` to Cloudflare prod. Injects `PROD_FIREBASE_API_KEY`.
- **deploy-android-prod**: Builds `assembleProdRelease bundleProdRelease` from the tag. Runs `testProdReleaseUnitTest` as smoke test. Uploads AAB to Play Store internal track via `r0adkll/upload-google-play`. Requires keystore + google-services (both dev + prod) decode.
- **deploy-ios-prod**: Full Xcode archive → export IPA → App Store Connect upload. Requires Apple signing certificate, provisioning profile, and App Store Connect API key.
- **alert-desync**: If any deploy job fails, creates a GitHub issue with `critical` + `prod-desync` labels, mentioning the release tag and which component failed.

### Rollback

To roll back, simply trigger `deploy-prod.yml` again with an older release tag. Since every release is tagged, any previous version can be redeployed.

---

## Workflow 5: `sonarcloud.yml` (rewrite)

**Trigger:** `workflow_call` only (called by `pr-checks.yml`).
**Purpose:** Run SonarCloud analysis using the Gradle plugin.

### Dependency

`pr-checks.yml` must call `sonarcloud.yml` AFTER `build-and-test` completes, so that:
- Kotlin JUnit test reports exist at `shared/build/test-results/jvmTest` (referenced by `sonar.junit.reportPaths` in `build.gradle.kts`).
- Express API coverage report exists at `express-api/coverage/lcov.info`.

### Inputs

The rewritten `sonarcloud.yml` keeps the existing `ref` input (required for `workflow_call`):
```yaml
on:
  workflow_call:
    inputs:
      ref:
        description: 'Git ref to check out'
        type: string
        required: true
```

Called from `pr-checks.yml` with `ref: ${{ github.event.pull_request.head.sha }}`.

### Steps

1. Checkout code at the given `ref` (with `fetch-depth: 0` for blame data).
2. Set up JDK 17.
3. Set up Node 24.
4. Run Express API tests with coverage: `cd express-api && npm ci && npx jest --coverage --coverageReporters=lcov || true`.
5. Decode `GOOGLE_SERVICES_DEV_BASE64` (required for Gradle configuration).
6. Run `./gradlew sonar -Dsonar.token=$SONAR_TOKEN -x :app:sonar`.

The Gradle plugin config in `build.gradle.kts` handles all source paths, exclusions, and coverage report paths. `:app` module remains excluded (AGP 8+ incompatibility with SonarQube plugin v7).

### Removed

- Standalone `sonar-scanner` CLI download and invocation (was the old approach in `sonarcloud.yml`).

---

## Other file changes

### `force-cancel.yml`

Update to cancel ALL workflow types:
```javascript
const workflows = ['release.yml', 'pr-checks.yml', 'deploy-dev.yml', 'deploy-prod.yml', 'e2e-tests.yml'];
```

Note: `lint.yml`, `test-backend.yml`, and `sonarcloud.yml` are `workflow_call`-only — they run as part of their caller's workflow run and are cancelled when the caller is cancelled. No need to list them separately.

### `e2e-trigger.yml`

**Delete.** No comment-based triggers. E2E tests are triggered via `e2e-tests.yml` workflow_dispatch directly from the GitHub Actions UI.

### `dependabot-auto-merge.yml`

**Unchanged.** Note: when dependabot auto-merges a patch update to main, `release.yml` fires and creates a PATCH version bump automatically. Dependabot PRs typically have titles like `chore(deps): bump X from Y to Z`, which maps to PATCH. This is desired — dependency updates get versioned.

### `app/build.gradle.kts`

Change initial version to three-part semver (required before first `release.yml` run):
```kotlin
versionCode = 54
versionName = "0.54.0"
```

---

## Migration plan

1. Create all new/rewritten workflows on a feature branch. The old `release.yml` is **replaced** (not added alongside) in the same commit that introduces `pr-checks.yml`, preventing duplicate PR-triggered runs.
2. Update `app/build.gradle.kts` version to `"0.54.0"` in the same branch.
3. Test `pr-checks.yml` by opening the PR itself (it triggers on `pull_request`).
4. Test `deploy-dev.yml` via workflow_dispatch from the feature branch.
5. Test `e2e-tests.yml` bug fixes via workflow_dispatch.
6. Merge to main → validates `release.yml` (first semver release, likely 0.55.0 since this is a `feat:` PR).
7. Test `deploy-prod.yml` by deploying the newly created release tag to production.

---

## Success criteria

- PR checks complete reliably without cascading failures.
- SonarCloud runs after build-and-test, blocks on failure, independently of other jobs.
- `deploy-dev.yml` deploys chosen components via checkbox UI.
- Merging to main creates a GitHub release with semver tag and release notes (no deploy).
- `deploy-prod.yml` deploys a chosen release tag to production via checkbox UI.
- Deploying an older tag works as a rollback mechanism.
- Android E2E smoke test runs on at least one device during PR checks.
- Playwright tests pass in CI (401 auth issue fixed).
- No comment-based triggers remain.
- `force-cancel.yml` can cancel all active workflows.
