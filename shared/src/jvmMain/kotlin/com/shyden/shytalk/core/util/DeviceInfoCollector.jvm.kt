package com.shyden.shytalk.core.util

actual class DeviceInfoCollector {
    actual fun collect(): DeviceInfo =
        DeviceInfo(
            deviceId = "jvm-test-device",
            manufacturer = "JVM",
            model = "Test",
            osVersion = System.getProperty("os.version"),
            screenResolution = null,
            screenDensity = null,
            totalRamMb = null,
            appVersion = "test",
            buildNumber = 0,
            locale = "en",
            networkType = null,
            carrierName = null,
            firebaseInstallationId = null,
        )
}
