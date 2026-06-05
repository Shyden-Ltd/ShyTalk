package com.shyden.shytalk.core.push

import android.os.Build
import kotlin.test.Test
import kotlin.test.assertEquals

class AndroidPushPermissionTest {
    // Exhaustive coverage of mapPushPermissionState — the load-bearing mapping that
    // decides whether the denial banner appears on Home. The Context-coupled
    // sentinel + bridge layers are thin glue over framework APIs and are covered
    // indirectly via the banner's manual QA pass on a real device.

    @Test
    fun `enabled maps to AUTHORIZED regardless of sdk or hasAsked`() {
        // Cartesian product across sdk levels and hasAsked — none should override AUTHORIZED.
        for (sdk in listOf(28, 32, 33, 34)) {
            for (hasAsked in listOf(false, true)) {
                assertEquals(
                    PushPermissionState.AUTHORIZED,
                    mapPushPermissionState(enabled = true, sdkInt = sdk, hasAsked = hasAsked),
                    "enabled=true should be AUTHORIZED for sdk=$sdk hasAsked=$hasAsked",
                )
            }
        }
    }

    @Test
    fun `disabled on pre-33 maps to DENIED regardless of hasAsked`() {
        // Pre-Tiramisu has no runtime POST_NOTIFICATIONS permission, so there is no
        // NOT_DETERMINED concept — areNotificationsEnabled reflects the user toggle directly.
        assertEquals(
            PushPermissionState.DENIED,
            mapPushPermissionState(enabled = false, sdkInt = 32, hasAsked = false),
        )
        assertEquals(
            PushPermissionState.DENIED,
            mapPushPermissionState(enabled = false, sdkInt = 28, hasAsked = true),
        )
    }

    @Test
    fun `disabled on API 33 plus never asked maps to NOT_DETERMINED`() {
        assertEquals(
            PushPermissionState.NOT_DETERMINED,
            mapPushPermissionState(enabled = false, sdkInt = 33, hasAsked = false),
        )
        assertEquals(
            PushPermissionState.NOT_DETERMINED,
            mapPushPermissionState(enabled = false, sdkInt = 34, hasAsked = false),
        )
    }

    @Test
    fun `disabled on API 33 plus already asked maps to DENIED`() {
        // After the prompt has been shown and the user declined (or revoked later),
        // the state is genuine DENIED — the banner should appear.
        assertEquals(
            PushPermissionState.DENIED,
            mapPushPermissionState(enabled = false, sdkInt = 33, hasAsked = true),
        )
        assertEquals(
            PushPermissionState.DENIED,
            mapPushPermissionState(enabled = false, sdkInt = 34, hasAsked = true),
        )
    }

    @Test
    fun `TIRAMISU boundary is inclusive at 33`() {
        // Guards against an accidental > vs >= bug in the boundary check.
        assertEquals(
            PushPermissionState.NOT_DETERMINED,
            mapPushPermissionState(
                enabled = false,
                sdkInt = Build.VERSION_CODES.TIRAMISU,
                hasAsked = false,
            ),
        )
    }
}
