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
import com.shyden.shytalk.core.di.appModule
import com.shyden.shytalk.core.util.Constants
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
                    .directory(cacheDir.resolve("image_cache").toOkioPath())
                    .maxSizeBytes(512L * 1024 * 1024)
                    .build()
            }
            .components {
                add(AnimatedImageDecoder.Factory())
            }
            .crossfade(true)
            .build()
    }

    override fun onCreate() {
        super.onCreate()

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

        val pmChannel = NotificationChannel(
            Constants.PM_NOTIFICATION_CHANNEL_ID,
            "Private Messages",
            NotificationManager.IMPORTANCE_HIGH
        ).apply { description = "Notifications for private messages" }
        notificationManager?.createNotificationChannel(pmChannel)
    }
}
