package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.shyden.shytalk.util.ResetFakesRule
import com.shyden.shytalk.util.ScreenshotRule
import com.shyden.shytalk.util.launchMainScreen
import com.shyden.shytalk.util.waitForTag
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RoomCreationTest {
    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    @Before
    fun grantAudioPermission() {
        val packageName = InstrumentationRegistry.getInstrumentation().targetContext.packageName
        InstrumentationRegistry
            .getInstrumentation()
            .uiAutomation
            .executeShellCommand("pm grant $packageName android.permission.RECORD_AUDIO")
            .close()
    }

    @Test
    fun createRoom_fabOpensDialog() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_createRoomFab")
        composeTestRule.onNodeWithTag("main_createRoomFab").performClick()
        composeTestRule.waitForTag("createRoom_nameField")
        composeTestRule.onNodeWithTag("createRoom_nameField").assertIsDisplayed()
    }

    @Test
    fun createRoom_emptyName_buttonDisabled() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_createRoomFab")
        composeTestRule.onNodeWithTag("main_createRoomFab").performClick()
        composeTestRule.waitForTag("createRoom_confirmButton")
        // The Create button should be disabled with empty name
        composeTestRule.onNodeWithTag("createRoom_confirmButton").assertIsNotEnabled()
    }

    @Test
    fun createRoom_submitForm_navigatesToNewRoom() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_createRoomFab")
        composeTestRule.onNodeWithTag("main_createRoomFab").performClick()
        composeTestRule.waitForTag("createRoom_nameField")
        composeTestRule.onNodeWithTag("createRoom_nameField").performTextInput("My New Room")
        composeTestRule.onNodeWithTag("createRoom_confirmButton").performClick()
        // Should navigate to the new room (room_roomName is merged, use unmerged tree)
        composeTestRule.waitForTag("room_roomName", useUnmergedTree = true)
    }
}
