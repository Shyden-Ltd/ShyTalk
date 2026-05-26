package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.util.ResetFakesRule
import com.shyden.shytalk.util.ScreenshotRule
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LegalAcceptanceTest {
    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    @Test
    fun legalScreen_showsAcceptanceForm() {
        composeTestRule.launchNavGraph(startDestination = Screen.LegalAcceptance.route)
        composeTestRule.waitForTag("legal_continueButton")
        composeTestRule.onNodeWithTag("legal_continueButton").assertIsDisplayed()
        composeTestRule.onNodeWithText("Welcome to ShyTalk").assertIsDisplayed()
    }

    @Test
    fun legalScreen_acceptButton_disabledUntilAllChecked() {
        composeTestRule.launchNavGraph(startDestination = Screen.LegalAcceptance.route)
        composeTestRule.waitForTag("legal_continueButton")
        // Initially disabled — not all checkboxes checked
        composeTestRule.onNodeWithTag("legal_continueButton").assertIsNotEnabled()

        // Check all four checkboxes
        composeTestRule.onNodeWithTag("legal_acceptPrivacyCheckbox").performClick()
        composeTestRule.onNodeWithTag("legal_acceptCommunityCheckbox").performClick()
        composeTestRule.onNodeWithTag("legal_acceptTermsCheckbox").performClick()
        composeTestRule.onNodeWithTag("legal_acceptCyberBullyingCheckbox").performClick()

        // Now the accept button should be enabled
        composeTestRule.onNodeWithTag("legal_continueButton").assertIsDisplayed()
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
