package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PmPrivacyTest {
    @Test
    fun `enum has exactly three values`() {
        assertEquals(3, PmPrivacy.entries.size)
    }

    @Test
    fun `EVERYONE is a valid entry`() {
        assertTrue(PmPrivacy.EVERYONE in PmPrivacy.entries)
    }

    @Test
    fun `FOLLOWERS_ONLY is a valid entry`() {
        assertTrue(PmPrivacy.FOLLOWERS_ONLY in PmPrivacy.entries)
    }

    @Test
    fun `NO_ONE is a valid entry`() {
        assertTrue(PmPrivacy.NO_ONE in PmPrivacy.entries)
    }

    @Test
    fun `name returns expected strings`() {
        assertEquals("EVERYONE", PmPrivacy.EVERYONE.name)
        assertEquals("FOLLOWERS_ONLY", PmPrivacy.FOLLOWERS_ONLY.name)
        assertEquals("NO_ONE", PmPrivacy.NO_ONE.name)
    }

    @Test
    fun `ordinal preserves declaration order`() {
        assertEquals(0, PmPrivacy.EVERYONE.ordinal)
        assertEquals(1, PmPrivacy.FOLLOWERS_ONLY.ordinal)
        assertEquals(2, PmPrivacy.NO_ONE.ordinal)
    }

    @Test
    fun `valueOf resolves known names`() {
        assertEquals(PmPrivacy.EVERYONE, PmPrivacy.valueOf("EVERYONE"))
        assertEquals(PmPrivacy.FOLLOWERS_ONLY, PmPrivacy.valueOf("FOLLOWERS_ONLY"))
        assertEquals(PmPrivacy.NO_ONE, PmPrivacy.valueOf("NO_ONE"))
    }

    @Test
    fun `valueOf throws for unknown name`() {
        var threw = false
        try {
            PmPrivacy.valueOf("FRIENDS_ONLY")
        } catch (_: IllegalArgumentException) {
            threw = true
        }
        assertTrue(threw)
    }

    @Test
    fun `EVERYONE is not equal to NO_ONE`() {
        assertFalse(PmPrivacy.EVERYONE == PmPrivacy.NO_ONE)
    }

    @Test
    fun `entries list is immutable snapshot`() {
        val first = PmPrivacy.entries
        val second = PmPrivacy.entries
        assertEquals(first, second)
    }
}
