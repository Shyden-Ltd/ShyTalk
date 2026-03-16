# Testing Tier 1 — Foundation Design Spec

**Date:** 2026-03-16
**Goal:** Fill all test coverage gaps in Express API and Kotlin repositories, and get E2E CI workflow passing its first successful run.
**Execution:** Sequential — A → merge → B → merge → E → merge.

---

## Sub-project A: Express API Test Gaps

**Branch:** `test/express-api-gaps`

### Scope

Write tests for every untested Express API source file. All tests use the existing Jest + Supertest + Jest mocks pattern established in the codebase.

Note: `auth.js` is already covered by 3 test files (`auth-otp.test.js`, `auth-pin.test.js`, `auth-biometric.test.js`). `staleRooms.js` is already covered by `src/__tests__/staleRooms.test.js`.

### Files to test

**Routes (3 untested):**

| File | Key endpoints | Test approach |
|---|---|---|
| `admin-backup.js` | List, trigger, download, restore backups | Supertest + mocked R2 client, Firestore |
| `admin-migrate.js` | `POST /admin/migrate-prod-data` | Supertest + mocked Firestore (both projects) |
| `test-helpers.js` | `/test/setup`, `/test/teardown`, `/test/verify` | Supertest + mocked Firestore, verify X-Test-Api-Key guard |

**Utils (5 untested):**

| File | What it does | Test approach |
|---|---|---|
| `r2.js` | R2 storage upload/delete via S3 client | Mock `@aws-sdk/client-s3`, verify PutObject/DeleteObject calls |
| `system-pm.js` | PM2 system utilities | Mock PM2 API, verify process management calls |
| `firebase.js` | Firebase Admin SDK initialization | Mock `firebase-admin`, verify init with env vars |
| `alertManagerInstance.js` | Singleton wrapper | Verify exports correct instance |
| `loggerInstance.js` | Singleton wrapper | Verify exports correct instance |

**Cron (2 untested):**

| File | What it does | Test approach |
|---|---|---|
| `index.js` | Cron orchestrator — registers all jobs | Verify all cron jobs registered with correct schedules |
| `testDataCleanup.js` | Dev-only test data cleanup | Mock Firestore, verify cleanup logic |

**Middleware (2 untested):**

| File | What it does | Test approach |
|---|---|---|
| `cors.js` | CORS configuration | Supertest, verify allowed origins and headers |
| `rateLimit.js` | Rate limiting config | Supertest, verify rate limit headers and blocking |

### Coverage configuration

Add to `express-api/jest.config.js`:
- `collectCoverage: true` (in CI only, via `--coverage` flag)
- `coverageDirectory: 'coverage'`
- `coverageReporters: ['text', 'lcov']` (lcov for SonarCloud)
- Add `npm run test:coverage` script

---

## Sub-project B: Kotlin Repository Test Gaps

**Branch:** `test/kotlin-repo-gaps`

### Scope

Write unit tests for the 3 untested repository implementations. All are in `app/src/main/java/com/shyden/shytalk/data/repository/`.

### Files to test

| Repository | Key methods | Test approach |
|---|---|---|
| `BiometricRepositoryImpl` | `register()`, `verify()`, `revoke()`, `getChallenge()` | MockK for WorkerApiClient, verify API calls and response parsing |
| `OtpRepositoryImpl` | `sendOtp()`, `verifyOtp()` | MockK for WorkerApiClient, verify email send trigger, OTP validation, error handling |
| `PinRepositoryImpl` | `setupPin()`, `verifyPin()`, `resetPin()` | MockK for WorkerApiClient, verify PIN flow, lockout error handling inside verifyPin() |

### Coverage reporting

- Add JaCoCo Gradle plugin for Kotlin test coverage
- Configure `jacocoTestReport` task to generate XML reports
- Wire report path into existing SonarCloud config (`sonar.coverage.jacoco.xmlReportPaths`)
- Also add `sonar.javascript.lcov.reportPaths` for Express lcov coverage from Sub-project A

---

## Sub-project E: E2E Workflow Validation

**Branch:** `ci/e2e-workflow-fix`

### Scope

Get `.github/workflows/e2e-tests.yml` to complete its first successful run.

### Current state

- Shell-based emulator (sdkmanager + avdmanager + emulator CLI)
- Build job uploads APK artifacts but test jobs do NOT download them — each matrix job rebuilds from scratch (wasteful, needs fixing)
- 8 Android matrix jobs (API 28/30/33/35 × phone/tablet)
- 6 iOS jobs (skipped until XCTest targets added)
- Triggers: `workflow_dispatch` and `/run-e2e` PR comment
- **Has never completed successfully**

### What needs to happen

1. **Debug emulator boot** — verify system image availability for each API level, KVM acceleration on ubuntu-latest runners, boot timeout configuration
2. **Fix build-once/test-many** — wire test jobs to download pre-built APK artifacts from build job instead of rebuilding, then `adb install` and run Cucumber tests
3. **Simplify matrix for first run** — reduce to single job (API 33 phone) to isolate issues, expand back to full matrix once working
4. **Smoke test trigger** — validate `/run-e2e` comment parsing and `workflow_dispatch` both work (details TBD during planning — may need to discuss comment parsing logic, permission checks, concurrency handling)
5. **Allure report** — validate results collection, history restore, and GitHub Pages deployment (details TBD during planning — may need to discuss report merging strategy, artifact retention, Pages branch setup)

### Known risks

- GitHub runners may not have KVM enabled for all machine types
- System images for older API levels (28) may not be available on newer runner OS versions
- `always()` dependency chain is required because `parse-comment` is skipped for `workflow_dispatch`
