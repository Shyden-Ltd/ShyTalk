package com.shyden.shytalk.core.platform

import androidx.compose.ui.graphics.ImageBitmap

class JvmPlatformSettingsService : PlatformSettingsService {
    override fun openUrl(url: String) {
        // No-op on JVM (test-only target)
    }

    override fun openEmail(email: String) {
        // No-op on JVM (test-only target)
    }

    override fun openPlayStore(packageId: String): Boolean = false

    override fun openSystemSettings(type: SettingsType) {
        // No-op on JVM (test-only target)
    }

    override fun restartForLanguageChange() {
        // No-op on JVM (test-only target)
    }

    override fun formatDate(
        timestamp: Long,
        pattern: String,
    ): String = timestamp.toString()

    override fun getAppVersionName(): String = "0.0.0-jvm"

    override fun getAppIcon(): ImageBitmap? = null

    override fun areNotificationsEnabled(): Boolean = false

    override fun canDrawOverlays(): Boolean = false

    // The JVM target exists for host-side tests and desktop tooling; it has no
    // microphone or Bluetooth stack to consult, so nothing is granted.
    override fun hasPermission(permission: AppPermission): Boolean = false
}
