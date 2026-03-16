package com.shyden.shytalk.core.util

data class DeviceInfo(
    val deviceId: String,
    val manufacturer: String?,
    val model: String?,
    val osVersion: String?,
    val screenResolution: String?,
    val screenDensity: Float?,
    val totalRamMb: Long?,
    val appVersion: String?,
    val buildNumber: Int?,
    val locale: String?,
    val networkType: String?,
    val carrierName: String?,
    val firebaseInstallationId: String?,
)

expect class DeviceInfoCollector {
    fun collect(): DeviceInfo
}
