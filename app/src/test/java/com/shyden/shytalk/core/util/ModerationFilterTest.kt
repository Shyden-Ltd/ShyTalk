package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ModerationFilterTest {

    @Before
    fun setup() {
        ModerationFilter.reset()
        ModerationFilter.updateProhibitedWords(emptyList())
    }

    // ===== checkMessage =====

    @Test
    fun `checkMessage returns null for clean text`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        assertNull(ModerationFilter.checkMessage("This is a clean message"))
    }

    @Test
    fun `checkMessage returns warning for prohibited word`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        val result = ModerationFilter.checkMessage("This contains badword here")
        assertNotNull(result)
        assertTrue(result!!.contains("inappropriate"))
    }

    @Test
    fun `checkMessage is case-insensitive`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        assertNotNull(ModerationFilter.checkMessage("This has BADWORD"))
        assertNotNull(ModerationFilter.checkMessage("This has BadWord"))
    }

    @Test
    fun `checkMessage detects substring match`() {
        ModerationFilter.updateProhibitedWords(listOf("bad"))
        assertNotNull(ModerationFilter.checkMessage("This is badness"))
    }

    @Test
    fun `checkMessage returns null when words are cleared`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        assertNotNull(ModerationFilter.checkMessage("badword"))

        ModerationFilter.updateProhibitedWords(emptyList())
        assertNull(ModerationFilter.checkMessage("badword"))
    }

    @Test
    fun `checkMessage returns null with empty prohibited list`() {
        assertNull(ModerationFilter.checkMessage("Any text at all"))
    }

    @Test
    fun `checkMessage detects multiple prohibited words`() {
        ModerationFilter.updateProhibitedWords(listOf("bad", "evil"))
        assertNotNull(ModerationFilter.checkMessage("This is evil"))
        assertNotNull(ModerationFilter.checkMessage("This is bad"))
    }

    // ===== isSpam =====

    @Test
    fun `isSpam first message is not spam`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
    }

    @Test
    fun `isSpam second identical message is not spam`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("Hello"))
    }

    @Test
    fun `isSpam third identical message triggers spam`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertTrue(ModerationFilter.isSpam("Hello"))
    }

    @Test
    fun `isSpam different messages are not spam`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("World"))
        assertFalse(ModerationFilter.isSpam("Foo"))
    }

    @Test
    fun `isSpam reset clears state`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("Hello"))
        ModerationFilter.reset()
        // After reset, same message should not be considered spam
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("Hello"))
    }

    // ===== checkMessage edge cases =====

    @Test
    fun `checkMessage returns null for empty string`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        assertNull(ModerationFilter.checkMessage(""))
    }

    @Test
    fun `checkMessage returns null for whitespace only`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        assertNull(ModerationFilter.checkMessage("   "))
    }

    @Test
    fun `checkMessage handles unicode text without prohibited words`() {
        ModerationFilter.updateProhibitedWords(listOf("bad"))
        assertNull(ModerationFilter.checkMessage("\u2764\uFE0F Hello \u4F60\u597D \uD83D\uDE00"))
    }

    @Test
    fun `checkMessage detects prohibited word with surrounding special characters`() {
        ModerationFilter.updateProhibitedWords(listOf("bad"))
        assertNotNull(ModerationFilter.checkMessage("!!!bad!!!"))
    }

    @Test
    fun `checkMessage handles very long text`() {
        ModerationFilter.updateProhibitedWords(listOf("hidden"))
        val longText = "a".repeat(10_000) + "hidden" + "b".repeat(10_000)
        assertNotNull(ModerationFilter.checkMessage(longText))
    }

    @Test
    fun `checkMessage returns null for very long clean text`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        val longClean = "clean ".repeat(5000)
        assertNull(ModerationFilter.checkMessage(longClean))
    }

    @Test
    fun `checkMessage handles single character prohibited word`() {
        ModerationFilter.updateProhibitedWords(listOf("x"))
        assertNotNull(ModerationFilter.checkMessage("extra"))
        assertNull(ModerationFilter.checkMessage("hello"))
    }

    @Test
    fun `checkMessage handles prohibited words with special regex characters`() {
        // Contains() doesn't use regex, but worth verifying no crashes
        ModerationFilter.updateProhibitedWords(listOf("a.b", "c*d", "[test]"))
        // These should not match unless they literally contain the substring
        assertNull(ModerationFilter.checkMessage("aXb"))
        assertNotNull(ModerationFilter.checkMessage("a.b"))
    }

    @Test
    fun `updateProhibitedWords lowercases all entries`() {
        ModerationFilter.updateProhibitedWords(listOf("BAD", "Evil", "UPPER"))
        // Should match regardless of original case in list
        assertNotNull(ModerationFilter.checkMessage("this is bad"))
        assertNotNull(ModerationFilter.checkMessage("this is evil"))
        assertNotNull(ModerationFilter.checkMessage("this is upper"))
    }

    // ===== isSpam edge cases =====

    @Test
    fun `isSpam treats different case as different messages`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("hello"))
        assertFalse(ModerationFilter.isSpam("HELLO"))
    }

    @Test
    fun `isSpam empty string can still be spam`() {
        assertFalse(ModerationFilter.isSpam(""))
        assertFalse(ModerationFilter.isSpam(""))
        assertTrue(ModerationFilter.isSpam(""))
    }

    @Test
    fun `isSpam interleaved different messages do not trigger spam`() {
        assertFalse(ModerationFilter.isSpam("A"))
        assertFalse(ModerationFilter.isSpam("B"))
        assertFalse(ModerationFilter.isSpam("A"))
        assertFalse(ModerationFilter.isSpam("B"))
        // Only 2 of each, neither should be spam
        assertFalse(ModerationFilter.isSpam("C"))
    }

    @Test
    fun `isSpam fourth identical message is also spam`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertTrue(ModerationFilter.isSpam("Hello"))
        assertTrue(ModerationFilter.isSpam("Hello")) // 4th is still spam
    }
}
