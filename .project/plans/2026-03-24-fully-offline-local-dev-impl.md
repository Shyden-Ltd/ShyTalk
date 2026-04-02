# Fully Offline Local Development Environment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local development environment fully offline — one command starts Docker services (LiveKit, MinIO, MailHog), Firebase Emulators, Express API, and builds the Android app. Add test runner scripts and migrate CI to use the local environment.

**Architecture:** Express API detects `NODE_ENV=local` and routes storage to MinIO (S3-compatible) and email to MailHog. All endpoints use env vars with sensible local defaults. Start scripts orchestrate the full flow. CI workflows spin up the same local services instead of hitting cloud.

**Tech Stack:** Docker Compose, MinIO (S3), MailHog (SMTP), Firebase Emulators, Express.js, Gradle, PowerShell 5.1+, Bash

**Spec:** `.project/plans/2026-03-24-fully-offline-local-dev-design.md`

---

## File Map

### New files
- `local/test.sh` + `local/test.ps1` — interactive test runner
- `local/test-unit.sh` + `local/test-unit.ps1` — unit tests
- `local/test-playwright.sh` + `local/test-playwright.ps1` — Playwright tests
- `local/test-e2e.sh` + `local/test-e2e.ps1` — Android E2E tests
- `local/test-lint.sh` + `local/test-lint.ps1` — linters
- `local/screenshots/` — README screenshots (captured during Task 12)
- `express-api/tests/utils/r2-local.test.js` — r2.js local mode tests
- `express-api/tests/utils/email-local.test.js` — email.js local mode tests

### Modified files
- `local/docker-compose.yml` — add MinIO + MailHog services
- `local/start.sh` — full flow (Docker, emulators, API, build, ready message)
- `local/start.ps1` — PowerShell equivalent
- `local/stop.sh` — kill API, MinIO, MailHog processes
- `local/stop.ps1` — PowerShell equivalent
- `local/seed.js` — add MinIO bucket creation
- `express-api/src/utils/r2.js` — conditional S3 client (MinIO in local, R2 in cloud)
- `express-api/src/utils/email.js` — local mode MailHog transport
- `express-api/src/routes/auth.js` — OTP console logging in local mode
- `express-api/.env.local.example` — simplified with documented defaults
- `.github/workflows/e2e-tests.yml` — switch to local environment
- `.github/workflows/pr-checks.yml` — Playwright + E2E use local environment
- `README.md` — local dev, testing, troubleshooting, examples, screenshots
- `README.{ar,de,es,fr,hi,id,it,ja,ko,nl,pl,pt,ru,sv,th,tr,uk,vi,zh}.md` — translations

---

### Task 1: Docker Infrastructure — MinIO + MailHog

**Files:**
- Modify: `local/docker-compose.yml`

- [ ] **Step 1: Add MinIO and MailHog services to docker-compose.yml**

Add after the existing `livekit` service in `local/docker-compose.yml`:

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
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5

  mailhog:
    image: mailhog/mailhog
    ports:
      - "1025:1025"
      - "8025:8025"
```

- [ ] **Step 2: Verify containers start**

Run: `docker compose -f local/docker-compose.yml up -d`
Expected: All 3 containers running. Verify:
- `curl -s http://localhost:9002/minio/health/live` returns OK
- `curl -s http://localhost:8025` returns MailHog HTML
- `curl -s http://localhost:7880` returns LiveKit response

- [ ] **Step 3: Stop containers**

Run: `docker compose -f local/docker-compose.yml down`

- [ ] **Step 4: Commit**

```bash
git add local/docker-compose.yml
git commit -m "feat: add MinIO and MailHog to local Docker Compose"
```

---

### Task 2: Express API — r2.js Local Mode + Tests

**Files:**
- Modify: `express-api/src/utils/r2.js:1-35`
- Create: `express-api/tests/utils/r2-local.test.js`

- [ ] **Step 1: Write failing tests for r2.js local mode**

Create `express-api/tests/utils/r2-local.test.js`:

```javascript
const { S3Client } = require('@aws-sdk/client-s3');

jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  const MockS3Client = jest.fn().mockImplementation(() => ({ send: mockSend }));
  return {
    S3Client: MockS3Client,
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    DeleteObjectsCommand: jest.fn(),
    ListObjectsV2Command: jest.fn(),
  };
});

describe('r2.js local mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('creates S3Client with MinIO endpoint in local mode', () => {
    process.env.NODE_ENV = 'local';
    require('../../src/utils/r2');
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://localhost:9002',
        forcePathStyle: true,
      }),
    );
  });

  test('uses MINIO_ENDPOINT env var when set', () => {
    process.env.NODE_ENV = 'local';
    process.env.MINIO_ENDPOINT = 'http://custom-host:9999';
    require('../../src/utils/r2');
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://custom-host:9999' }),
    );
  });

  test('CDN_URL defaults to MinIO in local mode', () => {
    process.env.NODE_ENV = 'local';
    const { CDN_URL } = require('../../src/utils/r2');
    expect(CDN_URL).toBe('http://localhost:9002/shytalk-media');
  });

  test('CDN_URL env var overrides local default', () => {
    process.env.NODE_ENV = 'local';
    process.env.CDN_URL = 'http://custom-cdn:8080/media';
    const { CDN_URL } = require('../../src/utils/r2');
    expect(CDN_URL).toBe('http://custom-cdn:8080/media');
  });

  test('creates S3Client with R2 endpoint in non-local mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    require('../../src/utils/r2');
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://test-account.r2.cloudflarestorage.com',
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd express-api && npx jest tests/utils/r2-local.test.js --verbose`
Expected: FAIL — S3Client not called with MinIO endpoint (current code always uses R2)

- [ ] **Step 3: Implement r2.js conditional client**

Replace **only lines 1-35** of `express-api/src/utils/r2.js` (the imports, client init, and CDN_URL). Everything from `async function putObject` (line 37) through `module.exports` (line 122-132) stays unchanged:

```javascript
/**
 * R2 / MinIO storage client via S3-compatible API.
 *
 * In local mode (NODE_ENV=local), connects to MinIO.
 * In production/dev, connects to Cloudflare R2.
 * All endpoints configurable via env vars.
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

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
    forcePathStyle: true,
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

const CDN_URL = process.env.CDN_URL
  || (isLocal
    ? `${process.env.MINIO_ENDPOINT || 'http://localhost:9002'}/${bucketName}`
    : 'https://images.shytalk.shyden.co.uk');
```

Lines 37 onwards (putObject, getObject, etc.) remain unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd express-api && npx jest tests/utils/r2-local.test.js --verbose`
Expected: All 5 tests PASS

- [ ] **Step 5: Run full Express API test suite to verify no regressions**

Run: `cd express-api && npm test`
Expected: All 1,540+ tests pass

- [ ] **Step 6: Commit**

```bash
git add express-api/src/utils/r2.js express-api/tests/utils/r2-local.test.js
git commit -m "feat: r2.js routes to MinIO in local mode, with env var overrides"
```

---

### Task 3: Express API — email.js Local Mode + Tests

**Files:**
- Modify: `express-api/src/utils/email.js:8-13`
- Create: `express-api/tests/utils/email-local.test.js`

- [ ] **Step 1: Write failing tests for email.js local mode**

Create `express-api/tests/utils/email-local.test.js`:

```javascript
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
  }),
}));

const nodemailer = require('nodemailer');

describe('email.js local mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('uses MailHog transport in local mode without SMTP credentials', async () => {
    process.env.NODE_ENV = 'local';
    // No SMTP_HOST, SMTP_USER, SMTP_PASS set
    const { sendEmail } = require('../../src/utils/email');
    await sendEmail('test@example.com', 'Test Subject', '<p>Test</p>');
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
    });
  });

  test('uses custom SMTP_HOST/PORT in local mode when set', async () => {
    process.env.NODE_ENV = 'local';
    process.env.SMTP_HOST = 'custom-mail';
    process.env.SMTP_PORT = '2525';
    const { sendEmail } = require('../../src/utils/email');
    await sendEmail('test@example.com', 'Test Subject', '<p>Test</p>');
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'custom-mail',
      port: 2525,
    });
  });

  test('throws when SMTP not configured in non-local mode', () => {
    process.env.NODE_ENV = 'production';
    const { sendEmail } = require('../../src/utils/email');
    expect(sendEmail('a@b.com', 's', 'h')).rejects.toThrow('SMTP not configured');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd express-api && npx jest tests/utils/email-local.test.js --verbose`
Expected: FAIL — "SMTP not configured" thrown in local mode

- [ ] **Step 3: Implement email.js local mode bypass**

Replace `getTransport()` function in `express-api/src/utils/email.js` (lines 8-30):

```javascript
function getTransport() {
  if (process.env.NODE_ENV === 'local') {
    if (!_transport) {
      _transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '1025', 10),
      });
      _transportKey = 'local';
    }
    return _transport;
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP not configured');
  }

  const key = `${SMTP_HOST}:${SMTP_PORT}:${SMTP_USER}:${SMTP_PASS}`;
  if (_transport && _transportKey === key) return _transport;

  _transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
  _transportKey = key;

  return _transport;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd express-api && npx jest tests/utils/email-local.test.js --verbose`
Expected: All 3 tests PASS

- [ ] **Step 5: Verify `_resetTransport()` compatibility**

The existing `email.test.js` calls `_resetTransport()` which sets `_transport = null` and `_transportKey = null`. The new local branch sets `_transportKey = 'local'`. Verify that `_resetTransport()` still properly clears state: after calling it, the next `getTransport()` in local mode should create a fresh transport (not reuse the cached one).

Run: `cd express-api && npx jest tests/utils/email.test.js --verbose`
Expected: All existing email tests still pass

- [ ] **Step 6: Run full test suite**

Run: `cd express-api && npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add express-api/src/utils/email.js express-api/tests/utils/email-local.test.js
git commit -m "feat: email.js routes to MailHog in local mode, configurable via env vars"
```

---

### Task 4: Express API — OTP Console Logging

**Files:**
- Modify: `express-api/src/routes/auth.js:123-125`

- [ ] **Step 1: Add OTP console log before sendEmail in auth.js**

At `express-api/src/routes/auth.js`, **after line 124** (where `template` is assigned via `buildOtpEmail(code)`) and **before line 125** (where `sendEmail` is called), insert:

```javascript
    if (process.env.NODE_ENV === 'local') {
      log.info('auth', `[OTP-LOCAL] Code for ${emailLower}: ${code}`);
    }
```

This uses the project's structured logger (already imported as `log`), fires BEFORE `sendEmail()` so the code is visible even if MailHog is down.

- [ ] **Step 2: Run existing auth tests to verify no regressions**

Run: `cd express-api && npx jest tests/routes/auth.test.js --verbose`
Expected: All existing auth tests pass

- [ ] **Step 3: Commit**

```bash
git add express-api/src/routes/auth.js
git commit -m "feat: log OTP codes to console in local mode for quick access"
```

---

### Task 5: Express API — .env.local.example Update

**Files:**
- Modify: `express-api/.env.local.example`

- [ ] **Step 1: Replace .env.local.example with documented defaults**

Replace the entire file with:

```env
# Local Development Environment
# Copy to .env.local — all values have sensible defaults.
# Override only if your setup differs (e.g., remote Docker host, custom ports).
#
# Start emulators first: bash local/start.sh (or .\local\start.ps1)
# Then start API: npm run local

NODE_ENV=local
PORT=3000

# MinIO (S3-compatible storage, replaces Cloudflare R2)
# MINIO_ENDPOINT=http://localhost:9002
# MINIO_ROOT_USER=minioadmin
# MINIO_ROOT_PASSWORD=minioadmin
# R2_BUCKET_NAME=shytalk-media
# CDN_URL=http://localhost:9002/shytalk-media

# SMTP (MailHog — no auth needed)
# SMTP_HOST=localhost
# SMTP_PORT=1025

# LiveKit (local Docker container)
# LIVEKIT_API_KEY=devkey
# LIVEKIT_API_SECRET=devsecret

# Testing
# TEST_API_KEY=local-test-key
```

- [ ] **Step 2: Commit**

```bash
git add express-api/.env.local.example
git commit -m "docs: simplify .env.local.example — all values auto-configured for offline dev"
```

---

### Task 6: Seed Script — MinIO Bucket Creation

**Files:**
- Modify: `local/seed.js`

- [ ] **Step 1: Add MinIO bucket creation to seed.js**

At the top of `seed.js`, after the `firebase-admin` require (line 9), add the S3 imports:

```javascript
const {
  S3Client,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} = require('@aws-sdk/client-s3');
```

Inside the `seed()` function, after the Firestore seeding and before the "Seed complete" message (before `process.exit(0)`), add:

```javascript
  // MinIO bucket (only when MinIO is available)
  const minioEndpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9002';
  try {
    console.log('\nMinIO bucket:');
    const minioClient = new S3Client({
      endpoint: minioEndpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ROOT_USER || 'minioadmin',
        secretAccessKey: process.env.MINIO_ROOT_PASSWORD || 'minioadmin',
      },
      forcePathStyle: true,
    });
    const bucket = process.env.R2_BUCKET_NAME || 'shytalk-media';
    try {
      await minioClient.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`  Created: ${bucket}`);
    } catch (err) {
      if (err.name === 'BucketAlreadyOwnedByYou' || err.name === 'BucketAlreadyExists') {
        console.log(`  Exists:  ${bucket}`);
      } else {
        throw err;
      }
    }
    await minioClient.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [{
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucket}/*`],
          }],
        }),
      }),
    );
    console.log(`  Policy:  public-read on ${bucket}`);
  } catch (err) {
    console.warn('  MinIO not available, skipping bucket creation:', err.message);
  }
```

- [ ] **Step 2: Test seed with Docker running**

Run (requires Docker containers from Task 1):
```bash
docker compose -f local/docker-compose.yml up -d
cd express-api && node ../local/seed.js
```
Expected: "Created: shytalk-media" or "Exists: shytalk-media" + "Policy: public-read"

- [ ] **Step 3: Test seed without Docker (graceful skip)**

Run (with Docker down):
```bash
docker compose -f local/docker-compose.yml down
cd express-api && node ../local/seed.js
```
Expected: "MinIO not available, skipping bucket creation" (no crash)

- [ ] **Step 4: Commit**

```bash
git add local/seed.js
git commit -m "feat: seed script creates MinIO bucket with public-read policy"
```

---

### Task 7: Start Scripts — Full Flow

**Files:**
- Modify: `local/start.sh`
- Modify: `local/start.ps1`

This is the largest task. Both scripts get the same 10-step flow. Implement bash first, then PowerShell.

- [ ] **Step 1: Rewrite start.sh with full flow**

Replace `local/start.sh` entirely. The new script must:
1. Docker Compose up (LiveKit + MinIO + MailHog)
2. Start Firebase Emulators (background)
3. Wait for emulators (poll localhost:4000) + MinIO (poll localhost:9002)
4. Seed data (Firestore + MinIO bucket, from express-api/ dir)
5. Start Express API (background, output prefixed with `[API]`)
6. Wait for API (poll localhost:3000/api/health)
7. Build Android APK (`./gradlew assembleLocalDebug`)
8. Install on device if connected (`adb install`), always show APK path
9. Display ready message (all URLs, credentials, APK path, test hints)
10. Wait for Ctrl+C, then graceful shutdown (kill API, wait for emulators, Docker down)

Key implementation details:
- Express API started with: `cd express-api && NODE_ENV=local node src/index.js 2>&1 | sed 's/^/[API] /' &`
- API PID captured for cleanup
- Trap handles Ctrl+C: kills API, waits for emulators (graceful), then Docker down
- `adb devices` check: `adb devices 2>/dev/null | grep -q "device$"` for device detection
- APK path: `app/build/outputs/apk/local/debug/app-local-debug.apk`

- [ ] **Step 2: Rewrite start.ps1 with same flow**

PowerShell equivalent with same 10 steps. Key differences:
- Use `cmd.exe /c npx` for Firebase emulators (npx is .cmd on Windows)
- Use `Start-Process` for background API with output redirect
- Use `Invoke-WebRequest` for health checks
- Use `Get-Command adb` for device detection
- All strings ASCII only (no em dashes or smart quotes)
- Use `$emulatorProcess.WaitForExit(30000)` for graceful shutdown

- [ ] **Step 3: Test start.sh locally**

Run: `bash local/start.sh`
Expected: All 10 steps complete, ready message shows all URLs and credentials, APK built

- [ ] **Step 4: Test start.ps1 locally**

Run: `.\local\start.ps1`
Expected: Same flow as bash, no parse errors, all services accessible

- [ ] **Step 5: Test Ctrl+C shutdown on both scripts**

Press Ctrl+C in each terminal.
Expected: Graceful shutdown message, all processes stopped, Docker containers down

- [ ] **Step 6: Commit**

```bash
git add local/start.sh local/start.ps1
git commit -m "feat: one-command start — Docker, emulators, API, Android build, ready message"
```

---

### Task 8: Stop Scripts — Updated Shutdown

**Files:**
- Modify: `local/stop.sh`
- Modify: `local/stop.ps1`

- [ ] **Step 1: Update stop.sh**

Ensure it kills all services including any `node src/index.js` API process, Firebase emulators, Java emulator processes, and Docker containers. Already partially done — verify it covers MinIO and MailHog (they're Docker containers, handled by `docker compose down`).

- [ ] **Step 2: Update stop.ps1**

Same for PowerShell. Already partially done from earlier fixes.

- [ ] **Step 3: Test both stop scripts**

Run: `bash local/start.sh` (wait for ready), then in another terminal: `bash local/stop.sh`
Verify: `docker ps` shows no `minio`, `mailhog`, or `livekit` containers running.
Verify: `curl -s http://localhost:3000/api/health` fails (API stopped).
Verify: `curl -s http://localhost:4000` fails (emulators stopped).

Repeat for PowerShell: `.\local\start.ps1` then `.\local\stop.ps1` with same checks.

- [ ] **Step 4: Commit**

```bash
git add local/stop.sh local/stop.ps1
git commit -m "fix: stop scripts handle all services including API and Docker containers"
```

---

### Task 9: Test Runner Scripts

**Files:**
- Create: `local/test-unit.sh` + `local/test-unit.ps1`
- Create: `local/test-playwright.sh` + `local/test-playwright.ps1`
- Create: `local/test-e2e.sh` + `local/test-e2e.ps1`
- Create: `local/test-lint.sh` + `local/test-lint.ps1`
- Create: `local/test.sh` + `local/test.ps1`

- [ ] **Step 1: Create test-unit.sh and test-unit.ps1**

Runs `./gradlew test` + `cd express-api && npm test`. Shows combined results. No local env needed.

- [ ] **Step 2: Create test-playwright.sh and test-playwright.ps1**

Checks local env running (curl localhost:3000/api/health). Serves admin panel (`npx serve public -l 8080` background). Runs `WEB_BASE_URL=http://localhost:8080 ALLURE_ENABLED=true ALLURE_PROJECT=local npx playwright test`. Stops serve after. Offers Allure report. Note: `ALLURE_PROJECT=local` sets the Allure results subdirectory name — without it, results go to `allure-results/default/` instead of a named directory.

- [ ] **Step 3: Create test-e2e.sh and test-e2e.ps1**

Checks local env running. Checks adb device connected. Runs `./gradlew connectedLocalDebugAndroidTest`. Offers Allure report.

- [ ] **Step 4: Create test-lint.sh and test-lint.ps1**

Runs `./gradlew ktlintCheck` + `cd express-api && npx eslint src/`. Shows results.

- [ ] **Step 5: Create test.sh and test.ps1 (interactive)**

Displays menu:
```
Which tests would you like to run?
  [1] Unit tests (Kotlin + Express API)
  [2] Playwright web tests
  [3] Android E2E tests
  [4] Linters (ktlint + ESLint)
  [5] All tests + linters
  [0] Cancel
```

Reads choice, checks prerequisites for options 2/3/5, runs selected scripts, shows pass/fail summary, offers Allure report viewing.

- [ ] **Step 6: Test each script**

Run each script individually. Verify menu works, prerequisite checks work, scripts call through to the right commands.

- [ ] **Step 7: Commit**

```bash
git add local/test*.sh local/test*.ps1
git commit -m "feat: local test runner scripts — unit, playwright, e2e, lint, interactive menu"
```

---

### Task 10: CI Workflow — e2e-tests.yml Migration

**Files:**
- Modify: `.github/workflows/e2e-tests.yml:191,197,215,281-316`

- [ ] **Step 1: Update Android E2E job**

In `.github/workflows/e2e-tests.yml`:
- Line 191: `connectedDevDebugAndroidTest` -> `connectedLocalDebugAndroidTest`
- Line 197: `PACKAGE="com.shyden.shytalk.dev"` -> `PACKAGE="com.shyden.shytalk.local"`
- Line 215: `environment=dev` -> `environment=local`
- Add MailHog as a GHA `services:` block (no custom command needed, simplest approach)
- Add LiveKit and MinIO as `docker run` steps (they need custom commands that `services:` doesn't support)
- Add Firebase Emulator startup step
- Add seed step (unconditional)
- Add Express API startup step (`NODE_ENV=local`)

- [ ] **Step 2: Update Playwright job**

- Line 281: Remove `environment: dev`
- Line 315: `WEB_BASE_URL: https://dev.shytalk.shyden.co.uk` -> `WEB_BASE_URL: http://localhost:8080`
- Line 316: `API_BASE_URL: https://dev-api.shytalk.shyden.co.uk` -> `API_BASE_URL: http://localhost:3000`
- Replace secret-based credentials with hardcoded local values:
  - `ADMIN_EMAIL: claude-test@shytalk.dev`
  - `ADMIN_PASSWORD: localdev123`
  - `TEST_API_KEY: local-test-key`
- Add MailHog as GHA `services:` block, LiveKit + MinIO as `docker run` steps
- Add Firebase Emulator startup, seed, Express API startup steps
- Add `npx serve public -l 8080 &` step for admin panel

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e-tests.yml
git commit -m "feat: CI E2E and Playwright tests run against local environment (zero cloud)"
```

---

### Task 11: CI Workflow — pr-checks.yml Migration

**Files:**
- Modify: `.github/workflows/pr-checks.yml`

- [ ] **Step 1: Update the android-e2e-smoke job**

The `android-e2e-smoke` job in pr-checks.yml should reference the updated e2e-tests workflow which now uses local services. Check if it calls `e2e-tests.yml` as a reusable workflow or duplicates steps. Update accordingly:
- If reusable workflow: changes from Task 10 propagate automatically
- If inline: apply same changes (local flavor, Docker services, emulators)

- [ ] **Step 2: Commit if changes needed**

```bash
git add .github/workflows/pr-checks.yml
git commit -m "feat: PR checks use local environment for integration tests"
```

---

### Task 12: README — English Update

**Files:**
- Modify: `README.md`
- Create: `local/screenshots/` directory with captured screenshots

- [ ] **Step 1: Start local environment and capture screenshots**

Run `bash local/start.sh`, then capture:
- Firebase Emulator UI (localhost:4000) — browser screenshot
- MailHog UI (localhost:8025) — send a test OTP, capture the email
- MinIO Console (localhost:9001) — show shytalk-media bucket
- Allure report — run tests, then `npx allure serve allure-results`, capture
- Android app on emulator — screenshot of login screen

Save to `local/screenshots/`:
- `firebase-ui.png`
- `mailhog-ui.png`
- `minio-console.png`
- `allure-report.png`
- `android-emulator.png`

- [ ] **Step 2: Update README.md**

Update these sections:
- **Prerequisites**: Docker required, remove cloud account mentions
- **Local Development**: one-command flow, PowerShell + bash, all URLs, credentials
- **Inline examples**: terminal output for start script, curl health check, adb devices
- **Screenshots**: reference `local/screenshots/*.png`
- **Running Tests**: document test scripts, Allure viewing
- **Optional Services**: LibreTranslate manual Docker command
- **Troubleshooting**: all topics from spec
- **iOS note**: supported but README focuses on Android
- **Testing in CI**: Playwright/E2E run against local environment

- [ ] **Step 3: Commit**

```bash
git add README.md local/screenshots/
git commit -m "docs: README overhaul — fully offline setup, examples, screenshots, troubleshooting"
```

---

### Task 13: README — 19 Translations

**Files:**
- Modify: `README.{ar,de,es,fr,hi,id,it,ja,ko,nl,pl,pt,ru,sv,th,tr,uk,vi,zh}.md`

- [ ] **Step 1: Translate updated README to all 19 languages**

For each translation file:
- Same structure as English README
- Same screenshots (shared, language-neutral)
- Translate section headings and explanatory text
- Keep terminal output, code blocks, and URLs in English
- Keep language selector bar with current language bolded
- Kotlin version badge: 2.3.20

- [ ] **Step 2: Verify consistency**

Check all 19 files have:
- Same line count (within 10% of English)
- Language selector bar present
- Kotlin badge version matches
- All screenshots referenced
- All new sections present

- [ ] **Step 3: Commit**

```bash
git add README.*.md
git commit -m "docs: update all 19 translated READMEs — offline setup, examples, screenshots"
```

---

## Execution Order

Tasks 1-6 are the foundation (Docker, API, seed). Task 7-8 are the scripts. Task 9 is test runners. Tasks 10-11 are CI. Tasks 12-13 are documentation.

Dependencies:
- Task 2, 3, 4, 5 can run in parallel (independent Express API changes)
- Task 6 depends on Task 1 (needs MinIO running)
- Task 7 depends on Tasks 1-6 (start script uses everything)
- Task 8 can run with Task 7
- Task 9 depends on Task 7 (test scripts check if env is running)
- Tasks 10-11 depend on Tasks 1-6 (CI needs the API changes)
- Task 12 depends on Task 7 (needs running env for screenshots)
- Task 13 depends on Task 12 (translates the English README)
