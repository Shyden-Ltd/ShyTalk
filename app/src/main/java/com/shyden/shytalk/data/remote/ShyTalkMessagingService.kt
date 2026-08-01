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
import com.shyden.shytalk.core.push.emitGiftNotification
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
            "GIFT" -> handleGiftNotification(data)
            "AGE_VERIF_APPROVED" -> handleAgeVerifApproved()
            "AGE_VERIF_REJECTED" -> handleAgeVerifRejected(data)
            "AGE_VERIF_DOB_MODIFIED" -> handleAgeVerifDobModified(data)
        }
    }

    /**
     * A gift arrived (SHY-0266).
     *
     * FOREGROUND and BACKGROUND are different products here, not the same one
     * suppressed. In the background the user needs a tray notification they can
     * come back to; in the foreground a system notification over the app they
     * are already looking at is noise, so it becomes an in-app banner instead.
     *
     * The PM handler RETURNS on foreground — correct for a message, which has a
     * conversation to come back to. A gift has no destination to navigate to, so
     * dropping it in the foreground would mean the recipient never learns about
     * it at all: the sender paid for a gesture nobody saw.
     */
    private fun handleGiftNotification(data: Map<String, String>) {
        val senderId = data["senderId"] ?: return
        val senderName = data["senderName"] ?: return
        val giftName = data["giftName"] ?: return

        val inForeground =
            try {
                val roomManager: RoomLifecycleManager =
                    org.koin.core.context.GlobalContext
                        .get()
                        .get()
                roomManager.isAppInForeground
            } catch (e: Exception) {
                // Unknown foreground state: show the tray notification. Missing
                // one is recoverable; showing nothing is not.
                Log.w(TAG, "Foreground check failed — showing notification", e)
                false
            }

        if (inForeground) {
            emitGiftNotification(senderId, senderName, giftName)
            return
        }

        ensureNotificationChannel()
        val intent =
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
        val pendingIntent =
            PendingIntent.getActivity(
                this,
                senderId.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val notification =
            NotificationCompat
                .Builder(this, Constants.PM_NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                // Both names. "You received a gift" does not make the gesture
                // land, which is the entire point of gifting to the sender.
                .setContentTitle(senderName)
                .setContentText(getString(R.string.gift_notification_body, giftName))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build()
        getSystemService(NotificationManager::class.java)
            ?.notify(("gift-" + senderId + giftName).hashCode(), notification)
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

        val senderName = data["senderName"] ?: getString(R.string.notification_someone)
        val messageText = data["messageText"] ?: getString(R.string.notification_new_message)
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

        // Localised. Every notification string in this file was hardcoded English,
        // so a user reading the app in Japanese still got "New message" on their
        // lock screen — the one place they see the product without opening it.
        val notificationText =
            if (showPreview) messageText else getString(R.string.notification_new_message)

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

    // ─── Age verification notifications (PR 10) ────────────────────────
    //
    // Each outcome shows a single notification. Tapping it opens the
    // app's main entry — the system PM (PR 5) carries the full body,
    // so the local notification is just an at-a-glance summary.

    private fun handleAgeVerifApproved() {
        showAgeVerifNotification(
            title = "Age verification approved",
            text = "You now have full access to ShyTalk. Tap to learn more.",
            id = NOTIFICATION_ID_AGE_VERIF_APPROVED,
        )
    }

    private fun handleAgeVerifRejected(data: Map<String, String>) {
        val preview = data["reasonPreview"]?.takeIf { it.isNotBlank() }
        showAgeVerifNotification(
            title = "Age verification update",
            text =
                preview
                    ?.let { "Your submission wasn't approved: $it" }
                    ?: "Your submission wasn't approved. Tap to read more.",
            id = NOTIFICATION_ID_AGE_VERIF_REJECTED,
        )
    }

    private fun handleAgeVerifDobModified(data: Map<String, String>) {
        val becameVerified = data["becameVerified"]?.toBooleanStrictOrNull() ?: false
        val (title, text) =
            if (becameVerified) {
                "Date of birth updated" to "Your DOB was corrected and you now have full access. Tap to read more."
            } else {
                "Date of birth updated" to "Your DOB was corrected. Some features remain age-restricted. Tap to read more."
            }
        showAgeVerifNotification(
            title = title,
            text = text,
            id = NOTIFICATION_ID_AGE_VERIF_DOB_MODIFIED,
        )
    }

    private fun showAgeVerifNotification(
        title: String,
        text: String,
        id: Int,
    ) {
        ensureAgeVerifChannel()
        val intent =
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
        val pendingIntent =
            PendingIntent.getActivity(
                this,
                id,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val notification =
            NotificationCompat
                .Builder(this, Constants.AGE_VERIF_NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle(title)
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build()
        getSystemService(NotificationManager::class.java)?.notify(id, notification)
    }

    private fun ensureAgeVerifChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel =
                NotificationChannel(
                    Constants.AGE_VERIF_NOTIFICATION_CHANNEL_ID,
                    "Age verification",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Notifications about your age-verification submission status"
                }
            getSystemService(NotificationManager::class.java)
                ?.createNotificationChannel(channel)
        }
    }

    private companion object {
        const val NOTIFICATION_ID_AGE_VERIF_APPROVED = 70_001
        const val NOTIFICATION_ID_AGE_VERIF_REJECTED = 70_002
        const val NOTIFICATION_ID_AGE_VERIF_DOB_MODIFIED = 70_003
    }
}
