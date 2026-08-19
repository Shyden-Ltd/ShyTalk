package com.shyden.shytalk.core.platform

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class PlatformSettingsServiceTest {
    private val service = JvmPlatformSettingsService()

    @Test
    fun `formatDate returns formatted date string`() {
        // 2024-03-08 UTC in millis
        val timestamp = 1709856000000L
        val result = service.formatDate(timestamp)
        // JVM stub returns placeholder format
        assertEquals("1709856000000", result)
    }

    @Test
    fun `getAppVersionName returns placeholder on jvm`() {
        assertEquals("0.0.0-jvm", service.getAppVersionName())
    }

    @Test
    fun `getAppIcon returns null on jvm`() {
        assertNull(service.getAppIcon())
    }

    @Test
    fun `areNotificationsEnabled returns false on jvm`() {
        assertFalse(service.areNotificationsEnabled())
    }

    @Test
    fun `canDrawOverlays returns false on jvm`() {
        assertFalse(service.canDrawOverlays())
    }

    @Test
    fun `hasPermission returns false on jvm for every permission`() {
        // SHY-0272: this used to pass a raw Android constant STRING. It could
        // never have caught the real defect — the JVM stub returns false
        // whatever it is handed, so the assertion held equally for
        // "android.permission.RECORD_AUDIO", "microphone", or nonsense. The
        // signature now takes an enum, and this iterates every case so a new
        // permission cannot be added without the JVM target answering for it.
        AppPermission.entries.forEach { assertFalse(service.hasPermission(it)) }
    }

    @Test
    fun `openUrl does not throw on jvm`() {
        service.openUrl("https://example.com")
    }

    @Test
    fun `openEmail does not throw on jvm`() {
        service.openEmail("test@example.com")
    }

    @Test
    fun `openPlayStore does not throw on jvm`() {
        service.openPlayStore("com.shyden.shytalk")
    }

    @Test
    fun `openSystemSettings does not throw on jvm`() {
        SettingsType.entries.forEach { type ->
            service.openSystemSettings(type)
        }
    }

    @Test
    fun `restartForLanguageChange does not throw on jvm`() {
        service.restartForLanguageChange()
    }
}
