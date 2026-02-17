package com.shyden.shytalk.core.room

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.shyden.shytalk.MainActivity
import com.shyden.shytalk.R
import com.shyden.shytalk.core.chathead.ChatHeadManager
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.koin.android.ext.android.inject

class RoomService : Service() {

    private val activeRoomManager: ActiveRoomManager by inject()
    private val userRepository: UserRepository by inject()

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var observerJob: Job? = null
    private var chatHeadJob: Job? = null
    private var roomClosedJob: Job? = null
    private var chatHeadManager: ChatHeadManager? = null
    private var ownerPhotoUrl: String? = null

    companion object {
        fun start(context: Context, roomId: String) {
            val intent = Intent(context, RoomService::class.java).apply {
                putExtra("roomId", roomId)
            }
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RoomService::class.java))
        }
    }

    override fun onCreate() {
        super.onCreate()
        chatHeadManager = ChatHeadManager(
            context = this,
            onBubbleTapped = {
                val roomId = activeRoomManager.activeRoomId.value ?: return@ChatHeadManager
                val intent = Intent(this, MainActivity::class.java).apply {
                    action = "OPEN_ROOM"
                    putExtra("roomId", roomId)
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
                startActivity(intent)
            },
            onBubbleDismissed = {
                if (activeRoomManager.isAppInForeground) {
                    // App is open — ask for confirmation via MainActivity dialog
                    val confirmIntent = Intent(this, MainActivity::class.java).apply {
                        action = "CONFIRM_LEAVE_ROOM"
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP
                    }
                    startActivity(confirmIntent)
                } else {
                    // App in background — leave/close immediately
                    performDismiss()
                }
            }
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Handle confirmed dismiss from MainActivity dialog
        if (intent?.action == "CONFIRM_DISMISS") {
            performDismiss()
            return START_NOT_STICKY
        }

        val roomId = intent?.getStringExtra("roomId") ?: run {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(Constants.ROOM_NOTIFICATION_ID, buildNotification(roomId, "Voice Room"))
        observeRoom()
        observeRoomScreenVisibility()
        observeRoomClosed()

        return START_STICKY
    }

    private fun performDismiss() {
        serviceScope.launch {
            val isOwner = activeRoomManager.activeRoom.value?.ownerId == activeRoomManager.currentUserId
            if (isOwner) {
                activeRoomManager.closeRoom()
            } else {
                activeRoomManager.leaveRoom()
            }
        }
        if (!activeRoomManager.isAppInForeground) {
            val finishIntent = Intent(this, MainActivity::class.java).apply {
                action = "FINISH_APP"
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            startActivity(finishIntent)
        }
        stopSelf()
    }

    private fun observeRoom() {
        observerJob?.cancel()
        observerJob = serviceScope.launch {
            var lastOwnerId: String? = null
            activeRoomManager.activeRoom.collect { room ->
                if (room == null) {
                    // Don't stopSelf() immediately — let observeRoomClosed show "Room Closed" on chathead
                    return@collect
                }
                val notification = buildNotification(room.roomId, room.name)
                getSystemService(NotificationManager::class.java)
                    ?.notify(Constants.ROOM_NOTIFICATION_ID, notification)

                // Fetch owner photo when owner changes
                val ownerId = room.ownerId
                if (ownerId != lastOwnerId) {
                    lastOwnerId = ownerId
                    when (val result = userRepository.getUser(ownerId)) {
                        is Resource.Success -> {
                            val url = result.data.photoUrl
                            ownerPhotoUrl = url
                            chatHeadManager?.updatePhoto(url)
                        }
                        else -> {}
                    }
                }
            }
        }
    }

    private fun observeRoomClosed() {
        roomClosedJob?.cancel()
        roomClosedJob = serviceScope.launch {
            activeRoomManager.roomClosed.collect { closed ->
                if (closed) {
                    chatHeadManager?.showRoomClosed()
                    // Stop service after chathead finishes displaying "Room Closed"
                    kotlinx.coroutines.delay(3500L)
                    stopSelf()
                }
            }
        }
    }

    private fun observeRoomScreenVisibility() {
        chatHeadJob?.cancel()
        chatHeadJob = serviceScope.launch {
            activeRoomManager.isRoomScreenVisible.collect { visible ->
                if (visible) {
                    chatHeadManager?.hide()
                } else {
                    if (Settings.canDrawOverlays(this@RoomService)) {
                        chatHeadManager?.show(ownerPhotoUrl)
                    }
                }
            }
        }
    }

    private fun buildNotification(roomId: String, roomName: String): Notification {
        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                action = "OPEN_ROOM"
                putExtra("roomId", roomId)
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, Constants.ROOM_NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("You are in a LIVE room")
            .setContentText("Tap to return")
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        android.util.Log.d("RoomService", "onTaskRemoved: app swiped from recents, calling leaveRoom")
        // Process is being killed — use runBlocking to ensure Firestore cleanup completes
        runBlocking {
            withContext(NonCancellable) {
                activeRoomManager.leaveRoom()
            }
        }
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        observerJob?.cancel()
        chatHeadJob?.cancel()
        roomClosedJob?.cancel()
        chatHeadManager?.destroy()
        chatHeadManager = null
    }
}
