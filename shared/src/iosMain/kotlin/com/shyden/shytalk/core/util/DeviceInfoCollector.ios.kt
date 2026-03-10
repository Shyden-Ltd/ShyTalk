package com.shyden.shytalk.core.util

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.useContents
import platform.Foundation.NSBundle
import platform.Foundation.NSLocale
import platform.Foundation.NSProcessInfo
import platform.Foundation.currentLocale
import platform.Foundation.languageCode
import platform.UIKit.UIDevice
import platform.UIKit.UIScreen

actual class DeviceInfoCollector {
    @OptIn(ExperimentalForeignApi::class)
    actual fun collect(): DeviceInfo {
        val device = UIDevice.currentDevice
        val screen = UIScreen.mainScreen
        val processInfo = NSProcessInfo.processInfo
        val bundle = NSBundle.mainBundle

        val totalRamBytes = processInfo.physicalMemory
        val totalRamMb = (totalRamBytes / (1024uL * 1024uL)).toLong()

        val scale = screen.scale
        val (width, height) = screen.bounds.useContents {
            Pair((size.width * scale).toInt(), (size.height * scale).toInt())
        }

        return DeviceInfo(
            deviceId = device.identifierForVendor?.UUIDString ?: "unknown",
            manufacturer = "Apple",
            model = device.model,
            osVersion = "iOS ${device.systemVersion}",
            screenResolution = "${width}x${height}",
            screenDensity = scale.toFloat(),
            totalRamMb = totalRamMb,
            appVersion = bundle.objectForInfoDictionaryKey("CFBundleShortVersionString") as? String,
            buildNumber = (bundle.objectForInfoDictionaryKey("CFBundleVersion") as? String)?.toIntOrNull(),
            locale = NSLocale.currentLocale.languageCode,
            networkType = null,
            carrierName = null,
            firebaseInstallationId = null
        )
    }
}
