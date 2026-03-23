package com.shyden.shytalk.feature.starting

import com.shyden.shytalk.data.remote.StartingScreen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for the StartingScreen data class and related logic.
 */
class StartingScreenDataTest {
    // ── Data class basics ──────────────────────────────

    @Test
    fun `StartingScreen with all fields set`() {
        val screen =
            StartingScreen(
                screenId = "preLaunchGate",
                enabled = true,
                dismissable = false,
                frequency = "every_launch",
                template = "warning",
                title = "Not Available",
                message = "ShyTalk is not available yet.",
                imageType = "police_duck",
                backgroundImage = "bg/image.jpg",
                startDate = "2026-03-01T00:00:00Z",
                endDate = "2026-12-31T23:59:59Z",
                contentHash = "abc123def456",
            )
        assertEquals("preLaunchGate", screen.screenId)
        assertTrue(screen.enabled)
        assertFalse(screen.dismissable)
        assertEquals("every_launch", screen.frequency)
        assertEquals("warning", screen.template)
        assertEquals("Not Available", screen.title)
        assertEquals("ShyTalk is not available yet.", screen.message)
        assertEquals("police_duck", screen.imageType)
        assertEquals("bg/image.jpg", screen.backgroundImage)
        assertEquals("2026-03-01T00:00:00Z", screen.startDate)
        assertEquals("2026-12-31T23:59:59Z", screen.endDate)
        assertEquals("abc123def456", screen.contentHash)
    }

    @Test
    fun `StartingScreen with optional fields null`() {
        val screen =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = true,
                frequency = "once",
                template = "info",
                title = "Test",
                message = "Test message",
            )
        assertNull(screen.imageType)
        assertNull(screen.backgroundImage)
        assertNull(screen.startDate)
        assertNull(screen.endDate)
        assertEquals("", screen.contentHash)
    }

    @Test
    fun `StartingScreen copy preserves all fields`() {
        val original =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = false,
                frequency = "every_launch",
                template = "warning",
                title = "Original",
                message = "Original message",
                imageType = "police_duck",
                contentHash = "hash1",
            )
        val copy = original.copy(title = "Modified")
        assertEquals("Modified", copy.title)
        assertEquals(original.screenId, copy.screenId)
        assertEquals(original.message, copy.message)
        assertEquals(original.contentHash, copy.contentHash)
        assertEquals(original.template, copy.template)
    }

    @Test
    fun `StartingScreen equality check`() {
        val screen1 =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = false,
                frequency = "every_launch",
                template = "warning",
                title = "Title",
                message = "Message",
            )
        val screen2 = screen1.copy()
        assertEquals(screen1, screen2)
    }

    @Test
    fun `StartingScreen inequality when title differs`() {
        val screen1 =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = false,
                frequency = "every_launch",
                template = "warning",
                title = "Title A",
                message = "Message",
            )
        val screen2 = screen1.copy(title = "Title B")
        assertNotEquals(screen1, screen2)
    }

    // ── Template validation ──────────────────────────────

    @Test
    fun `valid template values`() {
        val validTemplates = listOf("warning", "promotional", "announcement", "info")
        for (template in validTemplates) {
            val screen =
                StartingScreen(
                    screenId = "test",
                    enabled = true,
                    dismissable = true,
                    frequency = "every_launch",
                    template = template,
                    title = "Test",
                    message = "Test message",
                )
            assertEquals(template, screen.template)
        }
    }

    // ── Frequency validation ──────────────────────────────

    @Test
    fun `valid frequency values`() {
        val screen1 =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = true,
                frequency = "every_launch",
                template = "info",
                title = "Test",
                message = "Test message",
            )
        assertEquals("every_launch", screen1.frequency)

        val screen2 = screen1.copy(frequency = "once")
        assertEquals("once", screen2.frequency)
    }

    // ── Blocking detection ──────────────────────────────

    @Test
    fun `blocking screen is non-dismissable`() {
        val screen =
            StartingScreen(
                screenId = "blocker",
                enabled = true,
                dismissable = false,
                frequency = "every_launch",
                template = "warning",
                title = "Blocked",
                message = "Access denied",
            )
        assertFalse(screen.dismissable)
    }

    @Test
    fun `dismissable screen is identified correctly`() {
        val screen =
            StartingScreen(
                screenId = "notice",
                enabled = true,
                dismissable = true,
                frequency = "once",
                template = "announcement",
                title = "Notice",
                message = "Read this",
            )
        assertTrue(screen.dismissable)
    }

    // ── Screen filtering logic (simulates service behavior) ──

    @Test
    fun `filter enabled screens only`() {
        val screens =
            mapOf(
                "active" to StartingScreen("active", true, true, "every_launch", "info", "Active", "msg"),
                "disabled" to StartingScreen("disabled", false, true, "every_launch", "info", "Disabled", "msg"),
            )
        val enabled = screens.values.filter { it.enabled }
        assertEquals(1, enabled.size)
        assertEquals("active", enabled[0].screenId)
    }

    @Test
    fun `find blocking screen from list`() {
        val screens =
            listOf(
                StartingScreen("dismissable1", true, true, "every_launch", "info", "D1", "msg"),
                StartingScreen("blocker", true, false, "every_launch", "warning", "Blocked", "msg"),
                StartingScreen("dismissable2", true, true, "once", "info", "D2", "msg"),
            )
        val blocker = screens.firstOrNull { !it.dismissable }
        assertEquals("blocker", blocker?.screenId)
    }

    @Test
    fun `no blocking screen returns null`() {
        val screens =
            listOf(
                StartingScreen("d1", true, true, "every_launch", "info", "D1", "msg"),
                StartingScreen("d2", true, true, "once", "info", "D2", "msg"),
            )
        val blocker = screens.firstOrNull { !it.dismissable }
        assertNull(blocker)
    }

    @Test
    fun `filter dismissed once screens`() {
        val dismissedIds = setOf("d1")
        val screens =
            listOf(
                StartingScreen("d1", true, true, "once", "info", "D1", "msg"),
                StartingScreen("d2", true, true, "once", "info", "D2", "msg"),
                StartingScreen("d3", true, true, "every_launch", "info", "D3", "msg"),
            )
        val visible = screens.filter { it.frequency != "once" || it.screenId !in dismissedIds }
        assertEquals(2, visible.size)
        assertTrue(visible.none { it.screenId == "d1" })
        assertTrue(visible.any { it.screenId == "d2" })
        assertTrue(visible.any { it.screenId == "d3" })
    }

    @Test
    fun `every_launch screen always shown regardless of dismissed set`() {
        val dismissedIds = setOf("everyLaunch")
        val screen = StartingScreen("everyLaunch", true, true, "every_launch", "info", "Title", "msg")
        val visible = screen.frequency != "once" || screen.screenId !in dismissedIds
        assertTrue(visible)
    }

    // ── ContentHash ──────────────────────────────────

    @Test
    fun `contentHash default is empty string`() {
        val screen =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = true,
                frequency = "every_launch",
                template = "info",
                title = "Test",
                message = "Message",
            )
        assertEquals("", screen.contentHash)
    }

    @Test
    fun `same screens with different contentHash are not equal`() {
        val screen1 =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = true,
                frequency = "every_launch",
                template = "info",
                title = "Test",
                message = "Message",
                contentHash = "hash1",
            )
        val screen2 = screen1.copy(contentHash = "hash2")
        assertNotEquals(screen1, screen2)
    }

    // ── Unknown/edge values ──────────────────────────────

    @Test
    fun `unknown template string is stored as-is`() {
        val screen =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = true,
                frequency = "every_launch",
                template = "unknown_template",
                title = "Test",
                message = "Message",
            )
        assertEquals("unknown_template", screen.template)
    }

    @Test
    fun `empty title and message`() {
        val screen =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = true,
                frequency = "every_launch",
                template = "info",
                title = "",
                message = "",
            )
        assertEquals("", screen.title)
        assertEquals("", screen.message)
    }

    @Test
    fun `very long title (100 chars)`() {
        val longTitle = "A".repeat(100)
        val screen =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = true,
                frequency = "every_launch",
                template = "info",
                title = longTitle,
                message = "Message",
            )
        assertEquals(100, screen.title.length)
    }

    @Test
    fun `very long message (500 chars)`() {
        val longMessage = "B".repeat(500)
        val screen =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = true,
                frequency = "every_launch",
                template = "info",
                title = "Title",
                message = longMessage,
            )
        assertEquals(500, screen.message.length)
    }

    @Test
    fun `unicode title and message`() {
        val screen =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = true,
                frequency = "every_launch",
                template = "info",
                title = "\u4F60\u597D\u4E16\u754C", // 你好世界
                message = "\u0645\u0631\u062D\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645", // مرحبا بالعالم
            )
        assertEquals("\u4F60\u597D\u4E16\u754C", screen.title)
    }

    @Test
    fun `emoji in title`() {
        val screen =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = true,
                frequency = "every_launch",
                template = "info",
                title = "Welcome \uD83D\uDE00",
                message = "Hello!",
            )
        assertTrue(screen.title.contains("\uD83D\uDE00"))
    }
}
