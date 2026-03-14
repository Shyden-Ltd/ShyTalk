# E2E Test Infrastructure: BDD/Gherkin + Allure Reports + Screen Coverage

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate E2E tests to Cucumber-Android BDD with Gherkin `.feature` files, add Allure Report with failure screenshots, verbose CI progress output, and fill all screen coverage gaps.

**Architecture:** Cucumber-Android replaces raw JUnit4 as the E2E test runner. Step definitions bind Gherkin steps to the existing Compose test helpers (`waitForTag`, `waitForText`, etc.). Allure-Kotlin generates JSON results that CI publishes to GitHub Pages. A custom JUnit `@Rule` captures screenshots on test failure and attaches them to Allure reports. A singleton `ComposeTestRuleHolder` shares the Compose test rule across all Cucumber step definition classes.

**Tech Stack:** Cucumber-Android 7.x, Allure-Kotlin 2.x, Allure CLI, GitHub Pages, Compose UI Testing, Koin DI

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `app/src/androidTest/assets/features/*.feature` | Gherkin feature files (one per screen/journey) |
| `app/src/androidTest/java/.../steps/CommonSteps.kt` | Shared step definitions (navigation, assertions) |
| `app/src/androidTest/java/.../steps/AuthSteps.kt` | Auth-specific step definitions |
| `app/src/androidTest/java/.../steps/SystemScreenSteps.kt` | Direct-render screen step definitions |
| `app/src/androidTest/java/.../steps/ModerationSteps.kt` | Ban/suspension/warning step definitions |
| `app/src/androidTest/java/.../util/ComposeTestRuleHolder.kt` | Singleton holder for ComposeTestRule sharing across Cucumber steps |
| `app/src/androidTest/java/.../util/ScreenshotRule.kt` | JUnit rule for failure screenshots + Allure attachment |
| `app/src/androidTest/resources/allure.properties` | Allure results directory config |
| `app/src/androidTest/assets/cucumber.properties` | Cucumber-Android config (replaces `@CucumberOptions`) |
| `allure-results/` | Generated Allure JSON (gitignored) |

### Modified Files

| File | Changes |
|------|---------|
| `app/build.gradle.kts` | Add Cucumber-Android + Allure-Kotlin dependencies, assets source set |
| `gradle/libs.versions.toml` | Add version entries for cucumber, allure |
| `app/src/androidTest/java/.../ShyTalkTestRunner.kt` | Add Cucumber argument support |
| `app/src/androidTest/java/.../di/TestKoinModule.kt` | Add `FunFactSplashViewModel` registration |
| `.gitignore` | Add `allure-results/`, `allure-report/` |
| `.github/workflows/e2e-tests.yml` | Allure report generation, verbose progress |
| 13 screen files without testTags | Add `Modifier.testTag(...)` for testability |

---

## Chunk 1: Allure Report + Failure Screenshots

### Task 1: Add Allure-Kotlin Dependencies

**Files:**
- Modify: `gradle/libs.versions.toml`
- Modify: `app/build.gradle.kts`

- [ ] **Step 1: Add Allure version to version catalog**

In `gradle/libs.versions.toml`, add under `[versions]`:
```toml
allureKotlin = "2.4.0"
```

Under `[libraries]`:
```toml
allure-kotlin-android = { group = "io.qameta.allure", name = "allure-kotlin-android", version.ref = "allureKotlin" }
allure-kotlin-junit4 = { group = "io.qameta.allure", name = "allure-kotlin-junit4", version.ref = "allureKotlin" }
```

- [ ] **Step 2: Add dependencies to app/build.gradle.kts**

In the `dependencies` block, add:
```kotlin
androidTestImplementation(libs.allure.kotlin.android)
androidTestImplementation(libs.allure.kotlin.junit4)
```

- [ ] **Step 3: Verify build compiles**

Run: `./gradlew assembleDevDebugAndroidTest`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: Commit**

```bash
git add gradle/libs.versions.toml app/build.gradle.kts
git commit -m "feat: add Allure-Kotlin dependencies for E2E test reporting"
```

---

### Task 2: Create Screenshot-on-Failure Rule

**Files:**
- Create: `app/src/androidTest/java/com/shyden/shytalk/util/ScreenshotRule.kt`

- [ ] **Step 1: Write the ScreenshotRule**

```kotlin
package com.shyden.shytalk.util

import android.graphics.Bitmap
import android.util.Log
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.captureToImage
import io.qameta.allure.kotlin.Allure
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import java.io.ByteArrayOutputStream

/**
 * JUnit rule that captures a screenshot of the Compose tree on test failure
 * and attaches it to the Allure report.
 */
class ScreenshotRule(
    private val composeTestRule: ComposeTestRule
) : TestWatcher() {
    override fun failed(e: Throwable, description: Description) {
        try {
            val bitmap = composeTestRule.onRoot().captureToImage()
                .asAndroidBitmap()
            val stream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
            val bytes = stream.toByteArray()
            val fileName = "${description.className}_${description.methodName}.png"
            Allure.attachment(
                name = fileName,
                content = bytes,
                type = "image/png",
                fileExtension = ".png"
            )
            Log.d("ScreenshotRule", "Captured failure screenshot: $fileName (${bytes.size} bytes)")
        } catch (ex: Exception) {
            Log.w("ScreenshotRule", "Failed to capture screenshot on failure", ex)
        }
    }
}
```

- [ ] **Step 2: Verify build compiles**

Run: `./gradlew assembleDevDebugAndroidTest`
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Commit**

```bash
git add app/src/androidTest/java/com/shyden/shytalk/util/ScreenshotRule.kt
git commit -m "feat: add ScreenshotRule for Allure failure screenshots"
```

---

### Task 3: Wire ScreenshotRule Into Existing Tests

**Files:**
- Modify: All 16 journey test files in `app/src/androidTest/java/com/shyden/shytalk/journey/`

- [ ] **Step 1: Add ScreenshotRule to each test class**

In each journey test file, add the rule after composeTestRule. Example for `NavigationSmokeTest.kt`:

```kotlin
import com.shyden.shytalk.util.ScreenshotRule

// ... existing rules ...

@get:Rule(order = 2)
val screenshotRule = ScreenshotRule(composeTestRule)
```

The order must be:
- `order = 0`: `ResetFakesRule`
- `order = 1`: `composeTestRule` (ComposeTestRule)
- `order = 2`: `ScreenshotRule(composeTestRule)`

Apply this pattern to all 16 journey test files:
1. `AuthFlowTest.kt`
2. `DailyRewardTest.kt`
3. `FollowListJourneyTest.kt`
4. `GiftWallJourneyTest.kt`
5. `GroupChatCreationTest.kt`
6. `IdentityFlowTest.kt`
7. `LegalAcceptanceTest.kt`
8. `LinkedAccountsTest.kt`
9. `NavigationSmokeTest.kt`
10. `PrivateMessagingTest.kt`
11. `ProfileTest.kt`
12. `RoomBrowsingTest.kt`
13. `RoomCreationTest.kt`
14. `SettingsNavigationTest.kt`
15. `WalletAndTransactionsTest.kt`
16. `WarningAcknowledgmentTest.kt`

- [ ] **Step 2: Add allure.properties config**

Create `app/src/androidTest/resources/allure.properties`:
```properties
allure.results.directory=allure-results
```

- [ ] **Step 3: Add allure dirs to .gitignore**

Append to `.gitignore`:
```
allure-results/
allure-report/
```

- [ ] **Step 4: Run E2E tests to verify screenshots work**

Run: `./gradlew connectedDevDebugAndroidTest`
Expected: All tests pass. Allure results written to device internal storage.

- [ ] **Step 5: Commit**

```bash
git add -A app/src/androidTest/java/com/shyden/shytalk/journey/ \
        app/src/androidTest/resources/allure.properties \
        .gitignore
git commit -m "feat: wire ScreenshotRule into all 16 E2E journey tests"
```

---

### Task 4: Update CI Workflow for Allure Reports + Verbose Progress

**Files:**
- Modify: `.github/workflows/e2e-tests.yml`

- [ ] **Step 1: Add Allure results pull and upload to test-android job**

In the `test-android` job, after "Run E2E tests" step, add:

```yaml
      - name: Pull Allure results from device
        if: always()
        run: |
          PACKAGE="com.shyden.shytalk.dev"
          # Allure-Kotlin writes to app internal files dir
          mkdir -p app/build/allure-results
          adb exec-out run-as $PACKAGE sh -c 'cd files/allure-results && tar cf - .' 2>/dev/null | \
            tar xf - -C app/build/allure-results/ 2>/dev/null || \
            echo "::warning::No Allure results found on device"
          ls -la app/build/allure-results/ 2>/dev/null || echo "Empty results"

      - name: Upload Allure results
        uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7
        if: always()
        with:
          name: allure-results-api${{ matrix.api-level }}-${{ matrix.form-factor }}
          path: app/build/allure-results/
          retention-days: 14
```

- [ ] **Step 2: Modify "Run E2E tests" step for verbose output + progress counter**

Replace the existing "Run E2E tests" step with:

```yaml
      - name: Run E2E tests
        env:
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
          LIVEKIT_URL: ${{ secrets.LIVEKIT_URL }}
        run: |
          # Run tests with --info for verbose test names
          ./gradlew connectedDevDebugAndroidTest --no-parallel --info 2>&1 | tee test-output.log &
          GRADLE_PID=$!

          # Progress counter — counts JUnit XML result files as they appear
          (
            PREV_COUNT=0
            while kill -0 $GRADLE_PID 2>/dev/null; do
              COUNT=$(find app/build/outputs/androidTest-results -name 'TEST-*.xml' 2>/dev/null | wc -l)
              if [ "$COUNT" -gt "$PREV_COUNT" ]; then
                PREV_COUNT=$COUNT
                echo "::notice::$COUNT test classes complete"
              fi
              sleep 5
            done
          ) &

          wait $GRADLE_PID
```

- [ ] **Step 3: Add Allure report generation job**

After the `e2e-summary` job, add:

```yaml
  # ── Generate Allure Report ──────────────────────────────────
  allure-report:
    name: Generate Allure Report
    needs: [resolve-inputs, test-android]
    if: always() && needs.resolve-inputs.result == 'success' && needs.resolve-inputs.outputs.run_android == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - name: Download all Allure results
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8
        with:
          pattern: allure-results-*
          path: allure-results-all/
          merge-multiple: true

      - name: Install Allure CLI
        run: |
          curl -sL https://github.com/allure-framework/allure2/releases/download/2.32.0/allure-2.32.0.tgz | tar xz
          echo "$PWD/allure-2.32.0/bin" >> "$GITHUB_PATH"

      - name: Restore Allure history from gh-pages
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          ref: gh-pages
          path: gh-pages
        continue-on-error: true

      - name: Copy history for trend tracking
        run: |
          mkdir -p allure-results-all/history
          cp -r gh-pages/history/* allure-results-all/history/ 2>/dev/null || echo "No previous history (first run)"

      - name: Generate Allure report
        run: allure generate allure-results-all -o allure-report --clean

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@4f9cc6602d3f66b9c108549d475ec49e8ef4d45e # v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: allure-report
          keep_files: false

      - name: Post report URL in summary
        run: |
          REPO="${{ github.repository }}"
          OWNER="${REPO%%/*}"
          echo "## Allure Report" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          echo "[View Report](https://${OWNER}.github.io/${REPO##*/}/)" >> "$GITHUB_STEP_SUMMARY"
```

**Note:** GitHub Pages must be enabled for the repository. The `gh-pages` branch is auto-created on first deploy by `peaceiris/actions-gh-pages`. The first run will have no history — trend data accumulates over subsequent runs.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/e2e-tests.yml
git commit -m "feat: add Allure report generation and verbose CI progress to E2E workflow"
```

---

## Chunk 2: Add Test Tags to Uncovered Screens

### Task 5: Add testTag Modifiers to 13 Uncovered Screens

**Files:**
- Modify: 13 screen files that lack testTag coverage

For each screen, add `Modifier.testTag("screenName_elementName")` to key interactive and informational elements. The naming convention follows the existing pattern: `{screenNameCamelCase}_{elementName}`.

- [ ] **Step 1: RequiredDOBScreen**

File: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/profile/RequiredDOBScreen.kt`

Add testTags:
- Title "One more step" text: `Modifier.testTag("requiredDob_title")` on the first `Text` composable
- DOB picker button: `Modifier.testTag("requiredDob_dateButton")` on the `OutlinedButton`
- Continue button: `Modifier.testTag("requiredDob_continueButton")` on the `Button`

- [ ] **Step 2: FunFactSplashScreen**

File: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/splash/FunFactSplashScreen.kt`

Add testTags:
- "ShyTalk" title: `Modifier.testTag("splash_title")`
- Fun fact subtitle: `Modifier.testTag("splash_subtitle")`
- Continue button: `Modifier.testTag("splash_continueButton")`

- [ ] **Step 3: ForceUpdateScreen**

File: `app/src/main/java/com/shyden/shytalk/feature/update/ForceUpdateScreen.kt`

Add testTags:
- Title: `Modifier.testTag("forceUpdate_title")`
- Update button: `Modifier.testTag("forceUpdate_updateButton")`

- [ ] **Step 4: DegradedModeScreen**

File: `app/src/main/java/com/shyden/shytalk/feature/update/DegradedModeScreen.kt`

Add testTags:
- Title: `Modifier.testTag("degraded_title")`
- Acknowledge button: `Modifier.testTag("degraded_acknowledgeButton")`

- [ ] **Step 5: UnsafeDeviceScreen**

File: `app/src/main/java/com/shyden/shytalk/feature/security/UnsafeDeviceScreen.kt`

Add testTags:
- Title: `Modifier.testTag("unsafeDevice_title")`
- Description: `Modifier.testTag("unsafeDevice_description")`

- [ ] **Step 6: BanScreen**

File: `app/src/main/java/com/shyden/shytalk/feature/suspension/BanScreen.kt`

Add testTags:
- Title: `Modifier.testTag("ban_title")`
- Reason text (inside `if (!reason.isNullOrBlank())` block): `Modifier.testTag("ban_reason")`
- Expiry text (inside `if (!expiresAt.isNullOrBlank())` block): `Modifier.testTag("ban_expires")`
- Permanent text (in `else` block): `Modifier.testTag("ban_permanent")`
- Sign out button: `Modifier.testTag("ban_signOutButton")`

- [ ] **Step 7: SuspensionScreen**

File: `app/src/main/java/com/shyden/shytalk/feature/suspension/SuspensionScreen.kt`

Add testTags:
- Title (the "Account suspended"/"Account unlocked" text): `Modifier.testTag("suspension_title")`
- Appeal text field: `Modifier.testTag("suspension_appealField")`
- Submit appeal button: `Modifier.testTag("suspension_submitAppealButton")`
- Sign out button: `Modifier.testTag("suspension_signOutButton")`

- [ ] **Step 8: ReportReviewScreen**

File: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/ReportReviewScreen.kt`

Add testTags:
- Back button (`IconButton`): `Modifier.testTag("reportReview_backButton")`
- Empty state text: `Modifier.testTag("reportReview_emptyState")`
- Report list (`LazyColumn`): `Modifier.testTag("reportReview_list")`

- [ ] **Step 9: Legal document screens (4 screens)**

Add minimal testTags to each:

**PrivacyPolicyScreen** (`shared/.../feature/privacy/PrivacyPolicyScreen.kt`):
- Back button: `Modifier.testTag("privacyPolicy_backButton")`

**CommunityStandardsScreen** (`shared/.../feature/legal/CommunityStandardsScreen.kt`):
- Back button: `Modifier.testTag("communityStandards_backButton")`

**TermsAndConditionsScreen** (`shared/.../feature/legal/TermsAndConditionsScreen.kt`):
- Back button: `Modifier.testTag("termsAndConditions_backButton")`

**CyberBullyingPolicyScreen** (`shared/.../feature/legal/CyberBullyingPolicyScreen.kt`):
- Back button: `Modifier.testTag("cyberBullyingPolicy_backButton")`

- [ ] **Step 10: Browser composable (inline in NavGraph)**

File: `app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt`

Add testTag to the browser back button `IconButton`:
`Modifier.testTag("browser_backButton")`

- [ ] **Step 11: Verify build compiles**

Run: `./gradlew assembleDevDebug`
Expected: BUILD SUCCESSFUL

- [ ] **Step 12: Run all E2E tests to verify no regressions**

Run: `./gradlew connectedDevDebugAndroidTest`
Expected: All 69 existing tests pass

- [ ] **Step 13: Commit**

```bash
git add shared/src/commonMain/kotlin/com/shyden/shytalk/feature/ \
        app/src/main/java/com/shyden/shytalk/feature/ \
        app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt
git commit -m "feat: add testTag modifiers to 13 uncovered screens for E2E testability"
```

---

## Chunk 3: Cucumber-Android BDD Framework

### Task 6: Add Cucumber-Android Dependencies

**Files:**
- Modify: `gradle/libs.versions.toml`
- Modify: `app/build.gradle.kts`

- [ ] **Step 1: Add Cucumber versions and libraries to catalog**

In `gradle/libs.versions.toml`, under `[versions]`:
```toml
cucumberAndroid = "7.20.1"
```

Under `[libraries]`:
```toml
cucumber-android = { group = "io.cucumber", name = "cucumber-android", version.ref = "cucumberAndroid" }
```

**Note:** Do NOT add `cucumber-picocontainer` — it's JVM-only and unreliable on Android. We use a singleton holder pattern instead for sharing state across step definition classes.

- [ ] **Step 2: Add dependency and assets source set to app/build.gradle.kts**

Add dependency:
```kotlin
androidTestImplementation(libs.cucumber.android)
```

Inside `android { }`, add (if not already present):
```kotlin
sourceSets {
    getByName("androidTest") {
        assets.srcDirs("src/androidTest/assets")
    }
}
```

- [ ] **Step 3: Verify build compiles**

Run: `./gradlew assembleDevDebugAndroidTest`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: Commit**

```bash
git add gradle/libs.versions.toml app/build.gradle.kts
git commit -m "feat: add Cucumber-Android dependency for BDD E2E tests"
```

---

### Task 7: Create ComposeTestRuleHolder and Cucumber Configuration

**Files:**
- Create: `app/src/androidTest/java/com/shyden/shytalk/util/ComposeTestRuleHolder.kt`
- Create: `app/src/androidTest/assets/cucumber.properties`
- Modify: `app/src/androidTest/java/com/shyden/shytalk/di/TestKoinModule.kt`

**Why a singleton holder:** Cucumber step definition classes are NOT JUnit test classes — `@get:Rule` annotations are ignored by Cucumber's runtime. PicoContainer DI (the standard Cucumber approach for sharing state) requires constructor injection and may not work reliably with Android instrumentation. The singleton holder is the simplest reliable pattern for Compose UI testing with Cucumber on Android.

- [ ] **Step 1: Create ComposeTestRuleHolder**

```kotlin
package com.shyden.shytalk.util

import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.createComposeRule

/**
 * Singleton that holds the ComposeTestRule shared across Cucumber step definition classes.
 * Cucumber creates fresh instances of step classes for each scenario, but we need a single
 * ComposeTestRule instance per scenario. This holder is initialized in CommonSteps @Before
 * and accessed by all other step definition classes.
 */
object ComposeTestRuleHolder {
    lateinit var rule: ComposeContentTestRule
        private set

    fun initialize() {
        rule = createComposeRule()
    }

    val isInitialized: Boolean
        get() = ::rule.isInitialized
}
```

- [ ] **Step 2: Create cucumber.properties**

Create `app/src/androidTest/assets/cucumber.properties`:
```properties
cucumber.glue=com.shyden.shytalk.steps
cucumber.features=features
cucumber.plugin=pretty
```

**Note:** On Android, Cucumber reads configuration from `cucumber.properties` in the assets directory, NOT from `@CucumberOptions` (which is JVM-only).

- [ ] **Step 3: Add FunFactSplashViewModel to TestKoinModule**

In `app/src/androidTest/java/com/shyden/shytalk/di/TestKoinModule.kt`, add:

```kotlin
import com.shyden.shytalk.feature.splash.FunFactSplashViewModel

// Inside testModule { ... }, with the other viewModels:
viewModel { FunFactSplashViewModel(get()) }
```

This is needed because the Splash screen is rendered via NavGraph which resolves `FunFactSplashViewModel` via Koin. Without this registration, splash screen tests crash.

- [ ] **Step 4: Verify build compiles**

Run: `./gradlew assembleDevDebugAndroidTest`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
git add app/src/androidTest/java/com/shyden/shytalk/util/ComposeTestRuleHolder.kt \
        app/src/androidTest/assets/cucumber.properties \
        app/src/androidTest/java/com/shyden/shytalk/di/TestKoinModule.kt
git commit -m "feat: add ComposeTestRuleHolder singleton and Cucumber config for BDD tests"
```

---

### Task 8: Create Common Step Definitions

**Files:**
- Create: `app/src/androidTest/java/com/shyden/shytalk/steps/CommonSteps.kt`

- [ ] **Step 1: Write shared step definitions**

```kotlin
package com.shyden.shytalk.steps

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.fake.FakeAuthRepository
import com.shyden.shytalk.util.ComposeTestRuleHolder
import com.shyden.shytalk.util.launchMainScreen
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.launchSignIn
import com.shyden.shytalk.util.waitForTag
import com.shyden.shytalk.util.waitForText
import io.cucumber.java.Before
import io.cucumber.java.en.Given
import io.cucumber.java.en.When
import io.cucumber.java.en.Then
import org.koin.java.KoinJavaComponent.getKoin

class CommonSteps {

    private val rule get() = ComposeTestRuleHolder.rule

    @Before
    fun setUp() {
        // Initialize a fresh ComposeTestRule for each scenario
        ComposeTestRuleHolder.initialize()
        // Reset all fakes to default state
        val auth = getKoin().get<AuthRepository>() as? FakeAuthRepository
        auth?.reset()
    }

    // ── Navigation ────────────────────────────────────────────
    @Given("I am on the main screen")
    fun iAmOnTheMainScreen() {
        rule.launchMainScreen()
    }

    @Given("I am on the sign-in screen")
    fun iAmOnTheSignInScreen() {
        val fakeAuth = getKoin().get<AuthRepository>() as FakeAuthRepository
        fakeAuth._isAuthenticated = false
        fakeAuth._currentUserId = null
        rule.launchSignIn()
    }

    @Given("I am on the {string} screen")
    fun iAmOnScreen(screenRoute: String) {
        rule.launchNavGraph(startDestination = screenRoute)
    }

    // ── Tab Navigation ────────────────────────────────────────
    @When("I tap the {string} tab")
    fun iTapTheTab(tabName: String) {
        val tag = when (tabName.lowercase()) {
            "rooms" -> "main_roomsTab"
            "messages" -> "main_messagesTab"
            "profile" -> "main_profileTab"
            else -> error("Unknown tab: $tabName")
        }
        rule.waitForTag(tag)
        rule.onNodeWithTag(tag).performClick()
    }

    // ── Interactions ──────────────────────────────────────────
    @When("I tap the element with tag {string}")
    fun iTapElementWithTag(tag: String) {
        rule.waitForTag(tag)
        rule.onNodeWithTag(tag).performClick()
    }

    @When("I tap the text {string}")
    fun iTapText(text: String) {
        rule.waitForText(text)
        rule.onNodeWithText(text).performClick()
    }

    @When("I type {string} into the field with tag {string}")
    fun iTypeIntoField(text: String, tag: String) {
        rule.waitForTag(tag)
        rule.onNodeWithTag(tag).performTextInput(text)
    }

    // ── Assertions ────────────────────────────────────────────
    @Then("I should see the element with tag {string}")
    fun iShouldSeeElementWithTag(tag: String) {
        rule.waitForTag(tag)
        rule.onNodeWithTag(tag).assertIsDisplayed()
    }

    @Then("I should see the text {string}")
    fun iShouldSeeText(text: String) {
        rule.waitForText(text)
    }

    @Then("I should not see the element with tag {string}")
    fun iShouldNotSeeElementWithTag(tag: String) {
        rule.onNodeWithTag(tag).assertDoesNotExist()
    }

    // ── Wait Helpers ──────────────────────────────────────────
    @When("I wait for the element with tag {string}")
    fun iWaitForTag(tag: String) {
        rule.waitForTag(tag)
    }

    @When("I wait {int} milliseconds")
    fun iWaitMilliseconds(ms: Int) {
        rule.mainClock.advanceTimeBy(ms.toLong())
        rule.waitForIdle()
    }
}
```

- [ ] **Step 2: Verify build compiles**

Run: `./gradlew assembleDevDebugAndroidTest`
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Commit**

```bash
git add app/src/androidTest/java/com/shyden/shytalk/steps/CommonSteps.kt
git commit -m "feat: add common Cucumber step definitions for BDD E2E tests"
```

---

### Task 9: Migrate NavigationSmokeTest to Gherkin (Proof of Concept)

**Files:**
- Create: `app/src/androidTest/assets/features/navigation.feature`

This is the **proof-of-concept migration**. Migrate one existing test to validate the Cucumber setup works end-to-end before continuing.

- [ ] **Step 1: Write the Gherkin feature file**

Create `app/src/androidTest/assets/features/navigation.feature`:

```gherkin
Feature: Bottom Navigation
  As a user
  I want to navigate between tabs
  So that I can access different sections of the app

  Background:
    Given I am on the main screen

  Scenario: All bottom tabs are navigable
    When I tap the "Messages" tab
    Then I should see the element with tag "main_messagesTab"
    When I tap the "Profile" tab
    Then I should see the element with tag "main_profileTab"
    When I tap the "Rooms" tab
    Then I should see the element with tag "main_roomsTab"

  Scenario: Rooms tab shows room list
    Then I should see the text "Chill Zone"

  Scenario: Profile tab shows user profile
    When I tap the "Profile" tab
    Then I should see the element with tag "profile_displayName"

  Scenario: Create room FAB is visible on rooms tab
    Then I should see the element with tag "main_createRoomFab"

  Scenario: New message FAB is visible on messages tab
    When I tap the "Messages" tab
    Then I should see the element with tag "main_newMessageFab"
```

- [ ] **Step 2: Run Cucumber tests to verify the BDD framework works**

Run: `./gradlew connectedDevDebugAndroidTest`
Expected: Both old JUnit4 tests AND new Cucumber scenarios pass. The 5 navigation scenarios should appear in the test output.

**If Cucumber tests don't execute:** The instrumentation runner may need a `cucumberTag` or the CucumberAndroidJUnitRunner must be configured. Check `adb logcat | grep -i cucumber` for errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/androidTest/assets/features/navigation.feature
git commit -m "feat: migrate NavigationSmokeTest to Gherkin BDD format (proof of concept)"
```

---

### Task 10: Create Auth Step Definitions and Migrate AuthFlowTest

**Files:**
- Create: `app/src/androidTest/java/com/shyden/shytalk/steps/AuthSteps.kt`
- Create: `app/src/androidTest/assets/features/auth.feature`

- [ ] **Step 1: Write auth-specific step definitions**

```kotlin
package com.shyden.shytalk.steps

import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.data.repository.UserFlags
import com.shyden.shytalk.fake.FakeAuthRepository
import com.shyden.shytalk.fake.FakeUserRepository
import io.cucumber.java.en.Given
import org.koin.java.KoinJavaComponent.getKoin

class AuthSteps {

    @Given("I am not authenticated")
    fun iAmNotAuthenticated() {
        val auth = getKoin().get<AuthRepository>() as FakeAuthRepository
        auth._isAuthenticated = false
        auth._currentUserId = null
    }

    @Given("I am authenticated as {string}")
    fun iAmAuthenticatedAs(userId: String) {
        val auth = getKoin().get<AuthRepository>() as FakeAuthRepository
        auth._isAuthenticated = true
        auth._currentUserId = userId
        auth._currentUserEmail = "test@example.com"
    }

    @Given("I have default user flags")
    fun iHaveDefaultUserFlags() {
        val user = getKoin().get<UserRepository>() as FakeUserRepository
        user.userFlagsFlow.value = UserFlags()
    }
}
```

- [ ] **Step 2: Write the Gherkin feature file**

Create `app/src/androidTest/assets/features/auth.feature`:

```gherkin
Feature: Authentication Flow
  As a user
  I want to sign in and set up my profile
  So that I can use the app

  Scenario: Sign-in screen shows Google button
    Given I am not authenticated
    And I am on the sign-in screen
    Then I should see the element with tag "signIn_googleButton"

  Scenario: Sign-in screen shows app title
    Given I am not authenticated
    And I am on the sign-in screen
    Then I should see the text "ShyTalk"

  Scenario: Existing user navigates to main screen
    Given I am authenticated as "test-user-1"
    And I have default user flags
    And I am on the main screen
    Then I should see the element with tag "main_roomsTab"

  Scenario: Profile setup shows form fields
    Given I am authenticated as "test-user-1"
    And I am on the "profile_setup" screen
    Then I should see the element with tag "profileSetup_displayNameField"
    And I should see the element with tag "profileSetup_dobButton"
    And I should see the element with tag "profileSetup_continueButton"
```

- [ ] **Step 3: Run to verify both old and new tests pass**

Run: `./gradlew connectedDevDebugAndroidTest`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add app/src/androidTest/assets/features/auth.feature \
        app/src/androidTest/java/com/shyden/shytalk/steps/AuthSteps.kt
git commit -m "feat: migrate AuthFlowTest to Gherkin BDD format"
```

---

## Chunk 4: E2E Screen Coverage — Zero-Coverage Screens

### Task 11: E2E Tests for RequiredDOB and Splash Screens

**Files:**
- Create: `app/src/androidTest/assets/features/required_dob.feature`
- Create: `app/src/androidTest/assets/features/splash.feature`

- [ ] **Step 1: Write required DOB feature**

```gherkin
Feature: Required Date of Birth
  As a user without a date of birth on file
  I want to enter my date of birth
  So that I can continue using the app

  Scenario: Screen shows title and date picker
    Given I am authenticated as "test-user-1"
    And I am on the "required_dob" screen
    Then I should see the element with tag "requiredDob_title"
    And I should see the element with tag "requiredDob_dateButton"
    And I should see the element with tag "requiredDob_continueButton"
```

- [ ] **Step 2: Write splash feature**

```gherkin
Feature: Fun Fact Splash Screen
  As a user launching the app
  I want to see a splash screen with a fun fact
  So that I'm entertained while the app loads

  Scenario: Splash screen shows app title
    Given I am authenticated as "test-user-1"
    And I am on the "splash" screen
    Then I should see the element with tag "splash_title"
    And I should see the text "ShyTalk"

  Scenario: Splash screen shows continue button
    Given I am authenticated as "test-user-1"
    And I am on the "splash" screen
    Then I should see the element with tag "splash_continueButton"
```

- [ ] **Step 3: Run to verify**

- [ ] **Step 4: Commit**

```bash
git add app/src/androidTest/assets/features/required_dob.feature \
        app/src/androidTest/assets/features/splash.feature
git commit -m "feat: add E2E coverage for RequiredDOB and Splash screens"
```

---

### Task 12: E2E Tests for ForceUpdate, Degraded, and UnsafeDevice Screens

These screens are rendered outside the NavGraph (directly in `MainActivity`), so they need direct `setContent` rendering.

**Files:**
- Create: `app/src/androidTest/java/com/shyden/shytalk/steps/SystemScreenSteps.kt`
- Create: `app/src/androidTest/assets/features/system_screens.feature`

- [ ] **Step 1: Write step definitions for direct-rendered screens**

```kotlin
package com.shyden.shytalk.steps

import com.shyden.shytalk.feature.update.ForceUpdateScreen
import com.shyden.shytalk.feature.update.DegradedModeScreen
import com.shyden.shytalk.feature.security.UnsafeDeviceScreen
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import com.shyden.shytalk.util.ComposeTestRuleHolder
import io.cucumber.java.en.Given

class SystemScreenSteps {

    private val rule get() = ComposeTestRuleHolder.rule

    @Given("the force update screen is displayed")
    fun forceUpdateScreenIsDisplayed() {
        rule.setContent {
            ShyTalkTheme { ForceUpdateScreen() }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("the degraded mode screen is displayed")
    fun degradedModeScreenIsDisplayed() {
        rule.setContent {
            ShyTalkTheme { DegradedModeScreen(onAcknowledge = {}) }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("the unsafe device screen is displayed")
    fun unsafeDeviceScreenIsDisplayed() {
        rule.setContent {
            ShyTalkTheme { UnsafeDeviceScreen() }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }
}
```

- [ ] **Step 2: Write the feature file**

```gherkin
Feature: System Screens
  As the app
  I want to show appropriate blocking screens
  So that users are informed about device/update/backend issues

  Scenario: Force update screen shows title and update button
    Given the force update screen is displayed
    Then I should see the element with tag "forceUpdate_title"
    And I should see the element with tag "forceUpdate_updateButton"

  Scenario: Degraded mode screen shows title and acknowledge button
    Given the degraded mode screen is displayed
    Then I should see the element with tag "degraded_title"
    And I should see the element with tag "degraded_acknowledgeButton"

  Scenario: Unsafe device screen shows warning
    Given the unsafe device screen is displayed
    Then I should see the element with tag "unsafeDevice_title"
    And I should see the element with tag "unsafeDevice_description"
```

- [ ] **Step 3: Run to verify**

- [ ] **Step 4: Commit**

```bash
git add app/src/androidTest/assets/features/system_screens.feature \
        app/src/androidTest/java/com/shyden/shytalk/steps/SystemScreenSteps.kt
git commit -m "feat: add E2E coverage for ForceUpdate, Degraded, and UnsafeDevice screens"
```

---

### Task 13: E2E Tests for Ban and Suspension Screens

**Files:**
- Create: `app/src/androidTest/java/com/shyden/shytalk/steps/ModerationSteps.kt`
- Create: `app/src/androidTest/assets/features/moderation.feature`

**Note on SuspensionScreen:** This screen plays audio via `EmergencyTonePlayer.play()` in a `DisposableEffect`. During tests, the audio player should be no-op (test device has no audio context). If it causes crashes, the `EmergencyTonePlayer` singleton needs a test mode flag. Also, the `delay(10L)` countdown timer in `SuspensionScreen` may behave unpredictably with `mainClock.autoAdvance = false` — use a far-future `endDate` to ensure the countdown is not expired during the test.

- [ ] **Step 1: Write moderation step definitions**

```kotlin
package com.shyden.shytalk.steps

import com.shyden.shytalk.feature.suspension.BanScreen
import com.shyden.shytalk.feature.suspension.SuspensionScreen
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import com.shyden.shytalk.util.ComposeTestRuleHolder
import io.cucumber.java.en.Given

class ModerationSteps {

    private val rule get() = ComposeTestRuleHolder.rule

    @Given("the ban screen is displayed for a {string} ban")
    fun banScreenDisplayed(banType: String) {
        rule.setContent {
            ShyTalkTheme {
                BanScreen(
                    banType = banType,
                    reason = "Violation of community standards",
                    expiresAt = "2026-04-01",
                    onSignOut = {}
                )
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("the permanent ban screen is displayed")
    fun permanentBanScreenDisplayed() {
        rule.setContent {
            ShyTalkTheme {
                BanScreen(
                    banType = "device",
                    reason = "Severe violation",
                    expiresAt = null,
                    onSignOut = {}
                )
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("the suspension screen is displayed with appeal option")
    fun suspensionScreenWithAppeal() {
        rule.setContent {
            ShyTalkTheme {
                SuspensionScreen(
                    reason = "Repeated violations",
                    // Far-future endDate to avoid countdown expiration during test
                    endDate = System.currentTimeMillis() + 86_400_000L * 365,
                    canAppeal = true,
                    appealStatus = null,
                    onSubmitAppeal = {},
                    onSignOut = {},
                    isLoading = false
                )
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("the suspension screen is displayed without appeal")
    fun suspensionScreenWithoutAppeal() {
        rule.setContent {
            ShyTalkTheme {
                SuspensionScreen(
                    reason = "Terms violation",
                    endDate = null,
                    canAppeal = false,
                    appealStatus = null,
                    onSubmitAppeal = {},
                    onSignOut = {},
                    isLoading = false
                )
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }
}
```

- [ ] **Step 2: Write the feature file**

```gherkin
Feature: Moderation Screens
  As an app enforcing community standards
  I want to show ban and suspension screens
  So that users understand their account status

  Scenario: Device ban screen shows title and sign out
    Given the ban screen is displayed for a "device" ban
    Then I should see the element with tag "ban_title"
    And I should see the element with tag "ban_reason"
    And I should see the element with tag "ban_expires"
    And I should see the element with tag "ban_signOutButton"

  Scenario: Network ban screen shows appropriate title
    Given the ban screen is displayed for a "network" ban
    Then I should see the element with tag "ban_title"
    And I should see the element with tag "ban_signOutButton"

  Scenario: Permanent ban shows permanent text
    Given the permanent ban screen is displayed
    Then I should see the element with tag "ban_title"
    And I should see the element with tag "ban_permanent"
    And I should see the element with tag "ban_signOutButton"

  Scenario: Suspension with appeal shows appeal form
    Given the suspension screen is displayed with appeal option
    Then I should see the element with tag "suspension_title"
    And I should see the element with tag "suspension_appealField"
    And I should see the element with tag "suspension_submitAppealButton"
    And I should see the element with tag "suspension_signOutButton"

  Scenario: Permanent suspension without appeal
    Given the suspension screen is displayed without appeal
    Then I should see the element with tag "suspension_title"
    And I should see the element with tag "suspension_signOutButton"
```

- [ ] **Step 3: Run to verify**

- [ ] **Step 4: Commit**

```bash
git add app/src/androidTest/assets/features/moderation.feature \
        app/src/androidTest/java/com/shyden/shytalk/steps/ModerationSteps.kt
git commit -m "feat: add E2E coverage for Ban and Suspension screens"
```

---

### Task 14: E2E Tests for ReportReview and GroupChat Screens

**Files:**
- Create: `app/src/androidTest/assets/features/report_review.feature`
- Create: `app/src/androidTest/assets/features/group_chat.feature`

- [ ] **Step 1: Write report review feature**

```gherkin
Feature: Report Review
  As an admin
  I want to review pending reports
  So that I can take moderation actions

  Scenario: Report review screen shows empty state
    Given I am authenticated as "test-user-1"
    And I am on the "report_review" screen
    Then I should see the element with tag "reportReview_backButton"
    And I should see the element with tag "reportReview_emptyState"
```

- [ ] **Step 2: Write group chat feature**

```gherkin
Feature: Group Chat
  As a user
  I want to chat in group conversations
  So that I can communicate with multiple people

  Scenario: Messages tab shows new message FAB for group creation
    Given I am on the main screen
    When I tap the "Messages" tab
    Then I should see the element with tag "main_newMessageFab"
```

- [ ] **Step 3: Run to verify**

- [ ] **Step 4: Commit**

```bash
git add app/src/androidTest/assets/features/report_review.feature \
        app/src/androidTest/assets/features/group_chat.feature
git commit -m "feat: add E2E coverage for ReportReview and GroupChat screens"
```

---

## Chunk 5: E2E Screen Coverage — Partial Coverage Screens

### Task 15: Enhance PrivateChat, NewMessage, Wallet, and Settings Tests

**Files:**
- Create: `app/src/androidTest/assets/features/private_chat.feature`
- Create: `app/src/androidTest/assets/features/new_message.feature`
- Create: `app/src/androidTest/assets/features/wallet.feature`
- Create: `app/src/androidTest/assets/features/settings.feature`

- [ ] **Step 1: Write private chat feature**

```gherkin
Feature: Private Chat
  As a user
  I want to send private messages
  So that I can communicate one-on-one

  Background:
    Given I am on the main screen

  Scenario: Messages tab shows conversation list
    When I tap the "Messages" tab
    Then I should see the text "OtherUser"

  Scenario: Tapping a conversation opens chat with input
    When I tap the "Messages" tab
    And I tap the text "OtherUser"
    Then I should see the element with tag "privateChat_messageInput"
    And I should see the element with tag "privateChat_sendButton"

  Scenario: Type a message in chat
    When I tap the "Messages" tab
    And I tap the text "OtherUser"
    And I wait for the element with tag "privateChat_messageInput"
    And I type "Hello there!" into the field with tag "privateChat_messageInput"
    Then I should see the element with tag "privateChat_sendButton"

  Scenario: Back button returns to messages
    When I tap the "Messages" tab
    And I tap the text "OtherUser"
    And I tap the element with tag "privateChat_backButton"
    And I wait 1000 milliseconds
    Then I should see the element with tag "main_messagesTab"
```

- [ ] **Step 2: Write new message feature**

```gherkin
Feature: New Message
  As a user
  I want to start new conversations
  So that I can message people I haven't chatted with

  Scenario: New message screen shows search and create group
    Given I am on the main screen
    When I tap the "Messages" tab
    And I tap the element with tag "main_newMessageFab"
    Then I should see the element with tag "newMessage_searchField"
    And I should see the element with tag "newMessage_createGroupButton"

  Scenario: Search for a user
    Given I am on the main screen
    When I tap the "Messages" tab
    And I tap the element with tag "main_newMessageFab"
    And I type "TestUser" into the field with tag "newMessage_searchField"
    Then I should see the element with tag "newMessage_searchField"
```

- [ ] **Step 3: Write wallet feature**

```gherkin
Feature: Wallet
  As a user
  I want to view my wallet balance
  So that I can manage my coins

  Scenario: Wallet shows balance and transactions button
    Given I am on the main screen
    When I tap the "Profile" tab
    And I tap the element with tag "profile_walletButton"
    Then I should see the element with tag "wallet_balance"
    And I should see the element with tag "wallet_transactionsButton"

  Scenario: Navigate to transaction history
    Given I am on the main screen
    When I tap the "Profile" tab
    And I tap the element with tag "profile_walletButton"
    And I tap the element with tag "wallet_transactionsButton"
    Then I should see the element with tag "transactions_list"
```

- [ ] **Step 4: Write settings feature**

```gherkin
Feature: Settings
  As a user
  I want to access app settings
  So that I can configure the app

  Scenario: Settings screen is accessible
    Given I am on the main screen
    When I tap the element with tag "main_settingsButton"
    Then I should see the element with tag "settings_backButton"
    And I should see the element with tag "settings_signOutButton"

  Scenario: Back button returns to main
    Given I am on the main screen
    When I tap the element with tag "main_settingsButton"
    And I tap the element with tag "settings_backButton"
    And I wait 1000 milliseconds
    Then I should see the element with tag "main_roomsTab"
```

- [ ] **Step 5: Run all E2E tests to verify no regressions**

Run: `./gradlew connectedDevDebugAndroidTest`
Expected: All tests pass (both old JUnit4 and new Cucumber)

- [ ] **Step 6: Commit**

```bash
git add app/src/androidTest/assets/features/private_chat.feature \
        app/src/androidTest/assets/features/new_message.feature \
        app/src/androidTest/assets/features/wallet.feature \
        app/src/androidTest/assets/features/settings.feature
git commit -m "feat: add E2E coverage for PrivateChat, NewMessage, Wallet, and Settings"
```

---

### Task 16: Enhance Room, ProfileSetup, LegalAcceptance, and IdentityFlow Tests

**Files:**
- Create: `app/src/androidTest/assets/features/room.feature`
- Create: `app/src/androidTest/assets/features/profile_setup.feature`
- Create: `app/src/androidTest/assets/features/legal_acceptance.feature`
- Create: `app/src/androidTest/assets/features/identity_flow.feature`

- [ ] **Step 1: Write room feature**

```gherkin
Feature: Room
  As a user
  I want to browse and join voice rooms
  So that I can socialize with other users

  Scenario: Room list shows available rooms
    Given I am on the main screen
    Then I should see the text "Chill Zone"

  Scenario: Create room FAB is visible
    Given I am on the main screen
    Then I should see the element with tag "main_createRoomFab"
```

- [ ] **Step 2: Write profile setup feature**

```gherkin
Feature: Profile Setup
  As a new user
  I want to set up my profile
  So that other users can identify me

  Scenario: Profile setup shows all required fields
    Given I am authenticated as "test-user-1"
    And I am on the "profile_setup" screen
    Then I should see the element with tag "profileSetup_displayNameField"
    And I should see the element with tag "profileSetup_dobButton"
    And I should see the element with tag "profileSetup_continueButton"

  Scenario: User can enter display name
    Given I am authenticated as "test-user-1"
    And I am on the "profile_setup" screen
    When I type "MyDisplayName" into the field with tag "profileSetup_displayNameField"
    Then I should see the element with tag "profileSetup_continueButton"
```

- [ ] **Step 3: Write legal acceptance feature**

```gherkin
Feature: Legal Acceptance
  As a user
  I want to accept the terms of service
  So that I can use the app

  Scenario: Legal acceptance shows accept button
    Given I am authenticated as "test-user-1"
    And I am on the "legal_acceptance" screen
    Then I should see the element with tag "legal_acceptButton"
```

- [ ] **Step 4: Write identity flow feature**

```gherkin
Feature: Identity Flow
  As a returning user
  I want the app to route me correctly after sign-in
  So that I land on the right screen

  Scenario: Authenticated user lands on main screen
    Given I am authenticated as "test-user-1"
    And I have default user flags
    And I am on the main screen
    Then I should see the element with tag "main_roomsTab"
```

- [ ] **Step 5: Run all tests**

Run: `./gradlew connectedDevDebugAndroidTest`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add app/src/androidTest/assets/features/room.feature \
        app/src/androidTest/assets/features/profile_setup.feature \
        app/src/androidTest/assets/features/legal_acceptance.feature \
        app/src/androidTest/assets/features/identity_flow.feature
git commit -m "feat: add E2E coverage for Room, ProfileSetup, LegalAcceptance, and IdentityFlow"
```

---

## Chunk 6: Migrate Remaining JUnit4 Tests + Cleanup

### Task 17: Migrate Remaining Journey Tests to Gherkin

Migrate the remaining 14 JUnit4 journey test files to Gherkin feature files. Each migration follows the same pattern:
1. Read the existing JUnit4 test class
2. Write a `.feature` file with equivalent scenarios
3. Add any needed step definitions to existing step files (or create new ones)
4. Verify both old and new tests pass

**Journey tests to migrate:**
1. `DailyRewardTest.kt` → `daily_reward.feature`
2. `FollowListJourneyTest.kt` → `follow_list.feature`
3. `GiftWallJourneyTest.kt` → `gift_wall.feature`
4. `GroupChatCreationTest.kt` → `group_creation.feature`
5. `IdentityFlowTest.kt` → (already covered in identity_flow.feature, merge)
6. `LegalAcceptanceTest.kt` → (already covered, merge)
7. `LinkedAccountsTest.kt` → `linked_accounts.feature`
8. `PrivateMessagingTest.kt` → (already covered, merge)
9. `ProfileTest.kt` → `profile.feature`
10. `RoomBrowsingTest.kt` → `room_browsing.feature`
11. `RoomCreationTest.kt` → `room_creation.feature`
12. `SettingsNavigationTest.kt` → (already covered, merge)
13. `WalletAndTransactionsTest.kt` → (already covered, merge)
14. `WarningAcknowledgmentTest.kt` → `warning.feature`

- [ ] **Step 1-14: For each test, read the JUnit4 test, write the equivalent .feature file, and verify**

This is a mechanical translation. Each test method becomes a Gherkin `Scenario`. The step definitions in `CommonSteps` and `AuthSteps` should cover most interactions. Add new step definitions only if needed for domain-specific setup (e.g., configuring fake data).

- [ ] **Step 15: Run full test suite**

Run: `./gradlew connectedDevDebugAndroidTest`
Expected: All pass (both old JUnit4 and new Cucumber)

- [ ] **Step 16: Commit**

```bash
git add app/src/androidTest/assets/features/
git commit -m "feat: migrate all remaining journey tests to Gherkin BDD format"
```

---

### Task 18: Remove Original JUnit4 Journey Tests

**ONLY after all Gherkin equivalents are verified working.**

- [ ] **Step 1: Verify all Cucumber scenarios pass**

Run: `./gradlew connectedDevDebugAndroidTest`
Expected: All Cucumber scenarios pass

- [ ] **Step 2: Delete the `journey/` package**

Delete all files in `app/src/androidTest/java/com/shyden/shytalk/journey/`

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `./gradlew connectedDevDebugAndroidTest`
Expected: All Cucumber scenarios still pass, no JUnit4 journey tests remain

- [ ] **Step 4: Commit**

```bash
git rm -r app/src/androidTest/java/com/shyden/shytalk/journey/
git commit -m "refactor: remove original JUnit4 journey tests (fully migrated to Gherkin BDD)"
```

---

### Task 19: Update CLAUDE.md and Final Verification

- [ ] **Step 1: Run all tests (unit + E2E)**

```bash
./gradlew test
./gradlew connectedDevDebugAndroidTest
```
Expected: All pass

- [ ] **Step 2: Update CLAUDE.md testing section**

Add under `## Build & Test Commands`:
```markdown
- **E2E tests (BDD)**: Feature files in `app/src/androidTest/assets/features/*.feature`
- **Step definitions**: `app/src/androidTest/java/com/shyden/shytalk/steps/`
- **Allure results**: Generated in device internal storage, pulled by CI
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with BDD/Gherkin test instructions"
```

---

## Implementation Notes

### Cucumber + Compose Test Interop
- **ComposeTestRule sharing:** Uses `ComposeTestRuleHolder` singleton — initialized in `CommonSteps` `@Before` hook, accessed by all step classes via `ComposeTestRuleHolder.rule`. This avoids PicoContainer DI issues on Android.
- **Configuration:** `cucumber.properties` in `androidTest/assets/` — NOT `@CucumberOptions` (which is JVM-only).
- **Allure plugin:** Allure-Kotlin is used directly for attachments (not `AllureCucumber7Jvm` which is JVM-only). Screenshots are attached via `Allure.attachment()` in `ScreenshotRule`.
- The `mainClock.autoAdvance = false` pattern must be applied in each step that launches content.

### Allure Report
- Allure-Kotlin generates JSON files in the app's **internal files directory** (`/data/data/{package}/files/allure-results/`).
- CI pulls results via `adb exec-out run-as {package}` (requires debuggable APK, which debug builds are).
- Historical trend data accumulates in the `gh-pages` branch over runs.
- First run creates the `gh-pages` branch automatically via `peaceiris/actions-gh-pages`.

### Test Tags Convention
- Format: `{screenNameCamelCase}_{elementName}`
- Examples: `signIn_googleButton`, `ban_signOutButton`, `splash_continueButton`

### Screens Outside NavGraph
- `ForceUpdateScreen`, `DegradedModeScreen`, `UnsafeDeviceScreen`, `BanScreen`, `SuspensionScreen` are rendered directly in `MainActivity` before the NavGraph.
- These need direct `setContent {}` rendering in step definitions, not `launchNavGraph()`.
- **SuspensionScreen caveat:** Plays audio via `EmergencyTonePlayer.play()`. Should be no-op in test context. Uses `delay(10L)` for countdown — use far-future `endDate` (1 year) to avoid expiration during test.

### Backward Compatibility
- Old JUnit4 tests and new Cucumber tests coexist during migration (Tasks 9-17).
- Only delete JUnit4 tests (Task 18) after ALL Gherkin equivalents are verified.
- The `ScreenshotRule` works with both JUnit4 and Cucumber tests.

### Missing ViewModel Registration
- `FunFactSplashViewModel` must be added to `TestKoinModule` (done in Task 7) for splash screen tests to work.
- If other ViewModel resolution errors appear during new screen tests, add them to `TestKoinModule` following the same pattern.
