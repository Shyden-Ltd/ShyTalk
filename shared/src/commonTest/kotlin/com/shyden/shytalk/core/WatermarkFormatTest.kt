package com.shyden.shytalk.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pure-formatting contract for the compact preview watermark (SHY-0205).
 *
 * The composable renders exactly what [WatermarkFormat.content] returns —
 * these tests ARE the layout contract (line budget, conditional lines,
 * truncation, dirty marker) since no Compose screenshot framework exists
 * yet (SHY-0179).
 */
class WatermarkFormatTest {
    // ── truncateMiddle ──

    @Test
    fun `truncateMiddle returns short values unchanged`() {
        assertEquals("develop", WatermarkFormat.truncateMiddle("develop", 24))
    }

    @Test
    fun `truncateMiddle returns exact-length values unchanged`() {
        val exact = "x".repeat(24)
        assertEquals(exact, WatermarkFormat.truncateMiddle(exact, 24))
    }

    @Test
    fun `truncateMiddle keeps head and tail with ellipsis at budget`() {
        assertEquals("ab…gh", WatermarkFormat.truncateMiddle("abcdefgh", 5))
    }

    @Test
    fun `truncateMiddle output never exceeds max`() {
        val branch = "story/SHY-0205-preview-watermark-build-identity"
        val out = WatermarkFormat.truncateMiddle(branch, WatermarkFormat.MAX_BRANCH_CHARS)
        assertEquals(WatermarkFormat.MAX_BRANCH_CHARS, out.length)
        assertTrue(out.contains('…'))
        assertTrue(branch.startsWith(out.substringBefore('…')))
        assertTrue(branch.endsWith(out.substringAfter('…')))
    }

    // ── status line (env · version · api) ──

    @Test
    fun `statusLine pairs client identity with server echo`() {
        val content = fullContent()
        assertEquals("local · 0.97.15 (176) · api abc1234", content.statusLine)
    }

    @Test
    fun `statusLine shows question mark when server sha unknown`() {
        val content = fullContent(serverSha = null)
        assertEquals("local · 0.97.15 (176) · api ?", content.statusLine)
    }

    @Test
    fun `statusLine trims server sha to seven chars`() {
        val content = fullContent(serverSha = "abcdef0123456789")
        assertTrue(content.statusLine.endsWith("api abcdef0"))
    }

    // ── git identity lines ──

    @Test
    fun `branch line is middle-truncated to the branch budget`() {
        val content = fullContent(gitBranch = "story/SHY-0205-preview-watermark-build-identity")
        val branchLine = content.detailLines.first()
        assertEquals(WatermarkFormat.MAX_BRANCH_CHARS, branchLine.length)
        assertTrue(branchLine.contains('…'))
    }

    @Test
    fun `sha line carries dirty star and built timestamp`() {
        val content = fullContent(gitSha = "abc1234def", gitDirty = true, builtAt = "07-18 11:40")
        assertEquals("abc1234* · 07-18 11:40", content.detailLines[1])
    }

    @Test
    fun `sha line omits star on a clean tree`() {
        val content = fullContent(gitDirty = false)
        assertEquals("abc1234 · 07-18 11:40", content.detailLines[1])
    }

    @Test
    fun `sha line drops star when sha unknown even if dirty`() {
        val content = fullContent(gitSha = "?", gitDirty = true)
        assertEquals("? · 07-18 11:40", content.detailLines[1])
    }

    @Test
    fun `sha line omits built segment when timestamp unknown`() {
        val content = fullContent(builtAt = "?")
        assertEquals("abc1234", content.detailLines[1])
    }

    // ── identity lines ──

    @Test
    fun `uid line pairs cohort when resolved`() {
        val content = fullContent(uniqueId = "10000005", cohort = "adult")
        assertTrue(content.detailLines.contains("UID: 10000005 · adult"))
    }

    @Test
    fun `uid line omits cohort segment when unresolved`() {
        val content = fullContent(cohort = null)
        assertTrue(content.detailLines.contains("UID: 10000005"))
        assertFalse(content.detailLines.any { it.contains("· null") })
    }

    @Test
    fun `signed-out uid renders dash without cohort`() {
        val content = fullContent(uniqueId = null, cohort = "adult")
        assertTrue(content.detailLines.contains("UID: -"))
        assertFalse(content.detailLines.any { it.contains("adult") })
    }

    @Test
    fun `name line present only when display name resolved`() {
        assertTrue(fullContent().detailLines.contains("Name: Riko"))
        assertFalse(fullContent(displayName = null).detailLines.any { it.startsWith("Name:") })
    }

    // ── locale · route line ──

    @Test
    fun `locale line pairs route when known`() {
        val content = fullContent(locale = "zh", route = "rooms/{roomId}")
        assertTrue(content.detailLines.contains("zh · rooms/{roomId}"))
    }

    @Test
    fun `locale line stands alone when route unknown`() {
        val content = fullContent(route = null)
        assertTrue(content.detailLines.contains("en"))
    }

    @Test
    fun `locale route line absent when both unknown`() {
        val content = fullContent(locale = null, route = null)
        assertFalse(content.detailLines.any { it == "?" || it.isBlank() })
    }

    // ── journey marker ──

    @Test
    fun `journey line rendered with marker glyph only while set`() {
        assertTrue(fullContent(journeyMarker = "j01 s03").detailLines.contains("▶ j01 s03"))
        assertFalse(fullContent(journeyMarker = null).detailLines.any { it.contains('▶') })
    }

    // ── line budget (operator compactness ruling 2026-07-18) ──

    @Test
    fun `fully loaded content stays within the full line budget`() {
        val content = fullContent()
        assertEquals(WatermarkFormat.MAX_LINES_FULL, 2 + content.detailLines.size)
    }

    @Test
    fun `idle signed-out content stays within the idle line budget`() {
        val content =
            fullContent(
                uniqueId = null,
                cohort = null,
                displayName = null,
                route = null,
                journeyMarker = null,
            )
        assertTrue(2 + content.detailLines.size <= WatermarkFormat.MAX_LINES_IDLE)
    }

    @Test
    fun `no detail line is ever blank`() {
        val content =
            fullContent(
                gitBranch = "?",
                gitSha = "?",
                builtAt = "?",
                uniqueId = null,
                cohort = null,
                displayName = null,
                locale = null,
                route = null,
                journeyMarker = null,
                serverSha = null,
            )
        assertTrue(content.detailLines.none { it.isBlank() })
    }

    @Test
    fun `title is the preview literal`() {
        assertEquals("ShyTalk Preview", fullContent().title)
    }

    @Test
    fun `unknown git identity renders placeholders not blanks`() {
        val content = fullContent(gitBranch = "?", gitSha = "?", builtAt = "?")
        assertEquals("?", content.detailLines[0])
        assertEquals("?", content.detailLines[1])
    }

    @Test
    fun `content is null-safe for every optional at once`() {
        val content =
            WatermarkFormat.content(
                environment = "dev",
                buildVersion = "?",
                gitBranch = "?",
                gitSha = "?",
                gitDirty = false,
                builtAt = "?",
                deviceInfo = "?",
                uniqueId = null,
                cohort = null,
                displayName = null,
                locale = null,
                route = null,
                journeyMarker = null,
                serverSha = null,
            )
        assertEquals("dev · ? · api ?", content.statusLine)
        assertNull(content.detailLines.firstOrNull { it.isBlank() })
    }

    private fun fullContent(
        environment: String = "local",
        buildVersion: String = "0.97.15 (176)",
        gitBranch: String = "story/SHY-0205-preview-watermark-build-identity",
        gitSha: String = "abc1234def5678",
        gitDirty: Boolean = false,
        builtAt: String = "07-18 11:40",
        deviceInfo: String = "OnePlus CPH2653 · Android 16",
        uniqueId: String? = "10000005",
        cohort: String? = "adult",
        displayName: String? = "Riko",
        locale: String? = "en",
        route: String? = "main",
        journeyMarker: String? = "j01 s03",
        serverSha: String? = "abc1234",
    ): WatermarkContent =
        WatermarkFormat.content(
            environment = environment,
            buildVersion = buildVersion,
            gitBranch = gitBranch,
            gitSha = gitSha,
            gitDirty = gitDirty,
            builtAt = builtAt,
            deviceInfo = deviceInfo,
            uniqueId = uniqueId,
            cohort = cohort,
            displayName = displayName,
            locale = locale,
            route = route,
            journeyMarker = journeyMarker,
            serverSha = serverSha,
        )
}
