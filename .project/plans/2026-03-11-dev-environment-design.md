# Dev Environment Setup — Design (Final)

## Goal

Two fully isolated environments (Dev + Prod) with automated CI/CD, gated production releases, and comprehensive testing (unit, UI, E2E, web).

## Architecture

Each environment gets its own Firebase project, R2 bucket, API server, and app build flavor.

| Component | Prod (Asia) | Dev (Europe) |
|-----------|-------------|--------------|
| Firebase project | `shytalk-7ba69` | New project (TBD) |
| Firestore location | `asia-southeast1` | `europe-west2` (London) |
| RTDB location | `asia-southeast1` | `europe-west1` (Belgium) |
| API server | Singapore (213.35.98.160) | London (145.241.224.13) |
| API domain | `api.shytalk.shyden.co.uk` | `dev-api.shytalk.shyden.co.uk` |
| R2 bucket | `shytalk-media` | `shytalk-media-dev` (WEUR) |
| CDN domain | `images.shytalk.shyden.co.uk` | `dev-images.shytalk.shyden.co.uk` |
| Web (Cloudflare Pages) | `shytalk-site` → `shytalk.shyden.co.uk` | `shytalk-site-dev` → `dev.shytalk.shyden.co.uk` |
| App name | ShyTalk | ShyTalk DEV |
| App icon | Normal | Debug banner overlay |

## Android Build Flavors

Two product flavors in `app/build.gradle.kts`:

- **`prod`** — Uses prod `google-services.json`, prod API URLs.
- **`dev`** — Uses dev `google-services.json`, dev API URLs, "ShyTalk DEV" label, debug icon overlay.

| Variant | App ID | `BYPASS_DEVICE_CHECKS` | Use |
|---------|--------|------------------------|-----|
| `devDebug` | `com.shyden.shytalk.dev` | `true` | Local dev, CI E2E tests (side-by-side install) |
| `devRelease` | `com.shyden.shytalk` | `false` | Play Store internal track |
| `prodDebug` | `com.shyden.shytalk` | `true` | Local testing against prod |
| `prodRelease` | `com.shyden.shytalk` | `false` | Play Store production track |

Only `devDebug` gets the `.dev` suffix for side-by-side install. All release builds use the base app ID for seamless Play Store track upgrades.

Each flavor has its own `google-services.json`:
- `app/src/prod/google-services.json` (current production file)
- `app/src/dev/google-services.json` (from dev Firebase project)

BuildConfig fields (`API_BASE_URL`, `WORKER_URL`, `LIVEKIT_SERVER_URL`) set per flavor, not from environment variables.

## Express API

Same codebase deployed to both servers. Only the `.env` file differs:

- London `.env`: dev Firebase service account, dev R2 bucket, `NODE_ENV=development`
- Singapore `.env`: prod Firebase service account, prod R2 bucket, `NODE_ENV=production`
- DNS: `dev-api.shytalk.shyden.co.uk` A record → `145.241.224.13`
- Caddy on London configured for `dev-api.shytalk.shyden.co.uk` (auto HTTPS)

## E2E Test Data Strategy

### Test Helper API (dev only)

A route module `express-api/src/routes/test-helpers.js` mounted only when `NODE_ENV !== 'production'`:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/test/setup` | Creates a test scenario from JSON spec. Returns `testRunId` + created IDs. |
| `GET /api/test/verify/:collection/:id` | Reads a Firestore doc for assertion. |
| `POST /api/test/teardown` | Deletes all data for a given `testRunId`. |
| `POST /api/test/reset` | Wipes all test data, restores fixtures to clean state. |

### Test Data Isolation

- All test data tagged with `_testRun: "<testRunId>"` field.
- All test entities use `test_` prefix and `[TEST]` display names.
- Cleanup only deletes documents with matching `_testRun` field — manual testers' data never touched.
- Failsafe cron (`cleanupStaleTestData`) runs every 30 minutes, deletes test data older than 1 hour.
- Endpoints protected by `TEST_API_KEY` header (not Firebase auth).

### Android Test Side

- `TestApiClient` helper class in `androidTest/` wraps OkHttp calls to test helper endpoints.
- Implements JUnit `TestRule` — `@Before` calls setup, `@After` always calls teardown.

### Device Integrity Toggle

- `BuildConfig.BYPASS_DEVICE_CHECKS`: `true` in debug builds, `false` in release builds.
- E2E suite runs on `devDebug` with bypass ON.
- Dedicated test mocks the device check to verify the block screen renders correctly.

## Web Pages

| Component | Prod | Dev |
|-----------|------|-----|
| Cloudflare Pages project | `shytalk-site` | `shytalk-site-dev` |
| Domain | `shytalk.shyden.co.uk` | `dev.shytalk.shyden.co.uk` |
| API URL in admin panel | `api.shytalk.shyden.co.uk` | `dev-api.shytalk.shyden.co.uk` |

Admin panel gets environment config via `public/admin/config.js` that sets the API base URL. Each Cloudflare Pages deployment uses its own config.

## Testing Strategy

### Android
- **Unit tests** — JVM tests, no device needed
- **UI tests** — Compose UI tests with `composeTestRule`
- **E2E journey tests** — Instrumented tests on Gradle Managed Devices, full user flows against dev API with dynamic test data

### Web (Playwright)
- **E2E tests** — Headless browser tests in CI
- Admin panel flows: login, manage users, gifts, banners, RESET confirmation gate
- Landing page: renders correctly, links work

## CI/CD Pipeline

### Single Gated Workflow: `release.yml`

**Trigger:** PR created or updated against `main`

**Concurrency:**
```yaml
concurrency:
  group: release-pipeline
  cancel-in-progress: false  # Never cancel mid-deployment, queue instead
```

Only one PR can be in the pipeline at a time. Others queue.

#### Stage 1: Build, Test & Deploy to Dev (automatic)

1. Build `devRelease` + `devDebug`
2. Run unit tests
3. Run UI tests + E2E tests on Gradle Managed Device (against dev API, using test data)
4. Run Playwright web tests against dev site
5. Deploy `devRelease` → Play Store internal track
6. Deploy Express API → London (dev)
7. Deploy web → `dev.shytalk.shyden.co.uk`
8. Publish all test reports (JUnit + Playwright)
9. Archive previous prod versions as artifacts (for rollback)

**If any test fails → pipeline stops. No deployment.**

External testers get the dev build on the internal track. They can test while the PR is reviewed.

#### ⏸️ Manual Approval Gate

GitHub Environment `production` with required reviewers. An authorized person clicks "Approve" to proceed.

#### Stage 2: Production Release (after approval)

1. Rebase PR onto latest `main` (ensure up to date)
2. Fast rebuild to confirm rebase didn't break anything
3. Build `prodRelease`
4. Run smoke tests against prod API
5. Deploy Express API → Singapore (prod)
6. Upload `prodRelease` → Play Store production track
7. Deploy web → `shytalk.shyden.co.uk`
8. Auto-merge PR to `main`
9. Publish test reports

### Rollback Procedure

**Scenario 1: Prod smoke tests fail before any deployment**
Nothing deployed. Pipeline stops. Fix forward.

**Scenario 2: Partial prod deployment (e.g., API deployed but Play Store upload fails)**
- Each deploy step archives the previous version before deploying.
- If a later step fails, a rollback job restores already-deployed components from archived artifacts.

**Scenario 3: Prod fully deployed but auto-merge fails (CRITICAL)**
- Workflow **force-creates a sync commit on `main`** from the deployed branch.
- Auto-creates a GitHub Issue: `critical` + `prod-desync` labels, assigned to repo owner.
- Posts a PR comment with full details: deployed SHA, which components, manual merge instructions.
- Workflow marks Stage 2 as **failed** (red X visible on PR and Actions tab).
- This requires **immediate attention**.

### Test Reports

- **Android:** `dorny/test-reporter` parses JUnit XML → workflow summary + PR annotations
- **Playwright:** HTML report uploaded as build artifact, summary in workflow
- **Both:** Failed tests block the pipeline with clear error messages

## Test Fixtures

`scripts/seed-dev-fixtures.mjs` creates a repeatable dev dataset (dev Firebase only):

- 3-5 test users with different roles (admin, moderator, regular)
- Full gift catalog
- Sample rooms, conversations, banners, fun facts
- Test economy data (coins, backpack items)

## What Stays Shared

- Git repository (same codebase)
- Cloudflare account (both R2 buckets, both DNS records, both Pages projects)
- Oracle Cloud account (both VMs)
- LiveKit (same project)
