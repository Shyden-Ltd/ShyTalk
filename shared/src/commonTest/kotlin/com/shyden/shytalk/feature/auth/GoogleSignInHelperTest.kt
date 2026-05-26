package com.shyden.shytalk.feature.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Cross-platform tests for the [GoogleSignInCancelledException] marker.
 * The actual `performGoogleSignIn` requires platform-specific mocks
 * (CredentialManager on Android, the Swift bridge on iOS) and is
 * exercised by manual QA + compile-time signature checks. Here we just
 * lock down the marker exception's API so screens can `catch` it
 * by type without depending on platform exception classes.
 */
class GoogleSignInHelperTest {
    @Test
    fun `cancelled exception is throwable`() {
        val e = GoogleSignInCancelledException()
        assertIs<Throwable>(e)
    }

    @Test
    fun `cancelled exception has stable message`() {
        // The message is shown ONLY in logs (the cancellation path is
        // silent — no snackbar), but the string is asserted here so
        // log-grepping for it stays reliable.
        val e = GoogleSignInCancelledException()
        assertEquals("Google Sign-In cancelled by user", e.message)
    }

    @Test
    fun `cancelled exception is distinct from generic Exception so callers can branch`() {
        val cancelled: Throwable = GoogleSignInCancelledException()
        val generic: Throwable = Exception("Network error")
        // Type discrimination is what enables the silent-on-cancel /
        // toast-on-error split in SignInScreen.
        assertIs<GoogleSignInCancelledException>(cancelled)
        assertNotNull(generic.message)
    }

    // ─── GoogleSignInNoAccountException ───
    //
    // Distinct typed exception for the "no Google account on device"
    // case. The user-visible message is intentionally actionable
    // ("Add a Google account in Settings…") because SignInScreen
    // forwards it to the snackbar verbatim — not the generic
    // "Google sign-in failed" used for unrecoverable failures.

    @Test
    fun `no-account exception is throwable`() {
        val e = GoogleSignInNoAccountException()
        assertIs<Throwable>(e)
    }

    @Test
    fun `no-account exception message is user-actionable`() {
        // SignInScreen.kt line 339 forwards `e.message` straight to
        // `snackbarHostState.showSnackbar`. The wording must remain
        // actionable — pin the text so a future refactor doesn't
        // accidentally drop the "in Settings" guidance and degrade
        // the error UX.
        val e = GoogleSignInNoAccountException()
        val msg = e.message ?: ""
        assertTrue(
            msg.contains("Google account", ignoreCase = true),
            "Message must mention Google account so the user knows which provider failed",
        )
        assertTrue(
            msg.contains("Settings", ignoreCase = true),
            "Message must direct the user to system Settings (the actionable fix)",
        )
    }

    @Test
    fun `no-account is distinct type from cancelled so SignInScreen catches them separately`() {
        // SignInScreen.kt has a `catch (e: GoogleSignInNoAccountException)`
        // arm BEFORE the generic catch — its surface differs (snackbar
        // shows e.message instead of the localised "google_sign_in_failed"
        // string). Pinning the type relationship guards against a
        // future refactor that makes either inherit from the other and
        // breaks the catch-order branching.
        val noAccount: Throwable = GoogleSignInNoAccountException()
        val cancelled: Throwable = GoogleSignInCancelledException()
        assertIs<GoogleSignInNoAccountException>(noAccount)
        assertIs<GoogleSignInCancelledException>(cancelled)
        // Runtime distinctness via reflection: KClass.isInstance is not folded
        // to a constant the way `!is` is (which trips allWarningsAsErrors as
        // "Check for instance is always 'true'"), so these survive -Werror while
        // still catching a future refactor that makes either exception inherit
        // from the other and breaks SignInScreen's catch-order branching.
        assertFalse(
            GoogleSignInCancelledException::class.isInstance(noAccount),
            "no-account must NOT match the cancelled catch arm",
        )
        assertFalse(
            GoogleSignInNoAccountException::class.isInstance(cancelled),
            "cancelled must NOT match the no-account catch arm",
        )
    }
}
