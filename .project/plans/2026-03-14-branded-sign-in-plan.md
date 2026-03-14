# Branded Sign-In Buttons + Apple Sign-In Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain sign-in buttons with branded Google/Apple/Email buttons, enable Apple Sign-In on Android via Firebase OAuthProvider, and move email sign-in to a separate screen with clipboard paste-link fallback.

**Architecture:** Branded button composables live in `shared/src/commonMain/` (stateless, reusable by iOS later). The sign-in screen stays in `app/` for now (heavy Android dependencies). A new `EmailSignInScreen` in `shared/` handles the email magic link flow with a paste-link fallback. Apple Sign-In uses Firebase `OAuthProvider` with Chrome Custom Tab. TDD throughout.

**Tech Stack:** Firebase Auth OAuthProvider, Chrome Custom Tabs, Compose Multiplatform, Koin DI, Cucumber-Android (E2E)

**Spec:** `.project/specs/2026-03-14-branded-sign-in-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `shared/.../feature/auth/components/GoogleSignInButton.kt` | Google branded button composable (dark theme) |
| `shared/.../feature/auth/components/AppleSignInButton.kt` | Apple branded button composable (black theme) |
| `shared/.../feature/auth/components/EmailSignInButton.kt` | Email outline button composable |
| `shared/.../feature/auth/EmailSignInScreen.kt` | Email sign-in screen (input + awaiting link + paste fallback) |
| `shared/.../core/util/PlatformClipboard.kt` | expect declaration for clipboard access |
| `app/.../core/util/PlatformClipboard.kt` | Android actual: ClipboardManager |
| `shared/src/iosMain/.../core/util/PlatformClipboard.kt` | iOS actual: UIPasteboard (stub) |
| `app/src/androidTest/assets/features/email_sign_in.feature` | E2E tests for email sign-in screen |
| Compose resource vector drawables | Google "G" logo + Apple logo assets |

### Modified Files

| File | Changes |
|------|---------|
| `shared/.../data/repository/AuthRepository.kt` | Add `signInWithAppleViaProvider(activity: Any)` |
| `app/.../data/repository/AuthRepositoryImpl.kt` | Implement Apple OAuthProvider flow, remove Apple stub |
| `shared/.../feature/auth/AuthViewModel.kt` | Add `signInWithAppleViaProvider()`, add `signInWithPastedLink()` |
| `app/.../feature/auth/GoogleSignInScreen.kt` | Replace plain buttons with branded composables, add Apple button, remove inline email, add email nav |
| `shared/.../navigation/Screen.kt` | Add `EmailSignIn` route |
| `app/.../navigation/NavGraph.kt` | Add `EmailSignIn` composable route, wire email deep link to new screen |
| `app/src/androidTest/.../fake/FakeAuthRepository.kt` | Add `signInWithAppleViaProvider()` fake |
| `app/src/androidTest/assets/features/auth.feature` | Update with Apple button + email nav scenarios |
| `shared/src/commonMain/composeResources/values*/strings.xml` | New strings in 19 locales |
| `gradle/libs.versions.toml` | (no new deps — Firebase OAuthProvider is already in firebase-auth) |

---

## Chunk 1: Branded Button Composables + Apple Sign-In Backend

### Task 1: Create Branded Button Composables

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/components/GoogleSignInButton.kt`
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/components/AppleSignInButton.kt`
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/components/EmailSignInButton.kt`

- [ ] **Step 1: Create GoogleSignInButton composable**

```kotlin
package com.shyden.shytalk.feature.auth.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
// Google "G" logo will be a Painter from compose resources

@Composable
fun GoogleSignInButton(
    onClick: () -> Unit,
    isLoading: Boolean,
    enabled: Boolean = true,
    modifier: Modifier = Modifier
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled && !isLoading,
        modifier = modifier.fillMaxWidth().height(48.dp).testTag("signIn_googleButton"),
        shape = RoundedCornerShape(24.dp),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = Color(0xFF131314),
            contentColor = Color(0xFFE3E3E3)
        ),
        border = BorderStroke(1.dp, Color(0xFF8E918F))
    ) {
        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = Color(0xFFE3E3E3)
            )
        } else {
            // Google "G" logo icon (vector drawable from compose resources)
            // Icon(painter = painterResource(Res.drawable.ic_google_logo), ...)
            Spacer(modifier = Modifier.width(8.dp))
            Text(stringResource(Res.string.sign_in_with_google))
        }
    }
}
```

Follow the same pattern for `AppleSignInButton` (black bg #000, border #333, white Apple logo, white text, tag `signIn_appleButton`) and `EmailSignInButton` (transparent bg, border #555, Material email icon #ccc, text #ccc, tag `signIn_emailButton`).

The Google "G" logo and Apple logo must be sourced as official brand vector assets and stored in `shared/src/commonMain/composeResources/drawable/`. Use `painterResource()` to load them.

- [ ] **Step 2: Verify build compiles**

Run: `./gradlew assembleDevDebug`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add branded Google, Apple, and Email sign-in button composables"
```

---

### Task 2: Add Apple Sign-In to AuthRepository + AuthRepositoryImpl

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/AuthRepository.kt`
- Modify: `app/src/main/java/com/shyden/shytalk/data/repository/AuthRepositoryImpl.kt`
- Modify: `app/src/androidTest/java/com/shyden/shytalk/fake/FakeAuthRepository.kt`

- [ ] **Step 1: Write failing unit test for Apple sign-in via provider**

In `app/src/test/.../feature/auth/AuthViewModelTest.kt`, add:

```kotlin
@Test
fun `signInWithAppleViaProvider success calls resolveIdentityAndProceed`() {
    coEvery { authRepository.signInWithAppleViaProvider(any()) } returns Resource.Success("test-user-1")
    coEvery { authRepository.getProviderInfo() } returns ("apple" to "apple-uid-123")
    // ... rest of identity resolution mocks ...

    viewModel.signInWithAppleViaProvider(mockActivity)

    advanceUntilIdle()
    assertEquals(true, viewModel.uiState.value.isAuthenticated)
}
```

- [ ] **Step 2: Run test, verify it fails** (method doesn't exist yet)

- [ ] **Step 3: Add `signInWithAppleViaProvider` to AuthRepository interface**

```kotlin
// In AuthRepository.kt, add:
suspend fun signInWithAppleViaProvider(activity: Any): Resource<String>
```

- [ ] **Step 4: Implement in AuthRepositoryImpl**

```kotlin
override suspend fun signInWithAppleViaProvider(activity: Any): Resource<String> {
    return try {
        val provider = OAuthProvider.newBuilder("apple.com")
            .setScopes(listOf("email", "name"))
            .build()
        val authResult = firebaseAuth
            .startActivityForSignInWithProvider(activity as Activity, provider)
            .await()
        val uid = authResult.user?.uid ?: return Resource.Error("Apple sign-in returned no user")
        Resource.Success(uid)
    } catch (e: Exception) {
        Resource.Error(e.message ?: "Apple sign-in failed")
    }
}
```

Remove the old stub: `signInWithAppleIdToken()` that returns `Resource.Error("Apple Sign-In is not supported on Android")`. Replace it with a real implementation or keep it for iOS use (the `idToken + rawNonce` path is still needed for iOS Phase 2).

**Important:** Keep `signInWithAppleIdToken(idToken, rawNonce)` in the interface — iOS will use it. Just also add `signInWithAppleViaProvider(activity)` for Android's OAuthProvider flow.

- [ ] **Step 5: Add to FakeAuthRepository**

```kotlin
override suspend fun signInWithAppleViaProvider(activity: Any): Resource<String> {
    _isAuthenticated = true
    _currentUserId = "test-user-1"
    return Resource.Success("test-user-1")
}
```

- [ ] **Step 6: Add `signInWithAppleViaProvider` to AuthViewModel**

```kotlin
fun signInWithAppleViaProvider(activity: Any) {
    viewModelScope.launch {
        _uiState.update { it.copy(isLoading = true, error = null) }
        when (val result = authRepository.signInWithAppleViaProvider(activity)) {
            is Resource.Success -> {
                val providerInfo = authRepository.getProviderInfo()
                if (providerInfo == null) {
                    _uiState.update {
                        it.copy(isLoading = false, error = UiText.plain("Could not retrieve provider info"))
                    }
                    return@launch
                }
                resolveIdentityAndProceed(providerInfo.first, providerInfo.second)
            }
            is Resource.Error -> {
                _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
            }
            is Resource.Loading -> {}
        }
    }
}
```

- [ ] **Step 7: Run tests, verify they pass**

Run: `./gradlew test`

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: add Apple Sign-In via Firebase OAuthProvider on Android"
```

---

### Task 3: Create PlatformClipboard Expect/Actual

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/PlatformClipboard.kt`
- Create: `app/src/main/java/com/shyden/shytalk/core/util/PlatformClipboard.kt` (androidMain actual or app module)
- Create: `shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/PlatformClipboard.kt`

**Note:** Check how the project handles expect/actual. If `PlatformTime.kt` uses expect/actual in `shared/src/commonMain` + `shared/src/androidMain` + `shared/src/iosMain`, follow that pattern. If Android actuals are in `app/`, follow that pattern instead.

- [ ] **Step 1: Check existing expect/actual pattern**

Read `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/PlatformTime.kt` and its actuals to see the pattern.

- [ ] **Step 2: Create expect declaration**

```kotlin
// shared/src/commonMain/.../core/util/PlatformClipboard.kt
package com.shyden.shytalk.core.util

expect fun getClipboardText(): String?
```

- [ ] **Step 3: Create Android actual**

```kotlin
// shared/src/androidMain/.../core/util/PlatformClipboard.kt (or app/ if that's the pattern)
package com.shyden.shytalk.core.util

import android.content.ClipboardManager
import android.content.Context
import androidx.core.content.getSystemService

actual fun getClipboardText(): String? {
    // Note: this needs a Context. The expect/actual may need to be
    // a Composable function or use a context holder. Check existing patterns.
    // Alternative: make it a @Composable function that uses LocalContext.
    return null // Placeholder — will be wired properly based on existing patterns
}
```

**If Context is needed:** Make this a `@Composable` function instead, or use `LocalContext.current` at the call site in `EmailSignInScreen` and pass the clipboard text as a parameter. The simpler approach is to read clipboard in the composable and pass it to the ViewModel.

- [ ] **Step 4: Create iOS actual (stub)**

```kotlin
// shared/src/iosMain/.../core/util/PlatformClipboard.kt
package com.shyden.shytalk.core.util

actual fun getClipboardText(): String? {
    // TODO: Phase 2 — UIPasteboard.general.string
    return null
}
```

- [ ] **Step 5: Verify build compiles**

Run: `./gradlew assembleDevDebug`

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add PlatformClipboard expect/actual for cross-platform clipboard access"
```

---

## Chunk 2: Email Sign-In Screen + Sign-In Screen Refactor

### Task 4: Create EmailSignInScreen

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/EmailSignInScreen.kt`
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/Screen.kt`

- [ ] **Step 1: Add EmailSignIn route**

In `Screen.kt`, add:
```kotlin
data object EmailSignIn : Screen("email_sign_in")
```

- [ ] **Step 2: Create EmailSignInScreen composable**

```kotlin
@Composable
fun EmailSignInScreen(
    viewModel: AuthViewModel,
    onNavigateBack: () -> Unit,
    onPasteLink: (String) -> Unit,  // called with clipboard content
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // State 1: Email input (when !awaitingEmailLink)
    // State 2: Awaiting link (when awaitingEmailLink)
    //   - Shows "Check your email" message
    //   - Shows "Paste Link" button (calls onPasteLink with clipboard text)
    //   - Shows "Resend" button (60s cooldown)
    //   - Shows "Use a different email" link
}
```

The screen uses `viewModel.signInWithEmail(email)` to send the link and `viewModel.handleEmailLink(email, link)` when the user pastes a link. The paste button reads from clipboard at the composable level (using `LocalClipboardManager` or platform clipboard) and passes it to `onPasteLink`.

Test tags:
- `emailSignIn_backButton`
- `emailSignIn_emailField`
- `emailSignIn_sendButton`
- `emailSignIn_pasteButton`
- `emailSignIn_resendButton`
- `emailSignIn_changeEmailLink`

- [ ] **Step 3: Verify build compiles**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add EmailSignInScreen with paste-link fallback"
```

---

### Task 5: Refactor GoogleSignInScreen with Branded Buttons + Apple

**Files:**
- Modify: `app/src/main/java/com/shyden/shytalk/feature/auth/GoogleSignInScreen.kt`
- Modify: `app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt`

- [ ] **Step 1: Replace Google button with branded composable**

In `GoogleSignInScreen.kt`:
- Replace the `OutlinedButton` (lines 249-309) with `GoogleSignInButton(onClick = { ... Google Credential Manager flow ... }, isLoading = isBusy)`
- Add `AppleSignInButton(onClick = { viewModel.signInWithAppleViaProvider(context as Activity) }, isLoading = isBusy)` after the Google button
- Replace the email section (lines 318-383) with `EmailSignInButton(onClick = { onNavigateToEmail() }, isLoading = false)`

- [ ] **Step 2: Add `onNavigateToEmail` parameter to GoogleSignInScreen**

```kotlin
fun GoogleSignInScreen(
    // ... existing params ...
    onNavigateToEmail: () -> Unit,  // NEW
    viewModel: AuthViewModel = koinViewModel()
)
```

- [ ] **Step 3: Remove inline email input/awaiting sections**

Delete the inline email section (lines 318-383). Email is now on its own screen.

- [ ] **Step 4: Wire EmailSignIn route in NavGraph**

In `NavGraph.kt`, add:
```kotlin
composable(Screen.EmailSignIn.route) {
    EmailSignInScreen(
        viewModel = koinInject(), // or however the auth VM is scoped
        onNavigateBack = { navController.safePopBackStack() },
        onPasteLink = { link ->
            // Validate and handle the pasted link
            val authViewModel: AuthViewModel = koinInject()
            val email = prefs.getString(KEY_EMAIL_FOR_LINK, null)
            if (email != null && link.isNotBlank()) {
                authViewModel.handleEmailLink(email, link)
            }
        }
    )
}
```

Wire `onNavigateToEmail` in the sign-in composable:
```kotlin
GoogleSignInScreen(
    // ... existing params ...
    onNavigateToEmail = { navController.navigate(Screen.EmailSignIn.route) }
)
```

- [ ] **Step 5: Keep deep link handling**

The existing `pendingEmailLink` deep link handling in `GoogleSignInScreen` should remain — it's the primary path. The paste fallback on `EmailSignInScreen` is the secondary path.

- [ ] **Step 6: Run all tests**

```bash
./gradlew test
./gradlew connectedDevDebugAndroidTest
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: replace sign-in buttons with branded composables, add Apple Sign-In"
```

---

## Chunk 3: String Resources + E2E Tests

### Task 6: Add String Resources (19 locales)

**Files:**
- Modify: `shared/src/commonMain/composeResources/values/strings.xml` (English)
- Modify: 18 other locale files in `values-{locale}/strings.xml`

- [ ] **Step 1: Add English strings**

```xml
<string name="sign_in_with_apple">Sign in with Apple</string>
<string name="send_link">Send Link</string>
<string name="paste_link">Paste Link</string>
<string name="paste_link_description">If the link didn\'t open automatically, copy it from your email and tap Paste Link</string>
<string name="resend">Resend</string>
<string name="use_different_email">Use a different email</string>
<string name="invalid_link">That doesn\'t look like a valid sign-in link. Please copy the full link from your email.</string>
<string name="apple_sign_in_failed">Apple sign-in failed</string>
```

- [ ] **Step 2: Add translations for all 18 other locales**

Add the same strings (translated) to all locale files:
ar, de, es, fr, hi, id, it, ja, ko, nl, pl, pt, ru, sv, th, tr, uk, vi, zh

- [ ] **Step 3: Verify build**

Run: `./gradlew assembleDevDebug`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add sign-in string resources for all 19 locales"
```

---

### Task 7: Write E2E Tests

**Files:**
- Modify: `app/src/androidTest/assets/features/auth.feature`
- Create: `app/src/androidTest/assets/features/email_sign_in.feature`

- [ ] **Step 1: Update auth.feature**

Add scenarios:
```gherkin
Scenario: Sign-in screen shows all three branded buttons
  Given I am not authenticated
  And I am on the sign-in screen
  Then I should see the element with tag "signIn_googleButton"
  And I should see the element with tag "signIn_appleButton"
  And I should see the element with tag "signIn_emailButton"

Scenario: Email button navigates to email sign-in screen
  Given I am not authenticated
  And I am on the sign-in screen
  When I tap the element with tag "signIn_emailButton"
  Then I should see the element with tag "emailSignIn_emailField"
```

- [ ] **Step 2: Create email_sign_in.feature**

```gherkin
Feature: Email Sign-In
  As a user
  I want to sign in with my email
  So that I can access the app without Google or Apple

  Scenario: Email sign-in screen shows email input
    Given I am not authenticated
    And I am on the "email_sign_in" screen
    Then I should see the element with tag "emailSignIn_emailField"
    And I should see the element with tag "emailSignIn_sendButton"
    And I should see the element with tag "emailSignIn_backButton"

  Scenario: Back button returns to sign-in
    Given I am not authenticated
    And I am on the "email_sign_in" screen
    When I tap the element with tag "emailSignIn_backButton"
    And I wait 1000 milliseconds
    Then I should see the element with tag "signIn_googleButton"
```

- [ ] **Step 3: Run E2E tests**

Run: `./gradlew connectedDevDebugAndroidTest`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add E2E tests for branded sign-in buttons and email sign-in screen"
```

---

### Task 8: Final Verification + PR

- [ ] **Step 1: Run all tests**

```bash
./gradlew test
./gradlew connectedDevDebugAndroidTest
```

- [ ] **Step 2: Build release APK to verify**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 3: Manual QA on device**

- Verify Google Sign-In still works with branded button
- Verify Apple Sign-In opens Custom Tab and completes auth flow
- Verify Email button navigates to EmailSignInScreen
- Verify email input + send link works
- Verify paste link button reads clipboard
- Verify back navigation from email screen

- [ ] **Step 4: Commit any fixes, push, create PR**

---

## Implementation Notes

### Firebase Console Prerequisites
Apple Sign-In must be configured in Firebase Console BEFORE testing:
1. Enable "Apple" provider in Firebase Auth (both `shytalk-dev` and `shytalk-7ba69`)
2. Configure Apple Service ID, Team ID, Key ID, private key
3. Register Firebase's redirect URI in Apple Developer Console

### Brand Asset Sources
- **Google "G" logo:** Download from https://developers.google.com/identity/branding-guidelines — use the multi-color SVG, convert to Android vector drawable
- **Apple logo:** Use the official Apple logo from Apple's brand resources. On Android, store as vector drawable. Must be the standard Apple logo (not custom).

### What Stays Unchanged
- `AuthRepositoryImpl.signInWithAppleIdToken(idToken, rawNonce)` stays for iOS Phase 2
- `AuthViewModel.signInWithApple(idToken, rawNonce)` stays for iOS Phase 2
- Deep link handling for email magic link stays (primary path)
- SharedPreferences email storage stays (used by deep link handler)
- Ban/Suspension screens stay in their current locations

### What Gets Removed
- Plain `OutlinedButton` for Google sign-in (replaced by `GoogleSignInButton`)
- Inline email input section on sign-in screen (moved to `EmailSignInScreen`)
- `AccountCircle` icon on Google button (replaced by official Google "G" logo)
- `Resource.Error("Apple Sign-In is not supported on Android")` stub in AuthRepositoryImpl
