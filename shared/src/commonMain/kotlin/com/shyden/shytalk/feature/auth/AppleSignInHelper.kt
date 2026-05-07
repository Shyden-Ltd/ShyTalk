package com.shyden.shytalk.feature.auth

/**
 * Cross-platform Apple Sign-In entry point. Hides the very different
 * platform mechanics behind a uniform suspend fun so the consolidated
 * SignInScreen can call it without branching:
 *
 * - **Android** uses Firebase's WebView-based OAuth provider flow
 *   (`auth.startActivityForSignInWithProvider(activity, provider)`) —
 *   so it requires the calling `Activity` and produces a UID directly.
 *   This actual is essentially a thin wrapper around
 *   `AuthViewModel.signInWithAppleViaProvider(activity)` (which is
 *   itself fire-and-forget, dispatching to viewModelScope; the screen
 *   tracks completion via `uiState.isLoading`/`uiState.error`).
 *
 * - **iOS** uses native `ASAuthorizationController` to obtain an Apple
 *   identityToken + raw nonce, then exchanges them for a Firebase UID
 *   via `AuthViewModel.signInWithApple(idToken, rawNonce)`. The
 *   `activity` param is unused.
 *
 * On user cancellation both platforms throw [AppleSignInCancelledException]
 * so the screen can branch silently without depending on platform
 * exception classes.
 */
expect suspend fun performAppleSignInFlow(
    viewModel: AuthViewModel,
    activity: Any? = null,
)

/**
 * Thrown when the user dismisses Apple Sign-In without completing.
 * Caller should treat as silent — no error toast.
 */
class AppleSignInCancelledException : Exception("Apple Sign-In cancelled by user")

/**
 * Thrown by the iOS implementation when it cannot find a foreground-
 * active `UIWindowScene` to use as the `ASPresentationAnchor` for
 * `ASAuthorizationController`. Apple's contract requires the anchor
 * to belong to such a scene; a bare `UIWindow()` (no scene) silently
 * fails to present on iOS 15+. The caller should treat this as a real
 * failure (snackbar), distinct from a user-initiated cancellation.
 *
 * Cross-platform type so consumers can match it without depending on
 * iOS-specific exception classes.
 */
class AppleSignInPresentationException : Exception("Apple Sign-In: no active UIWindow to anchor presentation")

/**
 * Thrown by the iOS implementation when ASAuthorizationController
 * reports success but the returned `ASAuthorizationAppleIDCredential`
 * has no `identityToken`. Apple's contract guarantees the token on
 * the success path, so encountering this is an SDK contract violation
 * — typed so observability can distinguish it from generic auth
 * failures (e.g. network, provider error).
 */
class AppleSignInMissingTokenException : Exception("Apple Sign-In: no identity token")
