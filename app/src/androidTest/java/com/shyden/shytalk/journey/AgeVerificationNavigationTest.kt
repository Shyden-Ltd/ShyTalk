package com.shyden.shytalk.journey

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.navigation.NavHostController
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.feature.ageverification.TAG_AGE_VERIF_CONTINUE
import com.shyden.shytalk.navigation.NavGraph
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import com.shyden.shytalk.util.ResetFakesRule
import com.shyden.shytalk.util.ScreenshotRule
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * SHY-0268 — device-level proof that the 18+ verification destination is
 * reachable through the REAL Android nav graph.
 *
 * Pre-fix, the Gacha age gate's "Verify now" CTA called
 * `navController.navigate(Screen.AgeVerificationSubmit.route)` against a
 * graph that never registered that destination. Navigation-Compose throws
 * `IllegalArgumentException` for an unknown route; uncaught on the main
 * thread it killed the process — the operator's report was simply "the app
 * just closes entirely".
 *
 * [ageVerificationSubmit_resolvesAsStartDestination] pins registration.
 * [navigateToAgeVerificationSubmit_atRuntime_doesNotCrash] reproduces the
 * exact runtime mechanism — a live NavController being asked to navigate —
 * because start-destination resolution and runtime `navigate()` are
 * different code paths in Navigation-Compose and only the latter crashed.
 */
@RunWith(AndroidJUnit4::class)
class AgeVerificationNavigationTest {
    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    @Test
    fun ageVerificationSubmit_resolvesAsStartDestination() {
        composeTestRule.launchNavGraph(startDestination = Screen.AgeVerificationSubmit.route)
        composeTestRule.waitForTag(TAG_AGE_VERIF_CONTINUE)
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_CONTINUE).assertExists()
    }

    @Test
    fun navigateToAgeVerificationSubmit_atRuntime_doesNotCrash() {
        lateinit var navController: NavHostController

        composeTestRule.setContent {
            ShyTalkTheme {
                navController = rememberNavController()
                NavGraph(
                    navController = navController,
                    startDestination = Screen.Main.route,
                    onSignOut = {},
                )
            }
        }
        // Same clock discipline as launchNavGraph: infinite progress
        // animations deadlock waitForIdle() when autoAdvance is on.
        composeTestRule.mainClock.autoAdvance = false
        composeTestRule.mainClock.advanceTimeBy(CLOCK_WARMUP_MS)
        composeTestRule.waitForIdle()

        // The crash reproduction: this is the exact call the Gacha gate's
        // "Verify now" CTA makes. Pre-fix it threw IllegalArgumentException
        // ("destination cannot be found in the navigation graph") and the
        // process died.
        composeTestRule.runOnUiThread {
            navController.navigate(Screen.AgeVerificationSubmit.route)
        }
        composeTestRule.mainClock.advanceTimeBy(CLOCK_WARMUP_MS)
        composeTestRule.waitForIdle()

        composeTestRule.waitForTag(TAG_AGE_VERIF_CONTINUE)
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_CONTINUE).assertExists()
    }

    private companion object {
        const val CLOCK_WARMUP_MS = 500L
    }
}
