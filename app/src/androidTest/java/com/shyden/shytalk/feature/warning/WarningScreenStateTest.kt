package com.shyden.shytalk.feature.warning

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * SHY-0097 — Compose UI contract for [WarningScreen]'s acknowledge states.
 *
 * Renders the REAL composable (no fakes) with explicit params and asserts the
 * busy/disabled + error-surface behaviour the AC requires:
 *  - in flight → the acknowledge button is disabled (can't double-fire),
 *  - on failure → an error message is shown AND the button is enabled again so
 *    a retry is possible (never a silent navigate-then-bounce),
 *  - idle → button enabled, no error node.
 */
@RunWith(AndroidJUnit4::class)
class WarningScreenStateTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun idle_buttonEnabled_andNoErrorShown() {
        composeTestRule.setContent {
            MaterialTheme {
                WarningScreen(reason = null, onAccept = {}, onViewCommunityStandards = {})
            }
        }
        composeTestRule.onNodeWithTag("warning_acknowledgeButton").assertIsEnabled()
        composeTestRule.onNodeWithTag("warning_acknowledgeError").assertDoesNotExist()
    }

    @Test
    fun acknowledging_disablesButton_andShowsSpinner() {
        composeTestRule.setContent {
            MaterialTheme {
                WarningScreen(
                    reason = null,
                    onAccept = {},
                    onViewCommunityStandards = {},
                    isAcknowledging = true,
                )
            }
        }
        composeTestRule.onNodeWithTag("warning_acknowledgeButton").assertIsNotEnabled()
        // The spinner replaces the button label in flight. It's nested in the
        // Button (which merges semantics), so query the unmerged tree.
        composeTestRule
            .onNodeWithTag("warning_acknowledgeSpinner", useUnmergedTree = true)
            .assertIsDisplayed()
    }

    @Test
    fun error_showsMessage_andButtonStaysEnabledForRetry() {
        val msg = "Couldn't clear your warning. Please try again."
        composeTestRule.setContent {
            MaterialTheme {
                WarningScreen(
                    reason = null,
                    onAccept = {},
                    onViewCommunityStandards = {},
                    acknowledgeError = msg,
                )
            }
        }
        composeTestRule.onNodeWithTag("warning_acknowledgeError").assertIsDisplayed()
        // Retry must be possible: not in flight → button enabled.
        composeTestRule.onNodeWithTag("warning_acknowledgeButton").assertIsEnabled()
    }
}
