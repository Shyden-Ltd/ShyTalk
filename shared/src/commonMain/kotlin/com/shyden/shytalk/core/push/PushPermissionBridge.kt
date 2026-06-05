package com.shyden.shytalk.core.push

/**
 * Platform action bridge — implemented in iosMain (Swift bridge object) and
 * androidMain when parity ships. Lets shared UI invoke the platform's "open
 * notification settings" deep-link without taking a platform dependency.
 */
interface PushPermissionBridge {
    /**
     * Opens the system Settings app at the app's notification-permission page.
     * No-op on platforms that don't support deep-linking to per-app settings.
     */
    fun openSystemSettings()
}
