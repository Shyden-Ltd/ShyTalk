package com.shyden.shytalk.journey

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.core.util.COHORT_ADULT
import com.shyden.shytalk.core.util.COHORT_MINOR
import com.shyden.shytalk.util.ResetFakesRule
import com.shyden.shytalk.util.ScreenshotRule
import com.shyden.shytalk.util.launchMainScreen
import com.shyden.shytalk.util.waitForTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * SHY-0474 / SHY-0459 — the same screen, two cohorts, opposite answers.
 *
 * SHY-0459 stopped the app OFFERING direct messages and the wallet to a minor.
 * The server already refused; this is the door rather than the lock.
 *
 * That change shipped with no Android coverage at all, and the way it was
 * discovered is the point: every instrumentation test silently ran as a minor
 * (`UserFlags.cohort` defaults to `COHORT_MINOR`), so five tests written for the
 * adult surface began failing on a screen that was behaving correctly. Reverting
 * SHY-0459 would have turned them green again and looked like a fix.
 *
 * So both directions are asserted here, on one screen, in one file. An absence
 * asserted alone proves nothing — it passes just as well when the screen failed
 * to render — which is why every minor case first waits for a control that IS
 * offered before asserting the ones that are not.
 */
@RunWith(AndroidJUnit4::class)
class CohortSurfaceTest {
    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    @Test
    fun adult_isOfferedMessages() {
        composeTestRule.launchMainScreen(cohort = COHORT_ADULT)
        composeTestRule.waitForTag("main_roomsTab")

        composeTestRule.onNodeWithTag("main_messagesTab").assertIsDisplayed()
    }

    @Test
    fun minor_isNotOfferedMessages() {
        composeTestRule.launchMainScreen(cohort = COHORT_MINOR)
        // Positive control first: the bar rendered, so the absence below is a
        // decision the app made rather than a screen that never arrived.
        composeTestRule.waitForTag("main_roomsTab")

        composeTestRule.onNodeWithTag("main_messagesTab").assertDoesNotExist()
    }

    @Test
    fun adult_isOfferedTheWallet() {
        composeTestRule.launchMainScreen(cohort = COHORT_ADULT)
        composeTestRule.waitForTag("main_roomsTab")

        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        composeTestRule.waitForTag("profile_walletButton")
    }

    @Test
    fun minor_isNotOfferedTheWallet() {
        composeTestRule.launchMainScreen(cohort = COHORT_MINOR)
        composeTestRule.waitForTag("main_roomsTab")

        composeTestRule.onNodeWithTag("main_profileTab").performClick()
        // The profile tab itself IS offered to a minor, so waiting for it keeps
        // this from passing on a screen that simply never loaded.
        composeTestRule.waitForTag("main_profileTab")

        composeTestRule.onNodeWithTag("profile_walletButton").assertDoesNotExist()
    }

    @Test
    fun anUnknownCohortIsTreatedAsAMinor() {
        // The fail-closed direction, asserted rather than assumed. SHY-0468 was
        // a gate that failed the other way and let an adult reach a minor.
        composeTestRule.launchMainScreen(cohort = "not-a-cohort")
        composeTestRule.waitForTag("main_roomsTab")

        composeTestRule.onNodeWithTag("main_messagesTab").assertDoesNotExist()
    }
}
