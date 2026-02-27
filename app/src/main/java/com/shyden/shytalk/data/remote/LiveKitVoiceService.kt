package com.shyden.shytalk.data.remote

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.util.Log
import com.shyden.shytalk.BuildConfig
import io.livekit.android.AudioOptions
import io.livekit.android.AudioType
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.audio.NoAudioHandler
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
    private var currentUserId: String? = null
    private var cachedToken: String? = null
    private val joinMutex = Mutex()

    // Token pre-warming: fetched in background before user navigates to room
    private var prewarmedToken: String? = null
    private var prewarmedRoomName: String? = null
    private var prewarmJob: Job? = null

    // Audio type switching: we recreate the Room to swap between
    // CallAudioType (STREAM_VOICE_CALL → loudspeaker) and
    // MediaAudioType (STREAM_MUSIC → media channel).
    private var isVoiceMode = false
    private var roomIsVoiceMode = false // tracks what the current Room was created with
    private var desiredMicEnabled = false
    private var isSwitchingAudioType = false
    private var eventCollectionJob: Job? = null

    // Start with MediaAudioType — users join muted (media channel).
    private var room: Room = createRoom(voiceMode = false)

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
        Log.d(TAG, "LiveKit Room pre-initialized (MediaAudioType)")
        setupEventCollection()
    }

    private fun setSpeakerphoneEnabled(enabled: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (enabled) {
                val speaker = audioManager.availableCommunicationDevices
                    .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                if (speaker != null) {
                    audioManager.setCommunicationDevice(speaker)
                }
            } else {
                audioManager.clearCommunicationDevice()
            }
        } else {
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = enabled
        }
    }

    /**
     * Creates a LiveKit Room with the appropriate audio output type.
     * - voiceMode=true  → CallAudioType (STREAM_VOICE_CALL) for communication loudspeaker
     * - voiceMode=false → MediaAudioType (STREAM_MUSIC) for media channel
     *
     * NoAudioHandler prevents LiveKit from managing AudioManager — we handle it ourselves.
     */
    private fun createRoom(voiceMode: Boolean): Room {
        val audioType = if (voiceMode) AudioType.CallAudioType() else AudioType.MediaAudioType()
        return LiveKit.create(
            appContext = context,
            overrides = LiveKitOverrides(
                audioOptions = AudioOptions(
                    audioOutputType = audioType,
                    audioHandler = NoAudioHandler()
                )
            )
        )
    }

    private fun setupEventCollection() {
        eventCollectionJob?.cancel()
        eventCollectionJob = scope.launch {
            room.events.collect { event ->
                when (event) {
                    is RoomEvent.Connected -> {
                        Log.d(TAG, "Connected to room=$currentRoomName")
                        _isJoined.value = true
                        _connectionState.value = VoiceConnectionState.CONNECTED
                        isSwitchingAudioType = false
                    }
                    is RoomEvent.Disconnected -> {
                        Log.d(TAG, "Disconnected from room")
                        if (!isSwitchingAudioType) {
                            _isJoined.value = false
                            _connectionState.value = VoiceConnectionState.DISCONNECTED
                            _speakingUsers.value = emptySet()
                        }
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
                        _error.value = "Voice is temporarily unavailable"
                        _connectionState.value = VoiceConnectionState.DISCONNECTED
                        _isJoined.value = false
                        isSwitchingAudioType = false
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
        currentUserId = userId

        // Use prewarmed token if available for this room, otherwise fetch
        prewarmJob?.join() // Wait for in-flight prewarm if running
        val token: String? = if (prewarmedRoomName == roomName && prewarmedToken != null) {
            Log.d(TAG, "Using prewarmed token for room=$roomName")
            prewarmedToken.also {
                prewarmedToken = null
                prewarmedRoomName = null
            }
        } else {
            try {
                tokenService.fetchToken(roomName, userId)
            } catch (e: Exception) {
                Log.w(TAG, "Token fetch failed", e)
                _error.value = "Voice is temporarily unavailable"
                null
            }
        }

        if (token == null) {
            currentRoomName = null
            currentUserId = null
            return@withLock
        }

        cachedToken = token

        try {
            val serverUrl = BuildConfig.LIVEKIT_SERVER_URL
            if (serverUrl.isBlank()) {
                _error.value = "Voice is temporarily unavailable"
                currentRoomName = null
                currentUserId = null
                return@withLock
            }
            Log.d(TAG, "Connecting to room=$roomName identity=$userId")
            room.connect(serverUrl, token)
            Log.d(TAG, "Connected successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to connect", e)
            _error.value = "Voice is temporarily unavailable"
            currentRoomName = null
            currentUserId = null
            cachedToken = null
        }
    }

    override fun leaveChannel() {
        Log.d(TAG, "leaveChannel called, isJoined=${_isJoined.value}")
        _isJoined.value = false
        _speakingUsers.value = emptySet()
        currentRoomName = null
        currentUserId = null
        cachedToken = null
        prewarmedToken = null
        prewarmedRoomName = null
        prewarmJob?.cancel()
        desiredMicEnabled = false
        isVoiceMode = false
        setSpeakerphoneEnabled(false)
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
        desiredMicEnabled = enabled
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
        Log.d(TAG, "setAudioMode voiceMode=$voiceMode (current=$isVoiceMode)")

        // Set AudioManager mode immediately
        if (voiceMode) {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            setSpeakerphoneEnabled(true)
        } else {
            setSpeakerphoneEnabled(false)
            audioManager.mode = AudioManager.MODE_NORMAL
        }

        if (voiceMode == isVoiceMode) return
        isVoiceMode = voiceMode

        // Reconnect with the new audio type if currently in a room
        if (_isJoined.value && currentRoomName != null) {
            scope.launch { switchAudioType() }
        }
    }

    /**
     * Disconnects, recreates the Room with the current [isVoiceMode] audio type,
     * and reconnects using the cached token. This switches between
     * STREAM_VOICE_CALL (communication/loudspeaker) and STREAM_MUSIC (media channel).
     */
    private suspend fun switchAudioType() = joinMutex.withLock {
        val roomName = currentRoomName ?: return@withLock
        val userId = currentUserId ?: return@withLock

        // If another switch already set the room to our desired mode, skip
        if (isVoiceMode == roomIsVoiceMode) {
            Log.d(TAG, "Room already has desired audio type (voiceMode=$isVoiceMode), skipping")
            return@withLock
        }

        val token = cachedToken ?: try {
            Log.w(TAG, "No cached token for audio switch, fetching new one")
            tokenService.fetchToken(roomName, userId)
        } catch (e: Exception) {
            Log.e(TAG, "Token fetch failed during audio switch", e)
            _error.value = "Voice is temporarily unavailable"
            return@withLock
        }

        Log.d(TAG, "Switching audio type: voiceMode=$isVoiceMode")
        isSwitchingAudioType = true

        try {
            // Disconnect and release old room
            room.disconnect()
            room.release()

            // Create new room with appropriate audio type
            val targetVoiceMode = isVoiceMode
            room = createRoom(targetVoiceMode)
            roomIsVoiceMode = targetVoiceMode
            setupEventCollection()

            // Reconnect
            val serverUrl = BuildConfig.LIVEKIT_SERVER_URL
            room.connect(serverUrl, token)
            cachedToken = token

            // Restore mic state
            room.localParticipant.setMicrophoneEnabled(desiredMicEnabled)
            Log.d(TAG, "Audio type switched successfully (voiceMode=$targetVoiceMode)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to switch audio type", e)
            _error.value = "Voice is temporarily unavailable"
            isSwitchingAudioType = false
            _isJoined.value = false
            _connectionState.value = VoiceConnectionState.DISCONNECTED
        }
    }

    override fun prewarmToken(roomName: String, userId: String) {
        prewarmJob?.cancel()
        prewarmedToken = null
        prewarmedRoomName = null
        prewarmJob = scope.launch {
            try {
                Log.d(TAG, "Pre-warming token for room=$roomName")
                val token = tokenService.fetchToken(roomName, userId)
                prewarmedToken = token
                prewarmedRoomName = roomName
                Log.d(TAG, "Token pre-warmed for room=$roomName")
            } catch (e: Exception) {
                Log.w(TAG, "Token pre-warm failed (joinRoom will retry)", e)
            }
        }
    }

    fun destroy() {
        setSpeakerphoneEnabled(false)
        audioManager.mode = AudioManager.MODE_NORMAL
        try {
            room.disconnect()
            room.release()
        } catch (e: Exception) {
            Log.e(TAG, "destroy failed", e)
        }
        eventCollectionJob?.cancel()
        _isJoined.value = false
        _speakingUsers.value = emptySet()
        _connectionState.value = VoiceConnectionState.DISCONNECTED
    }
}
