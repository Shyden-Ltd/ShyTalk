package com.shyden.shytalk.core.util

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.provider.Settings
import android.telephony.TelephonyManager

actual class DeviceInfoCollector(
    private val context: Context,
) {
    @SuppressLint("HardwareIds")
    actual fun collect(): DeviceInfo {
        val deviceId =
            Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ANDROID_ID,
            ) ?: "unknown"

        val activityManager =
            context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val memInfo = ActivityManager.MemoryInfo()
        activityManager?.getMemoryInfo(memInfo)
        val totalRamMb = memInfo.totalMem / (1024 * 1024)

        val displayMetrics = context.resources.displayMetrics
        val screenRes = "${displayMetrics.widthPixels}x${displayMetrics.heightPixels}"
        val density = displayMetrics.density

        val telephonyManager =
            context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        val carrier = telephonyManager?.networkOperatorName

        val packageInfo =
            try {
                context.packageManager.getPackageInfo(context.packageName, 0)
            } catch (_: Exception) {
                null
            }

        val appVersion = packageInfo?.versionName
        val buildNumber =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo?.longVersionCode?.toInt()
            } else {
                @Suppress("DEPRECATION")
                packageInfo?.versionCode
            }

        return DeviceInfo(
            deviceId = deviceId,
            manufacturer = Build.MANUFACTURER,
            model = Build.MODEL,
            osVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
            screenResolution = screenRes,
            screenDensity = density,
            totalRamMb = totalRamMb,
            appVersion = appVersion,
            buildNumber = buildNumber,
            locale =
                java.util.Locale
                    .getDefault()
                    .toLanguageTag(),
            networkType = null, // Would need ConnectivityManager with permission
            carrierName = carrier,
            firebaseInstallationId = null, // Set later by the caller if needed
        )
    }
}
