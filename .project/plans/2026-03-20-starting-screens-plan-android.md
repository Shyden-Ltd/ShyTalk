# Starting Screens — Android Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `X-Device-Id` header to all API calls, implement starting screen data model + service + caching, build the StartingScreen composable, integrate into MainActivity startup chain, add i18n strings, and write E2E tests.

**Architecture:** `StartingScreen` data class in `commonMain`. `AndroidAppConfigService` fetches from API. File-based cache in `cacheDir` with atomic writes. New `StartingScreen` composable in `app/`. `MainActivity` checks starting screens FIRST in startup chain, before unsafe device/update/health checks. Blocking screen stops all further loading.

**Tech Stack:** Kotlin, Compose, Koin DI, OkHttp, Coroutines, JUnit/MockK, Compose Test

**Spec:** `.project/plans/2026-03-20-starting-screens-design.md`
**Depends on:** API plan must be completed first (endpoints must exist)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `shared/src/commonMain/.../data/remote/AppConfigService.kt` | Modify | Add `StartingScreen` data class + `getStartingScreens()` to interface |
| `app/src/main/.../data/remote/WorkerApiClient.kt` | Modify | Add `deviceId` constructor param, `X-Device-Id` header on ALL request paths |
| `app/src/main/.../data/remote/AndroidAppConfigService.kt` | Modify | Implement `getStartingScreens()` |
| `app/src/main/.../core/di/AppKoinModule.kt` | Modify | Update `WorkerApiClient` Koin binding with 4th param |
| `app/src/main/.../feature/starting/StartingScreenCache.kt` | Create | File-based cache manager for blocking screen + dismissed IDs |
| `app/src/main/.../feature/starting/StartingScreen.kt` | Create | StartingScreen composable (branding, template, image, title, message, dismiss) |
| `app/src/main/.../MainActivity.kt` | Modify | Insert starting screens check as first startup step |
| `shared/src/commonMain/composeResources/values*/strings.xml` | Modify | Add 5 new string keys to all 19 locale `values-*` directories + default `values/` |
| `app/src/test/.../feature/starting/StartingScreenCacheTest.kt` | Create | Cache unit tests |
| `app/src/test/.../data/remote/WorkerApiClientDeviceIdTest.kt` | Create | X-Device-Id header tests |
| `app/src/androidTest/.../steps/StartingScreenSteps.kt` | Create | E2E step definitions |
| `app/src/androidTest/assets/features/starting_screens.feature` | Create | E2E Gherkin scenarios |
| `app/src/androidTest/.../fake/FakeAppConfigService.kt` | Modify | Add `getStartingScreens()` fake |

---

## Chunk 1: X-Device-Id Header

### Task 1: Add deviceId to WorkerApiClient

**Files:**
- Modify: `app/src/main/.../data/remote/WorkerApiClient.kt`
- Modify: `app/src/main/.../core/di/AppKoinModule.kt`
- Create: `app/src/test/.../data/remote/WorkerApiClientDeviceIdTest.kt`

- [ ] **Step 1: Write failing test**

Create `app/src/test/java/com/shyden/shytalk/data/remote/WorkerApiClientDeviceIdTest.kt`. Use `MockWebServer` (OkHttp's test server) to verify the header is actually sent:

```kotlin
class WorkerApiClientDeviceIdTest {
    private lateinit var mockWebServer: MockWebServer

    @Before
    fun setup() {
        mockWebServer = MockWebServer()
        mockWebServer.start()
    }

    @After
    fun teardown() {
        mockWebServer.shutdown()
    }

    @Test
    fun `X-Device-Id header is present on getPublic requests`() = runTest {
        mockWebServer.enqueue(MockResponse().setBody("{}").setResponseCode(200))

        val client = WorkerApiClient(
            OkHttpClient(), mockWebServer.url("/").toString(),
            mockFirebaseAuth(), "test-device-123"  // 4th param — will fail until constructor updated
        )
        client.getPublic("/api/health")

        val request = mockWebServer.takeRequest()
        assertEquals("test-device-123", request.getHeader("X-Device-Id"))
    }
}
```

This test will fail with a compile error until the 4th constructor parameter is added.

- [ ] **Step 2: Update WorkerApiClient constructor**

Add `private val deviceId: String` as 4th constructor parameter. Add `.addHeader("X-Device-Id", deviceId)` to:
- `executeWithRetry()` request builder lambda — this also covers `patch()` (line ~95) which delegates to `executeWithRetry`
- `getPublic()` inline `Request.Builder()`
- `postPublic()` inline `Request.Builder()`
- `executeArrayWithRetry()` request builder

Add test cases verifying the header on: `getPublic`, `postPublic`, `get` (via executeWithRetry), `getArray` (via executeArrayWithRetry), and `patch` (via executeWithRetry — verify explicitly).

- [ ] **Step 3: Update Koin binding in AppKoinModule.kt**

```kotlin
single { WorkerApiClient(get(), BuildConfig.API_BASE_URL, get(), get(named("deviceId"))) }
```

**Important:** Do NOT rename or remove `named("deviceId")` — it is also injected by `AuthViewModel` (line ~166). Only add it as a 4th argument to `WorkerApiClient`.

- [ ] **Step 4: Run unit tests**

```bash
./gradlew testDevDebugUnitTest --tests "*WorkerApiClient*"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/shyden/shytalk/data/remote/WorkerApiClient.kt \
       app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt \
       app/src/test/
git commit -m "feat: add X-Device-Id header to all API calls via WorkerApiClient"
```

---

## Chunk 2: StartingScreen Data Model + Service

### Task 2: Add StartingScreen data class and interface method

**Files:**
- Modify: `shared/src/commonMain/.../data/remote/AppConfigService.kt`

- [ ] **Step 1: Add data class and interface method**

In `AppConfigService.kt`, add:

```kotlin
data class StartingScreen(
    val screenId: String,
    val enabled: Boolean,
    val dismissable: Boolean,
    val frequency: String,
    val template: String,
    val title: String,
    val message: String,
    val imageType: String? = null,
    val backgroundImage: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val contentHash: String = "",
)
```

Add to interface:
```kotlin
suspend fun getStartingScreens(): Resource<Map<String, StartingScreen>>
```

- [ ] **Step 2: Add stub implementation to AndroidAppConfigService**

```kotlin
override suspend fun getStartingScreens(): Resource<Map<String, StartingScreen>> {
    return try {
        // MUST use getPublic — this endpoint is pre-auth, no Firebase user exists yet.
        // api.get() calls getIdToken() which throws "Not signed in" before auth.
        val json = api.getPublic("/api/config/startingScreens")
        val data = json.toMap()
        val screens = mutableMapOf<String, StartingScreen>()
        for ((id, value) in data) {
            val screenMap = (value as? Map<*, *>) ?: continue
            screens[id] = StartingScreen(
                screenId = id,
                enabled = screenMap["enabled"] as? Boolean ?: false,
                dismissable = screenMap["dismissable"] as? Boolean ?: true,
                frequency = screenMap["frequency"] as? String ?: "every_launch",
                template = screenMap["template"] as? String ?: "info",
                title = screenMap["title"] as? String ?: "",
                message = screenMap["message"] as? String ?: "",
                imageType = screenMap["imageType"] as? String,
                backgroundImage = screenMap["backgroundImage"] as? String,
                startDate = screenMap["startDate"] as? String,
                endDate = screenMap["endDate"] as? String,
                contentHash = screenMap["contentHash"] as? String ?: "",
            )
        }
        Resource.Success(screens)
    } catch (e: Exception) {
        Resource.Error("Failed to fetch starting screens")
    }
}
```

- [ ] **Step 3: Add to FakeAppConfigService**

```kotlin
var startingScreens: Resource<Map<String, StartingScreen>> = Resource.Success(emptyMap())

override suspend fun getStartingScreens(): Resource<Map<String, StartingScreen>> = startingScreens
```

- [ ] **Step 4: Verify build**

```bash
./gradlew assembleDevDebug
```

Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
git add shared/src/commonMain/ app/src/main/ app/src/androidTest/
git commit -m "feat: add StartingScreen data class and getStartingScreens() to AppConfigService"
```

---

## Chunk 3: Cache Manager

### Task 3: Implement StartingScreenCache

**Files:**
- Create: `app/src/main/.../feature/starting/StartingScreenCache.kt`
- Create: `app/src/test/.../feature/starting/StartingScreenCacheTest.kt`

- [ ] **Step 0: Verify org.json test dependency exists**

`StartingScreenCache` uses `org.json.JSONObject` which is stubbed in JVM unit tests (see CLAUDE.md). `app/build.gradle.kts` already has `testImplementation("org.json:json:20231013")` at line 262 — no change needed. Just verify it's present.

- [ ] **Step 1: Write failing cache tests**

Key tests per spec:
- Cache write and read roundtrip
- Cache version mismatch → treated as empty
- Corrupt JSON → treated as empty
- Zero-byte file → treated as empty
- Deserialization exception → treated as empty
- Atomic write (temp file + rename)
- Dismissed screen IDs: persist, survive restart
- Background image path cached alongside content

- [ ] **Step 2: Implement StartingScreenCache**

```kotlin
class StartingScreenCache(private val context: Context) {
    private val cacheFile = File(context.cacheDir, "starting_screens_cache.json")
    private val prefs = context.getSharedPreferences("starting_screens", Context.MODE_PRIVATE)

    companion object {
        private const val CACHE_VERSION = 1
    }

    fun getCachedBlocker(): CachedScreen? {
        return try {
            if (!cacheFile.exists() || cacheFile.length() == 0L) return null
            val json = JSONObject(cacheFile.readText())
            if (json.optInt("cacheVersion") != CACHE_VERSION) {
                cacheFile.delete()
                return null
            }
            val blocker = json.optJSONObject("blockingScreen") ?: return null
            // Parse and return CachedScreen
            // ...
        } catch (e: Exception) {
            cacheFile.delete()
            null
        }
    }

    fun cacheBlocker(screen: StartingScreen, backgroundImagePath: String?) {
        try {
            val json = JSONObject().apply {
                put("cacheVersion", CACHE_VERSION)
                put("blockingScreen", JSONObject().apply {
                    put("screenId", screen.screenId)
                    put("contentHash", screen.contentHash)
                    // ... all content fields
                    put("backgroundImagePath", backgroundImagePath)
                })
            }
            // Atomic write
            val tempFile = File(context.cacheDir, "starting_screens_cache.tmp")
            tempFile.writeText(json.toString())
            tempFile.renameTo(cacheFile)
        } catch (e: Exception) {
            // Log, don't crash
        }
    }

    fun clearBlocker() { cacheFile.delete() }

    fun isDismissed(screenId: String): Boolean =
        prefs.getStringSet("dismissed_once", emptySet())?.contains(screenId) == true

    fun markDismissed(screenId: String) {
        val current = prefs.getStringSet("dismissed_once", emptySet())?.toMutableSet() ?: mutableSetOf()
        current.add(screenId)
        prefs.edit().putStringSet("dismissed_once", current).apply()
    }
}
```

- [ ] **Step 3: Run tests**

```bash
./gradlew testDevDebugUnitTest --tests "*StartingScreenCache*"
```

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add app/src/main/java/com/shyden/shytalk/feature/starting/ app/src/test/
git commit -m "feat: add StartingScreenCache with atomic file writes and dismissed ID tracking"
```

---

## Chunk 4: StartingScreen Composable

### Task 4: Build the StartingScreen composable

**Files:**
- Create: `app/src/main/.../feature/starting/StartingScreen.kt`

- [ ] **Step 1: Implement composable**

Following the spec layout: Surface → Background image + overlay → Column → ShyTalk branding → Template icon → Title → Message → Dismiss button.

Key details from spec:
- `testTag("startingScreen_title")`, `testTag("startingScreen_message")`, `testTag("startingScreen_dismissButton")`
- ShyTalk app icon via `context.packageManager.getApplicationIcon()` as `BitmapPainter`
- "ShyTalk" text in `headlineLarge`
- `police_duck` from `R.drawable.police_duck`
- Background image: `ContentScale.Crop`, `Color.Black.copy(alpha = 0.6f)` overlay
- `verticalScroll`, `padding(32.dp)`, centred
- Dismiss button only when `dismissable == true`
- All images with `contentDescription`

- [ ] **Step 2: Add Compose preview annotations**

```kotlin
@Preview(showBackground = true)
@Composable
fun StartingScreenPreview_Warning() {
    StartingScreen(
        screen = StartingScreen(screenId = "preview", enabled = true, dismissable = false,
            frequency = "every_launch", template = "warning",
            title = "ShyTalk is not available yet",
            message = "ShyTalk has not been released yet...",
            imageType = "police_duck"),
        onDismiss = {}
    )
}
```

- [ ] **Step 3: Verify build**

```bash
./gradlew assembleDevDebug
```

Expected: BUILD SUCCESSFUL

- [ ] **Step 4: Commit**

```bash
git add app/src/main/java/com/shyden/shytalk/feature/starting/
git commit -m "feat: add StartingScreen composable with branding, templates, and background image support"
```

---

## Chunk 5: MainActivity Integration

### Task 5: Insert starting screens check into startup chain

**Files:**
- Modify: `app/src/main/.../MainActivity.kt`

- [ ] **Step 1: Add starting screen state variables**

In `MainActivity.setContent {}`, add before existing `checkComplete` logic:

```kotlin
var startingScreenCheckDone by remember { mutableStateOf(false) }
var blockingScreen by remember { mutableStateOf<StartingScreen?>(null) }
var dismissableScreens by remember { mutableStateOf<List<StartingScreen>>(emptyList()) }
var blockingScreenDismissed by remember { mutableStateOf(false) }
```

- [ ] **Step 2: Add LaunchedEffect for starting screen check**

Insert as the FIRST LaunchedEffect, before existing update/health checks:

```kotlin
val cache = remember { StartingScreenCache(this@MainActivity) }

LaunchedEffect(Unit) {
    // Check cache first
    val cached = cache.getCachedBlocker()

    when (val result = appConfigService.getStartingScreens()) {
        is Resource.Success -> {
            val screens = result.data
            val blocker = screens.values.firstOrNull { !it.dismissable }
            if (blocker != null) {
                if (cached?.contentHash != blocker.contentHash) {
                    cache.cacheBlocker(blocker, null)
                }
                blockingScreen = blocker
            } else {
                cache.clearBlocker()
                dismissableScreens = screens.values
                    .filter { it.dismissable }
                    .filter { it.frequency != "once" || !cache.isDismissed(it.screenId) }
                    .toList()
            }
        }
        is Resource.Error -> {
            if (cached != null) {
                blockingScreen = cached.toStartingScreen()
            }
        }
        is Resource.Loading -> {}
    }
    startingScreenCheckDone = true
}
```

- [ ] **Step 3: Add blocking screen to the `when` chain**

Insert as the FIRST check in the existing `when` block (before `!checkComplete`):

```kotlin
when {
    !startingScreenCheckDone -> {
        // Show loading spinner (same as existing checkComplete spinner)
    }
    blockingScreen != null && !blockingScreenDismissed -> {
        StartingScreen(
            screen = blockingScreen!!,
            onDismiss = { blockingScreenDismissed = true }
        )
        // STOP — don't proceed to any other checks
    }
    !checkComplete -> { /* existing spinner */ }
    isUnsafe -> { UnsafeDeviceScreen() }
    // ... rest of existing chain
}
```

- [ ] **Step 4: Add dismissable screens after auth**

After the existing auth/legal flow, before entering the main app, show dismissable screens if any.

- [ ] **Step 5: Verify build and manual test**

```bash
./gradlew assembleDevDebug
```

Expected: BUILD SUCCESSFUL

- [ ] **Step 6: Commit**

```bash
git add app/src/main/java/com/shyden/shytalk/MainActivity.kt
git commit -m "feat: integrate starting screens check as first step in MainActivity startup chain"
```

---

## Chunk 6: i18n

### Task 6: Add string resources to all 19 locales

**Files:**
- Modify: `shared/src/commonMain/composeResources/values/strings.xml` (and all 19 `values-*` directories)

- [ ] **Step 1: Add to default (English) strings.xml**

```xml
<string name="starting_screen_pre_launch_title">ShyTalk is not available yet</string>
<string name="starting_screen_pre_launch_message">ShyTalk has not been released yet. To apply to test the application, contact Shyden. Testing is available for iOS and Android users.</string>
<string name="starting_screen_dismiss">Continue</string>
<string name="starting_screen_police_duck_description">Warning illustration</string>
<string name="starting_screen_loading">Loading…</string>
```

The `starting_screen_loading` string is used during the `startingScreenCheckDone` spinner — do NOT reuse `checking_for_updates` which is misleading in this context.

- [ ] **Step 2: Add translated strings to all 19 locale files**

Translate and add to: `values-ar`, `values-de`, `values-es`, `values-fr`, `values-hi`, `values-id`, `values-it`, `values-ja`, `values-ko`, `values-nl`, `values-pl`, `values-pt`, `values-ru`, `values-sv`, `values-th`, `values-tr`, `values-uk`, `values-vi`, `values-zh`.

- [ ] **Step 3: Run i18n checker**

Verify all 19 locale files + default contain the new keys.

- [ ] **Step 4: Verify build**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 5: Commit**

```bash
git add shared/src/commonMain/composeResources/
git commit -m "feat: add starting screen i18n strings for all 19 locales"
```

---

## Chunk 7: E2E Tests

### Task 7: Write Gherkin E2E scenarios

**Files:**
- Create: `app/src/androidTest/assets/features/starting_screens.feature`
- Create: `app/src/androidTest/.../steps/StartingScreenSteps.kt`

- [ ] **Step 1: Write feature file**

Key scenarios from spec:
- Blocking screen prevents app access
- Dismissable screen can be dismissed
- One-time screen not shown after dismissal
- Every-launch screen shown every time
- Allowlisted device can dismiss blocking screen
- API failure with cached blocker → blocked
- API failure with no cache → normal app

- [ ] **Step 2: Implement step definitions**

Using existing `ComposeTestRuleHolder` pattern and `FakeAppConfigService`.

- [ ] **Step 3: Run E2E tests**

```bash
./gradlew connectedDevDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.features=starting_screens.feature
```

- [ ] **Step 4: Commit**

```bash
git add app/src/androidTest/
git commit -m "test: add starting screens E2E Gherkin scenarios"
```

---

## Chunk 8: Deep Test Coverage

### Task 8: Add all remaining unit tests per spec

**Files:**
- Create/modify: Unit test files for cache, service, composable, state machine, absence, regression, property-based

- [ ] **Step 1: Add all tests from spec section 6**

Systematically implement every test case listed under:
- StartingScreenService/Repository tests
- Caching edge cases
- X-Device-Id header tests
- StartingScreen composable tests
- State machine tests
- Absence tests
- Platform-specific tests
- Regression tests
- Property-based tests (Kotest)

See spec `.project/plans/2026-03-20-starting-screens-design.md` section 6 for the complete listing.

- [ ] **Step 2: Run full test suite**

```bash
./gradlew test
```

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add app/src/test/ app/src/androidTest/
git commit -m "test: exhaustive starting screens test coverage per spec"
```
