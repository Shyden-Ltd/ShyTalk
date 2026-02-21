package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class GroupChatCreationTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun newMessage_showsSearchField() {
        composeTestRule.launchNavGraph(startDestination = Screen.NewMessage.route)
        composeTestRule.waitForTag("newMessage_searchField")
        composeTestRule.onNodeWithTag("newMessage_searchField").assertIsDisplayed()
    }

    @Test
    fun groupSetup_showsNameField() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.GroupSetup.createRoute("test-user-2")
        )
        composeTestRule.waitForTag("groupSetup_nameField")
        composeTestRule.onNodeWithTag("groupSetup_nameField").assertIsDisplayed()
    }

    @Test
    fun groupSetup_createButton_exists() {
        composeTestRule.launchNavGraph(
            startDestination = Screen.GroupSetup.createRoute("test-user-2")
        )
        composeTestRule.waitForTag("groupSetup_createButton")
        composeTestRule.onNodeWithTag("groupSetup_createButton").assertIsDisplayed()
    }
}
