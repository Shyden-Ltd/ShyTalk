package com.shyden.shytalk.data.remote

import android.content.Context
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import io.agora.rtc2.ChannelMediaOptions
import io.agora.rtc2.Constants
import io.agora.rtc2.IRtcEngineEventHandler
import io.agora.rtc2.RtcEngine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Wrapper around the Agora RtcEngine for voice chat functionality.
 *
 * Prerequisites:
 * - Set your Agora App ID in the AGORA_APP_ID constant below
 * - For production, use AgoraTokenService to fetch tokens
 */
@Singleton
class AgoraVoiceService @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val tokenService: AgoraTokenService
) {
    enum class ConnectionState { CONNECTED, DISCONNECTED, RECONNECTING }

    companion object {
        private const val TAG = "AgoraVoiceService"
        const val AGORA_APP_ID = "7bdf5596c88f49edba75568f529c4389"
    }

    private var rtcEngine: RtcEngine? = null
    private var currentChannelName: String? = null
    private var localUid: Int = 0
    private var isLocalMuted = false

    private val _speakingUsers = MutableStateFlow<Set<Int>>(emptySet())
    val speakingUsers: StateFlow<Set<Int>> = _speakingUsers.asStateFlow()

    private val _isJoined = MutableStateFlow(false)
    val isJoined: StateFlow<Boolean> = _isJoined.asStateFlow()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    fun clearError() { _error.value = null }

    private val rtcEventHandler = object : IRtcEngineEventHandler() {
        override fun onJoinChannelSuccess(channel: String?, uid: Int, elapsed: Int) {
            Log.d(TAG, "onJoinChannelSuccess channel=$channel uid=$uid elapsed=${elapsed}ms")
            _isJoined.value = true
            _connectionState.value = ConnectionState.CONNECTED
        }

        override fun onLeaveChannel(stats: RtcStats?) {
            Log.d(TAG, "onLeaveChannel")
            _isJoined.value = false
            _speakingUsers.value = emptySet()
            _connectionState.value = ConnectionState.DISCONNECTED
        }

        override fun onError(err: Int) {
            Log.e(TAG, "Agora onError code=$err")
            _error.value = "Voice error (code $err)"
        }

        override fun onConnectionStateChanged(state: Int, reason: Int) {
            Log.d(TAG, "onConnectionStateChanged state=$state reason=$reason")
            _connectionState.value = when (state) {
                3 -> ConnectionState.CONNECTED      // CONNECTION_STATE_CONNECTED
                1, 5 -> ConnectionState.DISCONNECTED // DISCONNECTED or FAILED
                else -> ConnectionState.RECONNECTING // CONNECTING or RECONNECTING
            }
        }

        override fun onAudioVolumeIndication(
            speakers: Array<out AudioVolumeInfo>?,
            totalVolume: Int
        ) {
            val speaking = speakers
                ?.filter { it.volume > 50 }
                ?.filter { !(it.uid == 0 && isLocalMuted) }
                ?.map { if (it.uid == 0) localUid else it.uid }
                ?.toSet() ?: emptySet()
            if (speaking != _speakingUsers.value) {
                _speakingUsers.value = speaking
            }
        }

        override fun onUserOffline(uid: Int, reason: Int) {
            Log.d(TAG, "onUserOffline uid=$uid reason=$reason")
            _speakingUsers.value = _speakingUsers.value - uid
        }

        override fun onUserJoined(uid: Int, elapsed: Int) {
            Log.d(TAG, "onUserJoined uid=$uid elapsed=${elapsed}ms")
        }
    }

    fun initialize() {
        if (AGORA_APP_ID.isEmpty()) {
            Log.e(TAG, "AGORA_APP_ID is empty, cannot initialize")
            return
        }
        if (rtcEngine != null) return

        try {
            rtcEngine = RtcEngine.create(context, AGORA_APP_ID, rtcEventHandler)
            if (rtcEngine == null) {
                Log.e(TAG, "RtcEngine.create() returned null — check Agora App ID and SDK setup")
                _error.value = "Voice engine returned null — check Agora App ID"
                return
            }
            Log.d(TAG, "RtcEngine created successfully")
            rtcEngine?.apply {
                setChannelProfile(Constants.CHANNEL_PROFILE_LIVE_BROADCASTING)
                setAudioProfile(
                    Constants.AUDIO_PROFILE_SPEECH_STANDARD,
                    Constants.AUDIO_SCENARIO_CHATROOM
                )
                enableAudioVolumeIndication(300, 3, true)
                setDefaultAudioRoutetoSpeakerphone(true)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize RtcEngine", e)
            _error.value = "Voice engine init failed: ${e.message}"
            rtcEngine = null
        }
    }

    suspend fun joinChannel(channelName: String, uid: Int, asBroadcaster: Boolean = false) {
        // Already in this channel — no-op
        if (_isJoined.value && currentChannelName == channelName) {
            Log.d(TAG, "Already joined channel=$channelName, skipping rejoin")
            return
        }

        initialize()
        val engine = rtcEngine ?: run {
            Log.e(TAG, "RtcEngine is null, cannot join channel")
            _error.value = "Voice engine failed to initialize"
            return
        }

        // Leave any existing channel first
        if (_isJoined.value) {
            Log.d(TAG, "Already in a channel, leaving first")
            engine.leaveChannel()
        }

        // Only enable audio capture when joining as broadcaster (requires RECORD_AUDIO permission)
        if (asBroadcaster) {
            engine.enableAudio()
        }

        val token: String? = try {
            tokenService.fetchToken(channelName, uid)
        } catch (e: Exception) {
            Log.w(TAG, "Token fetch failed, joining without token (App Certificate must be disabled in Agora Console)", e)
            _error.value = "Token fetch failed — check Cloud Function deployment"
            null  // null = no token mode; empty string may cause auth errors
        }

        val options = ChannelMediaOptions().apply {
            clientRoleType = if (asBroadcaster) Constants.CLIENT_ROLE_BROADCASTER else Constants.CLIENT_ROLE_AUDIENCE
            channelProfile = Constants.CHANNEL_PROFILE_LIVE_BROADCASTING
            autoSubscribeAudio = true
            publishMicrophoneTrack = asBroadcaster
            autoSubscribeVideo = false
        }

        Log.d(TAG, "Joining channel=$channelName uid=$uid asBroadcaster=$asBroadcaster hasToken=${token != null}")
        val result = engine.joinChannel(token, channelName, uid, options)
        if (result != 0) {
            Log.e(TAG, "joinChannel failed with error code $result")
            _error.value = "Voice join failed (code $result)"
        } else {
            currentChannelName = channelName
            localUid = uid
            Log.d(TAG, "joinChannel call succeeded (waiting for onJoinChannelSuccess callback)")
            if (asBroadcaster) {
                engine.setEnableSpeakerphone(true)
                engine.muteLocalAudioStream(false)
                engine.adjustRecordingSignalVolume(400)
                Log.d(TAG, "Audio configured: speakerphone=on, mic=unmuted, recordingVolume=400")
            }
        }
    }

    fun setRole(broadcaster: Boolean) {
        val engine = rtcEngine ?: return
        Log.d(TAG, "setRole broadcaster=$broadcaster")
        if (broadcaster) {
            engine.enableAudio()
            engine.setClientRole(Constants.CLIENT_ROLE_BROADCASTER)
            engine.updateChannelMediaOptions(ChannelMediaOptions().apply {
                publishMicrophoneTrack = true
            })
            engine.setEnableSpeakerphone(true)
            engine.muteLocalAudioStream(false)
            engine.adjustRecordingSignalVolume(400)
            isLocalMuted = false
        } else {
            engine.setClientRole(Constants.CLIENT_ROLE_AUDIENCE)
            engine.updateChannelMediaOptions(ChannelMediaOptions().apply {
                publishMicrophoneTrack = false
            })
            isLocalMuted = false
        }
    }

    fun leaveChannel() {
        Log.d(TAG, "leaveChannel called, isJoined=${_isJoined.value}")
        currentChannelName = null
        localUid = 0
        isLocalMuted = false
        rtcEngine?.leaveChannel()
    }

    fun muteLocalAudio(mute: Boolean) {
        Log.d(TAG, "muteLocalAudio mute=$mute")
        isLocalMuted = mute
        rtcEngine?.muteLocalAudioStream(mute)
    }

    fun destroy() {
        rtcEngine?.leaveChannel()
        RtcEngine.destroy()
        rtcEngine = null
        _isJoined.value = false
        _speakingUsers.value = emptySet()
        _connectionState.value = ConnectionState.DISCONNECTED
        isLocalMuted = false
    }
}
