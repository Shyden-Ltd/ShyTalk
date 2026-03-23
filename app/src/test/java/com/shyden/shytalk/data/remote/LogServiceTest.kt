package com.shyden.shytalk.data.remote

import org.junit.Assert.*
import org.junit.Test

class LogServiceTest {
    @Test
    fun `LogEntry has correct defaults`() {
        val entry =
            LogEntry(
                level = "INFO",
                source = "android",
                message = "test",
                sessionTraceId = "trace-123",
                userId = null,
                deviceId = null,
            )
        assertEquals("INFO", entry.level)
        assertEquals("android", entry.source)
        assertTrue(entry.context.isEmpty())
        assertNull(entry.appVersion)
    }

    @Test
    fun `BatchSettings has correct defaults`() {
        val settings = BatchSettings()
        assertEquals(30, settings.intervalSeconds)
        assertFalse(settings.wifiOnly)
    }

    @Test
    fun `LogConfig has correct defaults`() {
        val config = LogConfig()
        assertTrue(config.levelPerSource.isEmpty())
        assertEquals(30, config.batchSettings.intervalSeconds)
    }
}
