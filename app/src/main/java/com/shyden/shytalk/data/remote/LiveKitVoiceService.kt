package com.shyden.shytalk.data.remote

import android.content.Context
import android.media.AudioManager
import android.util.Log
import com.shyden.shytalk.BuildConfig
import io.livekit.android.AudioOptions
import io.livekit.android.AudioType
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class LiveKitVoiceService(
    private val context: Context,
    private val tokenService: TokenService
) : VoiceService {

    companion object {
        private const val TAG = "LiveKitVoiceService"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var currentRoomName: String? = null
    private val joinMutex = Mutex()

    // Pre-create LiveKit Room object on service init (app start) so joining a
    // voice room later only needs a token fetch + connect — no SDK init delay.
    private val room: Room = LiveKit.create(
        appContext = context,
        overrides = LiveKitOverrides(
            audioOptions = AudioOptions(
                audioOutputType = AudioType.MediaAudioType()
            )
        )
    )

    private val _speakingUsers = MutableStateFlow<Set<String>>(emptySet())
    override val speakingUsers: StateFlow<Set<String>> = _speakingUsers.asStateFlow()

    private val _isJoined = MutableStateFlow(false)
    override val isJoined: StateFlow<Boolean> = _isJoined.asStateFlow()

    private val _connectionState = MutableStateFlow(VoiceConnectionState.DISCONNECTED)
    override val connectionState: StateFlow<VoiceConnectionState> = _connectionState.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    override val error: StateFlow<String?> = _error.asStateFlow()

    override fun clearError() { _error.value = null }

    init {
        Log.d(TAG, "LiveKit Room pre-initialized")
        // Collect events once — the Room's SharedFlow persists across disconnect/connect cycles
        scope.launch {
            room.events.collect { event ->
                when (event) {
                    is RoomEvent.Connected -> {
                        Log.d(TAG, "Connected to room=$currentRoomName")
                        _isJoined.value = true
                        _connectionState.value = VoiceConnectionState.CONNECTED
                    }
                    is RoomEvent.Disconnected -> {
                        Log.d(TAG, "Disconnected from room")
                        // Don't clear currentRoomName here — managed by joinRoom/leaveChannel
                        // to avoid race conditions with back-to-back disconnect+connect
                        _isJoined.value = false
                        _connectionState.value = VoiceConnectionState.DISCONNECTED
                        _speakingUsers.value = emptySet()
                    }
                    is RoomEvent.Reconnecting -> {
                        Log.d(TAG, "Reconnecting...")
                        _connectionState.value = VoiceConnectionState.RECONNECTING
                    }
                    is RoomEvent.Reconnected -> {
                        Log.d(TAG, "Reconnected")
                        _connectionState.value = VoiceConnectionState.CONNECTED
                    }
                    is RoomEvent.ActiveSpeakersChanged -> {
                        val speakers = event.speakers.asSequence()
                            .mapNotNull { it.identity?.value }
                            .toSet()
                        if (speakers != _speakingUsers.value) {
                            _speakingUsers.value = speakers
                        }
                    }
                    is RoomEvent.FailedToConnect -> {
                        Log.e(TAG, "Failed to connect: ${event.error}")
                        _error.value = "Voice connection failed: ${event.error.message}"
                        _connectionState.value = VoiceConnectionState.DISCONNECTED
                    }
                    is RoomEvent.ParticipantDisconnected -> {
                        val identity = event.participant.identity?.value
                        if (identity != null) {
                            _speakingUsers.value = _speakingUsers.value - identity
                        }
                    }
                    else -> {}
                }
            }
        }
    }

    override suspend fun joinRoom(roomName: String, userId: String) = joinMutex.withLock {
        // Already in this room — no-op
        if (_isJoined.value && currentRoomName == roomName) {
            Log.d(TAG, "Already joined room=$roomName, skipping rejoin")
            return@withLock
        }

        // Disconnect from current room if needed (Room object stays alive)
        if (currentRoomName != null) {
            Log.d(TAG, "Already in a room, disconnecting first")
            room.disconnect()
            _isJoined.value = false
            currentRoomName = null
        }

        currentRoomName = roomName

        // Fetch token and connect
        val token: String? = try {
            tokenService.fetchToken(roomName, userId)
        } catch (e: Exception) {
            Log.w(TAG, "Token fetch failed", e)
            _error.value = "Token fetch failed — check Cloud Function deployment"
            null
        }

        if (token == null) {
            currentRoomName = null
            return@withLock
        }

        try {
            val serverUrl = BuildConfig.LIVEKIT_SERVER_URL
            if (serverUrl.isBlank()) {
                _error.value = "LiveKit server URL not configured"
                currentRoomName = null
                return@withLock
            }
            Log.d(TAG, "Connecting to room=$roomName identity=$userId")
            room.connect(serverUrl, token)
            Log.d(TAG, "Connected successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to connect", e)
            _error.value = "Voice connection failed: ${e.message}"
            currentRoomName = null
        }
    }

    override fun leaveChannel() {
        Log.d(TAG, "leaveChannel called, isJoined=${_isJoined.value}")
        _isJoined.value = false
        _speakingUsers.value = emptySet()
        currentRoomName = null
        audioManager.isSpeakerphoneOn = false
        audioManager.mode = AudioManager.MODE_NORMAL
        try {
            room.disconnect()
        } catch (e: Exception) {
            Log.e(TAG, "leaveChannel failed", e)
        }
        _connectionState.value = VoiceConnectionState.DISCONNECTED
    }

    override fun setMicrophoneEnabled(enabled: Boolean) {
        Log.d(TAG, "setMicrophoneEnabled enabled=$enabled isJoined=${_isJoined.value}")
        if (!_isJoined.value) {
            Log.w(TAG, "setMicrophoneEnabled called but not joined, ignoring")
            return
        }
        scope.launch {
            try {
                room.localParticipant.setMicrophoneEnabled(enabled)
            } catch (e: Exception) {
                Log.e(TAG, "setMicrophoneEnabled failed", e)
            }
        }
    }

    override fun setAudioMode(voiceMode: Boolean) {
        Log.d(TAG, "setAudioMode voiceMode=$voiceMode")
        if (voiceMode) {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = true
        } else {
            audioManager.isSpeakerphoneOn = false
            audioManager.mode = AudioManager.MODE_NORMAL
        }
    }

    fun destroy() {
        audioManager.isSpeakerphoneOn = false
        audioManager.mode = AudioManager.MODE_NORMAL
        try {
            room.disconnect()
            room.release()
        } catch (e: Exception) {
            Log.e(TAG, "destroy failed", e)
        }
        _isJoined.value = false
        _speakingUsers.value = emptySet()
        _connectionState.value = VoiceConnectionState.DISCONNECTED
    }
}
