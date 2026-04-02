# Fully Offline Local Development Environment — Design Spec

**Date:** 2026-03-24
**Branch:** `feat/local-dev-environment`
**PR:** #212

## Goal

Transform the local development environment from "cost-saving" to **fully offline**. One command starts everything — Docker services, Firebase Emulators, Express API, Android build. No cloud services hit during development or CI testing.

## Motivation

- Zero cloud quota consumed during development (dev Spark plan has daily limits)
- CI tests don't interfere with testers using the dev environment
- Works without internet (airplane mode, offline, etc.)
- Faster test feedback — no network latency to cloud services

## Architecture

### Docker Services (docker-compose.yml)

| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| LiveKit | `livekit/livekit-server:v1.8.3` | 7880 (API), 7881, 7882, 50000-50100/udp | Voice rooms |
| MinIO | `minio/minio` | 9002 (S3 API), 9001 (console UI) | S3-compatible object storage (replaces R2) |
| MailHog | `mailhog/mailhog` | 1025 (SMTP), 8025 (web UI) | Email capture + viewing |

**MinIO Docker config:**
```yaml
minio:
  image: minio/minio
  ports:
    - "9002:9000"
    - "9001:9001"
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin
  command: server /data --console-address ":9001"
```

**Port map:**
- 1025: MailHog SMTP
- 3000: Express API
- 4000: Firebase Emulator UI
- 7880: LiveKit
- 8025: MailHog web UI
- 8080: Firestore emulator
- 9000: RTDB emulator
- 9001: MinIO console
- 9002: MinIO S3 API
- 9099: Auth emulator

### Express API Changes

**`r2.js`** — conditional S3 client initialization:

The current code uses `const s3 = new S3Client(...)` at module level. Must change to `let` with conditional branch:

```javascript
const isLocal = process.env.NODE_ENV === 'local';
const bucketName = process.env.R2_BUCKET_NAME || 'shytalk-media';

let s3;
if (isLocal) {
  const minioEndpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9002';
  const minioUser = process.env.MINIO_ROOT_USER || 'minioadmin';
  const minioPass = process.env.MINIO_ROOT_PASSWORD || 'minioadmin';
  s3 = new S3Client({
    endpoint: minioEndpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: minioUser, secretAccessKey: minioPass },
    forcePathStyle: true, // MinIO requires path-style URLs
  });
} else {
  const accountId = process.env.R2_ACCOUNT_ID;
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

// CDN_URL: env var always wins; in local mode defaults to MinIO
const CDN_URL = process.env.CDN_URL
  || (isLocal ? `${process.env.MINIO_ENDPOINT || 'http://localhost:9002'}/${bucketName}` : 'https://images.shytalk.shyden.co.uk');
```

No changes to route files -- same S3 API, different endpoint. `putObject()` returns `${CDN_URL}/${key}` which resolves to MinIO locally.

**Note on CDN_URL for Android:** The Android app loads image URLs stored in Firestore. In local mode, the Express API stores `http://localhost:9002/shytalk-media/...` URLs. The Android emulator accesses localhost via `10.0.2.2`, so Android's Coil image loader needs a URL rewrite interceptor or the network security config must allow cleartext to `10.0.2.2`. Physical devices need `adb reverse tcp:9002 tcp:9002` or the LAN IP. The `local` flavor's network security config already allows cleartext -- this should work with `adb reverse`.

**`email.js`** -- local mode SMTP + OTP logging:

Must short-circuit the SMTP credential guard in `getTransport()`:

```javascript
function getTransport() {
  // Local mode: use MailHog (no auth needed), configurable via env vars
  if (process.env.NODE_ENV === 'local') {
    if (!_transport) {
      _transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '1025', 10),
      });
    }
    return _transport;
  }

  // Production/dev: require SMTP credentials (existing code)
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP not configured');
  }
  // ... rest unchanged
}
```

OTP console logging added in the auth route that sends OTP (not in email.js itself), since `email.js` doesn't know the OTP code -- it only receives HTML. **Must fire BEFORE `sendEmail()`** so the code is visible even if MailHog is down:

```
In routes/auth.js, POST /api/auth/otp/send -- immediately after code is generated, BEFORE sendEmail():
  log("[OTP-LOCAL] Code for <email>: <code>") via the project logger
  then call sendEmail()
```

**`.env.local.example`** -- all env vars with defaults documented:

```env
NODE_ENV=local
PORT=3000

# All values below have sensible defaults for local dev.
# Override only if your setup differs (e.g., remote Docker host, custom ports).

# MinIO (S3-compatible storage, replaces R2)
# MINIO_ENDPOINT=http://localhost:9002
# MINIO_ROOT_USER=minioadmin
# MINIO_ROOT_PASSWORD=minioadmin
# R2_BUCKET_NAME=shytalk-media
# CDN_URL=http://localhost:9002/shytalk-media

# SMTP (MailHog, no auth needed)
# SMTP_HOST=localhost
# SMTP_PORT=1025

# LiveKit (local Docker container)
# LIVEKIT_API_KEY=devkey
# LIVEKIT_API_SECRET=devsecret

# Testing
# TEST_API_KEY=local-test-key
```

### Seed Script Changes

`seed.js` additions:
- Create MinIO bucket `shytalk-media` with public-read policy
- Use AWS SDK (already a dependency) to create bucket via S3 API:

```javascript
// Using @aws-sdk/client-s3 (already in express-api dependencies)
// All values configurable via env vars with local defaults
const minioEndpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9002';
const minioUser = process.env.MINIO_ROOT_USER || 'minioadmin';
const minioPass = process.env.MINIO_ROOT_PASSWORD || 'minioadmin';
const minioBucket = process.env.R2_BUCKET_NAME || 'shytalk-media';

const minioClient = new S3Client({
  endpoint: minioEndpoint,
  region: 'us-east-1',
  credentials: { accessKeyId: minioUser, secretAccessKey: minioPass },
  forcePathStyle: true,
});
// CreateBucketCommand(minioBucket) + PutBucketPolicyCommand for public-read
// Handles BucketAlreadyOwnedByYou/BucketAlreadyExists gracefully
```

### Start Script Flow

Both `start.ps1` and `start.sh` (used for **local development only**, not CI):

```
1. Docker Compose up         -- LiveKit + MinIO + MailHog
2. Firebase Emulators start  -- background process
3. Wait for readiness         -- poll emulators (4000) + MinIO (9002)
4. Seed data                  -- Firestore data + MinIO bucket creation
5. Express API start          -- background, output prefixed with [API]
6. Wait for API ready         -- poll localhost:3000/api/health
7. Build Android APK          -- ./gradlew assembleLocalDebug
8. Install on device          -- adb install if device connected
9. Display ready message      -- all URLs, credentials, APK path (always shown)
10. Wait for Ctrl+C           -- graceful shutdown in reverse order
```

**Note:** CI workflows do NOT use `start.sh` -- they set up services, emulators, and API as separate workflow steps for better control and logging.

### Ready Message Format

```
Local environment ready (fully offline):

  Services:
    Firebase UI:    http://localhost:4000
    Express API:    http://localhost:3000
    MailHog UI:     http://localhost:8025
    MinIO Console:  http://localhost:9001
    LiveKit:        localhost:7880

  Credentials:
    Test admin:     claude-test@shytalk.dev / localdev123
    Test user:      user@test.com / localdev123
    MinIO:          minioadmin / minioadmin

  Android:
    APK path:       app/build/outputs/apk/local/debug/app-local-debug.apk
    Installed on:   Pixel 7 (adb)

  iOS: Supported but not covered here -- development focuses on Android.

  Run tests:        bash local/test.sh (or .\local\test.ps1)
  View Allure:      npx allure serve allure-results

Press Ctrl+C to stop...
```

### Shutdown Order

1. Kill Express API process
2. Wait for Firebase Emulators graceful shutdown (up to 30s, then force-kill)
3. Docker Compose down (stops LiveKit, MinIO, MailHog)

## CI Workflow Changes

### Which suites move to local environment

| Suite | Current backend | New backend | Changes needed |
|-------|----------------|-------------|----------------|
| Kotlin unit tests | Self-contained | Self-contained | None |
| Express API tests | Mocked/self-contained | Self-contained | None |
| Playwright web tests | Dev Firebase | Local emulators + Docker | Workflow changes |
| Android E2E | Dev Firebase | Local emulators + Docker | Workflow + flavor changes |

### CI Job Structure (Playwright + E2E)

GitHub Actions `services:` blocks have limitations (no `command:` support). Use `docker run` steps for MinIO:

```yaml
services:
  mailhog:
    image: mailhog/mailhog
    ports: ['1025:1025', '8025:8025']

steps:
  - checkout
  - name: Start LiveKit
    run: |
      docker run -d --name livekit -p 7880:7880 -p 7881:7881 -p 7882:7882 \
        -v ${{ github.workspace }}/local/livekit.yaml:/etc/livekit.yaml \
        livekit/livekit-server:v1.8.3 --config /etc/livekit.yaml
  - name: Start MinIO
    run: |
      docker run -d --name minio -p 9002:9000 -p 9001:9001 \
        -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
        minio/minio server /data --console-address ":9001"
  - setup Node.js + Java
  - npm install (express-api)
  - Start Firebase Emulators (background)
  - Wait for emulators ready
  - Seed data (Firestore + MinIO bucket, run unconditionally in CI)
  - Start Express API (NODE_ENV=local, background)
  - Serve admin panel (npx serve public -l 8080, for Playwright)
  - Run tests
```

### Flavor Changes for E2E

- Android E2E builds `localDebug` instead of `devDebug`
- CI emulator uses `10.0.2.2` addresses (same as local flavor default)
- **Package name changes:** `com.shyden.shytalk.dev` -> `com.shyden.shytalk.local` in:
  - Gradle task: `connectedLocalDebugAndroidTest` (not `connectedDevDebugAndroidTest`)
  - Allure results pull: `adb exec-out run-as com.shyden.shytalk.local ...`
  - `environment.properties` Allure metadata
  - Any test config referencing the package name
- `app/src/local/google-services.json` already exists in the repo (checked in as placeholder) -- no CI decode step needed for local flavor
- Remove `environment: dev` from CI Playwright/E2E jobs (no cloud secrets needed)
- **Replace hardcoded cloud URLs:**
  - `WEB_BASE_URL`: `https://dev.shytalk.shyden.co.uk` -> `http://localhost:8080`
  - `API_BASE_URL`: `https://dev-api.shytalk.shyden.co.uk` -> `http://localhost:3000`
- Hardcode local credentials: `ADMIN_EMAIL=claude-test@shytalk.dev`, `ADMIN_PASSWORD=localdev123`, `TEST_API_KEY=local-test-key`

### CI Seed Behavior

The `start.sh` checks `if [ ! -d "local/firebase-emulator-data/firestore_export" ]` to skip seeding on repeat runs. In CI, this directory never exists (fresh checkout), so seed always runs. For CI workflow steps, seed is called explicitly and unconditionally as a separate step for clarity.

## Allure Reports

### Local runs
- Tests produce `allure-results/` as usual
- View locally with `npx allure serve allure-results` (opens browser, no upload)
- Test scripts offer to open the report after completion

### CI runs
- Unchanged -- generates report and deploys to GitHub Pages
- No dependency on cloud backend for report generation

## Local Test Runner Scripts

### Individual scripts (one per test type)

| Script | What it runs | Prerequisites |
|--------|-------------|---------------|
| `local/test-unit.sh` / `.ps1` | Kotlin tests + Express API tests | None (self-contained) |
| `local/test-playwright.sh` / `.ps1` | Playwright web tests against local env | Local env running |
| `local/test-e2e.sh` / `.ps1` | Android E2E on connected device/emulator | Local env running + device |
| `local/test-lint.sh` / `.ps1` | ktlint + ESLint | None |

### All-in-one interactive script

`local/test.sh` / `local/test.ps1`:

```
Which tests would you like to run?

  [1] Unit tests (Kotlin + Express API)
  [2] Playwright web tests
  [3] Android E2E tests
  [4] Linters (ktlint + ESLint)
  [5] All tests + linters
  [0] Cancel

Choice:
```

- Checks local environment is running before integration tests (2, 3, 5)
- If not running, offers to start it
- Runs selected tests with Allure enabled
- After completion: shows pass/fail summary, then asks "View Allure report? (y/n)"
- If yes: runs `npx allure serve allure-results` (opens browser)

### Individual script details

**`test-unit.sh` / `.ps1`:**
- Runs `./gradlew test` (Kotlin)
- Runs `cd express-api && npm test` (Express)
- Shows combined pass/fail count
- No local environment needed

**`test-playwright.sh` / `.ps1`:**
- Verifies local env is running (checks localhost:3000/api/health)
- Serves admin panel locally: `npx serve public -l 8080` (background)
- Runs `WEB_BASE_URL=http://localhost:8080 ALLURE_ENABLED=true npx playwright test`
- Stops the local admin panel server after tests
- Shows results + offers Allure report

**`test-e2e.sh` / `.ps1`:**
- Verifies local env is running
- Verifies adb device connected
- Runs `./gradlew connectedLocalDebugAndroidTest` (local flavor, not dev)
- Shows results + offers Allure report

**`test-lint.sh` / `.ps1`:**
- Runs `./gradlew ktlintCheck` (Kotlin linting)
- Runs `cd express-api && npx eslint src/` (JavaScript linting)
- Shows pass/fail for each

### Allure report viewing

All scripts that produce Allure results offer to view them after completion:
```
Tests complete: 28 passed, 0 failed

View Allure report in browser? (y/n): y
Opening report...
```

Runs `npx allure serve allure-results` which generates HTML and opens a local server. No GitHub Pages, no uploads.

## README Updates

All 20 files (English + 19 translations):

1. **Prerequisites** -- Docker required, no cloud accounts for getting started
2. **Local Development** -- one-command flow, all URLs + credentials, new services
3. **Running Tests** -- test scripts documented, Allure report viewing
4. **Optional Services** -- LibreTranslate add-on with manual Docker command
5. **Troubleshooting** -- common problems and solutions
6. **iOS note** -- supported platform, but this README focuses on Android development
7. **Testing in CI** -- note that Playwright/E2E run against local environment (zero cloud)

### Examples and Screenshots

The README must be easy to follow for someone setting up for the first time. Include:

**Inline examples** (shown as code blocks with expected output):
- Full `start.sh` / `start.ps1` terminal output showing each step completing
- Express API health check: `curl http://localhost:3000/api/health` with expected JSON response
- `adb devices` output showing a connected device
- Test runner interactive menu and sample pass/fail output
- Allure report command and what to expect

**Screenshots** (captured during implementation and stored in `local/screenshots/`):
- Firebase Emulator UI (localhost:4000) -- showing seeded users and Firestore data
- MailHog UI (localhost:8025) -- showing a captured OTP email
- MinIO Console (localhost:9001) -- showing the shytalk-media bucket with uploaded images
- Allure report in browser -- showing test results after a local test run
- Android app running on emulator connected to local services

Screenshots are referenced in the README as relative paths: `![Firebase Emulator UI](local/screenshots/firebase-ui.png)`

**Translation notes:**
- All 19 translations must include the same screenshots (images are language-neutral)
- Translate all surrounding text, code comments in examples stay in English
- Inline terminal output examples stay in English (they reflect actual tool output)
- Section headings and explanatory text fully translated

### Troubleshooting Section Topics

- Port already in use (how to find/kill processes)
- Docker not running / containers fail to start
- Firebase emulators fail to start (Java version, port conflicts)
- Android build fails (JDK version, Gradle cache)
- adb device not detected (USB debugging, drivers)
- Images not loading (MinIO bucket not created, CDN_URL wrong, need `adb reverse tcp:9002 tcp:9002` for physical device)
- OTP not arriving (check console output for `[OTP-LOCAL]`, check MailHog UI at localhost:8025)
- Emulator data reset (delete local/firebase-emulator-data/)
- MinIO data reset (docker compose down -v to remove volumes)
- MailHog not receiving emails (check SMTP port 1025, check email.js local mode)

## Out of Scope

- **LibreTranslate** -- 6GB image, optional, documented as manual add-on
- **Google Play purchase verification** -- not used in local dev
- **Google/Apple OAuth** -- use email OTP locally (already documented)
- **iOS build** -- broken (cinterop issues), requires macOS
- **SonarCloud** -- requires cloud upload, not offline-compatible; lint scripts cover local static analysis

## Files Changed

### New files
- `local/test.sh` + `local/test.ps1` -- interactive test runner (choose which suites)
- `local/test-unit.sh` + `local/test-unit.ps1` -- unit tests only
- `local/test-playwright.sh` + `local/test-playwright.ps1` -- Playwright web tests
- `local/test-e2e.sh` + `local/test-e2e.ps1` -- Android E2E tests
- `local/test-lint.sh` + `local/test-lint.ps1` -- linters (ktlint + ESLint)

### Modified files
- `local/docker-compose.yml` -- add MinIO + MailHog services
- `local/start.sh` -- full flow (API, build, ready message with credentials)
- `local/start.ps1` -- same flow for PowerShell
- `local/stop.sh` -- also stop MinIO, MailHog
- `local/stop.ps1` -- same for PowerShell
- `local/seed.js` -- add MinIO bucket creation
- `express-api/src/utils/r2.js` -- conditional S3 client (MinIO in local, R2 in cloud)
- `express-api/src/utils/email.js` -- local mode MailHog transport (short-circuit credential guard)
- `express-api/src/routes/auth.js` -- log OTP codes to console in local mode (before sendEmail)
- `express-api/.env.local.example` -- simplified (no blank cloud fields)
- `.github/workflows/pr-checks.yml` -- Playwright + E2E use local environment
- `.github/workflows/e2e-tests.yml` -- switch to localDebug flavor, update package name, replace cloud URLs
- `README.md` -- updated local dev, testing, troubleshooting sections
- `README.{ar,de,es,fr,hi,id,it,ja,ko,nl,pl,pt,ru,sv,th,tr,uk,vi,zh}.md` -- translations updated
