package com.shyden.shytalk.data.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.shyden.shytalk.R
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.koin.android.ext.android.inject

/**
 * Foreground service that keeps Firestore snapshot listeners active
 * for PM conversations even when the app is in the background.
 * Uses FOREGROUND_SERVICE_TYPE_DATA_SYNC with minimum priority.
 */
class PmSyncService : Service() {
    companion object {
        const val CHANNEL_ID = "pm_sync_channel"
        const val NOTIFICATION_ID = 2001
    }

    private val pmRepository: PrivateMessageRepository by inject()
    private val authRepository: AuthRepository by inject()
    private val supervisorJob = SupervisorJob()
    private val exceptionHandler =
        CoroutineExceptionHandler { _, throwable ->
            android.util.Log.e("PmSyncService", "Coroutine exception", throwable)
        }
    private val serviceScope = CoroutineScope(supervisorJob + Dispatchers.IO + exceptionHandler)
    private var conversationsJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    createNotification(),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
                )
            } else {
                startForeground(NOTIFICATION_ID, createNotification())
            }
        } catch (e: Exception) {
            android.util.Log.e("PmSyncService", "startForeground failed", e)
            stopSelf()
        }
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        val userId = authRepository.currentUserId
        if (userId == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        conversationsJob?.cancel()
        conversationsJob =
            serviceScope.launch {
                while (true) {
                    try {
                        pmRepository.getConversations(userId).collect { /* keep listener alive */ }
                    } catch (e: Exception) {
                        android.util.Log.e("PmSyncService", "Conversations collection failed, retrying in 30s", e)
                        delay(30_000)
                    }
                }
            }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        conversationsJob?.cancel()
        supervisorJob.cancel()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        val channel =
            NotificationChannel(
                CHANNEL_ID,
                "Message Sync",
                NotificationManager.IMPORTANCE_NONE,
            ).apply {
                description = "Keeps messages in sync"
                setShowBadge(false)
                enableLights(false)
                enableVibration(false)
            }
        val manager = getSystemService(NotificationManager::class.java)
        manager?.createNotificationChannel(channel)
    }

    private fun createNotification(): Notification =
        NotificationCompat
            .Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
            .build()
}
