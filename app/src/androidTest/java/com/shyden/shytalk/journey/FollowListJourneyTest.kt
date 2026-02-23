package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FollowListJourneyTest {

    @get:Rule
    val composeTestRule = createComposeRule()

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
        Thread.sleep(250)
        composeTestRule.mainClock.advanceTimeBy(500)

        composeTestRule.onNodeWithTag("followList_followersTab").performClick()
        Thread.sleep(250)
        composeTestRule.mainClock.advanceTimeBy(500)
    }
}
