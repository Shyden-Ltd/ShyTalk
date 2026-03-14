package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.fake.FakeAuthRepository
import com.shyden.shytalk.fake.FakeUserRepository
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.data.repository.UserFlags
import com.shyden.shytalk.util.launchSignIn
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForTag
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.util.ResetFakesRule
import com.shyden.shytalk.util.ScreenshotRule
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.koin.test.KoinTest
import org.koin.test.inject

@RunWith(AndroidJUnit4::class)
class AuthFlowTest : KoinTest {

    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    private val authRepository: AuthRepository by inject()
    private val userRepository: UserRepository by inject()

    @Before
    fun setUp() {
        (authRepository as FakeAuthRepository).apply {
            _isAuthenticated = true
            _currentUserId = "test-user-1"
            _currentUserEmail = "test@example.com"
        }
        (userRepository as FakeUserRepository).userFlagsFlow.value = UserFlags()
    }

    @Test
    fun signInScreen_showsGoogleButton() {
        val fakeAuth = authRepository as FakeAuthRepository
        fakeAuth._isAuthenticated = false
        fakeAuth._currentUserId = null

        composeTestRule.launchSignIn()
        composeTestRule.waitForTag("signIn_googleButton")
        composeTestRule.onNodeWithTag("signIn_googleButton").assertIsDisplayed()
    }

    @Test
    fun signInScreen_showsAppTitle() {
        val fakeAuth = authRepository as FakeAuthRepository
        fakeAuth._isAuthenticated = false
        fakeAuth._currentUserId = null

        composeTestRule.launchSignIn()
        composeTestRule.onNodeWithText("ShyTalk").assertIsDisplayed()
    }

    @Test
    fun signIn_existingUser_navigatesToMain() {
        // Auth is already set as authenticated with test-user-1 by default
        composeTestRule.launchNavGraph(startDestination = Screen.Main.route)
        composeTestRule.waitForTag("main_roomsTab")
        composeTestRule.onNodeWithTag("main_roomsTab").assertIsDisplayed()
    }

    @Test
    fun profileSetup_showsForm() {
        composeTestRule.launchNavGraph(startDestination = Screen.ProfileSetup.route)
        composeTestRule.waitForTag("profileSetup_displayNameField")
        composeTestRule.onNodeWithTag("profileSetup_displayNameField").assertIsDisplayed()
        composeTestRule.onNodeWithTag("profileSetup_dobButton").assertIsDisplayed()
        composeTestRule.onNodeWithTag("profileSetup_continueButton").assertIsDisplayed()
    }

}
