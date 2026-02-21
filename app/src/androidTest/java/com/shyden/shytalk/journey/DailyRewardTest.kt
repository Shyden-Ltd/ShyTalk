package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.util.launchMainScreen
import com.shyden.shytalk.util.waitForTag
import com.shyden.shytalk.util.waitForText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DailyRewardTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun mainScreen_showsDailyRewardDialog() {
        composeTestRule.launchMainScreen()
        // Daily reward dialog may or may not show depending on claim status
        // Since fake data has lastLoginRewardDate = "2026-02-20" and today is "2026-02-21",
        // the dialog should show
        composeTestRule.waitForTag("dailyReward_dialog", timeoutMs = 3_000)
        composeTestRule.onNodeWithTag("dailyReward_dialog").assertIsDisplayed()
    }

    @Test
    fun dailyReward_claimButton_dismissesDialog() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("dailyReward_claimButton", timeoutMs = 3_000)
        composeTestRule.onNodeWithTag("dailyReward_claimButton").performClick()
        // After claiming, the button changes to "Yay!" — click it to dismiss
        Thread.sleep(500)
        composeTestRule.mainClock.advanceTimeBy(500)
        composeTestRule.waitForText("Yay!")
        composeTestRule.onNodeWithText("Yay!").performClick()
        Thread.sleep(500)
        composeTestRule.mainClock.advanceTimeBy(500)
        composeTestRule.onNodeWithTag("dailyReward_dialog").assertDoesNotExist()
    }
}
