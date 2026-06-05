package com.shyden.shytalk.core.push

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import io.mockk.Runs
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.verify
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidPushPermissionTest {
    @AfterTest
    fun cleanup() {
        PushPermissionStore.resetForTesting()
    }

    @Test
    fun `enabled maps to AUTHORIZED regardless of sdk or hasAsked`() {
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
        assertEquals(
            PushPermissionState.NOT_DETERMINED,
            mapPushPermissionState(
                enabled = false,
                sdkInt = Build.VERSION_CODES.TIRAMISU,
                hasAsked = false,
            ),
        )
    }

    @Test
    fun `SDK_INT zero (JVM stub default) is treated as pre-33 and maps to DENIED`() {
        assertEquals(
            PushPermissionState.DENIED,
            mapPushPermissionState(enabled = false, sdkInt = 0, hasAsked = false),
        )
    }

    @Test
    fun `negative SDK_INT defensively treated as pre-33 and maps to DENIED`() {
        assertEquals(
            PushPermissionState.DENIED,
            mapPushPermissionState(enabled = false, sdkInt = -1, hasAsked = false),
        )
    }

    @Test
    fun `back-fill triggers when enabled and sdk gte 33 and not asked`() {
        assertTrue(shouldBackfillSentinel(enabled = true, sdkInt = 33, hasAsked = false))
        assertTrue(shouldBackfillSentinel(enabled = true, sdkInt = 34, hasAsked = false))
    }

    @Test
    fun `back-fill does not trigger when already asked`() {
        assertFalse(shouldBackfillSentinel(enabled = true, sdkInt = 33, hasAsked = true))
        assertFalse(shouldBackfillSentinel(enabled = true, sdkInt = 34, hasAsked = true))
    }

    @Test
    fun `back-fill does not trigger on pre-33`() {
        assertFalse(shouldBackfillSentinel(enabled = true, sdkInt = 32, hasAsked = false))
        assertFalse(shouldBackfillSentinel(enabled = true, sdkInt = 28, hasAsked = false))
    }

    @Test
    fun `back-fill does not trigger when disabled`() {
        assertFalse(shouldBackfillSentinel(enabled = false, sdkInt = 33, hasAsked = false))
        assertFalse(shouldBackfillSentinel(enabled = false, sdkInt = 34, hasAsked = true))
    }

    @Test
    fun `hasAsked reads false from fresh prefs`() {
        val (context, _) = mockPrefsContext(initialAsked = false)
        assertFalse(hasAskedInternal(context))
    }

    @Test
    fun `hasAsked reads true after sentinel is set`() {
        val (context, _) = mockPrefsContext(initialAsked = true)
        assertTrue(hasAskedInternal(context))
    }

    @Test
    fun `markAsked writes key true via apply`() {
        val (context, prefs, editor) = mockPrefsContextWithEditor(initialAsked = false)
        markAskedInternal(context)
        verify(exactly = 1) { editor.putBoolean("has_asked_for_push_permission", true) }
        verify(exactly = 1) { editor.apply() }
        verify(exactly = 1) { prefs.edit() }
    }

    @Test
    fun `markAsked uses the correct prefs file name`() {
        val (context, _, _) = mockPrefsContextWithEditor(initialAsked = false)
        markAskedInternal(context)
        verify(exactly = 1) {
            context.getSharedPreferences("push_permission_prefs", Context.MODE_PRIVATE)
        }
    }

    @Test
    fun `hasAsked reads from the correct prefs file with correct default`() {
        val (context, prefs) = mockPrefsContext(initialAsked = false)
        hasAskedInternal(context)
        verify(exactly = 1) {
            context.getSharedPreferences("push_permission_prefs", Context.MODE_PRIVATE)
        }
        verify(exactly = 1) { prefs.getBoolean("has_asked_for_push_permission", false) }
    }

    private fun mockPrefsContext(initialAsked: Boolean): Pair<Context, SharedPreferences> {
        val prefs = mockk<SharedPreferences>()
        every { prefs.getBoolean(any(), any()) } returns initialAsked
        val context = mockk<Context>()
        every {
            context.getSharedPreferences("push_permission_prefs", Context.MODE_PRIVATE)
        } returns prefs
        return context to prefs
    }

    private fun mockPrefsContextWithEditor(initialAsked: Boolean): Triple<Context, SharedPreferences, SharedPreferences.Editor> {
        val editor = mockk<SharedPreferences.Editor>()
        every { editor.putBoolean(any(), any()) } returns editor
        every { editor.apply() } just Runs
        val prefs = mockk<SharedPreferences>()
        every { prefs.edit() } returns editor
        every { prefs.getBoolean(any(), any()) } returns initialAsked
        val context = mockk<Context>()
        every {
            context.getSharedPreferences("push_permission_prefs", Context.MODE_PRIVATE)
        } returns prefs
        return Triple(context, prefs, editor)
    }
}
