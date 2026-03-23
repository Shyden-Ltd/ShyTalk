package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.util.ResetFakesRule
import com.shyden.shytalk.util.ScreenshotRule
import com.shyden.shytalk.util.launchMainScreen
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForTag
import com.shyden.shytalk.util.waitForText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProfileTest {
    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    @Test
    fun profileTab_showsCurrentUserProfile() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_profileTab")
        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForTag("profile_displayName")
        composeTestRule.onNodeWithTag("profile_displayName").assertIsDisplayed()
    }

    @Test
    fun profileTab_showsDisplayName() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_profileTab")
        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForText("TestUser")
    }

    @Test
    fun viewOtherProfile_showsFollowButton() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.UserProfile.createRoute("test-user-2"),
        )
        composeTestRule.waitForTag("profile_followButton")
        composeTestRule.onNodeWithTag("profile_followButton").assertIsDisplayed()
    }

    @Test
    fun viewOtherProfile_showsMessageButton() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.UserProfile.createRoute("test-user-2"),
        )
        composeTestRule.waitForTag("profile_messageButton")
        composeTestRule.onNodeWithTag("profile_messageButton").assertIsDisplayed()
    }

    @Test
    fun followUser_updatesButtonText() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.UserProfile.createRoute("test-user-2"),
        )
        composeTestRule.waitForTag("profile_followButton")
        // Initially shows "Follow" (not following)
        composeTestRule.onNodeWithText("Follow").assertExists()
        composeTestRule.onNodeWithTag("profile_followButton").performClick()
        // After click, should show "Unfollow"
        composeTestRule.waitForText("Unfollow")
    }

    @Test
    fun profileTab_walletButton_navigatesToWallet() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_profileTab")
        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForTag("profile_walletButton")
        composeTestRule.onNodeWithTag("profile_walletButton").performClick()
        composeTestRule.waitForTag("wallet_balance")
        composeTestRule.onNodeWithTag("wallet_balance").assertIsDisplayed()
    }

    @Test
    fun followListScreen_navigable() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.FollowList.createRoute("test-user-1", "followers"),
        )
        composeTestRule.waitForTag("followList_followersTab")
        composeTestRule.onNodeWithTag("followList_followersTab").assertIsDisplayed()
        composeTestRule.onNodeWithTag("followList_followingTab").assertIsDisplayed()
    }
}
