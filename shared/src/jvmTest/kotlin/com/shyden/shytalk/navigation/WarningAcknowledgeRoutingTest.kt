package com.shyden.shytalk.navigation

import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0097 — unit contract for [acknowledgeWarningAndRoute], the shared
 * acknowledge+route decision used by both nav graphs.
 *
 * This is the regression guard the story's Risks section calls for: a unit test
 * asserting `onAccept` does NOT navigate on error (the silent-failure the ticket
 * fixes). No mocks/fakes — the dependency is a plain `suspend (String) ->
 * Resource<Unit>` lambda, so each case configures the exact result directly.
 */
class WarningAcknowledgeRoutingTest {
    @Test
    fun success_navigatesToMain_andDoesNotError() =
        runTest {
            var navigated = false
            var errored = false
            acknowledgeWarningAndRoute(
                userId = "u1",
                acknowledge = { Resource.Success(Unit) },
                onSuccess = { navigated = true },
                onError = { errored = true },
            )
            assertTrue(navigated, "Success must navigate to Main")
            assertFalse(errored, "Success must not surface an error")
        }

    @Test
    fun error_doesNotNavigate_andSurfacesError() =
        runTest {
            var navigated = false
            var errored = false
            acknowledgeWarningAndRoute(
                userId = "u1",
                acknowledge = { Resource.Error("network down") },
                onSuccess = { navigated = true },
                onError = { errored = true },
            )
            // The core regression guard: a failed acknowledge must NOT navigate
            // (no optimistic navigate-then-bounce) and must surface the error.
            assertFalse(navigated, "Error must NOT navigate to Main")
            assertTrue(errored, "Error must surface to the user (no silent swallow)")
        }

    @Test
    fun loading_isTreatedAsError_doesNotNavigate() =
        runTest {
            var navigated = false
            var errored = false
            acknowledgeWarningAndRoute(
                userId = "u1",
                acknowledge = { Resource.Loading },
                onSuccess = { navigated = true },
                onError = { errored = true },
            )
            assertFalse(navigated, "Non-success (Loading) must NOT navigate")
            assertTrue(errored, "Non-success (Loading) must surface an error")
        }

    @Test
    fun nullUser_doesNotCallEndpoint_doesNotNavigate_surfacesError() =
        runTest {
            var navigated = false
            var errored = false
            var acknowledgeCalls = 0
            acknowledgeWarningAndRoute(
                userId = null,
                acknowledge = {
                    acknowledgeCalls++
                    Resource.Success(Unit)
                },
                onSuccess = { navigated = true },
                onError = { errored = true },
            )
            assertEquals(0, acknowledgeCalls, "No user → must not call the acknowledge endpoint")
            assertFalse(navigated, "No user → must NOT navigate")
            assertTrue(errored, "No user → must surface an error")
        }
}
