package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BannerTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "title" to "Welcome Banner",
                "imageUrl" to "https://banner.png",
                "actionType" to "URL",
                "actionValue" to "https://example.com",
                "sortOrder" to 3,
            )

        val banner = Banner.fromMap(map, "banner-1")

        assertEquals("banner-1", banner.id)
        assertEquals("Welcome Banner", banner.title)
        assertEquals("https://banner.png", banner.imageUrl)
        assertEquals(BannerActionType.URL, banner.actionType)
        assertEquals("https://example.com", banner.actionValue)
        assertEquals(3, banner.sortOrder)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val banner = Banner.fromMap(emptyMap(), "banner-2")

        assertEquals("banner-2", banner.id)
        assertNull(banner.title)
        assertEquals("", banner.imageUrl)
        assertEquals(BannerActionType.NONE, banner.actionType)
        assertNull(banner.actionValue)
        assertEquals(0, banner.sortOrder)
    }

    // ── BannerActionType parsing ────────────────────────────────────

    @Test
    fun `fromMap parses all action types`() {
        for (type in BannerActionType.entries) {
            val map = mapOf<String, Any?>("actionType" to type.name)
            val banner = Banner.fromMap(map, "b")
            assertEquals(type, banner.actionType)
        }
    }

    @Test
    fun `fromMap defaults to NONE for unknown action type`() {
        val map = mapOf<String, Any?>("actionType" to "UNKNOWN_TYPE")
        val banner = Banner.fromMap(map, "b")
        assertEquals(BannerActionType.NONE, banner.actionType)
    }

    @Test
    fun `fromMap defaults to NONE for null action type`() {
        val map = mapOf<String, Any?>("actionType" to null)
        val banner = Banner.fromMap(map, "b")
        assertEquals(BannerActionType.NONE, banner.actionType)
    }

    // ── Snake_case fallback fields ──────────────────────────────────

    @Test
    fun `fromMap uses snake_case image_url fallback`() {
        val map = mapOf<String, Any?>("image_url" to "https://fallback.png")
        val banner = Banner.fromMap(map, "b")
        assertEquals("https://fallback.png", banner.imageUrl)
    }

    @Test
    fun `fromMap uses snake_case action_type fallback`() {
        val map = mapOf<String, Any?>("action_type" to "ROOM")
        val banner = Banner.fromMap(map, "b")
        assertEquals(BannerActionType.ROOM, banner.actionType)
    }

    @Test
    fun `fromMap uses snake_case action_value fallback`() {
        val map = mapOf<String, Any?>("action_value" to "room-123")
        val banner = Banner.fromMap(map, "b")
        assertEquals("room-123", banner.actionValue)
    }

    @Test
    fun `fromMap uses snake_case sort_order fallback`() {
        val map = mapOf<String, Any?>("sort_order" to 5)
        val banner = Banner.fromMap(map, "b")
        assertEquals(5, banner.sortOrder)
    }

    @Test
    fun `fromMap prefers camelCase over snake_case`() {
        val map =
            mapOf<String, Any?>(
                "imageUrl" to "https://camel.png",
                "image_url" to "https://snake.png",
                "actionType" to "URL",
                "action_type" to "ROOM",
                "actionValue" to "camel-value",
                "action_value" to "snake-value",
                "sortOrder" to 1,
                "sort_order" to 2,
            )

        val banner = Banner.fromMap(map, "b")

        assertEquals("https://camel.png", banner.imageUrl)
        assertEquals(BannerActionType.URL, banner.actionType)
        assertEquals("camel-value", banner.actionValue)
        assertEquals(1, banner.sortOrder)
    }

    // ── Number type coercion ────────────────────────────────────────

    @Test
    fun `fromMap handles Long for sortOrder`() {
        val map = mapOf<String, Any?>("sortOrder" to 5L)
        val banner = Banner.fromMap(map, "b")
        assertEquals(5, banner.sortOrder)
    }

    // ── BannerActionType enum ───────────────────────────────────────

    @Test
    fun `BannerActionType has expected values`() {
        val types = BannerActionType.entries
        assertEquals(4, types.size)
    }
}
