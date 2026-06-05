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
        // Integration tests touch PushPermissionStore — keep tests isolated.
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

    @Test
    fun `refresh enabled API 33 with sentinel false back-fills and authorises`() {
        var hasAskedNow = false
        var marked = 0
        refreshPushPermissionState(
            enabled = true,
            sdkInt = 33,
            readHasAsked = { hasAskedNow },
            markAsked = {
                marked++
                hasAskedNow = true
            },
        )
        assertEquals(1, marked, "back-fill should fire exactly once")
        assertEquals(PushPermissionState.AUTHORIZED, PushPermissionStore.state.value)
    }

    @Test
    fun `refresh enabled pre-33 does not back-fill but still authorises`() {
        var marked = 0
        refreshPushPermissionState(
            enabled = true,
            sdkInt = 28,
            readHasAsked = { false },
            markAsked = { marked++ },
        )
        assertEquals(0, marked, "pre-33 must never back-fill")
        assertEquals(PushPermissionState.AUTHORIZED, PushPermissionStore.state.value)
    }

    @Test
    fun `refresh disabled API 33 sentinel false maps NOT_DETERMINED without marking`() {
        var marked = 0
        refreshPushPermissionState(
            enabled = false,
            sdkInt = 33,
            readHasAsked = { false },
            markAsked = { marked++ },
        )
        assertEquals(0, marked, "must not back-fill when permission is actually denied")
        assertEquals(PushPermissionState.NOT_DETERMINED, PushPermissionStore.state.value)
    }

    @Test
    fun `refresh disabled API 33 sentinel true maps DENIED without marking`() {
        var marked = 0
        refreshPushPermissionState(
            enabled = false,
            sdkInt = 33,
            readHasAsked = { true },
            markAsked = { marked++ },
        )
        assertEquals(0, marked)
        assertEquals(PushPermissionState.DENIED, PushPermissionStore.state.value)
    }

    @Test
    fun `refresh disabled pre-33 maps DENIED without marking`() {
        var marked = 0
        refreshPushPermissionState(
            enabled = false,
            sdkInt = 28,
            readHasAsked = { false },
            markAsked = { marked++ },
        )
        assertEquals(0, marked)
        assertEquals(PushPermissionState.DENIED, PushPermissionStore.state.value)
    }

    @Test
    fun `refresh enabled API 33 already asked does not double-mark`() {
        var marked = 0
        refreshPushPermissionState(
            enabled = true,
            sdkInt = 33,
            readHasAsked = { true },
            markAsked = { marked++ },
        )
        assertEquals(0, marked, "no back-fill needed when sentinel already true")
        assertEquals(PushPermissionState.AUTHORIZED, PushPermissionStore.state.value)
    }

    @Test
    fun `revoke-via-Settings flow — cold-start back-fills then revoke maps DENIED`() {
        // Walk-through of the round-2 Critical bug: simulate fresh-install API 33+
        // user who grants permission via Settings (not the system prompt), then revokes.
        var hasAskedNow = false
        val markAsked = {
            hasAskedNow = true
            Unit
        }

        // Step 1: cold-start after grant-via-Settings — enabled=true, sentinel false.
        refreshPushPermissionState(
            enabled = true,
            sdkInt = 33,
            readHasAsked = { hasAskedNow },
            markAsked = markAsked,
        )
        assertTrue(hasAskedNow, "back-fill must persist the sentinel")
        assertEquals(PushPermissionState.AUTHORIZED, PushPermissionStore.state.value)

        // Step 2: user revokes in Settings, app cold-starts again — enabled=false,
        // sentinel now true (from back-fill in step 1).
        refreshPushPermissionState(
            enabled = false,
            sdkInt = 33,
            readHasAsked = { hasAskedNow },
            markAsked = markAsked,
        )
        assertEquals(
            PushPermissionState.DENIED,
            PushPermissionStore.state.value,
            "after revoke the banner MUST appear (DENIED, not NOT_DETERMINED)",
        )
    }

    @Test
    fun `notifyPushPermissionPromptedInternal API 33 authorises when granted`() {
        val (context, editor, _) = statefulPrefsContext(initialAsked = false)
        notifyPushPermissionPromptedInternal(context = context, notifyEnabled = true, sdkInt = 33)
        verify(exactly = 1) { editor.putBoolean("has_asked_for_push_permission", true) }
        verify(exactly = 1) { editor.apply() }
        assertEquals(PushPermissionState.AUTHORIZED, PushPermissionStore.state.value)
    }

    @Test
    fun `notifyPushPermissionPromptedInternal API 33 denies when declined`() {
        // User saw the system prompt and tapped Don't allow — enabled=false,
        // sentinel writes true BEFORE refresh reads it, so we map to DENIED
        // (not NOT_DETERMINED). This is the round-2 Critical scenario.
        val (context, editor, _) = statefulPrefsContext(initialAsked = false)
        notifyPushPermissionPromptedInternal(context = context, notifyEnabled = false, sdkInt = 33)
        verify(exactly = 1) { editor.putBoolean("has_asked_for_push_permission", true) }
        verify(exactly = 1) { editor.apply() }
        assertEquals(PushPermissionState.DENIED, PushPermissionStore.state.value)
    }

    @Test
    fun `notifyPushPermissionPromptedInternal pre-33 authorises when granted`() {
        val (context, editor, _) = statefulPrefsContext(initialAsked = false)
        notifyPushPermissionPromptedInternal(context = context, notifyEnabled = true, sdkInt = 28)
        verify(exactly = 1) { editor.putBoolean("has_asked_for_push_permission", true) }
        verify(exactly = 1) { editor.apply() }
        assertEquals(PushPermissionState.AUTHORIZED, PushPermissionStore.state.value)
    }

    @Test
    fun `notifyPushPermissionPromptedInternal pre-33 denies when declined`() {
        val (context, editor, _) = statefulPrefsContext(initialAsked = false)
        notifyPushPermissionPromptedInternal(context = context, notifyEnabled = false, sdkInt = 28)
        verify(exactly = 1) { editor.putBoolean("has_asked_for_push_permission", true) }
        verify(exactly = 1) { editor.apply() }
        assertEquals(PushPermissionState.DENIED, PushPermissionStore.state.value)
    }

    @Test
    fun `notify on API 33 declined would map NOT_DETERMINED if mark fired after refresh — order guard`() {
        // Defensive: stateful mock + sdk=33 + initialAsked=false means the
        // mark/refresh ORDER is observable. Correct order (mark→refresh) maps
        // to DENIED. If a future edit reversed the lines, the refresh would
        // read sentinel=false and map to NOT_DETERMINED — the assertions in
        // the DENIED test would fail, catching the regression.
        val (context, _, sentinel) = statefulPrefsContext(initialAsked = false)
        notifyPushPermissionPromptedInternal(context = context, notifyEnabled = false, sdkInt = 33)
        assertTrue(sentinel.get(), "sentinel must be true after notify")
        assertEquals(PushPermissionState.DENIED, PushPermissionStore.state.value)
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

    private data class StatefulPrefs(
        val context: Context,
        val editor: SharedPreferences.Editor,
        val sentinel: java.util.concurrent.atomic.AtomicBoolean,
    )

    private fun statefulPrefsContext(initialAsked: Boolean): StatefulPrefs {
        val sentinel =
            java.util.concurrent.atomic
                .AtomicBoolean(initialAsked)
        val editor = mockk<SharedPreferences.Editor>()
        every { editor.putBoolean(any(), any()) } answers {
            sentinel.set(secondArg())
            editor
        }
        every { editor.apply() } just Runs
        val prefs = mockk<SharedPreferences>()
        every { prefs.edit() } returns editor
        every { prefs.getBoolean(any(), any()) } answers { sentinel.get() }
        val context = mockk<Context>()
        every {
            context.getSharedPreferences("push_permission_prefs", Context.MODE_PRIVATE)
        } returns prefs
        return StatefulPrefs(context, editor, sentinel)
    }
}
