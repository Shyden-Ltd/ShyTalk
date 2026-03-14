package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForTag
import com.shyden.shytalk.util.waitForText
import com.shyden.shytalk.util.ResetFakesRule
import com.shyden.shytalk.util.ScreenshotRule
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FollowListJourneyTest {

    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    @Test
    fun followersTab_navigable() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.FollowList.createRoute("test-user-1", "followers")
        )
        composeTestRule.waitForTag("followList_followersTab")
        composeTestRule.onNodeWithTag("followList_followersTab").assertIsDisplayed()
    }

    @Test
    fun followingTab_navigable() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.FollowList.createRoute("test-user-1", "following")
        )
        composeTestRule.waitForTag("followList_followingTab")
        composeTestRule.onNodeWithTag("followList_followingTab").assertIsDisplayed()
    }

    @Test
    fun switchBetweenTabs() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.FollowList.createRoute("test-user-1", "followers")
        )
        composeTestRule.waitForTag("followList_followersTab")

        composeTestRule.onNodeWithTag("followList_followingTab").performClick()
        composeTestRule.mainClock.advanceTimeBy(500)
        composeTestRule.waitForIdle()

        composeTestRule.onNodeWithTag("followList_followersTab").performClick()
        composeTestRule.mainClock.advanceTimeBy(500)
        composeTestRule.waitForIdle()
    }

    // ── Stalkers tab / SuperShy gating ──────────────────────────────────

    @Test
    fun stalkersTab_notShown_forOtherUser() {
        // When viewing another user's follow list, the Stalkers tab must not appear
        composeTestRule.launchNavGraph(
            startDestination = Screen.FollowList.createRoute("other-user-id", "followers")
        )
        composeTestRule.waitForTag("followList_followersTab")
        composeTestRule.onNodeWithText("Stalkers", substring = true).assertDoesNotExist()
    }

    @Test
    fun stalkersTab_shown_forOwnList() {
        // When viewing own follow list, the Stalkers tab should be visible
        composeTestRule.launchNavGraph(
            startDestination = Screen.FollowList.createRoute("test-user-1", "followers")
        )
        composeTestRule.waitForTag("followList_followersTab")
        composeTestRule.waitForText("Stalkers (0)")
        composeTestRule.onNodeWithText("Stalkers", substring = true).assertIsDisplayed()
    }

    @Test
    fun stalkersTab_showsSuperShyGate_whenNotSuperShy() {
        // Navigate directly to the stalkers tab on own profile;
        // the test user is NOT SuperShy, so the paywall should appear
        composeTestRule.launchNavGraph(
            startDestination = Screen.FollowList.createRoute("test-user-1", "stalkers")
        )
        composeTestRule.waitForText("Super Shy Benefit")
        composeTestRule.onNodeWithText("Super Shy Benefit").assertIsDisplayed()
        composeTestRule.onNodeWithText("Get Super Shy").assertIsDisplayed()
    }

    @Test
    fun stalkersTab_superShyGate_viaTapFromFollowers() {
        // Start on followers tab, then tap into Stalkers tab;
        // the paywall should appear since test user is not SuperShy
        composeTestRule.launchNavGraph(
            startDestination = Screen.FollowList.createRoute("test-user-1", "followers")
        )
        composeTestRule.waitForText("Stalkers (0)")
        composeTestRule.onNodeWithText("Stalkers", substring = true).performClick()
        composeTestRule.mainClock.advanceTimeBy(500)
        composeTestRule.waitForIdle()

        composeTestRule.waitForText("Super Shy Benefit")
        composeTestRule.onNodeWithText("Super Shy Benefit").assertIsDisplayed()
        composeTestRule.onNodeWithText("Get Super Shy").assertIsDisplayed()
    }
}
