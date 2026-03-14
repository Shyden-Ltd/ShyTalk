# Branded Sign-In Buttons + Cross-Platform Auth

## Goal

Replace plain sign-in buttons with branded Google/Apple/Email buttons, enable Apple Sign-In on Android, enable Google Sign-In on iOS, and improve the email sign-in UX with a separate screen and clipboard paste fallback. TDD throughout. Full E2E test coverage.

## Platforms

- Android (Phase 1)
- iOS (Phase 2 — separate spec, out of scope for this document)

## Decisions

- **Button style:** All dark theme — Google dark branded button (#131314 bg, colored logo per Google brand guidelines), Apple black button (#000 bg, white logo per Apple HIG), Email outline button (transparent bg, #555 border, envelope icon)
- **Apple Sign-In on Android:** Firebase `OAuthProvider` with Custom Chrome Tab (in-app browser rendering, not external browser app)
- **Google Sign-In on iOS:** Phase 2 (separate spec)
- **Apple Sign-In on iOS:** Phase 2 (separate spec)
- **Email auth:** Keep Firebase magic link (free on Spark plan). Move to its own screen. Add clipboard paste fallback for when deep linking fails.
- **Development approach:** TDD — tests first for every change
- **E2E coverage:** Gherkin feature files for all sign-in flows
- **Button order:** Android: Google → Apple → Email. iOS (Phase 2): Apple → Google → Email (per Apple HIG requirement that Apple button must be most prominent)

---

## Prerequisites

### Firebase Console Configuration (Apple Sign-In)

Before implementation, configure Apple as a sign-in provider in Firebase Console for **both** projects:

1. **Apple Developer Console:**
   - Create a Service ID for ShyTalk
   - Configure the "Sign In with Apple" capability
   - Add Firebase's OAuth redirect URI as a return URL

2. **Firebase Console** (for both `shytalk-dev` and `shytalk-7ba69`):
   - Authentication → Sign-in method → Add "Apple"
   - Enter: Apple Service ID, Team ID, Key ID, private key (.p8 file)
   - The authorized redirect URI from Firebase must be registered in Apple Developer Console

These are manual steps that must be completed before Apple Sign-In will work.

---

## Phase 1: Android

### 1. Branded Button Composables

Create reusable branded button composables in `shared/src/commonMain/` so both platforms can use them:

- **`GoogleSignInButton`** — dark background (#131314), 1dp border (#8e918f), Google "G" logo (multi-color, sourced from Google's official brand resources), "Sign in with Google" text (#e3e3e3), rounded 24dp corners
- **`AppleSignInButton`** — black background (#000), 1dp border (#333), Apple logo (white, sourced from Apple's official SF Symbols/brand resources), "Sign in with Apple" text (white), rounded 24dp corners
- **`EmailSignInButton`** — transparent background, 1dp border (#555), email envelope icon (Material Icons `Email`, #ccc), "Sign in with Email" text (#ccc), rounded 24dp corners

All buttons: full width, 48dp minimum height, loading state (CircularProgressIndicator replaces text+icon). Disabled state reduces opacity.

Logo assets: Store Google "G" logo as a vector drawable in compose resources. Apple logo as a vector drawable. Both must be the official brand assets — do not create custom approximations.

### 2. Apple Sign-In on Android

Implement via Firebase `OAuthProvider`:

```kotlin
val provider = OAuthProvider.newBuilder("apple.com")
provider.addCustomParameter("locale", currentLocale)
provider.scopes = listOf("email", "name")
firebaseAuth.startActivityForSignInWithProvider(activity, provider.build())
```

This opens a Chrome Custom Tab showing Apple's sign-in page. Firebase handles the entire OAuth flow and returns a `FirebaseUser` directly — no ID token or nonce is involved on Android.

**AuthRepository interface changes:**
- Add: `suspend fun signInWithAppleViaProvider(activity: Any): Resource<String>` — takes `Any` so the interface stays in commonMain (cast to Activity on Android)

**AuthRepositoryImpl (Android) changes:**
- Implement `signInWithAppleViaProvider()` using `OAuthProvider.startActivityForSignInWithProvider()`
- Remove the current stub that returns `Resource.Error("Apple Sign-In is not supported on Android")`

**AuthViewModel changes:**
- Add `signInWithApple(activity: Any)` that calls `authRepository.signInWithAppleViaProvider(activity)`, then runs `resolveIdentityAndProceed("apple", email)` on success
- The Activity reference is passed from the composable layer via callback (not stored in ViewModel)

**Edge cases:**
- Apple only returns name/email on FIRST sign-in. Subsequent sign-ins return only the uid. The identity system handles this via `resolveIdentity()`.
- If Chrome is not installed, Custom Tabs falls back to the default browser. This is acceptable.
- Handle `FirebaseAuthUserCollisionException` — user already has account with same email via different provider. Show appropriate error.

### 3. Email Sign-In Screen (replaces inline email section)

Move email sign-in from inline on the sign-in screen to its own screen: `EmailSignInScreen`.

**New screen: `EmailSignInScreen`** (in `shared/src/commonMain/`):

**State 1 — Email input:**
- Back button (navigates back to sign-in screen)
- Title: "Sign in with Email"
- Email text field (OutlinedTextField, keyboard type Email)
- "Send Link" button (disabled until valid email, i.e. contains "@" and ".")
- Blocks disposable email domains (existing `DisposableEmailDomains.isDisposable()`)
- Loading state during send

**State 2 — Awaiting link (after send):**
- Email icon + "Check your email" title
- "We sent a sign-in link to {email}" description
- **"Paste Link" button** — reads from clipboard, extracts the Firebase magic link, calls `signInWithEmailLink()`. This is the fallback for when deep linking doesn't work.
- "Resend" button (disabled for 60s after send, then enabled)
- "Use a different email" link → returns to State 1

**AuthRepository:** No changes — keep existing `sendSignInLink(email)` and `signInWithEmailLink(email, link)`.

**AuthViewModel changes:**
- Keep existing `signInWithEmail()` and `handleEmailLink()` methods
- Add `signInWithPastedLink(link: String)` — validates the link is a Firebase sign-in link, then calls `signInWithEmailLink(storedEmail, link)`
- The `awaitingEmailLink` state already exists and drives State 2

**Clipboard access:**
- Android: `ClipboardManager.primaryClip` (platform API, already available)
- iOS (Phase 2): `UIPasteboard.general.string` via expect/actual
- Create expect/actual `fun getClipboardText(): String?` in `core/util/PlatformClipboard.kt`

### 4. Sign-In Screen Refactor

Move the sign-in screen UI from `app/` to `shared/src/commonMain/` for cross-platform reuse:

**Current:** `app/src/main/java/.../feature/auth/GoogleSignInScreen.kt` (Android-only)
**New:** `shared/src/commonMain/.../feature/auth/SignInScreen.kt` (shared)

The shared `SignInScreen` composable receives callbacks for platform-specific actions:
```kotlin
@Composable
fun SignInScreen(
    viewModel: AuthViewModel,
    onGoogleSignIn: () -> Unit,
    onAppleSignIn: () -> Unit,
    onEmailSignIn: () -> Unit,  // navigates to EmailSignInScreen
    onAuthSuccess: (hasProfile: Boolean, hasDOB: Boolean, needsLegalAcceptance: Boolean) -> Unit
)
```

**What moves to shared:**
- Sign-in UI layout (title, subtitle, branded buttons, divider, loading/error states)
- Error display (Snackbar)
- Auth state observation (AuthUiState)

**What stays in `app/` (Android-specific):**
- Google Credential Manager integration → passed as `onGoogleSignIn` callback from NavGraph
- Apple OAuthProvider integration → passed as `onAppleSignIn` callback from NavGraph
- Deep link handling for email → handled in NavGraph's `LaunchedEffect`
- Ban/Suspension/DeviceLock screens → already rendered in `MainActivity`, not in sign-in screen

**What needs expect/actual:**
- `PlatformClipboard.getClipboardText(): String?` (for paste-link fallback)

**What gets removed from the sign-in screen:**
- Inline email input section (moved to `EmailSignInScreen`)
- `SharedPreferences` direct access (use `LanguagePreference` or a new expect/actual for email storage)
- `BuildConfig.WEB_CLIENT_ID` reference (passed via Koin-injected config or constructor parameter)

### 5. Navigation Changes

- Add new route: `Screen.EmailSignIn` → `EmailSignInScreen`
- Sign-in screen "Sign in with Email" button navigates to `Screen.EmailSignIn`
- Keep existing deep link handling in NavGraph for magic links (primary path still works)
- `GoogleSignInScreen.kt` in `app/` becomes a thin wrapper that delegates to shared `SignInScreen` and wires platform callbacks

---

## Phase 2: iOS (Separate Spec)

Phase 2 is out of scope for this spec. It will be designed separately once Phase 1 is stable. High-level items:

- iOS Koin DI setup + Firebase iOS SDK integration
- iOS `AuthRepositoryImpl` (Google via GIDSignIn, Apple via ASAuthorizationController, email magic link)
- Wire shared `SignInScreen` composable with iOS-specific callbacks
- iOS navigation setup (replace placeholder `IosApp()`)
- Button order: Apple → Google → Email (Apple HIG requires Apple button first on Apple devices)

---

## Testing

### TDD Approach

Every change follows red-green-refactor:
1. Write failing test for the behavior
2. Run it, confirm it fails for the expected reason
3. Implement minimal code to pass
4. Run again, confirm pass
5. Refactor if needed

### Unit Tests (new/modified)

**AuthViewModel tests:**
- Apple sign-in success → calls resolveIdentityAndProceed with "apple" provider
- Apple sign-in failure → sets error state
- Apple sign-in user collision → shows appropriate error
- `signInWithPastedLink()` with valid link → signs in
- `signInWithPastedLink()` with invalid link → shows error
- Existing email sign-in tests remain (magic link flow unchanged)

**AuthRepositoryImpl tests:**
- `signInWithAppleViaProvider()` success → returns user ID
- `signInWithAppleViaProvider()` failure → returns error
- `signInWithAppleViaProvider()` user collision → returns specific error

**Button composable tests:**
- `GoogleSignInButton` renders with correct testTag
- `AppleSignInButton` renders with correct testTag
- `EmailSignInButton` renders with correct testTag
- Loading state shows progress indicator
- Click callback fires

**Note:** `OAuthProvider.startActivityForSignInWithProvider()` cannot be unit tested directly (launches external flow). Test at the repository layer by mocking `FirebaseAuth` and verifying the provider is constructed correctly. The actual OAuth flow is tested via manual QA.

### E2E Tests (Gherkin)

**`auth.feature` (update existing):**
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

**`email_sign_in.feature` (new):**
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

  Scenario: Send button disabled without valid email
    Given I am not authenticated
    And I am on the "email_sign_in" screen
    Then I should see the element with tag "emailSignIn_sendButton"

  Scenario: Back button returns to sign-in
    Given I am not authenticated
    And I am on the "email_sign_in" screen
    When I tap the element with tag "emailSignIn_backButton"
    Then I should see the element with tag "signIn_googleButton"

  Scenario: After sending link shows paste option
    Given I am not authenticated
    And I am on the "email_sign_in" screen
    And I type "test@example.com" into the field with tag "emailSignIn_emailField"
    When I tap the element with tag "emailSignIn_sendButton"
    Then I should see the element with tag "emailSignIn_pasteButton"
```

**`linked_accounts.feature` (update):**
```gherkin
Scenario: Apple provider shows in linked accounts
  # After signing in with Apple, the provider appears in Settings > Account > Linked Accounts
```

### Test Tags

**Sign-in screen (update existing):**
- `signIn_googleButton` (rename from existing)
- `signIn_appleButton` (new)
- `signIn_emailButton` (rename from existing)

**Email sign-in screen (new):**
- `emailSignIn_backButton`
- `emailSignIn_emailField`
- `emailSignIn_sendButton`
- `emailSignIn_pasteButton`
- `emailSignIn_resendButton`
- `emailSignIn_changeEmailLink`

---

## String Resources

New strings needed (all 19 locales):
- `sign_in_with_apple` = "Sign in with Apple"
- `sign_in_with_email` = "Sign in with Email"
- `send_link` = "Send Link"
- `paste_link` = "Paste Link"
- `paste_link_description` = "If the link didn't open automatically, copy it from your email and tap Paste Link"
- `resend` = "Resend"
- `use_different_email` = "Use a different email"
- `invalid_link` = "That doesn't look like a valid sign-in link. Please copy the full link from your email."
- `apple_sign_in_failed` = "Apple sign-in failed"

Existing strings to keep: `sign_in_with_google`, `email_hint`, `email_link_sent`, `check_your_email_description`, `error_disposable_email`

Format strings use `%1$s` positional syntax for Compose Multiplatform resources.

---

## Constraints

- **$0 hosting cost** — Firebase Spark plan supports OAuthProvider and magic link (both free)
- **No external browser** for Apple Sign-In — Chrome Custom Tab renders in-app
- **Google brand guidelines** — use official Google "G" logo asset, follow button sizing/padding requirements per https://developers.google.com/identity/branding-guidelines
- **Apple HIG** — use official Apple logo, follow "Sign in with Apple" button requirements. On iOS (Phase 2), Apple button must be first/most prominent.
- **Dark theme only** — app is always dark theme
- **Translations** — all new strings in all 19 locales
- **Backward compatibility** — keep magic link handling code. Users with pending magic link emails will still be able to sign in via deep link. The paste fallback is additive, not a replacement.

---

## Out of Scope

- iOS implementation (Phase 2 — separate spec after Phase 1 ships)
- Email/password sign-in
- Phone number sign-in
- Social sign-in providers beyond Google and Apple
- Light theme button variants
