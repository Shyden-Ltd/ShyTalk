package com.shyden.shytalk.core.push

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class PushPermissionStoreTest {
    @BeforeTest
    fun beforeTest() {
        // Process-singleton; clear between tests to keep them isolated.
        PushPermissionStore.resetForTesting()
    }

    @AfterTest
    fun afterTest() {
        PushPermissionStore.resetForTesting()
    }

    @Test
    fun initialState_isNotDetermined() =
        runTest {
            assertEquals(PushPermissionState.NOT_DETERMINED, PushPermissionStore.state.value)
        }

    @Test
    fun updateState_authorized_reflectedInFlow() =
        runTest {
            PushPermissionStore.updateState(PushPermissionState.AUTHORIZED)
            assertEquals(PushPermissionState.AUTHORIZED, PushPermissionStore.state.value)
        }

    @Test
    fun updateState_denied_reflectedInFlow() =
        runTest {
            // The load-bearing case: denial must be observable so UI surfaces a banner.
            PushPermissionStore.updateState(PushPermissionState.DENIED)
            assertEquals(PushPermissionState.DENIED, PushPermissionStore.state.value)
        }

    @Test
    fun updateState_lateGrant_transitionsDeniedToAuthorized() =
        runTest {
            // User denies, then grants via Settings; AppDelegate's didBecomeActive
            // re-queries and updates. UI must observe the transition.
            PushPermissionStore.updateState(PushPermissionState.DENIED)
            PushPermissionStore.updateState(PushPermissionState.AUTHORIZED)
            assertEquals(PushPermissionState.AUTHORIZED, PushPermissionStore.state.value)
        }

    @Test
    fun openSystemSettings_withoutBridge_isNoOp() =
        runTest {
            // Pre-init / early-launch path: state may be DENIED but the bridge
            // hasn't been registered yet. The call must NOT throw.
            PushPermissionStore.openSystemSettings()
            // No assertion — passing test == no exception thrown.
        }

    @Test
    fun openSystemSettings_withBridge_invokesBridge() =
        runTest {
            val fake = FakeBridge()
            PushPermissionStore.registerBridge(fake)

            PushPermissionStore.openSystemSettings()

            assertTrue(fake.openCalled, "Bridge openSystemSettings() must be invoked")
        }

    @Test
    fun registerBridge_secondRegistration_overwritesFirst() =
        runTest {
            // "Last writer wins" per the store's documented contract — defends
            // against double-registration from a hot-reload or test-rerun path.
            val firstBridge = FakeBridge()
            val secondBridge = FakeBridge()
            PushPermissionStore.registerBridge(firstBridge)
            PushPermissionStore.registerBridge(secondBridge)

            PushPermissionStore.openSystemSettings()

            assertFalse(firstBridge.openCalled, "Replaced bridge must NOT be invoked")
            assertTrue(secondBridge.openCalled, "Latest bridge must be invoked")
        }

    @Test
    fun resetForTesting_clearsBothStateAndBridge() =
        runTest {
            val fake = FakeBridge()
            PushPermissionStore.updateState(PushPermissionState.AUTHORIZED)
            PushPermissionStore.registerBridge(fake)

            PushPermissionStore.resetForTesting()

            assertEquals(PushPermissionState.NOT_DETERMINED, PushPermissionStore.state.value)
            PushPermissionStore.openSystemSettings()
            assertFalse(fake.openCalled, "Bridge must be cleared by resetForTesting")
        }

    private class FakeBridge : PushPermissionBridge {
        var openCalled: Boolean = false

        override fun openSystemSettings() {
            openCalled = true
        }
    }
}
