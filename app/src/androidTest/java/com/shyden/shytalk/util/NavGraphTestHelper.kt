package com.shyden.shytalk.util

import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.navigation.compose.rememberNavController
import com.shyden.shytalk.navigation.NavGraph
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.steps.signInFakesAs
import com.shyden.shytalk.ui.theme.ShyTalkTheme

/**
 * Launch the nav graph, optionally SIGNED IN as somebody of a given cohort.
 *
 * SHY-0474. `SharedNavGraph` reads `authRepository.resolvedUniqueId`
 * -- deliberately, since SHY-0143 -- and only subscribes to the user-flags
 * listener when it is non-null. The auth double defaults it to null and
 * `ResetFakesRule` re-nulls it, so before this parameter existed the listener
 * never ran in a single instrumentation test: `ownCohort` stayed at its initial
 * `COHORT_MINOR` no matter what the fake's flow said.
 *
 * That was invisible until SHY-0459 hid the messages tab and the wallet from
 * minors, and five tests began failing on a screen behaving exactly as designed.
 *
 * [cohort] is opt-IN, and null by default:
 *
 *  - `null` leaves the identity unresolved -- the long-standing behaviour, kept
 *    because resolving one turns the whole app signed-in (the private-message
 *    sync service starts, room screens take a different path) and that broke ten
 *    passing tests when applied wholesale.
 *  - a value signs the test in as somebody of that cohort, which is what a test
 *    about an adult-only or minor-only surface actually means.
 *
 * A test that sets its own `resolvedUniqueId` keeps it: this never overwrites a
 * chosen identity, only supplies one where the test asked for a cohort and
 * named no id.
 *
 * The production default is untouched and stays `minor`. This declares who the
 * test is; it does not weaken what the app assumes about somebody unknown.
 */
fun ComposeContentTestRule.launchNavGraph(
    startDestination: String = Screen.Main.route,
    onSignOut: () -> Unit = {},
    cohort: String? = null,
) {
    if (cohort != null) signInFakesAs(cohort)

    setContent {
        ShyTalkTheme {
            val navController = rememberNavController()
            NavGraph(
                navController = navController,
                startDestination = startDestination,
                onSignOut = onSignOut,
            )
        }
    }
    // Disable auto-advance globally to prevent animation deadlocks.
    // Screens with CircularProgressIndicator have infinite animations that
    // cause waitForIdle() (called internally by assertExists, performClick,
    // etc.) to loop forever when autoAdvance is true.
    mainClock.autoAdvance = false
    // Drive the Compose clock forward so ViewModel init coroutines
    // (viewModelScope.launch on Dispatchers.Main) run before tests assert.
    mainClock.advanceTimeBy(500)
    waitForIdle()
}

fun ComposeContentTestRule.launchMainScreen(
    onSignOut: () -> Unit = {},
    cohort: String? = null,
) {
    launchNavGraph(startDestination = Screen.Main.route, onSignOut = onSignOut, cohort = cohort)
}

fun ComposeContentTestRule.launchSignIn(
    onSignOut: () -> Unit = {},
    cohort: String? = null,
) {
    launchNavGraph(startDestination = Screen.SignIn.route, onSignOut = onSignOut, cohort = cohort)
}
