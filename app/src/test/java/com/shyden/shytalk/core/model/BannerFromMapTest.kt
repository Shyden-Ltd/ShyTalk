package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class BannerFromMapTest {
    @Test
    fun `fromMap with camelCase keys from toMap`() {
        val map =
            mapOf<String, Any?>(
                "title" to "Welcome",
                "imageUrl" to "https://img.com/banner.jpg",
                "actionType" to "URL",
                "actionValue" to "https://example.com",
                "sortOrder" to 1,
            )
        val banner = Banner.fromMap(map, "b1")
        assertEquals("b1", banner.id)
        assertEquals("Welcome", banner.title)
        assertEquals("https://img.com/banner.jpg", banner.imageUrl)
        assertEquals(BannerActionType.URL, banner.actionType)
        assertEquals("https://example.com", banner.actionValue)
        assertEquals(1, banner.sortOrder)
    }

    @Test
    fun `fromMap with snake_case keys from raw D1`() {
        val map =
            mapOf<String, Any?>(
                "title" to "Promo",
                "image_url" to "https://img.com/promo.jpg",
                "action_type" to "ROOM",
                "action_value" to "room123",
                "sort_order" to 2,
            )
        val banner = Banner.fromMap(map, "b2")
        assertEquals("https://img.com/promo.jpg", banner.imageUrl)
        assertEquals(BannerActionType.ROOM, banner.actionType)
        assertEquals("room123", banner.actionValue)
        assertEquals(2, banner.sortOrder)
    }

    @Test
    fun `fromMap defaults for missing fields`() {
        val map = emptyMap<String, Any?>()
        val banner = Banner.fromMap(map, "b3")
        assertEquals("", banner.imageUrl)
        assertEquals(BannerActionType.NONE, banner.actionType)
        assertEquals(null, banner.actionValue)
        assertEquals(0, banner.sortOrder)
    }

    @Test
    fun `fromMap with invalid action type defaults to NONE`() {
        val map =
            mapOf<String, Any?>(
                "actionType" to "INVALID_TYPE",
            )
        val banner = Banner.fromMap(map, "b4")
        assertEquals(BannerActionType.NONE, banner.actionType)
    }

    @Test
    fun `fromMap camelCase takes priority over snake_case`() {
        val map =
            mapOf<String, Any?>(
                "imageUrl" to "https://camel.com/img.jpg",
                "image_url" to "https://snake.com/img.jpg",
            )
        val banner = Banner.fromMap(map, "b5")
        assertEquals("https://camel.com/img.jpg", banner.imageUrl)
    }
}
