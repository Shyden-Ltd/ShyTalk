package com.shyden.shytalk.feature.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Cross-platform tests for [AppleSignInCancelledException].
 *
 * Mirrors `GoogleSignInHelperTest` for the Apple provider. The actual
 * `performAppleSignInFlow` requires platform-specific orchestration
 * (Firebase WebView OAuth on Android, ASAuthorizationController on iOS)
 * and is exercised by manual QA + integration tests in
 * `AuthViewModelIdentityTest`. Here we just lock the marker exception's
 * API so `SignInScreen` can `catch (_: AppleSignInCancelledException)`
 * without depending on platform exception classes (Android's
 * `FirebaseAuthWebException`, iOS's `NSError code 1001`).
 */
class AppleSignInHelperTest {
    @Test
    fun `cancelled exception is throwable`() {
        val e = AppleSignInCancelledException()
        assertIs<Throwable>(e)
    }

    @Test
    fun `cancelled exception has stable message`() {
        // The cancellation path is silent (no snackbar), so the message
        // appears only in `logW("SignInScreen", "Apple sign-in failed", e)`
        // breadcrumbs — but log-grep reliability still matters for
        // diagnosing intermittent reports, so the literal is pinned.
        val e = AppleSignInCancelledException()
        assertEquals("Apple Sign-In cancelled by user", e.message)
    }

    @Test
    fun `cancelled exception is distinct from generic Exception so SignInScreen branches silently`() {
        // SignInScreen.kt line 374 has `catch (_: AppleSignInCancelledException) { /* silent */ }`
        // BEFORE the generic catch that shows the localised
        // "apple_sign_in_failed" snackbar. Type discrimination is what
        // keeps cancellation silent — a future refactor must not
        // collapse this into a generic Exception or every cancel
        // would surface as a misleading "failed" toast.
        val cancelled: Throwable = AppleSignInCancelledException()
        val generic: Throwable = Exception("Apple OAuth network failure")
        assertIs<AppleSignInCancelledException>(cancelled)
        assertNotNull(generic.message)
        assertTrue(
            generic !is AppleSignInCancelledException,
            "Generic Exception must NOT match the cancelled catch arm",
        )
    }

    @Test
    fun `cancelled exception is distinct from Google's so providers don't cross-match`() {
        // SignInScreen catches each provider's cancel separately
        // because their UX is identical (silent) but the click sites
        // are independent — a future change that surfaces a
        // provider-specific recovery hint depends on the type split.
        val apple: Throwable = AppleSignInCancelledException()
        val google: Throwable = GoogleSignInCancelledException()
        assertTrue(apple !is GoogleSignInCancelledException)
        assertTrue(google !is AppleSignInCancelledException)
    }

    // ── AppleSignInPresentationException ──────────────────────────
    // Locks the contract introduced by PR #543 (Phase 2J #7) for the
    // iOS-only failure mode where ASAuthorizationController can't be
    // anchored to a foreground-active UIWindowScene. Generic
    // `Exception("Apple Sign-In: no active UIWindow…")` was the
    // original throw — replaced with a typed class so SignInScreen
    // (and future observability code) can match on it.

    @Test
    fun `presentation exception is throwable`() {
        val e = AppleSignInPresentationException()
        assertIs<Throwable>(e)
    }

    @Test
    fun `presentation exception has stable message`() {
        // Message is the surface a future log filter (Sentry breadcrumb,
        // grep over diagnostic exports) keys off — pin the literal so
        // accidental rewording doesn't break alerting.
        val e = AppleSignInPresentationException()
        assertEquals("Apple Sign-In: no active UIWindow to anchor presentation", e.message)
    }

    @Test
    fun `presentation exception is distinct from cancellation so SignInScreen surfaces a snackbar`() {
        // SignInScreen.kt (the AppleSignInButton catch chain) treats
        // AppleSignInCancelledException as silent and any other
        // Exception as a snackbar-worthy failure. Presentation failures
        // MUST fall into the snackbar arm — silent failure on a
        // genuinely-broken auth flow is the worst possible UX. Locking
        // the type-disjointness here prevents a future refactor from
        // collapsing the two into a parent class without intent.
        val cancelled: Throwable = AppleSignInCancelledException()
        val presentation: Throwable = AppleSignInPresentationException()
        assertTrue(cancelled !is AppleSignInPresentationException)
        assertTrue(presentation !is AppleSignInCancelledException)
    }

    @Test
    fun `presentation exception is distinct from Google's cancel so providers don't cross-match`() {
        // Same provider-isolation reasoning as the cancel exceptions:
        // future provider-specific recovery hints depend on the type split.
        val applePresentation: Throwable = AppleSignInPresentationException()
        val googleCancel: Throwable = GoogleSignInCancelledException()
        assertTrue(applePresentation !is GoogleSignInCancelledException)
        assertTrue(googleCancel !is AppleSignInPresentationException)
    }

    // ── AppleSignInMissingTokenException ─────────────────────────
    // Locks the contract for the iOS-only contract-violation path
    // where ASAuthorizationController returns success but the
    // ASAuthorizationAppleIDCredential has no identityToken. This is
    // a documented Apple post-condition failure (the credential MUST
    // include the token on success) — typed so observability code can
    // distinguish "Apple SDK gave us garbage" from generic auth errors.

    @Test
    fun `missing token exception is throwable`() {
        val e = AppleSignInMissingTokenException()
        assertIs<Throwable>(e)
    }

    @Test
    fun `missing token exception has stable message`() {
        val e = AppleSignInMissingTokenException()
        assertEquals("Apple Sign-In: no identity token", e.message)
    }

    @Test
    fun `missing token exception is distinct from cancellation and presentation`() {
        // All three Apple-side exceptions must be type-disjoint so the
        // SignInScreen catch chain can branch correctly: cancel = silent,
        // presentation + missing-token = snackbar-worthy.
        val cancelled: Throwable = AppleSignInCancelledException()
        val presentation: Throwable = AppleSignInPresentationException()
        val missingToken: Throwable = AppleSignInMissingTokenException()

        assertTrue(missingToken !is AppleSignInCancelledException)
        assertTrue(missingToken !is AppleSignInPresentationException)
        assertTrue(cancelled !is AppleSignInMissingTokenException)
        assertTrue(presentation !is AppleSignInMissingTokenException)
    }
}
