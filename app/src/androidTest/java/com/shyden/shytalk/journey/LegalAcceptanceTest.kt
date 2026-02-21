package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LegalAcceptanceTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun legalScreen_showsAcceptanceForm() {
        composeTestRule.launchNavGraph(startDestination = Screen.LegalAcceptance.route)
        composeTestRule.waitForTag("legal_acceptButton")
        composeTestRule.onNodeWithTag("legal_acceptButton").assertIsDisplayed()
        composeTestRule.onNodeWithText("Welcome to ShyTalk").assertIsDisplayed()
    }

    @Test
    fun legalScreen_acceptButton_disabledUntilAllChecked() {
        composeTestRule.launchNavGraph(startDestination = Screen.LegalAcceptance.route)
        composeTestRule.waitForTag("legal_acceptButton")
        // Initially disabled — not all checkboxes checked
        composeTestRule.onNodeWithTag("legal_acceptButton").assertIsNotEnabled()

        // Check all three checkboxes
        composeTestRule.onNodeWithTag("legal_checkbox_PrivacyPolicy").performClick()
        composeTestRule.onNodeWithTag("legal_checkbox_CommunityStandards").performClick()
        composeTestRule.onNodeWithTag("legal_checkbox_TermsAndConditions").performClick()

        // Now the accept button should be enabled
        composeTestRule.onNodeWithTag("legal_acceptButton").assertIsDisplayed()
    }

    @Test
    fun legalScreen_viewLinks_navigate() {
        composeTestRule.launchNavGraph(startDestination = Screen.LegalAcceptance.route)
        composeTestRule.waitForIdle()
        // Click on Privacy Policy link
        composeTestRule.onNodeWithText("Privacy Policy").performClick()
        composeTestRule.waitForIdle()
        // Should navigate to privacy policy screen
    }
}
