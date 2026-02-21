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
class WarningAcknowledgmentTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun warningScreen_showsWarningContent() {
        composeTestRule.launchNavGraph(startDestination = Screen.Warning.route)
        composeTestRule.waitForTag("warning_title")
        composeTestRule.onNodeWithTag("warning_title").assertIsDisplayed()
        composeTestRule.onNodeWithText("Official Warning").assertIsDisplayed()
    }

    @Test
    fun acceptWarning_navigatesToMain() {
        composeTestRule.launchNavGraph(startDestination = Screen.Warning.route)
        composeTestRule.waitForTag("warning_acceptButton")
        composeTestRule.onNodeWithTag("warning_acceptButton").performClick()
        composeTestRule.waitForTag("main_roomsTab")
        composeTestRule.onNodeWithTag("main_roomsTab").assertIsDisplayed()
    }

    @Test
    fun viewCommunityStandards_navigates() {
        composeTestRule.launchNavGraph(startDestination = Screen.Warning.route)
        composeTestRule.waitForTag("warning_communityStandardsLink")
        composeTestRule.onNodeWithTag("warning_communityStandardsLink").performClick()
        // Wait for navigation to community standards screen
        composeTestRule.waitForText("Community Standards")
    }
}
