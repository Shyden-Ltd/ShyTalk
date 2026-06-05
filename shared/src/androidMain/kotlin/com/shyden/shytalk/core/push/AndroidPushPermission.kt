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

internal fun shouldBackfillSentinel(
    enabled: Boolean,
    sdkInt: Int,
    hasAsked: Boolean,
): Boolean = enabled && sdkInt >= Build.VERSION_CODES.TIRAMISU && !hasAsked

internal fun refreshPushPermissionState(
    enabled: Boolean,
    sdkInt: Int,
    readHasAsked: () -> Boolean,
    markAsked: () -> Unit,
) {
    // enabled=true definitively implies the user has been asked (or pre-granted via OEM/ADB),
    // so back-fill the sentinel so a future revoke cold-starts to DENIED, not NOT_DETERMINED.
    if (shouldBackfillSentinel(enabled, sdkInt, readHasAsked())) {
        markAsked()
    }
    val mapped = mapPushPermissionState(enabled, sdkInt, readHasAsked())
    PushPermissionStore.updateState(mapped)
}

fun refreshPushPermissionStateFromContext(context: Context) {
    refreshPushPermissionState(
        enabled = NotificationManagerCompat.from(context).areNotificationsEnabled(),
        sdkInt = Build.VERSION.SDK_INT,
        readHasAsked = { hasAskedInternal(context) },
        markAsked = { markAskedInternal(context) },
    )
}

/** Call from the host once the POST_NOTIFICATIONS system prompt has been shown. */
fun notifyPushPermissionPrompted(context: Context) {
    notifyPushPermissionPromptedInternal(
        context = context,
        notifyEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled(),
    )
}

internal fun notifyPushPermissionPromptedInternal(
    context: Context,
    notifyEnabled: Boolean,
    sdkInt: Int = Build.VERSION.SDK_INT,
) {
    markAskedInternal(context)
    refreshPushPermissionState(
        enabled = notifyEnabled,
        sdkInt = sdkInt,
        readHasAsked = { hasAskedInternal(context) },
        markAsked = { markAskedInternal(context) },
    )
}

internal fun hasAskedInternal(context: Context): Boolean =
    context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getBoolean(KEY_HAS_ASKED, false)

internal fun markAskedInternal(context: Context) {
    context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_HAS_ASKED, true)
        .apply()
}
