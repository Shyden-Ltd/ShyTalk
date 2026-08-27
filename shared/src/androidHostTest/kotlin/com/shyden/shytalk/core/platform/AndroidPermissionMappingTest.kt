package com.shyden.shytalk.core.platform

import android.Manifest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * SHY-0272 — the mic toggle in a voice room did nothing at all, on every
 * Android device, for every user.
 *
 * `RoomScreen` gated the toggle on `platformSettings.hasPermission("microphone")`
 * and `AndroidPlatformSettingsService` passed that string STRAIGHT to
 * `ContextCompat.checkSelfPermission`. There is no Android permission called
 * `"microphone"` — the constant is `android.permission.RECORD_AUDIO` — so the
 * check returned DENIED unconditionally and the `if` silently swallowed every
 * tap. No request, no error, no feedback: the button was decorative.
 *
 * Each side was individually defensible. The interface's own docs said
 * "e.g. microphone, bluetooth" (friendly labels); the Android implementation
 * expected raw `Manifest.permission.*` constants. Only the CONTRACT between
 * them was wrong, which is why no per-file test could see it — the same shape
 * as the SHY-0270 presence-identity bug.
 *
 * The fix removes the stringly-typed API entirely: `AppPermission` is an enum,
 * so a call site cannot invent a name the platform does not understand, and
 * `when` is exhaustive so a new permission cannot be added without each
 * platform being made to handle it. These tests pin the mapping itself.
 */
class AndroidPermissionMappingTest {
    @Test
    fun microphoneMapsToRecordAudio() {
        // The whole bug in one assertion: "microphone" is not the constant.
        assertEquals(Manifest.permission.RECORD_AUDIO, AppPermission.MICROPHONE.androidPermission())
    }

    @Test
    fun bluetoothMapsToBluetoothConnect() {
        assertEquals(Manifest.permission.BLUETOOTH_CONNECT, AppPermission.BLUETOOTH.androidPermission())
    }

    @Test
    fun everyPermissionMapsToARealAndroidConstant() {
        // Exhaustive over the enum, so adding a case without a mapping fails
        // here rather than silently denying at runtime. Every Android
        // permission string is namespaced `android.permission.*`; a friendly
        // label like "microphone" is exactly what this rejects.
        AppPermission.entries.forEach { permission ->
            val mapped = permission.androidPermission()
            assertTrue(
                mapped.startsWith("android.permission."),
                "$permission mapped to '$mapped', which is not an Android permission constant",
            )
        }
    }

    @Test
    fun noMappingIsTheFriendlyLabelItself() {
        // Pins the regression directly: if someone "simplifies" the mapping
        // back to passing the enum name through, this fails.
        AppPermission.entries.forEach { permission ->
            assertTrue(
                !permission.androidPermission().equals(permission.name, ignoreCase = true),
                "$permission maps to its own name — that is the SHY-0272 defect",
            )
        }
    }
}
