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
import com.shyden.shytalk.util.ResetFakesRule
import com.shyden.shytalk.util.ScreenshotRule
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PrivateMessagingTest {

    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    @Test
    fun messagesTab_showsConversationList() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_messagesTab")
        composeTestRule.onNodeWithTag("main_messagesTab").performClick()
        // Wait for conversation data to load from ViewModel
        composeTestRule.waitForText("OtherUser")
    }

    @Test
    fun clickConversation_opensPrivateChat() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_messagesTab")
        composeTestRule.onNodeWithTag("main_messagesTab").performClick()
        composeTestRule.waitForText("OtherUser")
        composeTestRule.onNodeWithText("OtherUser").performClick()
        composeTestRule.waitForTag("privateChat_messageInput")
        composeTestRule.onNodeWithTag("privateChat_messageInput").assertIsDisplayed()
    }

    @Test
    fun privateChat_backButton_returnsToMessages() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_messagesTab")
        composeTestRule.onNodeWithTag("main_messagesTab").performClick()
        composeTestRule.waitForText("OtherUser")
        composeTestRule.onNodeWithText("OtherUser").performClick()
        composeTestRule.waitForTag("privateChat_backButton")
        composeTestRule.onNodeWithTag("privateChat_backButton").performClick()
        // Allow back navigation animation to complete
        composeTestRule.mainClock.advanceTimeBy(1000)
        composeTestRule.waitForIdle()
        composeTestRule.waitForTag("main_messagesTab", timeoutMs = 5_000)
        composeTestRule.onNodeWithTag("main_messagesTab").assertIsDisplayed()
    }
}
