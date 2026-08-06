package com.shyden.shytalk.navigation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Tests for [PlatformScreens] param data classes.
 * Verifies defaults, construction, and that lambdas are properly invoked.
 */
class PlatformScreensTest {
    // ── SignInScreenParams ──

    @Test
    fun `SignInScreenParams defaults`() {
        val params =
            SignInScreenParams(
                onAuthSuccess = { _, _, _ -> },
            )
        assertNull(params.pendingEmailLink)
        // Verify default lambdas don't throw
        params.onEmailLinkConsumed()
        params.onNavigateToEmail()
    }

    @Test
    fun `SignInScreenParams passes email link`() {
        val params =
            SignInScreenParams(
                pendingEmailLink = "https://shytalk.com/auth?link=abc",
                onAuthSuccess = { _, _, _ -> },
            )
        assertEquals("https://shytalk.com/auth?link=abc", params.pendingEmailLink)
    }

    @Test
    fun `SignInScreenParams onAuthSuccess receives flags`() {
        var capturedProfile = false
        var capturedDOB = false
        var capturedLegal = false
        val params =
            SignInScreenParams(
                onAuthSuccess = { hasProfile, hasDOB, needsLegal ->
                    capturedProfile = hasProfile
                    capturedDOB = hasDOB
                    capturedLegal = needsLegal
                },
            )
        params.onAuthSuccess(true, false, true)
        assertTrue(capturedProfile)
        assertFalse(capturedDOB)
        assertTrue(capturedLegal)
    }

    // ── AppSettingsScreenParams ──

    @Test
    fun `AppSettingsScreenParams invokes callbacks`() {
        var backCalled = false
        var privacyCalled = false
        var securityCalled = false
        var signOutCalled = false
        val params =
            AppSettingsScreenParams(
                onNavigateBack = { backCalled = true },
                onNavigateToPrivacyPolicy = { privacyCalled = true },
                onNavigateToSecurity = { securityCalled = true },
                onSignOut = { signOutCalled = true },
            )
        params.onNavigateBack()
        params.onNavigateToPrivacyPolicy()
        params.onNavigateToSecurity()
        params.onSignOut()
        assertTrue(backCalled)
        assertTrue(privacyCalled)
        assertTrue(securityCalled)
        assertTrue(signOutCalled)
    }

    @Test
    fun `AppSettingsScreenParams defaults do not throw`() {
        val params =
            AppSettingsScreenParams(
                onNavigateBack = {},
                onNavigateToPrivacyPolicy = {},
                onNavigateToSecurity = {},
                onSignOut = {},
            )
        // Default lambdas should be safe no-ops
        params.onNavigateToCommunityStandards()
        params.onNavigateToTermsAndConditions()
        params.onNavigateToCyberBullyingPolicy()
    }

    // ── WarningScreenParams ──

    @Test
    fun `WarningScreenParams carries reason`() {
        val params =
            WarningScreenParams(
                reason = "Repeated harassment",
                onAccept = {},
                onViewCommunityStandards = {},
            )
        assertEquals("Repeated harassment", params.reason)
    }

    @Test
    fun `WarningScreenParams null reason`() {
        val params =
            WarningScreenParams(
                reason = null,
                onAccept = {},
                onViewCommunityStandards = {},
            )
        assertNull(params.reason)
    }

    @Test
    fun `WarningScreenParams invokes callbacks`() {
        var acceptCalled = false
        var communityCalled = false
        val params =
            WarningScreenParams(
                reason = "test",
                onAccept = { acceptCalled = true },
                onViewCommunityStandards = { communityCalled = true },
            )
        params.onAccept()
        params.onViewCommunityStandards()
        assertTrue(acceptCalled)
        assertTrue(communityCalled)
    }

    // ── PlatformScreens ──

    @Test
    fun `PlatformScreens can be constructed with lambdas`() {
        // Verify the data class can be created (composable lambdas
        // can't be invoked outside Compose, but construction is valid)
        val screens =
            PlatformScreens(
                signInScreen = {},
                appSettingsScreen = {},
                warningScreen = {},
                profileScreen = {},
                roomScreen = {},
            )
        // If construction succeeds without exception, the types are correct
        assertEquals(screens, screens.copy())
    }
}
