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
import com.shyden.shytalk.core.push.AndroidPushIdentifiers
import com.shyden.shytalk.core.push.PushIdentifier
import com.shyden.shytalk.core.push.PushIdentifierKind
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.data.repository.NotificationRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private const val TAG = "FCMService"

class ShyTalkMessagingService : FirebaseMessagingService() {
    /**
     * SHY-0244 — the V1 registration model.
     *
     * The token-model callback `onNewToken` is NOT implemented alongside this
     * one. It is deprecated in messaging 25.1.0, and overriding it fails the
     * build under `-Werror`; silencing that with a suppression is exactly what
     * this story set out not to do. So Android speaks the installation-ID
     * model only, and the manifest flag must stay set — which
     * [AndroidPushIdentifiers.installationIdEnabled] asserts rather than
     * assumes.
     *
     * (iOS keeps both paths because implementing its deprecated delegate costs
     * no warning there, so a rollback is a plist flip. On Android a rollback is
     * a revert, as this story originally assumed.)
     */
    override fun onRegistered(installationId: String) {
        super.onRegistered(installationId)
        register(PushIdentifier(installationId, PushIdentifierKind.INSTALLATION_ID))
    }

    @OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
    private fun register(identifier: PushIdentifier) {
        AndroidPushIdentifiers.cache(applicationContext, identifier)
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
                notificationRepo.savePushIdentifier(userId, identifier)
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
            "AGE_VERIF_APPROVED" -> handleAgeVerifApproved()
            "AGE_VERIF_REJECTED" -> handleAgeVerifRejected(data)
            "AGE_VERIF_DOB_MODIFIED" -> handleAgeVerifDobModified(data)
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
