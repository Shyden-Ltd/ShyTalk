package com.shyden.shytalk.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenTest {
    companion object {
        /** All Screen objects — keep in sync with Screen.kt sealed class. */
        private val allScreens: List<Screen> =
            listOf(
                Screen.SignIn,
                Screen.ProfileSetup,
                Screen.Main,
                Screen.Room,
                Screen.UserProfile,
                Screen.FollowList,
                Screen.RequiredDOB,
                Screen.PrivacyPolicy,
                Screen.Settings,
                Screen.PrivateChat,
                Screen.GroupChat,
                Screen.NewMessage,
                Screen.GroupSetup,
                Screen.CommunityStandards,
                Screen.TermsAndConditions,
                Screen.LegalAcceptance,
                Screen.ReportReview,
                Screen.Warning,
                Screen.Wallet,
                Screen.Transactions,
                Screen.GiftWall,
                Screen.Browser,
                Screen.EmailSignIn,
                Screen.Lock,
                Screen.PinSetup,
                Screen.SecuritySettings,
                Screen.CyberBullyingPolicy,
            )

        private val allRoutes: List<String> = allScreens.map { it.route }

        /** Screens whose routes contain {param} placeholders. */
        private val parameterizedScreens: Map<String, String> =
            mapOf(
                "Room" to Screen.Room.route,
                "UserProfile" to Screen.UserProfile.route,
                "FollowList" to Screen.FollowList.route,
                "PrivateChat" to Screen.PrivateChat.route,
                "GroupChat" to Screen.GroupChat.route,
                "GroupSetup" to Screen.GroupSetup.route,
                "GiftWall" to Screen.GiftWall.route,
                "Browser" to Screen.Browser.route,
            )

        private val staticRoutes: List<String> =
            allRoutes.filter { route -> !route.contains("{") }
    }

    // ─── Individual route correctness ────────────────────────────

    @Test
    fun `SignIn has correct route`() {
        assertEquals("sign_in", Screen.SignIn.route)
    }

    @Test
    fun `ProfileSetup has correct route`() {
        assertEquals("profile_setup", Screen.ProfileSetup.route)
    }

    @Test
    fun `Main has correct route`() {
        assertEquals("main", Screen.Main.route)
    }

    @Test
    fun `Room route contains roomId placeholder`() {
        assertEquals("room/{roomId}", Screen.Room.route)
    }

    @Test
    fun `Room createRoute substitutes roomId`() {
        assertEquals("room/abc-123", Screen.Room.createRoute("abc-123"))
    }

    @Test
    fun `UserProfile route contains userId placeholder`() {
        assertEquals("profile/{userId}", Screen.UserProfile.route)
    }

    @Test
    fun `UserProfile createRoute substitutes userId`() {
        assertEquals("profile/user-42", Screen.UserProfile.createRoute("user-42"))
    }

    @Test
    fun `FollowList route contains both placeholders`() {
        assertEquals("follow_list/{userId}/{tab}", Screen.FollowList.route)
    }

    @Test
    fun `FollowList createRoute substitutes both params`() {
        assertEquals(
            "follow_list/user-42/followers",
            Screen.FollowList.createRoute("user-42", "followers"),
        )
    }

    @Test
    fun `RequiredDOB has correct route`() {
        assertEquals("required_dob", Screen.RequiredDOB.route)
    }

    @Test
    fun `Settings has correct route`() {
        assertEquals("settings", Screen.Settings.route)
    }

    @Test
    fun `PrivacyPolicy has correct route`() {
        assertEquals("privacy_policy", Screen.PrivacyPolicy.route)
    }

    @Test
    fun `PrivateChat route contains otherUserId placeholder`() {
        assertEquals("chat/{otherUserId}", Screen.PrivateChat.route)
    }

    @Test
    fun `PrivateChat createRoute substitutes otherUserId`() {
        assertEquals("chat/user-42", Screen.PrivateChat.createRoute("user-42"))
    }

    @Test
    fun `GroupChat route contains conversationId placeholder`() {
        assertEquals("group_chat/{conversationId}", Screen.GroupChat.route)
    }

    @Test
    fun `GroupChat createRoute substitutes conversationId`() {
        assertEquals("group_chat/conv-123", Screen.GroupChat.createRoute("conv-123"))
    }

    @Test
    fun `NewMessage has correct route`() {
        assertEquals("new_message", Screen.NewMessage.route)
    }

    @Test
    fun `GroupSetup route contains selectedIds placeholder`() {
        assertEquals("group_setup/{selectedIds}", Screen.GroupSetup.route)
    }

    @Test
    fun `GroupSetup createRoute substitutes selectedIds`() {
        assertEquals("group_setup/id1,id2,id3", Screen.GroupSetup.createRoute("id1,id2,id3"))
    }

    @Test
    fun `Warning has correct route`() {
        assertEquals("warning", Screen.Warning.route)
    }

    @Test
    fun `Wallet has correct route`() {
        assertEquals("wallet", Screen.Wallet.route)
    }

    @Test
    fun `Transactions has correct route`() {
        assertEquals("transactions", Screen.Transactions.route)
    }

    @Test
    fun `GiftWall route contains userId placeholder`() {
        assertEquals("gift_wall/{userId}", Screen.GiftWall.route)
    }

    @Test
    fun `GiftWall createRoute substitutes userId`() {
        assertEquals("gift_wall/user-99", Screen.GiftWall.createRoute("user-99"))
    }

    @Test
    fun `Browser route contains url placeholder`() {
        assertEquals("browser/{url}", Screen.Browser.route)
    }

    @Test
    fun `Browser createRoute substitutes encoded url`() {
        assertEquals("browser/https%3A%2F%2Fshytalk.com", Screen.Browser.createRoute("https%3A%2F%2Fshytalk.com"))
    }

    @Test
    fun `EmailSignIn has correct route`() {
        assertEquals("email_sign_in", Screen.EmailSignIn.route)
    }

    @Test
    fun `Lock has correct route`() {
        assertEquals("lock", Screen.Lock.route)
    }

    @Test
    fun `PinSetup has correct route`() {
        assertEquals("pin_setup", Screen.PinSetup.route)
    }

    @Test
    fun `SecuritySettings has correct route`() {
        assertEquals("security_settings", Screen.SecuritySettings.route)
    }

    @Test
    fun `CyberBullyingPolicy has correct route`() {
        assertEquals("cyber_bullying_policy", Screen.CyberBullyingPolicy.route)
    }

    @Test
    fun `CommunityStandards has correct route`() {
        assertEquals("community_standards", Screen.CommunityStandards.route)
    }

    @Test
    fun `TermsAndConditions has correct route`() {
        assertEquals("terms_and_conditions", Screen.TermsAndConditions.route)
    }

    @Test
    fun `LegalAcceptance has correct route`() {
        assertEquals("legal_acceptance", Screen.LegalAcceptance.route)
    }

    @Test
    fun `ReportReview has correct route`() {
        assertEquals("report_review", Screen.ReportReview.route)
    }

    // ─── Aggregate route invariants ──────────────────────────────

    @Test
    fun `all routes are unique`() {
        assertEquals("Duplicate routes found", allRoutes.size, allRoutes.toSet().size)
    }

    @Test
    fun `no route contains whitespace`() {
        allRoutes.forEach { route ->
            assertFalse("Route '$route' contains whitespace", route.contains(" "))
        }
    }

    @Test
    fun `parameterized routes contain curly brace placeholders`() {
        parameterizedScreens.forEach { (name, route) ->
            assertTrue("$name route '$route' should contain {param}", route.contains("{") && route.contains("}"))
        }
    }

    @Test
    fun `static routes do not contain curly brace placeholders`() {
        staticRoutes.forEach { route ->
            assertFalse("Static route '$route' should not contain placeholders", route.contains("{"))
        }
    }

    // ─── createRoute contracts ───────────────────────────────────

    @Test
    fun `Room createRoute with special characters`() {
        assertEquals("room/room%20id", Screen.Room.createRoute("room%20id"))
    }

    @Test
    fun `FollowList createRoute with following tab`() {
        assertEquals(
            "follow_list/user-1/following",
            Screen.FollowList.createRoute("user-1", "following"),
        )
    }

    @Test
    fun `createRoute methods do not produce routes with placeholders`() {
        val generatedRoutes =
            listOf(
                Screen.Room.createRoute("test-room"),
                Screen.UserProfile.createRoute("test-user"),
                Screen.FollowList.createRoute("test-user", "followers"),
                Screen.PrivateChat.createRoute("test-user"),
                Screen.GroupChat.createRoute("test-conv"),
                Screen.GroupSetup.createRoute("id1,id2"),
                Screen.GiftWall.createRoute("test-user"),
                Screen.Browser.createRoute("encoded-url"),
            )
        generatedRoutes.forEach { route ->
            assertFalse("Generated route '$route' still has placeholders", route.contains("{") || route.contains("}"))
        }
    }

    @Test
    fun `createRoute with empty string produces valid route`() {
        assertEquals("room/", Screen.Room.createRoute(""))
        assertEquals("profile/", Screen.UserProfile.createRoute(""))
        assertEquals("follow_list//", Screen.FollowList.createRoute("", ""))
        assertEquals("chat/", Screen.PrivateChat.createRoute(""))
        assertEquals("group_chat/", Screen.GroupChat.createRoute(""))
        assertEquals("group_setup/", Screen.GroupSetup.createRoute(""))
        assertEquals("gift_wall/", Screen.GiftWall.createRoute(""))
        assertEquals("browser/", Screen.Browser.createRoute(""))
    }
}
