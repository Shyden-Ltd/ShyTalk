@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package com.shyden.shytalk.core.platform

import androidx.compose.ui.graphics.ImageBitmap
import com.shyden.shytalk.core.util.logE
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSURL
import platform.Foundation.dateWithTimeIntervalSince1970
import platform.UIKit.UIApplication
import platform.UIKit.UIApplicationOpenSettingsURLString

private const val LOG_TAG = "IosPlatformSettings"

class IosPlatformSettingsService : PlatformSettingsService {
    override fun openUrl(url: String) {
        openUrlInternal(url)
    }

    override fun openEmail(email: String) {
        openUrlInternal("mailto:$email")
    }

    override fun openPlayStore(packageId: String): Boolean {
        // Apple App Store URLs require either a numeric `id<n>` or a name slug —
        // the bundle ID is not a valid path component. Until ShyTalk is publicly
        // listed (currently TestFlight-only), fall back to App Store search,
        // which lands users on a working page where they can find the app.
        // Once published, replace with `https://apps.apple.com/app/id<numericId>`.
        return openUrlInternal("https://apps.apple.com/search?term=ShyTalk")
    }

    override fun openSystemSettings(type: SettingsType) {
        openUrlInternal(UIApplicationOpenSettingsURLString)
    }

    /**
     * Returns true if the URL was launched. Logs (rather than silently
     * swallowing) the two iOS failure modes: (1) NSURL rejecting the string,
     * (2) UIApplication.openURL returning false (Restrictions, missing
     * LSApplicationQueriesSchemes, no handler app installed).
     */
    private fun openUrlInternal(url: String): Boolean {
        val nsUrl = NSURL.URLWithString(url)
        if (nsUrl == null) {
            logE(LOG_TAG, "NSURL rejected url=$url")
            return false
        }
        val opened = UIApplication.sharedApplication.openURL(nsUrl)
        if (!opened) {
            logE(LOG_TAG, "UIApplication.openURL returned false for url=$url")
        }
        return opened
    }

    override fun restartForLanguageChange() {
        // iOS handles language changes at the system level; no app restart needed
    }

    override fun formatDate(
        timestamp: Long,
        pattern: String,
    ): String {
        val formatter = NSDateFormatter()
        formatter.dateFormat = pattern
        val date = platform.Foundation.NSDate.dateWithTimeIntervalSince1970(timestamp / 1000.0)
        return formatter.stringFromDate(date)
    }

    override fun getAppVersionName(): String {
        val bundle = platform.Foundation.NSBundle.mainBundle
        return (bundle.infoDictionary?.get("CFBundleShortVersionString") as? String) ?: "?"
    }

    override fun getAppIcon(): ImageBitmap? {
        // iOS app icon cannot be loaded as ImageBitmap without platform-specific
        // UIImage→Skia conversion. The About page gracefully handles null (hides icon).
        return null
    }

    override fun areNotificationsEnabled(): Boolean {
        // UNUserNotificationCenter requires async check; return true as default
        // Real check would need a suspend function or callback pattern
        return true
    }

    override fun canDrawOverlays(): Boolean = false // No equivalent on iOS

    override fun hasPermission(permission: String): Boolean {
        // iOS permissions are checked through specific framework APIs,
        // not generic string-based like Android
        return true
    }
}
