package com.shyden.shytalk.core.push

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat

private const val PREFS_NAME = "push_permission_prefs"
private const val KEY_HAS_ASKED = "has_asked_for_push_permission"

class AndroidPushPermissionBridge(
    private val applicationContext: Context,
) : PushPermissionBridge {
    override fun openSystemSettings() {
        val intent =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, applicationContext.packageName)
                }
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", applicationContext.packageName, null)
                }
            }
        // FLAG_ACTIVITY_NEW_TASK required because the bridge holds applicationContext, not an Activity.
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        applicationContext.startActivity(intent)
    }
}

/**
 * Pure mapping of the three signals the OS gives us into the shared store's enum.
 * Extracted so it can be exhaustively unit-tested without an android.jar dependency.
 *
 * The NOT_DETERMINED case only exists on API 33+ where POST_NOTIFICATIONS is a runtime
 * permission. Pre-33 the user toggle in Settings defaults ON and there is no "never asked"
 * concept, so the binary AUTHORIZED/DENIED faithfully reflects user intent.
 */
internal fun mapPushPermissionState(
    enabled: Boolean,
    sdkInt: Int,
    hasAsked: Boolean,
): PushPermissionState =
    when {
        enabled -> PushPermissionState.AUTHORIZED
        sdkInt >= Build.VERSION_CODES.TIRAMISU && !hasAsked -> PushPermissionState.NOT_DETERMINED
        else -> PushPermissionState.DENIED
    }

fun refreshPushPermissionStateFromContext(context: Context) {
    val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
    val mapped =
        mapPushPermissionState(
            enabled = enabled,
            sdkInt = Build.VERSION.SDK_INT,
            hasAsked = hasAskedForPushPermission(context),
        )
    PushPermissionStore.updateState(mapped)
}

fun hasAskedForPushPermission(context: Context): Boolean =
    context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getBoolean(KEY_HAS_ASKED, false)

/** Called by the host once the POST_NOTIFICATIONS system prompt has been shown. */
fun markPushPermissionPrompted(context: Context) {
    context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_HAS_ASKED, true)
        .apply()
}
