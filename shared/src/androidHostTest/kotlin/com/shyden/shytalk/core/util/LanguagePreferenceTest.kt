package com.shyden.shytalk.core.util

import android.content.Context
import android.content.SharedPreferences
import io.mockk.every
import io.mockk.mockk
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0182: `LanguagePreference.android` must be functional in host unit tests
 * (no Android context wired) via its in-memory fallback, AND keep
 * `SharedPreferences` authoritative in production. These pin BOTH branches of
 * the host-testability fix — the fix `WebUrlsTest.legalForCurrentBuild` only
 * reached indirectly for the language field, and not at all for the
 * auto-translate / legal-version fields whose default-arg semantics also changed.
 */
class LanguagePreferenceTest {
    @BeforeTest
    fun before() = LanguagePreference.resetForTest()

    @AfterTest
    fun after() = LanguagePreference.resetForTest()

    // ── in-memory fallback (no context wired: host tests, or any get/set before init) ──

    @Test
    fun `language round-trips through the in-memory fallback when no context is wired`() {
        LanguagePreference.set("fr")
        assertEquals("fr", LanguagePreference.get())
    }

    @Test
    fun `the in-memory language is coerced to two letters`() {
        LanguagePreference.set("en-GB")
        assertEquals("en", LanguagePreference.get())
    }

    @Test
    fun `auto-translate round-trips through the in-memory fallback (default false)`() {
        assertFalse(LanguagePreference.getAutoTranslate())
        LanguagePreference.setAutoTranslate(true)
        assertTrue(LanguagePreference.getAutoTranslate())
    }

    @Test
    fun `accepted legal version round-trips through the in-memory fallback (default 0)`() {
        assertEquals(0, LanguagePreference.getAcceptedLegalVersion())
        LanguagePreference.setAcceptedLegalVersion(6)
        assertEquals(6, LanguagePreference.getAcceptedLegalVersion())
    }

    // ── SharedPreferences stays authoritative once a context IS wired (production) ──

    @Test
    fun `SharedPreferences wins over the in-memory fallback for every field`() {
        // Seed the in-memory fallback with one set of values…
        LanguagePreference.set("de")
        LanguagePreference.setAutoTranslate(false)
        LanguagePreference.setAcceptedLegalVersion(1)

        // …then wire a prefs that DISAGREES; production reads must follow prefs.
        val prefs =
            mockk<SharedPreferences> {
                every { getString("preferred_language", null) } returns "ja"
                every { getBoolean("auto_translate", any()) } returns true
                every { getInt("accepted_legal_version", any()) } returns 9
            }
        val context =
            mockk<Context> {
                every { getSharedPreferences(any(), any()) } returns prefs
            }
        LanguagePreference.init(context)

        assertEquals("ja", LanguagePreference.get())
        assertTrue(LanguagePreference.getAutoTranslate())
        assertEquals(9, LanguagePreference.getAcceptedLegalVersion())
    }
}
