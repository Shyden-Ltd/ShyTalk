package com.shyden.shytalk.steps

import com.shyden.shytalk.core.push.PushPermissionBridge
import com.shyden.shytalk.core.push.PushPermissionState
import com.shyden.shytalk.core.push.PushPermissionStore
import com.shyden.shytalk.core.push.seedPushPermissionStateForTesting
import com.shyden.shytalk.util.ComposeTestRuleHolder
import io.cucumber.java.Before
import io.cucumber.java.en.Given
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.junit.Assert.assertTrue
import java.util.concurrent.atomic.AtomicInteger

class PushPermissionSteps {
    private val rule get() = ComposeTestRuleHolder.rule

    // Bridge call-count is the single state we care about across steps in a
    // scenario. Reset in @Before so each scenario starts with a clean slate
    // even though PushPermissionStore is a process-singleton.
    private val deeplinkCalls = AtomicInteger(0)

    private val countingBridge =
        object : PushPermissionBridge {
            override fun openSystemSettings() {
                deeplinkCalls.incrementAndGet()
            }
        }

    @Before
    fun resetPushPermissionStore() {
        // PushPermissionStore.resetForTesting() is `internal` (commonTest-only).
        // Re-seed the public surface instead: revert to the cold-start state.
        // Bridge registration is deferred to the state-setting steps so that
        // last-writer-wins ordering is guaranteed even if a future test setup
        // boots MainActivity (which itself calls registerBridge in onCreate at
        // app/src/main/java/com/shyden/shytalk/MainActivity.kt:141). The
        // current launchNavGraph path (setContent { NavGraph(...) }) does NOT
        // run MainActivity, so this is defence-in-depth rather than a fix for
        // an observable bug — but the cost is one line per Given/When step.
        PushPermissionStore.updateState(PushPermissionState.NOT_DETERMINED)
        deeplinkCalls.set(0)
    }

    @Given("the push permission state is {string}")
    fun givenPushPermissionState(stateName: String) {
        PushPermissionStore.updateState(parseState(stateName))
        PushPermissionStore.registerBridge(countingBridge)
        propagateStateChange()
    }

    @When("the push permission state changes to {string}")
    fun whenPushPermissionStateChangesTo(stateName: String) {
        PushPermissionStore.updateState(parseState(stateName))
        PushPermissionStore.registerBridge(countingBridge)
        propagateStateChange()
    }

    /**
     * Drives the OS-facts → state mapping path (`refreshPushPermissionState`)
     * for the PR-B2b scenarios. Unlike `givenPushPermissionState`, this does
     * NOT short-circuit by calling `updateState` directly — it runs the
     * mapping logic so the BDD scenario covers the END-TO-END integration
     * from OS facts → store → banner. Mapping correctness for isolated
     * (enabled, sdkInt, hasAsked) tuples is also covered at the unit layer
     * in `AndroidPushPermissionTest`; the BDD scenario adds the assertion
     * that the resulting state propagates correctly into the UI.
     */
    @Given("OS notifications enabled is {string} on Android SDK {int} with hasAsked {string}")
    fun givenOsNotificationFacts(
        enabledStr: String,
        sdkInt: Int,
        hasAskedStr: String,
    ) {
        seedPushPermissionStateForTesting(
            enabled = parseBoolean(enabledStr),
            sdkInt = sdkInt,
            hasAsked = parseBoolean(hasAskedStr),
        )
        PushPermissionStore.registerBridge(countingBridge)
        propagateStateChange()
    }

    /**
     * NavGraphTestHelper disables Compose's auto-advance clock so ViewModel-scoped
     * coroutines don't run unless the test explicitly advances time. HomeViewModel
     * collects PushPermissionStore.state inside `viewModelScope.launch`, so updates
     * are invisible to the Compose tree until the clock ticks. Advancing 500ms
     * mirrors the bootstrap advance in NavGraphTestHelper.launchNavGraph — long
     * enough for the collector and one downstream recomposition, short enough
     * that scenarios stay fast.
     */
    private fun propagateStateChange() {
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Then("the system settings deeplink should be invoked")
    fun thenDeeplinkInvoked() {
        assertTrue(
            "Expected PushPermissionBridge.openSystemSettings to be called at least once, " +
                "got ${deeplinkCalls.get()}",
            deeplinkCalls.get() >= 1,
        )
    }

    private fun parseState(stateName: String): PushPermissionState =
        when (stateName.uppercase()) {
            "NOT_DETERMINED" -> PushPermissionState.NOT_DETERMINED
            "AUTHORIZED" -> PushPermissionState.AUTHORIZED
            "DENIED" -> PushPermissionState.DENIED
            "PROVISIONAL" -> PushPermissionState.PROVISIONAL
            else -> error("Unknown push permission state: $stateName")
        }

    private fun parseBoolean(value: String): Boolean =
        when (value.lowercase()) {
            "true" -> true
            "false" -> false
            else -> error("Expected \"true\" or \"false\", got: $value")
        }
}
