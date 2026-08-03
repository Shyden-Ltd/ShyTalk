package com.shyden.shytalk.core.platform

import androidx.compose.ui.graphics.ImageBitmap

interface PlatformSettingsService {
    /** Open a URL in the platform's default browser. */
    fun openUrl(url: String)

    /** Open an email compose window to the given address. */
    fun openEmail(email: String)

    /**
     * Open the platform's app store page for the given package/bundle ID.
     * Returns true if the store was launched, false if it could not be opened
     * (e.g. no store app installed, URL rejected by the system). Callers on
     * blocking screens like force-update MUST surface a fallback when false.
     */
    fun openPlayStore(packageId: String): Boolean

    /** Open platform system settings for the specified type. */
    fun openSystemSettings(type: SettingsType)

    /** Restart/recreate the app after a language change. */
    fun restartForLanguageChange()

    /** Format a timestamp to a date string. */
    fun formatDate(
        timestamp: Long,
        pattern: String = "yyyy-MM-dd",
    ): String

    /** Get the app version name (e.g. "1.2.3"). */
    fun getAppVersionName(): String

    /** Get the app icon as an ImageBitmap, or null if not available. */
    fun getAppIcon(): ImageBitmap?

    /** Check if notifications are enabled for the app. */
    fun areNotificationsEnabled(): Boolean

    /** Check if overlay (draw-over-other-apps) permission is granted. Always false on iOS. */
    fun canDrawOverlays(): Boolean

    /** Check if a specific runtime permission is granted. */
    fun hasPermission(permission: AppPermission): Boolean
}

/**
 * A runtime permission, named in platform-neutral terms (SHY-0272).
 *
 * This used to be a plain `String`, and the room's mic toggle passed
 * `"microphone"` while the Android implementation fed the argument straight to
 * `ContextCompat.checkSelfPermission`, which only understands
 * `android.permission.*` constants. The check therefore returned DENIED
 * forever and the toggle silently did nothing on every Android device.
 *
 * An enum makes that class of mistake unrepresentable: a call site cannot
 * invent a name, and each platform's `when` is exhaustive, so a new permission
 * cannot be added without every platform being made to handle it.
 */
enum class AppPermission {
    MICROPHONE,
    BLUETOOTH,
}

enum class SettingsType {
    NOTIFICATIONS,
    OVERLAY,
    MICROPHONE,
    BLUETOOTH,
    APP_SETTINGS,
}
