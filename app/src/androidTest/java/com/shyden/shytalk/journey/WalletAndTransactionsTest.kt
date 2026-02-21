package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WalletAndTransactionsTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun walletScreen_showsBalance() {
        composeTestRule.launchNavGraph(startDestination = Screen.Wallet.route)
        composeTestRule.waitForTag("wallet_balance")
        composeTestRule.onNodeWithTag("wallet_balance").assertIsDisplayed()
    }

    @Test
    fun walletScreen_transactionsButton_navigates() {
        composeTestRule.launchNavGraph(startDestination = Screen.Wallet.route)
        composeTestRule.waitForTag("wallet_transactionsButton")
        composeTestRule.onNodeWithTag("wallet_transactionsButton").performClick()
        composeTestRule.waitForTag("transactions_list")
        composeTestRule.onNodeWithTag("transactions_list").assertIsDisplayed()
    }

    @Test
    fun transactionHistory_showsTransactions() {
        composeTestRule.launchNavGraph(startDestination = Screen.Transactions.route)
        composeTestRule.waitForTag("transactions_list")
        composeTestRule.onNodeWithTag("transactions_list").assertIsDisplayed()
    }

    @Test
    fun transactionHistory_backButton_returnsToWallet() {
        composeTestRule.launchNavGraph(startDestination = Screen.Wallet.route)
        composeTestRule.waitForTag("wallet_transactionsButton")
        composeTestRule.onNodeWithTag("wallet_transactionsButton").performClick()
        composeTestRule.waitForTag("transactions_list")
        // Press back to return to wallet
        Espresso.pressBack()
        composeTestRule.waitForTag("wallet_balance")
        composeTestRule.onNodeWithTag("wallet_balance").assertIsDisplayed()
    }
}
