package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceInfoCollectorTest {
    @Test
    fun `DeviceInfo can be constructed with all fields`() {
        val info =
            DeviceInfo(
                deviceId = "test-device-123",
                manufacturer = "TestMfg",
                model = "TestModel",
                osVersion = "Android 14 (API 34)",
                screenResolution = "1080x2400",
                screenDensity = 2.75f,
                totalRamMb = 8192L,
                appVersion = "1.0.0",
                buildNumber = 42,
                locale = "en-US",
                networkType = "wifi",
                carrierName = "T-Mobile",
                firebaseInstallationId = "fid-abc-123",
            )
        assertEquals("test-device-123", info.deviceId)
        assertEquals("TestMfg", info.manufacturer)
        assertEquals("TestModel", info.model)
        assertEquals(8192L, info.totalRamMb)
        assertEquals(42, info.buildNumber)
    }

    @Test
    fun `DeviceInfo can be constructed with nullable fields`() {
        val info =
            DeviceInfo(
                deviceId = "test-device-456",
                manufacturer = null,
                model = null,
                osVersion = null,
                screenResolution = null,
                screenDensity = null,
                totalRamMb = null,
                appVersion = null,
                buildNumber = null,
                locale = null,
                networkType = null,
                carrierName = null,
                firebaseInstallationId = null,
            )
        assertEquals("test-device-456", info.deviceId)
        assertNull(info.manufacturer)
        assertNull(info.appVersion)
    }

    @Test
    fun `DeviceInfo copy preserves all fields`() {
        val info =
            DeviceInfo(
                deviceId = "d1",
                manufacturer = "Mfg",
                model = "Mdl",
                osVersion = "OS",
                screenResolution = "1080x1920",
                screenDensity = 3.0f,
                totalRamMb = 4096L,
                appVersion = "2.0",
                buildNumber = 10,
                locale = "ja-JP",
                networkType = "cellular",
                carrierName = "SoftBank",
                firebaseInstallationId = "fid",
            )
        val copy = info.copy(deviceId = "d2")
        assertEquals("d2", copy.deviceId)
        assertEquals("Mfg", copy.manufacturer)
        assertEquals("Mdl", copy.model)
        assertEquals("OS", copy.osVersion)
        assertEquals(3.0f, copy.screenDensity)
        assertEquals(4096L, copy.totalRamMb)
        assertEquals("2.0", copy.appVersion)
        assertEquals(10, copy.buildNumber)
        assertEquals("ja-JP", copy.locale)
        assertEquals("cellular", copy.networkType)
        assertEquals("SoftBank", copy.carrierName)
        assertEquals("fid", copy.firebaseInstallationId)
    }
}
