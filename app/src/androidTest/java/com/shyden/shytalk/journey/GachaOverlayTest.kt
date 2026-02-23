package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.util.launchMainScreen
import com.shyden.shytalk.util.waitForTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Basic tests for the Lucky Spin (Gacha) feature.
 * The overlay is only accessible from inside a room, so these tests
 * verify the wallet route (which shows the balance used by gacha).
 */
@RunWith(AndroidJUnit4::class)
class GachaOverlayTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun walletScreen_showsBalance() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_profileTab")
        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForTag("profile_walletButton")
        composeTestRule.onNodeWithTag("profile_walletButton").performClick()
        composeTestRule.waitForTag("wallet_balance")
        composeTestRule.onNodeWithTag("wallet_balance").assertIsDisplayed()
    }

    @Test
    fun walletScreen_showsCoinBalance() {
        composeTestRule.launchMainScreen()
        composeTestRule.waitForTag("main_profileTab")
        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForTag("profile_walletButton")
        composeTestRule.onNodeWithTag("profile_walletButton").performClick()
        composeTestRule.waitForTag("wallet_balance")
        // Balance should be shown (fake data provides a non-zero balance)
    }
}
