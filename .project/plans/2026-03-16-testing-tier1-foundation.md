# Testing Tier 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill all test coverage gaps in Express API and Kotlin repositories, and get E2E CI workflow passing its first successful run.

**Architecture:** Three sequential sub-projects — A (Express API test gaps), B (Kotlin repository test gaps), E (E2E workflow validation). Each gets its own branch, PR, and merge before the next starts.

**Tech Stack:** Jest 30 + Supertest (Express), MockK + kotlinx-coroutines-test (Kotlin), GitHub Actions + Android emulator (E2E CI).

**Spec:** `.project/specs/2026-03-16-testing-tier1-foundation-design.md`

---

## Chunk 1: Sub-project A — Express API Test Gaps

**Branch:** `test/express-api-gaps`

### Task 1: Add Jest coverage configuration

**Files:**
- Modify: `express-api/jest.config.js`
- Modify: `express-api/package.json`

- [ ] **Step 1: Update jest.config.js with coverage settings**

Add to `express-api/jest.config.js`:
```javascript
coverageDirectory: 'coverage',
coverageReporters: ['text', 'lcov'],
collectCoverageFrom: [
  'src/**/*.js',
  '!src/__tests__/**',
],
```

- [ ] **Step 2: Add coverage script to package.json**

Add to `"scripts"` in `express-api/package.json`:
```json
"test:coverage": "jest --coverage --verbose"
```

- [ ] **Step 3: Run tests to verify nothing broke**

```bash
cd express-api && npm test
```

Expected: 891 tests pass.

- [ ] **Step 4: Commit**

```bash
git add express-api/jest.config.js express-api/package.json
git commit -m "chore: add Jest coverage configuration"
```

### Task 2: Test admin-backup.js route

**Files:**
- Create: `express-api/tests/routes/admin-backup.test.js`
- Source: `express-api/src/routes/admin-backup.js`

- [ ] **Step 1: Read the source file to understand all endpoints**

Read `express-api/src/routes/admin-backup.js` fully. Identify every route handler and its dependencies.

- [ ] **Step 2: Write the test file**

Follow the established pattern:
- Mock `../../src/utils/firebase` (db, FieldValue)
- Mock `../../src/utils/r2` (putObject, listObjects, getObject, deleteObject, deleteObjects)
- Mock `../../src/middleware/auth` (requireAdmin)
- Mock `../../src/utils/log` (info, warn, error)
- Mock `../../src/utils/helpers` (generateId, now)
- Create `createApp()` helper with auth injection
- Test each endpoint for: success path, admin guard, error handling, edge cases

Key endpoints to cover (read the source to confirm exact paths):
- `GET /admin/backups` — list backups from R2
- `POST /admin/backups/trigger` — trigger full backup
- `GET /admin/backups/:date/:collection` — download specific collection backup
- `GET /admin/backups/:date` — download legacy users backup
- `POST /admin/backups/restore/:date` — restore from backup (mode param: full/collection/missing-only)
- `POST /admin/backups/recover-photos` — recover photos from R2

- [ ] **Step 3: Run the new tests**

```bash
cd express-api && npx jest tests/routes/admin-backup.test.js --verbose
```

Expected: all tests pass.

- [ ] **Step 4: Run full test suite to verify no regressions**

```bash
cd express-api && npm test
```

Expected: 891+ tests pass (original count + new tests).

- [ ] **Step 5: Commit**

```bash
git add express-api/tests/routes/admin-backup.test.js
git commit -m "test: add tests for admin-backup route endpoints"
```

### Task 3: Test admin-migrate.js route

**Files:**
- Create: `express-api/tests/routes/admin-migrate.test.js`
- Source: `express-api/src/routes/admin-migrate.js`

- [ ] **Step 1: Read the source file**

Read `express-api/src/routes/admin-migrate.js` fully.

- [ ] **Step 2: Write the test file**

Mock pattern: Firebase with TWO projects (prod + dev), requireAdmin guard, logging.
Test: admin guard, successful migration, Firestore error handling.

- [ ] **Step 3: Run and verify**

```bash
cd express-api && npx jest tests/routes/admin-migrate.test.js --verbose
```

- [ ] **Step 4: Run full suite**

```bash
cd express-api && npm test
```

- [ ] **Step 5: Commit**

```bash
git add express-api/tests/routes/admin-migrate.test.js
git commit -m "test: add tests for admin-migrate route endpoint"
```

### Task 4: Test test-helpers.js route

**Files:**
- Create: `express-api/tests/routes/test-helpers.test.js`
- Source: `express-api/src/routes/test-helpers.js`

- [ ] **Step 1: Read the source file**

Read `express-api/src/routes/test-helpers.js` fully.

- [ ] **Step 2: Write the test file**

Test: X-Test-Api-Key guard, /test/setup, /test/teardown, /test/verify, /test/reset. Verify allowed collections whitelist.

- [ ] **Step 3: Run and verify**

```bash
cd express-api && npx jest tests/routes/test-helpers.test.js --verbose
```

- [ ] **Step 4: Run full suite + commit**

```bash
cd express-api && npm test
git add express-api/tests/routes/test-helpers.test.js
git commit -m "test: add tests for test-helpers route endpoints"
```

### Task 5: Test r2.js utility

**Files:**
- Create: `express-api/tests/utils/r2.test.js`
- Source: `express-api/src/utils/r2.js`

- [ ] **Step 1: Read the source file**

Read `express-api/src/utils/r2.js` fully.

- [ ] **Step 2: Write the test file**

Mock `@aws-sdk/client-s3` (S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command).
Test each exported function: putObject, getObject, deleteObject, deleteObjects, listObjects. Cover success + error paths.

- [ ] **Step 3: Run and verify**

```bash
cd express-api && npx jest tests/utils/r2.test.js --verbose
```

- [ ] **Step 4: Run full suite + commit**

```bash
cd express-api && npm test
git add express-api/tests/utils/r2.test.js
git commit -m "test: add tests for R2 storage utility"
```

### Task 6: Test system-pm.js utility (system private messages)

**Files:**
- Create: `express-api/tests/utils/system-pm.test.js`
- Source: `express-api/src/utils/system-pm.js`

Note: `system-pm.js` is a **system private message** utility (NOT PM2). It exports `sendSystemPm()`, `SYSTEM_UID`, and `systemConversationId()`. It sends automated private messages from a system account.

- [ ] **Step 1: Read the source file**

Read `express-api/src/utils/system-pm.js` fully.

- [ ] **Step 2: Write the test file**

Mock `../../src/utils/firebase` (db, rtdb, FieldValue), `../../src/utils/helpers` (generateId, now), `../../src/utils/log`.
Test: `sendSystemPm()` creates conversation doc + message doc, `systemConversationId()` returns correct ID format, `SYSTEM_UID` is correct constant.

- [ ] **Step 3: Run and verify**

```bash
cd express-api && npx jest tests/utils/system-pm.test.js --verbose && npm test
```

- [ ] **Step 4: Commit**

```bash
git add express-api/tests/utils/system-pm.test.js
git commit -m "test: add tests for system private message utility"
```

### Task 7: Test firebase.js, alertManagerInstance.js, loggerInstance.js utilities

**Files:**
- Create: `express-api/tests/utils/firebase.test.js`
- Create: `express-api/tests/utils/alertManagerInstance.test.js`
- Create: `express-api/tests/utils/loggerInstance.test.js`

- [ ] **Step 1: Read all 3 source files**

These are thin wrappers/initialization files.

- [ ] **Step 2: Write test files**

- `firebase.test.js`: Uses `jest.resetModules()` to re-import with controlled `process.env`. Mock `firebase-admin`, verify `initializeApp()` called, verify exports (db, auth, rtdb, messaging, FieldValue). Note: firebase.js runs `initializeApp` at module load time, so module re-loading is required for each test.
- `alertManagerInstance.test.js`: Verify it exports the correct instance type
- `loggerInstance.test.js`: Verify it exports the correct instance type

- [ ] **Step 3: Run and verify**

```bash
cd express-api && npx jest tests/utils/firebase.test.js tests/utils/alertManagerInstance.test.js tests/utils/loggerInstance.test.js --verbose && npm test
```

- [ ] **Step 4: Commit**

```bash
git add express-api/tests/utils/firebase.test.js express-api/tests/utils/alertManagerInstance.test.js express-api/tests/utils/loggerInstance.test.js
git commit -m "test: add tests for firebase init, alertManager and logger instances"
```

### Task 8: Test cron/index.js and cron/testDataCleanup.js

**Files:**
- Create: `express-api/tests/cron/index.test.js`
- Create: `express-api/tests/cron/testDataCleanup.test.js`

- [ ] **Step 1: Read both source files**

- [ ] **Step 2: Write test files**

- `index.test.js`: Mock `node-cron`, verify all cron jobs registered with correct schedules. Mock all cron job modules.
- `testDataCleanup.test.js`: Mock Firestore, verify cleanup queries and deletes for test data.

- [ ] **Step 3: Run and verify**

```bash
cd express-api && npx jest tests/cron/index.test.js tests/cron/testDataCleanup.test.js --verbose && npm test
```

- [ ] **Step 4: Commit**

```bash
git add express-api/tests/cron/index.test.js express-api/tests/cron/testDataCleanup.test.js
git commit -m "test: add tests for cron orchestrator and testDataCleanup"
```

### Task 9: Test middleware/cors.js and middleware/rateLimit.js

**Files:**
- Create: `express-api/tests/middleware/cors.test.js`
- Create: `express-api/tests/middleware/rateLimit.test.js`

- [ ] **Step 1: Read both source files**

- [ ] **Step 2: Write test files**

- `cors.test.js`: Create Express app with CORS middleware, test allowed/blocked origins via Supertest headers
- `rateLimit.test.js`: Create Express app with rate limiter, send requests until limit hit, verify 429 response and Retry-After header

- [ ] **Step 3: Run and verify**

```bash
cd express-api && npx jest tests/middleware/cors.test.js tests/middleware/rateLimit.test.js --verbose && npm test
```

- [ ] **Step 4: Commit**

```bash
git add express-api/tests/middleware/cors.test.js express-api/tests/middleware/rateLimit.test.js
git commit -m "test: add tests for CORS and rate limiting middleware"
```

### Task 10: Final validation and PR for Sub-project A

- [ ] **Step 1: Run full test suite with coverage**

```bash
cd express-api && npm run test:coverage
```

Expected: all tests pass, coverage report generated.

- [ ] **Step 2: Run ESLint + Prettier on new test files**

```bash
cd express-api && npm run lint && npm run format:check
```

Fix any issues.

- [ ] **Step 3: Push and create PR**

```bash
git push -u origin test/express-api-gaps
```

Create PR targeting `main`.

- [ ] **Step 4: Verify CI passes, then merge**

Wait for CI to pass. Merge PR. Switch to main, pull, delete branch.

---

## Chunk 2: Sub-project B — Kotlin Repository Test Gaps

**Branch:** `test/kotlin-repo-gaps` (create after Sub-project A is merged)

### Task 11: Test BiometricRepositoryImpl

**Files:**
- Create: `app/src/test/java/com/shyden/shytalk/data/repository/BiometricRepositoryImplTest.kt`
- Source: `app/src/main/java/com/shyden/shytalk/data/repository/BiometricRepositoryImpl.kt`

- [ ] **Step 1: Read the source file**

Dependencies: `WorkerApiClient` (post, getPublic, postPublic, delete), `JSONObject`.

- [ ] **Step 2: Write the test file**

```kotlin
package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class BiometricRepositoryImplTest {

    private lateinit var apiClient: WorkerApiClient
    private lateinit var repo: BiometricRepositoryImpl

    @Before
    fun setup() {
        apiClient = mockk(relaxed = true)
        repo = BiometricRepositoryImpl(apiClient)
    }

    @Test
    fun `register sends public key and device id`() = runTest {
        coEvery { apiClient.post(any(), any()) } returns JSONObject()

        val result = repo.register("base64key", "device-123")

        assertTrue(result.isSuccess)
        coVerify {
            apiClient.post("/api/auth/biometric/register", match { json ->
                json.getString("publicKey") == "base64key" &&
                json.getString("deviceId") == "device-123"
            })
        }
    }

    @Test
    fun `register returns failure on API error`() = runTest {
        coEvery { apiClient.post(any(), any()) } throws RuntimeException("network error")

        val result = repo.register("key", "device")

        assertTrue(result.isFailure)
    }

    @Test
    fun `getChallenge returns challenge string`() = runTest {
        coEvery { apiClient.getPublic(any()) } returns JSONObject().apply {
            put("challenge", "random-challenge-123")
        }

        val result = repo.getChallenge("user-1", "device-1")

        assertTrue(result.isSuccess)
        assertEquals("random-challenge-123", result.getOrNull())
    }

    @Test
    fun `verify returns custom token`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } returns JSONObject().apply {
            put("customToken", "firebase-token-xyz")
        }

        val result = repo.verify("user-1", "device-1", "sig-base64")

        assertTrue(result.isSuccess)
        assertEquals("firebase-token-xyz", result.getOrNull())
    }

    @Test
    fun `revoke calls delete with device id`() = runTest {
        coEvery { apiClient.delete(any()) } returns JSONObject()

        val result = repo.revoke("device-123")

        assertTrue(result.isSuccess)
        coVerify { apiClient.delete("/api/auth/biometric/device-123") }
    }
}
```

- [ ] **Step 3: Run the test**

```bash
./gradlew :app:testDevDebugUnitTest --tests "com.shyden.shytalk.data.repository.BiometricRepositoryImplTest" --info
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/test/java/com/shyden/shytalk/data/repository/BiometricRepositoryImplTest.kt
git commit -m "test: add unit tests for BiometricRepositoryImpl"
```

### Task 12: Test OtpRepositoryImpl

**Files:**
- Create: `app/src/test/java/com/shyden/shytalk/data/repository/OtpRepositoryImplTest.kt`

- [ ] **Step 1: Write the test file**

```kotlin
package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class OtpRepositoryImplTest {

    private lateinit var apiClient: WorkerApiClient
    private lateinit var repo: OtpRepositoryImpl

    @Before
    fun setup() {
        apiClient = mockk(relaxed = true)
        repo = OtpRepositoryImpl(apiClient)
    }

    @Test
    fun `sendOtp sends email to API`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } returns JSONObject()

        val result = repo.sendOtp("user@example.com")

        assertTrue(result.isSuccess)
        coVerify {
            apiClient.postPublic("/api/auth/otp/send", match { json ->
                json.getString("email") == "user@example.com"
            })
        }
    }

    @Test
    fun `sendOtp returns failure on API error`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } throws RuntimeException("rate limited")

        val result = repo.sendOtp("user@example.com")

        assertTrue(result.isFailure)
    }

    @Test
    fun `verifyOtp returns custom token on success`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } returns JSONObject().apply {
            put("customToken", "firebase-token-abc")
        }

        val result = repo.verifyOtp("user@example.com", "123456")

        assertTrue(result.isSuccess)
        assertEquals("firebase-token-abc", result.getOrNull())
    }

    @Test
    fun `verifyOtp sends email and code`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } returns JSONObject().apply {
            put("customToken", "token")
        }

        repo.verifyOtp("user@example.com", "654321")

        coVerify {
            apiClient.postPublic("/api/auth/otp/verify", match { json ->
                json.getString("email") == "user@example.com" &&
                json.getString("code") == "654321"
            })
        }
    }

    @Test
    fun `verifyOtp returns failure on wrong code`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } throws RuntimeException("invalid code")

        val result = repo.verifyOtp("user@example.com", "000000")

        assertTrue(result.isFailure)
    }
}
```

- [ ] **Step 2: Run the test**

```bash
./gradlew :app:testDevDebugUnitTest --tests "com.shyden.shytalk.data.repository.OtpRepositoryImplTest" --info
```

- [ ] **Step 3: Run full Kotlin test suite**

```bash
./gradlew test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/test/java/com/shyden/shytalk/data/repository/OtpRepositoryImplTest.kt
git commit -m "test: add unit tests for OtpRepositoryImpl"
```

### Task 13: Test PinRepositoryImpl

**Files:**
- Create: `app/src/test/java/com/shyden/shytalk/data/repository/PinRepositoryImplTest.kt`

- [ ] **Step 1: Write the test file**

```kotlin
package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class PinRepositoryImplTest {

    private lateinit var apiClient: WorkerApiClient
    private lateinit var repo: PinRepositoryImpl

    @Before
    fun setup() {
        apiClient = mockk(relaxed = true)
        repo = PinRepositoryImpl(apiClient)
    }

    @Test
    fun `setupPin returns pin hash on success`() = runTest {
        coEvery { apiClient.post(any(), any()) } returns JSONObject().apply {
            put("pinHash", "bcrypt-hash-123")
        }

        val result = repo.setupPin("1234")

        assertTrue(result.isSuccess)
        assertEquals("bcrypt-hash-123", result.getOrNull())
    }

    @Test
    fun `setupPin sends pin to API`() = runTest {
        coEvery { apiClient.post(any(), any()) } returns JSONObject().apply {
            put("pinHash", "hash")
        }

        repo.setupPin("5678")

        coVerify {
            apiClient.post("/api/auth/pin/setup", match { json ->
                json.getString("pin") == "5678"
            })
        }
    }

    @Test
    fun `verifyPin returns token on correct pin`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } returns JSONObject().apply {
            put("customToken", "firebase-token-pin")
        }

        val result = repo.verifyPin("user-1", "device-1", "1234")

        assertTrue(result.isSuccess)
        assertEquals("firebase-token-pin", result.getOrNull()?.customToken)
    }

    @Test
    fun `verifyPin returns attemptsRemaining on wrong pin (401)`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } throws ApiException(
            401, """{"attemptsRemaining": 3}"""
        )

        val result = repo.verifyPin("user-1", "device-1", "0000")

        assertTrue(result.isSuccess)
        val pinResult = result.getOrNull()!!
        assertNull(pinResult.customToken)
        assertEquals(3, pinResult.attemptsRemaining)
        assertFalse(pinResult.locked)
    }

    @Test
    fun `verifyPin returns locked state on lockout (423)`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } throws ApiException(
            423, """{"lockedUntil": 1709900000000, "requiresReauth": true}"""
        )

        val result = repo.verifyPin("user-1", "device-1", "9999")

        assertTrue(result.isSuccess)
        val pinResult = result.getOrNull()!!
        assertTrue(pinResult.locked)
        assertEquals(1709900000000L, pinResult.lockedUntil)
        assertTrue(pinResult.requiresReauth)
        assertEquals(0, pinResult.attemptsRemaining)
    }

    @Test
    fun `verifyPin returns failure on unexpected error`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } throws RuntimeException("network")

        val result = repo.verifyPin("user-1", "device-1", "1234")

        assertTrue(result.isFailure)
    }

    @Test
    fun `resetPin sends new pin to API`() = runTest {
        coEvery { apiClient.post(any(), any()) } returns JSONObject()

        val result = repo.resetPin("9999")

        assertTrue(result.isSuccess)
        coVerify {
            apiClient.post("/api/auth/pin/reset", match { json ->
                json.getString("pin") == "9999"
            })
        }
    }
}
```

- [ ] **Step 2: Run the test**

```bash
./gradlew :app:testDevDebugUnitTest --tests "com.shyden.shytalk.data.repository.PinRepositoryImplTest" --info
```

- [ ] **Step 3: Run full Kotlin test suite**

```bash
./gradlew test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/test/java/com/shyden/shytalk/data/repository/PinRepositoryImplTest.kt
git commit -m "test: add unit tests for PinRepositoryImpl"
```

### Task 14: Add JaCoCo coverage + SonarCloud integration

**Files:**
- Modify: `build.gradle.kts`

- [ ] **Step 1: Apply JaCoCo plugin to app and shared modules**

In `app/build.gradle.kts`, add the JaCoCo plugin:
```kotlin
plugins {
    // ... existing plugins
    jacoco
}

tasks.register<JacocoReport>("jacocoTestDevDebugUnitTestReport") {
    dependsOn("testDevDebugUnitTest")
    reports {
        xml.required.set(true)
        html.required.set(false)
    }
    classDirectories.setFrom(fileTree("build/tmp/kotlin-classes/devDebug"))
    sourceDirectories.setFrom(files("src/main/java"))
    executionData.setFrom(fileTree("build") { include("jacoco/*.exec") })
}
```

Read the actual `app/build.gradle.kts` first to find the correct insertion point.

- [ ] **Step 2: Add SonarCloud coverage paths**

In root `build.gradle.kts`, add to the `sonar { properties { } }` block:
```kotlin
property("sonar.coverage.jacoco.xmlReportPaths", listOf(
    "app/build/reports/jacoco/jacocoTestDevDebugUnitTestReport/jacocoTestDevDebugUnitTestReport.xml",
).joinToString(","))
property("sonar.javascript.lcov.reportPaths", "express-api/coverage/lcov.info")
```

- [ ] **Step 2: Run tests to verify nothing broke**

```bash
./gradlew test
```

- [ ] **Step 3: Commit**

```bash
git add build.gradle.kts
git commit -m "chore: add SonarCloud coverage report paths for Kotlin and Express"
```

### Task 15: Final validation and PR for Sub-project B

- [ ] **Step 1: Run full test suite**

```bash
./gradlew test
cd express-api && npm test
```

- [ ] **Step 2: Push and create PR**

```bash
git push -u origin test/kotlin-repo-gaps
```

Create PR targeting `main`.

- [ ] **Step 3: Verify CI, merge, cleanup**

---

## Chunk 3: Sub-project E — E2E Workflow Validation

**Branch:** `ci/e2e-workflow-fix` (create after Sub-project B is merged)

### Task 16: Simplify E2E workflow to single-device first run

**Files:**
- Modify: `.github/workflows/e2e-tests.yml`

- [ ] **Step 1: Read the full workflow file**

Read `.github/workflows/e2e-tests.yml` to understand current structure.

- [ ] **Step 2: Create a simplified single-device version**

Changes:
- Reduce Android matrix to single entry: `{ api-level: 34, target: google_apis, arch: x86_64, profile: pixel_6, name: "API 34 Phone" }`
- Use API 34 (most reliable on current runners, includes google_apis system images)
- Ensure `build-android` job uploads both app APK and test APK as artifacts
- Wire `test-android` to download artifacts instead of rebuilding
- Use `reactivecircus/android-emulator-runner` action (proven reliable) instead of shell-based emulator as fallback if shell approach fails
- Set boot timeout to 600s (10 min)
- Enable hardware acceleration: `enable-hw-keyboard: true`

- [ ] **Step 3: Fix build-once/test-many pattern**

In `test-android` job, add steps:
```yaml
- uses: actions/download-artifact@v4
  with:
    name: android-test-apks

- name: Install APKs
  run: |
    adb install app-dev-debug.apk
    adb install app-dev-debug-androidTest.apk
```

Remove the full Gradle rebuild from `test-android`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/e2e-tests.yml
git commit -m "ci: simplify E2E workflow to single device for first run validation"
```

### Task 17: Validate workflow_dispatch trigger

- [ ] **Step 1: Push branch and trigger workflow manually**

```bash
git push -u origin ci/e2e-workflow-fix
```

Trigger via GitHub UI: Actions → E2E Tests → Run workflow → select branch `ci/e2e-workflow-fix`, platform: android.

- [ ] **Step 2: Monitor and debug**

Watch the workflow run. Fix issues as they appear:
- System image not found → update API level or target
- KVM not available → try `-no-accel` flag or different runner
- Boot timeout → increase timeout or use `-no-window -no-audio`
- APK install failure → check artifact download paths
- Test runner failure → check Cucumber runner configuration

- [ ] **Step 3: Fix issues and re-push until successful**

Iterate: fix → commit → push → re-trigger → monitor. Keep fixing until the workflow completes green.

- [ ] **Step 4: Commit any fixes**

```bash
git add .github/workflows/e2e-tests.yml
git commit -m "fix: resolve E2E workflow issues for successful run"
```

### Task 18: Validate /run-e2e comment trigger

**Note:** This task may need discussion with the user about comment parsing logic, permissions, and concurrency.

- [ ] **Step 1: Review the parse-comment job logic**

Read the `parse-comment` job in `e2e-tests.yml`. Verify:
- It checks for `/run-e2e` in comment body
- It validates commenter has write access
- It correctly parses platform argument (android/ios/both)
- Output variables are set correctly

- [ ] **Step 2: Test the trigger**

Create a test PR, comment `/run-e2e android`, verify workflow triggers correctly.

- [ ] **Step 3: Fix any issues and commit**

### Task 19: Validate Allure report generation

**Note:** This task may need discussion about report merging and Pages setup.

- [ ] **Step 1: Review the allure-report job**

Verify:
- It downloads test result artifacts
- It restores history from GitHub Pages branch
- It generates Allure HTML report
- It deploys to GitHub Pages

- [ ] **Step 2: Check GitHub Pages configuration**

Verify the repository has GitHub Pages enabled with the correct source branch for Allure reports.

- [ ] **Step 3: Fix any issues after a successful E2E run produces results**

After Task 17 produces a green run with test results, verify the Allure report is generated and accessible.

- [ ] **Step 4: Commit any fixes**

```bash
git add .github/workflows/e2e-tests.yml
git commit -m "fix: ensure Allure report generation and deployment works"
```

### Task 20: Expand matrix back to full coverage

- [ ] **Step 1: Re-enable full Android matrix**

After single-device passes, expand back to the original matrix:
- API 28, 30, 33, 35 × phone and tablet profiles
- Keep the build-once/test-many pattern

- [ ] **Step 2: Trigger and verify**

Run the full matrix and verify all 8 jobs pass (or identify which API levels/profiles have issues).

- [ ] **Step 3: Commit and finalize**

```bash
git add .github/workflows/e2e-tests.yml
git commit -m "ci: expand E2E matrix to full 8-device coverage"
```

### Task 21: Final validation and PR for Sub-project E

- [ ] **Step 1: Push and create PR**

```bash
git push -u origin ci/e2e-workflow-fix
```

Create PR targeting `main`.

- [ ] **Step 2: Verify CI, merge, cleanup**
