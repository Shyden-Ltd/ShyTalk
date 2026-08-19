package com.shyden.shytalk.core.platform

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toBitmap
import com.shyden.shytalk.core.util.encodeUrlQueryComponent
import com.shyden.shytalk.core.util.logE
import java.lang.ref.WeakReference
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AndroidPlatformSettingsService(
    context: Context,
) : PlatformSettingsService {
    private val contextRef = WeakReference(context.applicationContext)
    private val activityRef = WeakReference(context as? Activity)
    private val ctx get() = contextRef.get()

    override fun openUrl(url: String) {
        ctx?.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    override fun openEmail(email: String) {
        ctx?.startActivity(
            Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$email"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    override fun openPlayStore(packageId: String): Boolean {
        val context = ctx ?: return false
        val market =
            Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${encodeUrlQueryComponent(packageId)}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching { context.startActivity(market) }
            .recoverCatching {
                // No Play Store installed (Huawei / AOSP) — fall back to web URL.
                val web =
                    Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=${encodeUrlQueryComponent(packageId)}"),
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(web)
            }.isSuccess
    }

    override fun openSystemSettings(type: SettingsType) {
        val context = ctx ?: return
        val intent =
            when (type) {
                SettingsType.NOTIFICATIONS -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                        }
                    } else {
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.fromParts("package", context.packageName, null)
                        }
                    }
                }

                SettingsType.OVERLAY -> {
                    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
                        data = Uri.fromParts("package", context.packageName, null)
                    }
                }

                SettingsType.MICROPHONE,
                SettingsType.BLUETOOTH,
                SettingsType.APP_SETTINGS,
                -> {
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.fromParts("package", context.packageName, null)
                    }
                }
            }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    override fun restartForLanguageChange() {
        activityRef.get()?.recreate()
    }

    override fun formatDate(
        timestamp: Long,
        pattern: String,
    ): String =
        try {
            SimpleDateFormat(pattern, Locale.getDefault()).format(Date(timestamp))
        } catch (_: Exception) {
            timestamp.toString()
        }

    override fun getAppVersionName(): String =
        try {
            val context = ctx ?: return "?"
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
        } catch (_: Exception) {
            "?"
        }

    override fun getAppIcon(): ImageBitmap? =
        try {
            val context = ctx ?: return null
            ContextCompat
                .getDrawable(context, context.applicationInfo.icon)
                ?.toBitmap(128, 128)
                ?.asImageBitmap()
        } catch (e: Exception) {
            logE("AndroidPlatformSettings", "Failed to load app icon", e)
            null
        }

    override fun areNotificationsEnabled(): Boolean {
        val context = ctx ?: return false
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        return nm?.areNotificationsEnabled() == true
    }

    override fun canDrawOverlays(): Boolean {
        val context = ctx ?: return false
        return Settings.canDrawOverlays(context)
    }

    override fun hasPermission(permission: String): Boolean {
        val context = ctx ?: return false
        // Bluetooth permission only exists on Android 12+
        if (permission == Manifest.permission.BLUETOOTH_CONNECT &&
            Build.VERSION.SDK_INT < Build.VERSION_CODES.S
        ) {
            return true
        }
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }
}
