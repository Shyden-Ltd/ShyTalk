package com.shyden.shytalk.core.room

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.shyden.shytalk.MainActivity
import com.shyden.shytalk.R
import com.shyden.shytalk.core.chathead.ChatHeadManager
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
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
        private const val TAG = "RoomService"

        fun start(
            context: Context,
            roomId: String,
        ) {
            val intent =
                Intent(context, RoomService::class.java).apply {
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
        chatHeadManager =
            ChatHeadManager(
                context = this,
                onBubbleTapped = {
                    val roomId = activeRoomManager.activeRoomId.value ?: return@ChatHeadManager
                    val intent =
                        Intent(this, MainActivity::class.java).apply {
                            action = "OPEN_ROOM"
                            putExtra("roomId", roomId)
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                                Intent.FLAG_ACTIVITY_CLEAR_TOP
                        }
                    startActivity(intent)
                },
                onBubbleDismissed = {
                    // Always ask for confirmation — chathead overlay is still visible,
                    // so SYSTEM_ALERT_WINDOW exemption allows starting the Activity
                    // even when the app is in the background.
                    val confirmIntent =
                        Intent(this, MainActivity::class.java).apply {
                            action = "CONFIRM_LEAVE_ROOM"
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP
                        }
                    startActivity(confirmIntent)
                },
            )
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        // Handle confirmed dismiss from MainActivity dialog
        if (intent?.action == "CONFIRM_DISMISS") {
            performDismiss()
            return START_NOT_STICKY
        }

        val roomId =
            intent?.getStringExtra("roomId") ?: run {
                stopSelf()
                return START_NOT_STICKY
            }

        val notification = buildNotification(roomId, "Voice Room")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val hasMicPermission =
                ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.RECORD_AUDIO,
                ) == PackageManager.PERMISSION_GRANTED
            val serviceType =
                if (hasMicPermission) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                } else {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                }
            startForeground(Constants.ROOM_NOTIFICATION_ID, notification, serviceType)
        } else {
            startForeground(Constants.ROOM_NOTIFICATION_ID, notification)
        }
        observeRoom()
        observeRoomScreenVisibility()
        observeRoomClosed()

        return START_STICKY
    }

    private fun performDismiss() {
        serviceScope.launch {
            val roomId = activeRoomManager.activeRoomId.value
            val room = activeRoomManager.activeRoom.value
            val userId = activeRoomManager.currentUserId
            Log.d(TAG, "performDismiss: roomId=$roomId ownerId=${room?.ownerId} userId=$userId")

            try {
                if (roomId != null) {
                    val isOwner = room?.ownerId == userId
                    if (isOwner || room == null) {
                        // Owner closes the room. If room data is null (race condition),
                        // default to close as the safest option.
                        activeRoomManager.closeRoom()
                    } else {
                        activeRoomManager.leaveRoom()
                    }
                } else {
                    Log.w(TAG, "performDismiss: no active room — cleaning up chathead only")
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "performDismiss: error during close/leave", e)
            }

            // Hide chathead and stop service
            chatHeadManager?.hide()
            stopSelf()
        }
    }

    private fun observeRoom() {
        observerJob?.cancel()
        observerJob =
            serviceScope.launch {
                activeRoomManager.activeRoom.collect { room ->
                    if (room == null) {
                        // Don't stopSelf() immediately — let observeRoomClosed show "Room Closed" on chathead
                        return@collect
                    }
                    val notification = buildNotification(room.roomId, room.name)
                    getSystemService(NotificationManager::class.java)
                        ?.notify(Constants.ROOM_NOTIFICATION_ID, notification)

                    // Keep trying to resolve owner photo until we have one
                    if (ownerPhotoUrl.isNullOrEmpty()) {
                        resolveOwnerPhoto(room.ownerId)
                    }
                }
            }
    }

    private fun observeRoomClosed() {
        roomClosedJob?.cancel()
        roomClosedJob =
            serviceScope.launch {
                activeRoomManager.roomClosed.collect { closed ->
                    if (closed) {
                        Log.d(TAG, "observeRoomClosed: room closed — showing animation")
                        chatHeadManager?.showRoomClosed()
                        // Stop service after chathead finishes displaying "Room Closed"
                        kotlinx.coroutines.delay(3500L)
                        Log.d(TAG, "observeRoomClosed: animation done — stopping service")
                        stopSelf()
                    }
                }
            }
    }

    private fun observeRoomScreenVisibility() {
        chatHeadJob?.cancel()
        chatHeadJob =
            serviceScope.launch {
                activeRoomManager.isRoomScreenVisible.collect { visible ->
                    if (visible) {
                        chatHeadManager?.hide()
                    } else {
                        if (Settings.canDrawOverlays(this@RoomService)) {
                            // Resolve photo before showing — brief wait for room data if needed
                            if (ownerPhotoUrl.isNullOrEmpty()) {
                                var room = activeRoomManager.activeRoom.value
                                if (room == null) {
                                    Log.d(TAG, "observeRoomScreenVisibility: room data not yet available, waiting briefly...")
                                    room =
                                        withTimeoutOrNull(1000L) {
                                            activeRoomManager.activeRoom.filterNotNull().first()
                                        }
                                }
                                if (room != null) {
                                    resolveOwnerPhoto(room.ownerId)
                                } else {
                                    Log.d(TAG, "observeRoomScreenVisibility: no room data — showing chathead without photo")
                                }
                            }
                            val photoToShow = ownerPhotoUrl?.takeIf { it.isNotEmpty() }
                            Log.d(TAG, "observeRoomScreenVisibility: showing chathead with photo=$photoToShow")
                            chatHeadManager?.show(photoToShow)
                        }
                    }
                }
            }
    }

    private suspend fun resolveOwnerPhoto(ownerId: String) {
        // 1. Check sharedUserCache (populated by RoomViewModel)
        val cached = activeRoomManager.sharedUserCache[ownerId]
        val url = cached?.photoUrl
        if (!url.isNullOrEmpty()) {
            Log.d(TAG, "resolveOwnerPhoto: found in cache url=$url")
            ownerPhotoUrl = url
            chatHeadManager?.updatePhoto(url)
            return
        }
        // 2. Fall back to API — suspend until result arrives
        Log.d(TAG, "resolveOwnerPhoto: cache miss for ownerId=$ownerId, calling API")
        when (val result = userRepository.getUser(ownerId)) {
            is Resource.Success -> {
                val photo = result.data.photoUrl
                Log.d(TAG, "resolveOwnerPhoto: API returned photoUrl=$photo")
                if (!photo.isNullOrEmpty()) {
                    ownerPhotoUrl = photo
                    chatHeadManager?.updatePhoto(photo)
                }
            }

            is Resource.Error -> {
                Log.w(TAG, "resolveOwnerPhoto: API error: ${result.message}")
            }

            else -> {
                Log.w(TAG, "resolveOwnerPhoto: unexpected result: $result")
            }
        }
    }

    private fun buildNotification(
        roomId: String,
        roomName: String,
    ): Notification {
        val contentIntent =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java).apply {
                    action = "OPEN_ROOM"
                    putExtra("roomId", roomId)
                    flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        return NotificationCompat
            .Builder(this, Constants.ROOM_NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.notification_in_live_room))
            .setContentText(getString(R.string.notification_tap_to_return))
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        android.util.Log.d("RoomService", "onTaskRemoved: app swiped from recents, calling leaveRoom")
        // Run cleanup on a background thread, then stop the service
        Thread {
            runBlocking {
                // Intentionally catch CancellationException (via Exception) here:
                // `withTimeout` throws TimeoutCancellationException on its 2s deadline,
                // which IS the expected path. Rethrowing would propagate out of
                // runBlocking and crash this background Thread before stopSelf() runs.
                // No outer coroutine scope exists to propagate cancellation to.
                try {
                    withTimeout(2000L) {
                        activeRoomManager.leaveRoom()
                    }
                } catch (e: Exception) {
                    android.util.Log.w("RoomService", "onTaskRemoved: leaveRoom timed out or failed", e)
                }
            }
            stopSelf()
        }.start()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        // Cancel the parent scope so SupervisorJob and any in-flight or
        // subsequently-launched child coroutines are torn down with the
        // service. The individual job cancels below are now redundant
        // (children are cancelled when the parent is) but kept for
        // explicit readability around which observers existed.
        serviceScope.cancel()
        observerJob?.cancel()
        chatHeadJob?.cancel()
        roomClosedJob?.cancel()
        chatHeadManager?.destroy()
        chatHeadManager = null
    }
}
