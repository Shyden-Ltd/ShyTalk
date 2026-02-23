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
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class GiftWallJourneyTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun giftWallScreen_navigable() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.GiftWall.createRoute("test-user-1")
        )
        composeTestRule.waitForTag("giftWall_grid")
        composeTestRule.onNodeWithTag("giftWall_grid").assertIsDisplayed()
    }

    @Test
    fun profileTab_showsGiftWallTab() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.UserProfile.createRoute("test-user-1")
        )
        composeTestRule.waitForText("Gift Wall")
        composeTestRule.onNodeWithText("Gift Wall").assertIsDisplayed()
    }

    @Test
    fun profileTab_giftWallTab_clickable() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.UserProfile.createRoute("test-user-1")
        )
        composeTestRule.waitForText("Gift Wall")
        composeTestRule.onNodeWithText("Gift Wall").performClick()
        composeTestRule.mainClock.advanceTimeBy(500)
    }
}
