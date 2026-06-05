package com.shyden.shytalk.core.push

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat

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
                    data = android.net.Uri.fromParts("package", applicationContext.packageName, null)
                }
            }
        // FLAG_ACTIVITY_NEW_TASK required because the bridge holds applicationContext, not an Activity.
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        applicationContext.startActivity(intent)
    }
}

fun refreshPushPermissionStateFromContext(context: Context) {
    val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
    val mapped = if (enabled) PushPermissionState.AUTHORIZED else PushPermissionState.DENIED
    PushPermissionStore.updateState(mapped)
}
