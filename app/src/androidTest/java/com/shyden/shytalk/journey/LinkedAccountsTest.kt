package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.core.model.LinkedProvider
import com.shyden.shytalk.core.model.ProviderType
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.fake.FakeAuthRepository
import com.shyden.shytalk.fake.FakeUserRepository
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForText
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.koin.test.KoinTest
import org.koin.test.inject

@RunWith(AndroidJUnit4::class)
class LinkedAccountsTest : KoinTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    private val authRepository: AuthRepository by inject()
    private val userRepository: UserRepository by inject()

    @Before
    fun setUp() {
        val fakeAuth = authRepository as FakeAuthRepository
        fakeAuth._isAuthenticated = true
        fakeAuth._currentUserId = "test-user-1"
        fakeAuth.resolvedUniqueId = "10000001"
        fakeAuth._currentUserEmail = "test@example.com"

        // Set up user with linked providers
        val fakeUser = userRepository as FakeUserRepository
        fakeUser.users["10000001"] = User(
            uid = "10000001",
            uniqueId = 10000001L,
            displayName = "TestUser",
            email = "test@example.com",
            dateOfBirth = 946684800000L,
            acceptedLegalVersion = 999,
            providers = listOf(
                LinkedProvider(
                    type = ProviderType.GOOGLE,
                    identifier = "test@gmail.com",
                    active = true,
                    linkedAt = 1709913600000L
                ),
                LinkedProvider(
                    type = ProviderType.EMAIL,
                    identifier = "test@work.com",
                    active = true,
                    linkedAt = 1709913600000L
                )
            )
        )
    }

    @Test
    fun navigateToLinkedAccounts_showsProviders() {
        composeTestRule.launchNavGraph(startDestination = Screen.Settings.route)

        // Navigate: Settings Main → Account → Linked Accounts
        composeTestRule.waitForText("Account")
        composeTestRule.onNodeWithText("Account").performClick()

        composeTestRule.waitForText("Linked Accounts")
        composeTestRule.onNodeWithText("Linked Accounts").performClick()

        // Should show provider names
        composeTestRule.waitForText("Google")
        composeTestRule.onNodeWithText("Google").assertIsDisplayed()
        composeTestRule.onNodeWithText("Email").assertIsDisplayed()
    }

    @Test
    fun linkedAccounts_showsUnlinkButtons_whenMultipleProviders() {
        composeTestRule.launchNavGraph(startDestination = Screen.Settings.route)

        composeTestRule.waitForText("Account")
        composeTestRule.onNodeWithText("Account").performClick()

        composeTestRule.waitForText("Linked Accounts")
        composeTestRule.onNodeWithText("Linked Accounts").performClick()

        // With 2 active providers, unlink buttons should be visible (one per provider)
        composeTestRule.waitForText("Unlink")
        composeTestRule.onAllNodesWithText("Unlink").onFirst().assertExists()
    }

    @Test
    fun linkedAccounts_singleProvider_noUnlinkButton() {
        // Set up user with only one provider
        val fakeUser = userRepository as FakeUserRepository
        fakeUser.users["10000001"] = fakeUser.users["10000001"]!!.copy(
            providers = listOf(
                LinkedProvider(
                    type = ProviderType.GOOGLE,
                    identifier = "test@gmail.com",
                    active = true,
                    linkedAt = 1709913600000L
                )
            )
        )

        composeTestRule.launchNavGraph(startDestination = Screen.Settings.route)

        composeTestRule.waitForText("Account")
        composeTestRule.onNodeWithText("Account").performClick()

        composeTestRule.waitForText("Linked Accounts")
        composeTestRule.onNodeWithText("Linked Accounts").performClick()

        // With only 1 active provider, should NOT show unlink button
        composeTestRule.waitForText("Google")
        composeTestRule.onNodeWithText("Unlink").assertDoesNotExist()
    }

    @Test
    fun linkedAccounts_unlinkTap_showsConfirmDialog() {
        composeTestRule.launchNavGraph(startDestination = Screen.Settings.route)

        composeTestRule.waitForText("Account")
        composeTestRule.onNodeWithText("Account").performClick()

        composeTestRule.waitForText("Linked Accounts")
        composeTestRule.onNodeWithText("Linked Accounts").performClick()

        // Tap unlink on the first provider (2 "Unlink" buttons exist, one per active provider)
        composeTestRule.waitForText("Unlink")
        composeTestRule.onAllNodesWithText("Unlink").onFirst().performClick()

        // Should show confirmation dialog
        composeTestRule.waitForText("Cancel")
        composeTestRule.onNodeWithText("Cancel").assertIsDisplayed()
    }

    @Test
    fun linkedAccounts_showsDeactivatedProvider() {
        // Set up user with one active and one deactivated provider
        val fakeUser = userRepository as FakeUserRepository
        fakeUser.users["10000001"] = fakeUser.users["10000001"]!!.copy(
            providers = listOf(
                LinkedProvider(
                    type = ProviderType.GOOGLE,
                    identifier = "test@gmail.com",
                    active = true,
                    linkedAt = 1709913600000L
                ),
                LinkedProvider(
                    type = ProviderType.EMAIL,
                    identifier = "old@work.com",
                    active = false,
                    linkedAt = 1709913600000L,
                    unlinkedAt = 1709999999000L
                )
            )
        )

        composeTestRule.launchNavGraph(startDestination = Screen.Settings.route)

        composeTestRule.waitForText("Account")
        composeTestRule.onNodeWithText("Account").performClick()

        composeTestRule.waitForText("Linked Accounts")
        composeTestRule.onNodeWithText("Linked Accounts").performClick()

        // Should show both providers, with the deactivated one showing "Unlinked" label
        composeTestRule.waitForText("Google")
        composeTestRule.onNodeWithText("Google").assertIsDisplayed()
        composeTestRule.onNodeWithText("Email").assertIsDisplayed()
        composeTestRule.onNodeWithText("Unlinked").assertIsDisplayed()
    }

    @Test
    fun accountPage_showsLinkedCount() {
        composeTestRule.launchNavGraph(startDestination = Screen.Settings.route)

        composeTestRule.waitForText("Account")
        composeTestRule.onNodeWithText("Account").performClick()

        // Account page should show "2 linked" for the Linked Accounts menu item
        composeTestRule.waitForText("Linked Accounts")
        composeTestRule.onNodeWithText("2 linked").assertIsDisplayed()
    }

    @Test
    fun accountPage_showsUniqueId() {
        composeTestRule.launchNavGraph(startDestination = Screen.Settings.route)

        composeTestRule.waitForText("Account")
        composeTestRule.onNodeWithText("Account").performClick()

        // Account page should display the user's uniqueId
        composeTestRule.waitForText("10000001")
        composeTestRule.onNodeWithText("10000001").assertIsDisplayed()
    }
}
