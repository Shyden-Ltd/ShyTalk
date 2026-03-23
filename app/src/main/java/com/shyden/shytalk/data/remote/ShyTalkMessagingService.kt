package com.shyden.shytalk.data.remote

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.shyden.shytalk.MainActivity
import com.shyden.shytalk.R
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.data.repository.NotificationRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private const val TAG = "FCMService"

class ShyTalkMessagingService : FirebaseMessagingService() {
    @OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        @Suppress("GlobalCoroutineUsage")
        kotlinx.coroutines.GlobalScope.launch(Dispatchers.IO) {
            try {
                val authRepo: com.shyden.shytalk.data.repository.AuthRepository =
                    org.koin.core.context.GlobalContext
                        .get()
                        .get()
                val userId = authRepo.currentUserId
                if (userId.isNullOrEmpty()) {
                    Log.d(TAG, "onNewToken: no authenticated user — token will be saved on next login")
                    return@launch
                }
                val notificationRepo: NotificationRepository =
                    org.koin.core.context.GlobalContext
                        .get()
                        .get()
                notificationRepo.saveFcmToken(userId, token)
            } catch (e: Exception) {
                Log.w(TAG, "FCM token save failed — will retry on next app launch", e)
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)

        val data = message.data
        val type = data["type"] ?: return

        when (type) {
            "PM" -> handlePmNotification(data)
        }
    }

    private fun handlePmNotification(data: Map<String, String>) {
        // Suppress notifications when app is in the foreground
        try {
            val roomManager: RoomLifecycleManager =
                org.koin.core.context.GlobalContext
                    .get()
                    .get()
            if (roomManager.isAppInForeground) return
        } catch (e: Exception) {
            Log.w(TAG, "Foreground check failed — showing notification", e)
        }

        val senderName = data["senderName"] ?: "Someone"
        val messageText = data["messageText"] ?: "New message"
        val senderId = data["senderId"] ?: return
        val conversationId = data["conversationId"] ?: return
        val isGroup = data["isGroup"]?.toBooleanStrictOrNull() ?: false
        val showPreview = data["showPreview"]?.toBooleanStrictOrNull() ?: true

        ensureNotificationChannel()

        val intent =
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("navigateTo", "chat")
                putExtra("otherUserId", senderId)
                putExtra("conversationId", conversationId)
                putExtra("isGroup", isGroup)
            }
        val pendingIntent =
            PendingIntent.getActivity(
                this,
                conversationId.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val notificationText = if (showPreview) messageText else "New message"

        val notification =
            NotificationCompat
                .Builder(this, Constants.PM_NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle(senderName)
                .setContentText(notificationText)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build()

        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager?.notify(conversationId.hashCode(), notification)
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel =
                NotificationChannel(
                    Constants.PM_NOTIFICATION_CHANNEL_ID,
                    "Private Messages",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Notifications for private messages"
                }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }
}
