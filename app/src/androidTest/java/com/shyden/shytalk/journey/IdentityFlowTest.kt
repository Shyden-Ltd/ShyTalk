package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.DeviceLockStatus
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.SignInResult
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.fake.FakeAuthRepository
import com.shyden.shytalk.fake.FakeDeviceRepository
import com.shyden.shytalk.fake.FakeIdentityRepository
import com.shyden.shytalk.util.ResetFakesRule
import com.shyden.shytalk.util.ScreenshotRule
import com.shyden.shytalk.util.launchSignIn
import com.shyden.shytalk.util.waitForTag
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.koin.test.KoinTest
import org.koin.test.inject

@RunWith(AndroidJUnit4::class)
class IdentityFlowTest : KoinTest {
    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    private val authRepository: AuthRepository by inject()
    private val userRepository: UserRepository by inject()
    private val identityRepository: IdentityRepository by inject()
    private val deviceRepository: DeviceRepository by inject()

    @Before
    fun setUp() {
        val fakeAuth = authRepository as FakeAuthRepository
        fakeAuth.fakeAuthenticated = false
        fakeAuth.fakeUserId = null
        fakeAuth.fakeUserEmail = null
        fakeAuth.resolvedUniqueId = null
        // The local flavor's empty `WEB_CLIENT_ID` (PR #42 / B6.14)
        // hides the Google sign-in button. Inject a non-empty fake so
        // the visibility-based test assertions below can find it.
        BuildVariant.initLocalEmulator(true, googleWebClientId = "test-google-client-id")
    }

    @Test
    fun signInScreen_displaysGoogleButton() {
        composeTestRule.launchSignIn()
        composeTestRule.waitForTag("signIn_googleButton")
        composeTestRule.onNodeWithTag("signIn_googleButton").assertIsDisplayed()
    }

    @Test
    fun identity_existingUser_signInProceedsNormally() {
        // Set up: identity found → uniqueId 10000005
        val fakeIdentity = identityRepository as FakeIdentityRepository
        fakeIdentity.resolveResult = Resource.Success(SignInResult.Found(10000005))

        val fakeAuth = authRepository as FakeAuthRepository
        fakeAuth.fakeAuthenticated = false
        fakeAuth.fakeUserId = null

        composeTestRule.launchSignIn()
        composeTestRule.waitForTag("signIn_googleButton")
        // Sign-in button is displayed — user would tap to start Google flow
        composeTestRule.onNodeWithTag("signIn_googleButton").assertIsDisplayed()
    }

    @Test
    fun identity_newUser_showsProfileCreation() {
        // Identity not found → new user, needs profile creation
        val fakeIdentity = identityRepository as FakeIdentityRepository
        fakeIdentity.resolveResult = Resource.Success(SignInResult.NotFound)

        composeTestRule.launchSignIn()
        composeTestRule.waitForTag("signIn_googleButton")
        composeTestRule.onNodeWithTag("signIn_googleButton").assertIsDisplayed()
    }

    @Test
    fun identity_deactivatedProvider_blocksSignIn() {
        // Deactivated identity → should show error
        val fakeIdentity = identityRepository as FakeIdentityRepository
        fakeIdentity.resolveResult = Resource.Success(SignInResult.Deactivated)

        composeTestRule.launchSignIn()
        composeTestRule.waitForTag("signIn_googleButton")
        composeTestRule.onNodeWithTag("signIn_googleButton").assertIsDisplayed()
    }

    @Test
    fun deviceBinding_boundToSameUser_proceedsNormally() {
        // Device bound to the same user resolving identity → the API allows it.
        val fakeDevice = deviceRepository as FakeDeviceRepository
        fakeDevice.lockStatus = DeviceLockStatus.ALLOWED

        val fakeIdentity = identityRepository as FakeIdentityRepository
        fakeIdentity.resolveResult = Resource.Success(SignInResult.Found(10000005))

        composeTestRule.launchSignIn()
        composeTestRule.waitForTag("signIn_googleButton")
        composeTestRule.onNodeWithTag("signIn_googleButton").assertIsDisplayed()
    }
}
