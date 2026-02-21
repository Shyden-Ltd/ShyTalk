package com.shyden.shytalk.journey

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
class NavigationSmokeTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun allBottomTabs_navigable() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_roomsTab")

        composeTestRule.onNodeWithTag("main_messagesTab").performClick()
        composeTestRule.waitForIdle()

        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForIdle()

        composeTestRule.onNodeWithTag("main_roomsTab").performClick()
        composeTestRule.waitForIdle()
    }

    @Test
    fun roomsTab_showsRoomList() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_roomsTab")
        // Room list should be visible after ViewModel loads data
        composeTestRule.waitForText("Chill Zone")
    }

    @Test
    fun messagesTab_navigable() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_messagesTab")
        composeTestRule.onNodeWithTag("main_messagesTab").performClick()
        composeTestRule.waitForIdle()
        // Should show conversations or empty state
    }

    @Test
    fun profileTab_navigable() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_profileTab")
        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForTag("profile_displayName")
    }

    @Test
    fun settingsButton_visible_onProfileTab() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_profileTab")
        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForTag("main_settingsButton")
    }

    @Test
    fun createRoomFab_visible_onRoomsTab() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_createRoomFab")
        composeTestRule.onNodeWithTag("main_createRoomFab").assertExists()
    }

    @Test
    fun newMessageFab_visible_onMessagesTab() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_messagesTab")
        composeTestRule.onNodeWithTag("main_messagesTab").performClick()
        composeTestRule.waitForTag("main_newMessageFab")
    }
}
