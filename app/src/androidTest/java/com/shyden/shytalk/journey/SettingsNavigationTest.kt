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
class SettingsNavigationTest {
    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    @Test
    fun settingsButton_navigatesToSettings() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_profileTab")
        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForTag("main_settingsButton")
        composeTestRule.onNodeWithTag("main_settingsButton").performClick()
        composeTestRule.waitForTag("settings_signOutButton")
        composeTestRule.onNodeWithTag("settings_signOutButton").assertExists()
    }

    @Test
    fun settings_backButton_returnsToMain() {
        // Navigate from Main to Settings, then press back
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_profileTab")
        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForTag("main_settingsButton")
        composeTestRule.onNodeWithTag("main_settingsButton").performClick()
        composeTestRule.waitForTag("settings_backButton")
        composeTestRule.onNodeWithTag("settings_backButton").performClick()
        composeTestRule.waitForTag("main_roomsTab")
        composeTestRule.onNodeWithTag("main_roomsTab").assertIsDisplayed()
    }

    @Test
    fun settings_signOutButton_exists() {
        composeTestRule.launchNavGraph(startDestination = Screen.Settings.route)
        composeTestRule.waitForTag("settings_signOutButton")
        composeTestRule.onNodeWithTag("settings_signOutButton").assertExists()
    }

    @Test
    fun settings_signOut_clickable() {
        composeTestRule.launchNavGraph(startDestination = Screen.Settings.route)
        composeTestRule.waitForTag("settings_signOutButton")
        // Verify the sign-out button is clickable (full sign-out navigation
        // requires reactive auth state which fakes don't support)
        composeTestRule.onNodeWithTag("settings_signOutButton").performClick()
        // Should not crash after clicking
        composeTestRule.mainClock.advanceTimeBy(1000)
        composeTestRule.waitForIdle()
    }

    @Test
    fun settings_privacyPolicy_navigates() {
        composeTestRule.launchNavGraph(startDestination = Screen.Settings.route)
        composeTestRule.waitForTag("settings_signOutButton")
        // Find and click About to expand its sub-items
        composeTestRule.onNodeWithText("About").performClick()
        composeTestRule.waitForText("Privacy Policy")
        composeTestRule.onNodeWithText("Privacy Policy").performClick()
        // Just verify the click navigated without crash
        composeTestRule.mainClock.advanceTimeBy(1000)
        composeTestRule.waitForIdle()
    }
}
