package com.shyden.shytalk

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.gif.AnimatedImageDecoder
import coil3.memory.MemoryCache
import coil3.request.crossfade
import android.util.Log
import androidx.browser.customtabs.CustomTabsClient
import com.shyden.shytalk.core.di.appModule
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.LanguagePreference
import okio.Path.Companion.toOkioPath
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

class ShyTalkApp : Application(), SingletonImageLoader.Factory {

    override fun newImageLoader(context: PlatformContext): ImageLoader {
        return ImageLoader.Builder(this)
            .memoryCache {
                MemoryCache.Builder()
                    .maxSizePercent(this@ShyTalkApp, 0.25)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    // Use filesDir instead of cacheDir — filesDir is never auto-cleaned
                    // by the OS, ensuring images persist between app launches.
                    .directory(filesDir.resolve("image_cache").toOkioPath())
                    .maxSizeBytes(512L * 1024 * 1024)
                    .build()
            }
            .components {
                add(AnimatedImageDecoder.Factory())
            }
            .crossfade(150)
            .build()
    }

    override fun onCreate() {
        super.onCreate()

        LanguagePreference.init(this)

        startKoin {
            androidContext(this@ShyTalkApp)
            modules(appModule)
        }

        val notificationManager = getSystemService(NotificationManager::class.java)

        val channel = NotificationChannel(
            Constants.ROOM_NOTIFICATION_CHANNEL_ID,
            "Voice Room",
            NotificationManager.IMPORTANCE_LOW
        ).apply { description = "Active voice room notification" }
        notificationManager?.createNotificationChannel(channel)

        // Warm up Chrome Custom Tabs at app startup so Firebase OAuthProvider
        // uses an in-app Custom Tab instead of an external browser.
        try {
            val ctPackage = CustomTabsClient.getPackageName(this, listOf("com.android.chrome"))
            if (ctPackage != null) {
                CustomTabsClient.connectAndInitialize(this, ctPackage)
                Log.d("ShyTalkApp", "Custom Tabs warmed up with package: $ctPackage")
            }
        } catch (e: Exception) {
            Log.w("ShyTalkApp", "Custom Tabs warmup failed", e)
        }

        val pmChannel = NotificationChannel(
            Constants.PM_NOTIFICATION_CHANNEL_ID,
            "Private Messages",
            NotificationManager.IMPORTANCE_HIGH
        ).apply { description = "Notifications for private messages" }
        notificationManager?.createNotificationChannel(pmChannel)
    }
}
