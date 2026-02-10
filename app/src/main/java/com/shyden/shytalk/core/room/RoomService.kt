package com.shyden.shytalk.core.room

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.shyden.shytalk.MainActivity
import com.shyden.shytalk.R
import com.shyden.shytalk.core.util.Constants
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import javax.inject.Inject

@AndroidEntryPoint
class RoomService : Service() {

    @Inject lateinit var activeRoomManager: ActiveRoomManager

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var observerJob: Job? = null

    companion object {
        const val ACTION_STOP = "com.shyden.shytalk.STOP_ROOM_SERVICE"

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

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            serviceScope.launch {
                activeRoomManager.leaveRoom()
            }
            stopSelf()
            return START_NOT_STICKY
        }

        val roomId = intent?.getStringExtra("roomId") ?: run {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(Constants.ROOM_NOTIFICATION_ID, buildNotification(roomId, "Voice Room"))
        observeRoom()

        return START_STICKY
    }

    private fun observeRoom() {
        observerJob?.cancel()
        observerJob = serviceScope.launch {
            activeRoomManager.activeRoom.collect { room ->
                if (room == null) {
                    stopSelf()
                    return@collect
                }
                val notification = buildNotification(room.roomId, room.name)
                getSystemService(NotificationManager::class.java)
                    ?.notify(Constants.ROOM_NOTIFICATION_ID, notification)
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

        val leaveIntent = PendingIntent.getService(
            this, 1,
            Intent(this, RoomService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, Constants.ROOM_NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("In: $roomName")
            .setContentText("Tap to return to the room")
            .setContentIntent(contentIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Leave", leaveIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
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
    }
}
