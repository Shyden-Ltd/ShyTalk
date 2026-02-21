package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.shyden.shytalk.fake.FakeRoomRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.util.launchMainScreen
import com.shyden.shytalk.util.waitForTag
import com.shyden.shytalk.util.waitForText
import com.shyden.shytalk.testdata.TestData
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.koin.test.KoinTest
import org.koin.test.inject

@RunWith(AndroidJUnit4::class)
class RoomBrowsingTest : KoinTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Before
    fun grantAudioPermission() {
        val packageName = InstrumentationRegistry.getInstrumentation().targetContext.packageName
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand("pm grant $packageName android.permission.RECORD_AUDIO")
            .close()
    }

    private val roomRepository: RoomRepository by inject()

    @After
    fun tearDown() {
        (roomRepository as FakeRoomRepository).rooms.value = TestData.sampleRooms
    }

    @Test
    fun mainScreen_roomsTab_showsRoomList() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForText("Chill Zone")
        composeTestRule.waitForText("Music Room")
    }

    @Test
    fun clickRoom_navigatesToRoomScreen() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForText("Chill Zone")
        composeTestRule.onNodeWithText("Chill Zone").performClick()
        composeTestRule.waitForTag("room_roomName", useUnmergedTree = true)
    }

    @Test
    fun roomsTab_emptyState_showsEmptyMessage() {
        val fakeRoom = roomRepository as FakeRoomRepository
        fakeRoom.rooms.value = emptyList()

        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("roomList_emptyState")
        composeTestRule.onNodeWithTag("roomList_emptyState").assertIsDisplayed()
    }

    @Test
    fun roomScreen_showsSeatGrid() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForText("Chill Zone")
        composeTestRule.onNodeWithText("Chill Zone").performClick()
        composeTestRule.waitForTag("room_seatGrid", useUnmergedTree = true)
    }

    @Test
    fun roomScreen_backButton_returnsToMain() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForText("Chill Zone")
        composeTestRule.onNodeWithText("Chill Zone").performClick()
        composeTestRule.waitForTag("room_backButton")
        composeTestRule.onNodeWithTag("room_backButton").performClick()
        composeTestRule.waitForTag("main_roomsTab")
        composeTestRule.onNodeWithTag("main_roomsTab").assertIsDisplayed()
    }
}
