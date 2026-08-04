package com.shyden.shytalk.data.remote

import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.resolveVoiceServerUrl
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Real iOS VoiceService implementation using LiveKit via the Swift bridge.
 *
 * Mirrors the Android LiveKitVoiceService behaviour:
 * - Token prewarming for fast room entry
 * - Mutex-locked join/leave for thread safety
 * - Speaking user tracking via delegate events
 * - Connection state management
 */
class IosLiveKitVoiceService(
    private val tokenService: TokenService,
) : VoiceService,
    LiveKitBridgeDelegate {
    companion object {
        private const val TAG = "IosVoiceService"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val joinMutex = Mutex()

    private val _speakingUsers = MutableStateFlow<Set<String>>(emptySet())
    override val speakingUsers: StateFlow<Set<String>> = _speakingUsers.asStateFlow()

    private val _isJoined = MutableStateFlow(false)
    override val isJoined: StateFlow<Boolean> = _isJoined.asStateFlow()

    private val _connectionState = MutableStateFlow(VoiceConnectionState.DISCONNECTED)
    override val connectionState: StateFlow<VoiceConnectionState> = _connectionState.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    override val error: StateFlow<String?> = _error.asStateFlow()

    // Token caching
    private var cachedToken: String? = null
    private var cachedServerUrl: String? = null
    private var currentRoomName: String? = null
    private var currentUserId: String? = null

    // Prewarming
    private var prewarmedToken: String? = null
    private var prewarmedUrl: String? = null
    private var prewarmedRoomName: String? = null
    private var prewarmJob: Job? = null

    private val bridge: LiveKitBridge?
        get() = getLiveKitBridge()

    init {
        // Register ourselves as the delegate for LiveKit events
        bridge?.setDelegate(this)
    }

    override suspend fun joinRoom(
        roomName: String,
        userId: String,
    ) {
        joinMutex.withLock {
            // Disconnect from any existing room
            if (_isJoined.value) {
                bridge?.disconnect()
                _isJoined.value = false
                _speakingUsers.value = emptySet()
            }

            currentRoomName = roomName
            currentUserId = userId

            // Use prewarmed token if available and matching
            val token: String
            val serverUrl: String
            // SHY-0275 — the server does NOT always supply the URL.
            // `express-api/src/routes/livekit.js` omits `url` from the token
            // response when NODE_ENV is `local`, by design, leaving the client
            // to use its own: Android reads BuildConfig.LIVEKIT_SERVER_URL.
            // iOS had no counterpart, so both branches below fell through to
            // "" and the bridge refused its own connection before any network
            // call — indistinguishable, from the UI, from voice being broken.
            // BuildVariant.liveKitUrl is null on dev/prod, where the server
            // always answers, so this changes nothing off local.
            // The selection lives in commonMain as `resolveVoiceServerUrl` so it
            // is unit-testable — there is no iosTest source set, and inline the
            // only guard was a structural check that the token `liveKitUrl`
            // appeared in this file, which a swapped operand order would satisfy
            // while breaking voice on dev and prod.
            val fallbackUrl = BuildVariant.liveKitUrl
            if (prewarmedToken != null && prewarmedRoomName == roomName) {
                token = prewarmedToken!!
                serverUrl = resolveVoiceServerUrl(prewarmedUrl, fallbackUrl)
                prewarmedToken = null
                prewarmedUrl = null
                prewarmedRoomName = null
                logI(TAG, "Using prewarmed token for room $roomName")
            } else {
                logI(TAG, "Fetching fresh token for room $roomName")
                try {
                    val response = tokenService.fetchToken(roomName)
                    token = response.token
                    serverUrl = resolveVoiceServerUrl(response.url, fallbackUrl)
                } catch (e: Exception) {
                    logE(TAG, "Token fetch failed: ${e.message}")
                    _error.value = "Failed to connect to voice: ${e.message}"
                    return
                }
            }

            cachedToken = token
            cachedServerUrl = serverUrl

            val currentBridge = bridge
            if (currentBridge == null) {
                logE(TAG, "LiveKit bridge not registered — cannot connect")
                _error.value = "Voice service not available on this device"
                return
            }

            // Re-register delegate (bridge may have been re-created)
            currentBridge.setDelegate(this)
            currentBridge.connect(url = serverUrl, token = token)
        }
    }

    override fun leaveChannel() {
        scope.launch {
            joinMutex.withLock {
                bridge?.setDelegate(null)
                bridge?.disconnect()
                _isJoined.value = false
                _connectionState.value = VoiceConnectionState.DISCONNECTED
                _speakingUsers.value = emptySet()
                cachedToken = null
                cachedServerUrl = null
                currentRoomName = null
                currentUserId = null
                logI(TAG, "Left voice channel")
            }
        }
    }

    override fun setMicrophoneEnabled(enabled: Boolean) {
        bridge?.setMicrophoneEnabled(enabled)
    }

    override fun setAudioMode(voiceMode: Boolean) {
        // iOS audio session management is handled by LiveKit SDK internally
        // No separate audio mode switch needed (unlike Android AudioManager)
    }

    override fun clearError() {
        _error.value = null
    }

    override fun prewarmToken(
        roomName: String,
        userId: String,
    ) {
        prewarmJob?.cancel()
        prewarmJob =
            scope.launch {
                try {
                    val response = tokenService.fetchToken(roomName)
                    prewarmedToken = response.token
                    prewarmedUrl = response.url
                    prewarmedRoomName = roomName
                    logI(TAG, "Prewarmed token for room $roomName")
                } catch (e: Exception) {
                    logE(TAG, "Token prewarm failed: ${e.message}")
                }
            }
    }

    // ── LiveKitBridgeDelegate events ──

    override fun onConnected() {
        _isJoined.value = true
        _connectionState.value = VoiceConnectionState.CONNECTED
        logI(TAG, "Connected to room $currentRoomName")
    }

    override fun onDisconnected() {
        _isJoined.value = false
        _connectionState.value = VoiceConnectionState.DISCONNECTED
        _speakingUsers.value = emptySet()
        logI(TAG, "Disconnected from room")
    }

    override fun onReconnecting() {
        _connectionState.value = VoiceConnectionState.RECONNECTING
        logI(TAG, "Reconnecting...")
    }

    override fun onReconnected() {
        _connectionState.value = VoiceConnectionState.CONNECTED
        logI(TAG, "Reconnected")
    }

    override fun onActiveSpeakersChanged(speakerIdentities: List<String>) {
        _speakingUsers.update { speakerIdentities.toSet() }
    }

    override fun onParticipantDisconnected(identity: String) {
        _speakingUsers.update { it - identity }
    }

    override fun onConnectionFailed(error: String) {
        _error.value = "Voice connection failed: $error"
        _connectionState.value = VoiceConnectionState.DISCONNECTED
        logE(TAG, "Connection failed: $error")
    }
}
